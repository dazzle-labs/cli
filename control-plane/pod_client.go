package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"time"
)

type podClient struct {
	httpClient *http.Client
	podToken   string
}

func newPodClient(podToken string) *podClient {
	return &podClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		podToken:   podToken,
	}
}

// ScriptResponse is the JSON body returned by GET /api/panel/main.
type ScriptResponse struct {
	Script string `json:"script"`
}

// LogEntry is a single browser console log entry returned by GET /api/logs.
type LogEntry struct {
	Level     string `json:"level"`
	Message   string `json:"message"`
	Timestamp string `json:"timestamp"`
}

func (p *podClient) GetScript(podIP string) (*ScriptResponse, error) {
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main?token=%s", podIP, url.QueryEscape(p.podToken))
	resp, err := p.httpClient.Get(podURL)
	if err != nil {
		return nil, fmt.Errorf("get script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get script: pod returned %d: %s", resp.StatusCode, string(body))
	}
	var result ScriptResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("get script: decode response: %w", err)
	}
	return &result, nil
}

func (p *podClient) SetScript(podIP, script string) error {
	body, _ := json.Marshal(map[string]string{"script": script})
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main?token=%s", podIP, url.QueryEscape(p.podToken))
	resp, err := p.httpClient.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("set script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("set script: pod returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (p *podClient) EditScript(podIP, oldStr, newStr string) error {
	body, _ := json.Marshal(map[string]string{"old_string": oldStr, "new_string": newStr})
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main/edit?token=%s", podIP, url.QueryEscape(p.podToken))
	resp, err := p.httpClient.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("edit script: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("edit script: pod returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (p *podClient) EmitEvent(podIP, event, data string) error {
	// data is expected to be a valid JSON object string
	var dataObj map[string]any
	if err := json.Unmarshal([]byte(data), &dataObj); err != nil {
		return fmt.Errorf("emit event: data must be valid JSON: %w", err)
	}
	body, _ := json.Marshal(map[string]any{"event": event, "data": dataObj})
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main/event?token=%s", podIP, url.QueryEscape(p.podToken))
	resp, err := p.httpClient.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("emit event: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("emit event: pod returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

func (p *podClient) GetLogs(podIP string, limit int) ([]LogEntry, error) {
	podURL := fmt.Sprintf("http://%s:8080/api/logs?limit=%d&token=%s", podIP, limit, url.QueryEscape(p.podToken))
	resp, err := p.httpClient.Get(podURL)
	if err != nil {
		return nil, fmt.Errorf("get logs: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("get logs: pod returned %d: %s", resp.StatusCode, string(body))
	}
	var entries []LogEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, fmt.Errorf("get logs: decode response: %w", err)
	}
	return entries, nil
}

// Screenshot captures a screenshot via OBS WebSocket and returns the raw PNG bytes.
func (p *podClient) Screenshot(podIP string) ([]byte, error) {
	b64, err := obsScreenshot(podIP)
	if err != nil {
		return nil, fmt.Errorf("screenshot: %w", err)
	}
	// Strip data URI prefix if present
	if idx := strings.Index(b64, ","); idx != -1 {
		b64 = b64[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("screenshot: decode base64: %w", err)
	}
	return data, nil
}

// ObsCommand executes a gobs-cli command against the pod's OBS instance.
func (p *podClient) ObsCommand(podIP string, args []string) (string, error) {
	cmdArgs := append([]string{"--host", podIP, "--port", "4455"}, args...)
	cmd := exec.Command("gobs-cli", cmdArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		errMsg := stderr.String()
		if errMsg == "" {
			errMsg = err.Error()
		}
		return "", fmt.Errorf("obs command: %s", errMsg)
	}
	out := stdout.String()
	if out == "" {
		out = "OK"
	}
	return out, nil
}
