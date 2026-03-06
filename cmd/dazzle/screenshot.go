package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// ScreenshotCmd captures a screenshot of the active stage.
type ScreenshotCmd struct {
	Out       string `help:"Output file path (default: temp file)." short:"o"`
}

func (c *ScreenshotCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.ScreenshotRequest{
		StageId: ctx.StageID,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.Screenshot(context.Background(), req)
	if err != nil {
		return err
	}

	var path string
	if c.Out != "" {
		path = c.Out
	} else {
		f, err := os.CreateTemp("", "dazzle-screenshot-*.png")
		if err != nil {
			return fmt.Errorf("create temp file: %w", err)
		}
		path = f.Name()
		f.Close()
	}

	if err := os.WriteFile(path, resp.Msg.Image, 0644); err != nil {
		return fmt.Errorf("write screenshot: %w", err)
	}

	if ctx.JSON {
		printJSON(map[string]any{
			"path":  path,
			"bytes": len(resp.Msg.Image),
			"image": base64.StdEncoding.EncodeToString(resp.Msg.Image),
		})
	} else {
		printText("%s", path)
	}
	return nil
}
