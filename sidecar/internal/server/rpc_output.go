package server

import (
	"context"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
	"github.com/browser-streamer/sidecar/internal/cdp"
	"github.com/browser-streamer/sidecar/internal/pipeline"
)

// outputServer implements sidecarv1connect.OutputPipelineServiceHandler.
type outputServer struct {
	s *Server
}

func (h *outputServer) SetOutputs(ctx context.Context, req *connect.Request[sidecarv1.SetOutputsRequest]) (*connect.Response[sidecarv1.SetOutputsResponse], error) {
	// When using dazzle-render (PipeClient), route outputs to the Rust encoder
	// via CDP instead of starting a separate ffmpeg pipeline in the sidecar.
	if _, isPipe := h.s.cdpClient.(*cdp.PipeClient); isPipe {
		cdpOutputs := make([]cdp.OutputConfig, len(req.Msg.Outputs))
		for i, o := range req.Msg.Outputs {
			cdpOutputs[i] = cdp.OutputConfig{
				Name:        o.Name,
				URL:         o.RtmpUrl,
				Watermarked: req.Msg.Watermarked,
			}
		}
		if err := h.s.cdpClient.SetOutputs(cdpOutputs); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		return connect.NewResponse(&sidecarv1.SetOutputsResponse{}), nil
	}

	// Chrome mode: use the sidecar's ffmpeg pipeline
	outputs := make([]pipeline.Output, len(req.Msg.Outputs))
	for i, o := range req.Msg.Outputs {
		outputs[i] = pipeline.Output{Name: o.Name, RtmpURL: o.RtmpUrl}
	}
	if err := h.s.pipeline.SetOutputs(outputs, req.Msg.Watermarked); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	return connect.NewResponse(&sidecarv1.SetOutputsResponse{}), nil
}
