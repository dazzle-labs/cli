package main

import (
	"errors"
	"fmt"
	"net/http"
	"os"

	"connectrpc.com/connect"
)

// Context is passed to every command's Run method.
type Context struct {
	Config    *Config
	Creds     *Credentials
	JSON      bool
	Stage     string // global --stage flag value (populated from CLI struct)
	StageID   string // resolved stage ID (set by resolveStage)
	HTTPClient *http.Client
	APIURL    string
}

// newContext builds the app context from CLI flags and stored config.
func newContext(apiURL, stageFlag string, jsonOutput bool) (*Context, error) {
	cfg, err := loadConfig()
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}

	creds, _ := loadCredentials() // credentials may not exist yet

	// DAZZLE_API_KEY env var overrides stored credentials for one-off commands.
	if envKey := os.Getenv("DAZZLE_API_KEY"); envKey != "" {
		creds = &Credentials{APIKey: envKey}
	}

	// Resolve API URL: flag/env (already applied by Kong) > config > default
	resolvedURL := apiURL
	if resolvedURL == "" {
		resolvedURL = cfg.APIURL
	}
	if resolvedURL == "" {
		resolvedURL = "https://dazzle.fm"
	}

	return &Context{
		Config:     cfg,
		Creds:      creds,
		JSON:       jsonOutput,
		Stage:      stageFlag,
		APIURL:     resolvedURL,
		HTTPClient: &http.Client{},
	}, nil
}

// requireAuth returns an error if no credentials are stored.
func (c *Context) requireAuth() error {
	if c.Creds == nil || c.Creds.APIKey == "" {
		return errors.New("not logged in -- run 'dazzle login'")
	}
	return nil
}

// authHeader returns the Bearer token Authorization header value.
func (c *Context) authHeader() string {
	if c.Creds == nil {
		return ""
	}
	return "Bearer " + c.Creds.APIKey
}

// connectErrorCode extracts the Connect error code string from an error.
func connectErrorCode(err error) string {
	if err == nil {
		return "OK"
	}
	var ce *connect.Error
	if errors.As(err, &ce) {
		return ce.Code().String()
	}
	return "unknown"
}
