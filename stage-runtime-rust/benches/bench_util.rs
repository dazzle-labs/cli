//! Shared utilities for stage-runtime benchmarks.

use std::path::Path;

pub fn load_webgl2_scenes() -> serde_json::Value {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/webgl2_fixtures/scenes.json");
    serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap()
}

pub fn percentile(sorted: &[f64], p: f64) -> f64 {
    let idx = ((p / 100.0) * sorted.len() as f64).ceil() as usize;
    sorted[idx.saturating_sub(1).min(sorted.len() - 1)]
}

pub fn fmt_us(us: f64) -> String {
    if us < 1000.0 {
        format!("{:.0}µs", us)
    } else {
        format!("{:.2}ms", us / 1000.0)
    }
}
