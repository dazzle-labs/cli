package main

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// BroadcastInfoCmd gets the current stream title and category from the connected platform.
type BroadcastInfoCmd struct{}

func (c *BroadcastInfoCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetStreamInfoRequest{StageId: ctx.StageID})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetStreamInfo(context.Background(), req)
	if err != nil {
		if connect.CodeOf(err) == connect.CodeUnimplemented {
			if ctx.JSON {
				printJSON(ErrorResponse{OK: false, Error: "info is not supported for this platform"})
				return nil
			}
			printText("Error: info is not supported for this platform.")
			return nil
		}
		return err
	}

	if ctx.JSON {
		printJSON(BroadcastInfoResponse{
			Title:    resp.Msg.Title,
			Category: resp.Msg.Category,
			Platform: resp.Msg.Platform,
		})
		return nil
	}

	title := resp.Msg.Title
	if title == "" {
		title = "(not set)"
	}
	printText("Title: %s", title)
	if resp.Msg.Category != "" {
		printText("Category: %s", resp.Msg.Category)
	}
	printText("Platform: %s", resp.Msg.Platform)
	return nil
}

// BroadcastTitleCmd sets the stream title on the connected platform.
type BroadcastTitleCmd struct {
	Title string `arg:"" help:"New stream title (quote multi-word titles)."`
}

func (c *BroadcastTitleCmd) Run(ctx *Context) error {
	if strings.TrimSpace(c.Title) == "" {
		return fmt.Errorf("title cannot be empty")
	}
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SetStreamTitleRequest{StageId: ctx.StageID, Title: c.Title})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err := client.SetStreamTitle(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(BroadcastTitleResponse{Title: c.Title})
		return nil
	}

	printText("Title updated: %s", c.Title)
	return nil
}

// BroadcastCategoryCmd sets the stream category on the connected platform.
type BroadcastCategoryCmd struct {
	Category string `arg:"" help:"New stream category or game (quote multi-word values)."`
}

func (c *BroadcastCategoryCmd) Run(ctx *Context) error {
	if strings.TrimSpace(c.Category) == "" {
		return fmt.Errorf("category cannot be empty")
	}
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SetStreamCategoryRequest{StageId: ctx.StageID, Category: c.Category})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err := client.SetStreamCategory(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(BroadcastCategoryResponse{Category: c.Category})
		return nil
	}

	printText("Category updated: %s", c.Category)
	return nil
}
