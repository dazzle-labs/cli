// Package pipeline manages an ffmpeg process that captures the Xvfb display
// and outputs to N RTMP destinations simultaneously via the tee muxer.
// It replaces OBS Studio, eliminating the expensive llvmpipe GL compositor.
package pipeline

import (
	"bufio"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Output represents an RTMP output destination.
type Output struct {
	Name    string
	RtmpURL string
}

// Stats holds current pipeline metrics.
type Stats struct {
	FPS                 float64
	DroppedFrames       int64
	DroppedFramesRecent int64
	TotalBytes          int64
	Speed               float64
	ActiveOutputs       int
	OutputNames         []string
	UptimeSeconds       int64
}

// Pipeline manages the ffmpeg process lifecycle.
type Pipeline struct {
	mu sync.Mutex

	display    string // e.g. ":99"
	screenSize string // e.g. "1280x720"
	framerate  int

	// Output settings
	outputs     []Output // current active RTMP outputs
	rtmpBitrate int      // kbps
	rtmpPreset  string   // x264 preset

	// Encoding settings
	videoCodec     string // "libx264" (default) or "h264_nvenc"
	gpuDeviceIndex string // GPU device index for -hwaccel_device (e.g. "4")

	cmd *exec.Cmd

	// Stats
	stats         Stats
	statsCallback func(Stats)
	startedAt     time.Time

	// Rolling window for dropped frames (ring buffer, ~60s at 1 sample/s)
	dropHistory [60]int64
	dropHead    int
	dropCount   int

	// Shutdown
	stopped bool
}

// Option configures the pipeline.
type Option func(*Pipeline)

// WithRTMPBitrate sets the RTMP broadcast bitrate in kbps (default 2500).
func WithRTMPBitrate(kbps int) Option {
	return func(p *Pipeline) { p.rtmpBitrate = kbps }
}

// WithRTMPPreset sets the x264 preset for RTMP (default "veryfast").
func WithRTMPPreset(preset string) Option {
	return func(p *Pipeline) { p.rtmpPreset = preset }
}

// WithVideoCodec sets the video codec (default "libx264", alternative "h264_nvenc").
func WithVideoCodec(codec string) Option {
	return func(p *Pipeline) {
		if codec != "" {
			p.videoCodec = codec
		}
	}
}

// WithFramerate sets the capture framerate (default 30).
func WithFramerate(fps int) Option {
	return func(p *Pipeline) { p.framerate = fps }
}

// WithGPUDeviceIndex sets the GPU device index for NVENC (e.g. "4" for /dev/nvidia4).
func WithGPUDeviceIndex(idx string) Option {
	return func(p *Pipeline) { p.gpuDeviceIndex = idx }
}

// New creates a pipeline. Call SetOutputs() with destinations to begin encoding.
func New(display, screenSize string, opts ...Option) *Pipeline {
	p := &Pipeline{
		display:     display,
		screenSize:  screenSize,
		framerate:   30,
		videoCodec:  "libx264",
		rtmpBitrate: 2500,
		rtmpPreset:  "veryfast",
	}
	for _, o := range opts {
		o(p)
	}
	return p
}

// SetStatsCallback registers a function called with pipeline stats updates.
func (p *Pipeline) SetStatsCallback(cb func(Stats)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.statsCallback = cb
}

// SetOutputs updates the pipeline's RTMP output destinations.
// If outputs changed, the pipeline is restarted with the new configuration.
// If outputs is empty, the pipeline is stopped (no encoding when nobody is receiving).
func (p *Pipeline) SetOutputs(outputs []Output) error {
	for _, o := range outputs {
		if err := validateRTMPURL(o.RtmpURL); err != nil {
			return fmt.Errorf("invalid output %q: %w", o.Name, err)
		}
	}

	p.mu.Lock()
	defer p.mu.Unlock()

	// Check if outputs actually changed
	if outputsEqual(p.outputs, outputs) {
		return nil
	}

	p.outputs = make([]Output, len(outputs))
	copy(p.outputs, outputs)

	// Stop existing pipeline
	p.stopLocked()

	// If no outputs, stay idle
	if len(outputs) == 0 {
		log.Println("ffmpeg pipeline: no outputs configured, staying idle")
		return nil
	}

	return p.startLocked()
}

// Stop kills the ffmpeg process.
func (p *Pipeline) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stopped = true
	p.stopLocked()
}

// GetStats returns current pipeline stats.
func (p *Pipeline) GetStats() Stats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := p.stats
	s.ActiveOutputs = len(p.outputs)
	s.OutputNames = make([]string, len(p.outputs))
	for i, o := range p.outputs {
		s.OutputNames[i] = o.Name
	}
	if !p.startedAt.IsZero() {
		s.UptimeSeconds = int64(time.Since(p.startedAt).Seconds())
	}
	if p.dropCount > 0 {
		oldest := p.dropHistory[(p.dropHead-p.dropCount+60)%60]
		s.DroppedFramesRecent = s.DroppedFrames - oldest
	}
	return s
}

func (p *Pipeline) startLocked() error {
	p.startedAt = time.Now()
	p.dropHead = 0
	p.dropCount = 0

	args := p.buildArgs()
	log.Printf("ffmpeg pipeline: starting [outputs=%d: %s]", len(p.outputs), outputNamesList(p.outputs))

	// RTMP URLs are passed via env vars to hide stream keys from
	// /proc/<pid>/cmdline on multi-tenant GPU pods.
	env := os.Environ()
	for i, o := range p.outputs {
		env = append(env, fmt.Sprintf("RTMP_URL_%d=%s", i, o.RtmpURL))
	}

	shellCmd := "exec ffmpeg " + shellQuoteArgs(args)
	cmd := exec.Command("sh", "-c", shellCmd)
	cmd.Env = env

	// Capture stderr to detect tee slave failures (broken RTMP outputs).
	// Lines not matching our patterns are forwarded to os.Stderr.
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}

	// Use -progress pipe:1 for machine-readable stats on stdout
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start ffmpeg: %w", err)
	}
	p.cmd = cmd

	// Parse progress output in background
	go p.parseProgress(bufio.NewScanner(stdout))

	// Watch stderr for tee slave failures — restart pipeline to reconnect
	go p.watchStderr(bufio.NewScanner(stderrPipe), cmd)

	// Monitor process — restart on unexpected exit
	go p.monitor(cmd)

	return nil
}

func (p *Pipeline) stopLocked() {
	if p.cmd != nil && p.cmd.Process != nil {
		p.cmd.Process.Signal(os.Interrupt)
		done := make(chan struct{})
		go func() {
			p.cmd.Wait()
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			p.cmd.Process.Kill()
			<-done
		}
		p.cmd = nil
	}
}

func (p *Pipeline) monitor(cmd *exec.Cmd) {
	err := cmd.Wait()

	p.mu.Lock()
	stopped := p.stopped
	current := p.cmd == cmd // only restart if this is still the active process
	p.mu.Unlock()

	if stopped || !current {
		return
	}

	if err != nil {
		log.Printf("ffmpeg pipeline: exited (%v), restarting in 2s...", err)
	} else {
		log.Println("ffmpeg pipeline: exited cleanly, restarting in 2s...")
	}

	time.Sleep(2 * time.Second)

	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.stopped && len(p.outputs) > 0 {
		p.startLocked()
	}
}

// watchStderr scans ffmpeg's stderr for tee slave failures and triggers a
// pipeline restart so dropped RTMP outputs reconnect. All other stderr lines
// are forwarded to os.Stderr so ffmpeg warnings remain visible.
func (p *Pipeline) watchStderr(scanner *bufio.Scanner, cmd *exec.Cmd) {
	for scanner.Scan() {
		line := scanner.Text()
		fmt.Fprintln(os.Stderr, line)

		// ffmpeg tee muxer logs: "[tee @ 0x...] Slave muxer #N failed: Broken pipe, continuing with M/K slaves."
		if strings.Contains(line, "Slave muxer") && strings.Contains(line, "failed") {
			log.Printf("ffmpeg pipeline: tee output failed, restarting in 5s to reconnect all outputs")
			// Give a brief window before restarting — avoids tight loops if the
			// destination is persistently unreachable.
			time.Sleep(5 * time.Second)

			p.mu.Lock()
			if !p.stopped && p.cmd == cmd {
				p.stopLocked()
				if len(p.outputs) > 0 {
					p.startLocked()
				}
			}
			p.mu.Unlock()
			return // old process is gone; new watchStderr is running
		}
	}
}

func (p *Pipeline) buildArgs() []string {
	gop := fmt.Sprintf("%d", p.framerate*2) // keyframe every 2 seconds
	fpsStr := fmt.Sprintf("%d", p.framerate)

	var args []string

	args = append(args,
		"-loglevel", "warning",
		"-nostdin",
		// Preserve original capture timestamps. Without this, GPU encoders
		// (NVENC, h264_vulkan) desync with PulseAudio input — the muxer
		// blocks waiting for interleaved packets, dropping to ~3 FPS.
		// CPU encoders (libx264) are unaffected because they encode
		// synchronously, but -copyts is harmless for them.
		"-copyts",
		// Video input: X11 grab
		// Large thread queue absorbs Chrome's bursty software rendering
		// without blocking the input thread (default 8 is ~250ms at 30fps).
		"-thread_queue_size", "512",
		"-f", "x11grab",
		"-video_size", p.screenSize,
		"-framerate", fpsStr,
		"-i", p.display,
		// Audio input: PulseAudio
		"-thread_queue_size", "512",
		"-f", "pulse", "-i", "default",
		// Progress output for stats
		"-progress", "pipe:1",
	)

	codecArgs := p.codecArgs(gop)
	outArgs := []string{"-c:a", "aac", "-b:a", "128k", "-flags", "+global_header"}

	allIdxs := make([]int, len(p.outputs))
	for i := range p.outputs {
		allIdxs[i] = i
	}

	args = append(args, "-map", "0:v", "-map", "1:a")
	args = append(args, codecArgs...)
	args = append(args, outArgs...)
	args = append(args, outputArgsForIdxs(allIdxs)...)

	return args
}

// outputArgsForIdxs returns ffmpeg output arguments for a subset of output indices.
// Single output uses -f flv directly; multiple outputs use the tee muxer
// so the stream is encoded once and written to all destinations.
func outputArgsForIdxs(idxs []int) []string {
	if len(idxs) == 1 {
		return []string{"-f", "flv", fmt.Sprintf("$RTMP_URL_%d", idxs[0])}
	}
	var teeOutputs []string
	for _, idx := range idxs {
		teeOutputs = append(teeOutputs, fmt.Sprintf("[f=flv:onfail=ignore]$RTMP_URL_%d", idx))
	}
	return []string{"-f", "tee", strings.Join(teeOutputs, "|")}
}

// codecArgs returns video codec args for RTMP output.
func (p *Pipeline) codecArgs(gop string) []string {
	switch p.videoCodec {
	case "h264_nvenc":
		// CUDA_VISIBLE_DEVICES=0 is set at process startup (server.go) to
		// remap the physical GPU to logical device 0, so no -gpu flag needed.
		return []string{
			"-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll",
			"-rc", "cbr",
			"-profile:v", "high", "-level:v", "4.1",
			"-pix_fmt", "yuv420p",
			"-b:v", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-maxrate", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-bufsize", fmt.Sprintf("%dk", p.rtmpBitrate*2),
			"-g", gop,
		}
	default: // libx264
		return []string{
			"-c:v", "libx264", "-preset", p.rtmpPreset, "-tune", "zerolatency", "-threads", "2",
			"-pix_fmt", "yuv420p",
			"-b:v", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-maxrate", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-bufsize", fmt.Sprintf("%dk", p.rtmpBitrate*2),
			"-g", gop,
		}
	}
}

// parseProgress reads ffmpeg -progress output and updates stats.
// Format is key=value lines, blocks separated by "progress=..." lines.
func (p *Pipeline) parseProgress(scanner *bufio.Scanner) {
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, val := parts[0], parts[1]

		p.mu.Lock()
		switch key {
		case "fps":
			p.stats.FPS, _ = strconv.ParseFloat(val, 64)
		case "drop_frames":
			p.stats.DroppedFrames, _ = strconv.ParseInt(val, 10, 64)
		case "total_size":
			p.stats.TotalBytes, _ = strconv.ParseInt(val, 10, 64)
		case "speed":
			val = strings.TrimSuffix(val, "x")
			p.stats.Speed, _ = strconv.ParseFloat(val, 64)
		case "progress":
			// Record dropped frames in ring buffer for rolling window
			p.dropHistory[p.dropHead] = p.stats.DroppedFrames
			p.dropHead = (p.dropHead + 1) % 60
			if p.dropCount < 60 {
				p.dropCount++
			}
			// End of a stats block — fire callback
			if p.statsCallback != nil {
				s := p.stats
				s.ActiveOutputs = len(p.outputs)
				p.mu.Unlock()
				p.statsCallback(s)
				continue
			}
		}
		p.mu.Unlock()
	}
}

// validateRTMPURL validates that the URL has a supported RTMP scheme.
// Shell injection is not a concern because RTMP URLs are passed via env vars
// and expanded inside double quotes ("$VAR"), which the shell does not re-parse.
func validateRTMPURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("malformed URL: %w", err)
	}
	switch u.Scheme {
	case "rtmp", "rtmps", "rtmpt", "rtmpte", "rtmpts":
		return nil
	default:
		return fmt.Errorf("unsupported scheme %q (must be rtmp/rtmps)", u.Scheme)
	}
}

// shellQuoteArgs quotes arguments for sh -c. Env var references ($RTMP_URL_N)
// are double-quoted so the shell expands them without word-splitting or glob
// interpretation. All other args are single-quoted.
func shellQuoteArgs(args []string) string {
	var parts []string
	for _, a := range args {
		if strings.Contains(a, "$RTMP_URL_") {
			// The arg may mix literal text with env var refs, e.g.
			// "[f=flv:onfail=ignore]$RTMP_URL_0|[f=flv:onfail=ignore]$RTMP_URL_1"
			// Double-quoting the whole thing lets the shell expand the vars
			// while protecting special chars in the expanded URLs.
			// Escape any existing double quotes and backslashes in the literal parts.
			escaped := strings.ReplaceAll(a, `\`, `\\`)
			escaped = strings.ReplaceAll(escaped, `"`, `\"`)
			escaped = strings.ReplaceAll(escaped, "`", "\\`")
			parts = append(parts, `"`+escaped+`"`)
		} else {
			parts = append(parts, "'"+strings.ReplaceAll(a, "'", `'\''`)+"'")
		}
	}
	return strings.Join(parts, " ")
}

// ProbeCodec tests whether the given video codec is usable by running a
// short ffmpeg encode. Returns nil if the codec works, or an error with
// ffmpeg's stderr output explaining why it failed.
func ProbeCodec(codec string) error {
	args := []string{
		"-loglevel", "error",
		"-f", "lavfi", "-i", "nullsrc=s=256x256:d=0.04",
		"-frames:v", "1",
		"-c:v", codec,
	}
	args = append(args, "-f", "null", "-")
	cmd := exec.Command("ffmpeg", args...)
	// On multi-GPU RunPod hosts, the container gets /dev/nvidiaN where N>0.
	// NVENC enumerates from device 0 and fails with "No capable devices found".
	// CUDA_VISIBLE_DEVICES=0 remaps the physical GPU to logical device 0.
	if strings.Contains(codec, "nvenc") {
		cmd.Env = append(os.Environ(), "CUDA_VISIBLE_DEVICES=0")
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// outputsEqual checks if two output slices are identical.
func outputsEqual(a, b []Output) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Name != b[i].Name || a[i].RtmpURL != b[i].RtmpURL {
			return false
		}
	}
	return true
}

// outputNamesList returns a comma-separated list of output names for logging.
func outputNamesList(outputs []Output) string {
	names := make([]string, len(outputs))
	for i, o := range outputs {
		names[i] = o.Name
	}
	return strings.Join(names, ", ")
}
