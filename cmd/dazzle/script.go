package main

import (
	"context"
	"fmt"
	"io"
	"os"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	"github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// ScriptCmd groups script subcommands.
type ScriptCmd struct {
	Set  ScriptSetCmd  `cmd:"" help:"Set script from file or stdin."`
	Get  ScriptGetCmd  `cmd:"" help:"Print current script to stdout."`
	Edit ScriptEditCmd `cmd:"" help:"Find and replace in the live script."`
}

// ScriptSetCmd sets the script on the active stage.
type ScriptSetCmd struct {
	File      string `arg:"" help:"Script file path (use - for stdin)."`
}

func (c *ScriptSetCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	var content []byte
	var err error
	if c.File == "-" {
		content, err = io.ReadAll(os.Stdin)
	} else {
		content, err = os.ReadFile(c.File)
	}
	if err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.SetScriptRequest{
		StageId: ctx.StageID,
		Script:  string(content),
	})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err = client.SetScript(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]any{"ok": true, "bytes": len(content)})
	} else {
		printText("Script set (%d bytes).", len(content))
	}
	return nil
}

// ScriptGetCmd prints the current script to stdout.
type ScriptGetCmd struct {
}

func (c *ScriptGetCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.GetScriptRequest{
		StageId: ctx.StageID,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	resp, err := client.GetScript(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]string{"script": resp.Msg.Script})
	} else {
		fmt.Print(resp.Msg.Script)
	}
	return nil
}

// ScriptEditCmd performs a find/replace on the live script.
type ScriptEditCmd struct {
	Old       string `help:"String to find (must be unique)." name:"old" required:""`
	New       string `help:"Replacement string." name:"new" required:""`
}

func (c *ScriptEditCmd) Run(ctx *Context) error {
	if err := ctx.requireAuth(); err != nil {
		return err
	}
	if err := ctx.resolveStage(); err != nil {
		return err
	}

	client := apiv1connect.NewRuntimeServiceClient(ctx.HTTPClient, ctx.APIURL)
	req := connect.NewRequest(&apiv1.EditScriptRequest{
		StageId:   ctx.StageID,
		OldString: c.Old,
		NewString: c.New,
	})
	req.Header().Set("Authorization", ctx.authHeader())
	_, err := client.EditScript(context.Background(), req)
	if err != nil {
		return err
	}

	if ctx.JSON {
		printJSON(map[string]bool{"ok": true})
	} else {
		printText("Edit applied.")
	}
	return nil
}
