package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"golang.org/x/term"
)

// printJSON writes a JSON-encoded value to stdout.
func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(v) //nolint:errcheck
}

// printText writes a formatted line to stdout.
func printText(format string, args ...any) {
	fmt.Printf(format+"\n", args...)
}

// openBrowser opens the given URL in the user's default browser.
// It only opens the browser if stdin is a terminal (interactive session).
// In non-interactive sessions (pipes, CI), it's a no-op.
func openBrowser(url string) {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return
	}
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler"}
	default: // linux, freebsd, etc.
		cmd = "xdg-open"
	}
	args = append(args, url)
	_ = exec.Command(cmd, args...).Start()
}

// startSpinner prints a spinner animation to stderr. Returns a stop function.
// No-op if not a TTY.
func startSpinner(message string) func() {
	if !term.IsTerminal(int(os.Stderr.Fd())) {
		return func() {}
	}
	frames := []rune("⣾⣽⣻⢿⡿⣟⣯⣷")
	done := make(chan struct{})
	go func() {
		i := 0
		for {
			select {
			case <-done:
				// Clear the spinner line
				clearLen := len(message) + 2
				fmt.Fprintf(os.Stderr, "\r%s\r", strings.Repeat(" ", clearLen))
				return
			default:
				fmt.Fprintf(os.Stderr, "\r%s %c", message, frames[i%len(frames)])
				i++
				time.Sleep(100 * time.Millisecond)
			}
		}
	}()
	return func() { close(done) }
}

// generateVerifyCode generates a verification code in XXX-XXX format (uppercase alphanumeric).
func generateVerifyCode() string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 7)
	for i := range b {
		if i == 3 {
			b[i] = '-'
			continue
		}
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			panic(err)
		}
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

// tableHeader prints a table header row.
func tableHeader(cols ...string) {
	printText(tableRow(cols...))
	printText(strings.Repeat("-", 80))
}

// tableRow formats a simple table row with padding.
func tableRow(cols ...string) string {
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = fmt.Sprintf("%-25s", c)
	}
	return strings.Join(parts, "  ")
}
