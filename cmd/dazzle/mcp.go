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
	// Don't require auth at startup — the agent may need to call `guide` or
	// `cli ["login"]` before credentials exist. Tools that need auth will
	// fail with a clear error message when invoked.

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

const llmsFullURL = "https://dazzle.fm/llms-full.txt"

// registerResources adds MCP resources (read-only content).
func registerResources(s *mcp.Server) {
	s.AddResource(&mcp.Resource{
		URI:         "dazzle://llms-full",
		Name:        "llms-full",
		Description: "Complete Dazzle reference — getting started, CLI help, and content authoring guide.",
		MIMEType:    "text/markdown",
	}, func(ctx context.Context, req *mcp.ReadResourceRequest) (*mcp.ReadResourceResult, error) {
		httpClient := &http.Client{Timeout: 5 * time.Second}
		resp, err := httpClient.Get(llmsFullURL)
		if err != nil {
			return nil, fmt.Errorf("fetch llms-full.txt: %w", err)
		}
		defer resp.Body.Close() //nolint:errcheck
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("fetch llms-full.txt: HTTP %d", resp.StatusCode)
		}
		body, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, fmt.Errorf("read llms-full.txt: %w", err)
		}
		return &mcp.ReadResourceResult{
			Contents: []*mcp.ResourceContents{{
				URI:      "dazzle://llms-full",
				MIMEType: "text/markdown",
				Text:     string(body),
			}},
		}, nil
	})
}
