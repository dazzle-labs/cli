package main

import (
	"fmt"
	"os"

	"github.com/alecthomas/kong"
)

var cli struct {
	// Global flags
	JSON   bool   `help:"Output as JSON." short:"j" name:"json"`
	Stage  string `help:"Stage name or ID." short:"s" env:"DAZZLE_STAGE"`
	APIURL string `help:"API URL." name:"api-url" env:"DAZZLE_API_URL"`

	// Meta commands
	Version VersionCmd `cmd:"" help:"Print version information."`
	Update  UpdateCmd  `cmd:"" help:"Update dazzle to the latest release."`
	Guide   GuideCmd   `cmd:"" help:"Show content authoring guide (rendering tips, performance, best practices)."`

	// Auth commands
	Login  LoginCmd  `cmd:"" help:"Authenticate with Dazzle (opens browser)."`
	Logout LogoutCmd `cmd:"" help:"Clear stored credentials."`
	Whoami WhoamiCmd `cmd:"" help:"Show current user."`

	// Resource commands
	Stage_      StageCmd       `cmd:"" name:"stage" aliases:"s" help:"Manage stages — create, sync content, screenshot, stream."`
	Destination DestinationCmd `cmd:"" name:"destination" aliases:"dest" help:"Manage broadcast destinations (Twitch, YouTube, etc)."`

	// Integration
	Mcp McpCmd `cmd:"" name:"mcp" help:"Start MCP server on stdin/stdout for AI agent integration." hidden:""`
}

func main() {
	k := kong.Parse(&cli,
		kong.Name("dazzle"),
		kong.Description(`Dazzle — cloud stages for streaming.

A stage is a cloud browser environment that renders and streams your content.
Sync a local directory (must contain an index.html) and everything visible in
the browser window is what gets streamed to viewers.

Your content runs in a real browser with full access to standard web APIs
(DOM, Canvas, WebGL, Web Audio, fetch, etc.). localStorage is persisted across
stage restarts — use it to store app state that should survive between sessions.

Workflow:
  1. dazzle login                       # authenticate (one-time)
  2. dazzle s new my-stage              # create a stage
  3. dazzle s up                        # bring it up — starts streaming to Dazzle
  4. dazzle s sync ./my-app -w          # sync + auto-refresh on changes
  5. dazzle s ss -o preview.png         # take a screenshot to verify
  6. dazzle s down                      # stop streaming and shut down

Stage selection: use -s <name>, DAZZLE_STAGE env, or auto-selected if only one.

https://dazzle.fm`),
		kong.UsageOnError(),
		kong.ConfigureHelp(kong.HelpOptions{Compact: true}),
	)

	appCtx, err := newContext(cli.APIURL, cli.Stage, cli.JSON)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error [Internal]: %v\n", err)
		os.Exit(1)
	}

	if err := k.Run(appCtx); err != nil {
		code := connectErrorCode(err)
		if cli.JSON {
			fmt.Fprintf(os.Stderr, `{"error":%q,"code":%q}`+"\n", err.Error(), code)
		} else {
			fmt.Fprintf(os.Stderr, "Error [%s]: %v\n", code, err)
		}
		os.Exit(1)
	}

	if !cli.JSON && k.Command() != "update" {
		checkForUpdate()
	}
}
