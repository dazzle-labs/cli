//! Performance benchmarks for stage-runtime hot paths.
//!
//! Run:   cargo bench --package stage-runtime
//! With encoder: cargo bench --package stage-runtime --features encoder
//!
//! Reports are saved to target/criterion/ with HTML charts.

use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId, black_box};
use serde_json::json;
use std::path::Path;
use std::sync::{Arc, Mutex};

// ============================================================================
// Canvas 2D benchmarks
// ============================================================================

fn load_canvas2d_scenes() -> serde_json::Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scenes.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
}

fn canvas2d_process_commands(c: &mut Criterion) {
    let scenes = load_canvas2d_scenes();
    let w = scenes["width"].as_u64().unwrap() as u32;
    let h = scenes["height"].as_u64().unwrap() as u32;

    let mut group = c.benchmark_group("canvas2d/process_commands");

    // Simple: 3 commands (clear_rect)
    let simple_cmds = &scenes["scenes"]["clear_rect"]["commands"];
    group.bench_function("simple_3cmd", |b| {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        b.iter(|| {
            canvas.process_commands(black_box(simple_cmds));
        });
    });

    // Medium: 20 commands (alpha_gradient_rects)
    let medium_cmds = &scenes["scenes"]["alpha_gradient_rects"]["commands"];
    group.bench_function("medium_20cmd", |b| {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        b.iter(|| {
            canvas.process_commands(black_box(medium_cmds));
        });
    });

    // Complex: 38 commands with paths (spiral_path)
    let complex_cmds = &scenes["scenes"]["spiral_path"]["commands"];
    group.bench_function("complex_38cmd", |b| {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        b.iter(|| {
            canvas.process_commands(black_box(complex_cmds));
        });
    });

    // Gradient: linear gradient (gradient_linear_multi)
    let gradient_cmds = &scenes["scenes"]["gradient_linear_multi"]["commands"];
    group.bench_function("gradient", |b| {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        b.iter(|| {
            canvas.process_commands(black_box(gradient_cmds));
        });
    });

    // Text: shadow_text (text rendering + shadow)
    let text_cmds = &scenes["scenes"]["shadow_text"]["commands"];
    group.bench_function("text_shadow", |b| {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        b.iter(|| {
            canvas.process_commands(black_box(text_cmds));
        });
    });

    group.finish();
}

fn canvas2d_read_pixels_premultiplied(c: &mut Criterion) {
    let mut group = c.benchmark_group("canvas2d/read_pixels_premultiplied");

    for (label, w, h) in [("200x200", 200, 200), ("720p", 1280, 720), ("1080p", 1920, 1080)] {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        canvas.process_commands(&json!([
            ["fillStyle", "#ff6600"],
            ["globalAlpha", 0.7],
            ["fillRect", 0, 0, w, h]
        ]));
        let mut output = vec![0u8; (w * h * 4) as usize];

        group.bench_with_input(BenchmarkId::new("resolution", label), &(), |b, _| {
            b.iter(|| {
                canvas.read_pixels_premultiplied(black_box(&mut output));
            });
        });
    }

    group.finish();
}

fn canvas2d_full_frame(c: &mut Criterion) {
    let scenes = load_canvas2d_scenes();
    let w = scenes["width"].as_u64().unwrap() as u32;
    let h = scenes["height"].as_u64().unwrap() as u32;
    let cmds = &scenes["scenes"]["spiral_path"]["commands"];
    let mut output = vec![0u8; (w * h * 4) as usize];

    c.bench_function("canvas2d/full_frame_spiral", |b| {
        let mut canvas = stage_runtime::canvas2d::Canvas2D::new(w, h);
        b.iter(|| {
            canvas.process_commands(black_box(cmds));
            canvas.read_pixels_premultiplied(black_box(&mut output));
        });
    });
}

// ============================================================================
// WebGL2 benchmarks
// ============================================================================

fn load_webgl2_scenes() -> serde_json::Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/webgl2_fixtures/scenes.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
}

fn webgl2_process_commands(c: &mut Criterion) {
    let scenes = load_webgl2_scenes();
    let w = scenes["width"].as_u64().unwrap() as u32;
    let h = scenes["height"].as_u64().unwrap() as u32;

    let mut group = c.benchmark_group("webgl2/process_commands");

    // Simple: clear_red (4 commands)
    let clear_cmds = &scenes["scenes"]["clear_red"]["commands"];
    group.bench_function("clear", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(clear_cmds));
        });
    });

    // Triangle: triangle_solid
    let tri_cmds = &scenes["scenes"]["triangle_solid"]["commands"];
    group.bench_function("triangle", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(tri_cmds));
        });
    });

    // Complex: instanced_cube_grid (47 commands)
    let complex_cmds = &scenes["scenes"]["instanced_cube_grid"]["commands"];
    group.bench_function("instanced_cubes_47cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(complex_cmds));
        });
    });

    // Lit: phong_lit_sphere (46 commands)
    let phong_cmds = &scenes["scenes"]["phong_lit_sphere"]["commands"];
    group.bench_function("phong_sphere_46cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(phong_cmds));
        });
    });

    // --- 3D benchmark scenes ---

    // Terrain: 32x32 grid (1089 verts, 2048 tris) with Phong lighting
    let terrain_cmds = &scenes["scenes"]["bench_terrain_lit"]["commands"];
    group.bench_function("bench_terrain_lit_43cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(terrain_cmds));
        });
    });

    // 25 lit cubes: 25 draw calls with uniform updates
    let cubes_cmds = &scenes["scenes"]["bench_cubes_lit_25"]["commands"];
    group.bench_function("bench_cubes_lit_25_139cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(cubes_cmds));
        });
    });

    // Raymarched spheres: fragment-heavy fullscreen SDF
    let ray_cmds = &scenes["scenes"]["bench_raymarched_spheres"]["commands"];
    group.bench_function("bench_raymarched_spheres_25cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(ray_cmds));
        });
    });

    // 256 particles: alpha-blended soft circles
    let particle_cmds = &scenes["scenes"]["bench_particles_256"]["commands"];
    group.bench_function("bench_particles_256_32cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(particle_cmds));
        });
    });

    // Normal perturbation: fragment-heavy procedural lighting
    let normal_cmds = &scenes["scenes"]["bench_normal_perturb"]["commands"];
    group.bench_function("bench_normal_perturb_25cmd", |b| {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        b.iter(|| {
            gl.process_commands(black_box(normal_cmds));
        });
    });

    group.finish();
}

/// Full-frame 720p benchmarks: process_commands + read_pixels (GPU flush).
/// Comparable to Chrome's bench_chrome.cjs with readPixels fence.
fn webgl2_full_frame_720p(c: &mut Criterion) {
    let scenes = load_webgl2_scenes();
    let mut group = c.benchmark_group("webgl2/full_frame_720p");

    let bench_scenes = [
        ("bench_terrain_lit", "terrain_lit"),
        ("bench_cubes_lit_25", "cubes_lit_25"),
        ("bench_raymarched_spheres", "raymarched"),
        ("bench_particles_256", "particles_256"),
        ("bench_normal_perturb", "normal_perturb"),
    ];

    let w: u32 = 1280;
    let h: u32 = 720;

    for (scene_key, label) in bench_scenes {
        let cmds = &scenes["scenes"][scene_key]["commands"];

        // Patch viewport commands to 720p
        let patched: serde_json::Value = cmds.as_array().unwrap().iter().map(|cmd| {
            let arr = cmd.as_array().unwrap();
            if arr[0].as_str() == Some("viewport") {
                json!(["viewport", 0, 0, w, h])
            } else {
                cmd.clone()
            }
        }).collect::<Vec<_>>().into();

        group.bench_function(label, |b| {
            let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
            let mut output = vec![0u8; (w * h * 4) as usize];

            // Warmup: first call compiles shaders, allocates buffers
            gl.process_commands(black_box(&patched));
            gl.read_pixels_premultiplied(&mut output);

            b.iter(|| {
                gl.process_commands(black_box(&patched));
                gl.read_pixels_premultiplied(black_box(&mut output));
            });
        });
    }

    group.finish();
}

fn webgl2_read_pixels(c: &mut Criterion) {
    let mut group = c.benchmark_group("webgl2/read_pixels");

    for (label, w, h) in [("720p", 1280, 720)] {
        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        gl.process_commands(&json!([
            ["clearColor", 0.2, 0.3, 0.8, 1.0],
            ["clear", 16384]
        ]));
        let mut output = vec![0u8; (w * h * 4) as usize];

        group.bench_with_input(BenchmarkId::new("resolution", label), &(), |b, _| {
            b.iter(|| {
                gl.read_pixels_premultiplied(black_box(&mut output));
            });
        });
    }

    group.finish();
}

/// Microbenchmarks isolating GPU sync overhead components at 720p.
fn webgl2_sync_breakdown(c: &mut Criterion) {
    let mut group = c.benchmark_group("webgl2/sync_breakdown");
    let w: u32 = 1280;
    let h: u32 = 720;

    // 1. poll(Wait) with NO pending work — pure sync overhead
    {
        let gl = stage_runtime::webgl2::WebGL2::new(w, h);
        let gpu = gl.gpu().unwrap();
        group.bench_function("poll_wait_no_work", |b| {
            b.iter(|| {
                let _ = gpu.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
            });
        });
    }

    // 2. submit empty + poll(Wait) — queue submit overhead
    {
        let gl = stage_runtime::webgl2::WebGL2::new(w, h);
        let gpu = gl.gpu().unwrap();
        group.bench_function("submit_empty_poll", |b| {
            b.iter(|| {
                gpu.queue.submit(std::iter::empty());
                let _ = gpu.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
            });
        });
    }

    // 3. map_async + poll — just the mapping ceremony on a staging buffer
    {
        let gl = stage_runtime::webgl2::WebGL2::new(w, h);
        let gpu = gl.gpu().unwrap();
        let buf_size = (w * h * 4) as u64;
        let staging = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("bench_staging"),
            size: buf_size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        group.bench_function("map_unmap_staging", |b| {
            b.iter(|| {
                let slice = staging.slice(..);
                let (tx, rx) = std::sync::mpsc::channel();
                slice.map_async(wgpu::MapMode::Read, move |r| { tx.send(r).unwrap(); });
                let _ = gpu.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
                rx.recv().unwrap().unwrap();
                staging.unmap();
            });
        });
    }

    // 4. Render + submit + poll — render pipeline only, no readback
    {
        let scenes = load_webgl2_scenes();
        let cmds = &scenes["scenes"]["bench_terrain_lit"]["commands"];
        let patched: serde_json::Value = cmds.as_array().unwrap().iter().map(|cmd| {
            let arr = cmd.as_array().unwrap();
            if arr[0].as_str() == Some("viewport") { json!(["viewport", 0, 0, w, h]) }
            else { cmd.clone() }
        }).collect::<Vec<_>>().into();

        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        gl.process_commands(&patched); // warmup
        {
            let gpu = gl.gpu_mut().unwrap();
            let p = gpu.take_pending_commands();
            gpu.queue.submit(p);
            let _ = gpu.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
        }

        group.bench_function("render_submit_poll", |b| {
            b.iter(|| {
                gl.process_commands(black_box(&patched));
                let gpu = gl.gpu_mut().unwrap();
                let p = gpu.take_pending_commands();
                gpu.queue.submit(p);
                let _ = gpu.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
            });
        });
    }

    // 5. Just the memcpy of 720p RGBA data (3.69MB)
    {
        let rgba_size = (w as usize) * (h as usize) * 4;
        let src = vec![128u8; rgba_size];
        let mut dst = vec![0u8; rgba_size];
        group.bench_function("memcpy_rgba_720p", |b| {
            b.iter(|| {
                dst.copy_from_slice(black_box(&src));
            });
        });
    }

    group.finish();
}

// ============================================================================
// Audio benchmarks
// ============================================================================

fn audio_render_frame(c: &mut Criterion) {
    let mut group = c.benchmark_group("audio/render_frame");

    // Silence (no nodes)
    group.bench_function("silence", |b| {
        let mut graph = stage_runtime::audio::AudioGraph::new(44100, 30);
        b.iter(|| {
            black_box(graph.render_frame());
        });
    });

    // Single oscillator
    group.bench_function("1_osc", |b| {
        let mut graph = stage_runtime::audio::AudioGraph::new(44100, 30);
        graph.process_commands(&[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ]);
        b.iter(|| {
            black_box(graph.render_frame());
        });
    });

    // 10 oscillators (polyphonic synth scenario)
    group.bench_function("10_osc", |b| {
        let mut graph = stage_runtime::audio::AudioGraph::new(44100, 30);
        for i in 1..=10u64 {
            let freq = 220.0 + i as f64 * 55.0;
            graph.process_commands(&[
                vec![json!("osc_start"), json!(i), json!("sine"), json!(freq), json!(0)],
                vec![json!("connect"), json!(i), json!("destination")],
            ]);
        }
        b.iter(|| {
            black_box(graph.render_frame());
        });
    });

    group.finish();
}

// ============================================================================
// Runtime (V8) benchmarks
// ============================================================================

fn runtime_tick(c: &mut Criterion) {
    let mut group = c.benchmark_group("runtime/tick");

    // Empty tick (no JS content, just clock advance + timer processing)
    group.bench_function("empty_frame", |b| {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Mutex::new(
            stage_runtime::storage::Storage::new(&dir.path().join("s.json")).unwrap(),
        ));
        let mut rt = stage_runtime::runtime::Runtime::new(200, 200, 30, store).unwrap();
        b.iter(|| {
            rt.tick();
        });
    });

    // Tick with rAF callback that draws a rect
    group.bench_function("raf_draw_rect", |b| {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Mutex::new(
            stage_runtime::storage::Storage::new(&dir.path().join("s.json")).unwrap(),
        ));
        let mut rt = stage_runtime::runtime::Runtime::new(200, 200, 30, store).unwrap();
        rt.load_js("<bench>", r#"
            var c = document.createElement('canvas');
            var ctx = c.getContext('2d');
            function draw() {
                ctx.fillStyle = '#ff0000';
                ctx.fillRect(0, 0, 200, 200);
                requestAnimationFrame(draw);
            }
            requestAnimationFrame(draw);
        "#).unwrap();
        b.iter(|| {
            rt.tick();
        });
    });

    // Tick with rAF that does Canvas2D path drawing
    group.bench_function("raf_path_scene", |b| {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Mutex::new(
            stage_runtime::storage::Storage::new(&dir.path().join("s.json")).unwrap(),
        ));
        let mut rt = stage_runtime::runtime::Runtime::new(200, 200, 30, store).unwrap();
        rt.load_js("<bench>", r#"
            var c = document.createElement('canvas');
            var ctx = c.getContext('2d');
            var frame = 0;
            function draw() {
                frame++;
                ctx.clearRect(0, 0, 200, 200);
                ctx.beginPath();
                for (var i = 0; i < 10; i++) {
                    var x = 100 + Math.cos(frame * 0.1 + i) * 80;
                    var y = 100 + Math.sin(frame * 0.1 + i) * 80;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.closePath();
                ctx.fillStyle = 'rgba(255,100,0,0.8)';
                ctx.fill();
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 2;
                ctx.stroke();
                requestAnimationFrame(draw);
            }
            requestAnimationFrame(draw);
        "#).unwrap();
        // Warm up
        for _ in 0..5 { rt.tick(); }
        b.iter(|| {
            rt.tick();
        });
    });

    group.finish();
}

fn runtime_evaluate(c: &mut Criterion) {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Mutex::new(
        stage_runtime::storage::Storage::new(&dir.path().join("s.json")).unwrap(),
    ));
    let mut rt = stage_runtime::runtime::Runtime::new(200, 200, 30, store).unwrap();

    c.bench_function("runtime/evaluate_simple", |b| {
        b.iter(|| {
            black_box(rt.evaluate("1 + 2 + 3").unwrap());
        });
    });
}

// ============================================================================
// Encoder benchmarks (feature-gated)
// ============================================================================

#[cfg(feature = "encoder")]
fn encoder_encode_frame(c: &mut Criterion) {
    let mut group = c.benchmark_group("encoder/encode_frame");

    for (label, w, h) in [("64x64", 64u32, 64u32), ("720p", 1280, 720)] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("bench_{}.flv", label));
        let pixels = vec![128u8; (w * h * 4) as usize];

        group.bench_with_input(BenchmarkId::new("video_only", label), &(), |b, _| {
            let mut enc = stage_runtime::encoder::Encoder::new(
                stage_runtime::encoder::EncoderConfig {
                    width: w,
                    height: h,
                    fps: 30,
                    video_codec: "libx264".to_string(),
                    video_bitrate: 2_500_000,
                    audio_bitrate: 128_000,
                    audio_sample_rate: 44100,
                    keyframe_interval: 60,
                    gpu_device_index: 0,
                },
            ).expect("failed to create encoder");
            enc.set_outputs(vec![stage_runtime::encoder::OutputDest {
                name: "bench".to_string(),
                url: format!("file:{}", path.display()),
                watermarked: false,
            }]);

            b.iter(|| {
                enc.encode_frame(black_box(&pixels), None);
            });
        });
    }

    group.finish();
}

// ============================================================================
// Criterion groups
// ============================================================================

#[cfg(not(feature = "encoder"))]
criterion_group!(
    benches,
    canvas2d_process_commands,
    canvas2d_read_pixels_premultiplied,
    canvas2d_full_frame,
    webgl2_process_commands,
    webgl2_full_frame_720p,
    webgl2_read_pixels,
    webgl2_sync_breakdown,
    audio_render_frame,
    runtime_tick,
    runtime_evaluate,
);

#[cfg(feature = "encoder")]
criterion_group!(
    benches,
    canvas2d_process_commands,
    canvas2d_read_pixels_premultiplied,
    canvas2d_full_frame,
    webgl2_process_commands,
    webgl2_full_frame_720p,
    webgl2_read_pixels,
    webgl2_sync_breakdown,
    audio_render_frame,
    runtime_tick,
    runtime_evaluate,
    encoder_encode_frame,
);

criterion_main!(benches);
