package server

import (
	"archive/tar"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
)

type SyncState struct {
	mu            sync.Mutex
	syncDir       string
	entryPoint    string
	manifestCache map[string]string // relative path -> sha256
	pendingSync   map[string]string // from last diff
}

func NewSyncState(syncDir string) *SyncState {
	return &SyncState{syncDir: syncDir}
}

func (s *SyncState) EntryPoint() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.entryPoint
}

// syncServer implements sidecarv1connect.SyncServiceHandler.
type syncServer struct {
	s *Server
}

func (h *syncServer) Diff(ctx context.Context, req *connect.Request[sidecarv1.SyncDiffRequest]) (*connect.Response[sidecarv1.SyncDiffResponse], error) {
	syncDir := h.s.cfg.SyncDir
	state := h.s.syncState

	files := req.Msg.Files
	if files == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("files manifest required"))
	}

	// Validate all paths
	for filePath := range files {
		if !validateSyncPath(syncDir, filePath) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid path: %s", filePath))
		}
	}

	state.mu.Lock()
	defer state.mu.Unlock()

	if req.Msg.Entry != "" {
		if !validateSyncPath(syncDir, req.Msg.Entry) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid entry point path: %s", req.Msg.Entry))
		}
		state.entryPoint = req.Msg.Entry
	}

	state.pendingSync = files

	// Get disk manifest from cache or scan
	var diskManifest map[string]string
	if state.manifestCache != nil {
		diskManifest = state.manifestCache
	} else {
		diskManifest = walkDir(syncDir, "")
		state.manifestCache = diskManifest
	}

	// Compute diff
	var need []string
	for filePath, hash := range files {
		if diskManifest[filePath] != hash {
			need = append(need, filePath)
		}
	}

	return connect.NewResponse(&sidecarv1.SyncDiffResponse{Need: need}), nil
}

func (h *syncServer) Push(ctx context.Context, stream *connect.ClientStream[sidecarv1.SyncPushRequest]) (*connect.Response[sidecarv1.SyncPushResponse], error) {
	syncDir := h.s.cfg.SyncDir
	state := h.s.syncState

	// Pipe streaming chunks into a tar reader
	pr, pw := io.Pipe()
	go func() {
		var total int64
		const maxSize = 256 << 20
		for stream.Receive() {
			chunk := stream.Msg().Chunk
			total += int64(len(chunk))
			if total > maxSize {
				pw.CloseWithError(fmt.Errorf("tar payload exceeds 256MB limit"))
				return
			}
			if _, err := pw.Write(chunk); err != nil {
				pw.CloseWithError(err)
				return
			}
		}
		if err := stream.Err(); err != nil {
			pw.CloseWithError(err)
			return
		}
		pw.Close()
	}()

	tr := tar.NewReader(pr)
	synced := 0
	newHashes := make(map[string]string)
	const maxFiles = 10000

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err)
		}

		if header.Typeflag != tar.TypeReg {
			continue
		}

		if synced >= maxFiles {
			return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("too many files (max %d)", maxFiles))
		}

		filePath := header.Name
		if !validateSyncPath(syncDir, filePath) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid path: %s", filePath))
		}

		fullPath := filepath.Join(syncDir, filePath)
		os.MkdirAll(filepath.Dir(fullPath), 0o755)

		content, err := io.ReadAll(tr)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		if err := os.WriteFile(fullPath, content, 0o644); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		hash := sha256.Sum256(content)
		newHashes[filePath] = hex.EncodeToString(hash[:])
		synced++
	}

	state.mu.Lock()
	if state.manifestCache == nil {
		state.manifestCache = make(map[string]string)
	}
	for k, v := range newHashes {
		state.manifestCache[k] = v
	}

	deleted := int32(0)
	if state.pendingSync != nil {
		deleted = int32(cleanStaleFiles(syncDir, state.pendingSync))
		state.manifestCache = walkDir(syncDir, "")
	}
	state.mu.Unlock()

	return connect.NewResponse(&sidecarv1.SyncPushResponse{
		Synced:  int32(synced),
		Deleted: deleted,
	}), nil
}

func (h *syncServer) Refresh(ctx context.Context, req *connect.Request[sidecarv1.SyncRefreshRequest]) (*connect.Response[sidecarv1.SyncRefreshResponse], error) {
	entry := h.s.syncState.EntryPoint()
	if entry == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("no entry point configured - run sync first"))
	}

	url := fmt.Sprintf("http://localhost:%s/%s", h.s.cfg.Port, entry)
	if err := h.s.cdpClient.Navigate(url); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sidecarv1.SyncRefreshResponse{Ok: true}), nil
}

// --- Path validation and file helpers ---

func validateSyncPath(syncDir, filePath string) bool {
	if path.IsAbs(filePath) {
		return false
	}
	if strings.Contains(filePath, "..") {
		return false
	}
	if strings.HasPrefix(filePath, "_dz_") || strings.Contains(filePath, "/_dz_") {
		return false
	}
	resolved := filepath.Join(syncDir, filePath)
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return false
	}
	absSync, _ := filepath.Abs(syncDir)
	return strings.HasPrefix(abs, absSync+string(filepath.Separator)) || abs == absSync
}

func hashFile(filePath string) string {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return ""
	}
	h := sha256.Sum256(content)
	return hex.EncodeToString(h[:])
}

func walkDir(dir, base string) map[string]string {
	result := make(map[string]string)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return result
	}
	for _, entry := range entries {
		fullPath := filepath.Join(dir, entry.Name())
		relPath := entry.Name()
		if base != "" {
			relPath = base + "/" + entry.Name()
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.Mode()&os.ModeSymlink != 0 {
			continue
		}

		if entry.IsDir() {
			for k, v := range walkDir(fullPath, relPath) {
				result[k] = v
			}
		} else if entry.Type().IsRegular() {
			result[relPath] = hashFile(fullPath)
		}
	}
	return result
}

func cleanStaleFiles(syncDir string, manifest map[string]string) int {
	diskFiles := walkDir(syncDir, "")
	deleted := 0

	for filePath := range diskFiles {
		if _, ok := manifest[filePath]; !ok {
			fullPath := filepath.Join(syncDir, filePath)
			if err := os.Remove(fullPath); err == nil {
				deleted++
				dir := filepath.Dir(fullPath)
				for dir != syncDir && strings.HasPrefix(dir, syncDir) {
					entries, _ := os.ReadDir(dir)
					if len(entries) == 0 {
						os.Remove(dir)
						dir = filepath.Dir(dir)
					} else {
						break
					}
				}
			}
		}
	}
	return deleted
}
