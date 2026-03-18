package runpod

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const restBaseURL = "https://rest.runpod.io/v1"

// Client is a RunPod REST API client.
type Client struct {
	apiKey     string
	httpClient *http.Client
}

// NewClient creates a new RunPod API client.
func NewClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CreatePod creates a new RunPod pod via the REST API.
func (c *Client) CreatePod(ctx context.Context, input PodInput) (*Pod, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("marshal pod input: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", restBaseURL+"/pods", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("create pod: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return nil, c.readError(resp, "create pod")
	}

	var pod Pod
	if err := c.decodeBody(resp.Body, &pod); err != nil {
		return nil, fmt.Errorf("decode create pod response: %w", err)
	}
	return &pod, nil
}

// GetPod retrieves a RunPod pod by ID.
func (c *Client) GetPod(ctx context.Context, podID string) (*Pod, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", restBaseURL+"/pods/"+podID, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get pod: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, &ErrNotFound{PodID: podID}
	}
	if resp.StatusCode != http.StatusOK {
		return nil, c.readError(resp, "get pod")
	}

	var pod Pod
	if err := c.decodeBody(resp.Body, &pod); err != nil {
		return nil, fmt.Errorf("decode get pod response: %w", err)
	}
	return &pod, nil
}

// TerminatePod deletes a RunPod pod.
func (c *Client) TerminatePod(ctx context.Context, podID string) error {
	req, err := http.NewRequestWithContext(ctx, "DELETE", restBaseURL+"/pods/"+podID, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	c.setHeaders(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("terminate pod: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil // already gone
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return c.readError(resp, "terminate pod")
	}
	return nil
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
}

func (c *Client) readError(resp *http.Response, action string) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	return fmt.Errorf("%s: status %d: %s", action, resp.StatusCode, string(body))
}

// decodeBody decodes the JSON response body into the target, handling the
// RunPod portMappings object format.
//
// The REST API returns portMappings as {"internalPort": externalPort}, e.g.:
//
//	{"60443": 11866, "60444": 11867}
//
// We also handle the case where RunPod returns external ports as keys
// (positional mapping to the ports array).
func (c *Client) decodeBody(body io.Reader, pod *Pod) error {
	var raw json.RawMessage
	if err := json.NewDecoder(body).Decode(&raw); err != nil {
		return err
	}

	if err := json.Unmarshal(raw, pod); err != nil {
		return err
	}

	// Parse portMappings as a flat object {string: int}
	var wrapper struct {
		PortMappings map[string]int `json:"portMappings"`
		Ports        []string       `json:"ports"`
	}
	if err := json.Unmarshal(raw, &wrapper); err == nil && len(wrapper.PortMappings) > 0 {
		pod.PortMappings = make(map[string]int)

		// Check if any key matches a requested internal port (e.g. "60443": 11866)
		hasInternalKey := false
		for _, p := range wrapper.Ports {
			// Strip protocol suffix (e.g. "60443/tcp" -> "60443")
			port := p
			if idx := strings.Index(p, "/"); idx != -1 {
				port = p[:idx]
			}
			if _, ok := wrapper.PortMappings[port]; ok {
				hasInternalKey = true
				break
			}
		}

		if hasInternalKey {
			// Keys are internal ports — use directly
			for k, v := range wrapper.PortMappings {
				pod.PortMappings[k] = v
			}
		} else {
			// Keys are external ports — map positionally from ports array
			// Sort external ports to establish consistent ordering
			var extPorts []int
			for _, v := range wrapper.PortMappings {
				extPorts = append(extPorts, v)
			}
			sort.Ints(extPorts)

			for i, p := range wrapper.Ports {
				port := p
				if idx := strings.Index(p, "/"); idx != -1 {
					port = p[:idx]
				}
				if i < len(extPorts) {
					pod.PortMappings[port] = extPorts[i]
				}
			}
		}
	}

	return nil
}
