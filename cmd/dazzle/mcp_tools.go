package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type dazzleInput struct {
	Args []string `json:"args" jsonschema:"required,CLI arguments (e.g. [\"stage\" \"list\"] or [\"--help\"]). The --json flag is added automatically."`
}

type screenshotInput struct {
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type writeFileInput struct {
	Stage   string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
	Path    string `json:"path" jsonschema:"required,Relative file path within the stage workspace (e.g. index.html or css/style.css). Must not contain '..'."`
	Content string `json:"content" jsonschema:"required,File content to write (UTF-8 text)."`
}

type readFileInput struct {
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
	Path  string `json:"path" jsonschema:"required,Relative file path within the stage workspace."`
}

type editFileInput struct {
	Stage     string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
	Path      string `json:"path" jsonschema:"required,Relative file path within the stage workspace."`
	OldString string `json:"old_string" jsonschema:"required,The exact text to find and replace. Must match uniquely in the file."`
	NewString string `json:"new_string" jsonschema:"required,The replacement text."`
}

type listFilesInput struct {
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type syncInput struct {
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

// stageWorkspaceDir returns ~/.dazzle/stages/<stage-id>/, creating it if needed.
// Uses stage ID (not name) as the directory name since IDs are unique and filesystem-safe.
func stageWorkspaceDir(appCtx *Context, stageNameOrID string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("get home dir: %w", err)
	}

	stageID, err := resolveStageForMCP(appCtx, stageNameOrID)
	if err != nil {
		return "", err
	}

	dir := filepath.Join(home, ".dazzle", "stages", stageID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("create workspace dir: %w", err)
	}
	return dir, nil
}

// validateRelPath checks that a relative path is safe (no traversal, not absolute).
func validateRelPath(relPath string) error {
	if relPath == "" {
		return fmt.Errorf("path is required")
	}
	if filepath.IsAbs(relPath) {
		return fmt.Errorf("path must be relative, got %q", relPath)
	}
	cleaned := filepath.Clean(relPath)
	if strings.HasPrefix(cleaned, "..") || strings.Contains(cleaned, string(filepath.Separator)+"..") {
		return fmt.Errorf("path must not contain '..': %q", relPath)
	}
	return nil
}

// resolveStageForMCP resolves the stage ID from the MCP tool input, falling back
// to appCtx resolution. Always sets appCtx.StageID on success.
func resolveStageForMCP(appCtx *Context, stageNameOrID string) (string, error) {
	if stageNameOrID != "" {
		id, err := resolveStageByNameOrID(appCtx, stageNameOrID)
		if err != nil {
			return "", err
		}
		appCtx.StageID = id
		return id, nil
	}
	if err := appCtx.resolveStage(); err != nil {
		return "", err
	}
	return appCtx.StageID, nil
}

func registerTools(s *mcp.Server, appCtx *Context) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "cli",
		Description: "Run a dazzle CLI command. Use [\"--help\"] to discover available commands. Output is JSON.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in dazzleInput) (*mcp.CallToolResult, any, error) {
		exe, err := os.Executable()
		if err != nil {
			return nil, nil, fmt.Errorf("resolve executable: %w", err)
		}

		args := append(in.Args, "--json")
		cmd := exec.CommandContext(ctx, exe, args...)
		cmd.Env = os.Environ()

		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr

		err = cmd.Run()

		// Prefer stdout (JSON output). Fall back to stderr for errors.
		output := stdout.String()
		if output == "" {
			output = stderr.String()
		}
		if output == "" && err != nil {
			output = err.Error()
		}

		if err != nil {
			r := &mcp.CallToolResult{IsError: true}
			r.Content = []mcp.Content{&mcp.TextContent{Text: output}}
			return r, nil, nil
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: output}},
		}, nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "screenshot",
		Description: "Capture a screenshot of the stage's current browser output. Returns a PNG image.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in screenshotInput) (*mcp.CallToolResult, any, error) {
		stageID := in.Stage
		if stageID == "" {
			if err := appCtx.resolveStage(); err != nil {
				return nil, nil, err
			}
			stageID = appCtx.StageID
		} else {
			id, err := resolveStageByNameOrID(appCtx, stageID)
			if err != nil {
				return nil, nil, err
			}
			stageID = id
		}

		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.ScreenshotRequest{StageId: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.Screenshot(ctx, r)
		if err != nil {
			return nil, nil, err
		}

		// Re-encode PNG→JPEG to reduce payload size (~300KB PNG → ~60KB JPEG).
		imgData, mimeType, encErr := pngToJPEG(resp.Msg.Image, 80)
		if encErr != nil {
			// Fall back to original PNG if conversion fails.
			imgData = resp.Msg.Image
			mimeType = "image/png"
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.ImageContent{
					Data:     imgData,
					MIMEType: mimeType,
				},
			},
		}, nil, nil
	})

	// --- Workspace file tools ---
	// These tools provide read/write access to ~/.dazzle/stages/{stage}/,
	// a host-local workspace that bridges sandboxed environments (e.g. Claude Desktop)
	// with the dazzle CLI's filesystem. Less powerful than full shell access,
	// but works when the agent's bash runs in a sandbox.

	mcp.AddTool(s, &mcp.Tool{
		Name:        "write_file",
		Description: "Write a file to the stage workspace (~/.dazzle/stages/{stage}/{path}). Creates parent directories as needed. Use this to build up content that can then be synced to the stage.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in writeFileInput) (*mcp.CallToolResult, any, error) {
		if err := validateRelPath(in.Path); err != nil {
			return nil, nil, err
		}

		wsDir, err := stageWorkspaceDir(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}

		absPath := filepath.Join(wsDir, filepath.FromSlash(in.Path))

		// Ensure parent directory exists.
		if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
			return nil, nil, fmt.Errorf("create parent dir: %w", err)
		}

		if err := os.WriteFile(absPath, []byte(in.Content), 0644); err != nil {
			return nil, nil, fmt.Errorf("write file: %w", err)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("wrote %s (%d bytes) → %s", in.Path, len(in.Content), absPath)}},
		}, nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "read_file",
		Description: "Read a file from the stage workspace (~/.dazzle/stages/{stage}/{path}).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in readFileInput) (*mcp.CallToolResult, any, error) {
		if err := validateRelPath(in.Path); err != nil {
			return nil, nil, err
		}

		wsDir, err := stageWorkspaceDir(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}

		absPath := filepath.Join(wsDir, filepath.FromSlash(in.Path))
		data, err := os.ReadFile(absPath)
		if err != nil {
			return nil, nil, fmt.Errorf("read file: %w", err)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
		}, nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "edit_file",
		Description: "Edit a file in the stage workspace by exact string replacement. The old_string must match exactly once in the file. Use read_file first to see the current content.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in editFileInput) (*mcp.CallToolResult, any, error) {
		if err := validateRelPath(in.Path); err != nil {
			return nil, nil, err
		}
		if in.OldString == in.NewString {
			return nil, nil, fmt.Errorf("old_string and new_string are identical")
		}

		wsDir, err := stageWorkspaceDir(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}

		absPath := filepath.Join(wsDir, filepath.FromSlash(in.Path))
		data, err := os.ReadFile(absPath)
		if err != nil {
			return nil, nil, fmt.Errorf("read file: %w", err)
		}

		content := string(data)
		count := strings.Count(content, in.OldString)
		if count == 0 {
			return nil, nil, fmt.Errorf("old_string not found in %s", in.Path)
		}
		if count > 1 {
			return nil, nil, fmt.Errorf("old_string matches %d times in %s — must be unique", count, in.Path)
		}

		newContent := strings.Replace(content, in.OldString, in.NewString, 1)
		if err := os.WriteFile(absPath, []byte(newContent), 0644); err != nil {
			return nil, nil, fmt.Errorf("write file: %w", err)
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("edited %s → %s", in.Path, absPath)}},
		}, nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_files",
		Description: "List all files in the stage workspace (~/.dazzle/stages/{stage}/). Returns relative paths, one per line.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in listFilesInput) (*mcp.CallToolResult, any, error) {
		wsDir, err := stageWorkspaceDir(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}

		var files []string
		err = filepath.Walk(wsDir, func(fpath string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				return nil
			}
			rel, relErr := filepath.Rel(wsDir, fpath)
			if relErr != nil {
				return relErr
			}
			files = append(files, filepath.ToSlash(rel))
			return nil
		})
		if err != nil {
			return nil, nil, fmt.Errorf("list files: %w", err)
		}

		if len(files) == 0 {
			return &mcp.CallToolResult{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("(empty workspace: %s)", wsDir)}},
			}, nil, nil
		}

		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("workspace: %s\n%s", wsDir, strings.Join(files, "\n"))}},
		}, nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "sync",
		Description: "Sync the stage workspace (~/.dazzle/stages/{stage}/) to the live stage. Run this after writing files to push content. Equivalent to 'dazzle stage sync {workspace-dir}'.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in syncInput) (*mcp.CallToolResult, any, error) {
		// stageWorkspaceDir resolves the stage and sets appCtx.StageID.
		wsDir, err := stageWorkspaceDir(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}

		result, err := syncDir(appCtx, ctx, wsDir, "index.html")
		if err != nil {
			return nil, nil, fmt.Errorf("sync: %w", err)
		}

		out, _ := json.Marshal(result)
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(out)}},
		}, nil, nil
	})

	type emptyInput struct{}

	mcp.AddTool(s, &mcp.Tool{
		Name:        "guide",
		Description: "Get the Dazzle quick-start guide — platform overview, setup, CLI basics, and links to full docs. Read this first before creating or modifying stage content.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in emptyInput) (*mcp.CallToolResult, any, error) {
		httpClient := &http.Client{Timeout: 10 * time.Second}
		resp, err := httpClient.Get("https://dazzle.fm/llms.txt")
		if err != nil {
			return nil, nil, fmt.Errorf("fetch guide: %w", err)
		}
		defer resp.Body.Close() //nolint:errcheck
		if resp.StatusCode != http.StatusOK {
			return nil, nil, fmt.Errorf("fetch guide: HTTP %d", resp.StatusCode)
		}
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, nil, fmt.Errorf("read guide: %w", err)
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: string(body)}},
		}, nil, nil
	})
}

// pngToJPEG re-encodes PNG bytes as JPEG at the given quality (1-100).
func pngToJPEG(pngData []byte, quality int) ([]byte, string, error) {
	img, err := png.Decode(bytes.NewReader(pngData))
	if err != nil {
		return nil, "", err
	}

	// Draw onto opaque background (JPEG has no alpha).
	bounds := img.Bounds()
	opaque := image.NewRGBA(bounds)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			opaque.Set(x, y, img.At(x, y))
		}
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, opaque, &jpeg.Options{Quality: quality}); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/jpeg", nil
}
