package main

import (
	"context"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// RefreshCmd refreshes Chrome on the stage to the synced entry point.
type RefreshCmd struct{}

func (c *RefreshCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.RefreshRequest{
		StageId: ctx.StageID,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := client.Refresh(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]bool{"ok": true})
	} else {
		printText("Chrome refreshed.")
	}
	return nil
}
