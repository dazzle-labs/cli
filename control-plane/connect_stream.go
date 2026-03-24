package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
)

// rtmpDestinationServer implements apiv1connect.RtmpDestinationServiceHandler.
type rtmpDestinationServer struct {
	mgr *Manager
}

func (s *rtmpDestinationServer) CreateStreamDestination(ctx context.Context, req *connect.Request[apiv1.CreateStreamDestinationRequest]) (*connect.Response[apiv1.CreateStreamDestinationResponse], error) {
	info := mustAuth(ctx)
	msg := req.Msg

	name := msg.Name
	if name == "" {
		name = msg.PlatformUsername
	}
	if name == "" || msg.RtmpUrl == "" || msg.StreamKey == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name, rtmp_url, and stream_key are required"))
	}
	if err := validateName(name); err != nil {
		return nil, err
	}

	platform := msg.Platform
	if platform == "" {
		platform = "custom"
	}
	encKey, err := encryptString(s.mgr.encryptionKey, msg.StreamKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	row, err := dbCreateStreamDest(s.mgr.db, info.UserID, name, platform, msg.RtmpUrl, encKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.CreateStreamDestinationResponse{
		Destination: streamDestToProto(row, true),
	}), nil
}

func (s *rtmpDestinationServer) ListStreamDestinations(ctx context.Context, req *connect.Request[apiv1.ListStreamDestinationsRequest]) (*connect.Response[apiv1.ListStreamDestinationsResponse], error) {
	info := mustAuth(ctx)

	rows, err := dbListStreamDests(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var dests []*apiv1.StreamDestination
	for _, r := range rows {
		dests = append(dests, streamDestToProto(&r, false))
	}
	return connect.NewResponse(&apiv1.ListStreamDestinationsResponse{
		Destinations:       dests,
		AvailablePlatforms: s.mgr.oauth.availablePlatforms(),
	}), nil
}

func (s *rtmpDestinationServer) UpdateStreamDestination(ctx context.Context, req *connect.Request[apiv1.UpdateStreamDestinationRequest]) (*connect.Response[apiv1.UpdateStreamDestinationResponse], error) {
	info := mustAuth(ctx)
	msg := req.Msg

	if msg.Name == "" || msg.RtmpUrl == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name and rtmp_url are required"))
	}

	var encKey string
	if msg.StreamKey != "" {
		var err error
		encKey, err = encryptString(s.mgr.encryptionKey, msg.StreamKey)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	row, err := dbUpdateStreamDest(s.mgr.db, msg.Id, info.UserID, msg.Name, msg.Platform, msg.RtmpUrl, encKey)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	return connect.NewResponse(&apiv1.UpdateStreamDestinationResponse{
		Destination: streamDestToProto(row, false),
	}), nil
}

func (s *rtmpDestinationServer) DeleteStreamDestination(ctx context.Context, req *connect.Request[apiv1.DeleteStreamDestinationRequest]) (*connect.Response[apiv1.DeleteStreamDestinationResponse], error) {
	info := mustAuth(ctx)

	if err := dbDeleteStreamDest(s.mgr.db, req.Msg.Id, info.UserID); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&apiv1.DeleteStreamDestinationResponse{}), nil
}

func streamDestToProto(r *streamDestRow, showKey bool) *apiv1.StreamDestination {
	key := maskStreamKey(r.StreamKey)
	if showKey {
		key = r.StreamKey
	}
	return &apiv1.StreamDestination{
		Id:               r.ID,
		Name:             r.Name,
		Platform:         r.Platform,
		PlatformUsername:  r.PlatformUsername,
		RtmpUrl:          r.RtmpURL,
		StreamKey:        key,
		CreatedAt:        timestamppb.New(r.CreatedAt),
		UpdatedAt:        timestamppb.New(r.UpdatedAt),
	}
}
