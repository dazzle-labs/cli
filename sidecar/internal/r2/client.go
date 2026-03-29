package r2

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func newClient(endpoint, accessKey, secretKey string) (*minio.Client, error) {
	// Strip https:// prefix for minio client
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")

	return minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: true,
	})
}

// Restore downloads all objects under prefix to localDir.
func Restore(endpoint, accessKey, secretKey, bucket, prefix, localDir string) error {
	client, err := newClient(endpoint, accessKey, secretKey)
	if err != nil {
		return fmt.Errorf("create R2 client: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	count := 0
	for obj := range client.ListObjects(ctx, bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if obj.Err != nil {
			return fmt.Errorf("list objects: %w", obj.Err)
		}

		// Only restore content/ and chrome localStorage/IndexedDB
		relPath := strings.TrimPrefix(obj.Key, prefix)
		if !isRestorablePath(relPath) {
			continue
		}

		// Prevent path traversal — ensure the resolved path stays within localDir.
		localPath := filepath.Join(localDir, relPath)
		if !strings.HasPrefix(filepath.Clean(localPath), filepath.Clean(localDir)+string(filepath.Separator)) {
			log.Printf("WARN: restore skip %s: path traversal detected", obj.Key)
			continue
		}
		os.MkdirAll(filepath.Dir(localPath), 0o755)

		reader, err := client.GetObject(ctx, bucket, obj.Key, minio.GetObjectOptions{})
		if err != nil {
			log.Printf("WARN: restore skip %s: %v", obj.Key, err)
			continue
		}

		f, err := os.Create(localPath)
		if err != nil {
			reader.Close()
			log.Printf("WARN: restore create %s: %v", localPath, err)
			continue
		}

		io.Copy(f, reader)
		f.Close()
		reader.Close()
		count++
	}

	if count > 0 {
		log.Printf("Restored %d files from R2", count)
	}
	return nil
}

func isRestorablePath(relPath string) bool {
	if strings.HasPrefix(relPath, "content/") {
		return true
	}
	// dazzle-render uses storage.json instead of Chrome's localStorage/IndexedDB
	if os.Getenv("RENDERER") == "native" {
		return relPath == "storage.json"
	}
	return strings.HasPrefix(relPath, "chrome/Default/Local Storage/") ||
		strings.HasPrefix(relPath, "chrome/Default/IndexedDB/")
}
