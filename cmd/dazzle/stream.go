package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// StreamCmd groups streaming subcommands.
type StreamCmd struct {
	On     StreamStartCmd  `cmd:"" aliases:"start" help:"Go live on the configured destination."`
	Off    StreamStopCmd   `cmd:"" aliases:"stop" help:"Stop the live stream."`
	Status StreamStatusCmd `cmd:"" aliases:"st" help:"Check if currently live."`
}

// StreamStartCmd starts streaming on the active stage.
type StreamStartCmd struct{}

func (c *StreamStartCmd) Run(ctx *Context) error {
	return runObsArgs(ctx, []string{"st", "s"})
}

// StreamStopCmd stops streaming on the active stage.
type StreamStopCmd struct{}

func (c *StreamStopCmd) Run(ctx *Context) error {
	return runObsArgs(ctx, []string{"st", "st"})
}

// StreamStatusCmd shows streaming status on the active stage.
type StreamStatusCmd struct{}

func (c *StreamStatusCmd) Run(ctx *Context) error {
	return runObsArgs(ctx, []string{"st", "ss"})
}

// runObsArgs is a helper that sends OBS command args to the active stage.
func runObsArgs(ctx *Context, args []string) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.ObsCommandRequest{
		StageId: ctx.StageID,
		Args:    args,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.ObsCommand(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]string{"output": resp.Msg.Output})
	} else {
		fmt.Print(resp.Msg.Output)
	}
	return nil
}
