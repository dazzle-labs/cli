//! Audio offline renderer tests — compare web-audio-api crate output against Chrome.
//!
//! Uses the same Chrome reference data as audio_reference_test.rs but renders via
//! the web-audio-api crate's OfflineAudioContext for tighter Chrome alignment.

use stage_runtime::audio::offline::render_offline;
use serde_json::{json, Value};
use std::path::Path;

const SAMPLE_RATE: u32 = 44100;
const FPS: u32 = 30;

fn load_reference() -> Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/audio_fixtures/audio_reference.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
}

fn rmse(a: &[f32], b: &[f32]) -> f64 {
    assert_eq!(a.len(), b.len(), "buffer length mismatch");
    let sum_sq: f64 = a.iter().zip(b.iter())
        .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
        .sum();
    (sum_sq / a.len() as f64).sqrt()
}

fn peak_error(a: &[f32], b: &[f32]) -> f64 {
    a.iter().zip(b.iter())
        .map(|(x, y)| (*x as f64 - *y as f64).abs())
        .fold(0.0f64, f64::max)
}

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
// Basic waveforms
// ============================================================================

#[test]
fn offline_sine_440() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sine_440"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_sine_440", &ours, &chrome, 0.001);
}

#[test]
fn offline_square_440() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["square_440"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("square"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    // PeriodicWave Fourier synthesis — residual from wavetable interpolation
    assert_frames_match("offline_square_440", &ours, &chrome, 0.06);
}

#[test]
fn offline_sawtooth_440() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sawtooth_440"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    // PeriodicWave Fourier synthesis — residual from wavetable interpolation
    assert_frames_match("offline_sawtooth_440", &ours, &chrome, 0.05);
}

#[test]
fn offline_triangle_440() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["triangle_440"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("triangle"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_triangle_440", &ours, &chrome, 0.01);
}

// ============================================================================
// Gain
// ============================================================================

#[test]
fn offline_gain_half() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_half"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_gain_half", &ours, &chrome, 0.001);
}

#[test]
fn offline_gain_chain() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_chain"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.8)],
            vec![json!("gain_create"), json!(3), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_gain_chain", &ours, &chrome, 0.001);
}

// ============================================================================
// BiquadFilter
// ============================================================================

#[test]
fn offline_biquad_lowpass() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_lowpass"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(500)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    // Biquad differs between web-audio-api crate and Chrome
    assert_frames_match("offline_biquad_lowpass", &ours, &chrome, 0.10);
}

#[test]
fn offline_biquad_highpass() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_highpass"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("highpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(2000)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_biquad_highpass", &ours, &chrome, 0.10);
}

// ============================================================================
// Delay
// ============================================================================

#[test]
fn offline_delay_100ms() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["delay_100ms"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("delay_create"), json!(2), json!(1.0)],
            vec![json!("param_set"), json!(2), json!("delayTime"), json!(0.1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], SAMPLE_RATE, 10, FPS);
    assert_frames_match("offline_delay_100ms", &ours, &chrome, 0.001);
}

// ============================================================================
// DynamicsCompressor — the big one
// ============================================================================

#[test]
fn offline_compressor_basic() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["compressor_basic"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(220), json!(0)],
            vec![json!("compressor_create"), json!(2)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], SAMPLE_RATE, 10, FPS);
    // Chrome compressor port — residual from lookahead/envelope differences
    assert_frames_match("offline_compressor_basic", &ours, &chrome, 0.08);
}

// ============================================================================
// StereoPanner
// ============================================================================

#[test]
fn offline_pan_left() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["pan_left"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("panner_create"), json!(2)],
            vec![json!("param_set"), json!(2), json!("pan"), json!(-1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_pan_left", &ours, &chrome, 0.01);
}

// ============================================================================
// WaveShaper
// ============================================================================

#[test]
fn offline_waveshaper_clip() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["waveshaper_clip"]);
    let n = 256;
    let curve: Vec<serde_json::Value> = (0..n)
        .map(|i| {
            let x = (i as f64 * 2.0) / n as f64 - 1.0;
            json!(x.max(-0.5).min(0.5))
        })
        .collect();
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(2.0)],
            vec![json!("shaper_create"), json!(3)],
            vec![json!("shaper_curve"), json!(3), json!(curve)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_waveshaper_clip", &ours, &chrome, 0.01);
}

// ============================================================================
// ConstantSource
// ============================================================================

#[test]
fn offline_constant_source() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["constant_source"]);
    let ours = render_offline(
        &[
            vec![json!("constant_create"), json!(1)],
            vec![json!("param_set"), json!(1), json!("offset"), json!(0.5)],
            vec![json!("constant_start"), json!(1)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_constant_source", &ours, &chrome, 0.001);
}

// ============================================================================
// AudioParam scheduling
// ============================================================================

#[test]
fn offline_param_set_value_at_time() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_set_value_at_time"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(880), json!(0.05)],
        ], SAMPLE_RATE, 10, FPS);
    assert_frames_match("offline_param_set_value_at_time", &ours, &chrome, 0.01);
}

#[test]
fn offline_param_linear_ramp() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_linear_ramp"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_linearRamp"), json!(1), json!("frequency"), json!(880), json!(0.1)],
        ], SAMPLE_RATE, 10, FPS);
    assert_frames_match("offline_param_linear_ramp", &ours, &chrome, 0.01);
}

#[test]
fn offline_param_exponential_ramp() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_exponential_ramp"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_exponentialRamp"), json!(1), json!("frequency"), json!(880), json!(0.1)],
        ], SAMPLE_RATE, 10, FPS);
    assert_frames_match("offline_param_exponential_ramp", &ours, &chrome, 0.01);
}

#[test]
fn offline_param_set_target() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_set_target"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_setTarget"), json!(1), json!("frequency"), json!(880), json!(0.0), json!(0.05)],
        ], SAMPLE_RATE, 10, FPS);
    assert_frames_match("offline_param_set_target", &ours, &chrome, 0.01);
}

#[test]
fn offline_param_gain_ramp() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_gain_linear_ramp"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(0), json!(0)],
            vec![json!("param_linearRamp"), json!(2), json!("gain"), json!(1), json!(0.1)],
        ], SAMPLE_RATE, 10, FPS);
    assert_frames_match("offline_param_gain_ramp", &ours, &chrome, 0.01);
}

// ============================================================================
// Complex routing
// ============================================================================

#[test]
fn offline_routing_long_chain() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_long_chain"]);
    let ours = render_offline(
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
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_routing_long_chain", &ours, &chrome, 0.001);
}

#[test]
fn offline_routing_biquad_chain() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_biquad_chain"]);
    let ours = render_offline(
        &[
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(800)],
            vec![json!("biquad_create"), json!(3), json!("highpass")],
            vec![json!("param_set"), json!(3), json!("frequency"), json!(200)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], SAMPLE_RATE, 3, FPS);
    assert_frames_match("offline_routing_biquad_chain", &ours, &chrome, 0.02);
}

// ============================================================================
// Summary comparison table
// ============================================================================

#[test]
fn offline_comparison_summary() {
    let reference = load_reference();

    let test_cases: Vec<(&str, Vec<Vec<Value>>, usize)> = vec![
        ("sine_440", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
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
        ("gain_half", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("gain_create"), json!(2), json!(0.5)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3),
        ("biquad_lowpass", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(500)],
            vec![json!("param_set"), json!(2), json!("Q"), json!(1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3),
        ("delay_100ms", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("delay_create"), json!(2), json!(1.0)],
            vec![json!("param_set"), json!(2), json!("delayTime"), json!(0.1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 10),
        ("compressor_basic", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(220), json!(0)],
            vec![json!("compressor_create"), json!(2)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 10),
        ("pan_left", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("panner_create"), json!(2)],
            vec![json!("param_set"), json!(2), json!("pan"), json!(-1)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!("destination")],
        ], 3),
        ("constant_source", vec![
            vec![json!("constant_create"), json!(1)],
            vec![json!("param_set"), json!(1), json!("offset"), json!(0.5)],
            vec![json!("constant_start"), json!(1)],
            vec![json!("connect"), json!(1), json!("destination")],
        ], 3),
        ("param_linear_ramp", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_linearRamp"), json!(1), json!("frequency"), json!(880), json!(0.1)],
        ], 10),
        ("param_set_target", vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
            vec![json!("param_setValueAtTime"), json!(1), json!("frequency"), json!(440), json!(0)],
            vec![json!("param_setTarget"), json!(1), json!("frequency"), json!(880), json!(0.0), json!(0.05)],
        ], 10),
        ("routing_biquad_chain", vec![
            vec![json!("osc_start"), json!(1), json!("sawtooth"), json!(440), json!(0)],
            vec![json!("biquad_create"), json!(2), json!("lowpass")],
            vec![json!("param_set"), json!(2), json!("frequency"), json!(800)],
            vec![json!("biquad_create"), json!(3), json!("highpass")],
            vec![json!("param_set"), json!(3), json!("frequency"), json!(200)],
            vec![json!("connect"), json!(1), json!(2)],
            vec![json!("connect"), json!(2), json!(3)],
            vec![json!("connect"), json!(3), json!("destination")],
        ], 3),
    ];

    println!();
    println!("╔══════════════════════════╦══════════════╦══════════════╦════════╗");
    println!("║ Scene (offline)          ║ RMSE (avg)   ║ Peak Error   ║ Status ║");
    println!("╠══════════════════════════╬══════════════╬══════════════╬════════╣");

    for (name, cmds, num_frames) in &test_cases {
        if reference.get(*name).is_none() { continue; }
        let chrome_frames = parse_chrome_frames(&reference[*name]);
        let our_frames = render_offline(cmds, SAMPLE_RATE, *num_frames, FPS);

        let n = our_frames.len().min(chrome_frames.len());
        let mut total_rmse = 0.0;
        let mut max_peak = 0.0f64;
        for i in 0..n {
            total_rmse += rmse(&our_frames[i], &chrome_frames[i]);
            max_peak = max_peak.max(peak_error(&our_frames[i], &chrome_frames[i]));
        }
        let avg_rmse = total_rmse / n as f64;

        let status = if avg_rmse < 0.001 { "PASS" } else if avg_rmse < 0.01 { "CLOSE" } else { "FAIL" };
        println!("║ {:<24} ║ {:<12.6} ║ {:<12.6} ║ {:<6} ║",
            name, avg_rmse, max_peak, status);
    }

    println!("╚══════════════════════════╩══════════════╩══════════════╩════════╝");
}
