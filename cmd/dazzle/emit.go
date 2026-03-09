package main

import (
	"context"
	"encoding/json"
	"fmt"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// EventCmd groups event subcommands.
type EventCmd struct {
	Emit EmitCmd `cmd:"" aliases:"e" help:"Push a named event with JSON data to the running page — dispatched as a DOM CustomEvent. Use this to send real-time data from external processes (other agents, APIs, etc.) without re-syncing or reloading."`
}

// EmitCmd pushes an event to the running script on the active stage.
type EmitCmd struct {
	Event string `arg:"" help:"Event name."`
	Data  string `arg:"" optional:"" help:"JSON payload (default: {})."`
}

func (c *EmitCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	data := c.Data
	if data == "" {
		data = "{}"
	}
	if !json.Valid([]byte(data)) {
		return fmt.Errorf("data is not valid JSON: %s", data)
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.EmitEventRequest{
		StageId: ctx.StageID,
		Event:   c.Event,
		Data:    data,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err := client.EmitEvent(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]bool{"ok": true})
	} else {
		printText("Event %q emitted.", c.Event)
	}
	return nil
}
