package cdp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// PipeClient communicates with Chrome via --remote-debugging-pipe.
// Uses named FIFOs (null-byte delimited JSON) instead of WebSocket/TCP,
// eliminating the TCP port attack surface for multi-tenant isolation.
type PipeClient struct {
	inPath  string // FIFO path: sidecar writes, Chrome reads (Chrome's fd 3)
	outPath string // FIFO path: Chrome writes, sidecar reads (Chrome's fd 4)

	mu        sync.Mutex
	inFile    *os.File
	outFile   *os.File
	connected bool
	sessionID string // page-level session ID from Target.attachToTarget

	msgID    atomic.Int64
	logAdder LogAdder

	// Response routing: commands send their ID, reader routes responses back
	pendingMu sync.Mutex
	pending   map[int64]chan json.RawMessage
}

// NewPipeClient creates a CDP client that uses named FIFOs for communication.
// inPath is the FIFO the sidecar writes to (Chrome reads from fd 3).
// outPath is the FIFO Chrome writes to (sidecar reads from fd 4).
func NewPipeClient(inPath, outPath string) *PipeClient {
	c := &PipeClient{
		inPath:  inPath,
		outPath: outPath,
		pending: make(map[int64]chan json.RawMessage),
	}
	c.msgID.Store(100)
	return c
}

// ConnectLoop opens the FIFOs and starts reading CDP events. Blocks forever.
func (c *PipeClient) ConnectLoop(logAdder LogAdder) {
	c.logAdder = logAdder
	for {
		if err := c.connectPipe(); err != nil {
			log.Printf("CDP pipe: connect failed: %v, retrying in 2s", err)
			time.Sleep(2 * time.Second)
			continue
		}

		// Start reader in background so we can send/receive during page attachment
		done := make(chan struct{})
		go func() {
			c.readPipeLoop()
			close(done)
		}()

		// Attach to the page target (retry — Chrome may not have created a page yet)
		for attempt := 0; attempt < 30; attempt++ {
			if err := c.attachToPage(); err != nil {
				if attempt < 29 {
					time.Sleep(time.Second)
					continue
				}
				log.Printf("CDP pipe: WARN: failed to attach to page after retries: %v", err)
			}
			break
		}

		// Enable Runtime and Log domains on the page session
		c.sendSessionCommand("Runtime.enable", nil)
		c.sendSessionCommand("Log.enable", nil)
		log.Println("CDP pipe: connected for log capture and events")

		<-done
		log.Println("CDP pipe: disconnected, reconnecting in 2s...")
		c.disconnect()
		time.Sleep(2 * time.Second)
	}
}

func (c *PipeClient) connectPipe() error {
	// FIFO open order matters to avoid deadlock with Chrome's bash:
	//   Chrome: exec 3<cdp-in 4>cdp-out (opens cdp-in for READ first, then cdp-out for WRITE)
	//   Sidecar: must open cdp-in for WRITE first (unblocks Chrome's read), then cdp-out for READ
	log.Printf("CDP pipe: opening %s for writing...", c.inPath)
	inFile, err := os.OpenFile(c.inPath, os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("open input FIFO %s: %w", c.inPath, err)
	}

	log.Printf("CDP pipe: opening %s for reading...", c.outPath)
	outFile, err := os.OpenFile(c.outPath, os.O_RDONLY, 0)
	if err != nil {
		inFile.Close()
		return fmt.Errorf("open output FIFO %s: %w", c.outPath, err)
	}

	c.mu.Lock()
	c.inFile = inFile
	c.outFile = outFile
	c.connected = true
	c.mu.Unlock()

	return nil
}

// attachToPage discovers browser targets and attaches to the first page.
func (c *PipeClient) attachToPage() error {
	// Enable target discovery
	resp, err := c.sendAndWait("Target.setDiscoverTargets", map[string]any{"discover": true})
	if err != nil {
		return fmt.Errorf("setDiscoverTargets: %w", err)
	}
	_ = resp

	// Get list of targets
	resp, err = c.sendAndWait("Target.getTargets", nil)
	if err != nil {
		return fmt.Errorf("getTargets: %w", err)
	}

	var targets struct {
		TargetInfos []struct {
			TargetID string `json:"targetId"`
			Type     string `json:"type"`
			URL      string `json:"url"`
		} `json:"targetInfos"`
	}
	if err := json.Unmarshal(resp, &targets); err != nil {
		return fmt.Errorf("parse targets: %w", err)
	}

	// Find a page target
	var targetID string
	for _, t := range targets.TargetInfos {
		if t.Type == "page" {
			targetID = t.TargetID
			log.Printf("CDP pipe: found page target %s (%s)", t.TargetID, t.URL)
			break
		}
	}

	// If no page target exists, create one (pipe mode doesn't auto-create pages)
	if targetID == "" {
		log.Printf("CDP pipe: no page target found, creating one via Target.createTarget")
		resp, err = c.sendAndWait("Target.createTarget", map[string]any{"url": "about:blank"})
		if err != nil {
			return fmt.Errorf("createTarget: %w", err)
		}
		var created struct {
			TargetID string `json:"targetId"`
		}
		if err := json.Unmarshal(resp, &created); err != nil {
			return fmt.Errorf("parse createTarget: %w", err)
		}
		targetID = created.TargetID
		log.Printf("CDP pipe: created page target %s", targetID)
	}

	// Attach to the target with flatten=true for sessionId-based messaging
	resp, err = c.sendAndWait("Target.attachToTarget", map[string]any{
		"targetId": targetID,
		"flatten":  true,
	})
	if err != nil {
		return fmt.Errorf("attachToTarget: %w", err)
	}

	var attach struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(resp, &attach); err != nil {
		return fmt.Errorf("parse attach: %w", err)
	}

	c.mu.Lock()
	c.sessionID = attach.SessionID
	c.mu.Unlock()
	log.Printf("CDP pipe: attached to page target %s (session %s)", targetID, attach.SessionID)
	return nil
}

// sendRaw writes a null-byte delimited JSON message to the pipe.
func (c *PipeClient) sendRaw(msg map[string]any) error {
	c.mu.Lock()
	inFile := c.inFile
	c.mu.Unlock()
	if inFile == nil {
		return fmt.Errorf("pipe not connected")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, 0) // null-byte delimiter

	_, err = inFile.Write(data)
	return err
}

// sendAndWait sends a command and waits for the response with matching ID.
func (c *PipeClient) sendAndWait(method string, params map[string]any) (json.RawMessage, error) {
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

	if err := c.sendRaw(msg); err != nil {
		return nil, err
	}

	select {
	case resp := <-ch:
		// Check for error
		var errMsg struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(resp, &errMsg); err == nil && errMsg.Error != nil {
			return nil, fmt.Errorf("%s", errMsg.Error.Message)
		}
		return errMsg.Result, nil
	case <-time.After(10 * time.Second):
		return nil, fmt.Errorf("timeout waiting for response to %s (id=%d)", method, id)
	}
}

// sendSessionCommand sends a command scoped to the attached page session.
func (c *PipeClient) sendSessionCommand(method string, params map[string]any) {
	c.mu.Lock()
	sessionID := c.sessionID
	c.mu.Unlock()

	msg := map[string]any{
		"id":     c.msgID.Add(1),
		"method": method,
	}
	if params != nil {
		msg["params"] = params
	}
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}
	c.sendRaw(msg)
}

// sendSessionAndWait sends a session-scoped command and waits for response.
func (c *PipeClient) sendSessionAndWait(method string, params map[string]any) (json.RawMessage, error) {
	c.mu.Lock()
	sessionID := c.sessionID
	c.mu.Unlock()

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
	if sessionID != "" {
		msg["sessionId"] = sessionID
	}

	if err := c.sendRaw(msg); err != nil {
		return nil, err
	}

	select {
	case resp := <-ch:
		var errMsg struct {
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
			Result json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(resp, &errMsg); err == nil && errMsg.Error != nil {
			return nil, fmt.Errorf("%s", errMsg.Error.Message)
		}
		return errMsg.Result, nil
	case <-time.After(10 * time.Second):
		return nil, fmt.Errorf("timeout waiting for response to %s (id=%d)", method, id)
	}
}

// readPipeLoop reads null-byte delimited messages from Chrome's output pipe.
func (c *PipeClient) readPipeLoop() {
	c.mu.Lock()
	outFile := c.outFile
	c.mu.Unlock()
	if outFile == nil {
		return
	}

	scanner := bufio.NewScanner(outFile)
	scanner.Buffer(make([]byte, 4*1024*1024), 4*1024*1024) // 4MB buffer for screenshots
	scanner.Split(splitNullByte)

	for scanner.Scan() {
		raw := scanner.Bytes()
		if len(raw) == 0 {
			continue
		}

		// Route: if it has an "id" field, it's a response → route to pending
		var peek struct {
			ID     int64           `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.Unmarshal(raw, &peek); err != nil {
			continue
		}

		if peek.ID > 0 {
			c.pendingMu.Lock()
			ch, ok := c.pending[peek.ID]
			c.pendingMu.Unlock()
			if ok {
				// Make a copy since scanner reuses the buffer
				msg := make(json.RawMessage, len(raw))
				copy(msg, raw)
				ch <- msg
			}
			continue
		}

		// It's an event — handle CDP events for logging
		if peek.Method != "" {
			c.handleCDPEvent(peek.Method, peek.Params)
		}
	}
}

func (c *PipeClient) disconnect() {
	c.mu.Lock()
	if c.inFile != nil {
		c.inFile.Close()
		c.inFile = nil
	}
	if c.outFile != nil {
		c.outFile.Close()
		c.outFile = nil
	}
	c.connected = false
	c.sessionID = ""
	c.mu.Unlock()

	// Fail all pending requests
	c.pendingMu.Lock()
	for id, ch := range c.pending {
		close(ch)
		delete(c.pending, id)
	}
	c.pendingMu.Unlock()
}

// splitNullByte is a bufio.SplitFunc that splits on null bytes.
func splitNullByte(data []byte, atEOF bool) (advance int, token []byte, err error) {
	for i := 0; i < len(data); i++ {
		if data[i] == 0 {
			return i + 1, data[:i], nil
		}
	}
	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// handleCDPEvent processes CDP events (same logic as WebSocket client).
func (c *PipeClient) handleCDPEvent(method string, params json.RawMessage) {
	if c.logAdder == nil {
		return
	}

	var entry *LogEntry

	switch method {
	case "Runtime.consoleAPICalled":
		var p struct {
			Type string `json:"type"`
			Args []struct {
				Type        string `json:"type"`
				Value       any    `json:"value"`
				Description string `json:"description"`
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
		entry = &LogEntry{Level: p.Type, Text: text, Ts: ts, Source: "console"}

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
		entry = &LogEntry{Level: "error", Text: text, Ts: p.Timestamp, Source: "exception",
			URL: p.ExceptionDetails.URL, Line: p.ExceptionDetails.LineNumber}

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
		entry = &LogEntry{Level: p.Entry.Level, Text: p.Entry.Text, Ts: p.Entry.Timestamp,
			Source: p.Entry.Source, URL: p.Entry.URL, Line: p.Entry.LineNumber}
	}

	if entry != nil {
		if entry.Level == "" {
			entry.Level = "log"
		}
		c.logAdder.Add(*entry)
	}
}

// --- Public API (matches Client interface) ---

func (c *PipeClient) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}

func (c *PipeClient) Evaluate(expression string) (string, error) {
	resp, err := c.sendSessionAndWait("Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
	})
	if err != nil {
		return "", err
	}
	var result struct {
		Result struct {
			Type  string `json:"type"`
			Value any    `json:"value"`
		} `json:"result"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return "", fmt.Errorf("parse evaluate result: %w", err)
	}
	return fmt.Sprintf("%v", result.Result.Value), nil
}

func (c *PipeClient) Screenshot() ([]byte, error) {
	resp, err := c.sendSessionAndWait("Page.captureScreenshot", map[string]any{"format": "png"})
	if err != nil {
		return nil, err
	}
	var result struct {
		Data string `json:"data"`
	}
	if err := json.Unmarshal(resp, &result); err != nil {
		return nil, fmt.Errorf("parse screenshot result: %w", err)
	}
	return base64Decode(result.Data)
}

func (c *PipeClient) Navigate(url string) error {
	_, err := c.sendSessionAndWait("Page.navigate", map[string]any{"url": url})
	return err
}

func (c *PipeClient) Reload() error {
	_, err := c.sendSessionAndWait("Page.reload", map[string]any{})
	return err
}

func (c *PipeClient) DispatchEvent(eventName string, data any) bool {
	c.mu.Lock()
	connected := c.connected
	c.mu.Unlock()
	if !connected {
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
	c.sendSessionCommand("Runtime.evaluate", map[string]any{"expression": js})
	return true
}
