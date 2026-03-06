package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
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
