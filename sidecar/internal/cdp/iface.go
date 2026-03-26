package cdp

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
}
