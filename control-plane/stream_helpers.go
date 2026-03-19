package main

import (
	"fmt"
	"log"
)

// resolvePlatformConnection finds the platform connection for a destination.
// If destinationID is provided, uses that directly. Otherwise falls back to
// the first non-dazzle destination linked to the stage.
func (m *Manager) resolvePlatformConnection(stageID, userID, destinationID string) (PlatformClient, *streamDestRow, string, error) {
	if m.db == nil {
		return nil, nil, "", fmt.Errorf("database not available")
	}

	// If no specific destination requested, find the first non-dazzle destination linked to this stage
	if destinationID == "" {
		dests, err := dbListStageDestinations(m.db, stageID)
		if err != nil {
			return nil, nil, "", fmt.Errorf("failed to list stage destinations: %w", err)
		}
		for _, d := range dests {
			if d.Platform != "dazzle" {
				destinationID = d.DestinationID
				break
			}
		}
		if destinationID == "" {
			return nil, nil, "", fmt.Errorf("no stream destination configured for this stage — add one in the dashboard")
		}
	}

	dest, err := dbGetStreamDestForUser(m.db, destinationID, userID)
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

