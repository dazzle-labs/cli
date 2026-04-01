//! Central resource limits for stage-runtime.
//!
//! All subsystem resource caps live here so they can be audited, tuned, and
//! compared against browser conventions (Chrome's Blink/Skia/V8) in one place.
//! Where a Chrome reference exists, the constant name or value is noted.

// =============================================================================
// DOM / HTML / CSS
// =============================================================================

/// Maximum DOM tree depth. Matches Chrome's `kMaximumHTMLParserDOMTreeDepth` (512).
/// Used in: dom.rs (script collection), style.rs (styled tree), layout.rs (taffy tree).
pub const MAX_DOM_DEPTH: usize = 512;

/// Maximum recursion depth for the paint tree walker.
/// Separate from DOM depth — painting can short-circuit earlier.
pub const MAX_PAINT_DEPTH: u32 = 256;

/// Maximum recursion depth for offset_children in paint.
pub const MAX_OFFSET_DEPTH: usize = 512;

/// Maximum concurrent overflow:hidden pixmap allocations in a single paint walk.
pub const MAX_OVERFLOW_PIXMAPS: u32 = 8;

/// Maximum dimension for backdrop-filter blur region (px).
pub const MAX_BACKDROP_BLUR_DIM: usize = 2048;

/// Maximum CSS custom property value length (bytes).
pub const MAX_CUSTOM_PROPERTY_LEN: usize = 4096;

/// Maximum distinct CSS custom properties per element.
pub const MAX_CUSTOM_PROPERTIES: usize = 1000;

/// Maximum aggregate custom property bytes per element (4 MB).
pub const MAX_CUSTOM_PROPERTIES_TOTAL_BYTES: usize = 4 * 1024 * 1024;

/// Maximum CSS `var()` recursion depth. Chrome uses cycle detection instead of
/// a depth limit; 32 is generous for real-world non-cyclic chains.
pub const MAX_VAR_DEPTH: u32 = 32;

/// Maximum resolved CSS `var()` output length (1 MB). Prevents exponential blowup
/// from cross-referencing custom properties.
pub const MAX_VAR_OUTPUT_LEN: usize = 1_048_576;

/// Maximum number of box-shadow declarations per element.
pub const MAX_BOX_SHADOWS: usize = 32;

// =============================================================================
// Canvas2D
// =============================================================================

/// Maximum canvas dimension per axis (8192x8192 = 256 MB RGBA).
/// Chrome allows up to 65535 per axis / 268M px area, but we target 1280x720 output.
pub const CANVAS2D_MAX_DIMENSION: u32 = 8192;

/// Maximum save()/restore() stack depth. Chrome is unbounded; 512 is generous.
pub const CANVAS2D_MAX_STATE_STACK_DEPTH: usize = 512;

/// Maximum path commands before beginPath()/fill()/stroke() flush.
pub const CANVAS2D_MAX_PATH_COMMANDS: usize = 1_000_000;

/// Maximum gradient objects per context.
pub const CANVAS2D_MAX_GRADIENTS: usize = 1024;

/// Maximum pattern objects per context.
pub const CANVAS2D_MAX_PATTERNS: usize = 1024;

/// Maximum color stops per gradient.
pub const CANVAS2D_MAX_GRADIENT_STOPS: usize = 256;

/// Maximum registered images per context.
pub const CANVAS2D_MAX_IMAGES: usize = 512;

/// Maximum line dash pattern segments.
pub const CANVAS2D_MAX_LINE_DASH: usize = 100;

/// Maximum custom fonts that can be registered.
pub const CANVAS2D_MAX_CUSTOM_FONTS: usize = 64;

// =============================================================================
// WebGL2
// =============================================================================

/// Maximum single buffer allocation (256 MB). Chrome is memory-bound (~2 GB).
pub const WEBGL2_MAX_BUFFER_SIZE: usize = 256 * 1024 * 1024;

/// Maximum total buffer memory across all buffers (512 MB).
pub const WEBGL2_MAX_TOTAL_BUFFER_BYTES: usize = 512 * 1024 * 1024;

/// Maximum texture dimension. Chrome reports 8192–16384 depending on GPU.
pub const WEBGL2_MAX_TEXTURE_SIZE: u32 = 8192;

/// Maximum total texture memory across all textures (512 MB).
pub const WEBGL2_MAX_TOTAL_TEXTURE_BYTES: usize = 512 * 1024 * 1024;

/// Maximum shader source length (1 MB).
pub const WEBGL2_MAX_SHADER_SOURCE_LEN: usize = 1024 * 1024;

/// Maximum shader objects.
pub const WEBGL2_MAX_SHADER_COUNT: usize = 256;

/// Maximum program objects.
pub const WEBGL2_MAX_PROGRAM_COUNT: usize = 256;

/// Maximum buffer objects.
pub const WEBGL2_MAX_BUFFER_COUNT: usize = 4096;

/// Maximum texture objects.
pub const WEBGL2_MAX_TEXTURE_COUNT: usize = 1024;

/// Maximum vertex array objects.
pub const WEBGL2_MAX_VAO_COUNT: usize = 1024;

/// Maximum framebuffer objects.
pub const WEBGL2_MAX_FRAMEBUFFER_COUNT: usize = 256;

/// Maximum renderbuffer objects.
pub const WEBGL2_MAX_RENDERBUFFER_COUNT: usize = 256;

/// Maximum misc objects (transform feedback, query, sampler).
pub const WEBGL2_MAX_MISC_OBJECT_COUNT: usize = 1024;

/// Maximum uniform locations per program.
pub const WEBGL2_MAX_UNIFORM_LOCATIONS_PER_PROGRAM: usize = 512;

/// Maximum pending GPU command buffers before forcing a flush.
pub const WEBGL2_MAX_PENDING_COMMANDS: usize = 1024;

// =============================================================================
// Audio
// =============================================================================

/// Maximum audio nodes per render context. Chrome is unbounded.
pub const AUDIO_MAX_NODES: usize = 4096;

/// Maximum buffer samples for source_buffer/shaper_curve (10M samples ~ 40 MB).
pub const AUDIO_MAX_BUFFER_SAMPLES: usize = 10_000_000;

/// Maximum audio commands per frame.
pub const AUDIO_MAX_COMMANDS_PER_FRAME: usize = 10_000;

/// Maximum aggregate audio memory (512 MB).
pub const AUDIO_MAX_TOTAL_BYTES: usize = 512 * 1024 * 1024;

/// Sliding window of audio frames to re-render (~10 sec at 30 fps).
pub const AUDIO_MAX_FRAMES: usize = 300;

/// Maximum PeriodicWave harmonics (8192 harmonics × 2 × 4 bytes = 64 KB).
pub const AUDIO_MAX_PERIODIC_WAVE_HARMONICS: usize = 8192;

/// Maximum WaveShaper curve length.
pub const AUDIO_MAX_CURVE_LEN: usize = 65536;

/// Maximum parameter value curve length.
pub const AUDIO_MAX_VALUE_CURVE_LEN: usize = 65536;

// =============================================================================
// Storage
// =============================================================================

/// Maximum localStorage keys. Chrome doesn't enforce a key count.
pub const STORAGE_MAX_KEYS: usize = 10_000;

/// Maximum serialized size of a single storage value (1 MB).
pub const STORAGE_MAX_VALUE_SIZE: usize = 1_024 * 1_024;

/// Maximum total storage size (10 MB). Matches Chrome's `kPerStorageAreaQuota`.
pub const STORAGE_MAX_TOTAL_SIZE: usize = 10 * 1024 * 1024;

// =============================================================================
// Content / Image Loading
// =============================================================================

/// Maximum image dimension per axis before decode is rejected.
pub const CONTENT_MAX_IMAGE_DIMENSION: u32 = 8192;

/// Maximum HTTP response body size for fetch/image loads (50 MB).
pub const CONTENT_MAX_RESPONSE_SIZE: usize = 50 * 1024 * 1024;

// =============================================================================
// Runtime / V8
// =============================================================================

/// Maximum concurrent background threads for fetch + WebSocket.
pub const RUNTIME_MAX_BACKGROUND_THREADS: usize = 32;

/// JS execution watchdog timeout (seconds). Kills `while(true){}`.
pub const RUNTIME_JS_EXECUTION_TIMEOUT_SECS: u64 = 5;

/// Maximum V8 string length for untrusted data (64 MB).
/// V8's internal limit is ~512 MB; we cap lower to bound allocation.
pub const RUNTIME_MAX_V8_STRING_LEN: usize = 64 * 1024 * 1024;

/// Maximum V8 JSON serialization depth.
pub const RUNTIME_MAX_V8_JSON_DEPTH: u32 = 64;

/// Maximum WebSocket message size (16 MB).
pub const RUNTIME_MAX_WS_MSG_SIZE: usize = 16 * 1024 * 1024;

/// Maximum console.log / console.assert buffer entries.
pub const RUNTIME_MAX_CONSOLE_ENTRIES: usize = 10_000;

/// Maximum console buffer total bytes (10 MB).
pub const RUNTIME_MAX_CONSOLE_BYTES: usize = 10 * 1024 * 1024;

// =============================================================================
// CDP (Chrome DevTools Protocol)
// =============================================================================

/// Read buffer size for CDP pipe (4 MB, sized for screenshot payloads).
pub const CDP_READ_BUFFER_SIZE: usize = 4 * 1024 * 1024;

/// Maximum CDP message size (1 MB).
pub const CDP_MAX_MESSAGE_SIZE: usize = 1 * 1024 * 1024;
