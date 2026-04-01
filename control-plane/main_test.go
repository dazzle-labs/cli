package main

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func envVarMap(vars []corev1.EnvVar) map[string]string {
	m := make(map[string]string)
	for _, v := range vars {
		m[v.Name] = v.Value
	}
	return m
}

func envVarCount(vars []corev1.EnvVar, name string) int {
	n := 0
	for _, v := range vars {
		if v.Name == name {
			n++
		}
	}
	return n
}

func TestStreamerEnvVars_NoDuplicateResolutionKeys(t *testing.T) {
	// STREAMER_SCREEN_WIDTH would normally be forwarded, but resolution
	// settings should take precedence and the STREAMER_ duplicate should be filtered.
	t.Setenv("STREAMER_SCREEN_WIDTH", "9999")
	t.Setenv("STREAMER_SCREEN_HEIGHT", "9999")
	t.Setenv("STREAMER_BITRATE", "9999k")

	vars := streamerEnvVars("stage-1", "user-1", Resolution720p)

	for _, key := range []string{"SCREEN_WIDTH", "SCREEN_HEIGHT"} {
		if c := envVarCount(vars, key); c != 1 {
			t.Errorf("expected exactly 1 %s entry, got %d", key, c)
		}
	}

	vals := envVarMap(vars)
	if vals["SCREEN_WIDTH"] != "1280" {
		t.Errorf("SCREEN_WIDTH = %s, want 1280", vals["SCREEN_WIDTH"])
	}
	if vals["SCREEN_HEIGHT"] != "720" {
		t.Errorf("SCREEN_HEIGHT = %s, want 720", vals["SCREEN_HEIGHT"])
	}
}

func TestStreamerEnvVars_PassesThroughNonResolutionVars(t *testing.T) {
	t.Setenv("STREAMER_CHROME_FLAGS", "--disable-dev-shm-usage")
	t.Setenv("STREAMER_DISABLE_WEBGL", "true")

	vars := streamerEnvVars("stage-1", "user-1", Resolution720p)

	vals := envVarMap(vars)
	if vals["CHROME_FLAGS"] != "--disable-dev-shm-usage" {
		t.Errorf("CHROME_FLAGS = %q, want --disable-dev-shm-usage", vals["CHROME_FLAGS"])
	}
	if vals["DISABLE_WEBGL"] != "true" {
		t.Errorf("DISABLE_WEBGL = %q, want true", vals["DISABLE_WEBGL"])
	}
}
