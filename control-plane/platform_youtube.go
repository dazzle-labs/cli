package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// YouTubeClient implements PlatformClient for YouTube Data API v3.
type YouTubeClient struct{}

// checkYouTubeResponse reads the response body and returns an error if the
// status code is not 2xx. This prevents auth failures (401/403) from being
// silently swallowed and misreported as "no broadcast found".
func checkYouTubeResponse(resp *http.Response) ([]byte, error) {
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read YouTube response: %w", err)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return body, nil
	}
	return nil, fmt.Errorf("YouTube API returned %d: %s", resp.StatusCode, string(body))
}

// ytBroadcast holds fields needed across broadcast queries.
type ytBroadcast struct {
	ID      string `json:"id"`
	Snippet struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		ChannelID   string `json:"channelId"`
		LiveChatID  string `json:"liveChatId"`
	} `json:"snippet"`
	Status struct {
		LifeCycleStatus string `json:"lifeCycleStatus"`
	} `json:"status"`
}

// getMyBroadcasts fetches all broadcasts for the authenticated user and returns
// those matching the given lifecycle statuses. YouTube's API does not allow
// mine=true with broadcastStatus, so we filter client-side.
func getMyBroadcasts(ctx context.Context, token string, statuses ...string) ([]ytBroadcast, error) {
	resp, err := youtubeRequest(ctx, "GET",
		"https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&mine=true&maxResults=50",
		token, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := checkYouTubeResponse(resp)
	if err != nil {
		return nil, err
	}

	var result struct {
		Items []ytBroadcast `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	if len(statuses) == 0 {
		return result.Items, nil
	}

	allowed := make(map[string]bool, len(statuses))
	for _, s := range statuses {
		allowed[s] = true
	}
	var filtered []ytBroadcast
	for _, bc := range result.Items {
		if allowed[bc.Status.LifeCycleStatus] {
			filtered = append(filtered, bc)
		}
	}
	return filtered, nil
}

func youtubeRequest(ctx context.Context, method, url string, token string, body any) (*http.Response, error) {
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

func (c *YouTubeClient) GetStreamKey(ctx context.Context, token string, platformUserID string) (string, string, error) {
	resp, err := youtubeRequest(ctx, "GET",
		"https://www.googleapis.com/youtube/v3/liveStreams?part=cdn&mine=true",
		token, nil)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, err := checkYouTubeResponse(resp)
	if err != nil {
		return "", "", err
	}

	var result struct {
		Items []struct {
			CDN struct {
				IngestionInfo struct {
					StreamName       string `json:"streamName"`
					IngestionAddress string `json:"ingestionAddress"`
				} `json:"ingestionInfo"`
			} `json:"cdn"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", err
	}
	if len(result.Items) == 0 {
		return "", "", fmt.Errorf("no live stream found — create one in YouTube Studio first")
	}
	info := result.Items[0].CDN.IngestionInfo
	return info.IngestionAddress, info.StreamName, nil
}

func (c *YouTubeClient) GetStreamInfo(ctx context.Context, token string, platformUserID string) (string, string, error) {
	// Try active first, then upcoming
	bcs, err := getMyBroadcasts(ctx, token, "live", "liveStarting")
	if err != nil {
		return "", "", err
	}
	if len(bcs) == 0 {
		bcs, err = getMyBroadcasts(ctx, token, "ready", "created")
		if err != nil {
			return "", "", err
		}
	}
	if len(bcs) == 0 {
		return "", "", nil
	}
	return bcs[0].Snippet.Title, "", nil
}

func (c *YouTubeClient) SetStreamInfo(ctx context.Context, token string, platformUserID string, title, category string) error {
	// Try active first, then upcoming
	bcs, err := getMyBroadcasts(ctx, token, "live", "liveStarting")
	if err != nil {
		return err
	}
	if len(bcs) == 0 {
		bcs, err = getMyBroadcasts(ctx, token, "ready", "created")
		if err != nil {
			return err
		}
	}
	if len(bcs) == 0 {
		return fmt.Errorf("no active or upcoming broadcast found")
	}

	bc := bcs[0]
	snippet := map[string]any{
		"title":              bc.Snippet.Title,
		"description":        bc.Snippet.Description,
		"scheduledStartTime": "2025-01-01T00:00:00Z",
	}
	if title != "" {
		snippet["title"] = title
	}

	updateBody := map[string]any{
		"id":      bc.ID,
		"snippet": snippet,
	}

	resp, err := youtubeRequest(ctx, "PUT",
		"https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet",
		token, updateBody)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("youtube broadcast update returned %d: %s", resp.StatusCode, string(body))
	}

	if category != "" {
		if err := c.updateVideoCategory(ctx, token, bc.ID, category); err != nil {
			return fmt.Errorf("failed to update category: %w", err)
		}
	}

	return nil
}

func (c *YouTubeClient) updateVideoCategory(ctx context.Context, token, videoID, categoryID string) error {
	// YouTube category IDs are numeric (e.g., "20" for Gaming, "24" for Entertainment)
	body := map[string]any{
		"id": videoID,
		"snippet": map[string]any{
			"categoryId": categoryID,
		},
	}

	resp, err := youtubeRequest(ctx, "PUT",
		"https://www.googleapis.com/youtube/v3/videos?part=snippet",
		token, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("youtube video category update returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (c *YouTubeClient) GetChatMessages(ctx context.Context, token string, platformUserID string, limit int) ([]ChatMessage, error) {
	bcs, err := getMyBroadcasts(ctx, token, "live", "liveStarting")
	if err != nil {
		return nil, err
	}
	if len(bcs) == 0 {
		return nil, fmt.Errorf("no active broadcast found")
	}

	chatID := bcs[0].Snippet.LiveChatID
	if chatID == "" {
		return nil, fmt.Errorf("no live chat ID found for active broadcast")
	}

	// Fetch chat messages
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	chatResp, err := youtubeRequest(ctx, "GET",
		fmt.Sprintf("https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=%s&part=snippet,authorDetails&maxResults=%d", chatID, limit),
		token, nil)
	if err != nil {
		return nil, err
	}
	defer chatResp.Body.Close()

	chatBody, err := checkYouTubeResponse(chatResp)
	if err != nil {
		return nil, err
	}

	var chatResult struct {
		Items []struct {
			ID            string `json:"id"`
			AuthorDetails struct {
				DisplayName string `json:"displayName"`
			} `json:"authorDetails"`
			Snippet struct {
				DisplayMessage  string `json:"displayMessage"`
				PublishedAt     string `json:"publishedAt"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.Unmarshal(chatBody, &chatResult); err != nil {
		return nil, err
	}

	var messages []ChatMessage
	for _, item := range chatResult.Items {
		messages = append(messages, ChatMessage{
			ID:        item.ID,
			Author:    item.AuthorDetails.DisplayName,
			Message:   item.Snippet.DisplayMessage,
			Timestamp: item.Snippet.PublishedAt,
			Platform:  "youtube",
		})
	}
	return messages, nil
}

func (c *YouTubeClient) SendChatMessage(ctx context.Context, token string, platformUserID string, message string) error {
	bcs, err := getMyBroadcasts(ctx, token, "live", "liveStarting")
	if err != nil {
		return err
	}
	if len(bcs) == 0 {
		return fmt.Errorf("no active broadcast found")
	}

	chatID := bcs[0].Snippet.LiveChatID
	reqBody := map[string]any{
		"snippet": map[string]any{
			"liveChatId": chatID,
			"type":       "textMessageEvent",
			"textMessageDetails": map[string]string{
				"messageText": message,
			},
		},
	}

	chatResp, err := youtubeRequest(ctx, "POST",
		"https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
		token, reqBody)
	if err != nil {
		return err
	}
	defer chatResp.Body.Close()

	if chatResp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(chatResp.Body)
		return fmt.Errorf("youtube send chat returned %d: %s", chatResp.StatusCode, string(respBody))
	}
	return nil
}
