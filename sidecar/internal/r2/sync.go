package r2

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/minio/minio-go/v7"
)

type Syncer struct {
	client   *minio.Client
	bucket   string
	prefix   string
	localDir string

	mu       sync.Mutex
	dirty    bool
	shutdown bool
	done     chan struct{}
}

func NewSyncer(endpoint, accessKey, secretKey, bucket, prefix, localDir string) (*Syncer, error) {
	client, err := newClient(endpoint, accessKey, secretKey)
	if err != nil {
		return nil, err
	}
	return &Syncer{
		client:   client,
		bucket:   bucket,
		prefix:   prefix,
		localDir: localDir,
		done:     make(chan struct{}),
	}, nil
}

// Watch monitors /data/ for changes and syncs to R2 with debouncing.
func (s *Syncer) Watch() {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		log.Printf("WARN: fsnotify watcher failed: %v (R2 sync disabled)", err)
		return
	}
	defer watcher.Close()

	// Watch key directories.
	// When RENDERER=dazzle-render, watch storage.json instead of Chrome's
	// localStorage/IndexedDB dirs.
	dirs := []string{
		filepath.Join(s.localDir, "content"),
	}
	if os.Getenv("RENDERER") == "native" {
		// dazzle-render uses a single storage.json file
		storageDir := s.localDir // storage.json lives at $DATA_DIR/storage.json
		dirs = append(dirs, storageDir)
	} else {
		dirs = append(dirs,
			filepath.Join(s.localDir, "chrome", "Default", "Local Storage"),
			filepath.Join(s.localDir, "chrome", "Default", "IndexedDB"),
		)
	}
	for _, dir := range dirs {
		os.MkdirAll(dir, 0o755)
		watcher.Add(dir)
		// Also watch subdirectories
		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err == nil && info.IsDir() {
				watcher.Add(path)
			}
			return nil
		})
	}

	debounce := time.NewTimer(10 * time.Second)
	debounce.Stop()

	for {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			_ = event
			s.mu.Lock()
			s.dirty = true
			s.mu.Unlock()
			debounce.Reset(10 * time.Second)

		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			log.Printf("WARN: fsnotify error: %v", err)

		case <-debounce.C:
			s.doSync()

		case <-s.done:
			return
		}
	}
}

func (s *Syncer) doSync() {
	s.mu.Lock()
	if !s.dirty {
		s.mu.Unlock()
		return
	}
	s.dirty = false
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	if err := s.syncToR2(ctx); err != nil {
		log.Printf("WARN: R2 sync failed: %v", err)
	}
}

// FinalSync performs a final sync before shutdown.
func (s *Syncer) FinalSync() {
	log.Println("R2: performing final sync...")
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := s.syncToR2(ctx); err != nil {
		log.Printf("WARN: R2 final sync failed: %v", err)
	}
	close(s.done)
}

func (s *Syncer) syncToR2(ctx context.Context) error {
	// Walk local directories and upload
	count := 0
	err := filepath.Walk(s.localDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		relPath, _ := filepath.Rel(s.localDir, path)
		if !isRestorablePath(relPath) {
			return nil
		}

		objectKey := s.prefix + relPath
		_, err = s.client.FPutObject(ctx, s.bucket, objectKey, path, minio.PutObjectOptions{})
		if err != nil {
			return fmt.Errorf("upload %s: %w", relPath, err)
		}
		count++
		return nil
	})

	if count > 0 {
		log.Printf("R2: synced %d files", count)
	}

	// Clean up remote objects that no longer exist locally
	for obj := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:    s.prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			continue
		}
		relPath := strings.TrimPrefix(obj.Key, s.prefix)
		localPath := filepath.Join(s.localDir, relPath)
		if _, statErr := os.Stat(localPath); os.IsNotExist(statErr) {
			s.client.RemoveObject(ctx, s.bucket, obj.Key, minio.RemoveObjectOptions{})
		}
	}

	return err
}
