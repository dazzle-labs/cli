package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type pollResult struct {
	Status           string `json:"status"`
	Token            string `json:"token,omitempty"`
	Email            string `json:"email,omitempty"`
	KeyName          string `json:"key_name,omitempty"`
	Platform         string `json:"platform,omitempty"`
	PlatformUsername string `json:"platform_username,omitempty"`
	Error            string `json:"error,omitempty"`
}

func pollCliSession(apiURL, sessionID string, timeout time.Duration) (*pollResult, error) {
	pollURL := apiURL + "/auth/cli/session/" + sessionID + "/poll"
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	deadline := time.After(timeout)

	for {
		select {
		case <-deadline:
			return nil, fmt.Errorf("timed out")
		case <-ticker.C:
			resp, err := http.Get(pollURL)
			if err != nil {
				continue // transient network error, retry
			}

			var result pollResult
			json.NewDecoder(resp.Body).Decode(&result)
			resp.Body.Close()

			switch result.Status {
			case "complete":
				return &result, nil
			case "expired":
				return nil, fmt.Errorf("session expired")
			case "pending":
				continue
			default:
				if result.Error != "" {
					return nil, fmt.Errorf("%s", result.Error)
				}
				continue
			}
		}
	}
}
