package main

import (
	"context"

	"connectrpc.com/connect"

	apiv1 "github.com/browser-streamer/session-manager/gen/api/v1"
)

// userServer implements apiv1connect.UserServiceHandler.
type userServer struct {
	mgr *Manager
}

func (s *userServer) GetProfile(ctx context.Context, req *connect.Request[apiv1.GetProfileRequest]) (*connect.Response[apiv1.GetProfileResponse], error) {
	info := mustAuth(ctx)

	email, name, sessionCount, apiKeyCount, err := dbGetUserProfile(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.GetProfileResponse{
		UserId:       info.UserID,
		Email:        email,
		Name:         name,
		SessionCount: int32(sessionCount),
		ApiKeyCount:  int32(apiKeyCount),
	}), nil
}
