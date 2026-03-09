package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"

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
// It only opens the browser if stdout is a terminal (interactive session).
// In non-interactive sessions (pipes, CI), it's a no-op.
func openBrowser(url string) {
	if !term.IsTerminal(int(os.Stdout.Fd())) {
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
