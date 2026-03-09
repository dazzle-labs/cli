package obs

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type Client struct {
	host      string
	port      string
	mu        sync.Mutex
	ws        *websocket.Conn
	connected bool
	requestID atomic.Int64
	pending   sync.Map // requestID -> *pendingReq
	// statsCallback is called with OBS stats data
	statsCallback func(stats map[string]any)
	// outputCallback is called with output status
	outputCallback func(active bool, bytes float64)
}

type pendingReq struct {
	ch    chan reqResult
	timer *time.Timer
}

type reqResult struct {
	data map[string]any
	err  error
}

func NewClient(host, port string) *Client {
	return &Client{host: host, port: port}
}

func (c *Client) Connect(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if err := c.tryConnect(); err == nil {
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("OBS WebSocket: failed to connect within %v", timeout)
}

func (c *Client) tryConnect() error {
	url := fmt.Sprintf("ws://%s:%s", c.host, c.port)
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		return err
	}

	// Read Hello (op 0)
	var hello struct {
		Op int `json:"op"`
	}
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	if err := conn.ReadJSON(&hello); err != nil || hello.Op != 0 {
		conn.Close()
		return fmt.Errorf("expected Hello (op 0)")
	}

	// Send Identify (op 1)
	conn.WriteJSON(map[string]any{
		"op": 1,
		"d":  map[string]any{"rpcVersion": 1},
	})

	// Read Identified (op 2)
	var identified struct {
		Op int `json:"op"`
	}
	if err := conn.ReadJSON(&identified); err != nil || identified.Op != 2 {
		conn.Close()
		return fmt.Errorf("expected Identified (op 2)")
	}

	conn.SetReadDeadline(time.Time{}) // clear deadline

	c.mu.Lock()
	c.ws = conn
	c.connected = true
	c.mu.Unlock()

	// Start reading messages
	go c.readLoop(conn)

	return nil
}

func (c *Client) readLoop(conn *websocket.Conn) {
	defer func() {
		c.mu.Lock()
		c.connected = false
		c.ws = nil
		c.mu.Unlock()

		// Reject all pending requests
		c.pending.Range(func(key, value any) bool {
			if p, ok := value.(*pendingReq); ok {
				p.timer.Stop()
				p.ch <- reqResult{err: fmt.Errorf("OBS WebSocket closed")}
			}
			c.pending.Delete(key)
			return true
		})
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var msg struct {
			Op int             `json:"op"`
			D  json.RawMessage `json:"d"`
		}
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}

		if msg.Op == 7 { // RequestResponse
			var resp struct {
				RequestID     string         `json:"requestId"`
				RequestStatus struct {
					Result  bool   `json:"result"`
					Code    int    `json:"code"`
					Comment string `json:"comment"`
				} `json:"requestStatus"`
				ResponseData map[string]any `json:"responseData"`
			}
			if json.Unmarshal(msg.D, &resp) != nil {
				continue
			}

			if val, ok := c.pending.LoadAndDelete(resp.RequestID); ok {
				p := val.(*pendingReq)
				p.timer.Stop()
				if resp.RequestStatus.Result {
					p.ch <- reqResult{data: resp.ResponseData}
				} else {
					p.ch <- reqResult{err: fmt.Errorf("OBS %d: %s", resp.RequestStatus.Code, resp.RequestStatus.Comment)}
				}
			}
		}
	}
}

func (c *Client) Request(requestType string, requestData map[string]any, timeout time.Duration) (map[string]any, error) {
	c.mu.Lock()
	if !c.connected || c.ws == nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("OBS not connected")
	}
	ws := c.ws
	c.mu.Unlock()

	id := fmt.Sprintf("%d", c.requestID.Add(1))

	ch := make(chan reqResult, 1)
	timer := time.AfterFunc(timeout, func() {
		if val, ok := c.pending.LoadAndDelete(id); ok {
			p := val.(*pendingReq)
			p.ch <- reqResult{err: fmt.Errorf("OBS request timeout: %s", requestType)}
		}
	})

	c.pending.Store(id, &pendingReq{ch: ch, timer: timer})

	msg := map[string]any{
		"op": 6,
		"d": map[string]any{
			"requestType": requestType,
			"requestId":   id,
			"requestData": requestData,
		},
	}

	if err := ws.WriteJSON(msg); err != nil {
		c.pending.Delete(id)
		timer.Stop()
		return nil, err
	}

	res := <-ch
	return res.data, res.err
}

// Screenshot captures a screenshot from OBS via the WebSocket protocol.
func (c *Client) Screenshot() (string, error) {
	// Get current scene
	sceneData, err := c.Request("GetCurrentProgramScene", nil, 5*time.Second)
	if err != nil {
		return "", fmt.Errorf("get current scene: %w", err)
	}
	sceneName, _ := sceneData["sceneName"].(string)
	if sceneName == "" {
		return "", fmt.Errorf("no current scene")
	}

	// Get screenshot
	ssData, err := c.Request("GetSourceScreenshot", map[string]any{
		"sourceName":  sceneName,
		"imageFormat": "png",
	}, 5*time.Second)
	if err != nil {
		return "", fmt.Errorf("get screenshot: %w", err)
	}

	imageData, _ := ssData["imageData"].(string)
	if imageData == "" {
		return "", fmt.Errorf("no image data in response")
	}

	return imageData, nil
}

// IsConnected returns whether the OBS WebSocket is currently connected.
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

// StartStatsPolling begins polling OBS stats at the given interval.
func (c *Client) StartStatsPolling(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		fails := 0
		for range ticker.C {
			stats, err := c.Request("GetStats", nil, 5*time.Second)
			if err != nil {
				fails++
				if fails == 3 {
					log.Println("OBS stats: poll failing (OBS may be disconnected)")
				}
				continue
			}
			fails = 0
			if c.statsCallback != nil {
				c.statsCallback(stats)
			}

			// Also poll output status
			output, err := c.Request("GetOutputStatus", map[string]any{"outputName": "adv_stream"}, 5*time.Second)
			if err == nil && c.outputCallback != nil {
				active, _ := output["outputActive"].(bool)
				bytes, _ := output["outputBytes"].(float64)
				c.outputCallback(active, bytes)
			}
		}
	}()
}

// SetStatsCallback sets the function called with OBS stats data.
func (c *Client) SetStatsCallback(cb func(stats map[string]any)) {
	c.statsCallback = cb
}

// SetOutputCallback sets the function called with output status.
func (c *Client) SetOutputCallback(cb func(active bool, bytes float64)) {
	c.outputCallback = cb
}
