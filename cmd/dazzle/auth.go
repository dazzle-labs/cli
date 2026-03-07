package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
	"golang.org/x/term"
)

// LoginCmd handles `dazzle login`.
type LoginCmd struct {
	APIKey string `help:"API key to store (skips interactive prompt)." name:"api-key"`
}

func (c *LoginCmd) Run(ctx *Context) error {
	apiKey := c.APIKey

	if apiKey == "" {
		// Check if stdin is a TTY — if not, read from stdin (CI/pipe mode)
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			scanner := bufio.NewScanner(os.Stdin)
			if scanner.Scan() {
				apiKey = strings.TrimSpace(scanner.Text())
			}
		} else {
			// Interactive: hide input so it doesn't appear in terminal history
			fmt.Print("Enter your API key (from stream.dazzle.fm/settings): ")
			keyBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
			fmt.Println() // newline after hidden input
			if err != nil {
				return fmt.Errorf("read api key: %w", err)
			}
			apiKey = strings.TrimSpace(string(keyBytes))
		}
	}

	if apiKey == "" {
		return errors.New("api key cannot be empty")
	}
	if !strings.HasPrefix(apiKey, "dzl_") && !strings.HasPrefix(apiKey, "bstr_") {
		return errors.New("invalid api key format -- must start with dzl_")
	}

	if err := saveCredentials(&Credentials{APIKey: apiKey}); err != nil {
		return fmt.Errorf("save credentials: %w", err)
	}

	if ctx.JSON {
		printJSON(map[string]string{"status": "logged in"})
	} else {
		printText("Logged in. Run 'dazzle whoami' to verify.")
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
		printJSON(map[string]string{"status": "logged out"})
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
