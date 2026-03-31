package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"

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

		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.ImageContent{
					Data:     []byte(base64.StdEncoding.EncodeToString(resp.Msg.Image)),
					MIMEType: "image/png",
				},
			},
		}, nil, nil
	})
}
