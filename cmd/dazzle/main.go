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

	// Auth commands
	Login  LoginCmd  `cmd:"" help:"Authenticate with your API key."`
	Logout LogoutCmd `cmd:"" help:"Clear stored credentials."`
	Whoami WhoamiCmd `cmd:"" help:"Show current user."`

	// Resource commands
	Stage_      StageCmd       `cmd:"" name:"stage" aliases:"s" help:"Manage stages."`
	Destination DestinationCmd `cmd:"" name:"destination" aliases:"dest" help:"Manage RTMP destinations."`
	Obs         ObsCmd         `cmd:"" name:"obs" aliases:"o" help:"Raw OBS commands on the active stage."`
}

func main() {
	k := kong.Parse(&cli,
		kong.Name("dazzle"),
		kong.Description("The Dazzle CLI — manage your streaming stages from the terminal."),
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
}
