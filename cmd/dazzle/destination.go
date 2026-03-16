package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"golang.org/x/term"
)

// DestinationCmd groups destination subcommands.
type DestinationCmd struct {
	List   DestinationListCmd   `cmd:"" aliases:"ls" help:"List broadcast destinations."`
	Create DestinationCreateCmd `cmd:"" aliases:"new" help:"Create a broadcast destination."`
	Delete DestinationDeleteCmd `cmd:"" aliases:"rm" help:"Remove a broadcast destination."`
	Add    DestinationAddCmd    `cmd:"" help:"Add destinations to the active stage."`
	Remove DestinationRemoveCmd `cmd:"" help:"Remove destinations from the active stage."`
}

var oauthPlatforms = []struct {
	Name    string
	Display string
}{
	{"twitch", "Twitch"},
	{"youtube", "YouTube"},
	{"kick", "Kick"},
	{"restream", "Restream"},
}

// listStreamDestinations is a helper that fetches all destinations from the API.
func listStreamDestinations(ctx *Context) ([]*apiv1.StreamDestination, error) {
	client := apiv1connect.NewRtmpDestinationServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.ListStreamDestinationsRequest{})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.ListStreamDestinations(context.Background(), req)
	if err != nil {
		return nil, err
	}
	return resp.Msg.Destinations, nil
}

// resolveDestinationByNameOrID finds a destination ID by name or treats the input as an ID.
func resolveDestinationByNameOrID(ctx *Context, nameOrID string) (string, error) {
	destinations, err := listStreamDestinations(ctx)
	if err != nil {
		return "", err
	}
	for _, d := range destinations {
		if d.Id == nameOrID {
			return d.Id, nil
		}
	}
	for _, d := range destinations {
		if d.Name == nameOrID || d.PlatformUsername == nameOrID {
			return d.Id, nil
		}
	}
	return "", fmt.Errorf("destination %q not found", nameOrID)
}

// resolveDestinationByPlatformName resolves a "platform:name" string to a destination ID.
func resolveDestinationByPlatformName(ctx *Context, platformName string) (string, error) {
	if !strings.Contains(platformName, ":") {
		return "", fmt.Errorf("invalid format %q — use platform:name (e.g., \"twitch:MrBeast\")", platformName)
	}
	parts := strings.SplitN(platformName, ":", 2)
	platform, name := parts[0], parts[1]

	destinations, err := listStreamDestinations(ctx)
	if err != nil {
		return "", err
	}
	for _, d := range destinations {
		if d.Platform == platform && (d.Name == name || d.PlatformUsername == name) {
			return d.Id, nil
		}
	}
	return "", fmt.Errorf("destination %q not found", platformName)
}

// DestinationListCmd lists all RTMP destinations.
type DestinationListCmd struct{}

func (c *DestinationListCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	destinations, err := listStreamDestinations(ctx)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(destinations)
		return nil
	}

	tableHeader("NAME", "PLATFORM")
	for _, d := range destinations {
		displayName := d.Name
		if displayName == "" {
			displayName = d.PlatformUsername
		}
		printText("%s", tableRow(displayName, d.Platform))
	}
	return nil
}

// DestinationCreateCmd creates a new streaming destination.
type DestinationCreateCmd struct {
	Platform  string `help:"Platform (twitch, youtube, kick, restream, custom)." name:"platform"`
	Name      string `help:"Destination name (custom platform only)." name:"name"`
	RtmpURL   string `help:"RTMP URL (custom platform only)." name:"rtmp-url"`
	StreamKey string `help:"Stream key (custom platform only)." name:"stream-key"`
}

func (c *DestinationCreateCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	platform := strings.ToLower(c.Platform)

	// If no platform specified, show interactive picker
	if platform == "" {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return fmt.Errorf("--platform is required in non-interactive mode")
		}
		fmt.Println("? Select platform:")
		for i, p := range oauthPlatforms {
			fmt.Printf("  [%d] %s\n", i+1, p.Display)
		}
		fmt.Printf("  [%d] Custom (manual RTMP)\n", len(oauthPlatforms)+1)
		fmt.Print("> ")

		reader := bufio.NewReader(os.Stdin)
		line, _ := reader.ReadString('\n')
		line = strings.TrimSpace(line)

		var choice int
		if _, err := fmt.Sscanf(line, "%d", &choice); err != nil || choice < 1 || choice > len(oauthPlatforms)+1 {
			return fmt.Errorf("invalid selection")
		}

		if choice == len(oauthPlatforms)+1 {
			platform = "custom"
		} else {
			platform = oauthPlatforms[choice-1].Name
		}
	}

	// Custom platform: fully in-terminal flow
	if platform == "custom" {
		return c.runCustomFlow(ctx)
	}

	// OAuth platform: browser-based flow
	return c.runOAuthFlow(ctx, platform)
}

func (c *DestinationCreateCmd) runCustomFlow(ctx *Context) error {
	name := c.Name
	rtmpURL := c.RtmpURL
	streamKey := c.StreamKey

	reader := bufio.NewReader(os.Stdin)

	if name == "" {
		fmt.Print("Name: ")
		name, _ = reader.ReadString('\n')
		name = strings.TrimSpace(name)
	}
	if rtmpURL == "" {
		fmt.Print("RTMP URL: ")
		rtmpURL, _ = reader.ReadString('\n')
		rtmpURL = strings.TrimSpace(rtmpURL)
	}
	if streamKey == "" {
		fmt.Print("Stream Key: ")
		keyBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		if err != nil {
			return fmt.Errorf("read stream key: %w", err)
		}
		streamKey = strings.TrimSpace(string(keyBytes))
	}

	client := apiv1connect.NewRtmpDestinationServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.CreateStreamDestinationRequest{
		Name:      name,
		Platform:  "custom",
		RtmpUrl:   rtmpURL,
		StreamKey: streamKey,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.CreateStreamDestination(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(resp.Msg.Destination)
	} else {
		printText("\u2713 Destination created: %s", resp.Msg.Destination.Name)
	}
	return nil
}

func (c *DestinationCreateCmd) runOAuthFlow(ctx *Context, platform string) error {
	// Find display name
	displayName := platform
	for _, p := range oauthPlatforms {
		if p.Name == platform {
			displayName = p.Display
			break
		}
	}

	verifyCode := generateVerifyCode()

	body, _ := json.Marshal(map[string]string{
		"type":        "destination",
		"platform":    platform,
		"verify_code": verifyCode,
	})
	req, _ := http.NewRequest("POST", ctx.APIURL+"/auth/cli/session", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", ctx.authHeader())

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	defer resp.Body.Close()

	var session struct {
		SessionID  string `json:"session_id"`
		BrowserURL string `json:"browser_url"`
		Error      string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return fmt.Errorf("parse session response: %w", err)
	}
	if session.Error != "" {
		return fmt.Errorf("create session: %s", session.Error)
	}

	if !ctx.JSON {
		printText("Opening browser to connect your %s account...", displayName)
		printText("  \u2192 If the browser didn't open, visit: %s", session.BrowserURL)
		printText("")
		printText("Verification code: %s", verifyCode)
		printText("")
	}

	openBrowser(session.BrowserURL)

	var stop func()
	if !ctx.JSON {
		stop = startSpinner(fmt.Sprintf("Waiting for %s authorization...", displayName))
	}

	result, err := pollCliSession(ctx.APIURL, session.SessionID, 10*time.Minute)
	if stop != nil {
		stop()
	}
	if err != nil {
		if ctx.JSON {
			printJSON(map[string]string{"error": err.Error()})
		} else {
			printText("\u2717 Timed out waiting for %s authorization. Try again.", displayName)
		}
		os.Exit(1)
	}

	if ctx.JSON {
		printJSON(map[string]string{
			"platform":          result.Platform,
			"platform_username": result.PlatformUsername,
		})
	} else {
		printText("\u2713 Destination created: %s \u2014 %s", displayName, result.PlatformUsername)
	}
	return nil
}

// DestinationDeleteCmd deletes a destination.
type DestinationDeleteCmd struct {
	Name string `arg:"" help:"Destination name or ID."`
}

func (c *DestinationDeleteCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	id, err := resolveDestinationByNameOrID(ctx, c.Name)
	if err != nil {
		return err
	}

	client := apiv1connect.NewRtmpDestinationServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.DeleteStreamDestinationRequest{Id: id})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := client.DeleteStreamDestination(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]string{"deleted": c.Name})
		return nil
	}

	printText("Destination %q deleted.", c.Name)
	return nil
}

// DestinationAddCmd adds destinations to the active stage.
type DestinationAddCmd struct {
	Names []string `arg:"" required:"" help:"Destinations as platform:name (e.g., twitch:MrBeast)."`
}

func (c *DestinationAddCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	// Fetch current stage to get existing destination IDs
	stageClient := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	getReq := connect.NewRequest(&apiv1.GetStageRequest{Id: ctx.StageID})
	getReq.Header().Set("Authorization", ctx.authHeader())
	getResp, err := stageClient.GetStage(context.Background(), getReq)
	if err != nil {
		return err
	}
	existing := getResp.Msg.Stage.DestinationIds

	// Resolve each arg to a destination ID
	var newIDs []string
	for _, name := range c.Names {
		id, err := resolveDestinationByPlatformName(ctx, name)
		if err != nil {
			return err
		}
		newIDs = append(newIDs, id)
	}

	// Merge with existing, skip duplicates
	seen := make(map[string]bool)
	var merged []string
	for _, id := range existing {
		seen[id] = true
		merged = append(merged, id)
	}
	for _, id := range newIDs {
		if !seen[id] {
			seen[id] = true
			merged = append(merged, id)
		}
	}

	if len(merged) > 4 {
		return fmt.Errorf("cannot exceed 4 destinations per stage (would have %d)", len(merged))
	}

	setReq := connect.NewRequest(&apiv1.SetStageDestinationRequest{
		StageId:        ctx.StageID,
		DestinationIds: merged,
	})
	setReq.Header().Set("Authorization", ctx.authHeader())
	if _, err := stageClient.SetStageDestination(context.Background(), setReq); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]any{"stage_id": ctx.StageID, "destination_ids": merged})
		return nil
	}

	if len(c.Names) == 1 {
		printText("Destination added to stage: %s", c.Names[0])
	} else {
		printText("Destinations added to stage: %s", strings.Join(c.Names, ", "))
	}
	return nil
}

// DestinationRemoveCmd removes destinations from the active stage.
type DestinationRemoveCmd struct {
	Names []string `arg:"" optional:"" help:"Destinations to remove as platform:name."`
	All   bool     `help:"Remove all destinations from the stage." name:"all"`
}

func (c *DestinationRemoveCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	stageClient := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)

	if c.All {
		req := connect.NewRequest(&apiv1.SetStageDestinationRequest{
			StageId:        ctx.StageID,
			DestinationIds: []string{},
		})
		req.Header().Set("Authorization", ctx.authHeader())
		if _, err := stageClient.SetStageDestination(context.Background(), req); err != nil {
			return err
		}
		if ctx.JSON {
			printJSON(map[string]any{"stage_id": ctx.StageID, "destination_ids": []string{}})
		} else {
			printText("All destinations removed from stage.")
		}
		return nil
	}

	if len(c.Names) == 0 {
		return fmt.Errorf("specify destinations to remove or use --all")
	}

	// Fetch current stage
	getReq := connect.NewRequest(&apiv1.GetStageRequest{Id: ctx.StageID})
	getReq.Header().Set("Authorization", ctx.authHeader())
	getResp, err := stageClient.GetStage(context.Background(), getReq)
	if err != nil {
		return err
	}
	existing := getResp.Msg.Stage.DestinationIds

	// Resolve args to IDs to remove
	removeSet := make(map[string]bool)
	for _, name := range c.Names {
		id, err := resolveDestinationByPlatformName(ctx, name)
		if err != nil {
			return err
		}
		removeSet[id] = true
	}

	// Filter out removed IDs
	var remaining []string
	for _, id := range existing {
		if !removeSet[id] {
			remaining = append(remaining, id)
		}
	}

	req := connect.NewRequest(&apiv1.SetStageDestinationRequest{
		StageId:        ctx.StageID,
		DestinationIds: remaining,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := stageClient.SetStageDestination(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]any{"stage_id": ctx.StageID, "destination_ids": remaining})
		return nil
	}

	if len(c.Names) == 1 {
		printText("Destination removed from stage: %s", c.Names[0])
	} else {
		printText("Destinations removed from stage: %s", strings.Join(c.Names, ", "))
	}
	return nil
}
