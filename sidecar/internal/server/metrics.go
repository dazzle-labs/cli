package server

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	registry = prometheus.NewRegistry()

	obsCPUUsage = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_cpu_usage",
		Help: "OBS CPU usage percentage",
	})
	obsMemoryUsage = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_memory_usage_bytes",
		Help: "OBS memory usage in bytes",
	})
	obsActiveFPS = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_active_fps",
		Help: "OBS active FPS",
	})
	obsRenderSkippedFrames = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_render_skipped_frames_total",
		Help: "OBS render skipped frames",
	})
	obsOutputSkippedFrames = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_output_skipped_frames_total",
		Help: "OBS output skipped frames",
	})
	obsOutputActive = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_output_active",
		Help: "Whether OBS output is active",
	})
	obsOutputBytes = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "obs_output_bytes_total",
		Help: "Total OBS output bytes sent",
	})
)

func init() {
	registry.MustRegister(
		obsCPUUsage,
		obsMemoryUsage,
		obsActiveFPS,
		obsRenderSkippedFrames,
		obsOutputSkippedFrames,
		obsOutputActive,
		obsOutputBytes,
	)
	prometheus.DefaultRegisterer = registry
	prometheus.DefaultGatherer = registry
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	promhttp.HandlerFor(registry, promhttp.HandlerOpts{}).ServeHTTP(w, r)
}

// UpdateOBSStats updates Prometheus gauges with OBS stats data.
func UpdateOBSStats(stats map[string]any) {
	if v, ok := stats["cpuUsage"].(float64); ok {
		obsCPUUsage.Set(v)
	}
	if v, ok := stats["memoryUsage"].(float64); ok {
		obsMemoryUsage.Set(v)
	}
	if v, ok := stats["activeFps"].(float64); ok {
		obsActiveFPS.Set(v)
	}
	if v, ok := stats["renderSkippedFrames"].(float64); ok {
		obsRenderSkippedFrames.Set(v)
	}
	if v, ok := stats["outputSkippedFrames"].(float64); ok {
		obsOutputSkippedFrames.Set(v)
	}
}

// UpdateOBSOutputStats updates output-specific gauges.
func UpdateOBSOutputStats(active bool, bytes float64) {
	if active {
		obsOutputActive.Set(1)
	} else {
		obsOutputActive.Set(0)
	}
	obsOutputBytes.Set(bytes)
}
