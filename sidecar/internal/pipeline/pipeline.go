// Package pipeline manages an ffmpeg process that captures the Xvfb display
// and outputs HLS (always) and optionally RTMP (when broadcasting).
// It replaces OBS Studio, eliminating the expensive llvmpipe GL compositor.
package pipeline

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Stats holds current pipeline metrics.
type Stats struct {
	FPS                 float64
	DroppedFrames       int64
	DroppedFramesRecent int64
	TotalBytes          int64
	Speed               float64
	Broadcasting        bool
	UptimeSeconds       int64
}

// Pipeline manages the ffmpeg process lifecycle.
type Pipeline struct {
	mu sync.Mutex

	display    string // e.g. ":99"
	screenSize string // e.g. "1280x720"
	hlsDir     string // e.g. "/tmp/hls"
	framerate  int

	// HLS settings
	hlsBitrate int // kbps

	// Broadcast settings
	broadcasting bool
	rtmpURL      string // full URL including stream key

	// Encoding settings
	videoCodec  string // "libx264" (default) or "h264_nvenc"
	rtmpBitrate int    // kbps
	rtmpPreset  string // x264 preset

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

// WithHLSBitrate sets the HLS bitrate in kbps (default 2500).
func WithHLSBitrate(kbps int) Option {
	return func(p *Pipeline) { p.hlsBitrate = kbps }
}

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

// New creates a pipeline. Call Start() to begin.
func New(display, screenSize, hlsDir string, opts ...Option) *Pipeline {
	p := &Pipeline{
		display:     display,
		screenSize:  screenSize,
		hlsDir:      hlsDir,
		framerate:   30,
		videoCodec:  "libx264",
		hlsBitrate:  2500,
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

// Start begins the ffmpeg pipeline in HLS-only mode.
func (p *Pipeline) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	os.MkdirAll(p.hlsDir, 0o755)
	return p.startLocked()
}

// StartBroadcast restarts the pipeline with both HLS and RTMP outputs.
func (p *Pipeline) StartBroadcast(rtmpURL string) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.broadcasting = true
	p.rtmpURL = rtmpURL

	p.stopLocked()
	return p.startLocked()
}

// StopBroadcast restarts the pipeline in HLS-only mode.
func (p *Pipeline) StopBroadcast() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.broadcasting = false
	p.rtmpURL = ""

	p.stopLocked()
	return p.startLocked()
}

// Stop kills the ffmpeg process.
func (p *Pipeline) Stop() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stopped = true
	p.stopLocked()
}

// IsBroadcasting returns whether the RTMP output is active.
func (p *Pipeline) IsBroadcasting() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.broadcasting
}

// Stats returns current pipeline stats.
func (p *Pipeline) GetStats() Stats {
	p.mu.Lock()
	defer p.mu.Unlock()
	s := p.stats
	s.Broadcasting = p.broadcasting
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
	log.Printf("ffmpeg pipeline: starting [broadcasting=%v]", p.broadcasting)

	var cmd *exec.Cmd
	if p.broadcasting && p.rtmpURL != "" {
		// Pass RTMP URL via env var instead of command-line arg to prevent
		// exposure via /proc/<pid>/cmdline on multi-tenant GPU pods.
		// /proc/<pid>/environ is UID-protected (owner-only read).
		shellArgs := strings.Join(quoteArgs(args), " ") + ` "$RTMP_URL"`
		cmd = exec.Command("sh", "-c", "exec ffmpeg "+shellArgs)
		cmd.Env = append(os.Environ(), "RTMP_URL="+p.rtmpURL)
	} else {
		cmd = exec.Command("ffmpeg", args...)
	}
	cmd.Stderr = os.Stderr // ffmpeg logs to stderr

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
	if !p.stopped {
		p.startLocked()
	}
}

func (p *Pipeline) buildArgs() []string {
	gop := fmt.Sprintf("%d", p.framerate) // keyframe every 1 second
	segPattern := fmt.Sprintf("%s/seg%%03d.ts", p.hlsDir)
	hlsOut := fmt.Sprintf("%s/stream.m3u8", p.hlsDir)
	fpsStr := fmt.Sprintf("%d", p.framerate)

	args := []string{
		"-loglevel", "warning",
		"-nostdin",
		// Use wall clock for all input timestamps — prevents x11grab's
		// internal clock from drifting when input threads stall.
		"-use_wallclock_as_timestamps", "1",
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
	}

	if p.broadcasting {
		// Two outputs: HLS + RTMP broadcast (both native resolution)
		args = append(args,
			// HLS output
			"-map", "0:v", "-map", "1:a",
		)
		args = append(args, p.hlsCodecArgs(gop)...)
		args = append(args,
			"-c:a", "aac", "-b:a", "96k",
			"-f", "hls",
			"-hls_time", "1",
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+append_list",
			"-hls_segment_filename", segPattern,
			hlsOut,

			// RTMP output
			"-map", "0:v", "-map", "1:a",
		)
		args = append(args, p.rtmpCodecArgs()...)
		args = append(args,
			"-c:a", "aac", "-b:a", "128k",
			"-f", "flv",
		)
		// RTMP URL is appended via $RTMP_URL env var in startLocked
		// to keep it out of /proc/<pid>/cmdline.
	} else {
		// HLS only
		args = append(args, p.hlsCodecArgs(gop)...)
		args = append(args,
			"-c:a", "aac", "-b:a", "96k",
			"-f", "hls",
			"-hls_time", "1",
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+append_list",
			"-hls_segment_filename", segPattern,
			hlsOut,
		)
	}

	return args
}

// hlsCodecArgs returns codec args for HLS (CRF mode).
func (p *Pipeline) hlsCodecArgs(gop string) []string {
	switch p.videoCodec {
	case "h264_nvenc":
		return []string{
			"-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll",
			"-rc", "vbr", "-cq", "28",
			"-g", gop,
		}
	default: // libx264
		return []string{
			"-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-threads", "2",
			"-crf", "28",
			"-g", gop,
		}
	}
}

// rtmpCodecArgs returns codec args for RTMP broadcast output.
func (p *Pipeline) rtmpCodecArgs() []string {
	switch p.videoCodec {
	case "h264_nvenc":
		return []string{
			"-c:v", "h264_nvenc", "-preset", "p4", "-tune", "ll",
			"-rc", "cbr",
			"-b:v", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-maxrate", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-bufsize", fmt.Sprintf("%dk", p.rtmpBitrate*2),
			"-g", fmt.Sprintf("%d", p.framerate*2),
		}
	default: // libx264
		return []string{
			"-c:v", "libx264", "-preset", p.rtmpPreset, "-tune", "zerolatency", "-threads", "2",
			"-pix_fmt", "yuv420p",
			"-b:v", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-maxrate", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-bufsize", fmt.Sprintf("%dk", p.rtmpBitrate*2),
			"-g", fmt.Sprintf("%d", p.framerate*2),
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
				s.Broadcasting = p.broadcasting
				p.mu.Unlock()
				p.statsCallback(s)
				continue
			}
		}
		p.mu.Unlock()
	}
}

// quoteArgs shell-quotes each argument for safe embedding in sh -c.
func quoteArgs(args []string) []string {
	out := make([]string, len(args))
	for i, a := range args {
		out[i] = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
	}
	return out
}
