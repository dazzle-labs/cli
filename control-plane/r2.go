package main

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

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
