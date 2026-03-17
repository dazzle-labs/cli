package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// KickClient implements PlatformClient for Kick Public API.
type KickClient struct{}

// kickChannelData is the normalized channel data from GET /public/v1/channels.
type kickChannelData struct {
	Stream struct {
		Key string `json:"key"`
	} `json:"stream"`
	StreamTitle string `json:"stream_title"`
	Category    struct {
		Name string `json:"name"`
	} `json:"category"`
}

func kickRequest(ctx context.Context, method, url string, token string, body any) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return http.DefaultClient.Do(req)
}

// fetchKickChannelData calls GET /public/v1/channels and returns the first channel's data.
func (c *KickClient) fetchKickChannelData(ctx context.Context, token string) (*kickChannelData, error) {
	resp, err := kickRequest(ctx, "GET", "https://api.kick.com/public/v1/channels", token, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read kick channels response: %w", err)
	}
	var result struct {
		Data []kickChannelData `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse kick channels response: %w", err)
	}
	if len(result.Data) == 0 {
		return nil, fmt.Errorf("no channel data returned from Kick")
	}
	return &result.Data[0], nil
}

func (c *KickClient) GetStreamKey(ctx context.Context, token string, platformUserID string) (string, string, error) {
	data, err := c.fetchKickChannelData(ctx, token)
	if err != nil {
		return "", "", err
	}
	streamKey := data.Stream.Key
	if streamKey == "" {
		return "", "", fmt.Errorf("no stream key found in Kick channel data")
	}
	return "rtmps://fa723fc1b171.global-contribute.live-video.net:443/app", streamKey, nil
}

func (c *KickClient) GetStreamInfo(ctx context.Context, token string, platformUserID string) (string, string, error) {
	data, err := c.fetchKickChannelData(ctx, token)
	if err != nil {
		return "", "", err
	}
	if data.StreamTitle == "" && data.Category.Name == "" {
		return "", "", fmt.Errorf("GetStreamInfo not supported for Kick")
	}
	return data.StreamTitle, data.Category.Name, nil
}

func (c *KickClient) SetStreamInfo(ctx context.Context, token string, platformUserID string, title, category string) error {
	body := map[string]any{}
	if title != "" {
		body["stream_title"] = title
	}
	if category != "" {
		catID, err := c.resolveCategory(ctx, token, category)
		if err != nil {
			return fmt.Errorf("failed to resolve category %q: %w", category, err)
		}
		body["category_id"] = catID
	}
	if len(body) == 0 {
		return nil
	}

	resp, err := kickRequest(ctx, "PATCH", "https://api.kick.com/public/v1/channels", token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("kick channel update returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (c *KickClient) resolveCategory(ctx context.Context, token string, query string) (int, error) {
	resp, err := kickRequest(ctx, "GET",
		"https://api.kick.com/public/v2/categories?name="+queryEscape(query),
		token, nil)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, err
	}
	if len(result.Data) == 0 {
		return 0, fmt.Errorf("no category found for %q", query)
	}
	return result.Data[0].ID, nil
}

func (c *KickClient) GetChatMessages(ctx context.Context, token string, platformUserID string, limit int) ([]ChatMessage, error) {
	// Kick chat is via Pusher WebSocket — for on-demand reads, this is not practical
	// without maintaining a persistent connection. Return a helpful message.
	return nil, fmt.Errorf("Kick chat reading requires a persistent WebSocket connection. Use send_chat to send messages")
}

func (c *KickClient) SendChatMessage(ctx context.Context, token string, platformUserID string, message string) error {
	if len(message) > 500 {
		message = message[:500]
	}

	body := map[string]any{
		"type":                "user",
		"content":             message,
		"broadcaster_user_id": json.Number(platformUserID),
	}

	resp, err := kickRequest(ctx, "POST", "https://api.kick.com/public/v1/chat", token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("kick send chat returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
