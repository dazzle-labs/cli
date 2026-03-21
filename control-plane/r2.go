package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"time"

	"github.com/browser-streamer/sidecar/syncutil"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kerrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/client-go/kubernetes"
)

type R2Client struct {
	client *minio.Client
	bucket string
}

func NewR2Client(endpoint, accessKeyID, secretAccessKey, bucket string) (*R2Client, error) {
	// Strip https:// prefix if present — minio-go wants just the host
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")

	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKeyID, secretAccessKey, ""),
		Secure: true,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}

	return &R2Client{client: client, bucket: bucket}, nil
}

// DeletePrefix removes all objects under the given prefix (best-effort).
func (r *R2Client) DeletePrefix(ctx context.Context, prefix string) error {
	objectsCh := r.client.ListObjects(ctx, r.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	})

	var lastErr error
	for obj := range objectsCh {
		if obj.Err != nil {
			lastErr = obj.Err
			log.Printf("WARN: r2 list objects: %v", obj.Err)
			continue
		}
		if err := r.client.RemoveObject(ctx, r.bucket, obj.Key, minio.RemoveObjectOptions{}); err != nil {
			lastErr = err
			log.Printf("WARN: r2 remove %s: %v", obj.Key, err)
		}
	}

	if lastErr != nil {
		log.Printf("WARN: r2 delete prefix %s completed with errors", prefix)
	}
	return nil // best-effort — always return nil
}

// stageContentPrefix returns the R2 key prefix for a stage's synced content.
func stageContentPrefix(userID, stageID string) string {
	return fmt.Sprintf("users/%s/stages/%s/content/sync/", userID, stageID)
}

// stageManifestKey returns the R2 key for a stage's content manifest.
func stageManifestKey(userID, stageID string) string {
	return fmt.Sprintf("users/%s/stages/%s/manifest.json", userID, stageID)
}

// GetContentManifest reads the SHA256 manifest for a stage's content from R2.
// Returns nil map (not error) if no manifest exists yet.
func (r *R2Client) GetContentManifest(ctx context.Context, userID, stageID string) (map[string]string, error) {
	key := stageManifestKey(userID, stageID)
	obj, err := r.client.GetObject(ctx, r.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, nil // treat as empty
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		// NoSuchKey means no manifest yet
		return nil, nil
	}

	var manifest map[string]string
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, nil // corrupted manifest, treat as empty
	}
	return manifest, nil
}

// putContentManifest writes the SHA256 manifest for a stage's content to R2.
func (r *R2Client) putContentManifest(ctx context.Context, userID, stageID string, manifest map[string]string) error {
	data, err := json.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	key := stageManifestKey(userID, stageID)
	_, err = r.client.PutObject(ctx, r.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: "application/json",
	})
	return err
}

// ContentDiff compares client file hashes against the R2 manifest and returns files that need uploading.
func (r *R2Client) ContentDiff(ctx context.Context, userID, stageID string, clientFiles map[string]string) ([]string, error) {
	manifest, err := r.GetContentManifest(ctx, userID, stageID)
	if err != nil {
		return nil, err
	}
	if manifest == nil {
		manifest = map[string]string{}
	}

	return syncutil.DiffManifest(clientFiles, manifest), nil
}

// ContentPushFromTar reads a tar stream, uploads each file to R2, cleans stale files,
// and writes the manifest. clientManifest is the full set of files the client has
// (path → sha256); it's used for stale cleanup and becomes the new R2 manifest.
func (r *R2Client) ContentPushFromTar(ctx context.Context, userID, stageID string, tarReader io.Reader, clientManifest map[string]string) (synced int32, deleted int32, err error) {
	prefix := stageContentPrefix(userID, stageID)

	entries, err := syncutil.ExtractTar(tarReader, 10000)
	if err != nil {
		return 0, 0, err
	}

	for _, entry := range entries {
		objectKey := prefix + entry.Path
		_, putErr := r.client.PutObject(ctx, r.bucket, objectKey, bytes.NewReader(entry.Data), int64(len(entry.Data)), minio.PutObjectOptions{})
		if putErr != nil {
			return 0, 0, fmt.Errorf("upload %s: %w", entry.Path, putErr)
		}
		synced++
	}

	// Delete stale files from R2 (files in R2 but not in the client manifest)
	if clientManifest != nil {
		for obj := range r.client.ListObjects(ctx, r.bucket, minio.ListObjectsOptions{
			Prefix:    prefix,
			Recursive: true,
		}) {
			if obj.Err != nil {
				continue
			}
			relPath := strings.TrimPrefix(obj.Key, prefix)
			if _, ok := clientManifest[relPath]; !ok {
				r.client.RemoveObject(ctx, r.bucket, obj.Key, minio.RemoveObjectOptions{})
				deleted++
			}
		}

		// Write the client's manifest as the new R2 manifest
		if err := r.putContentManifest(ctx, userID, stageID, clientManifest); err != nil {
			log.Printf("WARN: failed to write R2 manifest: %v", err)
		}
	}

	return synced, deleted, nil
}

// waitForPodTermination polls until the named pod no longer exists or timeout expires.
func waitForPodTermination(ctx context.Context, clientset *kubernetes.Clientset, namespace, podName string, timeout time.Duration) {
	deadline := time.After(timeout)
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-deadline:
			log.Printf("WARN: timeout waiting for pod %s to terminate", podName)
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := clientset.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
			if err != nil && kerrors.IsNotFound(err) {
				return
			}
		}
	}
}
