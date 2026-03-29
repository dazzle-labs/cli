//! Performance benchmarks for the HTML/CSS renderer.
//!
//! Run: cargo bench --bench htmlcss_bench
//!
//! Measures the full pipeline: HTML parse → CSS cascade → taffy layout → tiny-skia paint.

use criterion::{criterion_group, criterion_main, Criterion, black_box};
use tiny_skia::Pixmap;

const CSS_LAYOUT_HTML: &str = include_str!("../tests/htmlcss_fixtures/css_layout.html");

const SIMPLE_HTML: &str = r#"<!DOCTYPE html>
<html>
<head><style>
body { background: #1a1a2e; color: white; font-family: sans-serif; }
</style></head>
<body>
<div>Hello, world!</div>
</body>
</html>"#;

const GRID_HTML: &str = r#"<!DOCTYPE html>
<html>
<head><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1a1a2e; font-family: sans-serif; color: white; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; padding: 16px; }
.card {
  background: linear-gradient(135deg, #16213e, #0f3460);
  border-radius: 8px; padding: 16px;
  border: 1px solid rgba(255,255,255,0.1);
}
.card h3 { font-size: 14px; margin-bottom: 8px; color: #e94560; }
.card p { font-size: 12px; opacity: 0.7; line-height: 1.4; }
.bar { height: 4px; background: #e94560; border-radius: 2px; margin-top: 8px; }
</style></head>
<body>
<div class="grid">
  <div class="card"><h3>Alpha</h3><p>First card content</p><div class="bar" style="width:80%"></div></div>
  <div class="card"><h3>Beta</h3><p>Second card</p><div class="bar" style="width:60%"></div></div>
  <div class="card"><h3>Gamma</h3><p>Third card</p><div class="bar" style="width:90%"></div></div>
  <div class="card"><h3>Delta</h3><p>Fourth card</p><div class="bar" style="width:45%"></div></div>
  <div class="card"><h3>Epsilon</h3><p>Fifth card</p><div class="bar" style="width:70%"></div></div>
  <div class="card"><h3>Zeta</h3><p>Sixth card</p><div class="bar" style="width:55%"></div></div>
  <div class="card"><h3>Eta</h3><p>Seventh card</p><div class="bar" style="width:85%"></div></div>
  <div class="card"><h3>Theta</h3><p>Eighth card</p><div class="bar" style="width:65%"></div></div>
</div>
</body>
</html>"#;

fn bench_htmlcss(c: &mut Criterion) {
    let mut group = c.benchmark_group("htmlcss");

    // --- Simple page ---
    group.bench_function("simple_720p", |b| {
        b.iter(|| {
            let mut pixmap = Pixmap::new(1280, 720).unwrap();
            stage_runtime::htmlcss::render_html(black_box(SIMPLE_HTML), &mut pixmap);
            black_box(&pixmap);
        });
    });

    // --- Grid layout (8 cards, gradients, borders) ---
    group.bench_function("grid_8cards_720p", |b| {
        b.iter(|| {
            let mut pixmap = Pixmap::new(1280, 720).unwrap();
            stage_runtime::htmlcss::render_html(black_box(GRID_HTML), &mut pixmap);
            black_box(&pixmap);
        });
    });

    // --- CSS layout fixture from servo benches ---
    group.bench_function("css_layout_fixture_720p", |b| {
        b.iter(|| {
            let mut pixmap = Pixmap::new(1280, 720).unwrap();
            stage_runtime::htmlcss::render_html(black_box(CSS_LAYOUT_HTML), &mut pixmap);
            black_box(&pixmap);
        });
    });

    // --- Pixmap reuse (render to same pixmap, measures incremental cost) ---
    group.bench_function("grid_8cards_reuse_720p", |b| {
        let mut pixmap = Pixmap::new(1280, 720).unwrap();
        b.iter(|| {
            pixmap.fill(tiny_skia::Color::TRANSPARENT);
            stage_runtime::htmlcss::render_html(black_box(GRID_HTML), &mut pixmap);
            black_box(&pixmap);
        });
    });

    group.finish();
}

criterion_group!(benches, bench_htmlcss);
criterion_main!(benches);
