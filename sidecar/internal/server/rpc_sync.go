package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
	"github.com/browser-streamer/sidecar/syncutil"
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
		if !syncutil.ValidatePath(filePath) {
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("invalid path: %s", filePath))
		}
	}

	state.mu.Lock()
	defer state.mu.Unlock()

	if req.Msg.Entry != "" {
		if !syncutil.ValidatePath(req.Msg.Entry) {
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

	need := syncutil.DiffManifest(files, diskManifest)

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

	entries, err := syncutil.ExtractTar(pr, 10000)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	// Write extracted files to disk and compute hashes
	newHashes := make(map[string]string)
	for _, entry := range entries {
		fullPath := filepath.Join(syncDir, entry.Path)
		os.MkdirAll(filepath.Dir(fullPath), 0o755)

		if err := os.WriteFile(fullPath, entry.Data, 0o644); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}

		hash := sha256.Sum256(entry.Data)
		newHashes[entry.Path] = hex.EncodeToString(hash[:])
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
	entryPoint := state.entryPoint
	state.mu.Unlock()

	// Auto-refresh Chrome after every successful sync
	if entryPoint != "" && len(entries) > 0 {
		h.s.cdpClient.Navigate(h.s.cfg.ContentURL(entryPoint))
	}

	return connect.NewResponse(&sidecarv1.SyncPushResponse{
		Synced:  int32(len(entries)),
		Deleted: deleted,
	}), nil
}

func (h *syncServer) Refresh(ctx context.Context, req *connect.Request[sidecarv1.SyncRefreshRequest]) (*connect.Response[sidecarv1.SyncRefreshResponse], error) {
	entry := h.s.syncState.EntryPoint()
	if entry == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("no entry point configured - run sync first"))
	}

	url := h.s.cfg.ContentURL(entry)
	if err := h.s.cdpClient.Navigate(url); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sidecarv1.SyncRefreshResponse{Ok: true}), nil
}

// --- File helpers ---

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
