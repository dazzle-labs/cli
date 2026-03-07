package main

import (
	"context"
	"fmt"
	"strings"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"connectrpc.com/connect"
)

// resolveStage resolves the stage ID using the resolution chain:
// global --stage flag (ctx.Stage) > config default > auto-select.
// Populates ctx.StageID on success.
func (c *Context) resolveStage() error {
	// 1. Global --stage flag or DAZZLE_STAGE env (already applied by Kong into ctx.Stage)
	if c.Stage != "" {
		id, err := resolveStageByNameOrID(c, c.Stage)
		if err != nil {
			return err
		}
		c.StageID = id
		return nil
	}

	// 2. Config default
	if c.Config.DefaultStage != "" {
		id, err := resolveStageByNameOrID(c, c.Config.DefaultStage)
		if err != nil {
			return err
		}
		c.StageID = id
		return nil
	}

	// 3. Auto-select if exactly one stage exists
	client := apiv1connect.NewStageServiceClient(c.HTTPClient, c.APIURL)
	req := connect.NewRequest(&apiv1.ListStagesRequest{})
	req.Header().Set("Authorization", c.authHeader())
	resp, err := client.ListStages(context.Background(), req)
	if err != nil {
		return fmt.Errorf("no stage specified and could not list stages: %w", err)
	}
	if len(resp.Msg.Stages) == 1 {
		c.StageID = resp.Msg.Stages[0].Id
		return nil
	}
	if len(resp.Msg.Stages) == 0 {
		return fmt.Errorf("no stages found -- run 'dazzle stage create <name>'")
	}
	names := make([]string, len(resp.Msg.Stages))
	for i, s := range resp.Msg.Stages {
		names[i] = s.Name
	}
	return fmt.Errorf("multiple stages found (%s) -- use --stage flag or 'dazzle stage use <name>'", strings.Join(names, ", "))
}
