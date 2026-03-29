//! Raw percentile benchmark for Chrome comparison.
//! Outputs p50/p90/p95/p99/min/max for each scene — same format as bench_chrome.cjs.
//!
//! Run: cargo bench --bench percentile_bench

use serde_json::json;
use std::path::Path;
use std::time::Instant;

const WARMUP: usize = 50;
const SAMPLES: usize = 500;

fn load_webgl2_scenes() -> serde_json::Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/webgl2_fixtures/scenes.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
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

fn main() {
    let scenes = load_webgl2_scenes();
    let bench_scenes = [
        ("bench_terrain_lit", "terrain_lit"),
        ("bench_cubes_lit_25", "cubes_lit_25"),
        ("bench_raymarched_spheres", "raymarched"),
        ("bench_particles_256", "particles_256"),
        ("bench_normal_perturb", "normal_perturb"),
    ];

    let w: u32 = 1280;
    let h: u32 = 720;

    println!();
    println!("stage-runtime WebGL2 Benchmark — {}x{}, {} samples (RGBA readback)", w, h, SAMPLES);
    println!("{}", "─".repeat(100));
    println!(
        "{:<22} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8}",
        "Scene", "p50", "p90", "p95", "p99", "min", "max", "FPS(p50)"
    );
    println!("{}", "─".repeat(100));

    for (scene_key, label) in bench_scenes {
        let cmds = &scenes["scenes"][scene_key]["commands"];
        let patched: serde_json::Value = cmds
            .as_array()
            .unwrap()
            .iter()
            .map(|cmd| {
                let arr = cmd.as_array().unwrap();
                if arr[0].as_str() == Some("viewport") {
                    json!(["viewport", 0, 0, w, h])
                } else {
                    cmd.clone()
                }
            })
            .collect::<Vec<_>>()
            .into();

        let mut gl = stage_runtime::webgl2::WebGL2::new(w, h);
        let mut output = vec![0u8; (w * h * 4) as usize];

        // Warmup
        for _ in 0..WARMUP {
            gl.process_commands(&patched);
            gl.read_pixels_premultiplied(&mut output);
        }

        // Collect samples
        let mut times_us = Vec::with_capacity(SAMPLES);
        for _ in 0..SAMPLES {
            let t0 = Instant::now();
            gl.process_commands(&patched);
            gl.read_pixels_premultiplied(&mut output);
            times_us.push(t0.elapsed().as_nanos() as f64 / 1000.0);
        }

        times_us.sort_by(|a, b| a.partial_cmp(b).unwrap());

        let p50 = percentile(&times_us, 50.0);
        let p90 = percentile(&times_us, 90.0);
        let p95 = percentile(&times_us, 95.0);
        let p99 = percentile(&times_us, 99.0);
        let min = times_us[0];
        let max = times_us[times_us.len() - 1];
        let fps = 1_000_000.0 / p50;

        println!(
            "{:<22} {:>8} {:>8} {:>8} {:>8} {:>8} {:>8} {:>7.0}",
            label,
            fmt_us(p50),
            fmt_us(p90),
            fmt_us(p95),
            fmt_us(p99),
            fmt_us(min),
            fmt_us(max),
            fps,
        );
    }

    // NV12 compute + readback path — requires GPU backend + nv12_convert module.
    // Stubbed out until the NV12 converter is implemented.
    println!();
    println!("NV12 benchmark skipped — nv12_convert module not yet implemented");

    println!("{}", "─".repeat(100));
    println!();
}
