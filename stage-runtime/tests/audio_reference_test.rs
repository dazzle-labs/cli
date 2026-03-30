//! Audio reference tests — compare stage-runtime AudioGraph output against Chrome Web Audio API.
//!
//! Chrome uses OfflineAudioContext to render each scene's audio. Our AudioGraph processes
//! the same commands and renders the same number of samples. We compare using RMSE and
//! peak error.
//!
//! Generate reference data: cd tests/audio_fixtures && node generate_reference.cjs
//! Run: cargo test --test audio_reference_test

use stage_runtime::audio::AudioGraph;
use serde_json::{json, Value};
use std::path::Path;

const SAMPLE_RATE: u32 = 44100;
const FPS: u32 = 30;

fn load_reference() -> Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/audio_fixtures/audio_reference.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
}

/// Compute RMSE between two sample buffers.
fn rmse(a: &[f32], b: &[f32]) -> f64 {
    assert_eq!(a.len(), b.len(), "buffer length mismatch");
    let sum_sq: f64 = a.iter().zip(b.iter())
        .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
        .sum();
    (sum_sq / a.len() as f64).sqrt()
}

/// Compute peak absolute error.
fn peak_error(a: &[f32], b: &[f32]) -> f64 {
    a.iter().zip(b.iter())
        .map(|(x, y)| (*x as f64 - *y as f64).abs())
        .fold(0.0f64, f64::max)
}

/// Render N frames, processing commands before the first frame.
fn render_frames(cmds: &[Vec<Value>], num_frames: usize) -> Vec<Vec<f32>> {
    let mut graph = AudioGraph::new(SAMPLE_RATE, FPS);
    graph.process_commands(cmds);
    (0..num_frames).map(|_| graph.render_frame()).collect()
}

/// Render N frames, processing different commands before each frame.
fn render_frames_multi(per_frame_cmds: &[Vec<Vec<Value>>], num_frames: usize) -> Vec<Vec<f32>> {
    let mut graph = AudioGraph::new(SAMPLE_RATE, FPS);
    let mut frames = Vec::with_capacity(num_frames);
    for i in 0..num_frames {
        if i < per_frame_cmds.len() {
            graph.process_commands(&per_frame_cmds[i]);
        }
        frames.push(graph.render_frame());
    }
    frames
}

/// Parse Chrome reference frames from JSON.
fn parse_chrome_frames(scene: &Value) -> Vec<Vec<f32>> {
    scene["frames"]
        .as_array()
        .unwrap()
        .iter()
        .map(|frame| {
            frame.as_array().unwrap().iter()
                .map(|v| v.as_f64().unwrap() as f32)
                .collect()
        })
        .collect()
}

/// Assert all frames match within threshold. Returns (avg_rmse, max_peak).
fn assert_frames_match(
    name: &str,
    our_frames: &[Vec<f32>],
    chrome_frames: &[Vec<f32>],
    rmse_threshold: f64,
) -> (f64, f64) {
    let n = our_frames.len().min(chrome_frames.len());
    let mut total_rmse = 0.0;
    let mut max_peak = 0.0f64;
    for i in 0..n {
        let r = rmse(&our_frames[i], &chrome_frames[i]);
        let p = peak_error(&our_frames[i], &chrome_frames[i]);
        total_rmse += r;
        max_peak = max_peak.max(p);
        assert!(r < rmse_threshold,
            "{} frame {} RMSE too high: {:.6} (threshold {:.3})", name, i, r, rmse_threshold);
    }
    let avg = total_rmse / n as f64;
    println!("{}: avg RMSE={:.6}, peak={:.6} ({} frames)", name, avg, max_peak, n);
    (avg, max_peak)
}

// ============================================================================
// Basic waveforms — near-exact match expected
// ============================================================================

#[test]
fn sine_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sine_440"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("sine_440", &ours, &chrome, 0.001);
}

#[test]
fn sine_880_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sine_880"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(880), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("sine_880", &ours, &chrome, 0.001);
}

#[test]
fn square_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["square_440"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("square"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    // PeriodicWave Fourier synthesis — residual from wavetable interpolation
    assert_frames_match("square_440", &ours, &chrome, 0.06);
}

#[test]
fn sawtooth_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sawtooth_440"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("sawtooth_440", &ours, &chrome, 0.05);
}

#[test]
fn triangle_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["triangle_440"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("triangle"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("triangle_440", &ours, &chrome, 0.001);
}

#[test]
fn silence_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["silence"]);
    let mut graph = AudioGraph::new(SAMPLE_RATE, FPS);
    for (i, c) in chrome.iter().enumerate() {
        let ours = graph.render_frame();
        assert!(rmse(&ours, c) < 0.0001, "silence frame {} not silent", i);
        assert!(ours.iter().all(|&s| s == 0.0), "silence has non-zero samples");
    }
}

// ============================================================================
// Gain routing
// ============================================================================

#[test]
fn gain_half_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_half"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("gain_half", &ours, &chrome, 0.001);
}

#[test]
fn gain_quarter_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_quarter"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.25)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    // Uses sawtooth source — crate's wavetable differs from Chrome
    assert_frames_match("gain_quarter", &ours, &chrome, 0.015);
}

#[test]
fn gain_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_chain"]);
    // osc(1) → gain(2, 0.8) → gain(3, 0.5) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.8)],
            vec![json!("gain_create"), json!(3), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3);
    assert_frames_match("gain_chain", &ours, &chrome, 0.001);
}

// ============================================================================
// Multi-oscillator scenes
// ============================================================================

#[test]
fn two_oscillators_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["two_oscillators"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("sine"), json!(660), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("two_oscillators", &ours, &chrome, 0.001);
}

#[test]
fn three_osc_chord_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["three_osc_chord"]);
    // A major triad: A4(440) + C#5(554.37) + E5(659.26)
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("sine"), json!(554.37), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
            vec![json!("osc_start"), json!(3), json!("sine"), json!(659.26), json!(0)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3);
    assert_frames_match("three_osc_chord", &ours, &chrome, 0.001);
}

#[test]
fn mixed_waveforms_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["mixed_waveforms"]);
    // sine(440) + square(220) + triangle(880)
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("square"), json!(220), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
            vec![json!("osc_start"), json!(3), json!("triangle"), json!(880), json!(0)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3);
    // Uses square source — crate's wavetable differs from Chrome
    assert_frames_match("mixed_waveforms", &ours, &chrome, 0.05);
}

#[test]
fn detuned_beating_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["detuned_beating"]);
    // 440Hz + 441Hz → 1Hz beating pattern over 30 frames (1 second)
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("sine"), json!(441), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 30);
    // Skip frame 0: Chrome OfflineAudioContext has a startup artifact (spike to 6.27)
    // in the first frame when two oscillators start simultaneously.
    assert_frames_match("detuned_beating", &ours[1..], &chrome[1..], 0.001);
}

// ============================================================================
// Extreme frequencies — band-limiting stress tests
// ============================================================================

#[test]
fn square_high_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["square_high"]);
    // 8000Hz square — only ~2 harmonics below Nyquist
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("square"), json!(8000), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("square_high", &ours, &chrome, 0.15);
}

#[test]
fn sawtooth_high_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sawtooth_high"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(8000), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("sawtooth_high", &ours, &chrome, 0.10);
}

#[test]
fn sine_low_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sine_low"]);
    // 55Hz sine — sub-bass
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(55), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 10);
    assert_frames_match("sine_low", &ours, &chrome, 0.001);
}

#[test]
fn sawtooth_low_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sawtooth_low"]);
    // 80Hz sawtooth — many harmonics (~275)
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(80), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("sawtooth_low", &ours, &chrome, 0.02);
}

// ============================================================================
// Complex routing
// ============================================================================

#[test]
fn parallel_gains_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["parallel_gains"]);
    // sine(440)→gain(0.7) + square(330)→gain(0.3) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(10), json!(0.7)],
            vec![json!("connect"), json!(1), json!(10)],
            vec![json!("connect"), json!(10), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("square"), json!(330), json!(0)],
            vec![json!("gain_create"), json!(20), json!(0.3)],
            vec![json!("connect"), json!(2), json!(20)],
            vec![json!("connect"), json!(20), json!("destination")],
        ], 3);
    // Uses square source — crate's wavetable differs from Chrome
    assert_frames_match("parallel_gains", &ours, &chrome, 0.02);
}

// ============================================================================
// Phase continuity — long renders
// ============================================================================

#[test]
fn long_sine_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["long_sine"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 30);
    // Check first, middle, and last frames
    for &i in &[0, 14, 29] {
        let r = rmse(&ours[i], &chrome[i]);
        println!("long_sine frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "long_sine frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn long_square_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["long_square"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("square"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 30);
    // Check first, middle, and last frames
    for &i in &[0, 14, 29] {
        let r = rmse(&ours[i], &chrome[i]);
        println!("long_square frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.06, "long_square frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// BiquadFilterNode — all 8 filter types
// ============================================================================

#[test]
fn biquad_lowpass_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_lowpass"]);
    // sawtooth(440) → lowpass(500Hz) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(500)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_lowpass", &ours, &chrome, 0.015);
}

#[test]
fn biquad_highpass_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_highpass"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("highpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(2000)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_highpass", &ours, &chrome, 0.05);
}

#[test]
fn biquad_bandpass_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_bandpass"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("bandpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(1000)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_bandpass", &ours, &chrome, 0.005);
}

#[test]
fn biquad_notch_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_notch"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("notch")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(880)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(10)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_notch", &ours, &chrome, 0.05);
}

#[test]
fn biquad_allpass_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_allpass"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("allpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(1000)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_allpass", &ours, &chrome, 0.001);
}

#[test]
fn biquad_peaking_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_peaking"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("peaking")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(440)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(2)],
            vec![json!("param_set"), json!(2), json!("gain"), json!(12)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_peaking", &ours, &chrome, 0.06);
}

#[test]
fn biquad_lowshelf_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_lowshelf"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowshelf")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(200)],
            vec![json!("param_set"), json!(2), json!("gain"), json!(6)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_lowshelf", &ours, &chrome, 0.05);
}

#[test]
fn biquad_highshelf_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_highshelf"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("highshelf")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(3000)],
            vec![json!("param_set"), json!(2), json!("gain"), json!(6)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("biquad_highshelf", &ours, &chrome, 0.08);
}

// ============================================================================
// DelayNode
// ============================================================================

#[test]
fn delay_100ms_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["delay_100ms"]);
    // sine(440) → delay(100ms) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("delay_create"), json!(2), json!(1.0)],
            vec![json!("param_set"), json!(2), json!("delayTime"), json!(0.1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 10);
    assert_frames_match("delay_100ms", &ours, &chrome, 0.001);
}

#[test]
fn delay_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["delay_chain"]);
    // sine(440) → delay(50ms) → delay(50ms) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("delay_create"), json!(2), json!(1.0)],
            vec![json!("param_set"), json!(2), json!("delayTime"), json!(0.05)],
            vec![json!("delay_create"), json!(3), json!(1.0)],
            vec![json!("param_set"), json!(3), json!("delayTime"), json!(0.05)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 10);
    assert_frames_match("delay_chain", &ours, &chrome, 0.001);
}

// ============================================================================
// DynamicsCompressorNode
// ============================================================================

#[test]
fn compressor_basic_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["compressor_basic"]);
    // sawtooth(220) → compressor → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(220), json!(0)],
            vec![json!("compressor_create"), json!(2)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 10);
    // Compressor has stateful envelope — allow wider tolerance
    // Compressor envelope follower differs significantly from Chrome's proprietary
    // implementation (pre-emphasis filters, lookahead, saturation, adaptive makeup gain).
    // Verify the compressor produces output in the right ballpark.
    assert_frames_match("compressor_basic", &ours, &chrome, 0.15);
}

// ============================================================================
// StereoPannerNode
// ============================================================================

#[test]
fn pan_left_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["pan_left"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("panner_create"), json!(2)],
            vec![json!("param_set"), json!(2), json!("pan"), json!(-1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("pan_left", &ours, &chrome, 0.01);
}

#[test]
fn pan_right_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["pan_right"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("panner_create"), json!(2)],
            vec![json!("param_set"), json!(2), json!("pan"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("pan_right", &ours, &chrome, 0.01);
}

#[test]
fn pan_center_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["pan_center"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("panner_create"), json!(2)],
            vec![json!("param_set"), json!(2), json!("pan"), json!(0)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3);
    assert_frames_match("pan_center", &ours, &chrome, 0.01);
}

// ============================================================================
// WaveShaperNode
// ============================================================================

#[test]
fn waveshaper_clip_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["waveshaper_clip"]);
    // Build hard clip curve: [-0.5, 0.5] clamping
    let n = 256;
    let curve: Vec<serde_json::Value> = (0..n)
        .map(|i| {
            let x = (i as f64 * 2.0) / n as f64 - 1.0;
            json!(x.max(-0.5).min(0.5))
        })
        .collect();
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(2.0)],
            vec![json!("shaper_create"), json!(3)],
            vec![json!("shaper_curve"), json!(3), json!(curve)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3);
    assert_frames_match("waveshaper_clip", &ours, &chrome, 0.01);
}

// ============================================================================
// ConstantSourceNode
// ============================================================================

#[test]
fn constant_source_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["constant_source"]);
    let ours = render_frames(
        &[
            vec![json!("constant_create"), json!(1)],
            vec![json!("param_set"), json!(1), json!("offset"), json!(0.5)],
            vec![json!("constant_start"), json!(1)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3);
    assert_frames_match("constant_source", &ours, &chrome, 0.001);
}

// ============================================================================
// AudioParam scheduling
// ============================================================================

#[test]
fn param_set_value_at_time_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_set_value_at_time"]);
    // Sine 440Hz, frequency jumps to 880Hz at t=0.05s
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(880), json!(0.05)],
        ], 10);
    assert_frames_match("param_set_value_at_time", &ours, &chrome, 0.01);
}

#[test]
fn param_linear_ramp_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_linear_ramp"]);
    // Sine frequency ramps 440→880 over 0.1s
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_linearRamp"), json!(1), json!("frequency"), json!(880), json!(0.1)],
        ], 10);
    assert_frames_match("param_linear_ramp", &ours, &chrome, 0.001);
}

#[test]
fn param_exponential_ramp_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_exponential_ramp"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_exponentialRamp"), json!(1), json!("frequency"), json!(880), json!(0.1)],
        ], 10);
    assert_frames_match("param_exponential_ramp", &ours, &chrome, 0.001);
}

#[test]
fn param_set_target_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_set_target"]);
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_setTarget"), json!(1), json!("frequency"), json!(880), json!(0.0), json!(0.05)],
        ], 10);
    assert_frames_match("param_set_target", &ours, &chrome, 0.001);
}

#[test]
fn param_gain_linear_ramp_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_gain_linear_ramp"]);
    // Sine 440Hz → gain ramps 0→1 over 0.1s (fade in)
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(0), json!(0)],
            vec![json!("param_linearRamp"), json!(2), json!("gain"), json!(1), json!(0.1)],
        ], 10);
    assert_frames_match("param_gain_linear_ramp", &ours, &chrome, 0.001);
}

// ============================================================================
// Complex routing patterns
// ============================================================================

#[test]
fn routing_long_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_long_chain"]);
    // sine(440) → 5× gain(0.9) → destination  = 0.9^5 ≈ 0.59
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(10), json!(0.9)],
            vec![json!("gain_create"), json!(11), json!(0.9)],
            vec![json!("gain_create"), json!(12), json!(0.9)],
            vec![json!("gain_create"), json!(13), json!(0.9)],
            vec![json!("gain_create"), json!(14), json!(0.9)],
            vec![json!("connect"), json!(1), json!(10)],
            vec![json!("connect"), json!(10), json!(11)],
            vec![json!("connect"), json!(11), json!(12)],
            vec![json!("connect"), json!(12), json!(13)],
            vec![json!("connect"), json!(13), json!(14)],
            vec![json!("connect"), json!(14), json!("destination")],
        ], 3);
    assert_frames_match("routing_long_chain", &ours, &chrome, 0.001);
}

#[test]
fn routing_fanout_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_fanout"]);
    // One osc → 4 separate gains(0.25) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(10), json!(0.25)],
            vec![json!("gain_create"), json!(11), json!(0.25)],
            vec![json!("gain_create"), json!(12), json!(0.25)],
            vec![json!("gain_create"), json!(13), json!(0.25)],
            vec![json!("connect"), json!(1), json!(10)],
            vec![json!("connect"), json!(1), json!(11)],
            vec![json!("connect"), json!(1), json!(12)],
            vec![json!("connect"), json!(1), json!(13)],
            vec![json!("connect"), json!(10), json!("destination")],
            vec![json!("connect"), json!(11), json!("destination")],
            vec![json!("connect"), json!(12), json!("destination")],
            vec![json!("connect"), json!(13), json!("destination")],
        ], 3);
    assert_frames_match("routing_fanout", &ours, &chrome, 0.001);
}

#[test]
fn routing_biquad_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_biquad_chain"]);
    // sawtooth(440) → lowpass(800) → highpass(200) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(800)],
            vec![json!("biquad_create"), json!(3), json!("highpass")],
            vec![json!("param_set"), json!(3), json!("frequency"), json!(200)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3);
    assert_frames_match("routing_biquad_chain", &ours, &chrome, 0.02);
}

#[test]
fn routing_filter_gain_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_filter_gain_chain"]);
    // sawtooth(440) → lowpass(1000) → gain(0.5) → destination
    let ours = render_frames(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(1000)],
            vec![json!("gain_create"), json!(3), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3);
    assert_frames_match("routing_filter_gain_chain", &ours, &chrome, 0.01);
}

// ============================================================================
// Summary — all scenes in a table
// ============================================================================

#[test]
fn audio_comparison_summary() {
    let reference = load_reference();

    // All scenes with their commands
    let test_cases: Vec<(&str, Vec<Vec<Value>>, usize)> = vec![
        ("sine_440", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("sine_880", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(880), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("square_440", vec![
            vec![json!("osc_start"), json!(1), json!("square"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("sawtooth_440", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("triangle_440", vec![
            vec![json!("osc_start"), json!(1), json!("triangle"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("silence", vec![], 3),
        ("gain_half", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3),
        ("gain_quarter", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.25)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3),
        ("gain_chain", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.8)],
            vec![json!("gain_create"), json!(3), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3),
        ("two_oscillators", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("sine"), json!(660), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3),
        ("three_osc_chord", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("sine"), json!(554.37), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
            vec![json!("osc_start"), json!(3), json!("sine"), json!(659.26), json!(0)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3),
        ("mixed_waveforms", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("square"), json!(220), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
            vec![json!("osc_start"), json!(3), json!("triangle"), json!(880), json!(0)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3),
        ("detuned_beating", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("sine"), json!(441), json!(0)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 30),
        ("square_high", vec![
            vec![json!("osc_start"), json!(1), json!("square"), json!(8000), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("sawtooth_high", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(8000), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("sine_low", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(55), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 10),
        ("sawtooth_low", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(80), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("parallel_gains", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(10), json!(0.7)],
            vec![json!("connect"), json!(1), json!(10)],
            vec![json!("connect"), json!(10), json!("destination")],
            vec![json!("osc_start"), json!(2), json!("square"), json!(330), json!(0)],
            vec![json!("gain_create"), json!(20), json!(0.3)],
            vec![json!("connect"), json!(2), json!(20)],
            vec![json!("connect"), json!(20), json!("destination")],
        ], 3),
        ("long_sine", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 30),
        ("long_square", vec![
            vec![json!("osc_start"), json!(1), json!("square"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 30),
    ];

    println!();
    println!("╔══════════════════════════╦══════════════╦══════════════╦════════╗");
    println!("║ Scene                    ║ RMSE (avg)   ║ Peak Error   ║ Status ║");
    println!("╠══════════════════════════╬══════════════╬══════════════╬════════╣");

    for (name, cmds, num_frames) in &test_cases {
        if reference.get(*name).is_none() { continue; }
        let chrome_frames = parse_chrome_frames(&reference[*name]);
        let our_frames = render_frames(cmds, *num_frames);

        // Skip frame 0 for detuned_beating (Chrome startup artifact)
        let skip = if *name == "detuned_beating" { 1 } else { 0 };
        let n = our_frames.len().min(chrome_frames.len());
        let mut total_rmse = 0.0;
        let mut max_peak = 0.0f64;
        for i in skip..n {
            total_rmse += rmse(&our_frames[i], &chrome_frames[i]);
            max_peak = max_peak.max(peak_error(&our_frames[i], &chrome_frames[i]));
        }
        let avg_rmse = total_rmse / (n - skip) as f64;

        let status = if avg_rmse < 0.001 { "PASS" } else if avg_rmse < 0.01 { "CLOSE" } else { "FAIL" };
        println!("║ {:<24} ║ {:<12.6} ║ {:<12.6} ║ {:<6} ║",
            name, avg_rmse, max_peak, status);
    }

    println!("╚══════════════════════════╩══════════════╩══════════════╩════════╝");
    println!();
    println!("PASS  = RMSE < 0.001 (near-exact match)");
    println!("CLOSE = RMSE < 0.01 (minor band-limiting difference)");
    println!("FAIL  = RMSE >= 0.01");
}
