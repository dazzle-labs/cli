package main

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/fsnotify/fsnotify"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

const (
	maxSyncSize  = 256 * 1024 * 1024 // 256MB
	maxFileCount = 10000
	chunkSize    = 256 * 1024 // 256KB
)

// SyncCmd syncs a local directory to a stage.
// This is the primary (and only) way to push content to a stage.
type SyncCmd struct {
	Dir     string `arg:"" help:"Local directory to sync (must contain an index.html entry point)." type:"existingdir"`
	Watch bool   `help:"Watch for file changes and automatically re-sync." short:"w"`
	Entry string `help:"HTML entry point file (default: index.html)." default:"index.html"`
}

func (c *SyncCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	// Run initial sync
	if err := c.syncOnce(ctx, context.Background()); err != nil {
		return err
	}

	if !c.Watch {
		return nil
	}

	// Watch mode
	return c.watchLoop(ctx)
}

func (c *SyncCmd) syncOnce(appCtx *Context, rpcCtx context.Context) error {
	// Walk directory and compute manifest (reads files once for both hash and tar)
	manifest, entries, totalSize, fileCount, err := walkAndHash(c.Dir)
	if err != nil {
		return fmt.Errorf("scanning directory: %w", err)
	}

	if fileCount > maxFileCount {
		return fmt.Errorf("directory contains %d files (max %d)", fileCount, maxFileCount)
	}
	if totalSize > maxSyncSize {
		return fmt.Errorf("directory is %dMB (max %dMB)", totalSize/(1024*1024), maxSyncSize/(1024*1024))
	}

	// Validate entry point
	if _, ok := manifest[c.Entry]; !ok {
		return fmt.Errorf("entry point %q not found in directory", c.Entry)
	}

	client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)

	// SyncDiff
	diffReq := connect.NewRequest(&apiv1.SyncDiffRequest{
		StageId: appCtx.StageID,
		Files:   manifest,
		Entry:   c.Entry,
	})
	diffReq.Header().Set("Authorization", appCtx.authHeader())
	diffResp, err := client.SyncDiff(rpcCtx, diffReq)
	if err != nil {
		return fmt.Errorf("sync diff: %w", err)
	}

	need := diffResp.Msg.Need

	// Build tar from cached file data (avoids TOCTOU)
	needSet := make(map[string]bool, len(need))
	for _, n := range need {
		needSet[n] = true
	}
	tarBuf, err := buildTar(entries, needSet)
	if err != nil {
		return fmt.Errorf("building tar: %w", err)
	}

	// SyncPush via client streaming — always send even if need is empty
	// so the server can run auto-cleanup with the sync_id
	stream := client.SyncPush(rpcCtx)
	stream.RequestHeader().Set("Authorization", appCtx.authHeader())

	tarData := tarBuf.Bytes()
	if len(tarData) == 0 {
		// Send a metadata-only message with stage_id
		if err := stream.Send(&apiv1.SyncPushRequest{
			StageId: appCtx.StageID,
		}); err != nil {
			return fmt.Errorf("sync push send: %w", err)
		}
	} else {
		for i := 0; i < len(tarData); i += chunkSize {
			end := i + chunkSize
			if end > len(tarData) {
				end = len(tarData)
			}
			msg := &apiv1.SyncPushRequest{Chunk: tarData[i:end]}
			if i == 0 {
				msg.StageId = appCtx.StageID
				}
			if err := stream.Send(msg); err != nil {
				return fmt.Errorf("sync push send: %w", err)
			}
		}
	}

	resp, err := stream.CloseAndReceive()
	if err != nil {
		return fmt.Errorf("sync push: %w", err)
	}

	if resp.Msg.Synced == 0 && resp.Msg.Deleted == 0 {
		printText("Already up to date.")
	} else {
		if resp.Msg.Synced > 0 {
			printText("%d files synced.", resp.Msg.Synced)
		}
		if resp.Msg.Deleted > 0 {
			printText("%d stale files removed.", resp.Msg.Deleted)
		}
	}

	return nil
}

func (c *SyncCmd) watchLoop(ctx *Context) error {
	sigCtx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("creating watcher: %w", err)
	}
	defer watcher.Close()

	// Add all directories recursively
	if err := addWatchDirs(watcher, c.Dir); err != nil {
		return fmt.Errorf("watching directory: %w", err)
	}

	printText("Watching %s for changes... (Ctrl-C to stop)", c.Dir)

	syncCount := 0
	lastFullRewalk := time.Now()
	// F8: use a channel-based debounce to avoid timer Stop/Reset races
	debounceCh := make(chan struct{}, 1)
	var debounceTimer *time.Timer

	for {
		select {
		case <-sigCtx.Done():
			printText("Stopped watching.")
			return nil

		case event, ok := <-watcher.Events:
			if !ok {
				return nil
			}
			// Watch for new directories
			if event.Has(fsnotify.Create) {
				if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
					_ = addWatchDirs(watcher, event.Name)
				}
			}
			// Create new timer each time (old one fires harmlessly into debounceCh)
			if debounceTimer != nil {
				debounceTimer.Stop()
			}
			debounceTimer = time.AfterFunc(200*time.Millisecond, func() {
				select {
				case debounceCh <- struct{}{}:
				default:
				}
			})

		case err, ok := <-watcher.Errors:
			if !ok {
				return nil
			}
			fmt.Fprintf(os.Stderr, "watch error: %v\n", err)

		case <-debounceCh:
			syncCount++

			// Safety net: every 10 syncs or 5 minutes, full re-walk + re-register watchers
			if syncCount%10 == 0 || time.Since(lastFullRewalk) > 5*time.Minute {
				_ = addWatchDirs(watcher, c.Dir)
				lastFullRewalk = time.Now()
			}

			if err := c.syncOnce(ctx, sigCtx); err != nil {
				fmt.Fprintf(os.Stderr, "sync error: %v\n", err)
			}
		}
	}
}

// fileEntry holds file content read once for both hashing and tar creation.
type fileEntry struct {
	relPath string
	data    []byte
	mode    os.FileMode
}

// walkAndHash walks a directory and returns the manifest, total size, file count,
// and cached file contents (to avoid TOCTOU between hash and tar).
// Skips symlinks to prevent infinite loops.
func walkAndHash(dir string) (manifest map[string]string, entries []fileEntry, totalSize int64, fileCount int, err error) {
	manifest = make(map[string]string)

	err = filepath.Walk(dir, func(fpath string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		// Skip symlinks to prevent infinite loops
		if info.Mode()&os.ModeSymlink != 0 {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if info.IsDir() {
			return nil
		}

		rel, relErr := filepath.Rel(dir, fpath)
		if relErr != nil {
			return relErr
		}
		// Normalize to forward slashes
		rel = filepath.ToSlash(rel)

		// Validate path
		if strings.Contains(rel, "..") {
			return fmt.Errorf("invalid path: %s", rel)
		}

		data, readErr := os.ReadFile(fpath)
		if readErr != nil {
			return readErr
		}

		hash := sha256.Sum256(data)
		manifest[rel] = hex.EncodeToString(hash[:])
		entries = append(entries, fileEntry{relPath: rel, data: data, mode: info.Mode()})
		totalSize += int64(len(data))
		fileCount++
		return nil
	})

	return manifest, entries, totalSize, fileCount, err
}

// buildTar creates a tar archive of the specified files using cached file data.
func buildTar(entries []fileEntry, needSet map[string]bool) (*bytes.Buffer, error) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	for _, entry := range entries {
		if !needSet[entry.relPath] {
			continue
		}

		header := &tar.Header{
			Name: entry.relPath,
			Size: int64(len(entry.data)),
			Mode: int64(entry.mode),
		}

		if err := tw.WriteHeader(header); err != nil {
			return nil, fmt.Errorf("tar header %s: %w", entry.relPath, err)
		}

		if _, err := tw.Write(entry.data); err != nil {
			return nil, fmt.Errorf("tar write %s: %w", entry.relPath, err)
		}
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("tar close: %w", err)
	}

	return &buf, nil
}

// addWatchDirs recursively adds all directories under root to the watcher.
// Skips symlinks to prevent infinite loops.
func addWatchDirs(watcher *fsnotify.Watcher, root string) error {
	return filepath.Walk(root, func(fpath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip errors
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return watcher.Add(fpath)
		}
		return nil
	})
}
