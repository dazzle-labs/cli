package pipeline

import (
	"fmt"
	"testing"
	"time"
)

// helper: build args for a pipeline with defaults.
func defaultPipeline(opts ...Option) *Pipeline {
	return New(":99", "1280x720", "/tmp/hls", opts...)
}

// helper: return true if the arg slice contains the exact adjacent pair [flag, value].
func containsPair(args []string, flag, value string) bool {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}

// helper: return true if the arg slice contains the given string anywhere.
func containsArg(args []string, arg string) bool {
	for _, a := range args {
		if a == arg {
			return true
		}
	}
	return false
}

// helper: count how many times a pair [flag, value] appears.
func countPair(args []string, flag, value string) int {
	n := 0
	for i := 0; i < len(args)-1; i++ {
		if args[i] == flag && args[i+1] == value {
			n++
		}
	}
	return n
}

// helper: count occurrences of a single arg.
func countArg(args []string, arg string) int {
	n := 0
	for _, a := range args {
		if a == arg {
			n++
		}
	}
	return n
}

// ---------------------------------------------------------------------------
// GetStats tests
// ---------------------------------------------------------------------------

func TestGetStats_EmptyPipeline(t *testing.T) {
	p := New(":99", "1280x720", "/tmp/hls")
	stats := p.GetStats()

	if stats.UptimeSeconds != 0 {
		t.Errorf("UptimeSeconds = %d, want 0 (pipeline never started)", stats.UptimeSeconds)
	}
	if stats.DroppedFramesRecent != 0 {
		t.Errorf("DroppedFramesRecent = %d, want 0 (empty buffer)", stats.DroppedFramesRecent)
	}
}

func TestDroppedFramesRecent_PartialBuffer(t *testing.T) {
	p := New(":99", "1280x720", "/tmp/hls")
	p.startedAt = time.Now()

	// Simulate 5 progress callbacks with increasing drop counts
	drops := []int64{0, 2, 5, 8, 10}
	for _, d := range drops {
		p.stats.DroppedFrames = d
		p.dropHistory[p.dropHead] = d
		p.dropHead = (p.dropHead + 1) % 60
		if p.dropCount < 60 {
			p.dropCount++
		}
	}

	stats := p.GetStats()
	// Recent = current(10) - oldest(0) = 10
	if stats.DroppedFramesRecent != 10 {
		t.Errorf("DroppedFramesRecent = %d, want 10", stats.DroppedFramesRecent)
	}
}

func TestDroppedFramesRecent_FullBuffer(t *testing.T) {
	p := New(":99", "1280x720", "/tmp/hls")
	p.startedAt = time.Now()

	// Fill exactly 60 entries
	for i := 0; i < 60; i++ {
		d := int64(i * 2)
		p.stats.DroppedFrames = d
		p.dropHistory[p.dropHead] = d
		p.dropHead = (p.dropHead + 1) % 60
		if p.dropCount < 60 {
			p.dropCount++
		}
	}

	stats := p.GetStats()
	// oldest = 0 (entry 0), current = 118, recent = 118
	if stats.DroppedFramesRecent != 118 {
		t.Errorf("DroppedFramesRecent = %d, want 118", stats.DroppedFramesRecent)
	}
}

func TestDroppedFramesRecent_Wrapped(t *testing.T) {
	p := New(":99", "1280x720", "/tmp/hls")
	p.startedAt = time.Now()

	// Write 70 entries (wraps around)
	for i := 0; i < 70; i++ {
		d := int64(i * 3)
		p.stats.DroppedFrames = d
		p.dropHistory[p.dropHead] = d
		p.dropHead = (p.dropHead + 1) % 60
		if p.dropCount < 60 {
			p.dropCount++
		}
	}

	stats := p.GetStats()
	// After 70 writes, head=10, count=60
	// oldest is at index (10-60+60)%60 = 10, which is entry 10 → value 30
	// current = 69*3 = 207
	// recent = 207 - 30 = 177
	if stats.DroppedFramesRecent != 177 {
		t.Errorf("DroppedFramesRecent = %d, want 177", stats.DroppedFramesRecent)
	}
}

func TestUptimeSeconds_ZeroStartedAt(t *testing.T) {
	p := New(":99", "1280x720", "/tmp/hls")
	// startedAt is zero value
	stats := p.GetStats()
	if stats.UptimeSeconds != 0 {
		t.Errorf("UptimeSeconds = %d, want 0", stats.UptimeSeconds)
	}
}

func TestUptimeSeconds_NonZero(t *testing.T) {
	p := New(":99", "1280x720", "/tmp/hls")
	p.startedAt = time.Now().Add(-10 * time.Second)

	stats := p.GetStats()
	// Allow some tolerance for test execution time
	if stats.UptimeSeconds < 9 || stats.UptimeSeconds > 12 {
		t.Errorf("UptimeSeconds = %d, want ~10", stats.UptimeSeconds)
	}
}

// ---------------------------------------------------------------------------
// HLS-only mode
// ---------------------------------------------------------------------------

func TestBuildArgs_HLSOnly(t *testing.T) {
	p := defaultPipeline()
	args := p.buildArgs()

	checks := []struct {
		name  string
		check func() bool
	}{
		{"has -nostdin", func() bool { return containsArg(args, "-nostdin") }},
		{"has -loglevel warning", func() bool { return containsPair(args, "-loglevel", "warning") }},
		{"has x11grab input", func() bool { return containsPair(args, "-f", "x11grab") }},
		{"has pulse input", func() bool { return containsPair(args, "-f", "pulse") }},
		{"has video_size", func() bool { return containsPair(args, "-video_size", "1280x720") }},
		{"has framerate 30", func() bool { return containsPair(args, "-framerate", "30") }},
		{"has display :99", func() bool { return containsPair(args, "-i", ":99") }},
		{"has libx264", func() bool { return containsPair(args, "-c:v", "libx264") }},
		{"has ultrafast preset", func() bool { return containsPair(args, "-preset", "ultrafast") }},
		{"has zerolatency", func() bool { return containsPair(args, "-tune", "zerolatency") }},
		{"has crf 28", func() bool { return containsPair(args, "-crf", "28") }},
		{"has gop = framerate", func() bool { return containsPair(args, "-g", "30") }},
		{"has threads 2", func() bool { return containsPair(args, "-threads", "2") }},
		{"has aac audio", func() bool { return containsPair(args, "-c:a", "aac") }},
		{"has audio bitrate 96k", func() bool { return containsPair(args, "-b:a", "96k") }},
		{"has hls format", func() bool { return containsPair(args, "-f", "hls") }},
		{"has hls_time 1", func() bool { return containsPair(args, "-hls_time", "1") }},
		{"has hls_list_size 5", func() bool { return containsPair(args, "-hls_list_size", "5") }},
		{"has hls_flags", func() bool {
			return containsPair(args, "-hls_flags", "delete_segments+append_list")
		}},
		{"has segment pattern", func() bool {
			return containsPair(args, "-hls_segment_filename", "/tmp/hls/seg%03d.ts")
		}},
		{"ends with m3u8 output", func() bool { return args[len(args)-1] == "/tmp/hls/stream.m3u8" }},
		{"has progress pipe", func() bool { return containsPair(args, "-progress", "pipe:1") }},
		// HLS-only must NOT have RTMP-related args
		{"no flv format", func() bool { return !containsPair(args, "-f", "flv") }},
		{"no -map flags", func() bool { return !containsArg(args, "-map") }},
	}

	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			if !c.check() {
				t.Errorf("failed check")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Broadcasting mode (HLS + RTMP)
// ---------------------------------------------------------------------------

func TestBuildArgs_Broadcasting(t *testing.T) {
	p := defaultPipeline()
	p.broadcasting = true
	p.rtmpURL = "rtmp://live.example.com/app/key123"
	args := p.buildArgs()

	checks := []struct {
		name  string
		check func() bool
	}{
		{"has hls format", func() bool { return containsPair(args, "-f", "hls") }},
		{"has flv format", func() bool { return containsPair(args, "-f", "flv") }},
		{"has 4 -map flags", func() bool { return countArg(args, "-map") == 4 }},
		{"rtmp url not in args", func() bool {
			for _, a := range args {
				if a == "rtmp://live.example.com/app/key123" {
					return false // should NOT be in args (passed via env var)
				}
			}
			return true
		}},
		{"ends with -f flv", func() bool { return args[len(args)-1] == "flv" }},
		{"has rtmp preset veryfast", func() bool { return containsPair(args, "-preset", "veryfast") }},
		{"has bufsize", func() bool { return containsPair(args, "-bufsize", "5000k") }},
		{"has maxrate", func() bool { return containsPair(args, "-maxrate", "2500k") }},
		{"has rtmp gop 60", func() bool { return containsPair(args, "-g", "60") }},
		{"has 128k audio for rtmp", func() bool { return containsPair(args, "-b:a", "128k") }},
		{"has 96k audio for hls", func() bool { return containsPair(args, "-b:a", "96k") }},
		{"has yuv420p pix_fmt for rtmp", func() bool { return containsPair(args, "-pix_fmt", "yuv420p") }},
	}

	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			if !c.check() {
				t.Errorf("failed check")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Table-driven: option combinations
// ---------------------------------------------------------------------------

func TestBuildArgs_Options(t *testing.T) {
	tests := []struct {
		name         string
		opts         []Option
		broadcasting bool
		rtmpURL      string
		wantPairs    [][2]string
		rejectPairs  [][2]string
	}{
		{
			name: "custom framerate 60",
			opts: []Option{WithFramerate(60)},
			wantPairs: [][2]string{
				{"-framerate", "60"},
				{"-g", "60"}, // GOP = framerate
			},
		},
		{
			name:         "custom RTMP bitrate and preset",
			opts:         []Option{WithRTMPBitrate(6000), WithRTMPPreset("medium")},
			broadcasting: true,
			rtmpURL:      "rtmp://example.com/live/key",
			wantPairs: [][2]string{
				{"-b:v", "6000k"},
				{"-maxrate", "6000k"},
				{"-bufsize", "12000k"},
				{"-preset", "medium"},
			},
		},
		{
			name:         "broadcasting RTMP GOP = 2 * framerate",
			opts:         []Option{WithFramerate(24)},
			broadcasting: true,
			rtmpURL:      "rtmp://example.com/live/key",
			wantPairs: [][2]string{
				{"-g", "48"},
			},
		},
		{
			name: "HLS-only has no flv",
			opts: []Option{WithFramerate(15)},
			wantPairs: [][2]string{
				{"-framerate", "15"},
				{"-g", "15"},
			},
			rejectPairs: [][2]string{
				{"-f", "flv"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := New(":99", "1280x720", "/tmp/hls", tt.opts...)
			if tt.broadcasting {
				p.broadcasting = true
				p.rtmpURL = tt.rtmpURL
			}
			args := p.buildArgs()

			for _, pair := range tt.wantPairs {
				if !containsPair(args, pair[0], pair[1]) {
					t.Errorf("expected %v", pair)
				}
			}
			for _, pair := range tt.rejectPairs {
				if containsPair(args, pair[0], pair[1]) {
					t.Errorf("unexpected %v", pair)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Regression guards: wallclock timestamps + thread queue size
// ---------------------------------------------------------------------------

func TestBuildArgs_Regressions(t *testing.T) {
	t.Run("use_wallclock_as_timestamps is set to 1", func(t *testing.T) {
		args := defaultPipeline().buildArgs()
		if !containsPair(args, "-use_wallclock_as_timestamps", "1") {
			t.Fatal("REGRESSION: -use_wallclock_as_timestamps 1 missing. " +
				"Prevents x11grab clock drift from Chrome's bursty software rendering.")
		}
	})

	t.Run("thread_queue_size 512 on both inputs", func(t *testing.T) {
		args := defaultPipeline().buildArgs()
		n := countPair(args, "-thread_queue_size", "512")
		if n != 2 {
			t.Fatalf("REGRESSION: expected 2x -thread_queue_size 512 (video + audio), got %d. "+
				"Absorbs Chrome's bursty rendering.", n)
		}
	})

	t.Run("wallclock flag before first input", func(t *testing.T) {
		args := defaultPipeline().buildArgs()
		wallclockIdx, firstInputIdx := -1, -1
		for i, a := range args {
			if a == "-use_wallclock_as_timestamps" && wallclockIdx == -1 {
				wallclockIdx = i
			}
			if a == "-i" && firstInputIdx == -1 {
				firstInputIdx = i
			}
		}
		if wallclockIdx == -1 || firstInputIdx == -1 {
			t.Fatal("missing -use_wallclock_as_timestamps or -i")
		}
		if wallclockIdx >= firstInputIdx {
			t.Fatalf("REGRESSION: -use_wallclock_as_timestamps (idx %d) must precede first -i (idx %d)",
				wallclockIdx, firstInputIdx)
		}
	})

	t.Run("thread_queue_size before each input", func(t *testing.T) {
		args := defaultPipeline().buildArgs()
		inputIndices := []int{}
		queueIndices := []int{}
		for i, a := range args {
			if a == "-i" {
				inputIndices = append(inputIndices, i)
			}
			if a == "-thread_queue_size" {
				queueIndices = append(queueIndices, i)
			}
		}
		if len(inputIndices) < 2 || len(queueIndices) < 2 {
			t.Fatalf("expected 2 inputs and 2 queue flags, got %d/%d", len(inputIndices), len(queueIndices))
		}
		for i, qIdx := range queueIndices {
			if i < len(inputIndices) && qIdx >= inputIndices[i] {
				t.Errorf("REGRESSION: -thread_queue_size[%d] at idx %d not before -i[%d] at idx %d",
					i, qIdx, i, inputIndices[i])
			}
		}
	})

	t.Run("display and paths flow through", func(t *testing.T) {
		p := New(":42", "1920x1080", "/data/hls")
		args := p.buildArgs()
		if !containsPair(args, "-i", ":42") {
			t.Error("display :42 not found")
		}
		if !containsPair(args, "-video_size", "1920x1080") {
			t.Error("screen size 1920x1080 not found")
		}
		if !containsArg(args, "/data/hls/stream.m3u8") {
			t.Error("HLS output path not found")
		}
		if !containsPair(args, "-hls_segment_filename", "/data/hls/seg%03d.ts") {
			t.Error("segment pattern not found")
		}
	})
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNew_Defaults(t *testing.T) {
	p := New(":0", "640x480", "/out")
	if p.framerate != 30 {
		t.Errorf("framerate: got %d, want 30", p.framerate)
	}
	if p.hlsBitrate != 2500 {
		t.Errorf("hlsBitrate: got %d, want 2500", p.hlsBitrate)
	}
	if p.rtmpBitrate != 2500 {
		t.Errorf("rtmpBitrate: got %d, want 2500", p.rtmpBitrate)
	}
	if p.rtmpPreset != "veryfast" {
		t.Errorf("rtmpPreset: got %q, want veryfast", p.rtmpPreset)
	}
}

func TestNew_WithOptions(t *testing.T) {
	p := New(":0", "640x480", "/out",
		WithFramerate(60),
		WithHLSBitrate(8000),
		WithRTMPBitrate(10000),
		WithRTMPPreset("slow"),
	)
	if p.framerate != 60 {
		t.Errorf("framerate: got %d, want 60", p.framerate)
	}
	if p.hlsBitrate != 8000 {
		t.Errorf("hlsBitrate: got %d, want 8000", p.hlsBitrate)
	}
	if p.rtmpBitrate != 10000 {
		t.Errorf("rtmpBitrate: got %d, want 10000", p.rtmpBitrate)
	}
	if p.rtmpPreset != "slow" {
		t.Errorf("rtmpPreset: got %q, want slow", p.rtmpPreset)
	}
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

func BenchmarkBuildArgs_HLSOnly(b *testing.B) {
	p := defaultPipeline()
	for b.Loop() {
		_ = p.buildArgs()
	}
}

func BenchmarkBuildArgs_Broadcasting(b *testing.B) {
	p := defaultPipeline()
	p.broadcasting = true
	p.rtmpURL = "rtmp://live.example.com/app/streamkey"
	for b.Loop() {
		_ = p.buildArgs()
	}
}

func BenchmarkBuildArgs_Alloc(b *testing.B) {
	p := defaultPipeline()
	b.ReportAllocs()
	for b.Loop() {
		_ = p.buildArgs()
	}
}

func BenchmarkNew(b *testing.B) {
	opts := []Option{
		WithFramerate(60),
		WithHLSBitrate(4000),
		WithRTMPBitrate(6000),
		WithRTMPPreset("medium"),
	}
	for b.Loop() {
		_ = New(":99", "1280x720", "/tmp/hls", opts...)
	}
}

// Prevent compiler from optimizing away results.
var _sinkArgs []string

func BenchmarkBuildArgs_Sink(b *testing.B) {
	p := defaultPipeline()
	for b.Loop() {
		_sinkArgs = p.buildArgs()
	}
	_ = fmt.Sprintf("%d", len(_sinkArgs))
}
