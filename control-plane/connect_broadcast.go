package main

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	apiv1connect "github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// broadcastServer implements apiv1connect.BroadcastServiceHandler.
type broadcastServer struct {
	mgr *Manager
}

var _ apiv1connect.BroadcastServiceHandler = (*broadcastServer)(nil)

// mapResolvePlatformError converts errors from resolvePlatformConnection to connect codes.
func mapResolvePlatformError(err error) error {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "stage not found"), strings.Contains(msg, "stream destination not found"):
		return connect.NewError(connect.CodeNotFound, err)
	case strings.Contains(msg, "no stream destination configured"), strings.Contains(msg, "no stream destination configured for this stage"), strings.Contains(msg, "account connected"):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case strings.Contains(msg, "database not available"):
		return connect.NewError(connect.CodeInternal, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func (s *broadcastServer) GetStreamInfo(ctx context.Context, req *connect.Request[apiv1.GetStreamInfoRequest]) (*connect.Response[apiv1.GetStreamInfoResponse], error) {
	// 30s covers full method including DB lookup; increase if DB latency is a concern
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	info := mustAuth(ctx)
	client, dest, accessToken, err := s.mgr.resolvePlatformConnection(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, mapResolvePlatformError(err)
	}
	if accessToken == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("platform access token is missing — try reconnecting your %s account", dest.Platform))
	}

	title, category, err := client.GetStreamInfo(ctx, accessToken, dest.PlatformUserID)
	if err != nil {
		if strings.Contains(err.Error(), "not supported") {
			return nil, connect.NewError(connect.CodeUnimplemented, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.GetStreamInfoResponse{
		Title:    title,
		Category: category,
		Platform: dest.Platform,
	}), nil
}

func (s *broadcastServer) SetStreamTitle(ctx context.Context, req *connect.Request[apiv1.SetStreamTitleRequest]) (*connect.Response[apiv1.SetStreamTitleResponse], error) {
	// 30s covers full method including DB lookup; increase if DB latency is a concern
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	info := mustAuth(ctx)
	client, dest, accessToken, err := s.mgr.resolvePlatformConnection(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, mapResolvePlatformError(err)
	}
	if accessToken == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("platform access token is missing — try reconnecting your %s account", dest.Platform))
	}

	// Pass "" for category — existing platform implementations skip updating a field when "" is passed.
	// No server-side validation of non-empty title; validation lives in the CLI only.
	if err := client.SetStreamInfo(ctx, accessToken, dest.PlatformUserID, req.Msg.Title, ""); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.SetStreamTitleResponse{Title: req.Msg.Title}), nil
}

func (s *broadcastServer) SetStreamCategory(ctx context.Context, req *connect.Request[apiv1.SetStreamCategoryRequest]) (*connect.Response[apiv1.SetStreamCategoryResponse], error) {
	// 30s covers full method including DB lookup; increase if DB latency is a concern
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	info := mustAuth(ctx)
	client, dest, accessToken, err := s.mgr.resolvePlatformConnection(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, mapResolvePlatformError(err)
	}
	if accessToken == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("platform access token is missing — try reconnecting your %s account", dest.Platform))
	}

	// Pass "" for title — existing platform implementations skip updating a field when "" is passed.
	// No server-side validation of non-empty category; validation lives in the CLI only.
	if err := client.SetStreamInfo(ctx, accessToken, dest.PlatformUserID, "", req.Msg.Category); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.SetStreamCategoryResponse{Category: req.Msg.Category}), nil
}

func (s *broadcastServer) GetChat(ctx context.Context, req *connect.Request[apiv1.GetChatRequest]) (*connect.Response[apiv1.GetChatResponse], error) {
	// 30s covers full method including DB lookup; increase if DB latency is a concern
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	info := mustAuth(ctx)
	client, dest, accessToken, err := s.mgr.resolvePlatformConnection(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, mapResolvePlatformError(err)
	}
	if accessToken == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("platform access token is missing — try reconnecting your %s account", dest.Platform))
	}

	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = 20
	}

	messages, err := client.GetChatMessages(ctx, accessToken, dest.PlatformUserID, limit)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "EventSub") || strings.Contains(msg, "WebSocket") || strings.Contains(msg, "not supported") {
			return nil, connect.NewError(connect.CodeUnimplemented, err)
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var pbEntries []*apiv1.ChatMessage
	for _, m := range messages {
		ts, parseErr := time.Parse(time.RFC3339, m.Timestamp)
		if parseErr != nil {
			log.Printf("WARN: skipping chat message with unparseable timestamp for author %s: %v", m.Author, parseErr)
			continue
		}
		// id not available from platform API in v1 for some platforms
		id := m.ID
		pbEntries = append(pbEntries, &apiv1.ChatMessage{
			Id:        id,
			Author:    m.Author,
			Text:      m.Message,
			Timestamp: timestamppb.New(ts),
			Platform:  dest.Platform,
		})
	}

	// Sort ascending by timestamp (oldest first)
	sort.Slice(pbEntries, func(i, j int) bool {
		return pbEntries[i].Timestamp.AsTime().Before(pbEntries[j].Timestamp.AsTime())
	})

	return connect.NewResponse(&apiv1.GetChatResponse{Messages: pbEntries}), nil
}

func (s *broadcastServer) SendChat(ctx context.Context, req *connect.Request[apiv1.SendChatRequest]) (*connect.Response[apiv1.SendChatResponse], error) {
	// 30s covers full method including DB lookup; increase if DB latency is a concern
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	info := mustAuth(ctx)
	client, dest, accessToken, err := s.mgr.resolvePlatformConnection(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, mapResolvePlatformError(err)
	}
	if accessToken == "" {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("platform access token is missing — try reconnecting your %s account", dest.Platform))
	}

	if err := client.SendChatMessage(ctx, accessToken, dest.PlatformUserID, req.Msg.Text); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.SendChatResponse{Platform: dest.Platform}), nil
}
