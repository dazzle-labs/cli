mod globals;

pub use globals::POLYFILLS_JS;

use anyhow::{anyhow, Result};
use log::{error, info, warn};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Once};

use crate::audio::{self, AudioGraph};
use crate::canvas2d::{self, Canvas2D};
use crate::htmlcss;
use crate::storage::Storage;
use crate::webgl2::{self, WebGL2};

static V8_INIT: Once = Once::new();

/// Initialize the V8 platform. Must be called once before creating any isolate.
pub fn init_v8() {
    V8_INIT.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

/// Result of a completed network fetch, sent from background thread to tick loop.
struct FetchResult {
    id: u32,
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
    error: Option<String>,
}

/// WebSocket event sent from background thread to tick loop.
enum WsEvent {
    Opened { id: u32 },
    Message { id: u32, data: String },
    Closed { id: u32, code: u16, reason: String, was_clean: bool },
    Error { id: u32, message: String },
}

/// Maximum concurrent background threads for fetch + WebSocket combined.
const MAX_BACKGROUND_THREADS: usize = 32;

/// Maximum time (seconds) a single JS execution (eval, timer, rAF) may run before
/// the watchdog terminates it. Prevents `while(true){}` from freezing the process.
const JS_EXECUTION_TIMEOUT_SECS: u64 = 5;

/// Watchdog that terminates V8 execution if a script runs too long.
/// The watchdog thread sleeps until `arm()` is called; `disarm()` cancels.
pub struct ExecutionWatchdog {
    armed: Arc<AtomicBool>,
    _isolate_handle: v8::IsolateHandle,
    notify: Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
}

impl ExecutionWatchdog {
    pub fn new(isolate_handle: v8::IsolateHandle) -> Self {
        let armed = Arc::new(AtomicBool::new(false));
        let notify = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));

        // Single persistent watchdog thread — no per-frame thread spawn
        let armed_clone = Arc::clone(&armed);
        let notify_clone = Arc::clone(&notify);
        let handle = isolate_handle.clone();
        std::thread::Builder::new().name("v8-watchdog".into()).spawn(move || {
            loop {
                // Wait until armed
                {
                    let (lock, cvar) = &*notify_clone;
                    let mut signaled = lock.lock().unwrap();
                    while !*signaled {
                        signaled = cvar.wait(signaled).unwrap();
                    }
                    *signaled = false;
                }

                // Sleep in small increments so we can check if disarmed early
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(JS_EXECUTION_TIMEOUT_SECS);
                while std::time::Instant::now() < deadline {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    if !armed_clone.load(Ordering::SeqCst) {
                        break; // disarmed — script finished in time
                    }
                }
                if armed_clone.load(Ordering::SeqCst) {
                    warn!("V8 execution timeout ({}s) — terminating script", JS_EXECUTION_TIMEOUT_SECS);
                    handle.terminate_execution();
                }
            }
        }).expect("failed to spawn watchdog thread");

        Self { armed, _isolate_handle: isolate_handle, notify }
    }

    /// Arm the watchdog. If not disarmed within the timeout, V8 execution is terminated.
    pub fn arm(&self) {
        self.armed.store(true, Ordering::SeqCst);
        let (lock, cvar) = &*self.notify;
        let mut signaled = lock.lock().unwrap();
        *signaled = true;
        cvar.notify_one();
    }

    /// Disarm the watchdog — script finished normally.
    pub fn disarm(&self) {
        self.armed.store(false, Ordering::SeqCst);
    }
}

/// Global counter for active background threads (fetch + WebSocket).
static ACTIVE_BACKGROUND_THREADS: AtomicUsize = AtomicUsize::new(0);

/// Resolve a URL path safely within content_dir, preventing directory traversal.
/// Returns `None` if the resolved path escapes the content directory.
fn safe_content_path(content_dir: &Path, url: &str) -> Option<PathBuf> {
    // Delegate to the canonical implementation in content::loader which handles
    // symlink escapes for non-existing files via parent canonicalization.
    crate::content::loader::safe_content_path_pub(content_dir, url)
}

/// Check if a URL host resolves to a private/loopback/link-local address.
/// Returns true if the host should be blocked (SSRF protection).
fn is_private_host(url: &str) -> bool {
    crate::content::resolve_and_check_url(url).is_err()
}

/// Maximum string length we'll pass to v8::String::new() for untrusted data.
/// V8 has an internal limit (~512MB) but we cap at 64MB to avoid excessive allocation.
const MAX_V8_STRING_LEN: usize = 64 * 1024 * 1024;

/// Create a V8 string from untrusted data, truncating if too large.
/// Returns empty string on failure rather than panicking.
macro_rules! v8_str_safe {
    ($scope:expr, $s:expr) => {{
        let s: &str = $s;
        let safe = if s.len() > MAX_V8_STRING_LEN {
            let mut end = MAX_V8_STRING_LEN;
            while end > 0 && !s.is_char_boundary(end) { end -= 1; }
            &s[..end]
        } else { s };
        v8::String::new($scope, safe).unwrap_or_else(|| v8::String::empty($scope))
    }};
}

/// Non-V8 renderer state: framebuffer, timing, storage.
pub struct RendererState {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub frame_count: u64,
    pub virtual_time_ms: f64,
    pub store: Arc<Mutex<Storage>>,
    /// RGBA pixel buffer — the current framebuffer
    pub framebuffer: Vec<u8>,
    /// Actual measured FPS (updated every second)
    pub actual_fps: f64,
    frames_this_second: u64,
    last_fps_update: std::time::Instant,
    /// Canvas 2D renderer (heap-allocated for stable pointer used by native V8 callbacks)
    pub canvas2d: Box<Canvas2D>,
    /// WebGL2 renderer (heap-allocated for stable pointer used by native V8 callbacks)
    pub webgl2: Box<WebGL2>,
    /// Audio graph — renders PCM audio in lockstep with video frames
    pub audio: AudioGraph,
    /// Last rendered audio frame (interleaved stereo f32)
    pub audio_frame: Vec<f32>,
    /// Pre-rendered HTML/CSS background
    pub html_background: Option<tiny_skia::Pixmap>,
    /// Cached HTML source for re-rendering when DOM is dirty
    pub html_source: Option<String>,
    /// Persistent DOM for incremental style mutations (Phase 1).
    /// Bootstrapped after the initial HTML render.
    pub persistent_dom: Option<crate::htmlcss::incremental::PersistentDom>,
    /// Content directory for resolving image paths
    pub content_dir: Option<std::path::PathBuf>,
    /// Box-allocated content_dir for pointer stability in V8 native callbacks.
    /// Updated whenever content_dir changes.
    pub content_dir_box: Box<std::sync::Mutex<Option<std::path::PathBuf>>>,
    /// Pending image onload callbacks: (id, width, height)
    pending_image_callbacks: Vec<(u32, u32, u32)>,
    /// Pending image onerror callbacks: [id, ...]
    pending_image_errors: Vec<u32>,
    /// Console log buffer — native callbacks write here, drain_console_logs reads.
    /// Heap-allocated (Box) for stable pointer used by native V8 console callbacks.
    console_buffer: Box<Vec<ConsoleEntry>>,
    /// Completed network fetch results — populated by background threads, drained each tick.
    fetch_results: Vec<FetchResult>,
    /// Receiver for completed network fetches from background threads.
    fetch_rx: std::sync::mpsc::Receiver<FetchResult>,
    /// Sender cloned into background fetch threads.
    fetch_tx: std::sync::mpsc::Sender<FetchResult>,
    /// Receiver for WebSocket events from background connection threads.
    ws_rx: std::sync::mpsc::Receiver<WsEvent>,
    /// Sender cloned into WebSocket background threads.
    ws_tx: std::sync::mpsc::SyncSender<WsEvent>,
    /// Senders for outgoing WebSocket messages (id → sender).
    ws_outgoing: std::collections::HashMap<u32, std::sync::mpsc::Sender<String>>,
    /// Active fetch IDs dispatched to background threads — used to validate results
    /// and prevent user JS from injecting crafted objects into __dz_fetch_requests.
    active_fetch_ids: std::collections::HashSet<u32>,
    /// Active WebSocket connection IDs — used to validate ws request IDs.
    active_ws_ids: std::collections::HashSet<u32>,
    /// Video encoder (RGBA → H.264, active when outputs are configured)
    pub encoder: crate::encoder::Encoder,
    /// V8 execution timeout watchdog — terminates runaway scripts.
    pub watchdog: Option<ExecutionWatchdog>,
    /// True once an AnalyserNode has been created — gates per-frame audio sample push.
    pub has_analyser_node: bool,
}

impl RendererState {
    pub fn new(width: u32, height: u32, fps: u32, store: Arc<Mutex<Storage>>) -> Self {
        Self::with_codec(width, height, fps, store, "libx264", 0)
    }

    pub fn with_codec(
        width: u32, height: u32, fps: u32,
        store: Arc<Mutex<Storage>>,
        _video_codec: &str, _gpu_device_index: u32,
    ) -> Self {
        let audio = AudioGraph::new(44100, fps);
        let audio_frame_len = audio.samples_per_frame() * 2; // stereo
        let (fetch_tx, fetch_rx) = std::sync::mpsc::channel();
        let (ws_tx, ws_rx) = std::sync::mpsc::sync_channel(1000);
        RendererState {
            width,
            height,
            fps,
            frame_count: 0,
            virtual_time_ms: 0.0,
            store,
            framebuffer: vec![0u8; (width as usize)
                .checked_mul(height as usize)
                .and_then(|n| n.checked_mul(4))
                .expect("framebuffer dimensions overflow")],
            actual_fps: fps as f64,
            frames_this_second: 0,
            last_fps_update: std::time::Instant::now(),
            canvas2d: Box::new(Canvas2D::new(width, height)),
            webgl2: Box::new(WebGL2::new(width, height)),
            audio,
            audio_frame: vec![0.0f32; audio_frame_len],
            html_background: None,
            html_source: None,
            persistent_dom: None,
            content_dir: None,
            content_dir_box: Box::new(std::sync::Mutex::new(None)),
            pending_image_callbacks: Vec::new(),
            pending_image_errors: Vec::new(),
            console_buffer: Box::new(Vec::new()),
            fetch_results: Vec::new(),
            fetch_rx,
            fetch_tx,
            ws_rx,
            ws_tx,
            ws_outgoing: std::collections::HashMap::new(),
            active_fetch_ids: std::collections::HashSet::new(),
            active_ws_ids: std::collections::HashSet::new(),
            encoder: crate::encoder::Encoder::new(crate::encoder::EncoderConfig {
                width,
                height,
                fps,
                video_codec: _video_codec.to_string(),
                video_bitrate: 2_500_000,
                audio_bitrate: 128_000,
                audio_sample_rate: 44100,
                keyframe_interval: fps * 2,
                gpu_device_index: _gpu_device_index,
            }).expect("failed to create encoder"),
            watchdog: None,
            has_analyser_node: false,
        }
    }

    /// Set the V8 execution watchdog (call after creating the isolate).
    pub fn set_watchdog(&mut self, handle: v8::IsolateHandle) {
        self.watchdog = Some(ExecutionWatchdog::new(handle));
    }

    #[allow(dead_code)]
    pub fn reset(&mut self) {
        self.frame_count = 0;
        self.virtual_time_ms = 0.0;
        self.framebuffer.fill(0);
        self.console_buffer.clear();
    }

    /// Render HTML/CSS content to the background pixmap.
    /// This is painted as the base layer before Canvas2D/WebGL2.
    pub fn render_html_background(&mut self, html: &str) {
        let mut pixmap = tiny_skia::Pixmap::new(self.width, self.height)
            .expect("failed to create HTML background pixmap");
        htmlcss::render_html(html, &mut pixmap);
        self.html_background = Some(pixmap);
        self.html_source = Some(html.to_string());
        info!("HTML/CSS background rendered ({}x{})", self.width, self.height);
    }

    /// Render HTML/CSS with a content directory for @font-face resolution.
    pub fn render_html_background_with_dir(&mut self, html: &str, content_dir: &std::path::Path) {
        let mut pixmap = tiny_skia::Pixmap::new(self.width, self.height)
            .expect("failed to create HTML background pixmap");
        htmlcss::render_html_with_dir(html, &mut pixmap, content_dir);
        self.html_background = Some(pixmap);
        self.html_source = Some(html.to_string());
        info!("HTML/CSS background rendered ({}x{})", self.width, self.height);
    }

    /// Return an opaque RGB framebuffer composited onto white (for screenshots).
    ///
    /// The internal framebuffer is premultiplied RGBA. For screenshots, we
    /// composite onto white and output opaque pixels — no unpremultiply needed.
    /// Formula: out = premul_color + (255 - alpha) [i.e. white × (1 - alpha)]
    pub fn get_framebuffer_for_screenshot(&self) -> Vec<u8> {
        let src = &self.framebuffer;
        let mut out = vec![255u8; src.len()];
        for (s, d) in src.chunks_exact(4).zip(out.chunks_exact_mut(4)) {
            let a = s[3];
            if a == 255 {
                d[0] = s[0];
                d[1] = s[1];
                d[2] = s[2];
            } else if a > 0 {
                let inv_a = 255 - a as u16;
                d[0] = (s[0] as u16 + inv_a).min(255) as u8;
                d[1] = (s[1] as u16 + inv_a).min(255) as u8;
                d[2] = (s[2] as u16 + inv_a).min(255) as u8;
            }
            // a == 0: d stays [255, 255, 255, 255] (white)
            d[3] = 255;
        }
        out
    }
}

// Re-export shared types so existing code continues to work.
pub use crate::runtime_common::{ConsoleEntry, FramePacer};

/// Initialize browser globals in the V8 context.
pub fn init_globals(scope: &mut v8::PinScope, state: &mut RendererState) -> Result<()> {
    // Register native console before polyfills — polyfills use console.error in catch blocks.
    // console_buffer is Box<Vec> so the heap pointer is stable across RendererState moves.
    register_native_console(scope, &mut state.console_buffer);

    // Run polyfills
    eval_script(scope, "<polyfills>", POLYFILLS_JS)?;

    // Set dimensions
    let dim_js = format!(
        "window.innerWidth = {}; window.innerHeight = {}; \
         if (window.screen) {{ window.screen.width = {}; window.screen.height = {}; \
         window.screen.availWidth = {}; window.screen.availHeight = {}; }}",
        state.width, state.height, state.width, state.height, state.width, state.height
    );
    eval_script(scope, "<dimensions>", &dim_js)?;

    // Initialize dazzle.storage and localStorage from Rust Storage.
    // Keys use namespace prefixes: "ls:" for localStorage, "dz:" for dazzle.storage.
    // Migration: unprefixed keys are treated as ls: (string) or dz: (non-string).
    let mut storage_js = String::from(
        "globalThis.dazzle = globalThis.dazzle || {};\n\
         globalThis.dazzle.storage = {\n\
           _data: {},\n\
           get: function(key) { return this._data[key]; },\n\
           set: function(key, value) { this._data[key] = value; },\n\
         };\n"
    );
    let mut ls_js = String::new();
    if let Ok(store) = state.store.lock() {
        let has_prefixed = store.has_prefix("ls:") || store.has_prefix("dz:");
        for (key, value) in store.entries() {
            if let Some(stripped) = key.strip_prefix("dz:") {
                // dazzle.storage entry
                storage_js.push_str(&format!(
                    "dazzle.storage._data[{}] = {};\n",
                    serde_json::to_string(stripped).unwrap_or_else(|_| "\"\"".to_string()),
                    serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
                ));
            } else if let Some(stripped) = key.strip_prefix("ls:") {
                // localStorage entry
                if let serde_json::Value::String(s) = value {
                    ls_js.push_str(&format!(
                        "globalThis.__dz_localstorage_data[{}] = {};\n",
                        serde_json::to_string(stripped).unwrap_or_default(),
                        serde_json::to_string(s).unwrap_or_default(),
                    ));
                }
            } else if !has_prefixed {
                // Migration: unprefixed keys from old storage format
                if let serde_json::Value::String(s) = value {
                    ls_js.push_str(&format!(
                        "globalThis.__dz_localstorage_data[{}] = {};\n",
                        serde_json::to_string(key).unwrap_or_default(),
                        serde_json::to_string(s).unwrap_or_default(),
                    ));
                } else {
                    storage_js.push_str(&format!(
                        "dazzle.storage._data[{}] = {};\n",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string()),
                        serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()),
                    ));
                }
            }
        }
    }
    eval_script(scope, "<storage>", &storage_js)?;
    if !ls_js.is_empty() {
        eval_script(scope, "<ls-restore>", &ls_js)?;
    }

    // Register canvas2d native bindings before evaluating canvas2d.js
    // (canvas2d.js references __dz_canvas_cmd at load time).
    // canvas2d is Box<Canvas2D> so the heap pointer is stable across RendererState moves.
    register_canvas_cmd(scope, &mut state.canvas2d);
    register_canvas_put_image_data(scope, &mut state.canvas2d);
    register_measure_text(scope);

    // Initialize Canvas 2D and WebGL2 JS polyfills
    eval_script(scope, "<canvas2d>", canvas2d::CANVAS2D_JS)?;
    eval_script(scope, "<webgl2>", webgl2::WEBGL2_JS)?;
    eval_script(scope, "<audio>", audio::AUDIO_JS)?;

    // Freeze all __dz_* internals and browser globals AFTER all polyfill scripts
    // have registered their reset hooks. This prevents user JS from mutating
    // internal bridges (e.g., __dz_raf.process = function(){}).
    eval_script(scope, "<freeze>", "__dz_freeze_internals();")?;

    info!("Browser globals initialized");
    Ok(())
}

/// Evaluate a JS script in the current context.
pub fn eval_script(scope: &mut v8::PinScope, name: &str, source_code: &str) -> Result<()> {
    let source = v8::String::new(scope, source_code)
        .ok_or_else(|| anyhow!("Failed to create V8 string for {}", name))?;

    let name_str = v8::String::new(scope, name).unwrap();
    let origin = v8::ScriptOrigin::new(
        scope, name_str.into(), 0, 0, false, 0, None, false, false, false, None,
    );

    v8::tc_scope!(let tc, scope);

    let script = v8::Script::compile(tc, source, Some(&origin));
    match script {
        Some(script) => {
            if script.run(tc).is_none() {
                if let Some(exception) = tc.exception() {
                    let msg = exception.to_string(tc)
                        .unwrap()
                        .to_rust_string_lossy(tc);
                    error!("JS error in {}: {}", name, msg);
                    return Err(anyhow!("JS error in {}: {}", name, msg));
                }
            }
            Ok(())
        }
        None => {
            if let Some(exception) = tc.exception() {
                let msg = exception.to_string(tc)
                    .unwrap()
                    .to_rust_string_lossy(tc);
                error!("Compile error in {}: {}", name, msg);
                Err(anyhow!("Compile error in {}: {}", name, msg))
            } else {
                Err(anyhow!("Failed to compile {}", name))
            }
        }
    }
}

/// Evaluate a JS expression and return a CDP-formatted result.
pub fn eval_for_cdp(scope: &mut v8::PinScope, expression: &str, return_by_value: bool) -> Result<serde_json::Value> {
    let source = v8::String::new(scope, expression)
        .ok_or_else(|| anyhow!("Failed to create V8 string"))?;

    v8::tc_scope!(let tc, scope);

    match v8::Script::compile(tc, source, None) {
        Some(script) => {
            match script.run(tc) {
                Some(result) => {
                    Ok(v8_value_to_cdp(tc, result, return_by_value))
                }
                None => {
                    if let Some(exception) = tc.exception() {
                        let msg = exception.to_string(tc)
                            .unwrap()
                            .to_rust_string_lossy(tc);
                        Err(anyhow!("{}", msg))
                    } else {
                        Err(anyhow!("Script execution failed"))
                    }
                }
            }
        }
        None => {
            if let Some(exception) = tc.exception() {
                let msg = exception.to_string(tc)
                    .unwrap()
                    .to_rust_string_lossy(tc);
                Err(anyhow!("{}", msg))
            } else {
                Err(anyhow!("Script compilation failed"))
            }
        }
    }
}

/// Run one frame: advance clock, fire timers, call rAF callbacks, drain microtasks.
pub fn tick_frame(scope: &mut v8::PinScope, state: &mut RendererState) {
    let frame_duration_ms = 1000.0 / state.fps as f64;
    state.virtual_time_ms += frame_duration_ms;
    state.frame_count += 1;
    state.frames_this_second += 1;

    // Measure actual FPS every second
    let elapsed = state.last_fps_update.elapsed();
    if elapsed >= std::time::Duration::from_secs(1) {
        state.actual_fps = state.frames_this_second as f64 / elapsed.as_secs_f64();
        state.frames_this_second = 0;
        state.last_fps_update = std::time::Instant::now();
    }

    // Arm the execution watchdog before running any user JS.
    // If user code runs longer than the timeout, V8 is terminated to prevent freezes.
    if let Some(ref wd) = state.watchdog { wd.arm(); }

    // Fire pending image onload/onerror callbacks before user JS runs.
    // Direct V8 Function::call() — no eval_script string building/parsing.
    if !state.pending_image_callbacks.is_empty() || !state.pending_image_errors.is_empty() {
        fire_image_callbacks(scope, state);
    }

    // Advance virtual clock, fire timers, invoke rAF callbacks, update FPS counter.
    // Direct V8 API calls — no eval_script per frame.
    tick_frame_v8(scope, state);

    // Drain pending fetch requests — resolve local file reads, dispatch network requests
    drain_fetch_requests(scope, state);

    // Drain pending WebSocket requests — connect, send, close; deliver incoming messages
    drain_websocket_requests(scope, state);

    // Disarm the watchdog — user JS completed within the timeout.
    if let Some(ref wd) = state.watchdog { wd.disarm(); }

    // Sync localStorage changes from JS to Rust storage (debounced: once per second)
    sync_localstorage_to_rust(scope, state);

    // Process rendering commands from JS and copy pixels to framebuffer
    process_render_commands(scope, state);

    // Render audio frame (always, even with no commands — maintains phase continuity)
    state.audio_frame = state.audio.render_frame();

    // Push mono-mixed audio samples to JS for AnalyserNode FFT computation.
    // Interleaved stereo → mono by averaging L+R channels.
    // JS reads this as __dz_audio_samples on the next frame (one-frame latency, same as real browsers).
    // Gated: only push when an AnalyserNode exists (avoids 1470 V8 API calls per frame for most content).
    if state.has_analyser_node {
        let stereo = &state.audio_frame;
        let mono_len = stereo.len() / 2;
        let global = scope.get_current_context().global(scope);
        let arr = v8::Array::new(scope, mono_len as i32);
        for i in 0..mono_len {
            let l = stereo.get(i * 2).copied().unwrap_or(0.0) as f64;
            let r = stereo.get(i * 2 + 1).copied().unwrap_or(0.0) as f64;
            let mono = (l + r) * 0.5;
            let val = v8::Number::new(scope, mono);
            arr.set_index(scope, i as u32, val.into());
        }
        let key = v8::String::new(scope, "__dz_audio_samples").unwrap();
        global.set(scope, key.into(), arr.into());
    }

    // Encode frame if outputs are configured
    if state.encoder.output_count() > 0 {
        state.encoder.encode_frame(&state.framebuffer, Some(&state.audio_frame));
    }
}

/// Sync localStorage changes from JS back to Rust Storage for persistence.
/// Uses diff-based sync: only processes keys that changed since last sync.
/// Keys are stored with "ls:" prefix to isolate from dazzle.storage ("dz:" prefix).
/// Debounced: only runs once per second (every `fps` frames).
fn sync_localstorage_to_rust(scope: &mut v8::PinScope, state: &mut RendererState) {
    // Only sync once per second
    if state.frame_count % state.fps as u64 != 0 {
        return;
    }

    let global = scope.get_current_context().global(scope);

    // Call __dz_localstorage_dirty_keys() — returns {clear: bool, keys: {key: 1|-1}}
    let fn_key = v8::String::new(scope, "__dz_localstorage_dirty_keys").unwrap();
    let Some(fn_val) = global.get(scope, fn_key.into()) else { return };
    let Ok(func) = v8::Local::<v8::Function>::try_from(fn_val) else { return };
    let recv: v8::Local<v8::Value> = global.into();
    let Some(result) = func.call(scope, recv, &[]) else { return };
    let Ok(result_obj) = v8::Local::<v8::Object>::try_from(result) else { return };

    // Check clear flag
    let clear_key = v8::String::new(scope, "clear").unwrap();
    let is_clear = result_obj.get(scope, clear_key.into())
        .map(|v| v.boolean_value(scope))
        .unwrap_or(false);

    // Get keys object
    let keys_key = v8::String::new(scope, "keys").unwrap();
    let Some(keys_val) = result_obj.get(scope, keys_key.into()) else { return };
    let Ok(keys_obj) = v8::Local::<v8::Object>::try_from(keys_val) else { return };
    let Some(prop_names) = keys_obj.get_own_property_names(scope, Default::default()) else { return };

    // Nothing changed
    if !is_clear && prop_names.length() == 0 {
        return;
    }

    let Ok(mut store) = state.store.lock() else { return };

    // Handle clear: remove all ls: prefixed keys
    if is_clear {
        store.remove_by_prefix("ls:");
    }

    // Process individual key changes
    let ls_data_key = v8::String::new(scope, "__dz_localstorage_data").unwrap();
    let ls_obj = global.get(scope, ls_data_key.into())
        .and_then(|v| v8::Local::<v8::Object>::try_from(v).ok());

    for i in 0..prop_names.length() {
        let Some(k) = prop_names.get_index(scope, i) else { continue };
        let k_str = k.to_rust_string_lossy(scope);
        let Some(action_val) = keys_obj.get(scope, k) else { continue };
        let action = action_val.int32_value(scope).unwrap_or(0);

        let prefixed = format!("ls:{}", k_str);
        if action == 1 {
            // Set/update — read current value from __dz_localstorage_data
            if let Some(ref obj) = ls_obj {
                if let Some(v) = obj.get(scope, k) {
                    let v_str = v.to_rust_string_lossy(scope);
                    store.set(prefixed, serde_json::Value::String(v_str));
                }
            }
        } else if action == -1 {
            // Remove
            store.remove(&prefixed);
        }
    }

    let _ = store.maybe_flush();
}

/// Advance virtual clock, fire timers, invoke rAF callbacks, update FPS counter.
/// Uses direct V8 API calls instead of eval_script to avoid per-frame parse overhead.
fn tick_frame_v8(scope: &mut v8::PinScope, state: &RendererState) {
    let global = scope.get_current_context().global(scope);
    let vt = v8::Number::new(scope, state.virtual_time_ms);

    // Set __dz_perf_now = virtual_time_ms
    let perf_key = v8::String::new(scope, "__dz_perf_now").unwrap();
    global.set(scope, perf_key.into(), vt.into());

    // Call __dz_timers.process(vt)
    call_object_method(scope, &global, "__dz_timers", "process", &[vt.into()]);

    // Tick CSS animations & transitions before rAF (so user JS sees updated styles)
    let anim_key = v8::String::new(scope, "__dz_animation_tick").unwrap();
    if let Some(func_val) = global.get(scope, anim_key.into()) {
        if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
            let recv: v8::Local<v8::Value> = global.into();
            let args: [v8::Local<v8::Value>; 1] = [vt.into()];
            func.call(scope, recv, &args);
        }
    }

    // Call __dz_raf.process(vt)
    call_object_method(scope, &global, "__dz_raf", "process", &[vt.into()]);

    // Set window.__dzFPS.current = actual_fps
    let fps_key = v8::String::new(scope, "__dzFPS").unwrap();
    if let Some(fps_val) = global.get(scope, fps_key.into()) {
        if let Ok(fps_obj) = v8::Local::<v8::Object>::try_from(fps_val) {
            let current_key = v8::String::new(scope, "current").unwrap();
            let fps_num = v8::Number::new(scope, state.actual_fps.round());
            fps_obj.set(scope, current_key.into(), fps_num.into());
        }
    }
}

/// Call `globalObj.method(args...)` via direct V8 API.
fn call_object_method(
    scope: &mut v8::PinScope,
    global: &v8::Local<v8::Object>,
    obj_name: &str,
    method_name: &str,
    args: &[v8::Local<v8::Value>],
) {
    let obj_key = v8::String::new(scope, obj_name).unwrap();
    let Some(obj_val) = global.get(scope, obj_key.into()) else { return };
    let Ok(obj) = v8::Local::<v8::Object>::try_from(obj_val) else { return };
    let method_key = v8::String::new(scope, method_name).unwrap();
    let Some(method_val) = obj.get(scope, method_key.into()) else { return };
    let Ok(method_fn) = v8::Local::<v8::Function>::try_from(method_val) else { return };
    method_fn.call(scope, obj.into(), args);
}

/// Fire pending image onload/onerror callbacks via direct V8 Function::call().
/// Replaces eval_script string building with native V8 array construction.
fn fire_image_callbacks(scope: &mut v8::PinScope, state: &mut RendererState) {
    let global = scope.get_current_context().global(scope);

    // Fire onload callbacks: __dz_fire_image_loads([[id, w, h], ...])
    if !state.pending_image_callbacks.is_empty() {
        let fire_key = v8::String::new(scope, "__dz_fire_image_loads").unwrap();
        if let Some(fire_val) = global.get(scope, fire_key.into()) {
            if let Ok(fire_fn) = v8::Local::<v8::Function>::try_from(fire_val) {
                let callbacks: Vec<_> = state.pending_image_callbacks.drain(..).collect();
                let outer = v8::Array::new(scope, callbacks.len().min(i32::MAX as usize) as i32);
                for (i, (id, w, h)) in callbacks.iter().enumerate() {
                    let inner = v8::Array::new(scope, 3);
                    let id_v = v8::Integer::new(scope, *id as i32);
                    let w_v = v8::Integer::new(scope, *w as i32);
                    let h_v = v8::Integer::new(scope, *h as i32);
                    inner.set_index(scope, 0, id_v.into());
                    inner.set_index(scope, 1, w_v.into());
                    inner.set_index(scope, 2, h_v.into());
                    outer.set_index(scope, i as u32, inner.into());
                }
                let recv = v8::undefined(scope);
                fire_fn.call(scope, recv.into(), &[outer.into()]);
            }
        }
    }

    // Fire onerror callbacks: __dz_fire_image_errors([id, ...])
    if !state.pending_image_errors.is_empty() {
        let fire_key = v8::String::new(scope, "__dz_fire_image_errors").unwrap();
        if let Some(fire_val) = global.get(scope, fire_key.into()) {
            if let Ok(fire_fn) = v8::Local::<v8::Function>::try_from(fire_val) {
                let errors: Vec<_> = state.pending_image_errors.drain(..).collect();
                let arr = v8::Array::new(scope, errors.len().min(i32::MAX as usize) as i32);
                for (i, id) in errors.iter().enumerate() {
                    let id_v = v8::Integer::new(scope, *id as i32);
                    arr.set_index(scope, i as u32, id_v.into());
                }
                let recv = v8::undefined(scope);
                fire_fn.call(scope, recv.into(), &[arr.into()]);
            }
        }
    }
}

/// Drain pending fetch requests from JS and resolve completed network fetches.
///
/// For each new request:
/// - Relative URLs → read from content_dir as local files (synchronous)
/// - `data:` URIs → parse inline
/// - `http://` / `https://` → spawn on background thread via reqwest
///
/// Also drains completed network fetch results from the channel.
fn drain_fetch_requests(scope: &mut v8::PinScope, state: &mut RendererState) {
    let global = scope.get_current_context().global(scope);

    // --- Phase 1: Resolve completed network fetches from background threads ---
    while let Ok(result) = state.fetch_rx.try_recv() {
        state.fetch_results.push(result);
    }

    if !state.fetch_results.is_empty() {
        let resolve_key = v8::String::new(scope, "__dz_resolve_fetch").unwrap();
        let reject_key = v8::String::new(scope, "__dz_reject_fetch").unwrap();
        let resolve_fn = global.get(scope, resolve_key.into())
            .and_then(|v| v8::Local::<v8::Function>::try_from(v).ok());
        let reject_fn = global.get(scope, reject_key.into())
            .and_then(|v| v8::Local::<v8::Function>::try_from(v).ok());

        if let (Some(resolve_fn), Some(reject_fn)) = (resolve_fn, reject_fn) {
            let results: Vec<FetchResult> = state.fetch_results.drain(..).collect();
            for r in results {
                // Validate that this fetch ID was actually dispatched by us
                if !state.active_fetch_ids.remove(&r.id) {
                    continue; // Ignore results for unknown IDs
                }
                let recv = v8::undefined(scope);
                let id_v = v8::Integer::new(scope, r.id as i32);

                if let Some(err) = r.error {
                    let err_msg = v8_str_safe!(scope,&err);
                    reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
                } else {
                    let status_v = v8::Integer::new(scope, r.status as i32);
                    let status_text_v = v8_str_safe!(scope,&r.status_text);
                    let headers_obj = v8::Object::new(scope);
                    for (k, v) in &r.headers {
                        let hk = v8_str_safe!(scope,k);
                        let hv = v8_str_safe!(scope,v);
                        headers_obj.set(scope, hk.into(), hv.into());
                    }
                    let body_v = v8_str_safe!(scope,&r.body);
                    resolve_fn.call(scope, recv.into(), &[
                        id_v.into(), status_v.into(), status_text_v.into(),
                        headers_obj.into(), body_v.into(),
                    ]);
                }
            }
        }
    }

    // --- Phase 2: Drain new fetch requests from JS ---
    let key = v8::String::new(scope, "__dz_fetch_requests").unwrap();
    let Some(arr_val) = global.get(scope, key.into()) else { return };
    let Ok(arr) = v8::Local::<v8::Array>::try_from(arr_val) else { return };
    let len = arr.length();
    if len == 0 { return; }

    struct FetchReq {
        id: u32,
        url: String,
    }
    let mut requests = Vec::with_capacity(len as usize);
    let id_key = v8::String::new(scope, "id").unwrap();
    let url_key = v8::String::new(scope, "url").unwrap();
    let processed_key = v8::String::new(scope, "_processed").unwrap();
    let true_val = v8::Boolean::new(scope, true);
    for i in 0..len {
        let Some(item_val) = arr.get_index(scope, i) else { continue };
        let Ok(item) = v8::Local::<v8::Object>::try_from(item_val) else { continue };
        // Skip entries already processed on a previous tick
        if let Some(pv) = item.get(scope, processed_key.into()) {
            if pv.is_true() { continue; }
        }
        let id = item.get(scope, id_key.into())
            .and_then(|v| v.number_value(scope))
            .unwrap_or(0.0) as u32;
        let url = item.get(scope, url_key.into())
            .and_then(|v| v.to_string(scope))
            .map(|s| s.to_rust_string_lossy(scope))
            .unwrap_or_default();
        // Mark as processed so we don't re-spawn threads on the next tick
        item.set(scope, processed_key.into(), true_val.into());
        requests.push(FetchReq { id, url });
    }

    let resolve_key = v8::String::new(scope, "__dz_resolve_fetch").unwrap();
    let reject_key = v8::String::new(scope, "__dz_reject_fetch").unwrap();
    let resolve_fn = global.get(scope, resolve_key.into())
        .and_then(|v| v8::Local::<v8::Function>::try_from(v).ok());
    let reject_fn = global.get(scope, reject_key.into())
        .and_then(|v| v8::Local::<v8::Function>::try_from(v).ok());

    let (Some(resolve_fn), Some(reject_fn)) = (resolve_fn, reject_fn) else { return };

    for req in requests {
        let recv = v8::undefined(scope);

        let is_relative = !req.url.starts_with("http://")
            && !req.url.starts_with("https://")
            && !req.url.starts_with("data:")
            && !req.url.starts_with("blob:");

        if is_relative {
            // Local file — resolve synchronously (with path traversal protection)
            if let Some(ref content_dir) = state.content_dir {
                let clean_url = req.url.trim_start_matches('/');
                let Some(file_path) = safe_content_path(content_dir, &req.url) else {
                    let id_v = v8::Integer::new(scope, req.id as i32);
                    let err_msg = v8::String::new(scope, &format!("Path traversal blocked: {}", clean_url)).unwrap();
                    reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
                    continue;
                };
                match std::fs::read(&file_path) {
                    Ok(data) => {
                        let mime = guess_mime(&file_path);
                        let id_v = v8::Integer::new(scope, req.id as i32);
                        let status_v = v8::Integer::new(scope, 200);
                        let status_text_v = v8::String::new(scope, "OK").unwrap();
                        let headers_obj = v8::Object::new(scope);
                        let ct_key = v8::String::new(scope, "content-type").unwrap();
                        let ct_val = v8::String::new(scope, mime).unwrap();
                        headers_obj.set(scope, ct_key.into(), ct_val.into());
                        let body_str = String::from_utf8_lossy(&data);
                        let body_v = v8_str_safe!(scope,&body_str);
                        resolve_fn.call(scope, recv.into(), &[
                            id_v.into(), status_v.into(), status_text_v.into(),
                            headers_obj.into(), body_v.into(),
                        ]);
                    }
                    Err(_) => {
                        let id_v = v8::Integer::new(scope, req.id as i32);
                        // Don't expose OS error details (may contain absolute filesystem paths)
                        let err_msg = v8::String::new(scope, &format!("File not found: {}", clean_url)).unwrap();
                        reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
                    }
                }
            } else {
                let id_v = v8::Integer::new(scope, req.id as i32);
                let err_msg = v8::String::new(scope, "No content directory configured").unwrap();
                reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
            }
        } else if req.url.starts_with("data:") {
            let id_v = v8::Integer::new(scope, req.id as i32);
            if let Some(comma_idx) = req.url.find(',') {
                let prefix = &req.url[5..comma_idx]; // between "data:" and ","
                let raw_body = &req.url[comma_idx + 1..];
                let body_str = if prefix.contains(";base64") {
                    use base64::Engine;
                    match base64::engine::general_purpose::STANDARD.decode(raw_body) {
                        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                        Err(_) => raw_body.to_string(), // fallback to raw on decode failure
                    }
                } else {
                    raw_body.to_string()
                };
                let status_v = v8::Integer::new(scope, 200);
                let status_text_v = v8::String::new(scope, "OK").unwrap();
                let headers_obj = v8::Object::new(scope);
                let body_v = v8_str_safe!(scope,&body_str);
                resolve_fn.call(scope, recv.into(), &[
                    id_v.into(), status_v.into(), status_text_v.into(),
                    headers_obj.into(), body_v.into(),
                ]);
            } else {
                let err_msg = v8::String::new(scope, "Invalid data URI").unwrap();
                reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
            }
        } else {
            // Network fetch — spawn on background thread (with SSRF protection + thread limit)
            // Resolve DNS once and pin the IP to prevent DNS rebinding attacks
            let pinned = match crate::content::resolve_and_check_url(&req.url) {
                Ok(pinned) => pinned,
                Err(_) => {
                    let id_v = v8::Integer::new(scope, req.id as i32);
                    let err_msg = v8::String::new(scope, "Blocked: private/internal network address").unwrap();
                    reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
                    continue;
                }
            };
            if ACTIVE_BACKGROUND_THREADS.load(Ordering::Relaxed) >= MAX_BACKGROUND_THREADS {
                let id_v = v8::Integer::new(scope, req.id as i32);
                let err_msg = v8::String::new(scope, "Too many concurrent network requests").unwrap();
                reject_fn.call(scope, recv.into(), &[id_v.into(), err_msg.into()]);
                continue;
            }
            ACTIVE_BACKGROUND_THREADS.fetch_add(1, Ordering::Relaxed);
            state.active_fetch_ids.insert(req.id);
            let tx = state.fetch_tx.clone();
            let id = req.id;
            let url = req.url.clone();
            let (resolved_ip, pinned_host, pinned_port) = pinned;
            std::thread::spawn(move || {
                struct ThreadGuard;
                impl Drop for ThreadGuard {
                    fn drop(&mut self) { ACTIVE_BACKGROUND_THREADS.fetch_sub(1, Ordering::Relaxed); }
                }
                let _guard = ThreadGuard;
                // Pin the resolved IP so reqwest connects to the same address we checked
                let client = reqwest::blocking::Client::builder()
                    .timeout(std::time::Duration::from_secs(30))
                    // Disable redirects to prevent SSRF via HTTP 302 to private/metadata endpoints
                    .redirect(reqwest::redirect::Policy::none())
                    .resolve(&pinned_host, std::net::SocketAddr::new(resolved_ip, pinned_port))
                    .build();
                // Cap response body to 50 MB (matching content::fetch_url)
                const MAX_RESPONSE_SIZE: usize = 50 * 1024 * 1024;
                let result = match client.and_then(|c| c.get(&url).send()) {
                    Ok(resp) => {
                        let status = resp.status().as_u16();
                        let status_text = resp.status().canonical_reason()
                            .unwrap_or("OK").to_string();
                        let headers: Vec<(String, String)> = resp.headers().iter()
                            .map(|(k, v)| (k.as_str().to_string(), v.to_str().unwrap_or("").to_string()))
                            .collect();
                        // Check Content-Length header first for early rejection
                        if let Some(cl) = resp.content_length() {
                            if cl > MAX_RESPONSE_SIZE as u64 {
                                FetchResult {
                                    id, status: 0, status_text: String::new(),
                                    headers: vec![], body: String::new(),
                                    error: Some(format!("Response too large: {} bytes (max {})", cl, MAX_RESPONSE_SIZE)),
                                }
                            } else {
                                match resp.text() {
                                    Ok(body) if body.len() > MAX_RESPONSE_SIZE => FetchResult {
                                        id, status: 0, status_text: String::new(),
                                        headers: vec![], body: String::new(),
                                        error: Some(format!("Response body too large: {} bytes (max {})", body.len(), MAX_RESPONSE_SIZE)),
                                    },
                                    Ok(body) => FetchResult {
                                        id, status, status_text, headers, body, error: None,
                                    },
                                    Err(e) => FetchResult {
                                        id, status: 0, status_text: String::new(),
                                        headers: vec![], body: String::new(),
                                        error: Some(format!("Failed to read response body: {}", e)),
                                    },
                                }
                            }
                        } else {
                            // No Content-Length — read body and check size after
                            match resp.text() {
                                Ok(body) if body.len() > MAX_RESPONSE_SIZE => FetchResult {
                                    id, status: 0, status_text: String::new(),
                                    headers: vec![], body: String::new(),
                                    error: Some(format!("Response body too large: {} bytes (max {})", body.len(), MAX_RESPONSE_SIZE)),
                                },
                                Ok(body) => FetchResult {
                                    id, status, status_text, headers, body, error: None,
                                },
                                Err(e) => FetchResult {
                                    id, status: 0, status_text: String::new(),
                                    headers: vec![], body: String::new(),
                                    error: Some(format!("Failed to read response body: {}", e)),
                                },
                            }
                        }
                    }
                    Err(e) => FetchResult {
                        id, status: 0, status_text: String::new(),
                        headers: vec![], body: String::new(),
                        error: Some(format!("Network error: {}", e)),
                    },
                };
                let _ = tx.send(result);
            });
        }
    }
}

/// Guess MIME type from file extension.
fn guess_mime(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("json") => "application/json",
        Some("js" | "mjs") => "application/javascript",
        Some("css") => "text/css",
        Some("html" | "htm") => "text/html",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("txt") => "text/plain",
        Some("xml") => "application/xml",
        Some("wasm") => "application/wasm",
        Some("mp3") => "audio/mpeg",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

/// Drain WebSocket requests from JS and deliver incoming events.
///
/// Phase 1: Deliver events from background threads (open, message, close, error).
/// Phase 2: Process new JS requests (connect, send, close).
fn drain_websocket_requests(scope: &mut v8::PinScope, state: &mut RendererState) {
    let global = scope.get_current_context().global(scope);

    // Phase 1: Deliver incoming WS events to JS
    loop {
        match state.ws_rx.try_recv() {
            Ok(WsEvent::Opened { id }) => {
                let fn_key = v8::String::new(scope, "__dz_ws_on_open").unwrap();
                if let Some(func_val) = global.get(scope, fn_key.into()) {
                    if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                        let id_val = v8::Integer::new(scope, id as i32);
                        let undef = v8::undefined(scope);
                        let _ = func.call(scope, undef.into(), &[id_val.into()]);
                    }
                }
            }
            Ok(WsEvent::Message { id, data }) => {
                let fn_key = v8::String::new(scope, "__dz_ws_on_message").unwrap();
                if let Some(func_val) = global.get(scope, fn_key.into()) {
                    if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                        let id_val = v8::Integer::new(scope, id as i32);
                        let data_val = v8_str_safe!(scope,&data);
                        let undef = v8::undefined(scope);
                        let _ = func.call(scope, undef.into(), &[id_val.into(), data_val.into()]);
                    }
                }
            }
            Ok(WsEvent::Closed { id, code, reason, was_clean }) => {
                let fn_key = v8::String::new(scope, "__dz_ws_on_close").unwrap();
                if let Some(func_val) = global.get(scope, fn_key.into()) {
                    if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                        let id_val = v8::Integer::new(scope, id as i32);
                        let code_val = v8::Integer::new(scope, code as i32);
                        let reason_val = v8_str_safe!(scope,&reason);
                        let clean_val = v8::Boolean::new(scope, was_clean);
                        let undef = v8::undefined(scope);
                        let _ = func.call(scope, undef.into(), &[id_val.into(), code_val.into(), reason_val.into(), clean_val.into()]);
                    }
                }
                state.ws_outgoing.remove(&id);
            }
            Ok(WsEvent::Error { id, message }) => {
                let fn_key = v8::String::new(scope, "__dz_ws_on_error").unwrap();
                if let Some(func_val) = global.get(scope, fn_key.into()) {
                    if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                        let id_val = v8::Integer::new(scope, id as i32);
                        let msg_val = v8_str_safe!(scope,&message);
                        let undef = v8::undefined(scope);
                        let _ = func.call(scope, undef.into(), &[id_val.into(), msg_val.into()]);
                    }
                }
            }
            Err(_) => break,
        }
    }

    // Phase 2: Process new JS WebSocket requests
    let key = v8::String::new(scope, "__dz_ws_requests").unwrap();
    let Some(arr_val) = global.get(scope, key.into()) else { return };
    let Ok(arr) = v8::Local::<v8::Array>::try_from(arr_val) else { return };
    let len = arr.length();
    if len == 0 { return; }

    // Collect requests
    struct WsRequest {
        req_type: String,
        id: u32,
        url: String,
        data: String,
    }

    let mut requests = Vec::new();
    for i in 0..len {
        let Some(obj_val) = arr.get_index(scope, i) else { continue };
        let Ok(obj) = v8::Local::<v8::Object>::try_from(obj_val) else { continue };

        let type_key = v8::String::new(scope, "type").unwrap();
        let id_key = v8::String::new(scope, "id").unwrap();

        let req_type = obj.get(scope, type_key.into())
            .and_then(|v| v.to_string(scope))
            .map(|s| s.to_rust_string_lossy(scope))
            .unwrap_or_default();
        let id = obj.get(scope, id_key.into())
            .and_then(|v| v.uint32_value(scope))
            .unwrap_or(0);

        let url = {
            let k = v8::String::new(scope, "url").unwrap();
            obj.get(scope, k.into())
                .and_then(|v| v.to_string(scope))
                .map(|s| s.to_rust_string_lossy(scope))
                .unwrap_or_default()
        };
        let data = {
            let k = v8::String::new(scope, "data").unwrap();
            obj.get(scope, k.into())
                .and_then(|v| v.to_string(scope))
                .map(|s| s.to_rust_string_lossy(scope))
                .unwrap_or_default()
        };
        requests.push(WsRequest { req_type, id, url, data });
    }

    // Clear the array
    let zero = v8::Integer::new(scope, 0);
    let length_key = v8::String::new(scope, "length").unwrap();
    arr.set(scope, length_key.into(), zero.into());

    // Process requests
    for req in requests {
        match req.req_type.as_str() {
            "connect" => {
                // Validate WebSocket URL scheme (ws:// or wss:// only)
                if let Ok(parsed) = url::Url::parse(&req.url) {
                    match parsed.scheme() {
                        "ws" | "wss" => {} // allowed
                        _ => {
                            let _ = state.ws_tx.try_send(WsEvent::Error {
                                id: req.id,
                                message: format!("Invalid WebSocket scheme: '{}' (expected ws:// or wss://)", parsed.scheme()),
                            });
                            continue;
                        }
                    }
                } else {
                    let _ = state.ws_tx.try_send(WsEvent::Error {
                        id: req.id,
                        message: "Invalid WebSocket URL".to_string(),
                    });
                    continue;
                }

                // SSRF protection: resolve DNS once and pin to the resolved IP.
                // This prevents DNS rebinding attacks where a second resolution
                // could return a different (private) IP after the check passes.
                let resolved = crate::content::resolve_and_check_url(&req.url);
                let (resolved_ip, _host, resolved_port) = match resolved {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = state.ws_tx.try_send(WsEvent::Error {
                            id: req.id,
                            message: "WebSocket connections to private/internal hosts are blocked".to_string(),
                        });
                        continue;
                    }
                };
                if ACTIVE_BACKGROUND_THREADS.load(Ordering::Relaxed) >= MAX_BACKGROUND_THREADS {
                    let _ = state.ws_tx.try_send(WsEvent::Error {
                        id: req.id,
                        message: "Too many concurrent connections".to_string(),
                    });
                    continue;
                }
                ACTIVE_BACKGROUND_THREADS.fetch_add(1, Ordering::Relaxed);
                state.active_ws_ids.insert(req.id);
                let ws_tx = state.ws_tx.clone();
                let url = req.url.clone();
                let id = req.id;
                let (msg_tx, msg_rx) = std::sync::mpsc::channel::<String>();
                state.ws_outgoing.insert(id, msg_tx);

                // Spawn background thread for this connection
                std::thread::spawn(move || {
                    struct ThreadGuard;
                    impl Drop for ThreadGuard {
                        fn drop(&mut self) { ACTIVE_BACKGROUND_THREADS.fetch_sub(1, Ordering::Relaxed); }
                    }
                    let _guard = ThreadGuard;
                    use tungstenite::Message;

                    // Connect via pre-resolved IP to prevent DNS rebinding TOCTOU.
                    let ws_result = std::net::TcpStream::connect(
                        std::net::SocketAddr::new(resolved_ip, resolved_port)
                    ).map_err(tungstenite::Error::Io)
                    .and_then(|tcp| {
                        tungstenite::client(&url, tcp)
                            .map_err(|e| match e {
                                tungstenite::HandshakeError::Failure(err) => err,
                                tungstenite::HandshakeError::Interrupted(_) => {
                                    tungstenite::Error::Io(std::io::Error::new(
                                        std::io::ErrorKind::Interrupted, "WebSocket handshake interrupted"
                                    ))
                                }
                            })
                    });

                    match ws_result {
                        Ok((mut socket, _response)) => {
                            let _ = ws_tx.try_send(WsEvent::Opened { id });

                            // Set non-blocking so we can interleave read/write.
                            // With pre-resolved TcpStream, get_ref() returns &TcpStream directly.
                            let _ = socket.get_ref().set_nonblocking(true);

                            loop {
                                // Check for outgoing messages
                                match msg_rx.try_recv() {
                                    Ok(data) => {
                                        if let Err(e) = socket.send(Message::Text(data)) {
                                            let _ = ws_tx.try_send(WsEvent::Error { id, message: e.to_string() });
                                            let _ = ws_tx.try_send(WsEvent::Closed { id, code: 1006, reason: e.to_string(), was_clean: false });
                                            return;
                                        }
                                    }
                                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                                        // Main thread dropped the sender — close
                                        let _ = socket.close(None);
                                        let _ = ws_tx.try_send(WsEvent::Closed { id, code: 1000, reason: String::new(), was_clean: true });
                                        return;
                                    }
                                    Err(std::sync::mpsc::TryRecvError::Empty) => {}
                                }

                                // Try to read incoming messages (16 MB per-message cap)
                                const MAX_WS_MSG_SIZE: usize = 16 * 1024 * 1024;
                                match socket.read() {
                                    Ok(Message::Text(text)) => {
                                        if text.len() <= MAX_WS_MSG_SIZE {
                                            let _ = ws_tx.try_send(WsEvent::Message { id, data: text.to_string() });
                                        }
                                        // Silently drop oversized or channel-full messages
                                    }
                                    Ok(Message::Binary(bin)) => {
                                        if bin.len() <= MAX_WS_MSG_SIZE {
                                            let text = String::from_utf8_lossy(&bin).to_string();
                                            let _ = ws_tx.try_send(WsEvent::Message { id, data: text });
                                        }
                                    }
                                    Ok(Message::Close(frame)) => {
                                        let (code, reason) = frame.map(|f| (f.code.into(), f.reason.to_string())).unwrap_or((1000, String::new()));
                                        let _ = ws_tx.try_send(WsEvent::Closed { id, code, reason, was_clean: true });
                                        return;
                                    }
                                    Ok(Message::Ping(data)) => {
                                        let _ = socket.send(Message::Pong(data));
                                    }
                                    Ok(_) => {} // Pong — ignore
                                    Err(tungstenite::Error::Io(ref e)) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                        // No data — sleep briefly to avoid busy loop
                                        std::thread::sleep(std::time::Duration::from_millis(5));
                                    }
                                    Err(e) => {
                                        let _ = ws_tx.try_send(WsEvent::Error { id, message: e.to_string() });
                                        let _ = ws_tx.try_send(WsEvent::Closed { id, code: 1006, reason: e.to_string(), was_clean: false });
                                        return;
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            let _ = ws_tx.try_send(WsEvent::Error { id, message: e.to_string() });
                            let _ = ws_tx.try_send(WsEvent::Closed { id, code: 1006, reason: e.to_string(), was_clean: false });
                        }
                    }
                });
            }
            "send" => {
                if state.active_ws_ids.contains(&req.id) {
                    if let Some(tx) = state.ws_outgoing.get(&req.id) {
                        let _ = tx.send(req.data);
                    }
                }
            }
            "close" => {
                // Drop the outgoing sender — the background thread will detect disconnect and close
                state.active_ws_ids.remove(&req.id);
                state.ws_outgoing.remove(&req.id);
            }
            _ => {}
        }
    }
}

/// Drain Canvas 2D and WebGL2 command buffers, process, composite to framebuffer.
///
/// Reads V8 arrays directly instead of JSON serialization round-trip.
/// Each command buffer is a JS array of arrays: `[["op", arg1, arg2, ...], ...]`
/// We walk the V8 arrays, extract values by type, and build serde_json::Value
/// in-memory — no stringify/parse overhead.
fn process_render_commands(scope: &mut v8::PinScope, state: &mut RendererState) {
    let global = scope.get_current_context().global(scope);

    // Process image load requests from JS (Image.src = "...")
    drain_and_process_v8_cmds(scope, &global, "__dz_image_loads", |cmds| {
        if let Some(arr) = cmds.as_array() {
            for item in arr {
                let Some(inner) = item.as_array() else { continue };
                if inner.len() < 2 { continue; }
                let Some(id) = inner[0].as_u64() else { continue };
                let Some(src) = inner[1].as_str() else { continue };
                let id = id as u32;

                // Resolve path relative to content_dir (with path traversal protection)
                let path = if let Some(ref dir) = state.content_dir {
                    match safe_content_path(dir, src) {
                        Some(p) => p,
                        None => {
                            warn!("Image load blocked: path traversal attempt: {}", src);
                            state.pending_image_errors.push(id);
                            continue;
                        }
                    }
                } else {
                    warn!("Image load blocked: no content_dir configured for {}", src);
                    state.pending_image_errors.push(id);
                    continue;
                };

                // Cap image count to prevent OOM from registering too many images
                if state.canvas2d.image_count() >= canvas2d::Canvas2D::MAX_IMAGES {
                    log::warn!("Image load blocked: image limit reached ({})", canvas2d::Canvas2D::MAX_IMAGES);
                    state.pending_image_errors.push(id);
                    continue;
                }

                match std::fs::read(&path) {
                    Ok(data) => {
                        match crate::content::decode_image(&data) {
                            Ok(decoded) => {
                                let w = decoded.width;
                                let h = decoded.height;
                                state.canvas2d.register_image(id, w, h, decoded.rgba);
                                state.pending_image_callbacks.push((id, w, h));
                            }
                            Err(e) => {
                                log::warn!("Image decode failed for id={}: {}", id, e);
                                state.pending_image_errors.push(id);
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Image load failed for id={}: {}", id, e);
                        state.pending_image_errors.push(id);
                    }
                }
            }
        }
    });

    // Canvas2D commands are dispatched inline via native __dz_canvas_cmd callback.
    // Just check/reset the dirty flag — no JS array to drain.
    let has_canvas = state.canvas2d.take_frame_dirty();
    // WebGL2 commands dispatch inline via native callbacks (__dz_webgl_cmd / __dz_webgl_cmd_ret).
    // Just check/reset the dirty flag — no JS array to drain.
    let has_webgl = state.webgl2.take_frame_dirty();

    // Write WebGL errors back to JS for getError() consumption
    let gl_errors = state.webgl2.take_errors();
    if !gl_errors.is_empty() {
        let key = v8::String::new(scope, "__dz_webgl_errors").unwrap();
        if let Some(arr_val) = global.get(scope, key.into()) {
            if let Ok(arr) = v8::Local::<v8::Array>::try_from(arr_val) {
                let base = arr.length();
                for (i, &code) in gl_errors.iter().enumerate() {
                    let v = v8::Integer::new_from_unsigned(scope, code);
                    arr.set_index(scope, base + i as u32, v.into());
                }
            }
        }
    }

    // Drain audio commands — convert from serde_json::Value to Vec<Vec<Value>>
    drain_and_process_v8_cmds(scope, &global, "__dz_audio_cmds", |cmds| {
        if let Some(arr) = cmds.as_array() {
            // Detect AnalyserNode creation to gate per-frame audio sample push
            if !state.has_analyser_node {
                for item in arr {
                    if let Some(inner) = item.as_array() {
                        if inner.first().and_then(|v| v.as_str()) == Some("analyser_create") {
                            state.has_analyser_node = true;
                            break;
                        }
                    }
                }
            }
            // Take ownership of the command arrays to avoid a double-clone
            let vecs: Vec<Vec<serde_json::Value>> = arr.iter()
                .filter_map(|v| v.as_array().cloned())
                .collect();
            state.audio.process_commands_owned(vecs);
        }
    });

    // --- Incremental DOM mutations ---
    // Drain __dz_dom_cmds command buffer from JS.
    // Style-only commands (opcode 1) are applied incrementally.
    // Structural commands (opcode 2) trigger a full re-render fallback.
    let html_dirty = {
        let key = v8::String::new(scope, "__dz_html_dirty").unwrap();
        global.get(scope, key.into())
            .map(|v| v.boolean_value(scope))
            .unwrap_or(false)
    };
    if html_dirty {
        let mut has_structural = false;
        let mut style_cmds: Vec<(usize, String, String)> = Vec::new();

        // Drain __dz_dom_cmds
        let cmds_key = v8::String::new(scope, "__dz_dom_cmds").unwrap();
        if let Some(cmds_val) = global.get(scope, cmds_key.into()) {
            if let Ok(cmds_arr) = v8::Local::<v8::Array>::try_from(cmds_val) {
                let len = cmds_arr.length();
                for i in 0..len {
                    if let Some(cmd) = cmds_arr.get_index(scope, i) {
                        if let Ok(arr) = v8::Local::<v8::Array>::try_from(cmd) {
                            if arr.length() >= 2 {
                                let opcode = arr.get_index(scope, 0)
                                    .map(|v| v.int32_value(scope).unwrap_or(0))
                                    .unwrap_or(0);
                                if opcode == 2 {
                                    has_structural = true;
                                } else if opcode == 1 && arr.length() >= 4 {
                                    let node_id = arr.get_index(scope, 1)
                                        .map(|v| v.int32_value(scope).unwrap_or(0) as usize)
                                        .unwrap_or(0);
                                    let prop = arr.get_index(scope, 2)
                                        .map(|v| v.to_rust_string_lossy(scope))
                                        .unwrap_or_default();
                                    let val = arr.get_index(scope, 3)
                                        .map(|v| v.to_rust_string_lossy(scope))
                                        .unwrap_or_default();
                                    style_cmds.push((node_id, prop, val));
                                }
                            }
                        }
                    }
                }
                // Clear the command buffer by setting length = 0
                // (don't replace the array — JS needs to keep pushing to the same object)
                let len_key = v8::String::new(scope, "length").unwrap();
                let zero = v8::Integer::new(scope, 0);
                cmds_arr.set(scope, len_key.into(), zero.into());
            }
        }

        if has_structural || state.persistent_dom.is_none() {
            // Structural change or no persistent DOM yet — full re-render fallback
            let key = v8::String::new(scope, "__dz_serialize_dom").unwrap();
            if let Some(func_val) = global.get(scope, key.into()) {
                if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                    let recv = global.into();
                    if let Some(result) = func.call(scope, recv, &[]) {
                        if let Some(html_str) = result.to_rust_string_lossy(scope).into() {
                            let start = std::time::Instant::now();
                            let mut pixmap = tiny_skia::Pixmap::new(state.width, state.height)
                                .expect("failed to create HTML re-render pixmap");
                            if let Some(ref dir) = state.content_dir {
                                htmlcss::render_html_with_dir(&html_str, &mut pixmap, dir);
                            } else {
                                htmlcss::render_html(&html_str, &mut pixmap);
                            }
                            // Bootstrap persistent DOM from the full render
                            let vp = crate::htmlcss::style::Viewport {
                                w: state.width as f32,
                                h: state.height as f32,
                                root_font_size: crate::htmlcss::style::ROOT_FONT_SIZE,
                            };
                            let document = crate::htmlcss::dom_parse_html(&html_str);
                            let rules = crate::htmlcss::style::extract_and_parse_styles(&document);
                            let styled = crate::htmlcss::style::compute_styles(&document, &rules);
                            let layout_tree = crate::htmlcss::layout::compute_layout(&styled, vp.w, vp.h);
                            state.persistent_dom = Some(
                                crate::htmlcss::incremental::PersistentDom::from_layout_tree(&layout_tree, vp)
                            );
                            // Push layout rects to JS for getBoundingClientRect (only after full re-render)
                            if let Some(ref pdom) = state.persistent_dom {
                                let rects = pdom.collect_layout_rects();
                                use std::fmt::Write;
                                let mut js = String::with_capacity(32 + rects.len() * 40);
                                js.push_str("globalThis.__dz_layout_rects = {");
                                for (i, (id, x, y, w, h)) in rects.iter().enumerate() {
                                    if i > 0 { js.push(','); }
                                    let _ = write!(js, "{}:[{},{},{},{}]", id, x, y, w, h);
                                }
                                js.push_str("};");
                                let code = v8::String::new(scope, &js).unwrap();
                                let script = v8::Script::compile(scope, code, None);
                                if let Some(s) = script { let _ = s.run(scope); }
                            }

                            state.html_background = Some(pixmap);
                            let elapsed = start.elapsed();
                            if elapsed.as_millis() > 4 {
                                log::warn!("HTML re-render took {}ms (>4ms budget)", elapsed.as_millis());
                            }
                        }
                    }
                }
            }
        } else if !style_cmds.is_empty() {
            // Style-only mutations — apply incrementally
            let start = std::time::Instant::now();
            let mut needs_full_rerender = false;
            if let Some(ref mut pdom) = state.persistent_dom {
                for (node_id, prop, val) in &style_cmds {
                    pdom.apply_style_mutation(*node_id, prop, val);
                }
                let mut pixmap = tiny_skia::Pixmap::new(state.width, state.height)
                    .expect("failed to create incremental re-render pixmap");
                needs_full_rerender = pdom.layout_and_paint(&mut pixmap);
                if !needs_full_rerender {
                    state.html_background = Some(pixmap);
                }
            }
            if needs_full_rerender {
                // SVG nodes are dirty — fall back to full re-render
                let key = v8::String::new(scope, "__dz_serialize_dom").unwrap();
                if let Some(func_val) = global.get(scope, key.into()) {
                    if let Ok(func) = v8::Local::<v8::Function>::try_from(func_val) {
                        let recv = global.into();
                        if let Some(result) = func.call(scope, recv, &[]) {
                            if let Some(html_str) = result.to_rust_string_lossy(scope).into() {
                                let mut pixmap = tiny_skia::Pixmap::new(state.width, state.height)
                                    .expect("failed to create SVG fallback re-render pixmap");
                                if let Some(ref dir) = state.content_dir {
                                    htmlcss::render_html_with_dir(&html_str, &mut pixmap, dir);
                                } else {
                                    htmlcss::render_html(&html_str, &mut pixmap);
                                }
                                let vp = crate::htmlcss::style::Viewport {
                                    w: state.width as f32,
                                    h: state.height as f32,
                                    root_font_size: crate::htmlcss::style::ROOT_FONT_SIZE,
                                };
                                let document = crate::htmlcss::dom_parse_html(&html_str);
                                let rules = crate::htmlcss::style::extract_and_parse_styles(&document);
                                let styled = crate::htmlcss::style::compute_styles(&document, &rules);
                                let layout_tree = crate::htmlcss::layout::compute_layout(&styled, vp.w, vp.h);
                                state.persistent_dom = Some(
                                    crate::htmlcss::incremental::PersistentDom::from_layout_tree(&layout_tree, vp)
                                );
                                // Push layout rects to JS for getBoundingClientRect (only after full re-render)
                                if let Some(ref pdom) = state.persistent_dom {
                                    let rects = pdom.collect_layout_rects();
                                    use std::fmt::Write;
                                    let mut js = String::with_capacity(32 + rects.len() * 40);
                                    js.push_str("globalThis.__dz_layout_rects = {");
                                    for (i, (id, x, y, w, h)) in rects.iter().enumerate() {
                                        if i > 0 { js.push(','); }
                                        let _ = write!(js, "{}:[{},{},{},{}]", id, x, y, w, h);
                                    }
                                    js.push_str("};");
                                    let code = v8::String::new(scope, &js).unwrap();
                                    let script = v8::Script::compile(scope, code, None);
                                    if let Some(s) = script { let _ = s.run(scope); }
                                }
                                state.html_background = Some(pixmap);
                            }
                        }
                    }
                }
            }
            let elapsed = start.elapsed();
            if elapsed.as_millis() > 4 {
                log::warn!("Incremental re-render took {}ms (>4ms budget, {} style cmds)", elapsed.as_millis(), style_cmds.len());
            }
        }

        // Reset the dirty flag
        let key = v8::String::new(scope, "__dz_html_dirty").unwrap();
        let false_val = v8::Boolean::new(scope, false);
        global.set(scope, key.into(), false_val.into());
    }

    // Composite to framebuffer: HTML bg → WebGL2 → Canvas 2D (back to front).
    //
    // HTML background is the base layer.
    // WebGL2 and Canvas2D overwrite on top when they have active draw commands.
    // If nothing draws this frame, the HTML background (or zeros) persists.
    if has_webgl || has_canvas || html_dirty {
        if let Some(ref bg) = state.html_background {
            state.framebuffer.copy_from_slice(bg.data());
        } else {
            state.framebuffer.fill(0);
        }
        if has_webgl {
            state.webgl2.read_pixels_premultiplied(&mut state.framebuffer);
        }
        if has_canvas {
            state.canvas2d.read_pixels_premultiplied(&mut state.framebuffer);
        }
    } else if let Some(ref bg) = state.html_background {
        state.framebuffer.copy_from_slice(bg.data());
    }
}

/// Drain a V8 command buffer array, convert to serde_json::Value, and call the processor.
/// Returns true if commands were processed.
fn drain_and_process_v8_cmds<F>(
    scope: &mut v8::PinScope,
    global: &v8::Local<v8::Object>,
    var_name: &str,
    process_fn: F,
) -> bool
where
    F: FnOnce(&serde_json::Value),
{
    let key = v8::String::new(scope, var_name).unwrap();
    let Some(buf_val) = global.get(scope, key.into()) else { return false };
    let Ok(arr) = v8::Local::<v8::Array>::try_from(buf_val) else { return false };

    let len = arr.length();
    if len == 0 {
        return false;
    }

    // Build serde_json array directly from V8 values
    let mut cmds = Vec::with_capacity(len as usize);
    for i in 0..len {
        let Some(item) = arr.get_index(scope, i) else { continue };
        if let Ok(inner_arr) = v8::Local::<v8::Array>::try_from(item) {
            let inner_len = inner_arr.length();
            let mut cmd = Vec::with_capacity(inner_len as usize);
            for j in 0..inner_len {
                let Some(elem) = inner_arr.get_index(scope, j) else { continue };
                cmd.push(v8_to_json(scope, elem));
            }
            cmds.push(serde_json::Value::Array(cmd));
        }
    }

    // Truncate the array in-place (don't reassign the binding, which may be frozen)
    let zero = v8::Integer::new(scope, 0);
    let length_key = v8::String::new(scope, "length").unwrap();
    arr.set(scope, length_key.into(), zero.into());

    let json_cmds = serde_json::Value::Array(cmds);
    process_fn(&json_cmds);
    true
}

/// Convert a V8 value to serde_json::Value without going through JSON text.
fn v8_to_json(scope: &mut v8::PinScope, val: v8::Local<v8::Value>) -> serde_json::Value {
    v8_to_json_inner(scope, val, 0)
}

const MAX_V8_JSON_DEPTH: u32 = 64;

fn v8_to_json_inner(scope: &mut v8::PinScope, val: v8::Local<v8::Value>, depth: u32) -> serde_json::Value {
    if depth >= MAX_V8_JSON_DEPTH {
        return serde_json::Value::Null;
    }
    if val.is_number() {
        let n = val.number_value(scope).unwrap_or(0.0);
        // Preserve integer representation so as_u64()/as_i64() work downstream.
        // V8 represents all numbers as f64, but serde_json treats float vs int differently.
        // Use 2^53 as the safe integer boundary (f64 can represent integers exactly up to this)
        if n.fract() == 0.0 && n >= 0.0 && n <= (1u64 << 53) as f64 {
            serde_json::Value::from(n as u64)
        } else if n.fract() == 0.0 && n >= i64::MIN as f64 && n < 0.0 {
            serde_json::Value::from(n as i64)
        } else {
            serde_json::Value::from(n)
        }
    } else if val.is_string() {
        let s = val.to_string(scope).unwrap().to_rust_string_lossy(scope);
        serde_json::Value::String(s)
    } else if val.is_boolean() {
        serde_json::Value::Bool(val.boolean_value(scope))
    } else if val.is_null_or_undefined() {
        serde_json::Value::Null
    } else if val.is_array() {
        let arr = v8::Local::<v8::Array>::try_from(val).unwrap();
        let len = arr.length();
        let mut items = Vec::with_capacity(len as usize);
        for i in 0..len {
            if let Some(elem) = arr.get_index(scope, i) {
                items.push(v8_to_json_inner(scope, elem, depth + 1));
            }
        }
        serde_json::Value::Array(items)
    } else {
        // Objects, functions, etc — fallback to string representation
        let s = val.to_string(scope)
            .map(|s| s.to_rust_string_lossy(scope))
            .unwrap_or_default();
        serde_json::Value::String(s)
    }
}

/// Freeze late-registered __dz_* native callbacks that were set after the polyfill freeze loop.
/// Only freezes specific callbacks to avoid breaking __dz_create_canvas2d etc. which are
/// called dynamically by canvas.getContext().
pub fn freeze_late_native_callbacks(scope: &mut v8::PinScope) {
    let freeze_js = r#"
        ['__dz_canvas_get_image_data', '__dz_canvas_to_data_url',
         '__dz_webgl_cmd', '__dz_webgl_cmd_ret', '__dz_webgl_cmd_ret_str',
         '__dz_webgl_buf_data', '__dz_load_worker_script'].forEach(function(k) {
            if (typeof globalThis[k] === 'function') {
                try { Object.defineProperty(globalThis, k, { writable: false, configurable: false }); }
                catch(e) {}
            }
        });
    "#;
    let _ = eval_script(scope, "<freeze-late>", freeze_js);
}

/// Register native V8 functions that require raw pointers to renderer state.
/// Must be called after the state is at its final memory location (won't move).
///
/// Registers:
/// - `__dz_canvas_cmd(op, ...args)` — dispatch draw commands inline to Canvas2D
/// - `__dz_canvas_put_image_data(buf, dx, dy, w, h)` — putImageData with raw buffer
/// - `__dz_canvas_get_image_data(buf, x, y, w, h)` — synchronous pixel readback
///
/// Note: console is registered earlier in init_globals (before polyfills need it).
/// Note: canvas_cmd and put_image_data are registered before canvas2d.js eval
///       (canvas2d.js references __dz_canvas_cmd at load time).
pub fn register_native_callbacks(scope: &mut v8::PinScope, state: &mut RendererState) {
    register_canvas_cmd(scope, &mut state.canvas2d);
    register_canvas_put_image_data(scope, &mut state.canvas2d);
    register_get_image_data(scope, &mut state.canvas2d);
    register_canvas_to_data_url(scope, &mut state.canvas2d);
    register_webgl_cmd(scope, &mut state.webgl2);
    register_webgl_cmd_ret(scope, &mut state.webgl2);
    register_webgl_cmd_ret_str(scope, &mut state.webgl2);
    register_webgl_buf_data(scope, &mut state.webgl2);
    register_load_worker_script(scope, state);
}

/// Register the native `__dz_load_worker_script(url)` function.
/// Reads a worker script from the content directory and returns its source text.
/// Uses Box<Mutex<Option<PathBuf>>> for pointer stability across Runtime moves.
fn register_load_worker_script(scope: &mut v8::PinScope, state: &mut RendererState) {
    let global = scope.get_current_context().global(scope);
    // Use the Box-allocated Mutex — stable across Runtime moves
    let dir_ptr = &*state.content_dir_box as *const std::sync::Mutex<Option<std::path::PathBuf>> as *mut std::ffi::c_void;
    let external = v8::External::new(scope, dir_ptr);

    let func = v8::Function::builder(load_worker_script_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_load_worker_script function");

    let key = v8::String::new(scope, "__dz_load_worker_script").unwrap();
    global.set(scope, key.into(), func.into());
}

fn load_worker_script_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("load_worker_script: missing External data");
    let dir_mutex = unsafe { &*(external.value() as *const std::sync::Mutex<Option<std::path::PathBuf>>) };

    if args.length() < 1 { return; }
    let url = args.get(0).to_rust_string_lossy(scope);

    let content = if let Ok(guard) = dir_mutex.lock() {
        if let Some(ref dir) = *guard {
            if url.starts_with("http://") || url.starts_with("https://") {
                if is_private_host(&url) { None } else { crate::content::fetch_url(&url).ok() }
            } else {
                safe_content_path(dir, &url).and_then(|p| std::fs::read_to_string(p).ok())
            }
        } else {
            None
        }
    } else {
        None
    };

    if let Some(src) = content {
        let v8_str = v8_str_safe!(scope, &src);
        rv.set(v8_str.into());
    }
}

/// Register the native `__dz_canvas_cmd(op, ...args)` function.
/// Each call dispatches a single canvas command directly to Canvas2D::dispatch_command.
fn register_canvas_cmd(scope: &mut v8::PinScope, canvas2d: &mut Canvas2D) {
    let global = scope.get_current_context().global(scope);
    let canvas_ptr = canvas2d as *mut Canvas2D as *mut std::ffi::c_void;
    let external = v8::External::new(scope, canvas_ptr);

    let func = v8::Function::builder(canvas_cmd_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_canvas_cmd function");

    let key = v8::String::new(scope, "__dz_canvas_cmd").unwrap();
    global.set(scope, key.into(), func.into());
}

/// V8 native callback for __dz_canvas_cmd(op, ...args).
/// Partitions arguments into numeric (f64) and string slices, then dispatches.
fn canvas_cmd_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    if args.length() < 1 { return; }

    // Extract ALL V8 arguments into Rust values BEFORE dereferencing the External.
    // This prevents unsound aliasing: .to_string(scope) can trigger user JS toString()
    // getters which could re-enter this callback, creating two &mut references.
    let op_val = args.get(0);
    let op_v8 = match op_val.to_string(scope) {
        Some(s) => s,
        None => return,
    };
    let op = op_v8.to_rust_string_lossy(scope);

    // Partition remaining args into numbers and strings
    let mut num_args: Vec<f64> = Vec::with_capacity(args.length() as usize);
    let mut str_args: Vec<String> = Vec::with_capacity(4);
    for i in 1..args.length() {
        let arg = args.get(i);
        if arg.is_number() {
            num_args.push(arg.number_value(scope).unwrap_or(0.0));
        } else if arg.is_string() {
            let s = arg.to_string(scope).unwrap().to_rust_string_lossy(scope);
            str_args.push(s);
        } else if arg.is_boolean() {
            // Booleans treated as 0/1 (e.g. ccw flag)
            num_args.push(if arg.boolean_value(scope) { 1.0 } else { 0.0 });
        }
    }

    // Now safe to dereference — no more V8 calls that could trigger user JS.
    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("canvas_cmd: missing External data");
    // SAFETY: All V8 argument extraction is complete above. No user JS can execute
    // between this dereference and the dispatch_command call below.
    let canvas2d = unsafe { &mut *(external.value() as *mut Canvas2D) };

    let str_refs: Vec<&str> = str_args.iter().map(|s| s.as_str()).collect();
    canvas2d.dispatch_command(&op, &num_args, &str_refs);
}

/// Register the native `__dz_canvas_put_image_data(buf, dx, dy, w, h)` function.
/// Reads pixel data directly from a Uint8ClampedArray (no per-pixel argument copying).
fn register_canvas_put_image_data(scope: &mut v8::PinScope, canvas2d: &mut Canvas2D) {
    let global = scope.get_current_context().global(scope);
    let canvas_ptr = canvas2d as *mut Canvas2D as *mut std::ffi::c_void;
    let external = v8::External::new(scope, canvas_ptr);

    let func = v8::Function::builder(canvas_put_image_data_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_canvas_put_image_data function");

    let key = v8::String::new(scope, "__dz_canvas_put_image_data").unwrap();
    global.set(scope, key.into(), func.into());
}

/// V8 native callback for __dz_canvas_put_image_data(buf, dx, dy, w, h).
fn canvas_put_image_data_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    // Extract ALL V8 arguments into Rust values BEFORE dereferencing the External.
    // This prevents unsound aliasing: .number_value(scope) can trigger user JS
    // valueOf() getters which could re-enter native callbacks creating two &mut refs.
    let buf = match v8::Local::<v8::Uint8ClampedArray>::try_from(args.get(0)) {
        Ok(b) => b,
        Err(_) => return,
    };
    let dx_f = args.get(1).number_value(scope).unwrap_or(0.0);
    let dy_f = args.get(2).number_value(scope).unwrap_or(0.0);
    let w_f = args.get(3).number_value(scope).unwrap_or(0.0);
    let h_f = args.get(4).number_value(scope).unwrap_or(0.0);
    // Reject NaN/Infinity/negative dimensions and clamp to sane range
    if !w_f.is_finite() || !h_f.is_finite() || !dx_f.is_finite() || !dy_f.is_finite() { return; }
    if w_f < 0.0 || h_f < 0.0 || w_f > 8192.0 || h_f > 8192.0 { return; }
    let dx = dx_f as i32;
    let dy = dy_f as i32;
    let w = w_f as u32;
    let h = h_f as u32;

    // Read pixels directly from the typed array's backing store
    let src_ptr = buf.data() as *const u8;
    let src_len = buf.byte_length();
    // Guard against detached ArrayBuffer (data() returns null after transfer())
    if src_ptr.is_null() || src_len == 0 { return; }
    let pixels = unsafe { std::slice::from_raw_parts(src_ptr, src_len) };

    // Now safe to dereference — all V8 argument extraction is complete.
    let Ok(external) = v8::Local::<v8::External>::try_from(args.data()) else { return };
    // SAFETY: All V8 argument extraction is complete above. No user JS can execute
    // between this dereference and the method calls below.
    let canvas2d = unsafe { &mut *(external.value() as *mut Canvas2D) };

    canvas2d.put_image_data(dx, dy, w, h, pixels);
    canvas2d.frame_dirty = true;
}

/// Register the native `__dz_canvas_get_image_data(buf, x, y, w, h)` function.
///
/// This is a synchronous JS→Rust call that:
/// 1. Drains pending canvas commands and processes them (flush)
/// 2. Reads back pixel data from the pixmap for the requested rect
/// 3. Copies the result into the Uint8ClampedArray passed from JS
fn register_get_image_data(scope: &mut v8::PinScope, canvas2d: &mut Canvas2D) {
    let global = scope.get_current_context().global(scope);
    let canvas_ptr = canvas2d as *mut Canvas2D as *mut std::ffi::c_void;
    let external = v8::External::new(scope, canvas_ptr);

    let func = v8::Function::builder(get_image_data_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build getImageData function");

    let key = v8::String::new(scope, "__dz_canvas_get_image_data").unwrap();
    global.set(scope, key.into(), func.into());
}

/// V8 native callback for getImageData. Called as:
///   __dz_canvas_get_image_data(uint8ClampedArray, x, y, w, h)
///
/// No flush needed — all canvas commands are dispatched inline via __dz_canvas_cmd,
/// so the pixmap is always up to date when this is called.
fn get_image_data_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    // Extract ALL V8 arguments into Rust values BEFORE dereferencing the External.
    // This prevents unsound aliasing: .number_value(scope) can trigger user JS
    // valueOf() getters which could re-enter native callbacks creating two &mut refs.
    let buf = match v8::Local::<v8::Uint8ClampedArray>::try_from(args.get(0)) {
        Ok(b) => b,
        Err(_) => return,
    };
    let x_f = args.get(1).number_value(scope).unwrap_or(0.0);
    let y_f = args.get(2).number_value(scope).unwrap_or(0.0);
    let w_f = args.get(3).number_value(scope).unwrap_or(0.0);
    let h_f = args.get(4).number_value(scope).unwrap_or(0.0);
    if !x_f.is_finite() || !y_f.is_finite() || !w_f.is_finite() || !h_f.is_finite() { return; }
    if w_f < 0.0 || h_f < 0.0 || w_f > 8192.0 || h_f > 8192.0 { return; }
    let x = x_f as u32;
    let y = y_f as u32;
    let w = w_f as u32;
    let h = h_f as u32;

    // Now safe to dereference — all V8 argument extraction is complete.
    let Ok(external) = v8::Local::<v8::External>::try_from(args.data()) else { return };
    // SAFETY: All V8 argument extraction is complete above. No user JS can execute
    // between this dereference and the method calls below.
    let canvas2d = unsafe { &mut *(external.value() as *mut Canvas2D) };

    let pixels = canvas2d.get_image_data(x, y, w, h);

    let dst_ptr = buf.data() as *mut u8;
    let dst_len = buf.byte_length();
    let copy_len = pixels.len().min(dst_len);
    if copy_len > 0 {
        unsafe { std::ptr::copy_nonoverlapping(pixels.as_ptr(), dst_ptr, copy_len) };
    }
}

/// Register the native `__dz_canvas_to_data_url(type, quality)` function.
/// Encodes the current pixmap to PNG and returns a data URI string.
fn register_canvas_to_data_url(scope: &mut v8::PinScope, canvas2d: &mut Canvas2D) {
    let global = scope.get_current_context().global(scope);
    let canvas_ptr = canvas2d as *mut Canvas2D as *mut std::ffi::c_void;
    let external = v8::External::new(scope, canvas_ptr);

    let func = v8::Function::builder(canvas_to_data_url_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_canvas_to_data_url function");

    let key = v8::String::new(scope, "__dz_canvas_to_data_url").unwrap();
    global.set(scope, key.into(), func.into());
}

/// V8 native callback for __dz_canvas_to_data_url(type, quality).
/// Returns a "data:image/png;base64,..." string.
fn canvas_to_data_url_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    use base64::Engine;

    // Dereference External AFTER all V8 argument extraction is complete,
    // consistent with the safety pattern used by all other native callbacks.
    // (This callback has no user-provided args, but we follow the same order
    // to avoid unsound aliasing if future changes add argument extraction.)
    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("toDataURL: missing External data");
    // SAFETY: No user JS valueOf()/toString() calls can interleave here.
    // The External points to a heap-stable Box<Canvas2D> owned by RendererState.
    let canvas2d = unsafe { &mut *(external.value() as *mut Canvas2D) };

    // Get unpremultiplied RGBA pixel data
    let (w, h) = canvas2d.dimensions();
    let mut pixels = vec![0u8; w as usize * h as usize * 4];
    canvas2d.read_pixels(&mut pixels);

    // Encode to PNG using the `image` crate
    let mut png_buf: Vec<u8> = Vec::new();
    if let Some(img) = image::RgbaImage::from_raw(w, h, pixels) {
        let encoder = image::codecs::png::PngEncoder::new(std::io::Cursor::new(&mut png_buf));
        use image::ImageEncoder;
        let _ = encoder.write_image(img.as_raw(), w, h, image::ExtendedColorType::Rgba8);
    }

    // Convert to base64 data URI
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png_buf);
    let data_url = format!("data:image/png;base64,{}", b64);

    let result = v8_str_safe!(scope, &data_url);
    rv.set(result.into());
}

/// Register the native `__dz_measure_text(text, fontSize, bold)` function.
/// Returns a V8 object with full TextMetrics properties computed via fontdue.
fn register_measure_text(scope: &mut v8::PinScope) {
    let global = scope.get_current_context().global(scope);

    let func = v8::Function::builder(measure_text_callback)
        .build(scope)
        .expect("failed to build __dz_measure_text function");

    let key = v8::String::new(scope, "__dz_measure_text").unwrap();
    global.set(scope, key.into(), func.into());
}

/// V8 native callback for __dz_measure_text(text, fontSize, bold).
/// Returns { width, actualBoundingBoxLeft, actualBoundingBoxRight,
///           actualBoundingBoxAscent, actualBoundingBoxDescent,
///           fontBoundingBoxAscent, fontBoundingBoxDescent }
fn measure_text_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    let text = match args.get(0).to_string(scope) {
        Some(s) => s.to_rust_string_lossy(scope),
        None => return,
    };
    let font_size = args.get(1).number_value(scope).unwrap_or(10.0) as f32;
    let bold = args.get(2).boolean_value(scope);

    let m = canvas2d::text::measure_text_full(&text, font_size, bold);

    let obj = v8::Object::new(scope);
    let set = |scope: &mut v8::PinScope, obj: v8::Local<v8::Object>, name: &str, val: f32| {
        let k = v8::String::new(scope, name).unwrap();
        let v = v8::Number::new(scope, val as f64);
        obj.set(scope, k.into(), v.into());
    };
    set(scope, obj, "width", m.width);
    set(scope, obj, "actualBoundingBoxLeft", m.actual_bounding_box_left);
    set(scope, obj, "actualBoundingBoxRight", m.actual_bounding_box_right);
    set(scope, obj, "actualBoundingBoxAscent", m.actual_bounding_box_ascent);
    set(scope, obj, "actualBoundingBoxDescent", m.actual_bounding_box_descent);
    set(scope, obj, "fontBoundingBoxAscent", m.font_bounding_box_ascent);
    set(scope, obj, "fontBoundingBoxDescent", m.font_bounding_box_descent);

    rv.set(obj.into());
}

// ---------------------------------------------------------------------------
// WebGL2 native V8 callbacks
// ---------------------------------------------------------------------------

/// Register `__dz_webgl_cmd(op, ...args)` — fire-and-forget WebGL2 commands.
fn register_webgl_cmd(scope: &mut v8::PinScope, webgl2: &mut Box<WebGL2>) {
    let global = scope.get_current_context().global(scope);
    let ptr = &mut **webgl2 as *mut WebGL2 as *mut std::ffi::c_void;
    let external = v8::External::new(scope, ptr);
    let func = v8::Function::builder(webgl_cmd_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_webgl_cmd");
    let key = v8::String::new(scope, "__dz_webgl_cmd").unwrap();
    global.set(scope, key.into(), func.into());
}

fn webgl_cmd_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    if args.length() < 1 { return; }
    // Extract all V8 args BEFORE dereferencing External to prevent re-entrant aliasing.
    let Some(op_v8) = args.get(0).to_string(scope) else { return };
    let op = op_v8.to_rust_string_lossy(scope);
    let (num_args, str_args) = extract_webgl_args(scope, &args);

    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("webgl_cmd: missing External");
    let webgl2 = unsafe { &mut *(external.value() as *mut WebGL2) };
    let str_refs: Vec<&str> = str_args.iter().map(|s| s.as_str()).collect();
    webgl2.dispatch_command(&op, &num_args, &str_refs);
}

/// Register `__dz_webgl_cmd_ret(op, ...args)` — commands that return a numeric value.
fn register_webgl_cmd_ret(scope: &mut v8::PinScope, webgl2: &mut Box<WebGL2>) {
    let global = scope.get_current_context().global(scope);
    let ptr = &mut **webgl2 as *mut WebGL2 as *mut std::ffi::c_void;
    let external = v8::External::new(scope, ptr);
    let func = v8::Function::builder(webgl_cmd_ret_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_webgl_cmd_ret");
    let key = v8::String::new(scope, "__dz_webgl_cmd_ret").unwrap();
    global.set(scope, key.into(), func.into());
}

fn webgl_cmd_ret_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    if args.length() < 1 { return; }
    // Extract all V8 args BEFORE dereferencing External to prevent re-entrant aliasing.
    let Some(op_v8) = args.get(0).to_string(scope) else { return };
    let op = op_v8.to_rust_string_lossy(scope);
    let (num_args, str_args) = extract_webgl_args(scope, &args);

    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("webgl_cmd_ret: missing External");
    let webgl2 = unsafe { &mut *(external.value() as *mut WebGL2) };
    let str_refs: Vec<&str> = str_args.iter().map(|s| s.as_str()).collect();
    if let Some(val) = webgl2.dispatch_command(&op, &num_args, &str_refs) {
        rv.set(v8::Number::new(scope, val).into());
    }
}

/// Register `__dz_webgl_cmd_ret_str(op, ...args)` — commands that return a string.
fn register_webgl_cmd_ret_str(scope: &mut v8::PinScope, webgl2: &mut Box<WebGL2>) {
    let global = scope.get_current_context().global(scope);
    let ptr = &mut **webgl2 as *mut WebGL2 as *mut std::ffi::c_void;
    let external = v8::External::new(scope, ptr);
    let func = v8::Function::builder(webgl_cmd_ret_str_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_webgl_cmd_ret_str");
    let key = v8::String::new(scope, "__dz_webgl_cmd_ret_str").unwrap();
    global.set(scope, key.into(), func.into());
}

fn webgl_cmd_ret_str_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue,
) {
    if args.length() < 1 { return; }
    // Extract all V8 args BEFORE dereferencing External to prevent re-entrant aliasing.
    let Some(op_v8) = args.get(0).to_string(scope) else { return };
    let op = op_v8.to_rust_string_lossy(scope);
    let (num_args, _) = extract_webgl_args(scope, &args);

    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("webgl_cmd_ret_str: missing External");
    let webgl2 = unsafe { &mut *(external.value() as *mut WebGL2) };
    if let Some(s) = webgl2.dispatch_command_str(&op, &num_args) {
        if let Some(v8_str) = v8::String::new(scope, &s) {
            rv.set(v8_str.into());
        }
    }
}

/// Register `__dz_webgl_buf_data(op, target, typedArray, usage, ...extraArgs)` — typed array data.
fn register_webgl_buf_data(scope: &mut v8::PinScope, webgl2: &mut Box<WebGL2>) {
    let global = scope.get_current_context().global(scope);
    let ptr = &mut **webgl2 as *mut WebGL2 as *mut std::ffi::c_void;
    let external = v8::External::new(scope, ptr);
    let func = v8::Function::builder(webgl_buf_data_callback)
        .data(external.into())
        .build(scope)
        .expect("failed to build __dz_webgl_buf_data");
    let key = v8::String::new(scope, "__dz_webgl_buf_data").unwrap();
    global.set(scope, key.into(), func.into());
}

fn webgl_buf_data_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    // Args: op, target, typedArray, usage [, ...extra numeric args for texImage2D]
    if args.length() < 4 { return; }
    // Extract op string BEFORE dereferencing External to prevent re-entrant aliasing.
    let Some(op_v8) = args.get(0).to_string(scope) else { return };
    let op = op_v8.to_rust_string_lossy(scope);
    let target = args.get(1).number_value(scope).unwrap_or(0.0) as u32;
    let usage = args.get(3).number_value(scope).unwrap_or(0.0) as u32;

    // Extract typed array data from arg 2
    let typed_arr = args.get(2);
    if typed_arr.is_null_or_undefined() { return; }

    // Try ArrayBufferView (covers all TypedArray types)
    let Ok(view) = v8::Local::<v8::ArrayBufferView>::try_from(typed_arr) else { return };
    let byte_offset = view.byte_offset();
    let byte_length = view.byte_length();

    let Some(buffer) = view.buffer(scope) else { return };
    let Some(store) = buffer.get_backing_store().data() else { return };
    let base_ptr = store.as_ptr() as *const u8;
    let data = unsafe { std::slice::from_raw_parts(base_ptr.add(byte_offset), byte_length) };

    // Extract optional texImage2D args before dereferencing External
    let tex_args = if op == "texImage2D" && args.length() >= 11 {
        Some((
            args.get(4).number_value(scope).unwrap_or(0.0) as u32,
            args.get(5).number_value(scope).unwrap_or(0.0) as u32,
            args.get(6).number_value(scope).unwrap_or(0.0) as u32,
            args.get(7).number_value(scope).unwrap_or(0.0) as u32,
            args.get(8).number_value(scope).unwrap_or(0.0) as u32,
            args.get(9).number_value(scope).unwrap_or(0.0) as u32,
            args.get(10).number_value(scope).unwrap_or(0.0) as u32,
        ))
    } else {
        None
    };

    // Extract optional texSubImage2D args: level, xoffset, yoffset, width, height, format, type
    let tex_sub_args = if op == "texSubImage2D" && args.length() >= 11 {
        Some((
            args.get(4).number_value(scope).unwrap_or(0.0) as u32,  // level
            args.get(5).number_value(scope).unwrap_or(0.0) as u32,  // xoffset
            args.get(6).number_value(scope).unwrap_or(0.0) as u32,  // yoffset
            args.get(7).number_value(scope).unwrap_or(0.0) as u32,  // width
            args.get(8).number_value(scope).unwrap_or(0.0) as u32,  // height
            args.get(9).number_value(scope).unwrap_or(0.0) as u32,  // format
            args.get(10).number_value(scope).unwrap_or(0.0) as u32, // type
        ))
    } else {
        None
    };

    // Now safe to dereference — all V8 argument extraction is complete.
    let external = v8::Local::<v8::External>::try_from(args.data())
        .expect("webgl_buf_data: missing External");
    let webgl2 = unsafe { &mut *(external.value() as *mut WebGL2) };

    match op.as_str() {
        "bufferData" => {
            webgl2.buffer_data_raw(target, data, 4, usage);
        }
        "bufferSubData" => {
            let offset = usage as usize; // arg 3 is offset for bufferSubData
            webgl2.buffer_sub_data_raw(target, offset, data);
        }
        "texImage2D" => {
            if let Some((level, internal_fmt, width, height, border, fmt, dtype)) = tex_args {
                webgl2.tex_image_2d_raw(target, level, internal_fmt, width, height, border, fmt, dtype, data);
            }
        }
        "texSubImage2D" => {
            if let Some((_level, xoffset, yoffset, width, height, _fmt, _dtype)) = tex_sub_args {
                webgl2.tex_sub_image_2d_raw(target, xoffset, yoffset, width, height, data);
            }
        }
        _ => {}
    }
}

/// Extract numeric and string arguments from V8 callback args (skipping arg 0 which is the opcode).
fn extract_webgl_args(scope: &mut v8::PinScope, args: &v8::FunctionCallbackArguments) -> (Vec<f64>, Vec<String>) {
    let mut num_args: Vec<f64> = Vec::with_capacity(args.length() as usize);
    let mut str_args: Vec<String> = Vec::with_capacity(4);
    for i in 1..args.length() {
        let arg = args.get(i);
        if arg.is_number() {
            num_args.push(arg.number_value(scope).unwrap_or(0.0));
        } else if arg.is_string() {
            let s = arg.to_string(scope).unwrap().to_rust_string_lossy(scope);
            str_args.push(s);
        } else if arg.is_boolean() {
            num_args.push(if arg.boolean_value(scope) { 1.0 } else { 0.0 });
        } else if arg.is_null_or_undefined() {
            num_args.push(0.0);
        }
    }
    (num_args, str_args)
}

/// Register native console.log/warn/error/info/debug functions.
/// Each callback writes directly to a Rust Vec<ConsoleEntry> via External pointer,
/// eliminating JS object creation and V8→serde_json conversion.
fn register_native_console(scope: &mut v8::PinScope, buffer: &mut Vec<ConsoleEntry>) {
    let buf_ptr = buffer as *mut Vec<ConsoleEntry> as *mut std::ffi::c_void;
    let external = v8::External::new(scope, buf_ptr);
    let global = scope.get_current_context().global(scope);

    // Build console object with native methods
    let console_obj = v8::Object::new(scope);

    let levels = ["log", "warn", "error", "info", "debug"];
    let cdp_levels = ["log", "warning", "error", "info", "debug"];
    for (level, cdp_level) in levels.iter().zip(cdp_levels.iter()) {
        // Each level gets its own native function with the level string baked into data
        // We encode: external_ptr + level string in a 2-element array as data
        let level_str = v8::String::new(scope, cdp_level).unwrap();
        let data_arr = v8::Array::new(scope, 2);
        data_arr.set_index(scope, 0, external.into());
        data_arr.set_index(scope, 1, level_str.into());

        let func = v8::Function::builder(console_log_callback)
            .data(data_arr.into())
            .build(scope)
            .expect("failed to build console function");

        let key = v8::String::new(scope, level).unwrap();
        console_obj.set(scope, key.into(), func.into());
    }

    // Alias trace/dir/table → log
    let log_key = v8::String::new(scope, "log").unwrap();
    let log_fn = console_obj.get(scope, log_key.into()).unwrap();
    for alias in ["trace", "dir", "table"] {
        let alias_key = v8::String::new(scope, alias).unwrap();
        console_obj.set(scope, alias_key.into(), log_fn);
    }

    // No-op stubs
    let noop = v8::Function::new(scope, |_scope: &mut v8::PinScope, _args: v8::FunctionCallbackArguments, _rv: v8::ReturnValue| {})
        .unwrap();
    for stub in ["clear", "count", "countReset", "group", "groupCollapsed", "groupEnd", "time", "timeEnd", "timeLog"] {
        let key = v8::String::new(scope, stub).unwrap();
        console_obj.set(scope, key.into(), noop.into());
    }

    // console.assert
    let assert_data = {
        let level_str = v8::String::new(scope, "error").unwrap();
        let data_arr = v8::Array::new(scope, 2);
        data_arr.set_index(scope, 0, external.into());
        data_arr.set_index(scope, 1, level_str.into());
        data_arr
    };
    let assert_fn = v8::Function::builder(console_assert_callback)
        .data(assert_data.into())
        .build(scope)
        .expect("failed to build console.assert");
    let assert_key = v8::String::new(scope, "assert").unwrap();
    console_obj.set(scope, assert_key.into(), assert_fn.into());

    // Set globalThis.console = console_obj
    let console_key = v8::String::new(scope, "console").unwrap();
    global.set(scope, console_key.into(), console_obj.into());
}

/// Native callback for console.log/warn/error/info/debug.
/// Data is [External(buffer_ptr), String(level)].
fn console_log_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    let Ok(data_arr) = v8::Local::<v8::Array>::try_from(args.data()) else { return };
    let Some(level_val) = data_arr.get_index(scope, 1) else { return };
    let Some(level_str) = level_val.to_string(scope) else { return };
    let level = level_str.to_rust_string_lossy(scope);

    // Extract all args BEFORE dereferencing External — .to_string(scope) can trigger
    // user JS toString() getters which could re-enter console callbacks.
    let mut parts = Vec::with_capacity(args.length() as usize);
    for i in 0..args.length() {
        let arg = args.get(i);
        let s = arg.to_string(scope)
            .map(|s| s.to_rust_string_lossy(scope))
            .unwrap_or_else(|| "[object]".to_string());
        parts.push(s);
    }

    // Now safe to dereference — all V8 argument extraction is complete.
    let Some(ext_val) = data_arr.get_index(scope, 0) else { return };
    let Ok(external) = v8::Local::<v8::External>::try_from(ext_val) else { return };
    let buffer = unsafe { &mut *(external.value() as *mut Vec<ConsoleEntry>) };

    // Cap buffer: max 10,000 entries AND max 10 MB total text to prevent OOM.
    // Without a byte cap, 10K entries of 1MB each = 10GB.
    const MAX_CONSOLE_ENTRIES: usize = 10_000;
    const MAX_CONSOLE_BYTES: usize = 10 * 1024 * 1024;
    if buffer.len() >= MAX_CONSOLE_ENTRIES {
        return;
    }
    let text = parts.join(" ");
    let total_bytes: usize = buffer.iter().map(|e| e.text.len()).sum::<usize>() + text.len();
    if total_bytes > MAX_CONSOLE_BYTES {
        return;
    }
    buffer.push(ConsoleEntry {
        level,
        text,
        timestamp: 0.0, // Timestamp set by CDP consumer if needed
    });
}

/// Native callback for console.assert(condition, ...args).
fn console_assert_callback(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    _rv: v8::ReturnValue,
) {
    // First arg is the condition — if truthy, do nothing
    if args.length() > 0 && args.get(0).boolean_value(scope) {
        return;
    }

    // Extract all args BEFORE dereferencing External to prevent re-entrant aliasing.
    let mut parts = vec!["Assertion failed:".to_string()];
    for i in 1..args.length() {
        let arg = args.get(i);
        let s = arg.to_string(scope)
            .map(|s| s.to_rust_string_lossy(scope))
            .unwrap_or_else(|| "[object]".to_string());
        parts.push(s);
    }

    // Now safe to dereference — all V8 argument extraction is complete.
    let Ok(data_arr) = v8::Local::<v8::Array>::try_from(args.data()) else { return };
    let Some(ext_val) = data_arr.get_index(scope, 0) else { return };
    let Ok(external) = v8::Local::<v8::External>::try_from(ext_val) else { return };
    let buffer = unsafe { &mut *(external.value() as *mut Vec<ConsoleEntry>) };

    // Cap buffer size to prevent OOM from console.assert spam (matching console.log cap)
    const MAX_CONSOLE_ENTRIES: usize = 10_000;
    const MAX_CONSOLE_BYTES: usize = 10 * 1024 * 1024;
    if buffer.len() >= MAX_CONSOLE_ENTRIES {
        return;
    }
    let text = parts.join(" ");
    let total_bytes: usize = buffer.iter().map(|e| e.text.len()).sum::<usize>() + text.len();
    if total_bytes > MAX_CONSOLE_BYTES {
        return;
    }
    buffer.push(ConsoleEntry {
        level: "error".to_string(),
        text,
        timestamp: 0.0,
    });
}

/// Drain the console log buffer and return entries.
/// Reads from the native Rust Vec (populated by console.log callbacks).
pub fn drain_console_logs_from_state(state: &mut RendererState) -> Vec<ConsoleEntry> {
    std::mem::take(&mut *state.console_buffer)
}


// --- Helpers ---

fn v8_value_to_cdp(scope: &mut v8::PinScope, value: v8::Local<v8::Value>, return_by_value: bool) -> serde_json::Value {
    use serde_json::json;

    if value.is_undefined() {
        return json!({ "result": { "type": "undefined" } });
    }
    if value.is_null() {
        return json!({ "result": { "type": "object", "subtype": "null", "value": null } });
    }
    if value.is_boolean() {
        return json!({ "result": { "type": "boolean", "value": value.boolean_value(scope) } });
    }
    if value.is_number() {
        let n = value.number_value(scope).unwrap_or(0.0);
        return json!({ "result": { "type": "number", "value": n, "description": format!("{}", n) } });
    }
    if value.is_string() {
        let s = value.to_string(scope).unwrap().to_rust_string_lossy(scope);
        return json!({ "result": { "type": "string", "value": s } });
    }

    if return_by_value {
        if let Some(json_str) = v8::json::stringify(scope, value) {
            let rust_str = json_str.to_rust_string_lossy(scope);
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&rust_str) {
                return json!({ "result": { "type": "object", "value": parsed } });
            }
        }
    }

    let desc = value.to_string(scope)
        .map(|s| s.to_rust_string_lossy(scope))
        .unwrap_or_else(|| "[object]".to_string());
    json!({ "result": { "type": "object", "className": "Object", "description": desc } })
}


// ============================================================================
// Runtime — testable wrapper around V8 isolate + context + renderer state
// ============================================================================


/// High-level runtime that owns the V8 isolate, context, and renderer state.
/// Provides a safe API for loading JS, ticking frames, evaluating expressions,
/// and reading the framebuffer — without exposing V8 scope lifetimes.
pub struct Runtime {
    isolate: v8::OwnedIsolate,
    context: v8::Global<v8::Context>,
    pub state: RendererState,
    pacer: FramePacer,
}

impl Runtime {
    /// Create a new runtime with initialized V8 context and browser globals.
    pub fn new(width: u32, height: u32, fps: u32, store: Arc<Mutex<crate::storage::Storage>>) -> Result<Self> {
        init_v8();
        let params = v8::CreateParams::default()
            .heap_limits(0, 256 * 1024 * 1024); // 256MB max heap to prevent OOM from malicious JS
        let mut isolate = v8::Isolate::new(params);
        let mut state = RendererState::new(width, height, fps, store);

        // Create context and initialize globals in one scope
        let context_global = {
            v8::scope!(let handle_scope, &mut isolate);
            let ctx = v8::Context::new(handle_scope, Default::default());
            let global = v8::Global::new(handle_scope, ctx);
            {
                let mut scope = v8::ContextScope::new(handle_scope, ctx);
                init_globals(&mut scope, &mut state)?;
            }
            global
        };

        let mut rt = Runtime {
            isolate,
            context: context_global,
            pacer: FramePacer::new(state.fps),
            state,
        };
        // Register native V8 functions that hold raw pointers to state.
        // Must happen AFTER state is at its final location (moved into Runtime).
        rt.register_native_fns();
        Ok(rt)
    }

    /// Register native V8 functions that require stable pointers to state.
    /// Called after Runtime is fully constructed (state at final location).
    fn register_native_fns(&mut self) {
        let Runtime { isolate, context, state, .. } = self;
        v8::scope!(let handle_scope, isolate);
        let ctx_local = v8::Local::new(handle_scope, &*context);
        let mut scope = v8::ContextScope::new(handle_scope, ctx_local);
        register_native_callbacks(&mut scope, state);
        freeze_late_native_callbacks(&mut scope);
    }

    /// Load HTML content: render the HTML/CSS to the background pixmap,
    /// then extract and execute any `<script>` tags.
    /// If `content_dir` is provided, resolves `<script src="...">` and
    /// `@font-face url()` relative to that directory.
    pub fn load_html(&mut self, html: &str) -> Result<()> {
        self.load_html_with_dir(html, None)
    }

    /// Load HTML with a content directory for external resource resolution.
    pub fn load_html_with_dir(&mut self, html: &str, content_dir: Option<&std::path::Path>) -> Result<()> {
        // Store content_dir for image loading and Worker script loading
        if let Some(dir) = content_dir {
            let path = dir.to_path_buf();
            self.state.content_dir = Some(path.clone());
            *self.state.content_dir_box.lock().unwrap() = Some(path);
        }
        // Render full HTML (script tags are invisible, so render_html ignores them)
        if let Some(dir) = content_dir {
            self.state.render_html_background_with_dir(html, dir);
        } else {
            self.state.render_html_background(html);
        }
        // Inject <style> content into JS DOM so the animation engine can parse
        // @keyframes and CSS animation/transition rules. Rust renders HTML via its
        // own parser, so the JS DOM doesn't see <style> tags unless we inject them.
        // Suppress dirty flag during injection to avoid a spurious re-render that
        // would overwrite the Rust-rendered background with the empty JS DOM.
        let styles = htmlcss::extract_style_elements(html);
        if !styles.is_empty() {
            let mut inject_js = String::from("var __dz_prev_dirty = __dz_html_dirty;\n");
            for css_text in &styles {
                // Escape for JS string literal (handle backticks, backslashes, ${})
                let escaped = css_text
                    .replace('\\', "\\\\")
                    .replace('`', "\\`")
                    .replace("${", "\\${");
                inject_js.push_str(&format!(
                    "{{ var s = document.createElement('style'); s.textContent = `{}`; document.head.appendChild(s); }}\n",
                    escaped
                ));
            }
            inject_js.push_str("__dz_html_dirty = __dz_prev_dirty; __dz_dom_cmds.length = 0;\n");
            self.load_js("<style-inject>", &inject_js)?;
        }

        // Extract and run scripts (with external src resolution if dir available)
        let (_, js) = if let Some(dir) = content_dir {
            htmlcss::extract_scripts_from_dir(html, dir)
        } else {
            htmlcss::extract_scripts(html)
        };
        if !js.is_empty() {
            self.load_js("<html-scripts>", &js)?;
        }
        Ok(())
    }

    /// Load and execute a JavaScript source string.
    pub fn load_js(&mut self, name: &str, source: &str) -> Result<()> {
        let Runtime { isolate, context, .. } = self;
        v8::scope!(let handle_scope, isolate);
        let ctx_local = v8::Local::new(handle_scope, &*context);
        let mut scope = v8::ContextScope::new(handle_scope, ctx_local);
        eval_script(&mut scope, name, source)
    }

    /// Advance one frame: update clock, fire timers/rAF, process render commands.
    /// Uncapped — returns as soon as the frame is done.
    pub fn tick(&mut self) {
        let Runtime { isolate, context, state, .. } = self;
        v8::scope!(let handle_scope, isolate);
        let ctx_local = v8::Local::new(handle_scope, &*context);
        let mut scope = v8::ContextScope::new(handle_scope, ctx_local);
        tick_frame(&mut scope, state);
    }

    /// Advance one frame, then sleep until the next frame is due (target FPS).
    /// Use this for self-paced rendering (e.g. standalone binary, dev mode).
    pub fn tick_paced(&mut self) {
        self.tick();
        self.pacer.wait();
    }

    /// Evaluate a JS expression and return a CDP-formatted result.
    pub fn evaluate(&mut self, expression: &str) -> Result<serde_json::Value> {
        let Runtime { isolate, context, .. } = self;
        v8::scope!(let handle_scope, isolate);
        let ctx_local = v8::Local::new(handle_scope, &*context);
        let mut scope = v8::ContextScope::new(handle_scope, ctx_local);
        eval_for_cdp(&mut scope, expression, true)
    }

    /// Dispatch an event to JS via __dz_dispatch_event(payload).
    /// `event_json` must be valid JSON — invalid input is rejected to prevent injection.
    pub fn inject_event(&mut self, event_json: &str) -> Result<()> {
        // Validate that event_json is valid JSON before interpolating into JS eval string.
        // Without this check, malicious input could escape the JSON literal and execute arbitrary code.
        if serde_json::from_str::<serde_json::Value>(event_json).is_err() {
            return Err(anyhow!("inject_event: invalid JSON"));
        }
        let js = format!(
            "if (typeof __dz_dispatch_event === 'function') __dz_dispatch_event({});",
            event_json
        );
        self.load_js("<event>", &js)
    }

    /// Dispatch a named CustomEvent on window, matching the documented API:
    ///   `dazzle s ev e <name> '<json>'` → `window.dispatchEvent(new CustomEvent(name, { detail: json }))`
    /// Content listens via: `window.addEventListener('<name>', e => e.detail)`
    pub fn dispatch_event(&mut self, name: &str, detail_json: &str) -> Result<()> {
        // Validate detail_json to prevent JS injection
        if serde_json::from_str::<serde_json::Value>(detail_json).is_err() {
            return Err(anyhow!("dispatch_event: invalid JSON detail"));
        }
        let js = format!(
            "window.dispatchEvent(new CustomEvent({}, {{ detail: {} }}));",
            serde_json::json!(name), // properly escape the event name
            detail_json,
        );
        self.load_js("<event>", &js)
    }

    /// Get a reference to the current framebuffer (RGBA pixels).
    pub fn get_framebuffer(&self) -> &[u8] {
        &self.state.framebuffer
    }

    /// Drain console log entries.
    pub fn drain_console_logs(&mut self) -> Vec<ConsoleEntry> {
        drain_console_logs_from_state(&mut self.state)
    }
}
