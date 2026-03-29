---
name: stage-runtime-dev-workflow
description: "Development workflow for stage-runtime Rust stage runtime. Use when starting work in stage-runtime/, adding rendering features, or running tests/benchmarks."
user-invocable: false
---

# stage-runtime Development Workflow

## When to Use
- Starting any work in `stage-runtime/`
- Adding new rendering features (Canvas2D, HTML/CSS, WebGL2, Audio)
- Running tests, benchmarks, or debugging visual regressions

## Build & Test

All commands run from `stage-runtime/`. Run `make help` for all targets.

Two feature flags matter: `v8-runtime` (default, enables rendering) and `encoder` (requires ffmpeg dev headers — `brew install ffmpeg` on macOS).

### Quick commands

```bash
make test              # All tests (excludes encoder, GPU-optional)
make test-all          # All tests including encoder
make test-canvas2d     # Canvas2D reference + unit tests
make test-htmlcss      # HTML/CSS reference + mixed tests
make test-webgl2       # WebGL2 reference + unit + shader tests (requires GPU)
make test-audio        # Audio reference + e2e + offline tests
make test-encoder      # Encoder round-trip tests (requires ffmpeg)
make test-props        # Property-based tests (proptest)
make test-fuzz         # Fuzz tests (shader + WebGL2 context)
make test-e2e          # Framework e2e tests (Three.js, p5, GSAP, D3, Tone patterns)
make test-adversarial  # Adversarial review regression tests
make scene NAME=xxx    # Run a single reference scene by name
```

### Test categories (762+ total)

| Category | Tests | Command | What it validates |
|----------|------:|---------|-------------------|
| **Canvas2D reference** | 85 | `make test-canvas2d` | Pixel comparison vs Chrome-generated truth PNGs (paths, gradients, compositing, text, shadows, patterns) |
| **WebGL2 reference** | 63 | `make test-webgl2` | Pixel comparison vs Chrome (shaders, textures, FBOs, instanced draw, blend modes) |
| **HTML/CSS reference** | 72 | `make test-htmlcss` | Pixel comparison vs Chrome (flex/grid layout, transforms, backgrounds, borders, text) |
| **Audio reference** | 67 | `make test-audio` | PCM waveform comparison vs Chrome Web Audio API (oscillators, filters, gain, compressor, panning) |
| **Property-based** | 80 | `make test-props` | Proptest: Canvas2D state machine, WebGL2 state, transforms, colors, timers, classList, AudioParam scheduling |
| **Fuzz** | — | `make test-fuzz` | Random shader inputs, random WebGL2 command sequences — must not panic |
| **Browser gaps** | 108 | `make test-e2e` + `make test-adversarial` | CSS var(), calc(), backdrop-filter, Workers, IndexedDB, SVG, animations, framework patterns |
| **Encoder** | ~10 | `make test-encoder` | FLV round-trip, multi-output diffing, watermark filter (requires ffmpeg) |
| **Lib unit** | 160 | `cargo test --lib` | Internal unit tests across all modules |

### Benchmarks

```bash
make bench             # All render benchmarks (Canvas2D, WebGL2, HTML/CSS)
make bench-e2e         # Full pipeline: render + composite + encode → FLV (requires ffmpeg)
make bench-percentile  # WebGL2 p50/p90/p95/p99 stats (for Chrome comparison)
make bench-render      # Criterion: Canvas2D + WebGL2 microbenchmarks
make bench-htmlcss     # Criterion: HTML/CSS layout + paint benchmarks
```

### Chrome comparison bench

To get fair side-by-side numbers (same machine, same session):

```bash
# 1. Run stage-runtime bench
make bench-percentile

# 2. Run Chrome bench (requires Puppeteer: cd tests/webgl2_fixtures && npm install)
cd tests/webgl2_fixtures && node bench_chrome.cjs --mode readback --frames 500
```

Both output the same format: p50/p90/p95/p99/min/max per scene at 1280×720 with full `readPixels` readback.

### Fixture regeneration

When Chrome's rendering changes or you add new scenes:

```bash
make fixtures            # Regenerate ALL Chrome reference images
make fixtures-canvas2d   # Canvas2D only
make fixtures-htmlcss    # HTML/CSS only
make fixtures-webgl2     # WebGL2 only
make fixtures-audio      # Audio reference data
```

Requires Puppeteer (`npm install puppeteer` in the fixture directory).

### Visual debugging

Save every rendered frame as PNG for inspection:

```bash
make test-save           # All reference tests → save PNGs
make test-save-canvas2d  # Canvas2D only
make test-save-htmlcss   # HTML/CSS only
make test-save-webgl2    # WebGL2 only
SAVE_ALL=1 make scene NAME=xxx  # Single scene
```

## Feature Development Cycle

The proven pattern for adding a new rendering feature:

1. **Scaffold** — Stub the API, return no-ops. Ensure it compiles.
2. **Add Chrome reference scenes** — Define scenes in `scenes.json`, add the name to the `ref_scenes!` macro in the test file, run `make fixtures` to generate truth PNGs. Tests will fail (red).
3. **Implement** — Make tests pass (green). Use `make scene NAME=xxx` to iterate on individual scenes.
4. **Adversarial review** — Run `/adversarial-review` to find security issues, correctness bugs, and edge cases. Fix in rounds.
5. **Property tests** — Add proptest cases for the new code paths, especially edge cases found during adversarial review.
6. **Benchmark** — Add or update criterion benchmarks. Verify no regressions.

## Pitfalls

- **WebGL2 tests abort without a GPU.** Set `DAZZLE_SKIP_GPU_TESTS=1` on headless/CI systems, or the test runner dies (not just fails).
- **Premultiplied alpha mismatch.** Chrome screenshots are straight RGBA; tiny-skia is premultiplied. The HTML/CSS reference test has `unpremultiply()`. Canvas2D's `read_pixels` returns straight RGBA directly. Mixing these up causes subtle RMSE drift.
- **RMSE thresholds are per-scene.** Defaults differ by subsystem (Canvas2D: 0.01, HTML/CSS: 0.02, WebGL2: 0.01). Scenes can override via `threshold` in `scenes.json`. Don't globally raise thresholds — fix the renderer.
- **Fixture regeneration requires Puppeteer.** `npm install puppeteer` in the fixture directory if missing.
- **Encoder tests require ffmpeg.** `brew install ffmpeg` on macOS, or use `--features encoder` flag.
