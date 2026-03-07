package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
)

// TwitchClient implements PlatformClient for Twitch Helix API.
type TwitchClient struct{}

func (c *TwitchClient) twitchRequest(ctx context.Context, method, url string, token string, body any) (*http.Response, error) {
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
	req.Header.Set("Client-Id", os.Getenv("TWITCH_CLIENT_ID"))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return http.DefaultClient.Do(req)
}

func (c *TwitchClient) GetStreamKey(ctx context.Context, token string, platformUserID string) (string, string, error) {
	resp, err := c.twitchRequest(ctx, "GET",
		"https://api.twitch.tv/helix/streams/key?broadcaster_id="+platformUserID,
		token, nil)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			StreamKey string `json:"stream_key"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}
	if len(result.Data) == 0 {
		return "", "", fmt.Errorf("no stream key returned")
	}
	return "rtmp://live.twitch.tv/app", result.Data[0].StreamKey, nil
}

func (c *TwitchClient) SetStreamInfo(ctx context.Context, token string, platformUserID string, title, category string) error {
	body := map[string]any{}
	if title != "" {
		body["title"] = title
	}
	if category != "" {
		gameID, err := c.resolveCategory(ctx, token, category)
		if err != nil {
			return fmt.Errorf("failed to resolve category %q: %w", category, err)
		}
		body["game_id"] = gameID
	}
	if len(body) == 0 {
		return nil
	}

	resp, err := c.twitchRequest(ctx, "PATCH",
		"https://api.twitch.tv/helix/channels?broadcaster_id="+platformUserID,
		token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("twitch channels update returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (c *TwitchClient) resolveCategory(ctx context.Context, token string, query string) (string, error) {
	resp, err := c.twitchRequest(ctx, "GET",
		"https://api.twitch.tv/helix/search/categories?query="+queryEscape(query),
		token, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if len(result.Data) == 0 {
		return "", fmt.Errorf("no category found for %q", query)
	}
	return result.Data[0].ID, nil
}

func (c *TwitchClient) GetChatMessages(ctx context.Context, token string, platformUserID string, limit int) ([]ChatMessage, error) {
	// Twitch chat via EventSub or IRC is complex for on-demand reads.
	// Use the chat messages endpoint (requires moderator scope or user scope).
	// For simplicity, return an informative message about Twitch chat limitations.
	return nil, fmt.Errorf("Twitch chat reading requires an active EventSub subscription. Use send_chat to send messages")
}

func (c *TwitchClient) SendChatMessage(ctx context.Context, token string, platformUserID string, message string) error {
	body := map[string]string{
		"broadcaster_id": platformUserID,
		"sender_id":      platformUserID,
		"message":        message,
	}

	resp, err := c.twitchRequest(ctx, "POST",
		"https://api.twitch.tv/helix/chat/messages",
		token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("twitch send chat returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func queryEscape(s string) string {
	return url.QueryEscape(s)
}
