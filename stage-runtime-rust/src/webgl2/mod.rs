mod context;
pub mod gpu;
mod shader;
mod state;

pub use context::WebGL2;
pub use gpu::GpuBackend;
pub use shader::{preprocess_glsl, compile_glsl_to_wgsl, BindingLayout};

/// JavaScript polyfill implementing the WebGL2 API.
/// Methods push commands to __dz_webgl_cmds, Rust processes each frame.
pub const WEBGL2_JS: &str = include_str!("webgl2.js");

/// Check if a wgpu GPU adapter is available (for CI gating).
pub fn gpu_available() -> bool {
    gpu::GpuBackend::new(1, 1).is_some()
}
