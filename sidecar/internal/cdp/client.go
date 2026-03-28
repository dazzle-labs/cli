package cdp

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// LogAdder is the interface for adding log entries (avoids import cycle).
type LogAdder interface {
	Add(entry LogEntry)
}

type LogEntry struct {
	Level  string  `json:"level"`
	Text   string  `json:"text"`
	Ts     float64 `json:"ts"`
	Source string  `json:"source"`
	URL    string  `json:"url,omitempty"`
	Line   int     `json:"line,omitempty"`
}

type Client struct {
	host     string
	port     string
	mu       sync.Mutex
	ws       *websocket.Conn
	msgID    atomic.Int64
	logAdder LogAdder

	// Pending response channels for sendAndWait (mirrors PipeClient pattern).
	pendingMu sync.Mutex
	pending   map[int64]chan json.RawMessage
}

func NewClient(host, port string) *Client {
	c := &Client{
		host:    host,
		port:    port,
		pending: make(map[int64]chan json.RawMessage),
	}
	c.msgID.Store(100)
	return c
}

func (c *Client) ConnectLoop(logAdder LogAdder) {
	c.logAdder = logAdder
	for {
		if err := c.connect(); err != nil {
			log.Printf("CDP: failed to connect: %v, retrying in 2s", err)
			time.Sleep(2 * time.Second)
			continue
		}
		c.readLoop()
		log.Println("CDP: disconnected, reconnecting in 2s...")
		time.Sleep(2 * time.Second)
	}
}

func (c *Client) connect() error {
	// Get page WebSocket URL from CDP
	url := fmt.Sprintf("http://%s:%s/json", c.host, c.port)
	resp, err := http.Get(url)
	if err != nil {
		return fmt.Errorf("get tabs: %w", err)
	}
	defer resp.Body.Close()

	var tabs []struct {
		Type                 string `json:"type"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tabs); err != nil {
		return fmt.Errorf("decode tabs: %w", err)
	}
	if len(tabs) == 0 {
		return fmt.Errorf("no browser tabs")
	}

	// Find page tab
	wsURL := tabs[0].WebSocketDebuggerURL
	for _, t := range tabs {
		if t.Type == "page" {
			wsURL = t.WebSocketDebuggerURL
			break
		}
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}

	// Enable Runtime and Log domains
	c.mu.Lock()
	c.ws = conn
	c.mu.Unlock()

	c.sendCommand("Runtime.enable", nil)
	c.sendCommand("Log.enable", nil)
	log.Println("CDP: connected for log capture and events")
	return nil
}

func (c *Client) sendCommand(method string, params any) {
	c.mu.Lock()
	ws := c.ws
	c.mu.Unlock()
	if ws == nil {
		return
	}
	msg := map[string]any{
		"id":     c.msgID.Add(1),
		"method": method,
	}
	if params != nil {
		msg["params"] = params
	}
	ws.WriteJSON(msg)
}

func (c *Client) readLoop() {
	c.mu.Lock()
	ws := c.ws
	c.mu.Unlock()
	if ws == nil {
		return
	}

	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			c.mu.Lock()
			c.ws = nil
			c.mu.Unlock()
			// Drain pending waiters so they don't hang.
			c.pendingMu.Lock()
			for id, ch := range c.pending {
				close(ch)
				delete(c.pending, id)
			}
			c.pendingMu.Unlock()
			return
		}

		// Check if this is a response to a pending sendAndWait call.
		var resp struct {
			ID int64 `json:"id"`
		}
		if json.Unmarshal(raw, &resp) == nil && resp.ID > 0 {
			c.pendingMu.Lock()
			ch, ok := c.pending[resp.ID]
			c.pendingMu.Unlock()
			if ok {
				ch <- raw
				continue
			}
		}

		var msg struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(raw, &msg); err != nil || msg.Method == "" {
			continue
		}

		c.handleCDPEvent(msg.Method, msg.Params)
	}
}

// sendAndWait sends a CDP command on the persistent WebSocket and waits for
// the matching response. Mirrors PipeClient.sendSessionAndWait for consistency.
func (c *Client) sendAndWait(method string, params map[string]any) (json.RawMessage, error) {
	c.mu.Lock()
	ws := c.ws
	c.mu.Unlock()
	if ws == nil {
		return nil, fmt.Errorf("not connected")
	}

	id := c.msgID.Add(1)
	ch := make(chan json.RawMessage, 1)

	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	defer func() {
		c.pendingMu.Lock()
		delete(c.pending, id)
		c.pendingMu.Unlock()
	}()

	msg := map[string]any{
		"id":     id,
		"method": method,
	}
	if params != nil {
		msg["params"] = params
	}

	if err := ws.WriteJSON(msg); err != nil {
		return nil, fmt.Errorf("write: %w", err)
	}

	select {
	case raw, ok := <-ch:
		if !ok {
			return nil, fmt.Errorf("connection closed")
		}
		var errMsg struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(raw, &errMsg); err == nil && errMsg.Error != nil {
			return nil, fmt.Errorf("%s", errMsg.Error.Message)
		}
		return errMsg.Result, nil
	case <-time.After(10 * time.Second):
		return nil, fmt.Errorf("timeout waiting for response to %s (id=%d)", method, id)
	}
}

func (c *Client) handleCDPEvent(method string, params json.RawMessage) {
	if c.logAdder == nil {
		return
	}

	var entry *LogEntry

	switch method {
	case "Runtime.consoleAPICalled":
		var p struct {
			Type      string `json:"type"`
			Args      []struct {
				Type        string `json:"type"`
				Value       any    `json:"value"`
				Description string `json:"description"`
				Preview     any    `json:"preview"`
			} `json:"args"`
			Timestamp float64 `json:"timestamp"`
		}
		if json.Unmarshal(params, &p) != nil {
			return
		}

		var parts []string
		for _, a := range p.Args {
			switch a.Type {
			case "string":
				if s, ok := a.Value.(string); ok {
					parts = append(parts, s)
				}
			case "number", "boolean":
				parts = append(parts, fmt.Sprintf("%v", a.Value))
			default:
				if a.Description != "" {
					parts = append(parts, a.Description)
				} else {
					b, _ := json.Marshal(a.Value)
					parts = append(parts, string(b))
				}
			}
		}

		text := ""
		for i, p := range parts {
			if i > 0 {
				text += " "
			}
			text += p
		}

		ts := p.Timestamp
		if ts == 0 {
			ts = float64(time.Now().UnixMilli())
		}

		entry = &LogEntry{
			Level:  p.Type,
			Text:   text,
			Ts:     ts,
			Source: "console",
		}

	case "Runtime.exceptionThrown":
		var p struct {
			ExceptionDetails struct {
				Exception struct {
					Description string `json:"description"`
				} `json:"exception"`
				Text       string `json:"text"`
				URL        string `json:"url"`
				LineNumber int    `json:"lineNumber"`
			} `json:"exceptionDetails"`
			Timestamp float64 `json:"timestamp"`
		}
		if json.Unmarshal(params, &p) != nil {
			return
		}

		text := p.ExceptionDetails.Exception.Description
		if text == "" {
			text = p.ExceptionDetails.Text
		}
		if text == "" {
			text = "Unknown exception"
		}

		entry = &LogEntry{
			Level:  "error",
			Text:   text,
			Ts:     p.Timestamp,
			Source: "exception",
			URL:    p.ExceptionDetails.URL,
			Line:   p.ExceptionDetails.LineNumber,
		}

	case "Log.entryAdded":
		var p struct {
			Entry struct {
				Level      string  `json:"level"`
				Text       string  `json:"text"`
				Timestamp  float64 `json:"timestamp"`
				Source     string  `json:"source"`
				URL        string  `json:"url"`
				LineNumber int     `json:"lineNumber"`
			} `json:"entry"`
		}
		if json.Unmarshal(params, &p) != nil {
			return
		}

		entry = &LogEntry{
			Level:  p.Entry.Level,
			Text:   p.Entry.Text,
			Ts:     p.Entry.Timestamp,
			Source: p.Entry.Source,
			URL:    p.Entry.URL,
			Line:   p.Entry.LineNumber,
		}
	}

	if entry != nil {
		if entry.Level == "" {
			entry.Level = "log"
		}
		c.logAdder.Add(*entry)
	}
}

// DispatchEvent sends a CustomEvent to the browser page via CDP Runtime.evaluate.
func (c *Client) DispatchEvent(eventName string, data any) bool {
	c.mu.Lock()
	ws := c.ws
	c.mu.Unlock()
	if ws == nil {
		return false
	}

	// If data is a JSON string, embed as raw JSON so the browser gets a parsed object.
	var detail any = data
	if s, ok := data.(string); ok && len(s) > 0 && (s[0] == '{' || s[0] == '[' || s[0] == '"') {
		detail = json.RawMessage(s)
	}
	detailJSON, _ := json.Marshal(detail)
	nameJSON, _ := json.Marshal(eventName)
	js := fmt.Sprintf(`window.dispatchEvent(new CustomEvent(%s, { detail: %s }));`, string(nameJSON), string(detailJSON))

	c.sendCommand("Runtime.evaluate", map[string]any{"expression": js})
	return true
}

// Navigate opens a URL in the browser via CDP.
// Uses the persistent WebSocket connection (same pattern as PipeClient).
func (c *Client) Navigate(url string) error {
	_, err := c.sendAndWait("Page.navigate", map[string]any{"url": url})
	return err
}

// Reload reloads the current page via CDP Page.reload.
// Uses the persistent WebSocket connection (same pattern as PipeClient).
func (c *Client) Reload() error {
	_, err := c.sendAndWait("Page.reload", map[string]any{})
	return err
}

// Screenshot captures a PNG screenshot via CDP Page.captureScreenshot.
// Returns raw PNG bytes. Uses a dedicated connection to avoid interfering
// with the event-listening connection in readLoop.
func (c *Client) Screenshot() ([]byte, error) {
	httpURL := fmt.Sprintf("http://%s:%s/json", c.host, c.port)
	resp, err := http.Get(httpURL)
	if err != nil {
		return nil, fmt.Errorf("get tabs: %w", err)
	}
	defer resp.Body.Close()

	var tabs []struct {
		Type                 string `json:"type"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tabs); err != nil || len(tabs) == 0 {
		return nil, fmt.Errorf("no browser tabs")
	}

	wsURL := tabs[0].WebSocketDebuggerURL
	for _, t := range tabs {
		if t.Type == "page" {
			wsURL = t.WebSocketDebuggerURL
			break
		}
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	conn.WriteJSON(map[string]any{
		"id":     1,
		"method": "Page.captureScreenshot",
		"params": map[string]any{"format": "png"},
	})

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return nil, fmt.Errorf("read: %w", err)
		}
		var msg struct {
			ID     int `json:"id"`
			Result struct {
				Data string `json:"data"`
			} `json:"result"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &msg) == nil && msg.ID == 1 {
			if msg.Error != nil {
				return nil, fmt.Errorf("screenshot: %s", msg.Error.Message)
			}
			return base64Decode(msg.Result.Data)
		}
	}
}

// Evaluate runs a JavaScript expression via CDP and returns the result as a string.
// Uses a dedicated connection to avoid interfering with the event-listening connection.
func (c *Client) Evaluate(expression string) (string, error) {
	httpURL := fmt.Sprintf("http://%s:%s/json", c.host, c.port)
	resp, err := http.Get(httpURL)
	if err != nil {
		return "", fmt.Errorf("get tabs: %w", err)
	}
	defer resp.Body.Close()

	var tabs []struct {
		Type                 string `json:"type"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tabs); err != nil || len(tabs) == 0 {
		return "", fmt.Errorf("no browser tabs")
	}

	wsURL := tabs[0].WebSocketDebuggerURL
	for _, t := range tabs {
		if t.Type == "page" {
			wsURL = t.WebSocketDebuggerURL
			break
		}
	}

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return "", fmt.Errorf("dial: %w", err)
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	conn.WriteJSON(map[string]any{
		"id":     1,
		"method": "Runtime.evaluate",
		"params": map[string]any{
			"expression":    expression,
			"returnByValue": true,
		},
	})

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return "", fmt.Errorf("read: %w", err)
		}
		var msg struct {
			ID     int `json:"id"`
			Result struct {
				Result struct {
					Type  string `json:"type"`
					Value any    `json:"value"`
				} `json:"result"`
			} `json:"result"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(raw, &msg) == nil && msg.ID == 1 {
			if msg.Error != nil {
				return "", fmt.Errorf("evaluate: %s", msg.Error.Message)
			}
			return fmt.Sprintf("%v", msg.Result.Result.Value), nil
		}
	}
}

func base64Decode(s string) ([]byte, error) {
	// Try standard encoding first, fall back to URL encoding
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

// IsConnected returns whether the CDP WebSocket is currently connected.
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ws != nil
}
