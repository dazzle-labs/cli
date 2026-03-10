package main

import (
	"context"
	"fmt"
)

// PlatformClient provides platform-specific API operations.
type PlatformClient interface {
	GetStreamKey(ctx context.Context, token string, platformUserID string) (rtmpURL, streamKey string, err error)
	SetStreamInfo(ctx context.Context, token string, platformUserID string, title, category string) error
	GetChatMessages(ctx context.Context, token string, platformUserID string, limit int) ([]ChatMessage, error)
	SendChatMessage(ctx context.Context, token string, platformUserID string, message string) error
}

// ChatMessage is a normalized chat message across platforms.
type ChatMessage struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
	Platform  string `json:"platform"`
}

// GetPlatformClient returns the client for the given platform.
func GetPlatformClient(platform string) (PlatformClient, error) {
	switch platform {
	case "twitch":
		return &TwitchClient{}, nil
	case "youtube":
		return &YouTubeClient{}, nil
	case "kick":
		return &KickClient{}, nil
	case "restream":
		return &RestreamClient{}, nil
	default:
		return nil, fmt.Errorf("platform %q does not support metadata/chat tools — only Twitch, YouTube, Kick, and Restream are supported", platform)
	}
}
