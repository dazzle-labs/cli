package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// resolveStageForMCP resolves the stage ID for an MCP tool call.
// Checks the tool's optional "stage" field first, then falls back to the
// CLI resolution chain (--stage flag / DAZZLE_STAGE env / auto-select).
func resolveStageForMCP(appCtx *Context, stage string) (string, error) {
	if stage != "" {
		return resolveStageByNameOrID(appCtx, stage)
	}
	if err := appCtx.resolveStage(); err != nil {
		return "", err
	}
	return appCtx.StageID, nil
}

// --- Input types for typed tool handlers ---

type stageInput struct {
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type emptyInput struct{}

type createStageInput struct {
	Name string `json:"name" jsonschema:"required,Stage name."`
	GPU  bool   `json:"gpu,omitempty" jsonschema:"Create a GPU-accelerated stage (default false)."`
}

type deleteStageInput struct {
	Stage string `json:"stage" jsonschema:"required,Stage name or ID to delete."`
}

type syncInput struct {
	Directory string `json:"directory" jsonschema:"required,Local directory path to sync (must contain index.html)."`
	Entry     string `json:"entry,omitempty" jsonschema:"HTML entry point file (default index.html)."`
	Stage     string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type emitEventInput struct {
	Event string `json:"event" jsonschema:"required,Event name (e.g. update or score or theme)."`
	Data  string `json:"data" jsonschema:"required,JSON object payload."`
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type getLogsInput struct {
	Limit int    `json:"limit,omitempty" jsonschema:"Number of recent entries (default 100 max 1000)."`
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type setStreamInfoInput struct {
	Title    string `json:"title,omitempty" jsonschema:"New stream title."`
	Category string `json:"category,omitempty" jsonschema:"Stream category or game name."`
	Stage    string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type getChatInput struct {
	Limit int    `json:"limit,omitempty" jsonschema:"Number of recent messages (default 20 max 100)."`
	Stage string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type sendChatInput struct {
	Message string `json:"message" jsonschema:"required,Chat message to send."`
	Stage   string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type destNameInput struct {
	Destination string `json:"destination" jsonschema:"required,Destination name or ID."`
}

type destAttachInput struct {
	Destination string `json:"destination" jsonschema:"required,Destination name or ID."`
	Stage       string `json:"stage,omitempty" jsonschema:"Stage name or ID. If omitted uses DAZZLE_STAGE env or auto-selects if you have one stage."`
}

type createCustomDestInput struct {
	Name      string `json:"name" jsonschema:"required,Destination display name."`
	RtmpURL   string `json:"rtmp_url" jsonschema:"required,RTMP ingest URL (e.g. rtmp://live.twitch.tv/app)."`
	StreamKey string `json:"stream_key" jsonschema:"required,Stream key for the RTMP destination."`
}

func registerTools(s *mcp.Server, appCtx *Context) {
	// --- Stage management ---

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_stages",
		Description: "List all your stages with their names, slugs, and status.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, any, error) {
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.ListStagesRequest{})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.ListStages(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Stages), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "create_stage",
		Description: "Create a new stage. Returns the created stage record. The stage starts inactive — call activate_stage to bring it up.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createStageInput) (*mcp.CallToolResult, any, error) {
		var caps []string
		if in.GPU {
			caps = append(caps, "gpu")
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.CreateStageRequest{Name: in.Name, Capabilities: caps})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.CreateStage(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Stage), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "delete_stage",
		Description: "Permanently delete a stage and all its data.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in deleteStageInput) (*mcp.CallToolResult, any, error) {
		id, err := resolveStageByNameOrID(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.DeleteStageRequest{Id: id})
		r.Header().Set("Authorization", appCtx.authHeader())
		if _, err := client.DeleteStage(ctx, r); err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]string{"deleted": in.Stage}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "activate_stage",
		Description: "Activate a stage — starts the cloud environment. Polls until running (up to 3 minutes). Returns the stage when ready.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.ActivateStageRequest{Id: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.ActivateStage(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		stage := resp.Msg.Stage
		if stage.Status != "running" && stage.Status != "inactive" {
			stage, err = pollStageUntilReady(appCtx, client, stageID, 3*time.Minute)
			if err != nil {
				return nil, nil, err
			}
		}
		return mcpJSON(stage), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "deactivate_stage",
		Description: "Deactivate a stage — shuts down the cloud environment and releases resources.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.DeactivateStageRequest{Id: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.DeactivateStage(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Stage), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "stage_status",
		Description: "Get the current status of a stage (name, slug, status, watch URL).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.GetStageRequest{Id: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.GetStage(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Stage), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "stage_stats",
		Description: "Get live pipeline stats for a running stage — FPS, dropped frames, broadcast status, uptime. Use this to check if content is too heavy for the renderer.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.GetStageStatsRequest{StageId: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.GetStageStats(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		s := resp.Msg
		return mcpJSON(map[string]any{
			"stage_fps":                s.StageFps,
			"broadcast_fps":            s.BroadcastFps,
			"dropped_frames":           s.DroppedFrames,
			"dropped_frames_recent":    s.DroppedFramesRecent,
			"total_bytes":              s.TotalBytes,
			"broadcasting":             s.Broadcasting,
			"active_outputs":           s.ActiveOutputs,
			"broadcast_uptime_seconds": s.BroadcastUptimeSeconds,
			"stage_uptime_seconds":     s.StageUptimeSeconds,
		}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "whoami",
		Description: "Show the current authenticated user (name, email, stage count).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, any, error) {
		client := apiv1connect.NewUserServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.GetProfileRequest{})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.GetProfile(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg), nil, nil
	})

	// --- Destinations ---

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_destinations",
		Description: "List all broadcast destinations (Twitch, YouTube, Kick, custom RTMP).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ emptyInput) (*mcp.CallToolResult, any, error) {
		client := apiv1connect.NewRtmpDestinationServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.ListStreamDestinationsRequest{})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.ListStreamDestinations(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Destinations), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "create_destination",
		Description: "Create a custom RTMP destination (for platforms not supported via OAuth). For Twitch/YouTube/Kick, use the dashboard or 'dazzle dest add' CLI command instead.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in createCustomDestInput) (*mcp.CallToolResult, any, error) {
		client := apiv1connect.NewRtmpDestinationServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.CreateStreamDestinationRequest{
			Name:      in.Name,
			Platform:  "custom",
			RtmpUrl:   in.RtmpURL,
			StreamKey: in.StreamKey,
		})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.CreateStreamDestination(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Destination), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "delete_destination",
		Description: "Delete a broadcast destination.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in destNameInput) (*mcp.CallToolResult, any, error) {
		id, err := resolveDestinationByNameOrID(appCtx, in.Destination)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewRtmpDestinationServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.DeleteStreamDestinationRequest{Id: id})
		r.Header().Set("Authorization", appCtx.authHeader())
		if _, err := client.DeleteStreamDestination(ctx, r); err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]string{"deleted": in.Destination}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "attach_destination",
		Description: "Attach a broadcast destination to a stage. The stage will stream to this destination when active.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in destAttachInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		destID, err := resolveDestinationByNameOrID(appCtx, in.Destination)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.AttachStageDestinationRequest{
			StageId:       stageID,
			DestinationId: destID,
		})
		r.Header().Set("Authorization", appCtx.authHeader())
		if _, err := client.AttachStageDestination(ctx, r); err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]string{"attached": in.Destination}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "detach_destination",
		Description: "Detach a broadcast destination from a stage.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in destAttachInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		destID, err := resolveDestinationByNameOrID(appCtx, in.Destination)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewStageServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.DetachStageDestinationRequest{
			StageId:       stageID,
			DestinationId: destID,
		})
		r.Header().Set("Authorization", appCtx.authHeader())
		if _, err := client.DetachStageDestination(ctx, r); err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]string{"detached": in.Destination}), nil, nil
	})

	// --- Content & runtime ---

	mcp.AddTool(s, &mcp.Tool{
		Name:        "sync",
		Description: "Sync a local directory to the stage. The directory must contain an index.html entry point. Files are diffed — only changed files are uploaded. The browser auto-refreshes after sync.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in syncInput) (*mcp.CallToolResult, any, error) {
		entry := in.Entry
		if entry == "" {
			entry = "index.html"
		}

		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}

		// Walk local directory and compute file hashes
		manifest, entries, totalSize, fileCount, err := walkAndHash(in.Directory)
		if err != nil {
			return nil, nil, fmt.Errorf("scanning directory: %w", err)
		}
		if fileCount > maxFileCount {
			return nil, nil, fmt.Errorf("directory contains %d files (max %d)", fileCount, maxFileCount)
		}
		if totalSize > maxSyncSize {
			return nil, nil, fmt.Errorf("directory is %dMB (max %dMB)", totalSize/(1024*1024), maxSyncSize/(1024*1024))
		}
		if _, ok := manifest[entry]; !ok {
			return nil, nil, fmt.Errorf("entry point %q not found in directory", entry)
		}

		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)

		// SyncDiff — determine which files need uploading
		diffReq := connect.NewRequest(&apiv1.SyncDiffRequest{
			StageId: stageID,
			Files:   manifest,
			Entry:   entry,
		})
		diffReq.Header().Set("Authorization", appCtx.authHeader())
		diffResp, err := client.SyncDiff(ctx, diffReq)
		if err != nil {
			return nil, nil, fmt.Errorf("sync diff: %w", err)
		}

		needSet := make(map[string]bool, len(diffResp.Msg.Need))
		for _, n := range diffResp.Msg.Need {
			needSet[n] = true
		}

		// Build tar of needed files
		tarBuf, err := buildTar(entries, needSet)
		if err != nil {
			return nil, nil, fmt.Errorf("building tar: %w", err)
		}

		// SyncPush — stream file contents
		stream := client.SyncPush(ctx)
		stream.RequestHeader().Set("Authorization", appCtx.authHeader())

		tarData := tarBuf.Bytes()
		if len(tarData) == 0 {
			if err := stream.Send(&apiv1.SyncPushRequest{StageId: stageID}); err != nil {
				return nil, nil, fmt.Errorf("sync push: %w", err)
			}
		} else {
			for i := 0; i < len(tarData); i += chunkSize {
				end := i + chunkSize
				if end > len(tarData) {
					end = len(tarData)
				}
				msg := &apiv1.SyncPushRequest{Chunk: tarData[i:end]}
				if i == 0 {
					msg.StageId = stageID
				}
				if err := stream.Send(msg); err != nil {
					return nil, nil, fmt.Errorf("sync push: %w", err)
				}
			}
		}

		resp, err := stream.CloseAndReceive()
		if err != nil {
			return nil, nil, fmt.Errorf("sync push: %w", err)
		}

		return mcpJSON(map[string]any{
			"synced":  resp.Msg.Synced,
			"deleted": resp.Msg.Deleted,
		}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "screenshot",
		Description: "Capture a screenshot of the stage's current browser output. Returns a PNG image. Requires an active stage.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.ScreenshotRequest{StageId: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.Screenshot(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.ImageContent{
					Data:     []byte(base64.StdEncoding.EncodeToString(resp.Msg.Image)),
					MIMEType: "image/png",
				},
			},
		}, nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "emit_event",
		Description: "Push a named event with JSON data to the running page — dispatched as a DOM CustomEvent. Use this for real-time updates without reloading.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in emitEventInput) (*mcp.CallToolResult, any, error) {
		if !json.Valid([]byte(in.Data)) {
			return nil, nil, fmt.Errorf("data must be valid JSON")
		}
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.EmitEventRequest{
			StageId: stageID,
			Event:   in.Event,
			Data:    in.Data,
		})
		r.Header().Set("Authorization", appCtx.authHeader())
		if _, err := client.EmitEvent(ctx, r); err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]bool{"ok": true}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_logs",
		Description: "Retrieve recent browser console logs (errors, warnings, info). Requires an active stage.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getLogsInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		limit := in.Limit
		if limit <= 0 {
			limit = 100
		}
		if limit > 1000 {
			limit = 1000
		}
		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.GetLogsRequest{
			StageId: stageID,
			Limit:   int32(limit),
		})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.GetLogs(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Entries), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "refresh",
		Description: "Reload the stage browser to the entry point. Note: sync already auto-refreshes, so this is only needed for manual reloads.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewRuntimeServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.RefreshRequest{StageId: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		if _, err := client.Refresh(ctx, r); err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]bool{"ok": true}), nil, nil
	})

	// --- Broadcast ---

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_stream_info",
		Description: "Get the current stream title, category, and platform from the connected streaming service.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in stageInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewBroadcastServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.GetStreamInfoRequest{StageId: stageID})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.GetStreamInfo(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]string{
			"title":    resp.Msg.Title,
			"category": resp.Msg.Category,
			"platform": resp.Msg.Platform,
		}), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "set_stream_info",
		Description: "Update the stream title and/or category on the connected platform (Twitch, YouTube, Kick).",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in setStreamInfoInput) (*mcp.CallToolResult, any, error) {
		if in.Title == "" && in.Category == "" {
			return nil, nil, fmt.Errorf("at least one of title or category must be provided")
		}
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewBroadcastServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		if in.Title != "" {
			r := connect.NewRequest(&apiv1.SetStreamTitleRequest{StageId: stageID, Title: in.Title})
			r.Header().Set("Authorization", appCtx.authHeader())
			if _, err := client.SetStreamTitle(ctx, r); err != nil {
				return nil, nil, err
			}
		}
		if in.Category != "" {
			r := connect.NewRequest(&apiv1.SetStreamCategoryRequest{StageId: stageID, Category: in.Category})
			r.Header().Set("Authorization", appCtx.authHeader())
			if _, err := client.SetStreamCategory(ctx, r); err != nil {
				return nil, nil, err
			}
		}
		result := map[string]string{"status": "updated"}
		if in.Title != "" {
			result["title"] = in.Title
		}
		if in.Category != "" {
			result["category"] = in.Category
		}
		return mcpJSON(result), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_chat",
		Description: "Read recent chat messages from the live stream.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in getChatInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		limit := in.Limit
		if limit <= 0 {
			limit = 20
		}
		if limit > 100 {
			limit = 100
		}
		client := apiv1connect.NewBroadcastServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.GetChatRequest{StageId: stageID, Limit: int32(limit)})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.GetChat(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(resp.Msg.Messages), nil, nil
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "send_chat",
		Description: "Send a message to the live stream chat.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, in sendChatInput) (*mcp.CallToolResult, any, error) {
		stageID, err := resolveStageForMCP(appCtx, in.Stage)
		if err != nil {
			return nil, nil, err
		}
		client := apiv1connect.NewBroadcastServiceClient(appCtx.HTTPClient, appCtx.APIURL)
		r := connect.NewRequest(&apiv1.SendChatRequest{StageId: stageID, Text: in.Message})
		r.Header().Set("Authorization", appCtx.authHeader())
		resp, err := client.SendChat(ctx, r)
		if err != nil {
			return nil, nil, err
		}
		return mcpJSON(map[string]string{"status": "sent", "platform": resp.Msg.Platform}), nil, nil
	})
}

// mcpJSON marshals v to JSON and returns it as an MCP text result.
func mcpJSON(v any) *mcp.CallToolResult {
	data, err := json.Marshal(v)
	if err != nil {
		r := &mcp.CallToolResult{IsError: true}
		r.Content = []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf("json marshal: %v", err)}}
		return r
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(data)}},
	}
}
