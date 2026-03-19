package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"connectrpc.com/connect"
)

// StageCmd groups stage subcommands.
type StageCmd struct {
	List       StageListCmd   `cmd:"" aliases:"ls" help:"List stages."`
	Create     StageCreateCmd `cmd:"" aliases:"new" help:"Create a stage."`
	Delete     StageDeleteCmd `cmd:"" aliases:"rm" help:"Delete a stage."`
	Up   StageStartCmd `cmd:"" help:"Activate a stage."`
	Down StageStopCmd  `cmd:"" help:"Deactivate a stage."`
	Status     StageStatusCmd `cmd:"" aliases:"st" help:"Show stage status."`
	Stats      StageStatsCmd  `cmd:"" help:"Show live pipeline stats."`
	Preview    StagePreviewCmd `cmd:"" help:"Show the shareable preview URL for a running stage."`
	// Content — sync a local directory to the stage (the primary way to push content)
	Sync       SyncCmd       `cmd:"" aliases:"sy" help:"Sync a local directory to the stage. This is the primary way to push content — use --watch for live development."`
	Refresh_   RefreshCmd    `cmd:"" name:"refresh" aliases:"r" help:"Reload the stage entry point."`
	// Interaction
	Event      EventCmd      `cmd:"" aliases:"ev" help:"Send real-time data to the running page without reloading. Events are dispatched as DOM CustomEvents — use this for async updates from subagents, APIs, or other processes."`
	Logs       LogsCmd       `cmd:"" name:"logs" aliases:"l" help:"Retrieve stage console logs."`
	Screenshot ScreenshotCmd `cmd:"" name:"screenshot" aliases:"ss" help:"Capture a screenshot of the stage."`
	Broadcast  BroadcastCmd  `cmd:"" aliases:"bc" help:"Broadcast to a streaming destination."`
	Chat       ChatCmd       `cmd:"" help:"Read and send live chat messages."`
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
	GPU  bool   `help:"Create a GPU-accelerated stage." default:"false"`
}

func (c *StageCreateCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	var caps []string
	if c.GPU {
		caps = append(caps, "gpu")
	}

	client := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.CreateStageRequest{Name: c.Name, Capabilities: caps})
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
		printJSON(StageDeleteResponse{Deleted: c.Stage})
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
	if resp.Msg.Stage.WatchUrl != "" {
		printText("Watch:  %s", resp.Msg.Stage.WatchUrl)
		openBrowser(resp.Msg.Stage.WatchUrl)
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
	if stage.WatchUrl != "" {
		printText("Watch:  %s", stage.WatchUrl)
	}
	return nil
}

// StagePreviewCmd shows the public watch URL for a running stage.
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
		printJSON(map[string]string{"watch_url": stage.WatchUrl})
		return nil
	}

	if stage.WatchUrl == "" {
		printText("No watch URL available — stage is not running.")
		return nil
	}

	printText("%s", stage.WatchUrl)
	openBrowser(stage.WatchUrl)
	return nil
}

// StageStatsCmd shows live pipeline stats for a running stage.
type StageStatsCmd struct{}

func (c *StageStatsCmd) Run(ctx *Context) error {
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
		printJSON(StageStatsResponse{
			StageFPS:               s.StageFps,
			BroadcastFPS:           s.BroadcastFps,
			DroppedFrames:          s.DroppedFrames,
			DroppedFramesRecent:    s.DroppedFramesRecent,
			TotalBytes:             s.TotalBytes,
			Broadcasting:           s.Broadcasting,
			BroadcastUptimeSeconds: s.BroadcastUptimeSeconds,
			StageUptimeSeconds:     s.StageUptimeSeconds,
		})
		return nil
	}

	printText("Stage FPS:       %.1f", s.StageFps)
	printText("Broadcast FPS:   %.1f", s.BroadcastFps)
	printText("Dropped Frames:  %d (%d last 60s)", s.DroppedFrames, s.DroppedFramesRecent)
	printText("Data:            %s", formatBytes(s.TotalBytes))
	printText("Broadcasting:    %s", yesNo(s.Broadcasting))
	printText("Uptime:          %s", formatDuration(s.StageUptimeSeconds))
	return nil
}

func formatBytes(b int64) string {
	const (
		MB = 1_000_000
		GB = 1_000_000_000
	)
	switch {
	case b >= GB:
		return fmt.Sprintf("%.2f GB", float64(b)/float64(GB))
	case b >= MB:
		return fmt.Sprintf("%.1f MB", float64(b)/float64(MB))
	default:
		return fmt.Sprintf("%d bytes", b)
	}
}

func formatDuration(seconds int64) string {
	d := time.Duration(seconds) * time.Second
	h := int(d / time.Hour)
	m := int((d % time.Hour) / time.Minute)
	s := int((d % time.Minute) / time.Second)
	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, s)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}

func yesNo(b bool) string {
	if b {
		return "yes"
	}
	return "no"
}

