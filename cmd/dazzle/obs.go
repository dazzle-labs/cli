package main

import "fmt"

// ObsCmd forwards commands to OBS on the active stage.
type ObsCmd struct {
	Args []string `arg:"" optional:"" help:"OBS command arguments (e.g. st s)."`
}

func (c *ObsCmd) Run(ctx *Context) error {
	if len(c.Args) == 0 {
		return fmt.Errorf("no OBS command specified -- see 'dazzle obs --help'")
	}
	return runObsArgs(ctx, c.Args)
}
