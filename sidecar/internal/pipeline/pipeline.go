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
	FPS           float64
	DroppedFrames int64
	TotalBytes    int64
	Speed         float64
	Broadcasting  bool
}

// Pipeline manages the ffmpeg process lifecycle.
type Pipeline struct {
	mu sync.Mutex

	display    string // e.g. ":99"
	screenSize string // e.g. "1280x720"
	hlsDir     string // e.g. "/tmp/hls"
	framerate  int

	// HLS preview settings
	hlsWidth   int
	hlsHeight  int
	hlsBitrate int // kbps

	// Broadcast settings
	broadcasting bool
	rtmpURL      string // full URL including stream key

	// Broadcast encoding settings
	rtmpBitrate int    // kbps
	rtmpPreset  string // x264 preset

	cmd *exec.Cmd

	// Stats
	stats         Stats
	statsCallback func(Stats)

	// Shutdown
	stopped bool
}

// Option configures the pipeline.
type Option func(*Pipeline)

// WithHLSSize sets the HLS preview resolution (default 1280x720).
func WithHLSSize(w, h int) Option {
	return func(p *Pipeline) { p.hlsWidth = w; p.hlsHeight = h }
}

// WithHLSBitrate sets the HLS preview bitrate in kbps (default 2500).
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
		hlsWidth:    1280,
		hlsHeight:   720,
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
	return s
}

func (p *Pipeline) startLocked() error {
	args := p.buildArgs()
	log.Printf("ffmpeg pipeline: starting [broadcasting=%v]", p.broadcasting)

	cmd := exec.Command("ffmpeg", args...)
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

// needsScale returns true if HLS output differs from capture resolution.
func (p *Pipeline) needsScale() bool {
	captureSize := fmt.Sprintf("%dx%d", p.hlsWidth, p.hlsHeight)
	return p.screenSize != captureSize
}

func (p *Pipeline) buildArgs() []string {
	gop := fmt.Sprintf("%d", p.framerate) // keyframe every second
	segPattern := fmt.Sprintf("%s/seg%%03d.ts", p.hlsDir)
	hlsOut := fmt.Sprintf("%s/stream.m3u8", p.hlsDir)

	args := []string{
		"-loglevel", "warning",
		"-nostdin",
		// Video input: X11 grab
		"-f", "x11grab",
		"-video_size", p.screenSize,
		"-framerate", fmt.Sprintf("%d", p.framerate),
		"-i", p.display,
		// Audio input: PulseAudio
		"-f", "pulse", "-i", "default",
		// Progress output for stats
		"-progress", "pipe:1",
	}

	// HLS video filter: only scale if capture != output resolution
	hlsVF := []string{}
	if p.needsScale() {
		hlsVF = append(hlsVF, fmt.Sprintf("scale=%d:%d", p.hlsWidth, p.hlsHeight))
	}

	if p.broadcasting {
		// Two outputs: HLS preview + RTMP broadcast
		hlsArgs := []string{
			"-map", "0:v", "-map", "1:a",
			"-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-threads", "2",
			"-crf", "28", "-maxrate", fmt.Sprintf("%dk", p.hlsBitrate), "-bufsize", fmt.Sprintf("%dk", p.hlsBitrate*2),
			"-g", gop,
		}
		if len(hlsVF) > 0 {
			hlsArgs = append(hlsArgs, "-vf", strings.Join(hlsVF, ","))
		}
		hlsArgs = append(hlsArgs,
			"-c:a", "aac", "-b:a", "96k",
			"-f", "hls",
			"-hls_time", "1",
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+append_list",
			"-hls_segment_filename", segPattern,
			hlsOut,
		)
		args = append(args, hlsArgs...)

		// RTMP output (broadcast quality — keeps zerolatency for live delivery)
		args = append(args,
			"-map", "0:v", "-map", "1:a",
			"-c:v", "libx264", "-preset", p.rtmpPreset, "-tune", "zerolatency", "-threads", "2",
			"-b:v", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-maxrate", fmt.Sprintf("%dk", p.rtmpBitrate),
			"-bufsize", fmt.Sprintf("%dk", p.rtmpBitrate*2),
			"-g", fmt.Sprintf("%d", p.framerate*2), // 2-second GOP for RTMP
			"-c:a", "aac", "-b:a", "128k",
			"-f", "flv",
			p.rtmpURL,
		)
	} else {
		// HLS only — CRF mode lets ultrafast take shortcuts on easy frames.
		hlsArgs := []string{
			"-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-threads", "2",
			"-crf", "28", "-maxrate", fmt.Sprintf("%dk", p.hlsBitrate), "-bufsize", fmt.Sprintf("%dk", p.hlsBitrate*2),
			"-g", gop,
		}
		if len(hlsVF) > 0 {
			hlsArgs = append(hlsArgs, "-vf", strings.Join(hlsVF, ","))
		}
		hlsArgs = append(hlsArgs,
			"-c:a", "aac", "-b:a", "96k",
			"-f", "hls",
			"-hls_time", "1",
			"-hls_list_size", "5",
			"-hls_flags", "delete_segments+append_list",
			"-hls_segment_filename", segPattern,
			hlsOut,
		)
		args = append(args, hlsArgs...)
	}

	return args
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
