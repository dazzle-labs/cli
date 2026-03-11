package main

import (
	"testing"
	"time"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestFormatChatMessage(t *testing.T) {
	ts := time.Date(2026, 3, 11, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		msg  *apiv1.ChatMessage
		want string
	}{
		{
			name: "basic message",
			msg: &apiv1.ChatMessage{
				Id:        "123",
				Author:    "alice",
				Text:      "hello world",
				Timestamp: timestamppb.New(ts),
				Platform:  "youtube",
			},
			want: "alice: hello world [2026-03-11T12:00:00Z]",
		},
		{
			name: "message with special chars",
			msg: &apiv1.ChatMessage{
				Id:        "456",
				Author:    "bob",
				Text:      "hello: world [test]",
				Timestamp: timestamppb.New(ts),
				Platform:  "twitch",
			},
			want: "bob: hello: world [test] [2026-03-11T12:00:00Z]",
		},
		{
			name: "empty message",
			msg: &apiv1.ChatMessage{
				Author:    "carol",
				Text:      "",
				Timestamp: timestamppb.New(ts),
			},
			want: "carol:  [2026-03-11T12:00:00Z]",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := formatChatMessage(tt.msg)
			if got != tt.want {
				t.Errorf("formatChatMessage() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestChatMessageToJSON(t *testing.T) {
	ts := time.Date(2026, 3, 11, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		msg  *apiv1.ChatMessage
		want chatMessageJSON
	}{
		{
			name: "full message",
			msg: &apiv1.ChatMessage{
				Id:        "abc",
				Author:    "alice",
				Text:      "hi there",
				Timestamp: timestamppb.New(ts),
				Platform:  "youtube",
			},
			want: chatMessageJSON{
				ID:        "abc",
				Author:    "alice",
				Text:      "hi there",
				Timestamp: "2026-03-11T12:00:00Z",
				Platform:  "youtube",
			},
		},
		{
			name: "empty id",
			msg: &apiv1.ChatMessage{
				Id:        "",
				Author:    "bob",
				Text:      "hey",
				Timestamp: timestamppb.New(ts),
				Platform:  "kick",
			},
			want: chatMessageJSON{
				ID:        "",
				Author:    "bob",
				Text:      "hey",
				Timestamp: "2026-03-11T12:00:00Z",
				Platform:  "kick",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := chatMessageToJSON(tt.msg)
			if got != tt.want {
				t.Errorf("chatMessageToJSON() = %+v, want %+v", got, tt.want)
			}
		})
	}
}
