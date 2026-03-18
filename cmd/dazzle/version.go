package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// version is set at build time via -X main.version=<tag>.
var version = "dev"

// VersionCmd handles `dazzle version`.
type VersionCmd struct{}

func (c *VersionCmd) Run(ctx *Context) error {
	if ctx.JSON {
		printJSON(VersionResponse{Version: version, OS: runtime.GOOS, Arch: runtime.GOARCH})
	} else {
		printText("dazzle %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
	}
	return nil
}

// UpdateCmd handles `dazzle update`.
type UpdateCmd struct{}

func (c *UpdateCmd) Run(ctx *Context) error {
	if !ctx.JSON {
		printText("Checking for updates...")
	}

	latest, err := fetchLatestTag()
	if err != nil {
		return fmt.Errorf("fetch latest release: %w", err)
	}

	if strings.TrimPrefix(latest, "v") == strings.TrimPrefix(version, "v") {
		if ctx.JSON {
			printJSON(UpdateResponse{OK: true, Version: version, Updated: false})
			return nil
		}
		printText("Already up to date (%s).", version)
		return nil
	}

	if !ctx.JSON {
		printText("Updating %s → %s...", version, latest)
	}

	if err := downloadAndReplace(latest); err != nil {
		return fmt.Errorf("update failed: %w", err)
	}

	if ctx.JSON {
		printJSON(UpdateResponse{OK: true, Version: latest, Updated: true, Previous: version})
		return nil
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

	if resp.StatusCode != http.StatusOK {
		if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
			return "", fmt.Errorf("GitHub API rate limit exceeded; try again later")
		}
		return "", fmt.Errorf("GitHub API returned HTTP %d", resp.StatusCode)
	}

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

const updateCheckInterval = 4 * time.Hour

type updateState struct {
	LastCheck    time.Time `json:"last_check"`
	WarnedTag   string    `json:"warned_tag"`
	LatestTag   string    `json:"latest_tag"`
}

func loadUpdateState() (*updateState, error) {
	dir, err := dazzleConfigDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		return &updateState{}, nil
	}
	var s updateState
	if err := json.Unmarshal(data, &s); err != nil {
		return &updateState{}, nil
	}
	return &s, nil
}

func saveUpdateState(s *updateState) {
	dir, err := dazzleConfigDir()
	if err != nil {
		return
	}
	data, _ := json.Marshal(s)
	_ = os.WriteFile(filepath.Join(dir, "state.json"), data, 0600)
}

// checkForUpdate prints a warning to stderr if a newer version is available.
// Checks GitHub every few hours. Once the user has seen the warning for a
// given version, it won't nag again until a newer release drops.
func checkForUpdate() {
	if version == "dev" {
		return
	}

	state, _ := loadUpdateState()
	now := time.Now()

	// Fetch from GitHub periodically
	if now.Sub(state.LastCheck) >= updateCheckInterval || state.LatestTag == "" {
		latest, err := fetchLatestTag()
		if err != nil {
			return
		}
		state.LastCheck = now
		state.LatestTag = latest
	}

	// Only warn if outdated AND we haven't already warned about this specific version
	if stripV(state.LatestTag) != stripV(version) && state.WarnedTag != state.LatestTag {
		printUpdateWarning(state.LatestTag)
		state.WarnedTag = state.LatestTag
	}

	saveUpdateState(state)
}

func stripV(s string) string {
	return strings.TrimPrefix(s, "v")
}

func printUpdateWarning(latest string) {
	fmt.Fprintf(os.Stderr, "\nUpdate available: %s → %s — run 'dazzle update'\n", version, latest)
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
