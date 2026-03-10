package main

import "testing"

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		in   int64
		want string
	}{
		{0, "0 bytes"},
		{500, "500 bytes"},
		{1_000_000, "1.0 MB"},
		{1_500_000, "1.5 MB"},
		{1_000_000_000, "1.00 GB"},
		{2_500_000_000, "2.50 GB"},
	}
	for _, tt := range tests {
		if got := formatBytes(tt.in); got != tt.want {
			t.Errorf("formatBytes(%d) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestFormatDuration(t *testing.T) {
	tests := []struct {
		in   int64
		want string
	}{
		{0, "0s"},
		{30, "30s"},
		{90, "1m 30s"},
		{3661, "1h 1m 1s"},
		{86400, "24h 0m 0s"},
	}
	for _, tt := range tests {
		if got := formatDuration(tt.in); got != tt.want {
			t.Errorf("formatDuration(%d) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestYesNo(t *testing.T) {
	if yesNo(true) != "yes" {
		t.Error("yesNo(true) should be yes")
	}
	if yesNo(false) != "no" {
		t.Error("yesNo(false) should be no")
	}
}
