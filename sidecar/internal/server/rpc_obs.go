package server

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
)

// obsServer implements sidecarv1connect.ObsServiceHandler.
type obsServer struct {
	s *Server
}

func (h *obsServer) Command(ctx context.Context, req *connect.Request[sidecarv1.ObsCommandRequest]) (*connect.Response[sidecarv1.ObsCommandResponse], error) {
	// Shell out to gobs-cli against local OBS
	cmdArgs := append([]string{"--host", h.s.cfg.OBSHost, "--port", h.s.cfg.OBSPort}, req.Msg.Args...)
	cmd := exec.CommandContext(ctx, "gobs-cli", cmdArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := stderr.String()
		if errMsg == "" {
			errMsg = err.Error()
		}
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("%s", errMsg))
	}

	out := stdout.String()
	if out == "" {
		out = "OK"
	}

	return connect.NewResponse(&sidecarv1.ObsCommandResponse{Output: out}), nil
}
