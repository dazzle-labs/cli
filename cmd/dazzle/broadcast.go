package main

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// BroadcastCmd groups broadcast subcommands.
type BroadcastCmd struct {
	On       BroadcastStartCmd    `cmd:"" aliases:"start" help:"Start broadcasting to the configured destination."`
	Off      BroadcastStopCmd     `cmd:"" aliases:"stop" help:"Stop the broadcast."`
	Status   BroadcastStatusCmd   `cmd:"" aliases:"st" help:"Check broadcast status."`
	Info     BroadcastInfoCmd     `cmd:"" help:"Get current stream title and category."`
	Title    BroadcastTitleCmd    `cmd:"" help:"Set the stream title (not supported for Restream)."`
	Category BroadcastCategoryCmd `cmd:"" help:"Set the stream category or game (not supported for Restream)."`
}

// BroadcastStartCmd starts broadcasting on the active stage.
type BroadcastStartCmd struct{}

func (c *BroadcastStartCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.StartBroadcastRequest{StageId: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := client.StartBroadcast(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]bool{"ok": true})
		return nil
	}

	printText("Broadcast started")
	return nil
}

// BroadcastStopCmd stops broadcasting on the active stage.
type BroadcastStopCmd struct{}

func (c *BroadcastStopCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.StopBroadcastRequest{StageId: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := client.StopBroadcast(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]bool{"ok": true})
		return nil
	}

	printText("Broadcast stopped")
	return nil
}

// BroadcastStatusCmd shows broadcast status on the active stage.
type BroadcastStatusCmd struct{}

func (c *BroadcastStatusCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetStageStatsRequest{StageId: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetStageStats(context.Background(), req)
	if err != nil {
		return err
	}

	s := resp.Msg
	if ctx.JSON {
		printJSON(map[string]any{
			"active": s.Broadcasting,
			"fps":    s.BroadcastFps,
		})
		return nil
	}

	if s.Broadcasting {
		printText("Broadcast: active (fps=%.1f)", s.BroadcastFps)
	} else {
		printText("Broadcast: inactive")
	}
	return nil
}

// BroadcastInfoCmd gets the current stream title and category from the connected platform.
type BroadcastInfoCmd struct{}

func (c *BroadcastInfoCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetStreamInfoRequest{StageId: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetStreamInfo(context.Background(), req)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeUnimplemented {
			if ctx.JSON {
				printJSON(map[string]any{"ok": false, "error": "bc info is not supported for this platform"})
				return nil
			}
			printText("Error: bc info is not supported for this platform.")
			return nil
		}
		return err
	}

	if ctx.JSON {
		printJSON(struct {
			Title    string `json:"title"`
			Category string `json:"category"`
			Platform string `json:"platform"`
		}{resp.Msg.Title, resp.Msg.Category, resp.Msg.Platform})
		return nil
	}

	title := resp.Msg.Title
	if title == "" {
		title = "(not set)"
	}
	printText("Title: %s", title)
	if resp.Msg.Category != "" {
		printText("Category: %s", resp.Msg.Category)
	}
	printText("Platform: %s", resp.Msg.Platform)
	return nil
}

// BroadcastTitleCmd sets the stream title on the connected platform.
type BroadcastTitleCmd struct {
	Title string `arg:"" help:"New stream title (quote multi-word titles)."`
}

func (c *BroadcastTitleCmd) Run(ctx *Context) error {
	if strings.TrimSpace(c.Title) == "" {
		return fmt.Errorf("title cannot be empty")
	}
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SetStreamTitleRequest{StageId: ctx.StageID, Title: c.Title})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err := client.SetStreamTitle(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(struct {
			Title string `json:"title"`
		}{c.Title})
		return nil
	}

	printText("Title updated: %s", c.Title)
	return nil
}

// BroadcastCategoryCmd sets the stream category on the connected platform.
type BroadcastCategoryCmd struct {
	Category string `arg:"" help:"New stream category or game (quote multi-word values)."`
}

func (c *BroadcastCategoryCmd) Run(ctx *Context) error {
	if strings.TrimSpace(c.Category) == "" {
		return fmt.Errorf("category cannot be empty")
	}
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SetStreamCategoryRequest{StageId: ctx.StageID, Category: c.Category})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err := client.SetStreamCategory(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(struct {
			Category string `json:"category"`
		}{c.Category})
		return nil
	}

	printText("Category updated: %s", c.Category)
	return nil
}
