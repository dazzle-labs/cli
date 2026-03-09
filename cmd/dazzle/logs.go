package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// LogsCmd retrieves console logs from the active stage.
type LogsCmd struct {
	Limit     int    `help:"Number of log entries to return." default:"100" short:"n"`
}

func (c *LogsCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetLogsRequest{
		StageId: ctx.StageID,
		Limit:   int32(c.Limit),
	})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetLogs(context.Background(), req)
	if err != nil {
		return err
	}

	for _, entry := range resp.Msg.Entries {
		fmt.Printf("[%s] %s  %s\n", entry.Level, entry.Timestamp, entry.Message)
	}
	return nil
}
