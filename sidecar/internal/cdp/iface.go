package cdp

// OutputConfig describes an RTMP output destination.
type OutputConfig struct {
	Name        string `json:"name"`
	URL         string `json:"url"`
	Watermarked bool   `json:"watermarked"`
}

// CDP is the interface for Chrome DevTools Protocol clients.
// Both WebSocket-based Client and pipe-based PipeClient implement this.
type CDP interface {
	ConnectLoop(logAdder LogAdder)
	IsConnected() bool
	Evaluate(expression string) (string, error)
	Screenshot() ([]byte, error)
	Navigate(url string) error
	Reload() error
	DispatchEvent(eventName string, data any) bool
	// SetOutputs sends RTMP output config to the stage runtime via StageRuntime.setOutputs CDP command.
	// Only used when RENDERER=native; returns error for Chrome-based renderers.
	SetOutputs(outputs []OutputConfig) error
}
