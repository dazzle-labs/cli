package main

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/browser-streamer/control-plane/gen/api/v1"
)

// apiKeyServer implements apiv1connect.ApiKeyServiceHandler.
type apiKeyServer struct {
	mgr *Manager
}

func (s *apiKeyServer) CreateApiKey(ctx context.Context, req *connect.Request[apiv1.CreateApiKeyRequest]) (*connect.Response[apiv1.CreateApiKeyResponse], error) {
	info := mustAuth(ctx)

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}

	id, secret, prefix, err := dbCreateAPIKey(s.mgr.db, info.UserID, req.Msg.Name)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.CreateApiKeyResponse{
		Key: &apiv1.ApiKey{
			Id:        id,
			Name:      req.Msg.Name,
			Prefix:    prefix,
			CreatedAt: timestamppb.Now(),
		},
		Secret: secret,
	}), nil
}

func (s *apiKeyServer) ListApiKeys(ctx context.Context, req *connect.Request[apiv1.ListApiKeysRequest]) (*connect.Response[apiv1.ListApiKeysResponse], error) {
	info := mustAuth(ctx)

	rows, err := dbListAPIKeys(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var keys []*apiv1.ApiKey
	for _, r := range rows {
		k := &apiv1.ApiKey{
			Id:        r.ID,
			Name:      r.Name,
			Prefix:    r.Prefix,
			CreatedAt: timestamppb.New(r.CreatedAt),
		}
		if r.LastUsedAt != nil {
			k.LastUsedAt = timestamppb.New(*r.LastUsedAt)
		}
		keys = append(keys, k)
	}
	return connect.NewResponse(&apiv1.ListApiKeysResponse{Keys: keys}), nil
}

func (s *apiKeyServer) DeleteApiKey(ctx context.Context, req *connect.Request[apiv1.DeleteApiKeyRequest]) (*connect.Response[apiv1.DeleteApiKeyResponse], error) {
	info := mustAuth(ctx)

	if err := dbDeleteAPIKey(s.mgr.db, req.Msg.Id, info.UserID); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&apiv1.DeleteApiKeyResponse{}), nil
}
