package main

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1internal "github.com/browser-streamer/control-plane/internal/gen/api/v1"
)

// apiKeyServer implements ApiKeyServiceHandler.
type apiKeyServer struct {
	mgr *Manager
}

func (s *apiKeyServer) CreateApiKey(ctx context.Context, req *connect.Request[apiv1internal.CreateApiKeyRequest]) (*connect.Response[apiv1internal.CreateApiKeyResponse], error) {
	info := mustAuth(ctx)

	if req.Msg.Name == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, nil)
	}
	if err := validateName(req.Msg.Name); err != nil {
		return nil, err
	}

	id, secret, prefix, err := dbCreateAPIKey(s.mgr.db, info.UserID, req.Msg.Name)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1internal.CreateApiKeyResponse{
		Key: &apiv1internal.ApiKey{
			Id:        id,
			Name:      req.Msg.Name,
			Prefix:    prefix,
			CreatedAt: timestamppb.Now(),
		},
		Secret: secret,
	}), nil
}

func (s *apiKeyServer) ListApiKeys(ctx context.Context, req *connect.Request[apiv1internal.ListApiKeysRequest]) (*connect.Response[apiv1internal.ListApiKeysResponse], error) {
	info := mustAuth(ctx)

	rows, err := dbListAPIKeys(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var keys []*apiv1internal.ApiKey
	for _, r := range rows {
		k := &apiv1internal.ApiKey{
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
	return connect.NewResponse(&apiv1internal.ListApiKeysResponse{Keys: keys}), nil
}

func (s *apiKeyServer) DeleteApiKey(ctx context.Context, req *connect.Request[apiv1internal.DeleteApiKeyRequest]) (*connect.Response[apiv1internal.DeleteApiKeyResponse], error) {
	info := mustAuth(ctx)

	if err := dbDeleteAPIKey(s.mgr.db, req.Msg.Id, info.UserID); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&apiv1internal.DeleteApiKeyResponse{}), nil
}
