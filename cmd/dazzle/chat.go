package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/signal"
	"strings"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	apiv1connect "github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// chatMessageJSON is the JSON representation of a chat message.
// Uses a local struct with encoding/json — not protojson — to ensure
// timestamp is serialized as an RFC3339 string, not a proto object.
type chatMessageJSON struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Text      string `json:"text"`
	Timestamp string `json:"timestamp"` // RFC3339, e.g. "2026-03-11T12:00:00Z"
	Platform  string `json:"platform"`
}

// formatChatMessage formats a chat message for human-readable output.
func formatChatMessage(m *apiv1.ChatMessage) string {
	return fmt.Sprintf("%s: %s [%s]", m.Author, m.Text, m.Timestamp.AsTime().UTC().Format(time.RFC3339))
}

// chatMessageToJSON converts a proto ChatMessage to the JSON output struct.
func chatMessageToJSON(m *apiv1.ChatMessage) chatMessageJSON {
	return chatMessageJSON{
		ID:        m.Id,
		Author:    m.Author,
		Text:      m.Text,
		Timestamp: m.Timestamp.AsTime().UTC().Format(time.RFC3339),
		Platform:  m.Platform,
	}
}

// ChatCmd groups chat subcommands.
type ChatCmd struct {
	Send ChatSendCmd `cmd:"" help:"Send a message to live chat."`
	Read ChatReadCmd `cmd:"" help:"Read recent chat messages."`
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
			Platform string `json:"platform"`
		}{resp.Msg.Platform})
		return nil
	}

	printText("Sent.")
	return nil
}

// ChatReadCmd reads recent chat messages.
type ChatReadCmd struct {
	Limit    int           `help:"Number of messages to return." default:"20" short:"n"`
	Watch    bool          `help:"Poll continuously for new messages." short:"w"`
	Interval time.Duration `help:"Poll interval (watch mode only; ignored without --watch)." default:"5s"`
}

// isChatUnsupportedError returns true if the error indicates an unsupported platform.
func isChatUnsupportedError(err error) bool {
	return connect.CodeOf(err) == connect.CodeUnimplemented
}

// printFriendlyChatError prints a human-readable message for unsupported chat platforms.
func printFriendlyChatError(err error) {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "EventSub"):
		printText("Error: Twitch chat requires an EventSub subscription — real-time chat is not yet supported for Twitch.")
	case strings.Contains(msg, "WebSocket"):
		printText("Error: Kick chat requires a persistent WebSocket connection — not yet supported.")
	default:
		printText("Error: chat is not supported for this platform.")
	}
}

func (c *ChatReadCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	// Shared validation (applies to both one-shot and watch mode)
	if c.Limit < 0 {
		return fmt.Errorf("--limit must be non-negative")
	}
	if c.Limit > math.MaxInt32 {
		return fmt.Errorf("--limit value too large (max %d)", math.MaxInt32)
	}

	if !c.Watch {
		// One-shot: fetch once and exit.
		// 0 means "use server default of 20"
		client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)
		req := connect.NewRequest(&apiv1.GetChatRequest{StageId: ctx.StageID, Limit: int32(c.Limit)})
		req.Header().Set("Authorization", ctx.authHeader())
		resp, err := client.GetChat(context.Background(), req)
		if err != nil {
			if isChatUnsupportedError(err) {
				printFriendlyChatError(err)
				return nil
			}
			return err
		}

		if ctx.JSON {
			var out []chatMessageJSON
			for _, m := range resp.Msg.Messages {
				out = append(out, chatMessageToJSON(m))
			}
			if out == nil {
				out = []chatMessageJSON{}
			}
			printJSON(out)
			return nil
		}

		for _, m := range resp.Msg.Messages {
			printText("%s", formatChatMessage(m))
		}
		return nil
	}

	// Watch mode: poll continuously for new messages.
	if c.Interval <= 0 {
		return fmt.Errorf("--interval must be a positive duration (e.g. 5s)")
	}
	// Note: if --interval is passed without --watch, it is silently ignored (c.Interval is set
	// but the watch branch is never entered). This is intentional and documented in --help.

	sigCtx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	ticker := time.NewTicker(c.Interval)
	defer ticker.Stop()
	// Note: the first poll fires immediately on loop entry (before the first tick).
	// Subsequent polls fire after each c.Interval. This is intentional — users see
	// results immediately, then at each interval.

	var lastTimestamp *timestamppb.Timestamp
	firstPoll := true

	client := apiv1connect.NewBroadcastServiceClient(ctx.HTTPClient, ctx.APIURL)

	for {
		fetchLimit := c.Limit
		if fetchLimit < 100 {
			fetchLimit = 100 // fetch more to reduce silent-drop window
		}

		req := connect.NewRequest(&apiv1.GetChatRequest{StageId: ctx.StageID, Limit: int32(fetchLimit)})
		req.Header().Set("Authorization", ctx.authHeader())
		// Pass sigCtx (not context.Background()) so Ctrl+C cancels the in-flight HTTP request immediately.
		resp, err := client.GetChat(sigCtx, req)

		if err != nil {
			if sigCtx.Err() != nil {
				// Context cancelled by Ctrl+C
				return nil
			}
			if isChatUnsupportedError(err) {
				printFriendlyChatError(err)
				return nil
			}
			// Transient/network error in watch mode: print warning and continue polling.
			// IMPORTANT: set firstPoll = false AND lastTimestamp = timestamppb.Now() here.
			// Setting firstPoll = false alone leaves lastTimestamp = nil, which causes a
			// nil pointer panic on the next successful poll when lastTimestamp.AsTime() is called.
			// Anchoring to Now() means poll 2 only shows messages newer than the error moment.
			firstPoll = false
			if lastTimestamp == nil {
				lastTimestamp = timestamppb.Now()
			}
			printText("Warning: %v (retrying...)", err)
		} else if firstPoll {
			firstPoll = false
			if len(resp.Msg.Messages) == 0 {
				lastTimestamp = timestamppb.Now() // anchor to now; don't replay on next poll
			} else {
				for _, m := range resp.Msg.Messages {
					if ctx.JSON {
						b, err := json.Marshal(chatMessageToJSON(m))
						if err == nil {
							fmt.Println(string(b))
						}
					} else {
						printText("%s", formatChatMessage(m))
					}
				}
				// Handler returns messages in ascending timestamp order (oldest first),
				// so Messages[last] is the most recent message — this is the required ordering.
				lastTimestamp = resp.Msg.Messages[len(resp.Msg.Messages)-1].Timestamp
			}
		} else {
			// Handler returns messages oldest-first; iterate forward and track the running max.
			for _, msg := range resp.Msg.Messages {
				if msg.Timestamp.AsTime().After(lastTimestamp.AsTime()) {
					if ctx.JSON {
						b, err := json.Marshal(chatMessageToJSON(msg))
						if err == nil {
							fmt.Println(string(b))
						}
					} else {
						printText("%s", formatChatMessage(msg))
					}
					lastTimestamp = msg.Timestamp
				}
			}
		}

		select {
		case <-sigCtx.Done():
			return nil // clean Ctrl+C exit — immediate, does not wait for next tick
		case <-ticker.C:
			// Note: time.Ticker buffers exactly one tick. If a poll takes longer than
			// c.Interval, the next tick fires immediately (no stacking beyond 1).
			// This is acceptable — it means slow polls may fire back-to-back once,
			// but will not create an unbounded backlog.
			continue
		}
	}
}
