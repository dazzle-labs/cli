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
	Preview    StagePreviewCmd `cmd:"" help:"Show the shareable preview URL for a running stage."`
	// Stage operations
	Script     ScriptCmd     `cmd:"" aliases:"sc" help:"Manage the JS/JSX rendered on stage."`
	Event      EventCmd      `cmd:"" aliases:"ev" help:"Push data to the running script."`
	Logs       LogsCmd       `cmd:"" name:"logs" aliases:"l" help:"Retrieve stage console logs."`
	Screenshot ScreenshotCmd `cmd:"" name:"screenshot" aliases:"ss" help:"Capture a screenshot of the stage."`
	Broadcast  StreamCmd     `cmd:"" aliases:"bc" help:"Broadcast to a streaming destination."`
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

	// Collect all stages matching by name
	var matches []*apiv1.Stage
	for _, s := range listResp.Msg.Stages {
		if s.Name == nameOrID {
			matches = append(matches, s)
		}
	}
	if len(matches) == 1 {
		return matches[0].Id, nil
	}
	if len(matches) > 1 {
		var platforms []string
		for _, s := range matches {
			if s.Destination != nil && s.Destination.Platform != "" {
				platforms = append(platforms, fmt.Sprintf("%q", s.Destination.Platform+":"+s.Name))
			}
		}
		return "", fmt.Errorf("multiple stages named %q — use platform:name to disambiguate (e.g., %s)", nameOrID, strings.Join(platforms, ", "))
	}

	// Try platform:name syntax (e.g., "twitch:my-stage")
	if parts := strings.SplitN(nameOrID, ":", 2); len(parts) == 2 {
		platform, name := parts[0], parts[1]
		for _, s := range listResp.Msg.Stages {
			if s.Destination != nil && s.Destination.Platform == platform && s.Name == name {
				return s.Id, nil
			}
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

	// Show PLATFORM column only if any stage has a destination set.
	hasPlatform := false
	for _, s := range resp.Msg.Stages {
		if s.Destination != nil && s.Destination.Platform != "" {
			hasPlatform = true
			break
		}
	}

	if hasPlatform {
		tableHeader("NAME", "PLATFORM", "STATUS")
		for _, s := range resp.Msg.Stages {
			platform := ""
			if s.Destination != nil {
				platform = s.Destination.Platform
			}
			printText("%s", tableRow(s.Name, platform, s.Status))
		}
	} else {
		tableHeader("NAME", "STATUS")
		for _, s := range resp.Msg.Stages {
			printText("%s", tableRow(s.Name, s.Status))
		}
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

	printText("Stage %q created.", resp.Msg.Stage.Name)

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
	if resp.Msg.Stage.Preview != nil {
		printText("Watch:  %s", resp.Msg.Stage.Preview.WatchUrl)
	}
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

	printText("Name:   %s\nStatus: %s", stage.Name, stage.Status)
	if stage.Preview != nil {
		printText("Watch:  %s\nHLS:    %s", stage.Preview.WatchUrl, stage.Preview.HlsUrl)
	}
	return nil
}

// StagePreviewCmd shows the shareable preview URL for a running stage.
type StagePreviewCmd struct{}

func (c *StagePreviewCmd) Run(ctx *Context) error {
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
		printJSON(stage.Preview)
		return nil
	}

	if stage.Preview == nil {
		printText("No preview available — stage is not running.")
		return nil
	}

	printText("%s", stage.Preview.WatchUrl)
	return nil
}

