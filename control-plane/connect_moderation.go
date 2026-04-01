package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"connectrpc.com/connect"
	"github.com/clerk/clerk-sdk-go/v2/user"

	apiv1internal "github.com/browser-streamer/control-plane/internal/gen/api/v1"
)

type moderationServer struct {
	mgr *Manager
}

func (s *moderationServer) GetStageOwner(ctx context.Context, req *connect.Request[apiv1internal.GetStageOwnerRequest]) (*connect.Response[apiv1internal.GetStageOwnerResponse], error) {
	if _, err := requireDeveloper(ctx); err != nil {
		return nil, err
	}

	idOrSlug := req.Msg.StageId
	if idOrSlug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("stage_id is required"))
	}
	if id, err := resolveStageID(s.mgr, idOrSlug); err == nil {
		idOrSlug = id
	}
	row, err := dbGetStage(s.mgr.db, idOrSlug)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}

	email, name, _, _, _, dbErr := dbGetUserProfile(s.mgr.db, row.UserID)
	if dbErr != nil {
		log.Printf("WARN: failed to look up user %s: %v", row.UserID, dbErr)
	}

	// DB often has empty email/name — fall back to Clerk API
	if email == "" && name == "" {
		if clerkUser, err := user.Get(ctx, row.UserID); err != nil {
			log.Printf("WARN: Clerk user lookup failed for %s: %v", row.UserID, err)
		} else if clerkUser != nil {
			if clerkUser.FirstName != nil {
				name = *clerkUser.FirstName
			}
			if clerkUser.LastName != nil {
				if name != "" {
					name += " "
				}
				name += *clerkUser.LastName
			}
			if clerkUser.PrimaryEmailAddressID != nil {
				for _, ea := range clerkUser.EmailAddresses {
					if ea.ID == *clerkUser.PrimaryEmailAddressID {
						email = ea.EmailAddress
						break
					}
				}
			}
		}
	}

	return connect.NewResponse(&apiv1internal.GetStageOwnerResponse{
		UserId: row.UserID,
		Email:  email,
		Name:   name,
	}), nil
}

func (s *moderationServer) DeleteStage(ctx context.Context, req *connect.Request[apiv1internal.DeleteStageRequest]) (*connect.Response[apiv1internal.DeleteStageResponse], error) {
	info, err := requireDeveloper(ctx)
	if err != nil {
		return nil, err
	}

	idOrSlug := req.Msg.StageId
	if idOrSlug == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("stage_id is required"))
	}
	if id, err := resolveStageID(s.mgr, idOrSlug); err == nil {
		idOrSlug = id
	}
	row, err := dbGetStage(s.mgr.db, idOrSlug)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}

	log.Printf("MODERATION: user %s deleting stage %s (owner: %s)", info.UserID, row.ID, row.UserID)

	// Capture pod info before deletion (needed for wait)
	var podName string
	if live, ok := s.mgr.getStage(row.ID); ok {
		podName = live.PodName
	}

	// Stop pod if active
	s.mgr.deleteStage(row.ID)

	// Use background context so client cancellation doesn't skip cleanup
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cleanupCancel()

	// Wait for pod termination (skip GPU stages — no local k8s pods)
	if podName != "" && !hasCapability(row.Capabilities, "gpu") {
		waitForPodTermination(cleanupCtx, s.mgr.clientset, s.mgr.namespace, podName, 35*time.Second)
	}

	// Best-effort R2 cleanup
	if s.mgr.r2Client != nil {
		prefix := "users/" + row.UserID + "/stages/" + row.ID + "/"
		if err := s.mgr.r2Client.DeletePrefix(cleanupCtx, prefix); err != nil {
			log.Printf("WARN: r2 cleanup for stage %s: %v", row.ID, err)
		}
	}

	// Remove DB record — pass row.UserID to satisfy the ownership check in SQL
	if err := dbDeleteStage(s.mgr.db, row.ID, row.UserID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1internal.DeleteStageResponse{}), nil
}

func (s *moderationServer) BanUser(ctx context.Context, req *connect.Request[apiv1internal.BanUserRequest]) (*connect.Response[apiv1internal.BanUserResponse], error) {
	info, err := requireDeveloper(ctx)
	if err != nil {
		return nil, err
	}

	userID := req.Msg.UserId
	if userID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("user_id is required"))
	}

	if userID == info.UserID {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("cannot ban yourself"))
	}

	log.Printf("MODERATION: user %s banning user %s", info.UserID, userID)

	// Mark banned in our DB so API key auth is also blocked
	if err := dbBanUser(s.mgr.db, userID); err != nil {
		log.Printf("ERROR: failed to ban user %s in DB: %v", userID, err)
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to ban user"))
	}

	// Ban via Clerk API (blocks JWT-based auth)
	if _, err := user.Ban(context.Background(), userID); err != nil {
		log.Printf("ERROR: failed to ban user %s via Clerk: %v", userID, err)
		// Don't fail — the DB ban is already in effect
	}

	// Deactivate all running stages owned by this user
	stages, _ := dbListStages(s.mgr.db, userID)
	for _, st := range stages {
		if st.Status == "running" || st.Status == "starting" {
			s.mgr.deactivateStage(st.ID)
		}
	}

	return connect.NewResponse(&apiv1internal.BanUserResponse{}), nil
}
