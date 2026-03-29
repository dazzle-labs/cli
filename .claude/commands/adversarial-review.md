Perform an adversarial security and correctness review of the specified code (default: outstanding PR diff against main).

## Approach

Spawn parallel review agents, one per module/subsystem. Each agent reads the source files and reports findings as a numbered list with severity (CRITICAL/HIGH/MEDIUM/LOW) and file:line references. Do NOT write code during the review phase.

After all agents complete, compile a deduplicated table of findings ranked by severity. Then ask whether to fix.

## What to look for

### Memory safety (Rust-specific)
- `unsafe` blocks: raw pointer dereference, `from_raw_parts`, `copy_nonoverlapping` — verify invariants, check for safe alternatives (bytemuck, zerocopy)
- Mutable aliasing: two `&mut` references to the same data, especially in V8 native callbacks via External pointers
- Integer overflow in allocation sizes: `width * height * 4` in u32 before cast to usize — use usize arithmetic or checked_mul
- Buffer sizing: ensure allocated buffer matches the size actually written

### Resource exhaustion
- Unbounded Vec/HashMap growth from user-controlled input (JS arrays, audio commands, fetch requests, timers, textures, buffers)
- Missing aggregate memory caps (individual limits aren't enough if you can create 1000 objects at max size)
- Console/log buffers capped by count but not by total byte size
- Arrays that are appended to but never truncated (check drain patterns match push patterns)

### SSRF / path traversal
- Any code path that fetches URLs from user content: `fetch_url`, `@font-face src: url()`, `<script src="">`, WebSocket connect
- DNS pinning: resolve once, check for private IPs, pin the resolved address — but also check Host header routing
- Path traversal: `..` rejection is necessary but not sufficient — must also canonicalize to catch symlink escapes, including for non-existing files (canonicalize the parent)
- TOCTOU: gap between path validation and file access

### Encoder / output security
- URL scheme validation for output destinations (ffmpeg can write to arbitrary file:// paths)
- Suffix-based checks are bypassable: `file:///etc/cron.d/evil.flv` ends with `.flv`
- Validate scheme explicitly, not just suffix

### JS polyfill sandbox (V8 isolate)
- `eval()` / `new Function()` in polyfills — runs in same global scope
- Mutable `__dz_*` bindings that user JS can replace with Proxies to intercept bridge calls
- Prototype pollution on unfrozen polyfill prototypes
- Resource limits: timer count, rAF count, event listener count, fetch/WS/image request count, audio node count

### WebGL2 / GPU state machine
- ID wraparound after ~4B allocations (wrapping_add on u32)
- Heuristic-based type detection (e.g., inferring u16 vs u32 from buffer length % 4 — fragile)
- Missing aggregate texture memory cap (individual dimension cap is not enough)
- Stub methods that hardcode return values (getActiveUniform always returning GL_FLOAT breaks Three.js)
- Pipeline/shader cache eviction order (HashMap iteration is non-deterministic)

### Canvas2D / paint
- Pixmap allocation from user-controlled dimensions — clamp before u32 cast to prevent OOM
- Box shadow spread/blur values flowing into u32 arithmetic — can overflow
- NaN/Infinity propagation through f64→f32 casts in transform matrices
- Image data cloned per draw call (performance DoS with large images in loops)

### Audio
- Unbounded curve/value arrays from JS commands
- f64→u64 cast for node IDs (NaN/Infinity → 0 or u64::MAX)
- O(N²) rendering if the graph re-renders from t=0 every frame
- Odd-length buffer panics in compressor code

### Error handling
- `assert!` / `expect()` / `unwrap()` in library APIs — should return Result
- Panics in hot paths (encoder, V8 callbacks) crash the process
- Mutex poisoning: `.lock().unwrap()` panics if a previous thread panicked while holding the lock

## Output format

Present findings in a markdown table:

| # | Severity | Module | Location | Issue |
|---|----------|--------|----------|-------|

Then group "must fix before merge" vs "should fix" vs "not a blocker" with rationale.
