package main

import (
	"context"
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
		return &apiv1internal.GetFeaturedResponse{}
	}

	rows, err := s.mgr.db.Query(`
		SELECT s.slug, s.name, COALESCE(s.stream_title, ''), COALESCE(s.stream_category, '')
		FROM stages s
		WHERE s.featured = true AND s.slug IS NOT NULL
		AND EXISTS (SELECT 1 FROM rtmp_sessions rs WHERE rs.stage_id = s.id AND rs.ended_at IS NULL)
		ORDER BY RANDOM() LIMIT 3`)
	if err != nil {
		return &apiv1internal.GetFeaturedResponse{}
	}
	defer rows.Close()

	var streams []*apiv1internal.FeaturedStream
	for rows.Next() {
		var slug, name, title, category string
		if err := rows.Scan(&slug, &name, &title, &category); err != nil {
			continue
		}
		displayTitle := title
		if displayTitle == "" {
			displayTitle = name
		}
		streams = append(streams, &apiv1internal.FeaturedStream{
			Slug:     slug,
			Title:    displayTitle,
			Category: category,
		})
	}

	return &apiv1internal.GetFeaturedResponse{Streams: streams}
}
