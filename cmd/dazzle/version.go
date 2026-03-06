package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
)

// version is set at build time via -X main.version=<tag>.
var version = "dev"

// VersionCmd handles `dazzle version`.
type VersionCmd struct{}

func (c *VersionCmd) Run(ctx *Context) error {
	if ctx.JSON {
		printJSON(map[string]string{"version": version, "os": runtime.GOOS, "arch": runtime.GOARCH})
	} else {
		printText("dazzle %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
	}
	return nil
}

// UpdateCmd handles `dazzle update`.
type UpdateCmd struct{}

func (c *UpdateCmd) Run(ctx *Context) error {
	printText("Checking for updates...")

	latest, err := fetchLatestTag()
	if err != nil {
		return fmt.Errorf("fetch latest release: %w", err)
	}

	if strings.TrimPrefix(latest, "v") == strings.TrimPrefix(version, "v") {
		printText("Already up to date (%s).", version)
		return nil
	}

	printText("Updating %s → %s...", version, latest)

	if err := downloadAndReplace(latest); err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	printText("Updated to %s. Run 'dazzle version' to confirm.", latest)
	return nil
}

func fetchLatestTag() (string, error) {
	resp, err := http.Get("https://api.github.com/repos/dazzle-labs/cli/releases/latest")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return "", err
	}
	if release.TagName == "" {
		return "", fmt.Errorf("no releases found")
	}
	return release.TagName, nil
}

func downloadAndReplace(tag string) error {
	os_ := runtime.GOOS
	if os_ == "windows" {
		return fmt.Errorf("self-update on Windows is not supported — download from https://github.com/dazzle-labs/cli/releases")
	}

	osName := strings.Title(os_) //nolint:staticcheck
	archName := runtime.GOARCH
	if archName == "amd64" {
		archName = "x86_64"
	}

	url := fmt.Sprintf(
		"https://github.com/dazzle-labs/cli/releases/download/%s/dazzle_%s_%s",
		tag, osName, archName,
	)

	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}

	binData, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	exe, err := os.Executable()
	if err != nil {
		return err
	}

	tmp := exe + ".new"
	if err := os.WriteFile(tmp, binData, 0755); err != nil {
		return err
	}
	return os.Rename(tmp, exe)
}
