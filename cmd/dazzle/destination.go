package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strings"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"golang.org/x/term"
)

// DestinationCmd groups destination subcommands.
type DestinationCmd struct {
	List   DestinationListCmd   `cmd:"" aliases:"ls" help:"List destinations."`
	Create DestinationCreateCmd `cmd:"" aliases:"new" help:"Create a destination (interactive)."`
	Delete DestinationDeleteCmd `cmd:"" aliases:"rm" help:"Delete a destination."`
	Set    DestinationSetCmd    `cmd:"" help:"Assign destination to stage."`
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
	// Try exact ID match first
	for _, d := range destinations {
		if d.Id == nameOrID {
			return d.Id, nil
		}
	}
	// Try name match
	for _, d := range destinations {
		if d.Name == nameOrID {
			return d.Id, nil
		}
	}
	return "", fmt.Errorf("destination %q not found", nameOrID)
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

	tableHeader("NAME", "PLATFORM", "ID")
	for _, d := range destinations {
		printText("%s", tableRow(d.Name, d.Platform, d.Id))
	}
	return nil
}

// DestinationCreateCmd creates a new RTMP destination interactively.
type DestinationCreateCmd struct{}

func (c *DestinationCreateCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	reader := bufio.NewReader(os.Stdin)

	fmt.Print("Name: ")
	name, _ := reader.ReadString('\n')
	name = strings.TrimSpace(name)

	fmt.Print("Platform (e.g. youtube, twitch, custom): ")
	platform, _ := reader.ReadString('\n')
	platform = strings.TrimSpace(platform)

	fmt.Print("RTMP URL: ")
	rtmpURL, _ := reader.ReadString('\n')
	rtmpURL = strings.TrimSpace(rtmpURL)

	fmt.Print("Stream Key: ")
	keyBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Println()
	if err != nil {
		return fmt.Errorf("read stream key: %w", err)
	}
	streamKey := strings.TrimSpace(string(keyBytes))

	client := apiv1connect.NewRtmpDestinationServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.CreateStreamDestinationRequest{
		Name:      name,
		Platform:  platform,
		RtmpUrl:   rtmpURL,
		StreamKey: streamKey,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.CreateStreamDestination(context.Background(), req)
	if err != nil {
		return err
	}

	dest := resp.Msg.Destination
	if ctx.JSON {
		printJSON(dest)
		return nil
	}

	printText("Destination %q created (ID: %s)", dest.Name, dest.Id)
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

// DestinationSetCmd assigns a destination to the resolved stage.
type DestinationSetCmd struct {
	Name      string `arg:"" help:"Destination name or ID."`
}

func (c *DestinationSetCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	destID, err := resolveDestinationByNameOrID(ctx, c.Name)
	if err != nil {
		return err
	}

	stageClient := apiv1connect.NewStageServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SetStageDestinationRequest{
		StageId:       ctx.StageID,
		DestinationId: destID,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	if _, err := stageClient.SetStageDestination(context.Background(), req); err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]string{"stage_id": ctx.StageID, "destination_id": destID})
		return nil
	}

	printText("Destination %q assigned to stage.", c.Name)
	return nil
}
