package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// RestreamClient implements PlatformClient for Restream.
type RestreamClient struct{}

func (c *RestreamClient) GetStreamKey(ctx context.Context, token string, platformUserID string) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.restream.io/v2/user/streamKey", nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("restream streamKey endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		StreamKey string `json:"streamKey"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("failed to parse restream streamKey response: %w", err)
	}
	if result.StreamKey == "" {
		return "", "", fmt.Errorf("no stream key returned from Restream")
	}
	return "rtmp://live.restream.io/live", result.StreamKey, nil
}

func (c *RestreamClient) GetStreamInfo(ctx context.Context, token string, platformUserID string) (string, string, error) {
	return "", "", fmt.Errorf("GetStreamInfo not supported for Restream")
}

func (c *RestreamClient) SetStreamInfo(ctx context.Context, token string, platformUserID string, title, category string) error {
	return fmt.Errorf("Restream does not support setting stream info directly — set title/category on the underlying platforms instead")
}

func (c *RestreamClient) GetChatMessages(ctx context.Context, token string, platformUserID string, limit int) ([]ChatMessage, error) {
	return nil, fmt.Errorf("Restream chat reading is not supported — read chat from the underlying platforms instead")
}

func (c *RestreamClient) SendChatMessage(ctx context.Context, token string, platformUserID string, message string) error {
	return fmt.Errorf("Restream chat sending is not supported — send chat on the underlying platforms instead")
}
