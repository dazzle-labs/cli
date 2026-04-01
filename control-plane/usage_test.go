package main

import "testing"

func TestCeilHours(t *testing.T) {
	tests := []struct {
		sec  int
		want int
	}{
		{0, 0},
		{-10, 0},
		{1, 1},
		{3599, 1},
		{3600, 1},
		{3601, 2},
		{7200, 2},
		{7201, 3},
	}
	for _, tt := range tests {
		got := ceilHours(tt.sec)
		if got != tt.want {
			t.Errorf("ceilHours(%d) = %d, want %d", tt.sec, got, tt.want)
		}
	}
}
