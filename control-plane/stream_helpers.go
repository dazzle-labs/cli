package main

import (
	"fmt"
	"log"
)

// validateStreamDestination looks up the stage's assigned destination and validates it has
// a valid RTMP URL and decryptable stream key. Returns the validated row.
func (m *Manager) validateStreamDestination(stageID, userID string) (*streamDestRow, error) {
	if m.db == nil || userID == "" {
		return nil, fmt.Errorf("no stream destination configured — add one via the API before starting a stage")
	}

	row, err := dbGetStage(m.db, stageID)
	if err != nil {
		return nil, fmt.Errorf("failed to look up stage: %w", err)
	}
	if row == nil {
		return nil, fmt.Errorf("stage not found")
	}
	if !row.DestinationID.Valid || row.DestinationID.String == "" {
		return nil, fmt.Errorf("no stream destination configured for stage %s — select one in the dashboard", stageID)
	}

	dest, err := dbGetStreamDestForUser(m.db, row.DestinationID.String, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to look up stream destination: %w", err)
	}
	if dest == nil {
		return nil, fmt.Errorf("stream destination not found for stage %s — select one in the dashboard", stageID)
	}

	if dest.RtmpURL == "" {
		return nil, fmt.Errorf("stream destination '%s' has no RTMP URL configured", dest.PlatformUsername)
	}
	decryptedKey, err := decryptString(m.encryptionKey, dest.StreamKey)
	if err != nil {
		return nil, fmt.Errorf("stream destination '%s' has an invalid stream key: %w", dest.PlatformUsername, err)
	}
	// Store decrypted key for callers that need it (e.g. StartBroadcast)
	dest.StreamKey = decryptedKey

	return dest, nil
}

// resolvePlatformConnection finds the platform connection for the stage's active destination.
// OAuth fields (access token, platform user ID) are now on the streamDestRow itself.
func (m *Manager) resolvePlatformConnection(stageID, userID string) (PlatformClient, *streamDestRow, string, error) {
	if m.db == nil {
		return nil, nil, "", fmt.Errorf("database not available")
	}

	row, err := dbGetStage(m.db, stageID)
	if err != nil {
		return nil, nil, "", fmt.Errorf("failed to look up stage: %w", err)
	}
	if row == nil {
		return nil, nil, "", fmt.Errorf("stage not found")
	}
	if !row.DestinationID.Valid || row.DestinationID.String == "" {
		return nil, nil, "", fmt.Errorf("no stream destination configured for this stage — select one in the dashboard")
	}

	dest, err := dbGetStreamDestForUser(m.db, row.DestinationID.String, userID)
	if err != nil {
		return nil, nil, "", fmt.Errorf("failed to look up destination: %w", err)
	}
	if dest == nil {
		return nil, nil, "", fmt.Errorf("stream destination not found")
	}

	if dest.AccessToken == "" {
		return nil, nil, "", fmt.Errorf("no %s account connected — connect one at the dashboard Destinations page", dest.Platform)
	}

	client, err := GetPlatformClient(dest.Platform)
	if err != nil {
		return nil, nil, "", err
	}

	accessToken, err := refreshPlatformToken(m.db, m.encryptionKey, dest, m.oauth.configs)
	if err != nil {
		log.Printf("WARN: token refresh failed for %s/%s: %v", userID, dest.Platform, err)
	}

	return client, dest, accessToken, nil
}

