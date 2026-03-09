package server

import (
	"sync"

	"github.com/browser-streamer/sidecar/internal/cdp"
)

type LogBuffer struct {
	mu      sync.Mutex
	entries []cdp.LogEntry
	max     int
}

func NewLogBuffer(max int) *LogBuffer {
	return &LogBuffer{max: max}
}

func (b *LogBuffer) Add(entry cdp.LogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.entries) >= b.max {
		b.entries = b.entries[1:]
	}
	b.entries = append(b.entries, entry)
}

func (b *LogBuffer) Tail(n int) []cdp.LogEntry {
	b.mu.Lock()
	defer b.mu.Unlock()
	if n > len(b.entries) {
		n = len(b.entries)
	}
	start := len(b.entries) - n
	result := make([]cdp.LogEntry, n)
	copy(result, b.entries[start:])
	return result
}

func (b *LogBuffer) Total() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.entries)
}
