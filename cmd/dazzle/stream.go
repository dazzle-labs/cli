package main

import (
	"context"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// StreamCmd groups broadcast subcommands.
type StreamCmd struct {
	On       StreamStartCmd    `cmd:"" aliases:"start" help:"Start broadcasting to the configured destination."`
	Off      StreamStopCmd     `cmd:"" aliases:"stop" help:"Stop the broadcast."`
	Status   StreamStatusCmd   `cmd:"" aliases:"st" help:"Check broadcast status."`
	Info     StreamInfoCmd     `cmd:"" help:"Get current stream title and category."`
	Title    StreamTitleCmd    `cmd:"" help:"Set the stream title (not supported for Restream)."`
	Category StreamCategoryCmd `cmd:"" help:"Set the stream category or game (not supported for Restream)."`
}

// StreamStartCmd starts broadcasting on the active stage.
type StreamStartCmd struct{}

func (c *StreamStartCmd) Run(ctx *Context) error {
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

	printText("Broadcast started")
	return nil
}

// StreamStopCmd stops broadcasting on the active stage.
type StreamStopCmd struct{}

func (c *StreamStopCmd) Run(ctx *Context) error {
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

	printText("Broadcast stopped")
	return nil
}

// StreamStatusCmd shows broadcast status on the active stage.
type StreamStatusCmd struct{}

func (c *StreamStatusCmd) Run(ctx *Context) error {
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
