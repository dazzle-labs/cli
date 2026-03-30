use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tiny_skia::{Color, Pixmap, PixmapPaint, Transform};

use super::state::{DrawState, TextAlign, TextBaseline};

/// Embedded DejaVu Sans font data (regular and bold).
static FONT_REGULAR_DATA: &[u8] = include_bytes!("fonts/DejaVuSans.ttf");
static FONT_BOLD_DATA: &[u8] = include_bytes!("fonts/DejaVuSans-Bold.ttf");

/// Lazily initialized fontdue fonts.
static FONT_REGULAR: OnceLock<fontdue::Font> = OnceLock::new();
static FONT_BOLD: OnceLock<fontdue::Font> = OnceLock::new();

/// Global custom font registry: name → fontdue::Font.
static CUSTOM_FONTS: OnceLock<Mutex<HashMap<String, fontdue::Font>>> = OnceLock::new();

fn custom_fonts() -> &'static Mutex<HashMap<String, fontdue::Font>> {
    CUSTOM_FONTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn get_font(bold: bool) -> &'static fontdue::Font {
    if bold {
        FONT_BOLD.get_or_init(|| {
            fontdue::Font::from_bytes(
                FONT_BOLD_DATA,
                fontdue::FontSettings::default(),
            )
            .expect("Failed to load embedded bold font")
        })
    } else {
        FONT_REGULAR.get_or_init(|| {
            fontdue::Font::from_bytes(
                FONT_REGULAR_DATA,
                fontdue::FontSettings::default(),
            )
            .expect("Failed to load embedded regular font")
        })
    }
}

fn is_bold(state: &DrawState) -> bool {
    state.font_weight.is_bold()
}

/// Rasterized glyph data with positioning info.
struct RasterizedGlyph {
    metrics: fontdue::Metrics,
    bitmap: Vec<u8>,
    x_advance_offset: f32,
}

/// Layout text and return glyph data plus total advance width.
fn layout_glyphs(
    text: &str,
    font: &fontdue::Font,
    font_size: f32,
    letter_spacing: f32,
) -> (Vec<RasterizedGlyph>, f32) {
    let mut glyphs = Vec::new();
    let mut x_advance = 0.0f32;

    for ch in text.chars() {
        let (metrics, bitmap) = font.rasterize(ch, font_size);
        glyphs.push(RasterizedGlyph {
            metrics,
            bitmap,
            x_advance_offset: x_advance,
        });
        x_advance += metrics.advance_width + letter_spacing;
    }

    (glyphs, x_advance)
}

/// Render glyphs into an RGBA pixmap at a given baseline position.
/// The pixmap origin is (0,0) and glyphs are positioned relative to
/// (base_x, base_y) which is the baseline position.
fn rasterize_glyphs_to_pixmap(
    glyphs: &[RasterizedGlyph],
    base_x: f32,
    base_y: f32,
    color: Color,
    alpha: f32,
    pm_width: u32,
    pm_height: u32,
) -> Option<Pixmap> {
    let mut pm = Pixmap::new(pm_width, pm_height)?;
    let r = (color.red() * 255.0).round() as u8;
    let g = (color.green() * 255.0).round() as u8;
    let b = (color.blue() * 255.0).round() as u8;

    let pixels = pm.data_mut();
    let pw = pm_width as i32;
    let ph = pm_height as i32;

    // Precompute alpha as 0..255 integer
    let alpha_i = (alpha * 255.0).round() as u32;

    for glyph in glyphs {
        let gw = glyph.metrics.width;
        let gh = glyph.metrics.height;
        if gw == 0 || gh == 0 {
            continue;
        }

        let sx = (base_x + glyph.x_advance_offset + glyph.metrics.xmin as f32).round() as i32;
        let sy = (base_y - (glyph.metrics.ymin as f32 + gh as f32)).round() as i32;

        // Clamp glyph rows/cols to pixmap bounds to avoid per-pixel checks
        let gy_start = 0i32.max(-sy) as usize;
        let gy_end = (gh as i32).min(ph - sy) as usize;
        let gx_start = 0i32.max(-sx) as usize;
        let gx_end = (gw as i32).min(pw - sx) as usize;

        for gy in gy_start..gy_end {
            let py = (sy + gy as i32) as u32;
            let row_base = (py * pm_width) as usize * 4;
            let glyph_row = gy * gw;

            for gx in gx_start..gx_end {
                let glyph_a = glyph.bitmap[glyph_row + gx] as u32;
                if glyph_a == 0 {
                    continue;
                }

                // final_alpha = (glyph_a / 255) * alpha = (glyph_a * alpha_i) / 255
                // Use fixed-point: sa_255 is alpha in 0..255 range
                let sa_255 = (glyph_a * alpha_i + 127) / 255;
                if sa_255 == 0 {
                    continue;
                }

                let px = (sx + gx as i32) as u32;
                let idx = row_base + (px as usize) * 4;

                // Source-over compositing in integer (premultiplied, all values 0..255)
                // src_r = color_r * sa / 255 (premultiplied)
                let sr = (r as u32 * sa_255 + 127) / 255;
                let sg = (g as u32 * sa_255 + 127) / 255;
                let sb = (b as u32 * sa_255 + 127) / 255;

                // inv_sa = 255 - sa (for "1 - alpha" in 0..255 space)
                let inv_sa = 255 - sa_255;

                // out = src + dst * (1 - src_alpha)
                let dr = pixels[idx] as u32;
                let dg = pixels[idx + 1] as u32;
                let db = pixels[idx + 2] as u32;
                let da = pixels[idx + 3] as u32;

                pixels[idx]     = (sr + (dr * inv_sa + 127) / 255).min(255) as u8;
                pixels[idx + 1] = (sg + (dg * inv_sa + 127) / 255).min(255) as u8;
                pixels[idx + 2] = (sb + (db * inv_sa + 127) / 255).min(255) as u8;
                pixels[idx + 3] = (sa_255 + (da * inv_sa + 127) / 255).min(255) as u8;
            }
        }
    }

    Some(pm)
}

/// Composite a pre-rendered text pixmap onto the main pixmap.
fn composite_text_pixmap(
    pixmap: &mut Pixmap,
    text_pm: &Pixmap,
    offset_x: f32,
    offset_y: f32,
    transform: Transform,
) {
    let paint = PixmapPaint {
        opacity: 1.0,
        blend_mode: tiny_skia::BlendMode::SourceOver,
        quality: tiny_skia::FilterQuality::Bilinear,
    };

    let t = transform.pre_translate(offset_x, offset_y);
    pixmap.draw_pixmap(0, 0, text_pm.as_ref(), &paint, t, None);
}

/// Render text onto a pixmap. Returns the width of the rendered text.
pub fn render_text(
    pixmap: &mut Pixmap,
    text: &str,
    x: f32,
    y: f32,
    state: &DrawState,
    fill: bool,
) -> f32 {
    let font_size = state.font_size;
    if text.is_empty() || font_size <= 0.0 {
        return 0.0;
    }

    let bold = is_bold(state);

    // Try custom font from registry first, then fall back to embedded DejaVu Sans.
    // `_custom_font_guard` keeps the MutexGuard alive so the font reference remains valid.
    let _custom_font_guard;
    let font: &fontdue::Font = {
        let family = &state.font_family;
        if family != "sans-serif" && family != "serif" && family != "monospace" && !family.is_empty() {
            let guard = custom_fonts().lock().unwrap();
            let found = guard.contains_key(family.as_str())
                || guard.contains_key(&family.to_lowercase());
            if found {
                _custom_font_guard = Some(guard);
                let g = _custom_font_guard.as_ref().unwrap();
                g.get(family.as_str())
                    .or_else(|| g.get(&family.to_lowercase()))
                    .unwrap()
            } else {
                _custom_font_guard = None;
                get_font(bold)
            }
        } else {
            _custom_font_guard = None;
            get_font(bold)
        }
    };

    // Layout glyphs and get total width
    let (glyphs, text_width) = layout_glyphs(text, font, font_size, state.letter_spacing);

    // Apply text alignment
    let aligned_x = match state.text_align {
        TextAlign::Left | TextAlign::Start => x,
        TextAlign::Right | TextAlign::End => x - text_width,
        TextAlign::Center => x - text_width / 2.0,
    };

    // Get font metrics for baseline calculations
    let line_metrics = font.horizontal_line_metrics(font_size);
    let (ascent, descent) = match line_metrics {
        Some(m) => (m.ascent, m.descent),
        None => (font_size * 0.8, font_size * -0.2),
    };

    // Apply text baseline -- convert to alphabetic baseline y position
    let baseline_y = match state.text_baseline {
        TextBaseline::Top => y + ascent,
        TextBaseline::Hanging => y + ascent * 0.85,
        TextBaseline::Middle => y + (ascent + descent) / 2.0,
        TextBaseline::Alphabetic => y,
        TextBaseline::Ideographic => y - descent * 0.5,
        TextBaseline::Bottom => y + descent,
    };

    // Determine color and alpha
    let color = if fill { state.fill_color } else { state.stroke_color };
    let alpha = (color.alpha() * state.global_alpha.value()).min(1.0);
    if alpha <= 0.0 {
        return text_width;
    }

    // Calculate bounding box for the text rendering
    let padding = 4; // extra padding for anti-aliased edges
    let pm_width = (text_width + padding as f32 * 2.0).ceil() as u32 + 1;
    let pm_height = ((ascent + descent.abs()) + padding as f32 * 2.0).ceil() as u32 + 1;

    if pm_width == 0 || pm_height == 0 || pm_width > 4096 || pm_height > 4096 {
        return text_width;
    }

    // The text pixmap local coordinates: glyphs rendered at
    // (padding, padding + ascent) as baseline
    let local_x = padding as f32;
    let local_y = padding as f32 + ascent;

    // The offset to place the text pixmap on the main canvas
    let draw_offset_x = aligned_x - padding as f32;
    let draw_offset_y = baseline_y - ascent - padding as f32;

    // Check for shadow
    let has_shadow = state.shadow_color.alpha() > 0.0
        && (state.shadow_blur > 0.0
            || state.shadow_offset_x != 0.0
            || state.shadow_offset_y != 0.0);

    if has_shadow {
        let sc = state.shadow_color;
        let shadow_alpha = (sc.alpha() * state.global_alpha.value()).min(1.0);

        if shadow_alpha > 0.0 {
            if state.shadow_blur > 0.0 {
                render_blurred_shadow(
                    pixmap,
                    &glyphs,
                    local_x,
                    local_y,
                    sc,
                    shadow_alpha,
                    state.shadow_blur,
                    state.transform,
                    draw_offset_x + state.shadow_offset_x,
                    draw_offset_y + state.shadow_offset_y,
                    text_width,
                    ascent,
                    descent.abs(),
                );
            } else {
                // Simple offset shadow (no blur)
                if let Some(shadow_pm) = rasterize_glyphs_to_pixmap(
                    &glyphs, local_x, local_y, sc, shadow_alpha, pm_width, pm_height,
                ) {
                    composite_text_pixmap(
                        pixmap,
                        &shadow_pm,
                        draw_offset_x + state.shadow_offset_x,
                        draw_offset_y + state.shadow_offset_y,
                        state.transform,
                    );
                }
            }
        }
    }

    // Render the actual text
    if let Some(text_pm) = rasterize_glyphs_to_pixmap(
        &glyphs, local_x, local_y, color, alpha, pm_width, pm_height,
    ) {
        composite_text_pixmap(pixmap, &text_pm, draw_offset_x, draw_offset_y, state.transform);
    }

    text_width
}

/// Render a blurred shadow for text.
fn render_blurred_shadow(
    pixmap: &mut Pixmap,
    glyphs: &[RasterizedGlyph],
    _local_x: f32,
    _local_y: f32,
    shadow_color: Color,
    shadow_alpha: f32,
    blur_radius: f32,
    transform: Transform,
    draw_x: f32,
    draw_y: f32,
    text_width: f32,
    ascent: f32,
    descent: f32,
) {
    let blur_padding = (blur_radius * 2.0).ceil() as u32 + 2;
    let padding = 4 + blur_padding;
    let w = (text_width + padding as f32 * 2.0).ceil() as u32 + 1;
    let h = ((ascent + descent) + padding as f32 * 2.0).ceil() as u32 + 1;

    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return;
    }

    let sx = padding as f32;
    let sy = padding as f32 + ascent;

    let Some(mut shadow_pm) = rasterize_glyphs_to_pixmap(
        glyphs, sx, sy, shadow_color, shadow_alpha, w, h,
    ) else {
        return;
    };

    // Apply box blur (3 passes approximates Gaussian)
    // Canvas 2D shadowBlur = 2 * sigma for Gaussian blur
    // For 3 box blur passes with kernel size k: sigma ≈ sqrt(3 * k^2 / 12) = k * sqrt(1/4) = k/2
    // We want sigma = shadowBlur / 2, so k = shadowBlur / 2 * 2 = shadowBlur
    // But k = 2*radius + 1, so radius = (shadowBlur - 1) / 2
    let radius = ((blur_radius - 1.0) / 2.0).ceil().max(1.0) as usize;
    box_blur_rgba(&mut shadow_pm, radius);
    box_blur_rgba(&mut shadow_pm, radius);
    box_blur_rgba(&mut shadow_pm, radius);

    // Composite
    let offset_x = draw_x - (blur_padding as f32);
    let offset_y = draw_y - (blur_padding as f32);

    let paint = PixmapPaint {
        opacity: 1.0,
        blend_mode: tiny_skia::BlendMode::SourceOver,
        quality: tiny_skia::FilterQuality::Bilinear,
    };

    let t = transform.pre_translate(offset_x, offset_y);
    pixmap.draw_pixmap(0, 0, shadow_pm.as_ref(), &paint, t, None);
}

/// Box blur on RGBA premultiplied data (horizontal + vertical).
pub fn box_blur_rgba(pixmap: &mut Pixmap, radius: usize) {
    let w = pixmap.width() as usize;
    let h = pixmap.height() as usize;
    if radius == 0 || w == 0 || h == 0 {
        return;
    }

    let data = pixmap.data_mut();
    let len = w * h * 4;
    let mut buf = vec![0u8; len];

    let kernel = radius * 2 + 1;
    let div = kernel as u32;

    // Horizontal pass — process all 4 channels together per pixel
    for row in 0..h {
        let row_off = row * w * 4;
        let mut sums = [0u32; 4];
        // Initialize window
        for kx in 0..kernel {
            let col = (kx as isize - radius as isize).max(0).min(w as isize - 1) as usize;
            let idx = row_off + col * 4;
            sums[0] += data[idx] as u32;
            sums[1] += data[idx + 1] as u32;
            sums[2] += data[idx + 2] as u32;
            sums[3] += data[idx + 3] as u32;
        }
        let dst = row_off;
        buf[dst] = (sums[0] / div).min(255) as u8;
        buf[dst + 1] = (sums[1] / div).min(255) as u8;
        buf[dst + 2] = (sums[2] / div).min(255) as u8;
        buf[dst + 3] = (sums[3] / div).min(255) as u8;

        for col in 1..w {
            let add_col = (col + radius).min(w - 1);
            let sub_col = (col as isize - radius as isize - 1).max(0) as usize;
            let add_idx = row_off + add_col * 4;
            let sub_idx = row_off + sub_col * 4;
            sums[0] = sums[0] + data[add_idx] as u32 - data[sub_idx] as u32;
            sums[1] = sums[1] + data[add_idx + 1] as u32 - data[sub_idx + 1] as u32;
            sums[2] = sums[2] + data[add_idx + 2] as u32 - data[sub_idx + 2] as u32;
            sums[3] = sums[3] + data[add_idx + 3] as u32 - data[sub_idx + 3] as u32;
            let dst = row_off + col * 4;
            buf[dst] = (sums[0] / div).min(255) as u8;
            buf[dst + 1] = (sums[1] / div).min(255) as u8;
            buf[dst + 2] = (sums[2] / div).min(255) as u8;
            buf[dst + 3] = (sums[3] / div).min(255) as u8;
        }
    }

    // Vertical pass — process all 4 channels together per pixel
    for col in 0..w {
        let col_off = col * 4;
        let mut sums = [0u32; 4];
        for ky in 0..kernel {
            let row = (ky as isize - radius as isize).max(0).min(h as isize - 1) as usize;
            let idx = row * w * 4 + col_off;
            sums[0] += buf[idx] as u32;
            sums[1] += buf[idx + 1] as u32;
            sums[2] += buf[idx + 2] as u32;
            sums[3] += buf[idx + 3] as u32;
        }
        data[col_off] = (sums[0] / div).min(255) as u8;
        data[col_off + 1] = (sums[1] / div).min(255) as u8;
        data[col_off + 2] = (sums[2] / div).min(255) as u8;
        data[col_off + 3] = (sums[3] / div).min(255) as u8;

        for row in 1..h {
            let add_row = (row + radius).min(h - 1);
            let sub_row = (row as isize - radius as isize - 1).max(0) as usize;
            let add_idx = add_row * w * 4 + col_off;
            let sub_idx = sub_row * w * 4 + col_off;
            sums[0] = sums[0] + buf[add_idx] as u32 - buf[sub_idx] as u32;
            sums[1] = sums[1] + buf[add_idx + 1] as u32 - buf[sub_idx + 1] as u32;
            sums[2] = sums[2] + buf[add_idx + 2] as u32 - buf[sub_idx + 2] as u32;
            sums[3] = sums[3] + buf[add_idx + 3] as u32 - buf[sub_idx + 3] as u32;
            let dst = row * w * 4 + col_off;
            data[dst] = (sums[0] / div).min(255) as u8;
            data[dst + 1] = (sums[1] / div).min(255) as u8;
            data[dst + 2] = (sums[2] / div).min(255) as u8;
            data[dst + 3] = (sums[3] / div).min(255) as u8;
        }
    }
}

/// Load a custom font by name for use in canvas text rendering.
/// Registers the font in a global registry so `fillText`/`strokeText` can use it.
/// Maximum number of custom fonts that can be registered.
const MAX_CUSTOM_FONTS: usize = 64;

pub fn load_font(data: &[u8], name: &str) -> anyhow::Result<()> {
    let font = fontdue::Font::from_bytes(data, fontdue::FontSettings::default())
        .map_err(|e| anyhow::anyhow!("failed to parse font: {}", e))?;
    let mut fonts = custom_fonts().lock().unwrap();
    if !fonts.contains_key(name) && fonts.len() >= MAX_CUSTOM_FONTS {
        return Err(anyhow::anyhow!("custom font limit ({}) reached", MAX_CUSTOM_FONTS));
    }
    fonts.insert(name.to_string(), font);
    Ok(())
}

/// Measure text width without rendering.
#[allow(dead_code)]
pub fn measure_text(text: &str, state: &DrawState) -> f32 {
    if text.is_empty() || state.font_size <= 0.0 {
        return 0.0;
    }

    let bold = is_bold(state);
    measure_text_with(text, state.font_size, bold)
}

/// Measure text width with explicit font size and weight.
pub fn measure_text_with(text: &str, font_size: f32, bold: bool) -> f32 {
    if text.is_empty() || font_size <= 0.0 {
        return 0.0;
    }

    let font = get_font_for(bold);

    let mut width = 0.0f32;
    for ch in text.chars() {
        let (metrics, _) = font.rasterize(ch, font_size);
        width += metrics.advance_width;
    }
    width
}

/// Full text metrics matching the Canvas 2D TextMetrics interface.
pub struct FullTextMetrics {
    pub width: f32,
    pub actual_bounding_box_left: f32,
    pub actual_bounding_box_right: f32,
    pub actual_bounding_box_ascent: f32,
    pub actual_bounding_box_descent: f32,
    pub font_bounding_box_ascent: f32,
    pub font_bounding_box_descent: f32,
}

/// Measure text using fontdue, returning full TextMetrics.
pub fn measure_text_full(text: &str, font_size: f32, bold: bool) -> FullTextMetrics {
    if text.is_empty() || font_size <= 0.0 {
        return FullTextMetrics {
            width: 0.0,
            actual_bounding_box_left: 0.0,
            actual_bounding_box_right: 0.0,
            actual_bounding_box_ascent: 0.0,
            actual_bounding_box_descent: 0.0,
            font_bounding_box_ascent: font_size * 0.8,
            font_bounding_box_descent: font_size * 0.2,
        };
    }

    let font = get_font_for(bold);

    let mut advance_x = 0.0f32;
    let mut bbox_left = f32::MAX;
    let mut bbox_right = f32::MIN;
    let mut bbox_top = f32::MIN; // max ascent above baseline
    let mut bbox_bottom = f32::MAX; // max descent below baseline

    for ch in text.chars() {
        let (metrics, _) = font.rasterize(ch, font_size);
        let glyph_left = advance_x + metrics.bounds.xmin;
        let glyph_right = glyph_left + metrics.bounds.width;
        // bounds.ymin is distance from baseline to bottom of glyph (negative = below)
        let glyph_bottom = metrics.bounds.ymin;
        let glyph_top = glyph_bottom + metrics.bounds.height;

        if glyph_left < bbox_left { bbox_left = glyph_left; }
        if glyph_right > bbox_right { bbox_right = glyph_right; }
        if glyph_top > bbox_top { bbox_top = glyph_top; }
        if glyph_bottom < bbox_bottom { bbox_bottom = glyph_bottom; }

        advance_x += metrics.advance_width;
    }

    // Font-level metrics (approximate from font_size)
    let font_ascent = font_size * 0.8;
    let font_descent = font_size * 0.2;

    FullTextMetrics {
        width: advance_x,
        actual_bounding_box_left: (-bbox_left).max(0.0),
        actual_bounding_box_right: bbox_right.max(0.0),
        actual_bounding_box_ascent: bbox_top.max(0.0),
        actual_bounding_box_descent: (-bbox_bottom).max(0.0),
        font_bounding_box_ascent: font_ascent,
        font_bounding_box_descent: font_descent,
    }
}

/// Get font by bold flag — public for use by measure_text_with.
fn get_font_for(bold: bool) -> &'static fontdue::Font {
    get_font(bold)
}
