package main

import (
	"context"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/browser-streamer/session-manager/gen/api/v1"
)

// sessionServer implements apiv1connect.SessionServiceHandler.
type sessionServer struct {
	mgr *Manager
}

func (s *sessionServer) CreateSession(ctx context.Context, req *connect.Request[apiv1.CreateSessionRequest]) (*connect.Response[apiv1.CreateSessionResponse], error) {
	info := mustAuth(ctx)

	sess, err := s.mgr.createSessionForUser(info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeResourceExhausted, err)
	}

	return connect.NewResponse(&apiv1.CreateSessionResponse{
		Session: sessionToProto(sess),
	}), nil
}

func (s *sessionServer) ListSessions(ctx context.Context, req *connect.Request[apiv1.ListSessionsRequest]) (*connect.Response[apiv1.ListSessionsResponse], error) {
	info := mustAuth(ctx)
	sessions := s.mgr.listSessionsForUser(info.UserID)

	var pbSessions []*apiv1.Session
	for _, sess := range sessions {
		pbSessions = append(pbSessions, sessionToProto(sess))
	}
	return connect.NewResponse(&apiv1.ListSessionsResponse{
		Sessions: pbSessions,
	}), nil
}

func (s *sessionServer) GetSession(ctx context.Context, req *connect.Request[apiv1.GetSessionRequest]) (*connect.Response[apiv1.GetSessionResponse], error) {
	info := mustAuth(ctx)
	sess, ok := s.mgr.getSession(req.Msg.Id)
	if !ok || sess.OwnerUserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	return connect.NewResponse(&apiv1.GetSessionResponse{
		Session: sessionToProto(sess),
	}), nil
}

func (s *sessionServer) DeleteSession(ctx context.Context, req *connect.Request[apiv1.DeleteSessionRequest]) (*connect.Response[apiv1.DeleteSessionResponse], error) {
	info := mustAuth(ctx)
	sess, ok := s.mgr.getSession(req.Msg.Id)
	if !ok || sess.OwnerUserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}
	if err := s.mgr.deleteSession(req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&apiv1.DeleteSessionResponse{}), nil
}

func sessionToProto(s *Session) *apiv1.Session {
	return &apiv1.Session{
		Id:           s.ID,
		PodName:      s.PodName,
		PodIp:        s.PodIP,
		DirectPort:   s.DirectPort,
		CreatedAt:    timestamppb.New(s.CreatedAt),
		Status:       string(s.Status),
		OwnerUserId:  s.OwnerUserID,
	}
}
