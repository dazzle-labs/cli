/// Web Audio API integration.
/// Command-driven audio graph that processes JS AudioContext commands
/// and renders PCM audio in lockstep with video frames.
///
/// Architecture:
///   JS AudioContext polyfill → __dz_audio_cmds → process_commands() → stored per-frame
///   render_frame() → OfflineAudioContext (web-audio-api crate) → stereo interleaved PCM
///
/// Uses the `web-audio-api` crate's OfflineAudioContext with suspend_sync for
/// per-frame command injection. The entire timeline is re-rendered each frame,
/// giving full state continuity (oscillator phase, filter memory, etc.).

pub mod chrome_compressor;
pub mod offline;

/// JavaScript polyfill for AudioContext and audio nodes.
/// Pushes commands to __dz_audio_cmds for Rust-side processing.
pub const AUDIO_JS: &str = include_str!("audio.js");

/// Audio rendering graph that advances in lockstep with video frames.
/// Accumulates per-frame commands and renders via web-audio-api crate.
pub struct AudioGraph {
    sample_rate: u32,
    fps: u32,
    samples_per_frame: usize,
    /// Commands accumulated per frame. Index = frame number.
    per_frame_cmds: Vec<Vec<Vec<serde_json::Value>>>,
    /// Commands for the current (not yet rendered) frame.
    pending_cmds: Vec<Vec<serde_json::Value>>,
    /// True once any audio command has been received (skip rendering until first command).
    has_any_commands: bool,
    /// Cached silence buffer to avoid allocation when no audio is active.
    silence: Vec<f32>,
}

/// Sliding window of frames to re-render. Keeps audio state continuity for recent
/// commands while bounding per-frame render cost to O(W) instead of O(N).
/// At 30fps this is ~10 seconds — enough for oscillator phase and filter memory
/// continuity while preventing the O(N²) total cost of the old 9000-frame window.
const MAX_AUDIO_FRAMES: usize = 300;

/// Maximum commands per frame to prevent unbounded memory growth.
const MAX_COMMANDS_PER_FRAME: usize = 10_000;

impl AudioGraph {
    /// Create an audio graph. Each `render_frame()` produces `sample_rate / fps` stereo samples.
    /// Returns a default (silent) graph if `fps` is 0.
    pub fn new(sample_rate: u32, fps: u32) -> Self {
        let fps = if fps == 0 {
            log::warn!("AudioGraph: fps must be > 0, defaulting to 30");
            30
        } else {
            fps
        };
        let samples_per_frame = (sample_rate as f64 / fps as f64).round() as usize;
        AudioGraph {
            sample_rate,
            fps,
            samples_per_frame,
            per_frame_cmds: Vec::new(),
            pending_cmds: Vec::new(),
            has_any_commands: false,
            silence: vec![0.0f32; samples_per_frame * 2],
        }
    }

    /// Process audio commands from JS __dz_audio_cmds buffer.
    /// Commands are stored and applied at the correct time during rendering.
    /// Truncates to MAX_COMMANDS_PER_FRAME to prevent unbounded memory growth.
    pub fn process_commands(&mut self, cmds: &[Vec<serde_json::Value>]) {
        if !cmds.is_empty() {
            self.has_any_commands = true;
        }
        let remaining = MAX_COMMANDS_PER_FRAME.saturating_sub(self.pending_cmds.len());
        if remaining < cmds.len() {
            log::warn!("Audio: truncating commands from {} to {} (cap {})", cmds.len(), remaining, MAX_COMMANDS_PER_FRAME);
        }
        self.pending_cmds.extend(cmds.iter().take(remaining).cloned());
    }

    /// Like `process_commands` but takes ownership to avoid cloning.
    pub fn process_commands_owned(&mut self, cmds: Vec<Vec<serde_json::Value>>) {
        if !cmds.is_empty() {
            self.has_any_commands = true;
        }
        let remaining = MAX_COMMANDS_PER_FRAME.saturating_sub(self.pending_cmds.len());
        if remaining < cmds.len() {
            log::warn!("Audio: truncating commands from {} to {} (cap {})", cmds.len(), remaining, MAX_COMMANDS_PER_FRAME);
        }
        self.pending_cmds.extend(cmds.into_iter().take(remaining));
    }

    /// Render one frame's worth of audio, returning interleaved stereo f32 samples.
    /// At 44100Hz / 30fps = 1470 samples × 2 channels = 2940 f32 values.
    ///
    /// Re-renders the entire timeline from t=0 via OfflineAudioContext to maintain
    /// full state continuity across frames.
    pub fn render_frame(&mut self) -> Vec<f32> {
        // Commit pending commands for this frame
        let cmds = std::mem::take(&mut self.pending_cmds);
        let has_cmds = !cmds.is_empty();
        self.per_frame_cmds.push(cmds);

        // Fast path: no audio commands have ever been received → return cached silence.
        // This avoids creating an OfflineAudioContext when content has no audio at all.
        if !self.has_any_commands {
            return self.silence.clone();
        }

        // Cap accumulated frames to bound per-frame render cost to O(W) instead of O(N).
        // At W=300 and 30fps, each frame renders ~441K samples — sub-millisecond work.
        if self.per_frame_cmds.len() > MAX_AUDIO_FRAMES {
            let drop_count = self.per_frame_cmds.len() - MAX_AUDIO_FRAMES;
            self.per_frame_cmds.drain(..drop_count);
        }

        let frames = offline::render_offline_multi(
            &self.per_frame_cmds,
            self.sample_rate,
            self.fps,
        );

        // Return the last frame (current time position)
        if let Some(frame) = frames.into_iter().last() {
            frame
        } else {
            self.silence.clone()
        }
    }

    /// Get samples per frame (mono).
    pub fn samples_per_frame(&self) -> usize {
        self.samples_per_frame
    }
}
