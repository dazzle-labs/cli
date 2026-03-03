package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/browser-streamer/session-manager/gen/api/v1"
)

type endpointServer struct {
	mgr *Manager
}

func (s *endpointServer) CreateEndpoint(ctx context.Context, req *connect.Request[apiv1.CreateEndpointRequest]) (*connect.Response[apiv1.CreateEndpointResponse], error) {
	info := mustAuth(ctx)

	name := req.Msg.Name
	if name == "" {
		name = "default"
	}

	id, err := dbCreateEndpoint(s.mgr.db, info.UserID, name)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create endpoint"))
	}

	return connect.NewResponse(&apiv1.CreateEndpointResponse{
		Endpoint: &apiv1.Endpoint{
			Id:        id,
			Name:      name,
			CreatedAt: timestamppb.Now(),
		},
	}), nil
}

func (s *endpointServer) ListEndpoints(ctx context.Context, req *connect.Request[apiv1.ListEndpointsRequest]) (*connect.Response[apiv1.ListEndpointsResponse], error) {
	info := mustAuth(ctx)

	rows, err := dbListEndpoints(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var endpoints []*apiv1.Endpoint
	for _, r := range rows {
		endpoints = append(endpoints, &apiv1.Endpoint{
			Id:        r.ID,
			Name:      r.Name,
			CreatedAt: timestamppb.New(r.CreatedAt),
		})
	}
	return connect.NewResponse(&apiv1.ListEndpointsResponse{Endpoints: endpoints}), nil
}

func (s *endpointServer) DeleteEndpoint(ctx context.Context, req *connect.Request[apiv1.DeleteEndpointRequest]) (*connect.Response[apiv1.DeleteEndpointResponse], error) {
	info := mustAuth(ctx)

	if err := dbDeleteEndpoint(s.mgr.db, req.Msg.Id, info.UserID); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}

	// Also terminate any running session for this endpoint
	s.mgr.deleteSession(req.Msg.Id)

	return connect.NewResponse(&apiv1.DeleteEndpointResponse{}), nil
}
