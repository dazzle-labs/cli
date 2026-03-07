package main

import (
	"context"
	"fmt"
	"strings"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"connectrpc.com/connect"
)

// StageCmd groups stage subcommands.
type StageCmd struct {
	List       StageListCmd   `cmd:"" aliases:"ls" help:"List stages."`
	Create     StageCreateCmd `cmd:"" aliases:"new" help:"Create a stage."`
	Delete     StageDeleteCmd `cmd:"" aliases:"rm" help:"Delete a stage."`
	Activate   StageStartCmd  `cmd:"" aliases:"start,up" help:"Activate a stage."`
	Deactivate StageStopCmd   `cmd:"" aliases:"stop,down" help:"Deactivate a stage."`
	Status     StageStatusCmd `cmd:"" aliases:"st" help:"Show stage status."`
	Use        StageUseCmd    `cmd:"" help:"Set default stage."`

	// Stage operations
	Script     ScriptCmd     `cmd:"" aliases:"sc" help:"Manage the JS/JSX rendered on stage."`
	Event      EventCmd      `cmd:"" aliases:"ev" help:"Push data to the running script."`
	Logs       LogsCmd       `cmd:"" name:"logs" aliases:"l" help:"Retrieve stage console logs."`
	Screenshot ScreenshotCmd `cmd:"" name:"screenshot" aliases:"ss" help:"Capture a screenshot of the stage."`
	Live       StreamCmd     `cmd:"" aliases:"stream" help:"Go live — stream to a destination."`
}

// resolveStageByNameOrID tries to resolve a stage name or ID to its ID.
// It first tries GetStage (treating the input as an ID), then falls back to
// listing stages and matching by name.
func resolveStageByNameOrID(ctx *Context, nameOrID string) (string, error) {
	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)

	// Try as ID first via GetStage
	req := connect.NewRequest(&apiv1.GetStageRequest{Id: nameOrID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetStage(context.Background(), req)
	if err == nil {
		return resp.Msg.Stage.Id, nil
	}

	// Try matching by name via ListStages
	listReq := connect.NewRequest(&apiv1.ListStagesRequest{})
	listReq.Header().Set("Authorization", ctx.authHeader())
	listResp, err := client.ListStages(context.Background(), listReq)
	if err != nil {
		return "", err
	}
	for _, s := range listResp.Msg.Stages {
		if s.Name == nameOrID {
			return s.Id, nil
		}
	}
	return "", fmt.Errorf("stage %q not found", nameOrID)
}

// StageListCmd lists all stages.
type StageListCmd struct{}

func (c *StageListCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.ListStagesRequest{})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.ListStages(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(resp.Msg.Stages)
		return nil
	}

	tableHeader("NAME", "ID", "STATUS")
	for _, s := range resp.Msg.Stages {
		printText("%s", tableRow(s.Name, s.Id, s.Status))
	}
	return nil
}

// StageCreateCmd creates a new stage.
type StageCreateCmd struct {
	Name string `arg:"" help:"Stage name."`
}

func (c *StageCreateCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.CreateStageRequest{Name: c.Name})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.CreateStage(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(resp.Msg.Stage)
		return nil
	}

	printText("Stage %q created (ID: %s)", resp.Msg.Stage.Name, resp.Msg.Stage.Id)
	return nil
}

// StageDeleteCmd deletes a stage.
type StageDeleteCmd struct {
	Stage string `arg:"" help:"Stage name or ID."`
}

func (c *StageDeleteCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	id, err := resolveStageByNameOrID(ctx, c.Stage)
	if err != nil {
		return err
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.DeleteStageRequest{Id: id})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := client.DeleteStage(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]string{"deleted": c.Stage})
		return nil
	}

	printText("Stage %q deleted.", c.Stage)
	return nil
}

// StageStartCmd activates a stage.
type StageStartCmd struct {
}

func (c *StageStartCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.ActivateStageRequest{Id: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.ActivateStage(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(resp.Msg.Stage)
		return nil
	}

	printText("Stage %q activated (status: %s)", resp.Msg.Stage.Name, resp.Msg.Stage.Status)
	return nil
}

// StageStopCmd deactivates a stage.
type StageStopCmd struct {
}

func (c *StageStopCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.DeactivateStageRequest{Id: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.DeactivateStage(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(resp.Msg.Stage)
		return nil
	}

	printText("Stage %q deactivated.", resp.Msg.Stage.Name)
	return nil
}

// StageStatusCmd shows the current status of a stage.
type StageStatusCmd struct {
}

func (c *StageStatusCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetStageRequest{Id: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetStage(context.Background(), req)
	if err != nil {
		return err
	}

	stage := resp.Msg.Stage
	if ctx.JSON {
		printJSON(stage)
		return nil
	}

	printText("Name:   %s\nID:     %s\nStatus: %s", stage.Name, stage.Id, stage.Status)
	return nil
}

// StageUseCmd sets the default stage in config.
type StageUseCmd struct {
	Stage string `arg:"" help:"Stage name or ID to set as default."`
}

func (c *StageUseCmd) Run(ctx *Context) error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}
	cfg.DefaultStage = c.Stage
	if err := saveConfig(cfg); err != nil {
		return err
	}
	if ctx.JSON {
		printJSON(map[string]string{"default_stage": c.Stage})
	} else {
		printText("Default stage set to %q. Run 'dazzle stage list' to confirm.", c.Stage)
	}
	return nil
}

// Ensure strings is used (for resolveStage in client.go which uses strings.Join).
var _ = strings.Join
