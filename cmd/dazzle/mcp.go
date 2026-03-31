package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// McpCmd starts an MCP server on stdin/stdout for AI agent integration.
type McpCmd struct{}

func (c *McpCmd) Run(appCtx *Context) error {
	if err := appCtx.requireAuth(); err != nil {
		return err
	}

	// stdout is the MCP transport — all diagnostic output must go to stderr.
	log.SetOutput(os.Stderr)

	s := mcp.NewServer(&mcp.Implementation{
		Name:    "dazzle",
		Version: version,
	}, nil)

	registerTools(s, appCtx)
	registerResources(s)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	return s.Run(ctx, &mcp.StdioTransport{})
}

// registerResources adds MCP resources (read-only content).
func registerResources(s *mcp.Server) {
	s.AddResource(&mcp.Resource{
		URI:         "dazzle://guide",
		Name:        "content-guide",
		Description: "Content authoring guide — rendering tiers, performance tips, design best practices for 720p streaming.",
		MIMEType:    "text/markdown",
	}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		// Try fetching latest from server; fall back to embedded text.
		text := guideText
		httpClient := &http.Client{Timeout: 3 * time.Second}
		resp, err := httpClient.Get(guideURL)
		if err == nil && resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			if body, err := io.ReadAll(resp.Body); err == nil && len(body) > 0 {
				text = string(body)
			}
		}
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{{
				URI:      "dazzle://guide",
				MIMEType: "text/markdown",
				Text:     fmt.Sprintf("%s", text),
			}},
		}, nil
	})
}
