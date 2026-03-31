// Package bench runs progressive pipeline benchmarks against embedded test scenes.
//
// Each scene is loaded into Chrome via CDP, the ffmpeg pipeline runs for a
// configurable duration, and metrics are collected from:
//   - Browser FPS: measured via requestAnimationFrame timing, polled via CDP
//   - Encoder FPS: from ffmpeg's -progress output
//   - Warnings: frame duplication, DTS jumps, queue overflows from ffmpeg stderr
//
// Usage: /sidecar bench [--duration 30] [--scene static,css_animation,...]
package bench

import (
	"bufio"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/browser-streamer/sidecar/internal/cdp"
	"github.com/browser-streamer/sidecar/internal/pipeline"
)

//go:embed scenes/*.html
var scenesFS embed.FS

// Scene defines a benchmark test case.
type Scene struct {
	Name        string `json:"name"`
	File        string `json:"-"`
	Description string `json:"description"`
}

// Scenes lists all benchmark scenes in order of increasing complexity.
var Scenes = []Scene{
	{Name: "static", File: "scenes/static.html", Description: "Static HTML — no animations, baseline"},
	{Name: "css_animation", File: "scenes/css_animation.html", Description: "CSS transforms + keyframe animations"},
	{Name: "css_backdrop", File: "scenes/css_backdrop.html", Description: "backdrop-filter blur on 4 overlapping panels"},
	{Name: "dom_heavy", File: "scenes/dom_heavy.html", Description: "200 DOM elements repositioned every frame"},
	{Name: "canvas2d", File: "scenes/canvas2d.html", Description: "Canvas 2D — 300 particles with connections"},
	{Name: "canvas_heavy", File: "scenes/canvas_heavy.html", Description: "Canvas 2D — 1000 particles with connections"},
	{Name: "webgl_basic", File: "scenes/webgl_basic.html", Description: "WebGL rotating cube"},
	{Name: "webgl_phong", File: "scenes/webgl_phong.html", Description: "Phong-lit icosphere (5120 tris)"},
	{Name: "webgl_50k", File: "scenes/webgl_50k.html", Description: "Phong-lit icosphere (40960 tris)"},
	{Name: "webgl_instanced", File: "scenes/webgl_instanced.html", Description: "100 Phong-lit spheres (512K tris total)"},
	{Name: "shader_simple", File: "scenes/shader_simple.html", Description: "Single sphere SDF — 48 steps, no noise"},
	{Name: "shader_noise2", File: "scenes/shader_noise2.html", Description: "SDF + 2-octave noise — 64 steps"},
	{Name: "shader_postprocess", File: "scenes/shader_postprocess.html", Description: "SDF scene + gaussian blur post-process (2 passes)"},
	{Name: "shader_medium", File: "scenes/shader_medium.html", Description: "Terrain + 6-octave FBM + shadows (100 steps)"},
}

// Result holds metrics from a single scene benchmark run.
type Result struct {
	Scene       string  `json:"scene"`
	Description string  `json:"description"`
	Duration    float64 `json:"duration_s"`

	// Browser FPS (measured via requestAnimationFrame, polled via CDP)
	BrowserFPSAvg float64 `json:"browser_fps_avg"`
	BrowserFPSMin float64 `json:"browser_fps_min"`
	BrowserFPSP5  float64 `json:"browser_fps_p5"`

	// Encoder FPS (from ffmpeg -progress output)
	EncoderFPSAvg float64 `json:"encoder_fps_avg"`
	EncoderFPSMin float64 `json:"encoder_fps_min"`

	// Speed (encoding speed relative to realtime, 1.0 = keeping up)
	SpeedAvg float64 `json:"speed_avg"`
	SpeedMin float64 `json:"speed_min"`

	// Warnings parsed from ffmpeg stderr
	DuplicatedFrames int `json:"duplicated_frames"`
	DroppedFrames    int `json:"dropped_frames"`
	DTSWarnings      int `json:"dts_warnings"`
	QueueWarnings    int `json:"queue_warnings"`

	// Pass/fail based on thresholds
	Pass bool `json:"pass"`
}

// Report is the full benchmark output.
type Report struct {
	Timestamp string   `json:"timestamp"`
	Display   string   `json:"display"`
	Screen    string   `json:"screen"`
	Duration  int      `json:"scene_duration_s"`
	Results   []Result `json:"results"`
	AllPass   bool     `json:"all_pass"`
}

// Config controls the benchmark run.
type Config struct {
	Display       string   // X11 display (default ":99")
	ScreenSize    string   // e.g. "1280x720"
	CDPHost       string   // Chrome CDP host
	CDPPort       string   // Chrome CDP port
	SceneDuration int      // seconds per scene
	BenchPort     int      // port to serve scene HTML
	Scenes        []string // scene names to run (empty = all)

	// Thresholds
	MinBrowserFPS float64 // minimum acceptable browser FPS (default 20)
	MaxDupFrames  int     // max duplicated frames per scene (default 500)
}

func DefaultConfig() Config {
	return Config{
		Display:       envOrDefault("DISPLAY", ":99"),
		ScreenSize:    fmt.Sprintf("%sx%s", envOrDefault("SCREEN_WIDTH", "1280"), envOrDefault("SCREEN_HEIGHT", "720")),
		CDPHost:       "localhost",
		CDPPort:       "9222",
		SceneDuration: 30,
		BenchPort:     9876,
		MinBrowserFPS: 20,
		MaxDupFrames:  500,
	}
}

// fpsScript is injected into the page to measure real browser rendering FPS.
// It uses requestAnimationFrame timing and exposes results via window.__benchFPS.
const fpsScript = `
(function() {
  if (window.__benchFPS !== undefined) return;
  window.__benchFPS = { current: 0, samples: [] };
  let frames = 0, lastTime = performance.now();
  function tick(now) {
    frames++;
    const elapsed = now - lastTime;
    if (elapsed >= 1000) {
      const fps = frames * 1000 / elapsed;
      window.__benchFPS.current = fps;
      window.__benchFPS.samples.push(Math.round(fps * 10) / 10);
      // Keep last 120 samples max
      if (window.__benchFPS.samples.length > 120) window.__benchFPS.samples.shift();
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
`

// Run executes the benchmark suite and returns the report.
func Run(cfg Config) (*Report, error) {
	scenes := Scenes
	if len(cfg.Scenes) > 0 {
		scenes = filterScenes(cfg.Scenes)
	}
	if len(scenes) == 0 {
		return nil, fmt.Errorf("no valid scenes specified")
	}

	// Start HTTP server to serve embedded scene HTML
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "scenes/static.html"
		}
		data, err := scenesFS.ReadFile(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
	srv := &http.Server{Addr: fmt.Sprintf(":%d", cfg.BenchPort), Handler: mux}
	go srv.ListenAndServe()
	defer srv.Close()

	// Wait for HTTP server to be ready
	for i := 0; i < 20; i++ {
		resp, err := http.Get(fmt.Sprintf("http://localhost:%d/scenes/static.html", cfg.BenchPort))
		if err == nil {
			resp.Body.Close()
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	cdpClient := cdp.NewClient(cfg.CDPHost, cfg.CDPPort)

	report := &Report{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Display:   cfg.Display,
		Screen:    cfg.ScreenSize,
		Duration:  cfg.SceneDuration,
		AllPass:   true,
	}

	for _, scene := range scenes {
		log.Printf("bench: running scene %q (%s)", scene.Name, scene.Description)

		result, err := runScene(cfg, cdpClient, scene)
		if err != nil {
			log.Printf("bench: scene %q failed: %v", scene.Name, err)
			result = &Result{
				Scene:       scene.Name,
				Description: scene.Description,
				Pass:        false,
			}
		}

		report.Results = append(report.Results, *result)
		if !result.Pass {
			report.AllPass = false
		}
	}

	return report, nil
}

func runScene(cfg Config, cdpClient *cdp.Client, scene Scene) (*Result, error) {
	// Navigate Chrome to the scene
	sceneURL := fmt.Sprintf("http://localhost:%d/%s", cfg.BenchPort, scene.File)
	if err := cdpClient.Navigate(sceneURL); err != nil {
		return nil, fmt.Errorf("navigate: %w", err)
	}

	// Let the scene initialize (shader compilation, etc.)
	time.Sleep(3 * time.Second)

	// Inject FPS measurement script
	cdpClient.Evaluate(fpsScript)

	// Wait for the FPS counter to produce its first sample
	time.Sleep(2 * time.Second)

	// Create pipeline (starts idle — SetOutputs triggers encoding)
	p := pipeline.New(cfg.Display, cfg.ScreenSize)

	// Collect encoder FPS samples via stats callback
	var mu sync.Mutex
	var encoderFPSSamples []float64
	var speedSamples []float64
	p.SetStatsCallback(func(s pipeline.Stats) {
		mu.Lock()
		defer mu.Unlock()
		if s.FPS > 0 {
			encoderFPSSamples = append(encoderFPSSamples, s.FPS)
		}
		if s.Speed > 0 {
			speedSamples = append(speedSamples, s.Speed)
		}
	})

	// Capture stderr for warnings
	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("pipe: %w", err)
	}
	var warnings stderrWarnings
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		warnings = parseStderr(stderrR)
	}()

	origStderr := os.Stderr
	os.Stderr = stderrW

	// Start pipeline with a dummy local output for benchmarking
	os.MkdirAll("/tmp/bench-hls", 0o755)
	if err := p.SetOutputs([]pipeline.Output{{Name: "bench", RtmpURL: "rtmp://localhost:1935/bench/test"}}); err != nil {
		os.Stderr = origStderr
		stderrW.Close()
		stderrR.Close()
		return nil, fmt.Errorf("start pipeline: %w", err)
	}

	// Poll browser FPS via CDP every 2 seconds during the run
	var browserFPSSamples []float64
	pollStop := make(chan struct{})
	pollDone := make(chan struct{})
	go func() {
		defer close(pollDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-pollStop:
				return
			case <-ticker.C:
				fps := pollBrowserFPS(cdpClient)
				if fps > 0 {
					mu.Lock()
					browserFPSSamples = append(browserFPSSamples, fps)
					mu.Unlock()
				}
			}
		}
	}()

	// Run for the configured duration
	time.Sleep(time.Duration(cfg.SceneDuration) * time.Second)

	// Collect final browser FPS samples before stopping
	if samplesJSON := pollBrowserFPSSamples(cdpClient); len(samplesJSON) > 0 {
		mu.Lock()
		browserFPSSamples = samplesJSON
		mu.Unlock()
	}

	// Signal poll goroutine to stop, then stop pipeline
	close(pollStop)
	<-pollDone
	p.Stop()
	os.Stderr = origStderr
	stderrW.Close()
	wg.Wait()
	stderrR.Close()

	// Compute stats
	mu.Lock()
	bFPS := browserFPSSamples
	eFPS := encoderFPSSamples
	speed := speedSamples
	mu.Unlock()

	result := &Result{
		Scene:            scene.Name,
		Description:      scene.Description,
		Duration:         float64(cfg.SceneDuration),
		DuplicatedFrames: warnings.duplicated,
		DroppedFrames:    warnings.dropped,
		DTSWarnings:      warnings.dts,
		QueueWarnings:    warnings.queue,
	}

	if len(bFPS) > 0 {
		result.BrowserFPSAvg = avg(bFPS)
		result.BrowserFPSMin = minVal(bFPS)
		result.BrowserFPSP5 = percentile(bFPS, 5)
	}
	if len(eFPS) > 0 {
		result.EncoderFPSAvg = avg(eFPS)
		result.EncoderFPSMin = minVal(eFPS)
	}
	if len(speed) > 0 {
		result.SpeedAvg = avg(speed)
		result.SpeedMin = minVal(speed)
	}

	// Pass/fail: based on browser FPS (the actual user experience metric)
	result.Pass = result.BrowserFPSAvg >= cfg.MinBrowserFPS && result.DuplicatedFrames <= cfg.MaxDupFrames

	log.Printf("bench: scene %q — browser_fps=%.1f/%.1f/%.1f encoder_fps=%.1f speed=%.2fx duped=%d dts=%d queue=%d pass=%v",
		scene.Name, result.BrowserFPSAvg, result.BrowserFPSMin, result.BrowserFPSP5,
		result.EncoderFPSAvg, result.SpeedAvg,
		result.DuplicatedFrames, result.DTSWarnings, result.QueueWarnings, result.Pass)

	return result, nil
}

// pollBrowserFPS reads the current FPS from the injected __benchFPS counter.
func pollBrowserFPS(c *cdp.Client) float64 {
	val, err := c.Evaluate("window.__benchFPS ? window.__benchFPS.current : 0")
	if err != nil {
		return 0
	}
	f, _ := strconv.ParseFloat(val, 64)
	return f
}

// pollBrowserFPSSamples reads all collected FPS samples from the browser.
func pollBrowserFPSSamples(c *cdp.Client) []float64 {
	val, err := c.Evaluate("window.__benchFPS ? JSON.stringify(window.__benchFPS.samples) : '[]'")
	if err != nil {
		return nil
	}
	var samples []float64
	json.Unmarshal([]byte(val), &samples)
	return samples
}

// PrintReport outputs the report as formatted text + JSON.
func PrintReport(r *Report) {
	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════════════════════════════")
	fmt.Printf("  Pipeline Benchmark Report — %s\n", r.Timestamp)
	fmt.Printf("  Display: %s  Screen: %s  Duration: %ds/scene\n", r.Display, r.Screen, r.Duration)
	fmt.Println("═══════════════════════════════════════════════════════════════════════════════════════")
	fmt.Println()

	fmt.Printf("  %-20s %8s %8s %8s %8s %8s %6s %5s %5s %s\n",
		"SCENE", "BR_AVG", "BR_MIN", "BR_P5", "ENC_AVG", "ENC_MIN", "DUPED", "DTS", "QUEUE", "")
	fmt.Println("  " + strings.Repeat("─", 95))

	for _, res := range r.Results {
		status := "PASS"
		if !res.Pass {
			status = "FAIL"
		}
		fmt.Printf("  %-20s %7.1f %7.1f %7.1f %7.1f %7.1f %6d %5d %5d  %s\n",
			res.Scene, res.BrowserFPSAvg, res.BrowserFPSMin, res.BrowserFPSP5,
			res.EncoderFPSAvg, res.EncoderFPSMin,
			res.DuplicatedFrames, res.DTSWarnings, res.QueueWarnings, status)
	}

	fmt.Println()
	if r.AllPass {
		fmt.Println("  Result: ALL PASS")
	} else {
		fmt.Println("  Result: FAIL — one or more scenes below threshold")
	}
	fmt.Println()

	data, _ := json.MarshalIndent(r, "", "  ")
	fmt.Println(string(data))
}

// --- stderr parsing ---

type stderrWarnings struct {
	duplicated int
	dropped    int
	dts        int
	queue      int
}

var (
	reDup   = regexp.MustCompile(`(\d+) duplicated`)
	reDrop  = regexp.MustCompile(`(\d+) dropped`)
	reDTS   = regexp.MustCompile(`(?i)non.monoton|DTS .* < .* out of order`)
	reQueue = regexp.MustCompile(`thread_queue_size|Thread message queue blocking`)
)

func parseStderr(r io.Reader) stderrWarnings {
	var w stderrWarnings
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		if m := reDup.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			w.duplicated += n
		}
		if m := reDrop.FindStringSubmatch(line); m != nil {
			n, _ := strconv.Atoi(m[1])
			w.dropped += n
		}
		if reDTS.MatchString(line) {
			w.dts++
		}
		if reQueue.MatchString(line) {
			w.queue++
		}
	}
	return w
}

// --- helpers ---

func filterScenes(names []string) []Scene {
	nameSet := make(map[string]bool)
	for _, n := range names {
		nameSet[n] = true
	}
	var out []Scene
	for _, s := range Scenes {
		if nameSet[s.Name] {
			out = append(out, s)
		}
	}
	return out
}

func avg(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	s := 0.0
	for _, x := range v {
		s += x
	}
	return s / float64(len(v))
}

func minVal(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	m := v[0]
	for _, x := range v[1:] {
		if x < m {
			m = x
		}
	}
	return m
}

func maxVal(v []float64) float64 {
	if len(v) == 0 {
		return 0
	}
	m := v[0]
	for _, x := range v[1:] {
		if x > m {
			m = x
		}
	}
	return m
}

func percentile(v []float64, p float64) float64 {
	if len(v) == 0 {
		return 0
	}
	sorted := make([]float64, len(v))
	copy(sorted, v)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	idx := int(math.Floor(p / 100.0 * float64(len(sorted))))
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
