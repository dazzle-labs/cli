package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// ObsCmd forwards commands to OBS on the active stage.
type ObsCmd struct {
	Args      []string `arg:"" optional:"" help:"OBS command arguments (e.g. st s)."`
}

func (c *ObsCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if len(c.Args) == 0 {
		return fmt.Errorf("no OBS command specified -- see 'dazzle obs --help'")
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.ObsCommandRequest{
		StageId: ctx.StageID,
		Args:    c.Args,
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
