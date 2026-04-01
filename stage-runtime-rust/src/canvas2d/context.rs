use std::collections::HashMap;
use std::rc::Rc;
use tiny_skia::*;

use super::path::{self as path_builder, PathArgs, PathOp};
use super::state::{self, ColorStop, DrawState, GradientDef, PaintStyle, TextAlign, TextBaseline};
use crate::htmlcss::style::{CompositeOp, FontWeight, Opacity};

use super::text;

/// Text measurement result returned by `measure_text`.
pub struct TextMetrics {
    pub width: f64,
}

/// Canvas 2D rendering context backed by a tiny-skia Pixmap.
/// Stored pattern definition (tiling image data).
struct PatternDef {
    width: u32,
    height: u32,
    pixmap: Pixmap,
}

/// Decoded image stored in the image registry.
/// Uses Rc to allow borrowing image data without cloning during drawImage.
struct StoredImage {
    width: u32,
    height: u32,
    rgba: Rc<Vec<u8>>,
}

pub struct Canvas2D {
    pixmap: Pixmap,
    state: DrawState,
    state_stack: Vec<DrawState>,
    current_path: Vec<(PathOp, PathArgs)>,
    clip_mask: Option<Mask>,
    clip_mask_stack: Vec<Option<Mask>>,
    gradients: HashMap<String, GradientDef>,
    patterns: HashMap<String, PatternDef>,
    /// Image registry: ID → decoded RGBA pixels (populated by Rust image loader).
    images: HashMap<u32, StoredImage>,
    /// Set when any draw command is dispatched this frame; cleared by `take_frame_dirty()`.
    pub(crate) frame_dirty: bool,
}

impl Canvas2D {
    /// Maximum dimension for any pixmap allocation (8192x8192 = 256MB RGBA).
    const MAX_DIMENSION: u32 = 8192;
    /// Maximum total bytes for a single pixmap allocation.
    const MAX_PIXMAP_BYTES: usize = (Self::MAX_DIMENSION as usize) * (Self::MAX_DIMENSION as usize) * 4;
    /// Maximum save() stack depth (matches browser implementations).
    const MAX_STATE_STACK_DEPTH: usize = 512;
    /// Maximum path commands before beginPath()/fill()/stroke() flushes.
    const MAX_PATH_COMMANDS: usize = 1_000_000;
    /// Maximum gradient/pattern objects.
    const MAX_GRADIENTS: usize = 1024;
    const MAX_PATTERNS: usize = 1024;
    /// Maximum gradient color stops per gradient.
    const MAX_GRADIENT_STOPS: usize = 256;
    /// Maximum registered images.
    pub const MAX_IMAGES: usize = 512;
    /// Maximum line dash pattern length.
    const MAX_LINE_DASH: usize = 100;

    pub fn new(width: u32, height: u32) -> Self {
        // Clamp to at least 1x1 to prevent panic on zero dimensions
        let w = width.max(1).min(Self::MAX_DIMENSION);
        let h = height.max(1).min(Self::MAX_DIMENSION);
        Canvas2D {
            pixmap: Pixmap::new(w, h).unwrap_or_else(|| {
                log::error!("Failed to create pixmap {}x{}, falling back to 1x1", w, h);
                Pixmap::new(1, 1).unwrap()
            }),
            state: DrawState::default(),
            state_stack: Vec::new(),
            current_path: Vec::new(),
            clip_mask: None,
            clip_mask_stack: Vec::new(),
            gradients: HashMap::new(),
            patterns: HashMap::new(),
            images: HashMap::new(),
            frame_dirty: false,
        }
    }

    /// Returns true if any draw commands were dispatched since the last call,
    /// then resets the flag. Used by the compositor to decide whether to
    /// copy canvas pixels to the framebuffer.
    pub fn take_frame_dirty(&mut self) -> bool {
        std::mem::replace(&mut self.frame_dirty, false)
    }

    /// Return (width, height) of the underlying pixmap.
    pub fn dimensions(&self) -> (u32, u32) {
        (self.pixmap.width(), self.pixmap.height())
    }

    /// Return the number of registered images.
    pub fn image_count(&self) -> usize {
        self.images.len()
    }

    /// Register a decoded image in the image registry.
    /// Called by the runtime after loading an image from disk.
    pub fn register_image(&mut self, id: u32, width: u32, height: u32, rgba: Vec<u8>) {
        if self.images.len() >= Self::MAX_IMAGES && !self.images.contains_key(&id) {
            log::warn!("Canvas2D: image registry full ({} images), rejecting id={}", Self::MAX_IMAGES, id);
            return;
        }
        self.images.insert(id, StoredImage { width, height, rgba: Rc::new(rgba) });
    }

    /// Process a batch of canvas commands from JS (serde_json path).
    /// Each command is [opcode, ...args]. Used by WebGL2-style drain path.
    pub fn process_commands(&mut self, commands: &serde_json::Value) {
        let Some(cmds) = commands.as_array() else { return };

        for cmd in cmds {
            let Some(arr) = cmd.as_array() else { continue };
            if arr.is_empty() { continue; }
            let Some(op) = arr[0].as_str() else { continue; };

            // roundRect needs special handling: the radii parameter can be a
            // single number or a JSON array, which the generic f64 filter_map
            // can't flatten. Normalize to [x, y, w, h, tl, tr, br, bl].
            if op == "roundRect" && arr.len() >= 6 {
                let base: Vec<f64> = arr[1..5].iter().filter_map(|v| v.as_f64()).collect();
                if base.len() == 4 {
                    let radii_val = &arr[5];
                    let (tl, tr, br, bl) = if let Some(r) = radii_val.as_f64() {
                        (r, r, r, r)
                    } else if let Some(ra) = radii_val.as_array() {
                        let r: Vec<f64> = ra.iter().filter_map(|v| v.as_f64()).collect();
                        match r.len() {
                            1 => (r[0], r[0], r[0], r[0]),
                            2 => (r[0], r[1], r[0], r[1]),
                            3 => (r[0], r[1], r[2], r[1]),
                            4 => (r[0], r[1], r[2], r[3]),
                            _ => (0.0, 0.0, 0.0, 0.0),
                        }
                    } else {
                        (0.0, 0.0, 0.0, 0.0)
                    };
                    let args = [base[0], base[1], base[2], base[3], tl, tr, br, bl];
                    self.dispatch_command(op, &args, &[]);
                    continue;
                }
            }

            let args: Vec<f64> = arr[1..].iter().filter_map(|v| {
                v.as_f64().or_else(|| v.as_bool().map(|b| if b { 1.0 } else { 0.0 }))
            }).collect();
            let str_args: Vec<&str> = arr[1..].iter().filter_map(|v| v.as_str()).collect();
            self.dispatch_command(op, &args, &str_args);
        }
    }

    /// Dispatch a single canvas command. Called directly by native V8 callbacks
    /// (zero-copy from JS args) or by `process_commands` (serde_json batch path).
    pub fn dispatch_command(&mut self, op: &str, args: &[f64], str_args: &[&str]) {
        self.frame_dirty = true;
        match op {
                // --- State ---
                "save" => self.save(),
                "restore" => self.restore(),

                // --- Transform ---
                "setTransform" if args.len() >= 6 => {
                    // Per spec: "If any of the arguments are infinite or NaN, then return"
                    if args[..6].iter().all(|v| v.is_finite()) {
                        self.state.transform = Transform::from_row(
                            args[0] as f32, args[1] as f32,
                            args[2] as f32, args[3] as f32,
                            args[4] as f32, args[5] as f32,
                        );
                    }
                }
                "translate" if args.len() >= 2 => {
                    if args[0].is_finite() && args[1].is_finite() {
                        self.state.transform = self.state.transform.pre_translate(args[0] as f32, args[1] as f32);
                    }
                }
                "rotate" if args.len() >= 1 => {
                    if args[0].is_finite() {
                        let angle = args[0] as f32;
                        let cos = angle.cos();
                        let sin = angle.sin();
                        let rot = Transform::from_row(cos, sin, -sin, cos, 0.0, 0.0);
                        self.state.transform = self.state.transform.pre_concat(rot);
                    }
                }
                "scale" if args.len() >= 2 => {
                    if args[0].is_finite() && args[1].is_finite() {
                        self.state.transform = self.state.transform.pre_scale(args[0] as f32, args[1] as f32);
                    }
                }
                "resetTransform" => {
                    self.state.transform = Transform::identity();
                }
                "transform" if args.len() >= 6 => {
                    if args[..6].iter().all(|v| v.is_finite()) {
                        let t = Transform::from_row(
                            args[0] as f32, args[1] as f32,
                            args[2] as f32, args[3] as f32,
                            args[4] as f32, args[5] as f32,
                        );
                        self.state.transform = self.state.transform.pre_concat(t);
                    }
                }

                // --- Style ---
                "fillStyle" if !str_args.is_empty() => {
                    if let Some(c) = state::parse_color(str_args[0]) {
                        self.state.fill_color = c;
                        self.state.fill_style = PaintStyle::Color(c);
                    }
                }
                "strokeStyle" if !str_args.is_empty() => {
                    if let Some(c) = state::parse_color(str_args[0]) {
                        self.state.stroke_color = c;
                        self.state.stroke_style = PaintStyle::Color(c);
                    }
                }
                "lineWidth" if args.len() >= 1 => {
                    if args[0].is_finite() && args[0] > 0.0 {
                        self.state.line_width = args[0] as f32;
                    }
                }
                "lineCap" if !str_args.is_empty() => {
                    self.state.line_cap = match str_args[0] {
                        "round" => LineCap::Round,
                        "square" => LineCap::Square,
                        _ => LineCap::Butt,
                    };
                }
                "lineJoin" if !str_args.is_empty() => {
                    self.state.line_join = match str_args[0] {
                        "round" => LineJoin::Round,
                        "bevel" => LineJoin::Bevel,
                        _ => LineJoin::Miter,
                    };
                }
                "miterLimit" if args.len() >= 1 => {
                    if args[0].is_finite() && args[0] > 0.0 {
                        self.state.miter_limit = args[0] as f32;
                    }
                }
                "globalAlpha" if args.len() >= 1 => {
                    self.state.global_alpha = Opacity::new(args[0] as f32);
                }
                "font" if !str_args.is_empty() => {
                    parse_font(str_args[0], &mut self.state);
                }
                "textAlign" if !str_args.is_empty() => {
                    self.state.text_align = match str_args[0] {
                        "left" => TextAlign::Left,
                        "right" => TextAlign::Right,
                        "center" => TextAlign::Center,
                        "end" => TextAlign::End,
                        _ => TextAlign::Start,
                    };
                }
                "textBaseline" if !str_args.is_empty() => {
                    self.state.text_baseline = match str_args[0] {
                        "top" => TextBaseline::Top,
                        "hanging" => TextBaseline::Hanging,
                        "middle" => TextBaseline::Middle,
                        "ideographic" => TextBaseline::Ideographic,
                        "bottom" => TextBaseline::Bottom,
                        _ => TextBaseline::Alphabetic,
                    };
                }
                "shadowBlur" if args.len() >= 1 => {
                    // Clamp to 150 (matches Chrome effective behavior) to prevent
                    // massive temporary pixmap allocations with adversarial values.
                    self.state.shadow_blur = (args[0] as f32).clamp(0.0, 150.0);
                }
                "shadowColor" if !str_args.is_empty() => {
                    if let Some(c) = state::parse_color(str_args[0]) {
                        self.state.shadow_color = c;
                    }
                }
                "shadowOffsetX" if args.len() >= 1 => {
                    if args[0].is_finite() {
                        self.state.shadow_offset_x = (args[0] as f32).clamp(-1e6, 1e6);
                    }
                }
                "shadowOffsetY" if args.len() >= 1 => {
                    if args[0].is_finite() {
                        self.state.shadow_offset_y = (args[0] as f32).clamp(-1e6, 1e6);
                    }
                }
                "globalCompositeOperation" if !str_args.is_empty() => {
                    self.state.composite_op = CompositeOp::parse(str_args[0]);
                }
                "imageSmoothingEnabled" if args.len() >= 1 => {
                    self.state.image_smoothing = args[0] != 0.0;
                }
                "setLineDash" => {
                    self.state.line_dash = args.iter().take(Self::MAX_LINE_DASH).map(|&v| v as f32).collect();
                }
                "lineDashOffset" if args.len() >= 1 => {
                    self.state.line_dash_offset = args[0] as f32;
                }

                // --- Rect drawing ---
                "fillRect" if args.len() >= 4 => {
                    if let PaintStyle::Pattern(ref id) = self.state.fill_style {
                        let id = id.clone();
                        self.fill_rect_pattern(args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32, &id);
                    } else {
                        self.fill_rect(args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32);
                    }
                }
                "strokeRect" if args.len() >= 4 => {
                    self.stroke_rect(args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32);
                }
                "clearRect" if args.len() >= 4 => {
                    self.clear_rect(args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32);
                }

                // --- Path ---
                "beginPath" => {
                    self.current_path.clear();
                }
                "closePath" | "moveTo" | "lineTo" | "bezierCurveTo"
                | "quadraticCurveTo" | "arc" | "arcTo" | "ellipse" => {
                    // Guard against unbounded path growth (OOM DoS).
                    if self.current_path.len() >= Self::MAX_PATH_COMMANDS { return; }
                    // Transform coordinates by current CTM at capture time per Canvas 2D spec.
                    // Path commands record positions in device space so that mid-path
                    // transform changes are correctly handled.
                    if let Some(path_op) = PathOp::from_str(op) {
                        let transformed_args = self.transform_path_args(path_op, &args);
                        self.current_path.push((path_op, transformed_args));
                    }
                }
                "rect" | "rect_path" if args.len() >= 4 => {
                    // Decompose rect into moveTo/lineTo/close so each corner is
                    // properly transformed (handles rotation, skew, etc.)
                    let x = args[0];
                    let y = args[1];
                    let w = args[2];
                    let h = args[3];
                    let corners = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)];
                    let mt = self.transform_path_args(PathOp::MoveTo, &[corners[0].0, corners[0].1]);
                    self.current_path.push((PathOp::MoveTo, mt));
                    for &(cx, cy) in &corners[1..] {
                        let lt = self.transform_path_args(PathOp::LineTo, &[cx, cy]);
                        self.current_path.push((PathOp::LineTo, lt));
                    }
                    self.current_path.push((PathOp::ClosePath, PathArgs::new()));
                }
                "roundRect" if args.len() >= 8 => {
                    // args: [x, y, w, h, tl, tr, br, bl] — corner radii
                    let x = args[0];
                    let y = args[1];
                    let w = args[2];
                    let h = args[3];
                    let tl = args[4].max(0.0);
                    let tr = args[5].max(0.0);
                    let br = args[6].max(0.0);
                    let bl = args[7].max(0.0);

                    // Decompose rounded rect into moveTo + lineTo + arcTo calls.
                    // This matches Chrome's internal implementation which uses arcTo
                    // for each corner, producing the same conic-section-based arcs
                    // that Skia renders.

                    // Start at top edge after TL radius
                    let mt = self.transform_path_args(PathOp::MoveTo, &[x + tl, y]);
                    self.current_path.push((PathOp::MoveTo, mt));

                    // Top edge → top-right corner (arcTo through corner to right edge)
                    let lt = self.transform_path_args(PathOp::LineTo, &[x + w - tr, y]);
                    self.current_path.push((PathOp::LineTo, lt));
                    if tr > 0.0 {
                        let a = self.transform_path_args(PathOp::ArcTo, &[x + w, y, x + w, y + tr, tr]);
                        self.current_path.push((PathOp::ArcTo, a));
                    }

                    // Right edge → bottom-right corner
                    let lt = self.transform_path_args(PathOp::LineTo, &[x + w, y + h - br]);
                    self.current_path.push((PathOp::LineTo, lt));
                    if br > 0.0 {
                        let a = self.transform_path_args(PathOp::ArcTo, &[x + w, y + h, x + w - br, y + h, br]);
                        self.current_path.push((PathOp::ArcTo, a));
                    }

                    // Bottom edge → bottom-left corner
                    let lt = self.transform_path_args(PathOp::LineTo, &[x + bl, y + h]);
                    self.current_path.push((PathOp::LineTo, lt));
                    if bl > 0.0 {
                        let a = self.transform_path_args(PathOp::ArcTo, &[x, y + h, x, y + h - bl, bl]);
                        self.current_path.push((PathOp::ArcTo, a));
                    }

                    // Left edge → top-left corner
                    let lt = self.transform_path_args(PathOp::LineTo, &[x, y + tl]);
                    self.current_path.push((PathOp::LineTo, lt));
                    if tl > 0.0 {
                        let a = self.transform_path_args(PathOp::ArcTo, &[x, y, x + tl, y, tl]);
                        self.current_path.push((PathOp::ArcTo, a));
                    }

                    self.current_path.push((PathOp::ClosePath, PathArgs::new()));
                }
                "reset" => {
                    // Reset canvas: clear pixmap, reset state, clear path, gradients, patterns
                    self.pixmap.fill(Color::TRANSPARENT);
                    self.state = DrawState::default();
                    self.state_stack.clear();
                    self.current_path.clear();
                    self.clip_mask = None;
                    self.clip_mask_stack.clear();
                    self.gradients.clear();
                    self.patterns.clear();
                    self.images.clear();
                }
                "fill" => self.fill_path(),
                "stroke" => self.stroke_path(),
                "clip" => self.clip_path(),

                // --- Text ---
                "fillText" if !str_args.is_empty() && args.len() >= 2 => {
                    text::render_text(&mut self.pixmap, str_args[0], args[0] as f32, args[1] as f32, &self.state, true);
                }
                "strokeText" if !str_args.is_empty() && args.len() >= 2 => {
                    text::render_text(&mut self.pixmap, str_args[0], args[0] as f32, args[1] as f32, &self.state, false);
                }

                // --- Image ---
                "putImageData" if args.len() >= 2 => {
                    // args: [dx, dy, width, height, ...rgba_pixels]
                    if args.len() >= 4 {
                        let dx = args[0] as i32;
                        let dy = args[1] as i32;
                        let w = args[2] as u32;
                        let h = args[3] as u32;
                        let pixels: Vec<u8> = args[4..].iter().map(|&v| v as u8).collect();
                        self.put_image_data(dx, dy, w, h, &pixels);
                    }
                }

                // --- Gradients ---
                "_createLinearGradient" if str_args.len() >= 1 && args.len() >= 4 => {
                    if self.gradients.len() >= Self::MAX_GRADIENTS { return; }
                    let id = str_args[0].to_string();
                    self.gradients.insert(id, GradientDef::Linear {
                        x0: args[0] as f32,
                        y0: args[1] as f32,
                        x1: args[2] as f32,
                        y1: args[3] as f32,
                        stops: Vec::new(),
                    });
                }
                "_createRadialGradient" if str_args.len() >= 1 && args.len() >= 6 => {
                    if self.gradients.len() >= Self::MAX_GRADIENTS { return; }
                    let id = str_args[0].to_string();
                    self.gradients.insert(id, GradientDef::Radial {
                        x0: args[0] as f32,
                        y0: args[1] as f32,
                        r0: args[2] as f32,
                        x1: args[3] as f32,
                        y1: args[4] as f32,
                        r1: args[5] as f32,
                        stops: Vec::new(),
                    });
                }
                "_addColorStop" if str_args.len() >= 2 && args.len() >= 1 => {
                    // str_args[0] = gradient ID, str_args[1] = color string
                    // args[0] = offset — spec requires [0, 1], reject otherwise
                    let id = str_args[0];
                    let offset = args[0] as f32;
                    if !(0.0..=1.0).contains(&offset) {
                        // Per Canvas 2D spec: INDEX_SIZE_ERR for out-of-range offsets
                        // Silently ignore (no JS exception mechanism here)
                        return;
                    }
                    if let Some(color) = state::parse_color(str_args[1]) {
                        if let Some(grad) = self.gradients.get_mut(id) {
                            let stops = match grad {
                                GradientDef::Linear { stops, .. } => stops,
                                GradientDef::Radial { stops, .. } => stops,
                            };
                            if stops.len() >= Self::MAX_GRADIENT_STOPS { return; }
                            let stop = ColorStop { offset, color };
                            // Insert sorted by offset so we don't need to sort per draw
                            let pos = stops.partition_point(|s| s.offset < offset);
                            stops.insert(pos, stop);
                        }
                    }
                }
                "_setFillGradient" if str_args.len() >= 1 => {
                    self.state.fill_style = PaintStyle::Gradient(str_args[0].to_string());
                }
                "_setStrokeGradient" if str_args.len() >= 1 => {
                    self.state.stroke_style = PaintStyle::Gradient(str_args[0].to_string());
                }

                // --- Patterns ---
                // Inline: ["_createPattern", id, repeat, w, h, r,g,b,a, ...]
                "_createPattern" if str_args.len() >= 2 && args.len() >= 2 => {
                    if self.patterns.len() >= Self::MAX_PATTERNS { return; }
                    let id = str_args[0].to_string();
                    // Check if second arg is an image ID (from image registry)
                    if args.len() == 1 {
                        // Image-ID based: ["_createPattern", patternId, imageId, repeat]
                        let img_id = args[0] as u32;
                        if let Some(img) = self.images.get(&img_id) {
                            let (w, h, rgba) = (img.width, img.height, img.rgba.clone());
                            if let Some(pm) = Self::make_premultiplied_pixmap_static(w, h, &rgba) {
                                self.patterns.insert(id, PatternDef { width: w, height: h, pixmap: pm });
                            }
                        }
                    } else {
                        // Inline pixel data: ["_createPattern", id, repeat, w, h, r,g,b,a, ...]
                        let w = args[0] as u32;
                        let h = args[1] as u32;
                        let pixels: Vec<u8> = args[2..].iter().map(|&v| v as u8).collect();
                        let expected = (w * h * 4) as usize;
                        if pixels.len() >= expected && w > 0 && h > 0 {
                            if let Some(pm) = Self::make_premultiplied_pixmap_static(w, h, &pixels) {
                                self.patterns.insert(id, PatternDef { width: w, height: h, pixmap: pm });
                            }
                        }
                    }
                }
                "_setFillPattern" if str_args.len() >= 1 => {
                    self.state.fill_style = PaintStyle::Pattern(str_args[0].to_string());
                }
                "_setStrokePattern" if str_args.len() >= 1 => {
                    self.state.stroke_style = PaintStyle::Pattern(str_args[0].to_string());
                }

                // --- drawImage with inline pixel data (natural size) ---
                // Format: ["drawImage", "__inline", dx, dy, w, h, r,g,b,a, ...]
                "drawImage" if str_args.first() == Some(&"__inline") && args.len() >= 4 => {
                    let dx = args[0] as i32;
                    let dy = args[1] as i32;
                    let w = args[2] as u32;
                    let h = args[3] as u32;
                    let pixels: Vec<u8> = args[4..].iter().map(|&v| v as u8).collect();
                    let expected = (w * h * 4) as usize;
                    if pixels.len() >= expected {
                        self.draw_image_rgba(dx, dy, w, h, &pixels);
                    }
                }

                // --- drawImage with inline pixel data (5-arg: scaled) ---
                // Format: ["drawImage", "__inline5", dx, dy, dw, dh, srcW, srcH, r,g,b,a, ...]
                "drawImage" if str_args.first() == Some(&"__inline5") && args.len() >= 6 => {
                    let dx = args[0] as f32;
                    let dy = args[1] as f32;
                    let dw = args[2] as f32;
                    let dh = args[3] as f32;
                    let src_w = args[4] as u32;
                    let src_h = args[5] as u32;
                    let pixels: Vec<u8> = args[6..].iter().map(|&v| v as u8).collect();
                    let expected = (src_w * src_h * 4) as usize;
                    if pixels.len() >= expected && dw > 0.0 && dh > 0.0 && src_w > 0 && src_h > 0 {
                        if let Some(src_pm) = Self::make_premultiplied_pixmap_static(src_w, src_h, &pixels) {
                            let sx = dw / src_w as f32;
                            let sy = dh / src_h as f32;
                            let pp = PixmapPaint {
                                opacity: self.state.global_alpha.value(),
                                blend_mode: self.state.composite_op.to_blend_mode(),
                                quality: self.image_filter_quality(),
                            };
                            let mask = self.clip_mask.as_ref();
                            let t = self.state.transform
                                .pre_translate(dx, dy)
                                .pre_scale(sx, sy);
                            self.pixmap.draw_pixmap(0, 0, src_pm.as_ref(), &pp, t, mask);
                        }
                    }
                }

                // --- drawImage with inline pixel data (9-arg: crop + scale) ---
                // Format: ["drawImage", "__inline9", sx, sy, sw, sh, dx, dy, dw, dh, srcW, srcH, r,g,b,a, ...]
                "drawImage" if str_args.first() == Some(&"__inline9") && args.len() >= 10 => {
                    let crop_x = args[0] as u32;
                    let crop_y = args[1] as u32;
                    let crop_w = args[2] as u32;
                    let crop_h = args[3] as u32;
                    let dx = args[4] as f32;
                    let dy = args[5] as f32;
                    let dw = args[6] as f32;
                    let dh = args[7] as f32;
                    let src_w = args[8] as u32;
                    let src_h = args[9] as u32;
                    let pixels: Vec<u8> = args[10..].iter().map(|&v| v as u8).collect();
                    let expected = (src_w * src_h * 4) as usize;
                    if pixels.len() >= expected && crop_w > 0 && crop_h > 0 && dw > 0.0 && dh > 0.0 {
                        let cropped = Self::crop_image_rgba_static(src_w, &pixels, crop_x, crop_y, crop_w, crop_h);
                        if let Some(src_pm) = Self::make_premultiplied_pixmap_static(crop_w, crop_h, &cropped) {
                            let sx = dw / crop_w as f32;
                            let sy = dh / crop_h as f32;
                            let pp = PixmapPaint {
                                opacity: self.state.global_alpha.value(),
                                blend_mode: self.state.composite_op.to_blend_mode(),
                                quality: self.image_filter_quality(),
                            };
                            let mask = self.clip_mask.as_ref();
                            let t = self.state.transform
                                .pre_translate(dx, dy)
                                .pre_scale(sx, sy);
                            self.pixmap.draw_pixmap(0, 0, src_pm.as_ref(), &pp, t, mask);
                        }
                    }
                }

                // --- drawImage with image ID from registry ---
                // 3-arg: ["drawImage", id, dx, dy]
                // 5-arg: ["drawImage", id, dx, dy, dw, dh]
                // 9-arg: ["drawImage", id, sx, sy, sw, sh, dx, dy, dw, dh]
                "drawImage" if args.len() >= 3 => {
                    let id = args[0] as u32;
                    self.draw_image_by_id(id, &args[1..]);
                }

                _ => {
                    // Silently ignore unknown commands
                }
            }
    }

    /// Copy pixels to the output framebuffer (RGBA).
    ///
    /// tiny-skia stores premultiplied RGBA; this converts to straight RGBA.
    /// Only used by tests (production uses `read_pixels_premultiplied`).
    pub fn read_pixels(&self, output: &mut [u8]) {
        let data = self.pixmap.data();
        let len = output.len().min(data.len());
        for (src, dst) in data[..len].chunks_exact(4).zip(output[..len].chunks_exact_mut(4)) {
            let a = src[3];
            if a == 255 || a == 0 {
                dst.copy_from_slice(src);
            } else {
                let a_f = a as f32 / 255.0;
                dst[0] = (src[0] as f32 / a_f).round().min(255.0) as u8;
                dst[1] = (src[1] as f32 / a_f).round().min(255.0) as u8;
                dst[2] = (src[2] as f32 / a_f).round().min(255.0) as u8;
                dst[3] = a;
            }
        }
    }

    /// Copy raw premultiplied RGBA pixels to the output buffer.
    ///
    /// Skips the unpremultiply conversion — use this when the consumer
    /// doesn't need straight alpha (e.g. video encoder doing RGBA→YUV).
    pub fn read_pixels_premultiplied(&self, output: &mut [u8]) {
        let data = self.pixmap.data();
        let len = output.len().min(data.len());
        output[..len].copy_from_slice(&data[..len]);
    }

    pub fn width(&self) -> u32 { self.pixmap.width() }
    pub fn height(&self) -> u32 { self.pixmap.height() }

    /// Read back a sub-rect of the canvas as straight RGBA pixels.
    pub fn get_image_data(&self, x: u32, y: u32, w: u32, h: u32) -> Vec<u8> {
        let total_bytes = (w as u64).saturating_mul(h as u64).saturating_mul(4);
        if total_bytes > Self::MAX_PIXMAP_BYTES as u64 {
            return Vec::new();
        }
        let mut result = vec![0u8; total_bytes as usize];
        let pm_w = self.pixmap.width();
        let pm_h = self.pixmap.height();
        let data = self.pixmap.data();

        for row in 0..h {
            for col in 0..w {
                let px = x + col;
                let py = y + row;
                if px >= pm_w || py >= pm_h {
                    continue;
                }
                let src = ((py * pm_w + px) * 4) as usize;
                let dst = ((row * w + col) * 4) as usize;
                let a = data[src + 3] as f32 / 255.0;
                if a > 0.0 {
                    result[dst] = (data[src] as f32 / a).round().min(255.0) as u8;
                    result[dst + 1] = (data[src + 1] as f32 / a).round().min(255.0) as u8;
                    result[dst + 2] = (data[src + 2] as f32 / a).round().min(255.0) as u8;
                    result[dst + 3] = data[src + 3];
                }
            }
        }
        result
    }

    /// Measure text width using fontdue glyph metrics.
    pub fn measure_text(&self, text_str: &str, font_spec: &str) -> TextMetrics {
        let mut size = self.state.font_size;
        let mut bold = self.state.font_weight.is_bold();
        for part in font_spec.split_whitespace() {
            if part.ends_with("px") {
                if let Ok(s) = part.trim_end_matches("px").parse::<f32>() {
                    size = s;
                }
            } else if part == "bold" {
                bold = true;
            }
        }
        let width = text::measure_text_with(text_str, size, bold) as f64;
        TextMetrics { width }
    }

    /// Transform path command arguments by the current CTM.
    /// Canvas 2D spec: path coordinates are transformed at the time the
    /// path command is issued, not at fill/stroke time.
    fn transform_path_args(&self, op: PathOp, args: &[f64]) -> PathArgs {
        let t = &self.state.transform;
        let tx = |x: f64, y: f64| -> (f64, f64) {
            let rx = t.sx as f64 * x + t.kx as f64 * y + t.tx as f64;
            let ry = t.ky as f64 * x + t.sy as f64 * y + t.ty as f64;
            (rx, ry)
        };
        match op {
            PathOp::MoveTo | PathOp::LineTo if args.len() >= 2 => {
                let (x, y) = tx(args[0], args[1]);
                PathArgs::from_slice(&[x, y])
            }
            PathOp::BezierCurveTo if args.len() >= 6 => {
                let (x1, y1) = tx(args[0], args[1]);
                let (x2, y2) = tx(args[2], args[3]);
                let (x3, y3) = tx(args[4], args[5]);
                PathArgs::from_slice(&[x1, y1, x2, y2, x3, y3])
            }
            PathOp::QuadraticCurveTo if args.len() >= 4 => {
                let (x1, y1) = tx(args[0], args[1]);
                let (x2, y2) = tx(args[2], args[3]);
                PathArgs::from_slice(&[x1, y1, x2, y2])
            }
            PathOp::Arc if args.len() >= 5 => {
                let (cx, cy) = tx(args[0], args[1]);
                let sx = (t.sx * t.sx + t.kx * t.kx).sqrt() as f64;
                let r = args[2] * sx;
                if args.len() > 5 {
                    PathArgs::from_slice(&[cx, cy, r, args[3], args[4], args[5]])
                } else {
                    PathArgs::from_slice(&[cx, cy, r, args[3], args[4]])
                }
            }
            PathOp::Ellipse if args.len() >= 7 => {
                let (cx, cy) = tx(args[0], args[1]);
                let sx = (t.sx * t.sx + t.kx * t.kx).sqrt() as f64;
                let sy = (t.sy * t.sy + t.ky * t.ky).sqrt() as f64;
                let rx = args[2] * sx;
                let ry = args[3] * sy;
                let t_rotation = (t.kx as f64).atan2(t.sx as f64);
                let rotation = args[4] + t_rotation;
                if args.len() > 7 {
                    PathArgs::from_slice(&[cx, cy, rx, ry, rotation, args[5], args[6], args[7]])
                } else {
                    PathArgs::from_slice(&[cx, cy, rx, ry, rotation, args[5], args[6]])
                }
            }
            PathOp::ArcTo if args.len() >= 5 => {
                let (x1, y1) = tx(args[0], args[1]);
                let (x2, y2) = tx(args[2], args[3]);
                let sx = (t.sx * t.sx + t.kx * t.kx).sqrt() as f64;
                let r = args[4] * sx;
                PathArgs::from_slice(&[x1, y1, x2, y2, r])
            }
            PathOp::Rect if args.len() >= 4 => {
                let (x, y) = tx(args[0], args[1]);
                let sx = (t.sx * t.sx + t.kx * t.kx).sqrt() as f64;
                let sy = (t.sy * t.sy + t.ky * t.ky).sqrt() as f64;
                PathArgs::from_slice(&[x, y, args[2] * sx, args[3] * sy])
            }
            PathOp::ClosePath => PathArgs::new(),
            _ => PathArgs::from_slice(args),
        }
    }

    // --- Private ---

    fn save(&mut self) {
        if self.state_stack.len() >= Self::MAX_STATE_STACK_DEPTH {
            return; // prevent memory exhaustion from unbounded save() calls
        }
        self.state_stack.push(self.state.clone());
        self.clip_mask_stack.push(self.clip_mask.clone());
    }

    fn restore(&mut self) {
        // Pop both stacks together to keep them in sync
        if let (Some(s), Some(mask)) = (self.state_stack.pop(), self.clip_mask_stack.pop()) {
            self.state = s;
            self.clip_mask = mask;
        }
    }

    fn fill_rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        // Normalize negative dimensions per Canvas 2D spec
        let (x, w) = if w < 0.0 { (x + w, -w) } else { (x, w) };
        let (y, h) = if h < 0.0 { (y + h, -h) } else { (y, h) };
        let Some(rect) = Rect::from_xywh(x, y, w, h) else { return };
        self.apply_copy_clear();
        if self.has_shadow() {
            self.draw_blurred_shadow(|pm, paint, t| {
                pm.fill_rect(rect, paint, t, None);
            });
        }
        if self.needs_masking_composite() {
            self.draw_with_masking_composite(|pm, paint, t, mask| {
                pm.fill_rect(rect, paint, t, mask);
            });
        } else {
            let paint = self.fill_paint();
            let mask = self.clip_mask.as_ref();
            self.pixmap.fill_rect(rect, &paint, self.state.transform, mask);
        }
    }

    fn stroke_rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        let (x, w) = if w < 0.0 { (x + w, -w) } else { (x, w) };
        let (y, h) = if h < 0.0 { (y + h, -h) } else { (y, h) };
        let mut pb = PathBuilder::new();
        pb.move_to(x, y);
        pb.line_to(x + w, y);
        pb.line_to(x + w, y + h);
        pb.line_to(x, y + h);
        pb.close();
        if let Some(path) = pb.finish() {
            if self.has_shadow() {
                let stroke = self.stroke_style();
                self.draw_blurred_shadow(|pm, paint, t| {
                    pm.stroke_path(&path, paint, &stroke, t, None);
                });
            }
            if self.needs_masking_composite() {
                self.draw_with_masking_composite_stroke(|pm, paint, stroke, t, mask| {
                    pm.stroke_path(&path, paint, stroke, t, mask);
                });
            } else {
                let paint = self.stroke_paint();
                let stroke = self.stroke_style();
                let mask = self.clip_mask.as_ref();
                self.pixmap.stroke_path(&path, &paint, &stroke, self.state.transform, mask);
            }
        }
    }

    fn clear_rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        let (x, w) = if w < 0.0 { (x + w, -w) } else { (x, w) };
        let (y, h) = if h < 0.0 { (y + h, -h) } else { (y, h) };
        let Some(rect) = Rect::from_xywh(x, y, w, h) else { return };
        let mut paint = Paint::default();
        paint.set_color(Color::from_rgba8(0, 0, 0, 0));
        paint.blend_mode = BlendMode::Clear;
        let mask = self.clip_mask.as_ref();
        self.pixmap.fill_rect(rect, &paint, self.state.transform, mask);
    }

    fn fill_path(&mut self) {
        if let Some(path) = path_builder::build_path(&self.current_path) {
            self.apply_copy_clear();
            // Path coordinates are already in device space (transformed at capture time),
            // so we use identity transform here.
            let identity = Transform::identity();
            if self.has_shadow() {
                self.draw_blurred_shadow_device(|pm, paint, t| {
                    pm.fill_path(&path, paint, FillRule::Winding, t, None);
                });
            }
            if self.needs_masking_composite() {
                // For masking composite ops, draw to temp pixmap with identity
                // (path coords are already in device space)
                let w = self.pixmap.width();
                let h = self.pixmap.height();
                if let Some(mut tmp) = Pixmap::new(w, h) {
                    let mut paint = self.fill_paint();
                    paint.blend_mode = BlendMode::SourceOver;
                    tmp.fill_path(&path, &paint, FillRule::Winding, identity, None);
                    let pp = PixmapPaint {
                        opacity: 1.0,
                        blend_mode: self.state.composite_op.to_blend_mode(),
                        quality: tiny_skia::FilterQuality::Nearest,
                    };
                    let mask = self.clip_mask.as_ref();
                    self.pixmap.draw_pixmap(0, 0, tmp.as_ref(), &pp, Transform::identity(), mask);
                }
            } else {
                let paint = self.fill_paint();
                let mask = self.clip_mask.as_ref();
                self.pixmap.fill_path(&path, &paint, FillRule::Winding, identity, mask);
            }
        }
    }

    fn stroke_path(&mut self) {
        if let Some(path) = path_builder::build_path(&self.current_path) {
            self.apply_copy_clear();
            if self.has_shadow() {
                let stroke = self.stroke_style();
                self.draw_blurred_shadow_device(|pm, paint, t| {
                    pm.stroke_path(&path, paint, &stroke, t, None);
                });
            }
            if self.needs_masking_composite() {
                // Path coords are already in device space — use identity transform
                let w = self.pixmap.width();
                let h = self.pixmap.height();
                if let Some(mut tmp) = Pixmap::new(w, h) {
                    let mut paint = self.stroke_paint();
                    paint.blend_mode = BlendMode::SourceOver;
                    let stroke = self.stroke_style();
                    tmp.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                    let pp = PixmapPaint {
                        opacity: 1.0,
                        blend_mode: self.state.composite_op.to_blend_mode(),
                        quality: tiny_skia::FilterQuality::Nearest,
                    };
                    let mask = self.clip_mask.as_ref();
                    self.pixmap.draw_pixmap(0, 0, tmp.as_ref(), &pp, Transform::identity(), mask);
                }
            } else {
                let paint = self.stroke_paint();
                let stroke = self.stroke_style();
                let mask = self.clip_mask.as_ref();
                // Path coordinates are already in device space (transformed at capture time),
                // so use identity here — same as fill_path.
                self.pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), mask);
            }
        }
    }

    fn clip_path(&mut self) {
        if let Some(path) = path_builder::build_path(&self.current_path) {
            // Path coordinates are already in device space (transformed at capture time)
            let identity = Transform::identity();
            if let Some(existing) = &mut self.clip_mask {
                existing.intersect_path(&path, FillRule::Winding, true, identity);
            } else {
                let w = self.pixmap.width();
                let h = self.pixmap.height();
                let Some(mut new_mask) = Mask::new(w, h) else { return };
                new_mask.fill_path(&path, FillRule::Winding, true, identity);
                self.clip_mask = Some(new_mask);
            }
        }
    }

    /// Render a shadow with Gaussian blur. `draw_fn` should draw the shape
    /// onto the provided pixmap using the given paint and transform.
    fn draw_blurred_shadow<F>(&mut self, draw_fn: F)
    where
        F: FnOnce(&mut Pixmap, &Paint<'_>, Transform),
    {
        let blur = self.state.shadow_blur;
        let ox = self.state.shadow_offset_x;
        let oy = self.state.shadow_offset_y;
        let shadow_paint = self.shadow_paint();

        if blur <= 0.0 {
            // No blur — draw directly with offset
            let st = self.state.transform.pre_translate(ox, oy);
            let mask = self.clip_mask.as_ref();
            // Draw directly onto main pixmap
            let Some(mut tmp) = Pixmap::new(self.pixmap.width(), self.pixmap.height()) else { return };
            draw_fn(&mut tmp, &shadow_paint, st);
            let pp = PixmapPaint {
                opacity: 1.0,
                blend_mode: tiny_skia::BlendMode::SourceOver,
                quality: tiny_skia::FilterQuality::Nearest,
            };
            self.pixmap.draw_pixmap(0, 0, tmp.as_ref(), &pp, Transform::identity(), mask);
            return;
        }

        // With blur: render to a temp pixmap with padding, blur, composite
        let blur_padding = (blur * 2.0).ceil().min(512.0) as i32 + 2;
        let pw = (self.pixmap.width() as i32).saturating_add(blur_padding.saturating_mul(2));
        let ph = (self.pixmap.height() as i32).saturating_add(blur_padding.saturating_mul(2));

        if pw <= 0 || ph <= 0 || pw > 2048 || ph > 2048 {
            return;
        }

        let Some(mut shadow_pm) = Pixmap::new(pw as u32, ph as u32) else {
            return;
        };

        // Draw the shape into the padded pixmap, offset by padding + shadow offset
        let padded_transform = Transform::from_translate(
            blur_padding as f32 + ox,
            blur_padding as f32 + oy,
        );
        let combined = padded_transform.pre_concat(self.state.transform);
        draw_fn(&mut shadow_pm, &shadow_paint, combined);

        // 3-pass box blur approximates Gaussian
        let radius = ((blur - 1.0) / 2.0).ceil().max(1.0) as usize;
        text::box_blur_rgba(&mut shadow_pm, radius);
        text::box_blur_rgba(&mut shadow_pm, radius);
        text::box_blur_rgba(&mut shadow_pm, radius);

        // Composite back onto main pixmap
        let pp = PixmapPaint {
            opacity: 1.0,
            blend_mode: tiny_skia::BlendMode::SourceOver,
            quality: tiny_skia::FilterQuality::Nearest,
        };
        let mask = self.clip_mask.as_ref();
        self.pixmap.draw_pixmap(
            -blur_padding, -blur_padding,
            shadow_pm.as_ref(), &pp, Transform::identity(), mask,
        );
    }

    /// Render a shadow for a path-based shape (fill_path/stroke_path where
    /// path coords are already in device space, so transform = identity + offset).
    fn draw_blurred_shadow_device<F>(&mut self, draw_fn: F)
    where
        F: FnOnce(&mut Pixmap, &Paint<'_>, Transform),
    {
        let blur = self.state.shadow_blur;
        let ox = self.state.shadow_offset_x;
        let oy = self.state.shadow_offset_y;
        let shadow_paint = self.shadow_paint();

        if blur <= 0.0 {
            let st = Transform::from_translate(ox, oy);
            let mask = self.clip_mask.as_ref();
            let Some(mut tmp) = Pixmap::new(self.pixmap.width(), self.pixmap.height()) else { return };
            draw_fn(&mut tmp, &shadow_paint, st);
            let pp = PixmapPaint {
                opacity: 1.0,
                blend_mode: tiny_skia::BlendMode::SourceOver,
                quality: tiny_skia::FilterQuality::Nearest,
            };
            self.pixmap.draw_pixmap(0, 0, tmp.as_ref(), &pp, Transform::identity(), mask);
            return;
        }

        let blur_padding = (blur * 2.0).ceil() as i32 + 2;
        let pw = self.pixmap.width() as i32 + blur_padding * 2;
        let ph = self.pixmap.height() as i32 + blur_padding * 2;

        if pw <= 0 || ph <= 0 || pw > 8192 || ph > 8192 {
            return;
        }

        let Some(mut shadow_pm) = Pixmap::new(pw as u32, ph as u32) else {
            return;
        };

        let padded_transform = Transform::from_translate(
            blur_padding as f32 + ox,
            blur_padding as f32 + oy,
        );
        draw_fn(&mut shadow_pm, &shadow_paint, padded_transform);

        let radius = ((blur - 1.0) / 2.0).ceil().max(1.0) as usize;
        text::box_blur_rgba(&mut shadow_pm, radius);
        text::box_blur_rgba(&mut shadow_pm, radius);
        text::box_blur_rgba(&mut shadow_pm, radius);

        let pp = PixmapPaint {
            opacity: 1.0,
            blend_mode: tiny_skia::BlendMode::SourceOver,
            quality: tiny_skia::FilterQuality::Nearest,
        };
        let mask = self.clip_mask.as_ref();
        self.pixmap.draw_pixmap(
            -blur_padding, -blur_padding,
            shadow_pm.as_ref(), &pp, Transform::identity(), mask,
        );
    }

    /// Check if shadow rendering is active.
    fn has_shadow(&self) -> bool {
        let sc = self.state.shadow_color;
        sc.alpha() > 0.0
            && (self.state.shadow_blur > 0.0
                || self.state.shadow_offset_x != 0.0
                || self.state.shadow_offset_y != 0.0)
    }

    /// Create a paint for shadow rendering.
    fn shadow_paint(&self) -> Paint<'static> {
        let mut paint = Paint::default();
        let sc = self.state.shadow_color;
        let alpha = sc.alpha() * self.state.global_alpha.value();
        paint.set_color(
            Color::from_rgba(sc.red(), sc.green(), sc.blue(), alpha).unwrap_or(Color::BLACK),
        );
        paint.anti_alias = true;
        paint.blend_mode = self.state.composite_op.to_blend_mode();
        paint
    }

    /// Get the shadow offset transform (main transform + shadow offset).
    #[allow(dead_code)]
    fn shadow_transform(&self) -> Transform {
        self.state.transform.pre_translate(
            self.state.shadow_offset_x,
            self.state.shadow_offset_y,
        )
    }

    /// If globalCompositeOperation is "copy", clear the entire canvas first.
    /// Canvas2D spec: "copy" means only the new shape should remain.
    fn apply_copy_clear(&mut self) {
        if self.state.composite_op == CompositeOp::Copy {
            let mut clear_paint = Paint::default();
            clear_paint.set_color(Color::from_rgba8(0, 0, 0, 0));
            clear_paint.blend_mode = BlendMode::Source;
            if let Some(rect) = Rect::from_xywh(0.0, 0.0, self.pixmap.width() as f32, self.pixmap.height() as f32) {
                self.pixmap.fill_rect(rect, &clear_paint, Transform::identity(), None);
            }
        }
    }

    /// Check if the current composite op requires the temp-pixmap masking approach.
    fn needs_masking_composite(&self) -> bool {
        self.state.composite_op.needs_masking()
    }

    /// Draw a shape via a temporary pixmap for composite ops that require destination
    /// masking (source-in, source-out, destination-in, destination-out, source-atop,
    /// destination-atop). These ops must affect the entire canvas — erasing pixels
    /// outside the intersection — but fill_rect/fill_path only touch pixels within
    /// the shape bounds. The fix: render the shape to a temp pixmap with SourceOver,
    /// then composite the full temp pixmap onto the main pixmap with the actual blend mode.
    fn draw_with_masking_composite<F>(&mut self, draw_fn: F)
    where
        F: FnOnce(&mut Pixmap, &Paint<'_>, Transform, Option<&Mask>),
    {
        let w = self.pixmap.width();
        let h = self.pixmap.height();
        let Some(mut tmp) = Pixmap::new(w, h) else { return };

        // Draw the shape onto the temp pixmap using SourceOver (default blend)
        let mut paint = self.fill_paint();
        paint.blend_mode = BlendMode::SourceOver;
        draw_fn(&mut tmp, &paint, self.state.transform, None);

        // Composite the temp pixmap onto the main pixmap using the actual blend mode
        let pp = PixmapPaint {
            opacity: 1.0, // alpha already baked into the shape paint
            blend_mode: self.state.composite_op.to_blend_mode(),
            quality: tiny_skia::FilterQuality::Nearest,
        };
        let mask = self.clip_mask.as_ref();
        self.pixmap.draw_pixmap(0, 0, tmp.as_ref(), &pp, Transform::identity(), mask);
    }

    /// Same as draw_with_masking_composite but uses stroke paint instead of fill paint.
    fn draw_with_masking_composite_stroke<F>(&mut self, draw_fn: F)
    where
        F: FnOnce(&mut Pixmap, &Paint<'_>, &Stroke, Transform, Option<&Mask>),
    {
        let w = self.pixmap.width();
        let h = self.pixmap.height();
        let Some(mut tmp) = Pixmap::new(w, h) else { return };

        let mut paint = self.stroke_paint();
        paint.blend_mode = BlendMode::SourceOver;
        let stroke = self.stroke_style();
        draw_fn(&mut tmp, &paint, &stroke, self.state.transform, None);

        let pp = PixmapPaint {
            opacity: 1.0,
            blend_mode: self.state.composite_op.to_blend_mode(),
            quality: tiny_skia::FilterQuality::Nearest,
        };
        let mask = self.clip_mask.as_ref();
        self.pixmap.draw_pixmap(0, 0, tmp.as_ref(), &pp, Transform::identity(), mask);
    }

    fn fill_paint(&self) -> Paint<'static> {
        let mut paint = Paint::default();
        paint.anti_alias = true;
        // "copy" is handled by clearing first + using SourceOver
        let blend = if self.state.composite_op == CompositeOp::Copy {
            BlendMode::SourceOver
        } else {
            self.state.composite_op.to_blend_mode()
        };
        paint.blend_mode = blend;
        match &self.state.fill_style {
            PaintStyle::Gradient(id) => {
                if let Some(shader) = self.make_gradient_shader(id) {
                    paint.shader = shader;
                } else {
                    self.apply_fill_color(&mut paint);
                }
            }
            PaintStyle::Pattern(_) => {
                // Pattern fills are handled via fill_rect_pattern (for fillRect) or
                // by tiling into a temporary pixmap at the call site (for path fills).
                // Fall back to solid fill color here; callers needing pattern fills
                // should check fill_style and use fill_with_pattern() instead.
                self.apply_fill_color(&mut paint);
            }
            PaintStyle::Color(_) => {
                self.apply_fill_color(&mut paint);
            }
        }
        paint
    }

    fn apply_fill_color(&self, paint: &mut Paint<'static>) {
        let c = self.state.fill_color;
        let alpha = c.alpha() * self.state.global_alpha.value();
        paint.set_color(Color::from_rgba(c.red(), c.green(), c.blue(), alpha).unwrap_or(Color::BLACK));
    }

    fn stroke_paint(&self) -> Paint<'static> {
        let mut paint = Paint::default();
        paint.anti_alias = true;
        let blend = if self.state.composite_op == CompositeOp::Copy {
            BlendMode::SourceOver
        } else {
            self.state.composite_op.to_blend_mode()
        };
        paint.blend_mode = blend;
        match &self.state.stroke_style {
            PaintStyle::Gradient(id) => {
                if let Some(shader) = self.make_gradient_shader(id) {
                    paint.shader = shader;
                } else {
                    self.apply_stroke_color(&mut paint);
                }
            }
            PaintStyle::Pattern(_) => {
                // Pattern strokes would need a tiled pattern pixmap as shader source.
                // This is rare in practice; fall back to solid stroke color.
                // TODO: implement via make_tiled_pattern_pixmap + Pattern::new
                self.apply_stroke_color(&mut paint);
            }
            PaintStyle::Color(_) => {
                self.apply_stroke_color(&mut paint);
            }
        }
        paint
    }

    fn apply_stroke_color(&self, paint: &mut Paint<'static>) {
        let c = self.state.stroke_color;
        let alpha = c.alpha() * self.state.global_alpha.value();
        paint.set_color(Color::from_rgba(c.red(), c.green(), c.blue(), alpha).unwrap_or(Color::BLACK));
    }

    fn make_gradient_shader(&self, id: &str) -> Option<Shader<'static>> {
        let grad = self.gradients.get(id)?;

        // Helper: build gradient stops, duplicating a single stop so tiny-skia gets ≥ 2.
        let build_stops = |stops: &[ColorStop]| -> Vec<GradientStop> {
            let mut gs: Vec<GradientStop> = stops.iter().map(|s| {
                let c = s.color;
                let a = c.alpha() * self.state.global_alpha.value();
                GradientStop::new(
                    s.offset,
                    Color::from_rgba(c.red(), c.green(), c.blue(), a).unwrap_or(Color::BLACK),
                )
            }).collect();
            // tiny-skia requires ≥ 2 stops; duplicate the single stop at both ends
            if gs.len() == 1 {
                let c = stops[0].color;
                let a = c.alpha() * self.state.global_alpha.value();
                let color = Color::from_rgba(c.red(), c.green(), c.blue(), a).unwrap_or(Color::BLACK);
                gs = vec![
                    GradientStop::new(0.0, color),
                    GradientStop::new(1.0, color),
                ];
            }
            gs
        };

        match grad {
            GradientDef::Linear { x0, y0, x1, y1, stops } => {
                if stops.is_empty() { return None; }
                // Spec: degenerate linear gradient (zero length) paints nothing
                if (*x0 - *x1).abs() < f32::EPSILON && (*y0 - *y1).abs() < f32::EPSILON {
                    return None;
                }
                LinearGradient::new(
                    Point::from_xy(*x0, *y0),
                    Point::from_xy(*x1, *y1),
                    build_stops(stops),
                    SpreadMode::Pad,
                    Transform::identity(),
                )
            }
            GradientDef::Radial { x0, y0, r0, x1, y1, r1, stops } => {
                if stops.is_empty() { return None; }
                // Spec: if both radii are 0, paint nothing
                if *r0 <= 0.0 && *r1 <= 0.0 { return None; }
                // Spec: if circles are coincident and radii equal, paint nothing
                if (*r0 - *r1).abs() < f32::EPSILON
                    && (*x0 - *x1).abs() < f32::EPSILON
                    && (*y0 - *y1).abs() < f32::EPSILON
                {
                    return None;
                }
                RadialGradient::new(
                    Point::from_xy(*x0, *y0),
                    *r0,
                    Point::from_xy(*x1, *y1),
                    *r1,
                    build_stops(stops),
                    SpreadMode::Pad,
                    Transform::identity(),
                )
            }
        }
    }

    /// Fill a rectangle with a tiled pattern.
    fn fill_rect_pattern(&mut self, x: f32, y: f32, w: f32, h: f32, pattern_id: &str) {
        let (x, w) = if w < 0.0 { (x + w, -w) } else { (x, w) };
        let (y, h) = if h < 0.0 { (y + h, -h) } else { (y, h) };

        // Get pattern dimensions (borrow checker: read fields before mutable borrow)
        let (pw, ph) = {
            let Some(pat) = self.patterns.get(pattern_id) else { return };
            (pat.width, pat.height)
        };
        if pw == 0 || ph == 0 { return; }

        // Create a tiled pixmap covering the fill rect (capped to prevent OOM)
        let fill_w = (w.ceil() as u32).min(Self::MAX_DIMENSION);
        let fill_h = (h.ceil() as u32).min(Self::MAX_DIMENSION);
        if fill_w == 0 || fill_h == 0 { return; }
        let Some(mut tiled) = Pixmap::new(fill_w, fill_h) else { return };

        // Tile the pattern
        {
            let Some(pat) = self.patterns.get(pattern_id) else { return };
            let pat_data = pat.pixmap.data();
            let tiled_pixels = tiled.data_mut();
            for row in 0..fill_h {
                for col in 0..fill_w {
                    let src_row = (row % ph) as usize;
                    let src_col = (col % pw) as usize;
                    let si = (src_row * pw as usize + src_col) * 4;
                    let di = (row as usize * fill_w as usize + col as usize) * 4;
                    if si + 4 > pat_data.len() || di + 4 > tiled_pixels.len() { break; }
                    tiled_pixels[di..di + 4].copy_from_slice(&pat_data[si..si + 4]);
                }
            }
        }

        let pp = PixmapPaint {
            opacity: self.state.global_alpha.value(),
            blend_mode: self.state.composite_op.to_blend_mode(),
            quality: tiny_skia::FilterQuality::Nearest,
        };
        let t = self.state.transform.pre_translate(x, y);
        let mask = self.clip_mask.as_ref();
        self.pixmap.draw_pixmap(0, 0, tiled.as_ref(), &pp, t, mask);
    }

    fn stroke_style(&self) -> Stroke {
        let mut stroke = Stroke::default();
        stroke.width = self.state.line_width;
        stroke.line_cap = self.state.line_cap;
        stroke.line_join = self.state.line_join;
        stroke.miter_limit = self.state.miter_limit;
        if !self.state.line_dash.is_empty() {
            stroke.dash = StrokeDash::new(self.state.line_dash.clone(), self.state.line_dash_offset);
        }
        stroke
    }

    /// Filter quality based on imageSmoothingEnabled state.
    fn image_filter_quality(&self) -> tiny_skia::FilterQuality {
        if self.state.image_smoothing {
            tiny_skia::FilterQuality::Bilinear
        } else {
            tiny_skia::FilterQuality::Nearest
        }
    }

    /// Draw RGBA image data onto the canvas with compositing (respects globalAlpha, blend mode).
    fn draw_image_rgba(&mut self, dx: i32, dy: i32, w: u32, h: u32, pixels: &[u8]) {
        let expected = (w as u64).saturating_mul(h as u64).saturating_mul(4);
        if expected > Self::MAX_PIXMAP_BYTES as u64 || pixels.len() < expected as usize || w == 0 || h == 0 { return; }

        // Create a temporary pixmap from the source pixels
        let Some(mut src_pm) = Pixmap::new(w, h) else { return };
        let src_pixels = src_pm.pixels_mut();
        for i in 0..(w * h) as usize {
            let si = i * 4;
            let r = pixels[si];
            let g = pixels[si + 1];
            let b = pixels[si + 2];
            let a = pixels[si + 3];
            // Convert to premultiplied alpha (clamp to alpha to handle rounding)
            let af = a as f32 / 255.0;
            let pm_r = (r as f32 * af).round().min(a as f32) as u8;
            let pm_g = (g as f32 * af).round().min(a as f32) as u8;
            let pm_b = (b as f32 * af).round().min(a as f32) as u8;
            src_pixels[i] = PremultipliedColorU8::from_rgba(pm_r, pm_g, pm_b, a).unwrap();
        }

        let pp = PixmapPaint {
            opacity: self.state.global_alpha.value(),
            blend_mode: self.state.composite_op.to_blend_mode(),
            quality: self.image_filter_quality(),
        };
        let mask = self.clip_mask.as_ref();
        // Apply current transform for positioning
        let t = self.state.transform.pre_translate(dx as f32, dy as f32);
        self.pixmap.draw_pixmap(0, 0, src_pm.as_ref(), &pp, t, mask);
    }

    /// Draw a registered image by ID. Handles all three drawImage overloads:
    /// - 2 args: [dx, dy]           → draw at natural size
    /// - 4 args: [dx, dy, dw, dh]   → draw scaled to dest rect
    /// - 8 args: [sx, sy, sw, sh, dx, dy, dw, dh] → source crop + dest scale
    fn draw_image_by_id(&mut self, id: u32, args: &[f64]) {
        // Rc::clone is O(1) — avoids copying the entire pixel buffer per drawImage call
        let (img_w, img_h, img_rgba) = {
            let Some(img) = self.images.get(&id) else { return };
            if img.width == 0 || img.height == 0 { return; }
            (img.width, img.height, Rc::clone(&img.rgba))
        };

        match args.len() {
            // drawImage(img, dx, dy)
            n if n >= 2 && n < 4 => {
                self.draw_image_rgba(args[0] as i32, args[1] as i32, img_w, img_h, &img_rgba);
            }
            // drawImage(img, dx, dy, dw, dh)
            n if n >= 4 && n < 8 => {
                let dx = args[0] as f32;
                let dy = args[1] as f32;
                let dw = args[2] as f32;
                let dh = args[3] as f32;
                if dw <= 0.0 || dh <= 0.0 { return; }

                let sx = dw / img_w as f32;
                let sy = dh / img_h as f32;
                let Some(src_pm) = Self::make_premultiplied_pixmap_static(img_w, img_h, &img_rgba) else { return };

                let pp = PixmapPaint {
                    opacity: self.state.global_alpha.value(),
                    blend_mode: self.state.composite_op.to_blend_mode(),
                    quality: self.image_filter_quality(),
                };
                let mask = self.clip_mask.as_ref();
                let t = self.state.transform
                    .pre_translate(dx, dy)
                    .pre_scale(sx, sy);
                self.pixmap.draw_pixmap(0, 0, src_pm.as_ref(), &pp, t, mask);
            }
            // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
            _ if args.len() >= 8 => {
                let src_x = args[0] as u32;
                let src_y = args[1] as u32;
                let src_w = args[2] as u32;
                let src_h = args[3] as u32;
                let dx = args[4] as f32;
                let dy = args[5] as f32;
                let dw = args[6] as f32;
                let dh = args[7] as f32;
                if src_w == 0 || src_h == 0 || dw <= 0.0 || dh <= 0.0 { return; }

                let cropped = Self::crop_image_rgba_static(img_w, &img_rgba, src_x, src_y, src_w, src_h);
                let Some(src_pm) = Self::make_premultiplied_pixmap_static(src_w, src_h, &cropped) else { return };

                let sx = dw / src_w as f32;
                let sy = dh / src_h as f32;
                let pp = PixmapPaint {
                    opacity: self.state.global_alpha.value(),
                    blend_mode: self.state.composite_op.to_blend_mode(),
                    quality: self.image_filter_quality(),
                };
                let mask = self.clip_mask.as_ref();
                let t = self.state.transform
                    .pre_translate(dx, dy)
                    .pre_scale(sx, sy);
                self.pixmap.draw_pixmap(0, 0, src_pm.as_ref(), &pp, t, mask);
            }
            _ => {}
        }
    }

    /// Create a premultiplied pixmap from straight RGBA pixels.
    fn make_premultiplied_pixmap_static(w: u32, h: u32, pixels: &[u8]) -> Option<Pixmap> {
        let expected = (w as u64).saturating_mul(h as u64).saturating_mul(4);
        if expected > Self::MAX_PIXMAP_BYTES as u64 || pixels.len() < expected as usize || w == 0 || h == 0 { return None; }
        let mut pm = Pixmap::new(w, h)?;
        let dst = pm.pixels_mut();
        for i in 0..(w * h) as usize {
            let si = i * 4;
            let r = pixels[si];
            let g = pixels[si + 1];
            let b = pixels[si + 2];
            let a = pixels[si + 3];
            let af = a as f32 / 255.0;
            dst[i] = PremultipliedColorU8::from_rgba(
                (r as f32 * af).round().min(a as f32) as u8,
                (g as f32 * af).round().min(a as f32) as u8,
                (b as f32 * af).round().min(a as f32) as u8,
                a,
            ).unwrap();
        }
        Some(pm)
    }

    /// Crop a rectangle from RGBA image data.
    fn crop_image_rgba_static(src_stride: u32, pixels: &[u8], x: u32, y: u32, w: u32, h: u32) -> Vec<u8> {
        let src_h = pixels.len() as u32 / (src_stride * 4).max(1);
        // Clamp source rect to image bounds — out-of-bounds regions are transparent
        let x = x.min(src_stride);
        let y = y.min(src_h);
        let w = w.min(src_stride.saturating_sub(x));
        let h = h.min(src_h.saturating_sub(y));
        let total_bytes = (w as u64).saturating_mul(h as u64).saturating_mul(4);
        if total_bytes > Self::MAX_PIXMAP_BYTES as u64 {
            return Vec::new();
        }
        let mut out = vec![0u8; total_bytes as usize];
        for row in 0..h {
            let src_row = y + row;
            let src_off = ((src_row * src_stride + x) * 4) as usize;
            let dst_off = (row * w * 4) as usize;
            let len = (w * 4) as usize;
            if src_off + len <= pixels.len() {
                out[dst_off..dst_off + len].copy_from_slice(&pixels[src_off..src_off + len]);
            }
        }
        out
    }

    pub(crate) fn put_image_data(&mut self, dx: i32, dy: i32, w: u32, h: u32, pixels: &[u8]) {
        let expected = (w as u64) * (h as u64) * 4;
        if (pixels.len() as u64) < expected { return; }

        let pm_w = self.pixmap.width();
        let pm_h = self.pixmap.height();
        let pm_pixels = self.pixmap.pixels_mut();

        for row in 0..h {
            for col in 0..w {
                let px = dx + col as i32;
                let py = dy + row as i32;
                if px < 0 || py < 0 || px >= pm_w as i32 || py >= pm_h as i32 {
                    continue;
                }
                let src_idx = ((row * w + col) * 4) as usize;
                let r = pixels[src_idx];
                let g = pixels[src_idx + 1];
                let b = pixels[src_idx + 2];
                let a = pixels[src_idx + 3];
                let af = a as f32 / 255.0;
                let pm_r = (r as f32 * af).round().min(a as f32) as u8;
                let pm_g = (g as f32 * af).round().min(a as f32) as u8;
                let pm_b = (b as f32 * af).round().min(a as f32) as u8;
                let pixel = PremultipliedColorU8::from_rgba(pm_r, pm_g, pm_b, a).unwrap();
                pm_pixels[(py as u32 * pm_w + px as u32) as usize] = pixel;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn new_canvas() -> Canvas2D {
        Canvas2D::new(100, 100)
    }

    fn pixel_at(canvas: &Canvas2D, x: u32, y: u32) -> [u8; 4] {
        let mut buf = vec![0u8; (canvas.width() * canvas.height() * 4) as usize];
        canvas.read_pixels(&mut buf);
        let idx = ((y * canvas.width() + x) * 4) as usize;
        [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]]
    }

    #[test]
    fn fill_rect_basic() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#ff0000"],
            ["fillRect", 10, 10, 20, 20]
        ]));
        let p = pixel_at(&c, 15, 15);
        assert_eq!(p[0], 255, "red channel");
        assert_eq!(p[1], 0, "green channel");
        assert_eq!(p[2], 0, "blue channel");
        assert_eq!(p[3], 255, "alpha channel");
    }

    #[test]
    fn fill_rect_leaves_outside_untouched() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#ff0000"],
            ["fillRect", 10, 10, 5, 5]
        ]));
        let outside = pixel_at(&c, 0, 0);
        assert_eq!(outside[3], 0, "outside pixel should be transparent");
    }

    #[test]
    fn clear_rect_clears_pixels() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#ff0000"],
            ["fillRect", 0, 0, 50, 50],
            ["clearRect", 10, 10, 20, 20]
        ]));
        let cleared = pixel_at(&c, 15, 15);
        assert_eq!(cleared[3], 0, "cleared pixel should be transparent");

        let still_red = pixel_at(&c, 5, 5);
        assert_eq!(still_red[0], 255, "non-cleared pixel should still be red");
    }

    #[test]
    fn zero_width_clamped() {
        let canvas = Canvas2D::new(0, 64);
        assert!(canvas.get_image_data(0, 0, 1, 1).len() == 4);
    }

    #[test]
    fn zero_both_clamped() {
        let canvas = Canvas2D::new(0, 0);
        assert!(canvas.get_image_data(0, 0, 1, 1).len() == 4);
    }

    #[test]
    fn oversized_clamped_to_max() {
        let canvas = Canvas2D::new(100_000, 100_000);
        let data = canvas.get_image_data(0, 0, 1, 1);
        assert_eq!(data.len(), 4);
    }

    #[test]
    fn save_beyond_limit_then_restore_no_desync() {
        let mut c = new_canvas();
        // Push 520 saves (limit is 512) — extras are dropped
        for _ in 0..520 {
            c.process_commands(&json!([["save"]]));
        }
        c.process_commands(&json!([["fillStyle", "#ff0000"]]));
        // Restore more times than we actually saved
        for _ in 0..600 {
            c.process_commands(&json!([["restore"]]));
        }
        // Should not panic — stacks stay in sync
        c.process_commands(&json!([["fillRect", 0, 0, 1, 1]]));
    }

    #[test]
    fn save_restore_state() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#ff0000"],
            ["save"],
            ["fillStyle", "#00ff00"],
            ["fillRect", 0, 0, 10, 10],
            ["restore"],
            ["fillRect", 50, 50, 10, 10]
        ]));
        // First rect should be green (#00ff00 = 0,128,0 named / 0,255,0 hex)
        let green = pixel_at(&c, 5, 5);
        assert!(green[1] > 100, "green rect should have green channel, got {}", green[1]);

        // Second rect should be red (restored state)
        let red = pixel_at(&c, 55, 55);
        assert_eq!(red[0], 255, "restored red rect");
        assert_eq!(red[1], 0, "red rect green channel");
    }

    #[test]
    fn global_alpha() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["globalAlpha", 0.5],
            ["fillStyle", "#ff0000"],
            ["fillRect", 0, 0, 10, 10]
        ]));
        let p = pixel_at(&c, 5, 5);
        // Alpha should be ~128 (0.5 * 255)
        assert!((p[3] as i32 - 128).abs() < 3, "alpha should be ~128, got {}", p[3]);
    }

    #[test]
    fn translate_transform() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#0000ff"],
            ["translate", 50, 50],
            ["fillRect", 0, 0, 10, 10]
        ]));
        // Rect should be at (50,50) not (0,0)
        let at_origin = pixel_at(&c, 0, 0);
        assert_eq!(at_origin[3], 0, "origin should be empty");

        let at_translated = pixel_at(&c, 55, 55);
        assert_eq!(at_translated[2], 255, "translated rect should be blue");
    }

    #[test]
    fn set_transform_resets() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["translate", 50, 50],
            ["setTransform", 1, 0, 0, 1, 0, 0],
            ["fillStyle", "#ff0000"],
            ["fillRect", 0, 0, 5, 5]
        ]));
        let p = pixel_at(&c, 2, 2);
        assert_eq!(p[0], 255, "setTransform should reset to identity");
    }

    #[test]
    fn path_fill() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#00ff00"],
            ["beginPath"],
            ["moveTo", 10, 10],
            ["lineTo", 30, 10],
            ["lineTo", 30, 30],
            ["lineTo", 10, 30],
            ["closePath"],
            ["fill"]
        ]));
        let inside = pixel_at(&c, 20, 20);
        assert!(inside[1] > 100, "inside path should be green, got g={}", inside[1]);
    }

    #[test]
    fn stroke_rect() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["strokeStyle", "#ff0000"],
            ["lineWidth", 2],
            ["strokeRect", 10, 10, 30, 30]
        ]));
        // Top edge should have color
        let edge = pixel_at(&c, 20, 10);
        assert!(edge[0] > 200, "stroke edge should be red");

        // Center should be empty
        let center = pixel_at(&c, 25, 25);
        assert_eq!(center[3], 0, "stroke center should be transparent");
    }

    #[test]
    fn empty_commands() {
        let mut c = new_canvas();
        c.process_commands(&json!([]));
        let p = pixel_at(&c, 0, 0);
        assert_eq!(p, [0, 0, 0, 0]);
    }

    #[test]
    fn invalid_commands_ignored() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["unknownCommand", 1, 2, 3],
            ["fillRect"],  // missing args
            42,            // not an array
            ["fillStyle", "#ff0000"],
            ["fillRect", 0, 0, 5, 5]
        ]));
        let p = pixel_at(&c, 2, 2);
        assert_eq!(p[0], 255, "valid commands should still execute");
    }

    #[test]
    fn line_dash() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["setLineDash", 5, 5],
            ["lineDashOffset", 0],
            ["strokeStyle", "#ff0000"],
            ["lineWidth", 2],
            ["beginPath"],
            ["moveTo", 0, 50],
            ["lineTo", 100, 50],
            ["stroke"]
        ]));
        // Just verify it doesn't crash — dashed lines are hard to pixel-test
    }

    #[test]
    fn multiple_fills_overwrite() {
        let mut c = new_canvas();
        c.process_commands(&json!([
            ["fillStyle", "#ff0000"],
            ["fillRect", 0, 0, 50, 50],
            ["fillStyle", "#0000ff"],
            ["fillRect", 0, 0, 50, 50]
        ]));
        let p = pixel_at(&c, 25, 25);
        assert_eq!(p[2], 255, "second fill should overwrite first");
        assert_eq!(p[0], 0, "red should be gone");
    }
}

fn parse_font(font_str: &str, state: &mut DrawState) {
    // Simple parser: "16px sans-serif", "bold 24px monospace", "italic 12px Arial"
    // CSS font shorthand: [style] [variant] [weight] size[/line-height] family
    let parts: Vec<&str> = font_str.split_whitespace().collect();
    state.font_weight = FontWeight::NORMAL;
    for part in &parts {
        if part.ends_with("px") {
            if let Ok(size) = part.trim_end_matches("px").parse::<f32>() {
                state.font_size = size;
            }
        } else if part.ends_with("pt") {
            if let Ok(size) = part.trim_end_matches("pt").parse::<f32>() {
                state.font_size = size * 1.333; // pt to px
            }
        } else {
            match *part {
                "bold" | "bolder" | "lighter" | "normal" => {
                    state.font_weight = FontWeight::parse(part);
                }
                _ => {
                    if let Ok(w) = part.parse::<u16>() {
                        if (100..=900).contains(&w) {
                            state.font_weight = FontWeight::new(w);
                        }
                    }
                }
            }
        }
    }
    // Last part is typically the font family
    if let Some(family) = parts.last() {
        if !family.ends_with("px") && !family.ends_with("pt")
            && !matches!(*family, "bold" | "bolder" | "lighter" | "italic" | "normal" | "oblique")
            && family.parse::<u16>().is_err()
        {
            state.font_family = family.to_string();
        }
    }
}
