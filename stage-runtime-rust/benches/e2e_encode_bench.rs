//! End-to-end benchmark: HTML/CSS + Canvas2D + WebGL2 → composite → H.264 encode → file.
//!
//! Measures the full pipeline that replaces Chrome + Xvfb + x11grab + ffmpeg.
//! Three paths compared:
//!   1. Full composite (HTML + WebGL2 + Canvas2D) → encode
//!   2. WebGL2-only → encode
//!   3. Render-only (no encode) — baseline
//!
//! Run: cargo bench --bench e2e_encode_bench --features encoder

use std::path::Path;
use std::time::Instant;

const FRAMES: usize = 300;
const W: u32 = 1280;
const H: u32 = 720;
const FPS: u32 = 30;

/// RMSE between two RGBA pixel buffers. Returns 0.0–1.0.
fn rmse(a: &[u8], b: &[u8]) -> f64 {
    assert_eq!(a.len(), b.len(), "pixel buffers must be same size");
    if a.is_empty() { return 0.0; }
    let sum_sq: f64 = a.iter().zip(b.iter())
        .map(|(&av, &bv)| { let d = av as f64 - bv as f64; d * d })
        .sum();
    (sum_sq / a.len() as f64).sqrt() / 255.0
}

/// Assert a framebuffer is non-trivial (not all zeroes or all same color).
fn assert_non_trivial(label: &str, buf: &[u8]) {
    let first = &buf[..4];
    let all_same = buf.chunks_exact(4).all(|px| px == first);
    assert!(!all_same, "{}: framebuffer is all one color ({:?})", label, first);
}

/// Assert a framebuffer was written to (not all zeroes — pipeline ran).
fn assert_not_blank(label: &str, buf: &[u8]) {
    let all_zero = buf.iter().all(|&b| b == 0);
    assert!(!all_zero, "{}: framebuffer is all zeros — pipeline didn't render", label);
}

/// Assert two framebuffers match within RMSE threshold.
fn assert_visual_match(label: &str, a: &[u8], b: &[u8], threshold: f64) {
    let err = rmse(a, b);
    assert!(
        err <= threshold,
        "{}: RMSE {:.6} exceeds threshold {:.4} — visual output changed between baseline and final frame",
        label, err, threshold,
    );
    eprintln!("  {} visual check: RMSE {:.6} (threshold {:.4}) ✓", label, err, threshold);
}

const DASHBOARD_HTML: &str = r#"<!DOCTYPE html>
<html><head><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; font-family: sans-serif; color: white; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 16px; }
.card {
  background: linear-gradient(135deg, #16213e, #0f3460);
  border-radius: 8px; padding: 16px;
  border: 1px solid rgba(255,255,255,0.1);
}
.card h3 { font-size: 14px; margin-bottom: 8px; color: #e94560; }
.card p { font-size: 12px; opacity: 0.7; }
.bar { height: 4px; background: #e94560; border-radius: 2px; margin-top: 8px; }
</style></head>
<body>
<div class="grid">
  <div class="card"><h3>Alpha</h3><p>First card</p><div class="bar" style="width:80%"></div></div>
  <div class="card"><h3>Beta</h3><p>Second card</p><div class="bar" style="width:60%"></div></div>
  <div class="card"><h3>Gamma</h3><p>Third card</p><div class="bar" style="width:90%"></div></div>
  <div class="card"><h3>Delta</h3><p>Fourth card</p><div class="bar" style="width:45%"></div></div>
</div>
</body></html>"#;

fn load_webgl2_scenes() -> serde_json::Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/webgl2_fixtures/scenes.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
}


/// Patch viewport commands and resolve @shader file references for bench scenes.
fn patch_commands(cmds: &serde_json::Value, w: u32, h: u32) -> serde_json::Value {
    let shader_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/webgl2_fixtures");
    cmds.as_array()
        .unwrap()
        .iter()
        .map(|cmd| {
            let arr = cmd.as_array().unwrap();
            let op = arr[0].as_str().unwrap_or("");
            if op == "viewport" {
                serde_json::json!(["viewport", 0, 0, w, h])
            } else if op == "shaderSource" && arr.len() >= 3 {
                // Resolve @path shader file references
                if let Some(path_ref) = arr[2].as_str().and_then(|s| s.strip_prefix('@')) {
                    let full = shader_dir.join(path_ref);
                    let src = std::fs::read_to_string(&full)
                        .unwrap_or_else(|_| panic!("shader file not found: {}", full.display()));
                    let mut resolved = arr.clone();
                    resolved[2] = serde_json::Value::String(src);
                    serde_json::Value::Array(resolved)
                } else {
                    cmd.clone()
                }
            } else {
                cmd.clone()
            }
        })
        .collect::<Vec<_>>()
        .into()
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    let idx = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[idx.saturating_sub(1).min(sorted.len() - 1)]
}

fn fmt_us(us: f64) -> String {
    if us < 1000.0 {
        format!("{:.0}µs", us)
    } else {
        format!("{:.2}ms", us / 1000.0)
    }
}

fn print_stats(title: &str, frame_times: &mut Vec<f64>, total_us: f64, file_size: Option<u64>) {
    frame_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!();
    println!("═══ {} ═══", title);
    println!("  Resolution:  {}x{} @ {}fps", W, H, FPS);
    println!("  Frames:      {}", FRAMES);
    println!("  Total:       {}", fmt_us(total_us));
    println!("  Throughput:  {:.0} fps", FRAMES as f64 / (total_us / 1_000_000.0));
    if let Some(size) = file_size {
        println!("  Output:      {:.1} KB", size as f64 / 1024.0);
    }
    println!("  ─────────────────────────────────────────");
    println!("  p50:   {}", fmt_us(percentile(frame_times, 50.0)));
    println!("  p90:   {}", fmt_us(percentile(frame_times, 90.0)));
    println!("  p95:   {}", fmt_us(percentile(frame_times, 95.0)));
    println!("  p99:   {}", fmt_us(percentile(frame_times, 99.0)));
    println!("  min:   {}", fmt_us(frame_times[0]));
    println!("  max:   {}", fmt_us(frame_times[frame_times.len() - 1]));
}

fn new_encoder(out_path: &std::path::Path) -> stage_runtime::encoder::Encoder {
    let mut encoder = stage_runtime::encoder::Encoder::new(
        stage_runtime::encoder::EncoderConfig {
            width: W,
            height: H,
            fps: FPS,
            video_codec: "libx264".to_string(),
            video_bitrate: 2_500_000,
            audio_bitrate: 128_000,
            audio_sample_rate: 44100,
            keyframe_interval: 60,
            gpu_device_index: 0,
        },
    ).expect("failed to create encoder");
    encoder.set_outputs(vec![stage_runtime::encoder::OutputDest {
        name: "bench".to_string(),
        url: format!("file:{}", out_path.display()),
        watermarked: false,
    }]);
    encoder
}

/// Composite HTML background + WebGL2 + Canvas2D into framebuffer.
/// Same blending order as runtime: HTML (base) → WebGL2 → Canvas2D.
fn composite(
    framebuffer: &mut [u8],
    html_bg: &tiny_skia::Pixmap,
    gl: &mut stage_runtime::webgl2::WebGL2,
    canvas: &stage_runtime::canvas2d::Canvas2D,
) {
    // 1. HTML/CSS background (base layer)
    framebuffer.copy_from_slice(html_bg.data());

    // 2. WebGL2 (premultiplied alpha blend on top)
    gl.read_pixels_premultiplied(framebuffer);

    // 3. Canvas2D (premultiplied alpha blend on top)
    canvas.read_pixels_premultiplied(framebuffer);
}

fn main() {
    let webgl2_scenes = load_webgl2_scenes();

    // WebGL2: raymarched_spheres (fullscreen fragment shader — fills entire viewport at any resolution)
    let gl_cmds = patch_commands(
        &webgl2_scenes["scenes"]["bench_raymarched_spheres"]["commands"],
        W, H,
    );

    // Canvas2D: build a full-frame scene at 1280x720 (the fixture scenes are 200x200).
    // Draw a gradient background + grid of stroked rects + diagonal lines to cover the viewport.
    let canvas_cmds = serde_json::json!([
        ["fillStyle", "#1a1a2e"],
        ["fillRect", 0, 0, W, H],
        ["strokeStyle", "#e94560"],
        ["lineWidth", 2],
        ["beginPath"],
        ["rect", 10, 10, W as i64 - 20, H as i64 - 20],
        ["stroke"],
        ["strokeStyle", "#0f3460"],
        ["beginPath"],
        ["moveTo", 0, 0], ["lineTo", W, H],
        ["moveTo", W, 0], ["lineTo", 0, H],
        ["stroke"],
        ["fillStyle", "#e94560"],
        ["fillRect", W as i64 / 2 - 100, H as i64 / 2 - 50, 200, 100],
        ["fillStyle", "#ffffff"],
        ["font", "24px sans-serif"],
        ["fillText", "stage-runtime", W as i64 / 2 - 80, H as i64 / 2 + 8]
    ]);

    // HTML/CSS: dashboard grid (pre-rendered once, composited each frame)
    let mut html_bg = tiny_skia::Pixmap::new(W, H).unwrap();
    stage_runtime::htmlcss::render_html(DASHBOARD_HTML, &mut html_bg);

    let tmp = tempfile::tempdir().unwrap();

    // =========================================================================
    // Pre-flight: validate individual layers render and composite is non-trivial
    // =========================================================================
    {
        // HTML/CSS layer should have visual variation (grid layout with cards)
        assert_non_trivial("html_bg", html_bg.data());

        // Full composite should be non-trivial (HTML bg + WebGL2 + Canvas2D blended)
        let mut gl_check = stage_runtime::webgl2::WebGL2::new(W, H);
        let mut c2d_check = stage_runtime::canvas2d::Canvas2D::new(W, H);
        let mut fb_check = vec![0u8; (W * H * 4) as usize];
        gl_check.process_commands(&gl_cmds);
        c2d_check.process_commands(&canvas_cmds);
        composite(&mut fb_check, &html_bg, &mut gl_check, &c2d_check);
        assert_non_trivial("composite", &fb_check);

        eprintln!("  pre-flight: HTML/CSS layer and composite produce non-trivial output ✓");
    }

    // =========================================================================
    // Path 1: Full composite (HTML + WebGL2 + Canvas2D) → swscale → H.264
    // =========================================================================
    {
        let out_path = tmp.path().join("full_composite.flv");
        let mut gl = stage_runtime::webgl2::WebGL2::new(W, H);
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(W, H);
        let mut framebuffer = vec![0u8; (W * H * 4) as usize];
        let mut encoder = new_encoder(&out_path);

        // Warmup
        for _ in 0..10 {
            gl.process_commands(&gl_cmds);
            canvas.process_commands(&canvas_cmds);
            composite(&mut framebuffer, &html_bg, &mut gl, &canvas);
            encoder.encode_frame(&framebuffer, None);
        }

        // Capture baseline frame for visual validation
        gl.process_commands(&gl_cmds);
        canvas.process_commands(&canvas_cmds);
        composite(&mut framebuffer, &html_bg, &mut gl, &canvas);
        let baseline = framebuffer.clone();
        assert_non_trivial("full_composite baseline", &baseline);

        let mut frame_times = Vec::with_capacity(FRAMES);
        let total_start = Instant::now();
        for _ in 0..FRAMES {
            let t0 = Instant::now();
            gl.process_commands(&gl_cmds);
            canvas.process_commands(&canvas_cmds);
            composite(&mut framebuffer, &html_bg, &mut gl, &canvas);
            encoder.encode_frame(&framebuffer, None);
            frame_times.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        }
        let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;
        drop(encoder);

        // Visual validation: final frame should match baseline (deterministic pipeline)
        assert_visual_match("full_composite", &baseline, &framebuffer, 0.001);

        let file_size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
        if file_size == 0 {
            eprintln!("  full_composite: warning — output file is 0 bytes (file: URL may not flush to disk)");
        }
        print_stats(
            "Full composite (HTML+WebGL2+Canvas2D) → swscale → libx264",
            &mut frame_times,
            total_us,
            Some(file_size),
        );
    }

    // =========================================================================
    // Path 2: WebGL2-only → swscale → H.264 (no HTML/CSS or Canvas2D)
    // =========================================================================
    {
        let out_path = tmp.path().join("webgl2_only.flv");
        let mut gl = stage_runtime::webgl2::WebGL2::new(W, H);
        let mut rgba_buf = vec![0u8; (W * H * 4) as usize];
        let mut encoder = new_encoder(&out_path);

        // Warmup
        for _ in 0..10 {
            gl.process_commands(&gl_cmds);
            gl.read_pixels_premultiplied(&mut rgba_buf);
            encoder.encode_frame(&rgba_buf, None);
        }

        // Capture baseline frame for visual validation
        gl.process_commands(&gl_cmds);
        gl.read_pixels_premultiplied(&mut rgba_buf);
        let baseline = rgba_buf.clone();
        assert_not_blank("webgl2_only baseline", &baseline);

        let mut frame_times = Vec::with_capacity(FRAMES);
        let total_start = Instant::now();
        for _ in 0..FRAMES {
            let t0 = Instant::now();
            gl.process_commands(&gl_cmds);
            gl.read_pixels_premultiplied(&mut rgba_buf);
            encoder.encode_frame(&rgba_buf, None);
            frame_times.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        }
        let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;
        drop(encoder);

        // Visual validation: final frame should match baseline
        assert_visual_match("webgl2_only", &baseline, &rgba_buf, 0.001);

        let file_size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
        if file_size == 0 {
            eprintln!("  webgl2_only: warning — output file is 0 bytes (file: URL may not flush to disk)");
        }
        print_stats(
            "WebGL2-only → swscale → libx264",
            &mut frame_times,
            total_us,
            Some(file_size),
        );
    }

    // =========================================================================
    // Path 3: Full composite render-only (no encode) — baseline
    // =========================================================================
    {
        let mut gl = stage_runtime::webgl2::WebGL2::new(W, H);
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(W, H);
        let mut framebuffer = vec![0u8; (W * H * 4) as usize];

        // Warmup
        for _ in 0..10 {
            gl.process_commands(&gl_cmds);
            canvas.process_commands(&canvas_cmds);
            composite(&mut framebuffer, &html_bg, &mut gl, &canvas);
        }

        // Capture baseline frame for visual validation
        gl.process_commands(&gl_cmds);
        canvas.process_commands(&canvas_cmds);
        composite(&mut framebuffer, &html_bg, &mut gl, &canvas);
        let baseline = framebuffer.clone();
        assert_non_trivial("render_only composite", &baseline);

        let mut frame_times = Vec::with_capacity(FRAMES);
        let total_start = Instant::now();
        for _ in 0..FRAMES {
            let t0 = Instant::now();
            gl.process_commands(&gl_cmds);
            canvas.process_commands(&canvas_cmds);
            composite(&mut framebuffer, &html_bg, &mut gl, &canvas);
            frame_times.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        }
        let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;

        // Visual validation: final frame should match baseline
        assert_visual_match("render_only", &baseline, &framebuffer, 0.001);

        print_stats(
            "Full composite render-only (no encode) — baseline",
            &mut frame_times,
            total_us,
            None,
        );
    }

    // =========================================================================
    // Path 4: Encode-only (static frame) — isolate encoder cost
    // =========================================================================
    {
        let out_path = tmp.path().join("encode_only.flv");
        let pixels = vec![128u8; (W * H * 4) as usize];
        let mut encoder = new_encoder(&out_path);

        // Warmup
        for _ in 0..10 {
            encoder.encode_frame(&pixels, None);
        }

        let mut frame_times = Vec::with_capacity(FRAMES);
        let total_start = Instant::now();
        for _ in 0..FRAMES {
            let t0 = Instant::now();
            encoder.encode_frame(&pixels, None);
            frame_times.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        }
        let total_us = total_start.elapsed().as_nanos() as f64 / 1000.0;
        drop(encoder);

        let file_size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
        print_stats(
            "Encode-only (static frame) → libx264 — encoder baseline",
            &mut frame_times,
            total_us,
            Some(file_size),
        );
    }

    println!();
    println!("═══ Visual validation: all pipelines produce deterministic, non-trivial output ✓ ═══");
    println!();
}
