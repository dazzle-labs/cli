/// Offline audio renderer using the `web-audio-api` crate.
/// Translates our command format into web-audio-api calls and renders
/// via OfflineAudioContext for Chrome-matching output.

use std::collections::HashMap;
use web_audio_api::context::{BaseAudioContext, OfflineAudioContext};
use web_audio_api::node::{
    AudioNode, AudioScheduledSourceNode, BiquadFilterType, OscillatorType, OverSampleType,
};
use web_audio_api::{PeriodicWave, PeriodicWaveOptions};

use super::chrome_compressor::ChromeCompressor;

/// Maximum number of audio nodes per render context (prevents OOM from malicious JS).
const MAX_AUDIO_NODES: usize = 4096;
/// Maximum buffer length for source_buffer/shaper_curve data arrays (10M samples ≈ 40MB).
const MAX_BUFFER_SAMPLES: usize = 10_000_000;
/// Maximum commands per frame to prevent unbounded memory growth.
const MAX_COMMANDS_PER_FRAME: usize = 10_000;
/// Maximum aggregate audio memory across all buffers and curves (512 MB).
const MAX_TOTAL_AUDIO_BYTES: usize = 512 * 1024 * 1024;

/// Render audio offline using the web-audio-api crate's OfflineAudioContext.
/// Commands use the same format as AudioGraph::process_commands().
/// Returns interleaved stereo f32 samples, split into frames of `samples_per_frame * 2`.
pub fn render_offline(
    cmds: &[Vec<serde_json::Value>],
    sample_rate: u32,
    num_frames: usize,
    fps: u32,
) -> Vec<Vec<f32>> {
    if fps == 0 {
        log::warn!("render_offline: fps must be > 0, returning empty");
        return vec![];
    }
    let samples_per_frame = (sample_rate as f64 / fps as f64).round() as usize;
    let total_samples = match samples_per_frame.checked_mul(num_frames) {
        Some(n) => n,
        None => {
            log::warn!("render_offline: samples_per_frame * num_frames overflow, returning empty");
            return vec![];
        }
    };
    let mut ctx = OfflineAudioContext::new(2, total_samples, sample_rate as f32);

    // Track nodes for connections and param access
    let mut nodes: HashMap<u64, NodeHandle> = HashMap::new();
    let mut chrome_comp: Option<ChromeCompressor> = None;
    let mut compressor_ids = std::collections::HashSet::new();

    let mut total_audio_bytes: usize = 0;

    // Process commands (all at t=0 for single-frame rendering; cap to MAX_COMMANDS_PER_FRAME)
    for cmd in cmds.iter().take(MAX_COMMANDS_PER_FRAME) {
        if cmd.is_empty() {
            continue;
        }
        let op = cmd[0].as_str().unwrap_or("");
        process_command(&ctx, &mut nodes, op, cmd, &mut chrome_comp, &mut compressor_ids, 0.0, &mut total_audio_bytes);
    }

    // Render
    let buffer = ctx.start_rendering_sync();

    // Split into frames of interleaved stereo
    let left = buffer.get_channel_data(0);
    let right = buffer.get_channel_data(1);

    // Build full interleaved buffer for Chrome compressor processing
    let mut all_interleaved = Vec::with_capacity(total_samples * 2);
    for i in 0..total_samples {
        all_interleaved.push(left[i]);
        all_interleaved.push(right[i]);
    }

    // Apply Chrome compressor if any compressor was in the graph
    if let Some(comp) = chrome_comp.as_mut() {
        comp.process(&mut all_interleaved);
    }

    // Ensure even length for stereo pairs
    if all_interleaved.len() % 2 != 0 { all_interleaved.pop(); }

    // Split into per-frame chunks (bounds-checked to prevent panic)
    let frame_stride = samples_per_frame * 2;
    let mut frames = Vec::with_capacity(num_frames);
    for f in 0..num_frames {
        let start = f * frame_stride;
        let end = (start + frame_stride).min(all_interleaved.len());
        if start >= all_interleaved.len() { break; }
        frames.push(all_interleaved[start..end].to_vec());
    }

    frames
}

/// Render audio offline with per-frame command batches using suspend_sync.
/// Each entry in `per_frame_cmds` is applied at the start of that frame's time window.
/// Returns interleaved stereo f32 samples per frame.
///
/// This re-renders the entire timeline from t=0 each call — O(N) per frame,
/// suitable for sessions up to ~60 seconds.
pub fn render_offline_multi(
    per_frame_cmds: &[Vec<Vec<serde_json::Value>>],
    sample_rate: u32,
    fps: u32,
) -> Vec<Vec<f32>> {
    use std::sync::{Arc, Mutex};

    if fps == 0 {
        log::warn!("render_offline_multi: fps must be > 0, returning empty");
        return vec![];
    }
    let samples_per_frame = (sample_rate as f64 / fps as f64).round() as usize;
    let num_frames = per_frame_cmds.len();
    if num_frames == 0 {
        return vec![];
    }
    let total_samples = match samples_per_frame.checked_mul(num_frames) {
        Some(n) => n,
        None => {
            log::warn!("render_offline_multi: samples_per_frame * num_frames overflow, returning empty");
            return vec![];
        }
    };

    let mut ctx = OfflineAudioContext::new(2, total_samples, sample_rate as f32);
    let nodes: Arc<Mutex<HashMap<u64, NodeHandle>>> = Arc::new(Mutex::new(HashMap::new()));
    let chrome_comp: Arc<Mutex<Option<ChromeCompressor>>> = Arc::new(Mutex::new(None));
    let comp_ids: Arc<Mutex<std::collections::HashSet<u64>>> =
        Arc::new(Mutex::new(std::collections::HashSet::new()));
    let total_audio_bytes: Arc<Mutex<usize>> = Arc::new(Mutex::new(0));

    // Register suspend at each frame boundary to inject that frame's commands
    for (frame, cmds) in per_frame_cmds.iter().enumerate() {
        if cmds.is_empty() {
            continue;
        }
        let frame_time = frame as f64 * samples_per_frame as f64 / sample_rate as f64;
        let cmds = cmds.clone();
        let nodes_ref = nodes.clone();
        let comp_ref = chrome_comp.clone();
        let comp_ids_ref = comp_ids.clone();
        let total_bytes_ref = total_audio_bytes.clone();

        ctx.suspend_sync(frame_time, move |ctx| {
            let mut nodes = nodes_ref.lock().unwrap_or_else(|e| e.into_inner());
            let mut comp = comp_ref.lock().unwrap_or_else(|e| e.into_inner());
            let mut cids = comp_ids_ref.lock().unwrap_or_else(|e| e.into_inner());
            let mut tbytes = total_bytes_ref.lock().unwrap_or_else(|e| e.into_inner());
            for cmd in cmds.iter().take(MAX_COMMANDS_PER_FRAME) {
                if cmd.is_empty() {
                    continue;
                }
                let op = cmd[0].as_str().unwrap_or("");
                process_command(ctx, &mut nodes, op, cmd, &mut comp, &mut cids, frame_time, &mut tbytes);
            }
        });
    }

    let buffer = ctx.start_rendering_sync();
    let left = buffer.get_channel_data(0);
    let right = buffer.get_channel_data(1);

    // Build full interleaved buffer
    let mut all_interleaved = Vec::with_capacity(total_samples * 2);
    for i in 0..total_samples {
        all_interleaved.push(left[i]);
        all_interleaved.push(right[i]);
    }

    // Apply Chrome compressor if any compressor was in the graph
    if let Some(comp) = chrome_comp.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        comp.process(&mut all_interleaved);
    }

    // Ensure even length for stereo pairs
    if all_interleaved.len() % 2 != 0 { all_interleaved.pop(); }

    // Split into per-frame chunks (bounds-checked to prevent panic)
    let frame_stride = samples_per_frame * 2;
    let mut frames = Vec::with_capacity(num_frames);
    for f in 0..num_frames {
        let start = f * frame_stride;
        let end = (start + frame_stride).min(all_interleaved.len());
        if start >= all_interleaved.len() { break; }
        frames.push(all_interleaved[start..end].to_vec());
    }

    frames
}

/// Node handle enum — wraps web-audio-api node types for dynamic dispatch.
enum NodeHandle {
    Oscillator(web_audio_api::node::OscillatorNode),
    Gain(web_audio_api::node::GainNode),
    BiquadFilter(web_audio_api::node::BiquadFilterNode),
    Delay(web_audio_api::node::DelayNode),
    StereoPanner(web_audio_api::node::StereoPannerNode),
    WaveShaper(web_audio_api::node::WaveShaperNode),
    ConstantSource(web_audio_api::node::ConstantSourceNode),
    BufferSource(web_audio_api::node::AudioBufferSourceNode),
}

impl NodeHandle {
    fn as_node(&self) -> &dyn AudioNode {
        match self {
            NodeHandle::Oscillator(n) => n,
            NodeHandle::Gain(n) => n,
            NodeHandle::BiquadFilter(n) => n,
            NodeHandle::Delay(n) => n,
            NodeHandle::StereoPanner(n) => n,
            NodeHandle::WaveShaper(n) => n,
            NodeHandle::ConstantSource(n) => n,
            NodeHandle::BufferSource(n) => n,
        }
    }
}

/// Create a PeriodicWave matching Chrome's Fourier-based wavetable synthesis.
/// Chrome renders square/sawtooth/triangle from PeriodicWave with standard Fourier
/// coefficients, while the web-audio-api crate uses direct polyBLEP computation.
/// Using PeriodicWave gives much closer Chrome alignment.
/// Create a PeriodicWave matching Chrome's Fourier-based wavetable synthesis.
/// Chrome renders square/sawtooth/triangle from PeriodicWave with standard Fourier
/// coefficients, while the web-audio-api crate uses direct polyBLEP computation.
/// Using PeriodicWave gives much closer Chrome alignment at lower frequencies.
/// At high frequencies (few harmonics), polyBLEP is closer, so we return None
/// to fall back to the crate's built-in type.
fn chrome_periodic_wave(
    ctx: &OfflineAudioContext,
    waveform: &str,
    freq: f32,
) -> Option<PeriodicWave> {
    // Guard: freq <= 0 or non-finite would cause division by zero or huge allocation
    if !freq.is_finite() || freq <= 0.0 { return None; }
    // Chrome uses harmonics up to Nyquist: floor(sampleRate / (2 * freq))
    let max_harmonics = (ctx.sample_rate() / (2.0 * freq)).floor() as usize;

    // Below 4 harmonics, the crate's polyBLEP is closer to Chrome than
    // our Fourier wavetable (wavetable interpolation artifacts dominate)
    if max_harmonics < 4 {
        return None;
    }

    // Cap harmonics to prevent OOM: 8192 harmonics × 2 arrays × 4 bytes = 64KB max
    // This is sufficient for accurate waveform reproduction (Chrome typically uses ~1000)
    const MAX_PERIODIC_WAVE_HARMONICS: usize = 8192;
    let n = max_harmonics.min(MAX_PERIODIC_WAVE_HARMONICS);
    let mut real = vec![0.0f32; n + 1];
    let mut imag = vec![0.0f32; n + 1];

    match waveform {
        "square" => {
            // Square wave: imag[k] = 4/(kπ) for odd k
            for k in (1..=n).step_by(2) {
                imag[k] = 4.0 / (k as f32 * std::f32::consts::PI);
            }
        }
        "sawtooth" => {
            // Sawtooth wave: imag[k] = (-1)^(k+1) * 2/(kπ)
            for k in 1..=n {
                let sign = if k % 2 == 1 { 1.0 } else { -1.0 };
                imag[k] = sign * 2.0 / (k as f32 * std::f32::consts::PI);
            }
        }
        _ => return None,
    }

    Some(PeriodicWave::new(
        ctx,
        PeriodicWaveOptions {
            real: Some(real),
            imag: Some(imag),
            disable_normalization: false,
        },
    ))
}

fn cmd_u64(cmd: &[serde_json::Value], idx: usize) -> u64 {
    cmd.get(idx)
        .and_then(|v| {
            v.as_u64().or_else(|| {
                v.as_f64().and_then(|f| {
                    if f.is_finite() && f >= 0.0 && f <= u64::MAX as f64 {
                        Some(f as u64)
                    } else {
                        None
                    }
                })
            })
        })
        .unwrap_or(0)
}

fn cmd_f64(cmd: &[serde_json::Value], idx: usize, default: f64) -> f64 {
    cmd.get(idx).and_then(|v| v.as_f64()).unwrap_or(default)
}

fn process_command(
    ctx: &OfflineAudioContext,
    nodes: &mut HashMap<u64, NodeHandle>,
    op: &str,
    cmd: &[serde_json::Value],
    chrome_comp: &mut Option<ChromeCompressor>,
    compressor_ids: &mut std::collections::HashSet<u64>,
    frame_time: f64,
    total_audio_bytes: &mut usize,
) {
    // Guard against unbounded node creation (OOM DoS from malicious JS).
    let is_create = matches!(op, "osc_create" | "gain_create" | "biquad_create" | "delay_create"
        | "panner_create" | "compressor_create" | "shaper_create" | "source_create"
        | "constant_create" | "analyser_create");
    if is_create && nodes.len() >= MAX_AUDIO_NODES {
        log::warn!("Audio: node limit reached ({}), rejecting {}", MAX_AUDIO_NODES, op);
        return;
    }

    match op {
        // ── Oscillator ──
        "osc_create" => {
            let id = cmd_u64(cmd, 1);
            let osc = ctx.create_oscillator();
            nodes.insert(id, NodeHandle::Oscillator(osc));
        }
        "osc_start" => {
            let id = cmd_u64(cmd, 1);
            let waveform = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("sine");
            let freq = cmd_f64(cmd, 3, 440.0) as f32;

            // Node should already exist from osc_create; create if missing for robustness
            if !nodes.contains_key(&id) {
                let osc = ctx.create_oscillator();
                nodes.insert(id, NodeHandle::Oscillator(osc));
            }

            if let Some(NodeHandle::Oscillator(osc)) = nodes.get_mut(&id) {
                osc.frequency().set_value(freq);
                // For square/sawtooth, use PeriodicWave with Fourier coefficients
                // to match Chrome's wavetable synthesis (crate uses polyBLEP which diverges)
                if let Some(pw) = chrome_periodic_wave(ctx, waveform, freq) {
                    osc.set_periodic_wave(pw);
                } else {
                    osc.set_type(match waveform {
                        "square" => OscillatorType::Square,
                        "sawtooth" => OscillatorType::Sawtooth,
                        "triangle" => OscillatorType::Triangle,
                        _ => OscillatorType::Sine,
                    });
                }
                osc.start();
            }
        }
        "osc_stop" => {
            if let Some(NodeHandle::Oscillator(osc)) = nodes.get_mut(&cmd_u64(cmd, 1)) {
                // Use stop_at(frame_time) for sample-accurate stop at the frame boundary.
                // plain stop() fires at the rendering quantum boundary (128 samples)
                // which may not align with frame boundaries, leaking partial audio.
                osc.stop_at(frame_time);
            }
        }
        "osc_freq" => {
            let id = cmd_u64(cmd, 1);
            let freq = cmd_f64(cmd, 2, 440.0) as f32;
            if let Some(NodeHandle::Oscillator(osc)) = nodes.get(&id) {
                osc.frequency().set_value(freq);
            }
        }
        "osc_type" => {
            let id = cmd_u64(cmd, 1);
            let wf = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("sine");
            if let Some(NodeHandle::Oscillator(osc)) = nodes.get_mut(&id) {
                let freq = osc.frequency().value();
                if let Some(pw) = chrome_periodic_wave(ctx, wf, freq) {
                    osc.set_periodic_wave(pw);
                } else {
                    osc.set_type(match wf {
                        "square" => OscillatorType::Square,
                        "sawtooth" => OscillatorType::Sawtooth,
                        "triangle" => OscillatorType::Triangle,
                        _ => OscillatorType::Sine,
                    });
                }
            }
        }

        // ── Gain ──
        "gain_create" => {
            let id = cmd_u64(cmd, 1);
            let gain_val = cmd_f64(cmd, 2, 1.0) as f32;
            let gain = ctx.create_gain();
            gain.gain().set_value(gain_val);
            nodes.insert(id, NodeHandle::Gain(gain));
        }
        "gain_set" => {
            let id = cmd_u64(cmd, 1);
            let val = cmd_f64(cmd, 2, 1.0) as f32;
            if let Some(NodeHandle::Gain(g)) = nodes.get(&id) {
                g.gain().set_value(val);
            }
        }

        // ── BiquadFilter ──
        "biquad_create" => {
            let id = cmd_u64(cmd, 1);
            let ft = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("lowpass");
            let mut filter = ctx.create_biquad_filter();
            filter.set_type(match ft {
                "highpass" => BiquadFilterType::Highpass,
                "bandpass" => BiquadFilterType::Bandpass,
                "notch" => BiquadFilterType::Notch,
                "allpass" => BiquadFilterType::Allpass,
                "peaking" => BiquadFilterType::Peaking,
                "lowshelf" => BiquadFilterType::Lowshelf,
                "highshelf" => BiquadFilterType::Highshelf,
                _ => BiquadFilterType::Lowpass,
            });
            nodes.insert(id, NodeHandle::BiquadFilter(filter));
        }
        "biquad_type" => {
            let id = cmd_u64(cmd, 1);
            let ft = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("lowpass");
            if let Some(NodeHandle::BiquadFilter(f)) = nodes.get_mut(&id) {
                f.set_type(match ft {
                    "highpass" => BiquadFilterType::Highpass,
                    "bandpass" => BiquadFilterType::Bandpass,
                    "notch" => BiquadFilterType::Notch,
                    "allpass" => BiquadFilterType::Allpass,
                    "peaking" => BiquadFilterType::Peaking,
                    "lowshelf" => BiquadFilterType::Lowshelf,
                    "highshelf" => BiquadFilterType::Highshelf,
                    _ => BiquadFilterType::Lowpass,
                });
            }
        }

        // ── Delay ──
        "delay_create" => {
            let id = cmd_u64(cmd, 1);
            let max_time = cmd_f64(cmd, 2, 1.0);
            let delay = ctx.create_delay(max_time);
            nodes.insert(id, NodeHandle::Delay(delay));
        }

        // ── DynamicsCompressor ── use Chrome's algorithm via post-processing
        "compressor_create" => {
            let id = cmd_u64(cmd, 1);
            // Use passthrough gain node in the crate's graph
            let gain = ctx.create_gain();
            gain.gain().set_value(1.0);
            nodes.insert(id, NodeHandle::Gain(gain));
            compressor_ids.insert(id);
            // Initialize Chrome compressor for post-processing
            if chrome_comp.is_none() {
                *chrome_comp = Some(ChromeCompressor::new(ctx.sample_rate()));
            }
        }

        // ── StereoPanner ──
        "panner_create" => {
            let id = cmd_u64(cmd, 1);
            let panner = ctx.create_stereo_panner();
            nodes.insert(id, NodeHandle::StereoPanner(panner));
        }

        // ── WaveShaper ──
        "shaper_create" => {
            let id = cmd_u64(cmd, 1);
            let shaper = ctx.create_wave_shaper();
            nodes.insert(id, NodeHandle::WaveShaper(shaper));
        }
        "shaper_curve" => {
            let id = cmd_u64(cmd, 1);
            if let Some(NodeHandle::WaveShaper(ws)) = nodes.get_mut(&id) {
                if let Some(arr) = cmd.get(2).and_then(|v| v.as_array()) {
                    // Cap curve length to prevent OOM from malicious payloads
                    const MAX_CURVE_LEN: usize = 65536;
                    let len = arr.len().min(MAX_CURVE_LEN);
                    let alloc_bytes = len * std::mem::size_of::<f32>();
                    if *total_audio_bytes + alloc_bytes > MAX_TOTAL_AUDIO_BYTES {
                        log::warn!("Audio: aggregate memory cap reached, rejecting shaper_curve");
                        return;
                    }
                    *total_audio_bytes += alloc_bytes;
                    let curve: Vec<f32> = arr[..len]
                        .iter()
                        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                        .collect();
                    ws.set_curve(curve);
                }
            }
        }
        "shaper_oversample" => {
            let id = cmd_u64(cmd, 1);
            if let Some(NodeHandle::WaveShaper(ws)) = nodes.get_mut(&id) {
                let os = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("none");
                ws.set_oversample(match os {
                    "2x" => OverSampleType::X2,
                    "4x" => OverSampleType::X4,
                    _ => OverSampleType::None,
                });
            }
        }

        // ── AudioBufferSource ──
        "source_create" => {
            let id = cmd_u64(cmd, 1);
            let src = ctx.create_buffer_source();
            nodes.insert(id, NodeHandle::BufferSource(src));
        }
        "source_start" => {
            if let Some(NodeHandle::BufferSource(src)) = nodes.get_mut(&cmd_u64(cmd, 1)) {
                src.start();
            }
        }
        "source_stop" => {
            if let Some(NodeHandle::BufferSource(src)) = nodes.get_mut(&cmd_u64(cmd, 1)) {
                src.stop();
            }
        }
        "source_buffer" => {
            let id = cmd_u64(cmd, 1);
            if let Some(NodeHandle::BufferSource(src)) = nodes.get_mut(&id) {
                if let Some(arr) = cmd.get(2).and_then(|v| v.as_array()) {
                    // JS sends channels as array-of-arrays: [[ch0_samples...], [ch1_samples...]]
                    // Detect this format vs flat array of samples.
                    let is_nested = arr.first().map_or(false, |v| v.is_array());
                    if is_nested {
                        let num_channels = arr.len().min(2); // stereo max
                        let channel_len = arr[0].as_array().map_or(0, |a| a.len()).min(MAX_BUFFER_SAMPLES);
                        let alloc_bytes = num_channels * channel_len * std::mem::size_of::<f32>();
                        if *total_audio_bytes + alloc_bytes > MAX_TOTAL_AUDIO_BYTES {
                            log::warn!("Audio: aggregate memory cap reached, rejecting source_buffer");
                            return;
                        }
                        if channel_len > 0 {
                            *total_audio_bytes += alloc_bytes;
                            let mut buffer = ctx.create_buffer(
                                num_channels, channel_len, ctx.sample_rate(),
                            );
                            for ch in 0..num_channels {
                                if let Some(ch_data) = arr[ch].as_array() {
                                    let samples: Vec<f32> = ch_data[..ch_data.len().min(channel_len)]
                                        .iter()
                                        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                                        .collect();
                                    buffer.copy_to_channel(&samples, ch);
                                }
                            }
                            src.set_buffer(buffer);
                        }
                    } else {
                        // Flat array of mono samples (legacy path)
                        let capped_len = arr.len().min(MAX_BUFFER_SAMPLES);
                        let alloc_bytes = capped_len * std::mem::size_of::<f32>();
                        if *total_audio_bytes + alloc_bytes > MAX_TOTAL_AUDIO_BYTES {
                            log::warn!("Audio: aggregate memory cap reached, rejecting source_buffer");
                            return;
                        }
                        let data: Vec<f32> = arr[..capped_len]
                            .iter()
                            .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                            .collect();
                        if !data.is_empty() {
                            *total_audio_bytes += alloc_bytes;
                            let mut buffer = ctx.create_buffer(1, data.len(), ctx.sample_rate());
                            buffer.copy_to_channel(&data, 0);
                            src.set_buffer(buffer);
                        }
                    }
                }
            }
        }
        "source_loop" => {
            let id = cmd_u64(cmd, 1);
            let looping = cmd.get(2).and_then(|v| v.as_bool()).unwrap_or(false);
            if let Some(NodeHandle::BufferSource(src)) = nodes.get_mut(&id) {
                src.set_loop(looping);
            }
        }

        // ── ConstantSource ──
        "constant_create" => {
            let id = cmd_u64(cmd, 1);
            let src = ctx.create_constant_source();
            nodes.insert(id, NodeHandle::ConstantSource(src));
        }
        "constant_start" => {
            if let Some(NodeHandle::ConstantSource(src)) = nodes.get_mut(&cmd_u64(cmd, 1)) {
                src.start();
            }
        }
        "constant_stop" => {
            if let Some(NodeHandle::ConstantSource(src)) = nodes.get_mut(&cmd_u64(cmd, 1)) {
                src.stop();
            }
        }

        // ── AnalyserNode — pass-through, use gain(1.0) ──
        "analyser_create" => {
            let id = cmd_u64(cmd, 1);
            let gain = ctx.create_gain();
            gain.gain().set_value(1.0);
            nodes.insert(id, NodeHandle::Gain(gain));
        }

        // ── Graph connections ──
        "connect" => {
            let from = cmd_u64(cmd, 1);
            let to_str = cmd.get(2).and_then(|v| v.as_str());
            if let Some(src) = nodes.get(&from) {
                if to_str == Some("destination") {
                    src.as_node().connect(&ctx.destination());
                } else {
                    let to = cmd_u64(cmd, 2);
                    if let Some(dest) = nodes.get(&to) {
                        src.as_node().connect(dest.as_node());
                    }
                }
            }
        }
        "disconnect" => {
            let id = cmd_u64(cmd, 1);
            if let Some(node) = nodes.get(&id) {
                node.as_node().disconnect();
            }
        }

        // ── AudioParam automation ──
        "param_set" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            let val = cmd_f64(cmd, 3, 0.0) as f32;
            // Route compressor params to Chrome compressor
            if compressor_ids.contains(&id) {
                if let Some(comp) = chrome_comp.as_mut() {
                    match name {
                        "threshold" => comp.set_threshold(val),
                        "knee" => comp.set_knee(val),
                        "ratio" => comp.set_ratio(val),
                        "attack" => comp.set_attack(val),
                        "release" => comp.set_release(val),
                        _ => {}
                    }
                }
            } else {
                set_param(nodes, id, name, |p| { p.set_value(val); });
            }
        }
        "param_setValueAtTime" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            let val = cmd_f64(cmd, 3, 0.0) as f32;
            let time = cmd_f64(cmd, 4, 0.0);
            set_param(nodes, id, name, |p| {
                p.set_value_at_time(val, time);
            });
        }
        "param_linearRamp" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            let val = cmd_f64(cmd, 3, 0.0) as f32;
            let time = cmd_f64(cmd, 4, 0.0);
            set_param(nodes, id, name, |p| {
                p.linear_ramp_to_value_at_time(val, time);
            });
        }
        "param_exponentialRamp" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            let val = cmd_f64(cmd, 3, 0.0) as f32;
            let time = cmd_f64(cmd, 4, 0.0);
            set_param(nodes, id, name, |p| {
                p.exponential_ramp_to_value_at_time(val, time);
            });
        }
        "param_setTarget" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            let target = cmd_f64(cmd, 3, 0.0) as f32;
            let start = cmd_f64(cmd, 4, 0.0);
            let tc = cmd_f64(cmd, 5, 0.0);
            set_param(nodes, id, name, |p| {
                p.set_target_at_time(target, start, tc);
            });
        }
        "param_setValueCurve" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            const MAX_VALUE_CURVE_LEN: usize = 65536;
            let curve_arr = cmd.get(3).and_then(|v| v.as_array());
            if let Some(a) = &curve_arr {
                let len = a.len().min(MAX_VALUE_CURVE_LEN);
                let alloc_bytes = len * std::mem::size_of::<f32>();
                if *total_audio_bytes + alloc_bytes > MAX_TOTAL_AUDIO_BYTES {
                    log::warn!("Audio: aggregate memory cap reached, rejecting param_setValueCurve");
                    return;
                }
                *total_audio_bytes += alloc_bytes;
            }
            let values: Vec<f32> = curve_arr
                .map(|a| {
                    let len = a.len().min(MAX_VALUE_CURVE_LEN);
                    a[..len].iter()
                        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                        .collect()
                })
                .unwrap_or_default();
            let start = cmd_f64(cmd, 4, 0.0);
            let duration = cmd_f64(cmd, 5, 0.0);
            set_param(nodes, id, name, |p| {
                p.set_value_curve_at_time(&values, start, duration);
            });
        }
        "param_cancel" => {
            let id = cmd_u64(cmd, 1);
            let name = cmd.get(2).and_then(|v| v.as_str()).unwrap_or("");
            let start = cmd_f64(cmd, 3, 0.0);
            set_param(nodes, id, name, |p| {
                p.cancel_scheduled_values(start);
            });
        }

        _ => {}
    }
}

/// Access an AudioParam by node ID and param name, apply a closure to it.
fn set_param(
    nodes: &HashMap<u64, NodeHandle>,
    id: u64,
    name: &str,
    f: impl FnOnce(&web_audio_api::AudioParam),
) {
    if let Some(node) = nodes.get(&id) {
        match node {
            NodeHandle::Oscillator(n) => match name {
                "frequency" => f(&n.frequency()),
                "detune" => f(&n.detune()),
                _ => {}
            },
            NodeHandle::Gain(n) => match name {
                "gain" => f(&n.gain()),
                _ => {}
            },
            NodeHandle::BiquadFilter(n) => match name {
                "frequency" => f(&n.frequency()),
                "Q" => f(&n.q()),
                "gain" => f(&n.gain()),
                "detune" => f(&n.detune()),
                _ => {}
            },
            NodeHandle::Delay(n) => match name {
                "delayTime" => f(&n.delay_time()),
                _ => {}
            },
            NodeHandle::StereoPanner(n) => match name {
                "pan" => f(&n.pan()),
                _ => {}
            },
            NodeHandle::ConstantSource(n) => match name {
                "offset" => f(&n.offset()),
                _ => {}
            },
            NodeHandle::BufferSource(n) => match name {
                "playbackRate" => f(&n.playback_rate()),
                "detune" => f(&n.detune()),
                _ => {}
            },
            NodeHandle::WaveShaper(_) => {} // no AudioParams
        }
    }
}
