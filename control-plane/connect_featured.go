package main

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"connectrpc.com/connect"

	apiv1internal "github.com/browser-streamer/control-plane/internal/gen/api/v1"
)

type featuredServer struct {
	mgr *Manager

	mu       sync.Mutex
	cached   *apiv1internal.GetFeaturedResponse
	cachedAt time.Time
}

const featuredCacheTTL = 2 * time.Minute

func (s *featuredServer) GetFeatured(ctx context.Context, req *connect.Request[apiv1internal.GetFeaturedRequest]) (*connect.Response[apiv1internal.GetFeaturedResponse], error) {
	s.mu.Lock()
	if s.cached != nil && time.Since(s.cachedAt) < featuredCacheTTL {
		resp := s.cached
		s.mu.Unlock()
		return connect.NewResponse(resp), nil
	}
	s.mu.Unlock()

	resp := s.fetchFeatured()

	s.mu.Lock()
	s.cached = resp
	s.cachedAt = time.Now()
	s.mu.Unlock()

	return connect.NewResponse(resp), nil
}

func (s *featuredServer) fetchFeatured() *apiv1internal.GetFeaturedResponse {
	if s.mgr.db == nil {
		return &apiv1internal.GetFeaturedResponse{Live: false}
	}

	var slug, name, title, category string
	err := s.mgr.db.QueryRow(`
		SELECT s.slug, s.name, COALESCE(s.stream_title, ''), COALESCE(s.stream_category, '')
		FROM rtmp_sessions rs
		JOIN stages s ON s.id = rs.stage_id
		WHERE rs.ended_at IS NULL AND s.slug IS NOT NULL
		ORDER BY RANDOM() LIMIT 1`).Scan(&slug, &name, &title, &category)
	if err == sql.ErrNoRows || err != nil {
		return &apiv1internal.GetFeaturedResponse{Live: false}
	}

	displayTitle := title
	if displayTitle == "" {
		displayTitle = name
	}

	return &apiv1internal.GetFeaturedResponse{
		Live:     true,
		Slug:     slug,
		Title:    displayTitle,
		Category: category,
	}
}
