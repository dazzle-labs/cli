package server

import (
	"net/http"

	"github.com/browser-streamer/sidecar/internal/pipeline"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	registry = prometheus.NewRegistry()

	pipelineFPS = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "pipeline_fps",
		Help: "Encoding FPS",
	})
	pipelineDroppedFrames = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "pipeline_dropped_frames_total",
		Help: "Total dropped frames",
	})
	pipelineActiveOutputs = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "pipeline_active_outputs",
		Help: "Number of active RTMP output destinations",
	})
	pipelineOutputBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "pipeline_output_bytes_total",
		Help: "Total output bytes",
	})
	pipelineSpeed = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "pipeline_speed",
		Help: "Encoding speed (1.0 = realtime)",
	})
)

func init() {
	registry.MustRegister(
		pipelineFPS,
		pipelineDroppedFrames,
		pipelineActiveOutputs,
		pipelineOutputBytes,
		pipelineSpeed,
	)
	prometheus.DefaultRegisterer = registry
	prometheus.DefaultGatherer = registry
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	promhttp.HandlerFor(registry, promhttp.HandlerOpts{}).ServeHTTP(w, r)
}

// UpdatePipelineStats updates Prometheus gauges from pipeline stats.
func UpdatePipelineStats(stats pipeline.Stats) {
	pipelineFPS.Set(stats.FPS)
	pipelineDroppedFrames.Set(float64(stats.DroppedFrames))
	pipelineOutputBytes.Set(float64(stats.TotalBytes))
	pipelineSpeed.Set(stats.Speed)
	pipelineActiveOutputs.Set(float64(stats.ActiveOutputs))
}
