package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"golang.org/x/term"
)

// LoginCmd handles `dazzle login`.
type LoginCmd struct {
	APIKey  string `help:"API key to store (skips interactive prompt)." name:"api-key"`
	KeyName string `help:"Name for the API key." name:"key-name"`
}

func (c *LoginCmd) Run(ctx *Context) error {
	apiKey := c.APIKey

	// Non-interactive: read from stdin pipe or --api-key flag
	if apiKey != "" || !term.IsTerminal(int(os.Stdin.Fd())) {
		if apiKey == "" {
			scanner := bufio.NewScanner(os.Stdin)
			if scanner.Scan() {
				apiKey = strings.TrimSpace(scanner.Text())
			}
		}
		if apiKey == "" {
			return errors.New("api key cannot be empty")
		}
		if !strings.HasPrefix(apiKey, "dzl_") && !strings.HasPrefix(apiKey, "bstr_") {
			return errors.New("invalid api key format -- must start with dzl_ (or legacy bstr_)")
		}
		if err := saveCredentials(&Credentials{APIKey: apiKey}); err != nil {
			return fmt.Errorf("save credentials: %w", err)
		}
		if ctx.JSON {
			printJSON(OKResponse{OK: true})
		} else {
			printText("\u2713 Logged in")
		}
		return nil
	}

	// Default key name: CLI-<hostname> (non-alphanumeric chars → dashes)
	if c.KeyName == "" {
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "unknown"
		}
		var sb strings.Builder
		for _, ch := range hostname {
			if (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') {
				sb.WriteRune(ch)
			} else {
				sb.WriteByte('-')
			}
		}
		sanitized := strings.Trim(sb.String(), "-")
		if sanitized == "" {
			c.KeyName = "CLI"
		} else {
			c.KeyName = "CLI-" + sanitized
		}
	}

	// Interactive: browser-based OAuth login
	creds, _ := loadCredentials()
	if creds != nil && creds.APIKey != "" {
		if creds.Email != "" {
			fmt.Fprintf(os.Stderr, "Already logged in as %s. Re-authenticating...\n", creds.Email)
		} else {
			fmt.Fprintf(os.Stderr, "Already logged in. Re-authenticating...\n")
		}
	}

	verifyCode := generateVerifyCode()

	// Create CLI session
	body, _ := json.Marshal(map[string]string{
		"type":        "login",
		"key_name":    c.KeyName,
		"verify_code": verifyCode,
	})
	resp, err := http.Post(ctx.APIURL+"/auth/cli/session", "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	var session struct {
		SessionID  string `json:"session_id"`
		BrowserURL string `json:"browser_url"`
		Error      string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return fmt.Errorf("parse session response: %w", err)
	}
	if session.Error != "" {
		return fmt.Errorf("create session: %s", session.Error)
	}

	if !ctx.JSON {
		printText("Opening browser to sign in to Dazzle...")
		printText("  \u2192 If the browser didn't open, visit: %s", session.BrowserURL)
		printText("")
		printText("Verification code: %s", verifyCode)
		printText("")
	}

	openBrowser(session.BrowserURL)

	// Poll for completion
	var stop func()
	if !ctx.JSON {
		stop = startSpinner("Waiting for authentication...")
	}

	result, err := pollCliSession(ctx.APIURL, session.SessionID, 10*time.Minute)
	if stop != nil {
		stop()
	}
	if err != nil {
		if ctx.JSON {
			printJSON(ErrorResponse{OK: false, Error: err.Error()})
		} else {
			printText("\u2717 Timed out waiting for authentication. Run 'dazzle login' to try again.")
		}
		os.Exit(1)
	}

	if err := saveCredentials(&Credentials{
		APIKey:  result.Token,
		Email:   result.Email,
		KeyName: result.KeyName,
	}); err != nil {
		return fmt.Errorf("save credentials: %w", err)
	}

	if ctx.JSON {
		printJSON(LoginResponse{Email: result.Email, KeyName: result.KeyName})
	} else {
		if result.Email != "" {
			printText("\u2713 Logged in as %s (API key: %q)", result.Email, result.KeyName)
		} else {
			printText("\u2713 Logged in (API key: %q)", result.KeyName)
		}
	}
	return nil
}

// LogoutCmd handles `dazzle logout`.
type LogoutCmd struct{}

func (c *LogoutCmd) Run(ctx *Context) error {
	if err := deleteCredentials(); err != nil {
		return fmt.Errorf("delete credentials: %w", err)
	}
	if ctx.JSON {
		printJSON(LogoutResponse{Status: "logged out"})
	} else {
		printText("Logged out.")
	}
	return nil
}

// WhoamiCmd handles `dazzle whoami`.
type WhoamiCmd struct{}

func (c *WhoamiCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}

	client := apiv1connect.NewUserServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetProfileRequest{})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetProfile(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(resp.Msg)
	} else {
		printText("Name:  %s", resp.Msg.Name)
		printText("Email: %s", resp.Msg.Email)
	}
	return nil
}
