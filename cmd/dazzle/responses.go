package main

// JSON response types for --json mode.
// These are the CLI's public contract for programmatic consumers.
// Do NOT change field names or remove fields without a major version bump.

// OKResponse is returned by mutation commands with no meaningful payload.
// Used by: emit, refresh, login (non-interactive).
type OKResponse struct {
	OK bool `json:"ok"`
}

// ErrorResponse is returned by commands that handle errors within JSON mode
// rather than falling through to the global error handler.
type ErrorResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// SyncResponse is returned by stage sync.
type SyncResponse struct {
	Synced  int32 `json:"synced"`
	Deleted int32 `json:"deleted"`
}

// BroadcastStatusResponse is returned by broadcast status.
type BroadcastStatusResponse struct {
	Active bool    `json:"active"`
	FPS    float64 `json:"fps"`
}

// BroadcastInfoResponse is returned by broadcast info.
type BroadcastInfoResponse struct {
	Title    string `json:"title"`
	Category string `json:"category"`
	Platform string `json:"platform"`
}

// BroadcastTitleResponse is returned by broadcast title.
type BroadcastTitleResponse struct {
	Title string `json:"title"`
}

// BroadcastCategoryResponse is returned by broadcast category.
type BroadcastCategoryResponse struct {
	Category string `json:"category"`
}

// ChatSendResponse is returned by chat send.
type ChatSendResponse struct {
	OK       bool   `json:"ok"`
	Platform string `json:"platform"`
}

// ScreenshotResponse is returned by stage screenshot.
type ScreenshotResponse struct {
	Path  string `json:"path"`
	Bytes int    `json:"bytes"`
	Image string `json:"image"`
}

// StageDeleteResponse is returned by stage delete.
type StageDeleteResponse struct {
	Deleted string `json:"deleted"`
}

// StageStatsResponse is returned by stage stats.
type StageStatsResponse struct {
	StageFPS              float64 `json:"stage_fps"`
	BroadcastFPS          float64 `json:"broadcast_fps"`
	DroppedFrames         int64   `json:"dropped_frames"`
	DroppedFramesRecent   int64   `json:"dropped_frames_recent"`
	TotalBytes            int64   `json:"total_bytes"`
	Broadcasting          bool    `json:"broadcasting"`
	BroadcastUptimeSeconds int64  `json:"broadcast_uptime_seconds"`
	StageUptimeSeconds    int64   `json:"stage_uptime_seconds"`
}

// VersionResponse is returned by version.
type VersionResponse struct {
	Version string `json:"version"`
	OS      string `json:"os"`
	Arch    string `json:"arch"`
}

// UpdateResponse is returned by update.
type UpdateResponse struct {
	OK       bool   `json:"ok"`
	Version  string `json:"version"`
	Updated  bool   `json:"updated"`
	Previous string `json:"previous,omitempty"`
}

// LoginResponse is returned by login (interactive, success).
type LoginResponse struct {
	Email   string `json:"email"`
	KeyName string `json:"key_name"`
}

// LogoutResponse is returned by logout.
type LogoutResponse struct {
	Status string `json:"status"`
}

// DestAddOAuthResponse is returned by destination add (OAuth flow).
type DestAddOAuthResponse struct {
	Platform         string `json:"platform"`
	PlatformUsername string `json:"platform_username"`
}

// DestDeleteResponse is returned by destination delete.
type DestDeleteResponse struct {
	Deleted string `json:"deleted"`
}

// DestAttachResponse is returned by destination attach.
type DestAttachResponse struct {
	StageID       string `json:"stage_id"`
	DestinationID string `json:"destination_id"`
}

// DestDetachResponse is returned by destination detach.
type DestDetachResponse struct {
	StageID       string `json:"stage_id"`
	DestinationID string `json:"destination_id"`
}
