mod context;
mod path;
pub mod state;
pub mod text;

pub use context::{Canvas2D, TextMetrics};

/// JavaScript polyfill that implements the Canvas 2D API.
/// Methods call native __dz_canvas_cmd() which dispatches directly to Canvas2D.
pub const CANVAS2D_JS: &str = include_str!("canvas2d.js");
