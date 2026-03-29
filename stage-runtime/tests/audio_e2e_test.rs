//! Audio end-to-end tests: JS AudioContext → V8 polyfill → command buffer → Rust AudioGraph → PCM samples.
//!
//! These tests verify the full pipeline from JavaScript Web Audio API calls through
//! the V8 polyfill, command buffer serialization, and Rust-side audio rendering.
//! Reference data from Chrome OfflineAudioContext is used for comparison.
//!
//! Run: cargo test --test audio_e2e_test

mod test_harness;
use test_harness::*;

use serde_json::Value;
use std::path::Path;

const SAMPLE_RATE: u32 = 44100;
const FPS: u32 = 30;
const SAMPLES_PER_FRAME: usize = (SAMPLE_RATE / FPS) as usize; // 1470


fn load_reference() -> Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/audio_fixtures/audio_reference.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
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

fn rmse(a: &[f32], b: &[f32]) -> f64 {
    assert_eq!(a.len(), b.len(), "buffer length mismatch: {} vs {}", a.len(), b.len());
    let sum_sq: f64 = a.iter().zip(b.iter())
        .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
        .sum();
    (sum_sq / a.len() as f64).sqrt()
}

// ============================================================================
// Basic e2e: JS → commands → audio → samples
// ============================================================================

#[test]
fn e2e_sine_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sine_440"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let audio = &rt.state.audio_frame;
        assert_eq!(audio.len(), SAMPLES_PER_FRAME * 2, "frame {} wrong length", i);
        let r = rmse(audio, &chrome[i]);
        println!("e2e sine_440 frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_square_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["square_440"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e square_440 frame {}: RMSE={:.6}", i, r);
        // Relaxed threshold: web-audio-api crate's PeriodicWave wavetable rendering
        // differs from Chrome's IFFT-based wavetable at discontinuities (~3.8% RMSE)
        assert!(r < 0.05, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_sawtooth_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sawtooth_440"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e sawtooth_440 frame {}: RMSE={:.6}", i, r);
        // Relaxed threshold: sawtooth PeriodicWave rendering differs from Chrome (~2.9% RMSE)
        assert!(r < 0.05, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_triangle_440_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["triangle_440"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e triangle_440 frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// Gain routing through JS
// ============================================================================

#[test]
fn e2e_gain_half_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_half"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var gain = ctx.createGain();
        gain.gain.value = 0.5;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e gain_half frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_gain_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["gain_chain"]);

    let mut rt = make_runtime(64, 64);
    // osc → gain(0.8) → gain(0.5) → destination = effective gain 0.4
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var g1 = ctx.createGain();
        g1.gain.value = 0.8;
        var g2 = ctx.createGain();
        g2.gain.value = 0.5;
        osc.connect(g1);
        g1.connect(g2);
        g2.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e gain_chain frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// Multi-oscillator through JS
// ============================================================================

#[test]
fn e2e_two_oscillators_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["two_oscillators"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 440;
        osc1.connect(ctx.destination);
        osc1.start(0);

        var osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.value = 660;
        osc2.connect(ctx.destination);
        osc2.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e two_oscillators frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_mixed_waveforms_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["mixed_waveforms"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var types = [['sine', 440], ['square', 220], ['triangle', 880]];
        for (var i = 0; i < types.length; i++) {
            var osc = ctx.createOscillator();
            osc.type = types[i][0];
            osc.frequency.value = types[i][1];
            osc.connect(ctx.destination);
            osc.start(0);
        }
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e mixed_waveforms frame {}: RMSE={:.6}", i, r);
        // Contains square wave: PeriodicWave synthesis difference contributes ~2.7% RMSE
        assert!(r < 0.05, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// Parallel gains (complex routing)
// ============================================================================

#[test]
fn e2e_parallel_gains_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["parallel_gains"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();

        var osc1 = ctx.createOscillator();
        osc1.type = 'sine';
        osc1.frequency.value = 440;
        var g1 = ctx.createGain();
        g1.gain.value = 0.7;
        osc1.connect(g1);
        g1.connect(ctx.destination);
        osc1.start(0);

        var osc2 = ctx.createOscillator();
        osc2.type = 'square';
        osc2.frequency.value = 330;
        var g2 = ctx.createGain();
        g2.gain.value = 0.3;
        osc2.connect(g2);
        g2.connect(ctx.destination);
        osc2.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e parallel_gains frame {}: RMSE={:.6}", i, r);
        // Contains square wave oscillator: synthesis difference contributes ~0.9% RMSE
        assert!(r < 0.02, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// Silence — no audio nodes
// ============================================================================

#[test]
fn e2e_silence_no_audio_context() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        // No AudioContext — should produce silence
    "#).unwrap();

    rt.tick();
    assert!(rt.state.audio_frame.iter().all(|&s| s == 0.0),
        "expected silence, got non-zero samples");
    assert_eq!(rt.state.audio_frame.len(), SAMPLES_PER_FRAME * 2);
}

#[test]
fn e2e_silence_context_no_nodes() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        // Context created but no oscillators started
    "#).unwrap();

    rt.tick();
    assert!(rt.state.audio_frame.iter().all(|&s| s == 0.0),
        "expected silence with empty AudioContext");
}

// ============================================================================
// Phase continuity — multi-frame rendering
// ============================================================================

#[test]
fn e2e_long_sine_phase_continuity() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["long_sine"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..30 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        if i % 10 == 0 || i == 29 {
            println!("e2e long_sine frame {}: RMSE={:.6}", i, r);
        }
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_long_square_phase_continuity() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["long_square"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = 440;
        osc.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..30 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        if i % 10 == 0 || i == 29 {
            println!("e2e long_square frame {}: RMSE={:.6}", i, r);
        }
        // Square wave: PeriodicWave synthesis difference contributes ~3.8% RMSE
        assert!(r < 0.05, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// HTML + Audio — full content pipeline
// ============================================================================

#[test]
fn e2e_html_with_audio() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["sine_440"]);

    let mut rt = make_runtime(64, 64);
    // Load audio setup via HTML <script> tag — same path as real content
    rt.load_html(r#"
        <html>
        <body>
        <script>
            var ctx = new AudioContext();
            var osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 440;
            osc.connect(ctx.destination);
            osc.start(0);
        </script>
        </body>
        </html>
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e html_with_audio frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
// ============================================================================
// BiquadFilterNode through JS
// ============================================================================

#[test]
fn e2e_biquad_lowpass_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["biquad_lowpass"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 440;
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 500;
        f.Q.value = 1;
        osc.connect(f);
        f.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e biquad_lowpass frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.05, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// StereoPannerNode through JS
// ============================================================================

#[test]
fn e2e_pan_left_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["pan_left"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var pan = ctx.createStereoPanner();
        pan.pan.value = -1;
        osc.connect(pan);
        pan.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e pan_left frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.01, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// DelayNode through JS
// ============================================================================

#[test]
fn e2e_delay_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["delay_100ms"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var d = ctx.createDelay(1.0);
        d.delayTime.value = 0.1;
        osc.connect(d);
        d.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..10 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        if i < 3 || i == 9 {
            println!("e2e delay frame {}: RMSE={:.6}", i, r);
        }
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// WaveShaperNode through JS
// ============================================================================

#[test]
fn e2e_waveshaper_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["waveshaper_clip"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var gain = ctx.createGain();
        gain.gain.value = 2.0;
        var shaper = ctx.createWaveShaper();
        var n = 256;
        var curve = new Float32Array(n);
        for (var i = 0; i < n; i++) {
            var x = (i * 2) / n - 1;
            curve[i] = Math.max(-0.5, Math.min(0.5, x));
        }
        shaper.curve = curve;
        osc.connect(gain);
        gain.connect(shaper);
        shaper.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e waveshaper frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.01, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// ConstantSourceNode through JS
// ============================================================================

#[test]
fn e2e_constant_source_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["constant_source"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var cs = ctx.createConstantSource();
        cs.offset.value = 0.5;
        cs.connect(ctx.destination);
        cs.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e constant_source frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// AudioParam scheduling through JS
// ============================================================================

#[test]
fn e2e_param_linear_ramp_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["param_gain_linear_ramp"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(0, 0);
        gain.gain.linearRampToValueAtTime(1, 0.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..10 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        if i < 3 || i == 9 {
            println!("e2e param_gain_ramp frame {}: RMSE={:.6}", i, r);
        }
        assert!(r < 0.03, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// Complex routing through JS
// ============================================================================

#[test]
fn e2e_routing_long_chain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_long_chain"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 440;
        var prev = osc;
        for (var i = 0; i < 5; i++) {
            var g = ctx.createGain();
            g.gain.value = 0.9;
            prev.connect(g);
            prev = g;
        }
        prev.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e routing_long_chain frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.001, "frame {} RMSE too high: {:.6}", i, r);
    }
}

#[test]
fn e2e_routing_filter_gain_matches_chrome() {
    let ref_ = load_reference();
    let chrome = parse_chrome_frames(&ref_["routing_filter_gain_chain"]);

    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var ctx = new AudioContext();
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 440;
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 1000;
        var g = ctx.createGain();
        g.gain.value = 0.5;
        osc.connect(f);
        f.connect(g);
        g.connect(ctx.destination);
        osc.start(0);
    "#).unwrap();

    for i in 0..3 {
        rt.tick();
        let r = rmse(&rt.state.audio_frame, &chrome[i]);
        println!("e2e routing_filter_gain frame {}: RMSE={:.6}", i, r);
        assert!(r < 0.05, "frame {} RMSE too high: {:.6}", i, r);
    }
}

// ============================================================================
// HTML + Audio — full content pipeline
// ============================================================================

#[test]
fn e2e_html_canvas_and_audio() {
    let ref_ = load_reference();
    let chrome_audio = parse_chrome_frames(&ref_["gain_half"]);

    let mut rt = make_runtime(64, 64);
    // Load content that draws a red rect AND plays audio simultaneously
    rt.load_html(r#"
        <html>
        <body>
        <script>
            // Visual: red rectangle
            var canvas = document.createElement('canvas');
            var draw_ctx = canvas.getContext('2d');
            function draw() {
                draw_ctx.fillStyle = '#ff0000';
                draw_ctx.fillRect(0, 0, 64, 64);
                requestAnimationFrame(draw);
            }
            requestAnimationFrame(draw);

            // Audio: 440Hz sine through gain(0.5)
            var audio_ctx = new AudioContext();
            var osc = audio_ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 440;
            var gain = audio_ctx.createGain();
            gain.gain.value = 0.5;
            osc.connect(gain);
            gain.connect(audio_ctx.destination);
            osc.start(0);
        </script>
        </body>
        </html>
    "#).unwrap();

    for i in 0..3 {
        rt.tick();

        // Verify audio matches Chrome
        let audio_rmse = rmse(&rt.state.audio_frame, &chrome_audio[i]);
        println!("e2e canvas+audio frame {}: audio RMSE={:.6}", i, audio_rmse);
        assert!(audio_rmse < 0.001, "frame {} audio RMSE too high: {:.6}", i, audio_rmse);

        // Verify video has red pixels (canvas is drawing)
        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        assert!(px[0] > 200, "frame {} should have red pixels, got {:?}", i, px);
    }
}
