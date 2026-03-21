// Package syncutil provides shared sync primitives used by both the sidecar
// (disk-based sync) and the control-plane (R2-based sync).
package syncutil

import (
	"archive/tar"
	"fmt"
	"io"
	"path"
	"strings"
)

// ValidatePath checks that a relative file path is safe for sync operations.
// Rejects absolute paths, directory traversal, and reserved _dz_ prefixes.
func ValidatePath(filePath string) bool {
	if path.IsAbs(filePath) {
		return false
	}
	if strings.Contains(filePath, "..") {
		return false
	}
	if strings.HasPrefix(filePath, "_dz_") || strings.Contains(filePath, "/_dz_") {
		return false
	}
	cleaned := path.Clean(filePath)
	return cleaned != "." && cleaned != "" && !strings.HasPrefix(cleaned, "/")
}

// DiffManifest compares client file hashes against an existing manifest and
// returns the list of file paths that need uploading (missing or changed).
func DiffManifest(clientFiles, existing map[string]string) []string {
	var need []string
	for filePath, clientHash := range clientFiles {
		if existingHash, ok := existing[filePath]; !ok || existingHash != clientHash {
			need = append(need, filePath)
		}
	}
	return need
}

// FileEntry is a single file extracted from a tar stream.
type FileEntry struct {
	Path string
	Data []byte
}

// ExtractTar reads a tar stream and returns validated file entries.
// maxFiles limits the number of files (0 = no limit).
func ExtractTar(r io.Reader, maxFiles int) ([]FileEntry, error) {
	tr := tar.NewReader(r)
	var entries []FileEntry

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read tar: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}

		if maxFiles > 0 && len(entries) >= maxFiles {
			return nil, fmt.Errorf("too many files (max %d)", maxFiles)
		}

		if !ValidatePath(header.Name) {
			return nil, fmt.Errorf("invalid path: %s", header.Name)
		}

		data, err := io.ReadAll(tr)
		if err != nil {
			return nil, fmt.Errorf("read tar entry %s: %w", header.Name, err)
		}

		entries = append(entries, FileEntry{Path: header.Name, Data: data})
	}

	return entries, nil
}
