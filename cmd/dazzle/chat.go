package main

import (
	"context"
	"fmt"
	"strings"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	apiv1connect "github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// ChatCmd groups chat subcommands.
type ChatCmd struct {
	Send ChatSendCmd `cmd:"" help:"Send a message to live chat (not supported for Restream)."`
}

// ChatSendCmd sends a message to the live chat.
type ChatSendCmd struct {
	// Note: struct field is named Message (natural English) but the proto SendChatRequest
	// field is named Text. The mapping is: SendChatRequest{..., Text: c.Message}.
	Message string `arg:"" help:"Message to send (quote multi-word messages)."`
}

func (c *ChatSendCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}
	if strings.TrimSpace(c.Message) == "" {
		return fmt.Errorf("message cannot be empty")
	}

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SendChatRequest{StageId: ctx.StageID, Text: c.Message})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.SendChat(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(struct {
			OK       bool   `json:"ok"`
			Platform string `json:"platform"`
		}{true, resp.Msg.Platform})
		return nil
	}

	printText("Sent.")
	return nil
}
