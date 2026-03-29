//! Paint laid-out elements to a tiny-skia Pixmap.

use tiny_skia::*;

use super::layout::LayoutNode;
use super::style;
use crate::canvas2d::state::DrawState;
use crate::canvas2d::text;

/// Apply opacity to a Color, returning a new Color with adjusted alpha.
fn color_with_opacity(c: Color, opacity: f32) -> Color {
    Color::from_rgba(c.red(), c.green(), c.blue(), c.alpha() * opacity).unwrap_or(c)
}

/// Convert a Color + opacity to premultiplied RGBA8 for set_color_rgba8.
fn color_to_rgba8(c: Color, opacity: f32) -> (u8, u8, u8, u8) {
    let a = c.alpha() * opacity;
    ((c.red() * 255.0) as u8, (c.green() * 255.0) as u8, (c.blue() * 255.0) as u8, (a * 255.0) as u8)
}

/// Maximum recursion depth for paint_node to prevent stack overflow.
const MAX_PAINT_DEPTH: u32 = 256;

/// Maximum number of concurrent overflow:hidden pixmap allocations in a single paint tree walk.
const MAX_OVERFLOW_PIXMAPS: u32 = 8;

/// Maximum dimension for backdrop blur region to prevent excessive memory allocation.
const MAX_BACKDROP_BLUR_DIM: usize = 2048;

/// Paint the layout tree onto the pixmap.
pub fn paint(root: &LayoutNode, pixmap: &mut Pixmap) {
    paint_node(root, pixmap, 0, 0);
}

fn paint_node(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    if depth > MAX_PAINT_DEPTH { return; }
    // If this node has a CSS transform or percentage translate, paint with transform
    if node.style.transform.is_some() || node.style.transform_translate_pct.is_some() {
        paint_node_transformed(node, pixmap, depth, overflow_count);
        return;
    }
    // clip-path creates a stacking context — paint node to temp pixmap, mask, then composite
    if !matches!(node.style.clip_path, style::ClipPath::None) {
        paint_node_clip_path(node, pixmap, depth, overflow_count);
        return;
    }
    // mix-blend-mode != Normal: paint node + children into temp pixmap, then composite
    // with the specified blend mode onto the destination.
    if node.style.blend_mode != style::BlendMode::Normal {
        paint_node_blended(node, pixmap, depth, overflow_count);
        return;
    }
    // CSS filter: paint node + children to temp pixmap, apply filters, composite
    if !node.style.filters.is_empty() {
        paint_node_filtered(node, pixmap, depth, overflow_count);
        return;
    }
    // opacity < 1 creates a stacking context — paint children as a group, then composite
    // (transform path already handles this via temp pixmap)
    let opacity = node.style.opacity.value();
    if opacity < 1.0 && opacity > 0.0 && !node.children.is_empty() {
        paint_node_opacity_context(node, pixmap, depth, overflow_count);
        return;
    }
    paint_node_inner(node, pixmap, depth, overflow_count);
}

/// Paint a node that has a non-Normal mix-blend-mode.
/// The node is painted into a temp pixmap at full opacity using SourceOver, then
/// composited onto the destination pixmap using the requested blend mode.
fn paint_node_blended(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    let pw = pixmap.width();
    let ph = pixmap.height();
    let Some(mut tmp) = Pixmap::new(pw, ph) else {
        paint_node_inner(node, pixmap, depth, overflow_count);
        return;
    };
    // Paint into temp using normal SourceOver. paint_node_inner does not check blend_mode
    // (that check lives in paint_node), so this won't recurse into blend mode logic.
    paint_node_inner(node, &mut tmp, depth, overflow_count);

    // Composite the temp pixmap onto the destination using the requested blend mode.
    let blend_mode = node.style.blend_mode.to_tiny_skia();
    let paint = PixmapPaint {
        opacity: node.style.opacity.value(),
        blend_mode,
        quality: FilterQuality::Nearest,
    };
    pixmap.draw_pixmap(0, 0, tmp.as_ref(), &paint, Transform::identity(), None);
}

/// Paint a node that creates a stacking context via opacity < 1.
/// Paints the node + children at full opacity into a temp pixmap, then composites with opacity.
/// This ensures child z-index values are trapped within this stacking context.
fn paint_node_opacity_context(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    let pw = pixmap.width();
    let ph = pixmap.height();
    let Some(mut tmp) = Pixmap::new(pw, ph) else {
        paint_node_inner(node, pixmap, depth, overflow_count);
        return;
    };
    // Paint background, border, text, and children at full opacity into temp
    paint_node_opacity_inner(node, &mut tmp, depth, overflow_count);

    // Composite the temp pixmap with the node's opacity
    let paint = PixmapPaint {
        opacity: node.style.opacity.value(),
        blend_mode: BlendMode::SourceOver,
        quality: FilterQuality::Nearest,
    };
    pixmap.draw_pixmap(0, 0, tmp.as_ref(), &paint, Transform::identity(), None);
}

/// Like paint_node_inner but forces opacity to 1.0 for all painting operations.
fn paint_node_opacity_inner(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    let x = node.bounds.x;
    let y = node.bounds.y;
    let w = node.bounds.w;
    let h = node.bounds.h;

    if w <= 0.0 || h <= 0.0 {
        if let Some(ref text_str) = node.text {
            paint_text(text_str, x, y, w, &node.style, pixmap);
        }
        for child in &node.children {
            paint_node(child, pixmap, depth + 1, overflow_count);
        }
        return;
    }

    let vw = pixmap.width() as f32;
    let vh = pixmap.height() as f32;
    let vp = style::Viewport { w: vw, h: vh, root_font_size: style::ROOT_FONT_SIZE };
    let fs = node.style.font_size;
    let radii: [(f32, f32); 4] = [
        (node.style.border_radius[0].resolve(w, fs, vp), node.style.border_radius[0].resolve(h, fs, vp)),
        (node.style.border_radius[1].resolve(w, fs, vp), node.style.border_radius[1].resolve(h, fs, vp)),
        (node.style.border_radius[2].resolve(w, fs, vp), node.style.border_radius[2].resolve(h, fs, vp)),
        (node.style.border_radius[3].resolve(w, fs, vp), node.style.border_radius[3].resolve(h, fs, vp)),
    ];
    let opacity = 1.0; // Force full opacity — the caller composites with the real opacity

    // Background
    if let Some(ref rg) = node.style.background_radial_gradient {
        paint_radial_gradient(x, y, w, h, rg, radii, opacity, pixmap);
    } else if let Some(ref gradient) = node.style.background_gradient {
        paint_gradient(x, y, w, h, gradient, radii, opacity, pixmap);
    } else if node.style.background_color.alpha() > 0.0 {
        paint_rect(x, y, w, h, node.style.background_color, radii, opacity, pixmap);
    }

    // Text
    if let Some(ref text_str) = node.text {
        paint_text(text_str, x, y, w, &node.style, pixmap);
    }

    // Children (z-index sorted within this stacking context)
    let has_zindex = node.children.iter().any(|c| c.style.z_index != 0);
    if has_zindex {
        let mut sorted: Vec<(usize, &LayoutNode)> = node.children.iter().enumerate().collect();
        sorted.sort_by(|a, b| a.1.style.z_index.cmp(&b.1.style.z_index).then(a.0.cmp(&b.0)));
        for (_, child) in &sorted {
            paint_node(child, pixmap, depth + 1, overflow_count);
        }
    } else {
        for child in &node.children {
            paint_node(child, pixmap, depth + 1, overflow_count);
        }
    }
}

/// Paint a node that has a `clip-path` applied.
///
/// Strategy:
/// 1. Paint the node (and its children) into a full-viewport temp pixmap `content`.
///    We call `paint_node_inner` directly, which does not check clip_path, to avoid recursion.
/// 2. Create a same-size `mask` pixmap filled with the clip shape in white.
/// 3. For each pixel in the node's bounding box, multiply `content` alpha by `mask` alpha
///    and composite the result onto the parent pixmap.
fn paint_node_clip_path(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    let pw = pixmap.width();
    let ph = pixmap.height();

    // 1. Paint node content at full viewport scale into temp pixmap.
    // Use paint_node_inner directly — it doesn't check clip_path, so no recursion.
    let mut content_tmp = match Pixmap::new(pw, ph) {
        Some(p) => p,
        None => { paint_node_inner(node, pixmap, depth, overflow_count); return; }
    };
    paint_node_inner(node, &mut content_tmp, depth, overflow_count);

    let x = node.bounds.x;
    let y = node.bounds.y;
    let w = node.bounds.w;
    let h = node.bounds.h;

    // 2. Build the clip shape path in global coords and fill a mask pixmap
    let clip_path_opt = match &node.style.clip_path {
        style::ClipPath::Circle { radius } => {
            // CSS circle(r) — r is a fraction of the reference box side.
            // circle(50%) inscribes a circle in the element: r = 50% of min(w,h).
            let ref_len = w.min(h);
            let r = radius * ref_len;
            let cx = x + w / 2.0;
            let cy = y + h / 2.0;
            let k = 0.5522847498_f32;
            let mut pb = PathBuilder::new();
            pb.move_to(cx + r, cy);
            pb.cubic_to(cx + r, cy + r * k, cx + r * k, cy + r, cx, cy + r);
            pb.cubic_to(cx - r * k, cy + r, cx - r, cy + r * k, cx - r, cy);
            pb.cubic_to(cx - r, cy - r * k, cx - r * k, cy - r, cx, cy - r);
            pb.cubic_to(cx + r * k, cy - r, cx + r, cy - r * k, cx + r, cy);
            pb.close();
            pb.finish()
        }
        style::ClipPath::Polygon { points } => {
            if points.is_empty() { return; }
            let mut pb = PathBuilder::new();
            let (fx, fy) = points[0];
            pb.move_to(x + fx * w, y + fy * h);
            for &(px, py) in &points[1..] {
                pb.line_to(x + px * w, y + py * h);
            }
            pb.close();
            pb.finish()
        }
        style::ClipPath::None => return, // shouldn't happen
    };

    let Some(clip_shape) = clip_path_opt else { return };

    let mut mask_tmp = match Pixmap::new(pw, ph) {
        Some(p) => p,
        None => return,
    };
    let mut mask_paint = Paint::default();
    mask_paint.set_color_rgba8(255, 255, 255, 255);
    mask_paint.anti_alias = true;
    mask_tmp.fill_path(&clip_shape, &mask_paint, FillRule::Winding, Transform::identity(), None);

    // 3. Alpha-composite: for each pixel in node bounds, multiply content alpha by mask alpha,
    //    then composite the masked content onto the parent pixmap.
    let clip_x = x.max(0.0) as u32;
    let clip_y = y.max(0.0) as u32;
    let clip_w = ((x + w).ceil() as u32).min(pw).saturating_sub(clip_x);
    let clip_h = ((y + h).ceil() as u32).min(ph).saturating_sub(clip_y);
    let stride = (pw * 4) as usize;

    let content_data = content_tmp.data().to_vec();
    let mask_data = mask_tmp.data().to_vec();
    let dst = pixmap.data_mut();

    for row in 0..clip_h {
        let py = clip_y + row;
        for col in 0..clip_w {
            let px = clip_x + col;
            let off = py as usize * stride + px as usize * 4;
            if off + 3 >= content_data.len() { continue; }

            let ma = mask_data[off + 3] as u16;
            if ma == 0 { continue; }

            let src_a = content_data[off + 3] as u16;
            if src_a == 0 { continue; }

            // Scale content alpha by mask alpha
            let sa = if ma == 255 { src_a } else { (src_a * ma + 127) / 255 };

            // Apply mask to each RGB channel (content is premultiplied)
            let (cr, cg, cb) = if ma == 255 {
                (content_data[off] as u16, content_data[off+1] as u16, content_data[off+2] as u16)
            } else {
                (
                    (content_data[off]   as u16 * ma + 127) / 255,
                    (content_data[off+1] as u16 * ma + 127) / 255,
                    (content_data[off+2] as u16 * ma + 127) / 255,
                )
            };

            // Alpha-composite masked src over dst (both premultiplied)
            let da = dst[off + 3] as u16;
            let inv_sa = 255 - sa;
            if sa == 255 {
                dst[off]   = cr as u8;
                dst[off+1] = cg as u8;
                dst[off+2] = cb as u8;
                dst[off+3] = 255;
            } else {
                dst[off]   = (cr + (dst[off]   as u16 * inv_sa + 127) / 255).min(255) as u8;
                dst[off+1] = (cg + (dst[off+1] as u16 * inv_sa + 127) / 255).min(255) as u8;
                dst[off+2] = (cb + (dst[off+2] as u16 * inv_sa + 127) / 255).min(255) as u8;
                dst[off+3] = (sa + (da * inv_sa + 127) / 255).min(255) as u8;
            }
        }
    }
}

/// Paint a node with a CSS transform applied.
/// Paints the node to a node-sized temp pixmap, then composites with the transform.
fn paint_node_transformed(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    // Clamp dimensions to prevent OOM from malicious CSS (e.g., width: 999999999px)
    let nw = (node.bounds.w.ceil().max(0.0).min(8192.0)) as u32;
    let nh = (node.bounds.h.ceil().max(0.0).min(8192.0)) as u32;
    if nw == 0 || nh == 0 { return; }

    // Paint node into a temp pixmap at local origin (0,0)
    let mut local_node = LayoutNode {
        bounds: style::Rect { x: 0.0, y: 0.0, w: node.bounds.w, h: node.bounds.h },
        style: node.style.clone(),
        text: node.text.clone(),
        tag: node.tag.clone(),
        svg_data: node.svg_data.clone(),
        image_data: node.image_data.clone(),
        image_natural_size: node.image_natural_size,
        children: offset_children(&node.children, -node.bounds.x, -node.bounds.y),
    };
    local_node.style.transform = None; // prevent infinite recursion
    local_node.style.transform_translate_pct = None;
    let Some(mut tmp) = Pixmap::new(nw, nh) else { return };
    paint_node_inner(&local_node, &mut tmp, depth, overflow_count);

    // Compute transform-origin in local coords, then translate to global position
    let local_ox = node.bounds.w * node.style.transform_origin_x;
    let local_oy = node.bounds.h * node.style.transform_origin_y;
    let base_transform = node.style.transform.unwrap_or(Transform::identity());

    // Resolve percentage-based translate and compose with the matrix transform
    let pct_translate = if let Some((px, py)) = node.style.transform_translate_pct {
        Transform::from_translate(px * node.bounds.w, py * node.bounds.h)
    } else {
        Transform::identity()
    };
    let transform = pct_translate.post_concat(base_transform);

    // Full transform applied to each pixel:
    // 1. Shift origin to transform-origin point: translate(-local_ox, -local_oy)
    // 2. Apply the CSS transform (rotate, scale, etc.)
    // 3. Shift back and to global position: translate(node.bounds.x + local_ox, node.bounds.y + local_oy)
    let t = Transform::from_translate(-local_ox, -local_oy)
        .post_concat(transform)
        .post_concat(Transform::from_translate(node.bounds.x + local_ox, node.bounds.y + local_oy));

    let paint = PixmapPaint {
        opacity: node.style.opacity.value(),
        blend_mode: BlendMode::SourceOver,
        quality: FilterQuality::Bilinear,
    };
    pixmap.draw_pixmap(0, 0, tmp.as_ref(), &paint, t, None);
}

/// Maximum recursion depth for offset_children to prevent stack overflow from deeply nested HTML.
const MAX_OFFSET_DEPTH: usize = 512;

/// Recursively offset children's positions.
fn offset_children(children: &[LayoutNode], dx: f32, dy: f32) -> Vec<LayoutNode> {
    offset_children_inner(children, dx, dy, 0)
}

fn offset_children_inner(children: &[LayoutNode], dx: f32, dy: f32, depth: usize) -> Vec<LayoutNode> {
    if depth > MAX_OFFSET_DEPTH {
        return vec![];
    }
    children.iter().map(|c| LayoutNode {
        bounds: style::Rect { x: c.bounds.x + dx, y: c.bounds.y + dy, w: c.bounds.w, h: c.bounds.h },
        style: c.style.clone(),
        text: c.text.clone(),
        tag: c.tag.clone(),
        svg_data: c.svg_data.clone(),
        image_data: c.image_data.clone(),
        image_natural_size: c.image_natural_size,
        children: offset_children_inner(&c.children, dx, dy, depth + 1),
    }).collect()
}

fn paint_node_inner(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    // Inline <svg> — rasterize via resvg and composite at layout position
    if let Some(ref svg_data) = node.svg_data {
        paint_inline_svg(svg_data, node.bounds.x, node.bounds.y, node.bounds.w, node.bounds.h, pixmap);
        return;
    }

    // <img> element — paint decoded image data at layout bounds
    if let Some(ref img_rgba) = node.image_data {
        if let Some((iw, ih)) = node.image_natural_size {
            paint_image(img_rgba, iw, ih, node.bounds.x, node.bounds.y, node.bounds.w, node.bounds.h, pixmap);
        }
        return;
    }

    let x = node.bounds.x;
    let y = node.bounds.y;
    let w = node.bounds.w;
    let h = node.bounds.h;

    // Skip zero-size or off-screen nodes
    if w <= 0.0 || h <= 0.0 {
        if let Some(ref text_str) = node.text {
            paint_text(text_str, x, y, w, &node.style, pixmap);
        }
        // Still paint children (text nodes etc.)
        for child in &node.children {
            paint_node(child, pixmap, depth + 1, overflow_count);
        }
        return;
    }

    let opacity = node.style.opacity.value();
    if !node.style.opacity.is_visible() { return; }

    let vw = pixmap.width() as f32;
    let vh = pixmap.height() as f32;
    // Resolve border-radius: % resolves against each axis independently (CSS spec)
    let vp = style::Viewport { w: vw, h: vh, root_font_size: style::ROOT_FONT_SIZE };
    let fs = node.style.font_size;
    let radii: [(f32, f32); 4] = [
        (node.style.border_radius[0].resolve(w, fs, vp), node.style.border_radius[0].resolve(h, fs, vp)),
        (node.style.border_radius[1].resolve(w, fs, vp), node.style.border_radius[1].resolve(h, fs, vp)),
        (node.style.border_radius[2].resolve(w, fs, vp), node.style.border_radius[2].resolve(h, fs, vp)),
        (node.style.border_radius[3].resolve(w, fs, vp), node.style.border_radius[3].resolve(h, fs, vp)),
    ];

    // --- Box shadow (painted before background, behind the element) ---
    for shadow in &node.style.box_shadows {
        if !shadow.inset {
            paint_box_shadow(x, y, w, h, shadow, radii, pixmap);
        }
    }

    // --- Backdrop filter (blur region behind element before painting background) ---
    if let Some(blur_radius) = node.style.backdrop_filter_blur {
        if blur_radius > 0.0 {
            apply_backdrop_blur(x, y, w, h, blur_radius, pixmap);
        }
    }

    // --- Background ---
    if let Some(ref rg) = node.style.background_radial_gradient {
        paint_radial_gradient(x, y, w, h, rg, radii, opacity, pixmap);
    } else if let Some(ref gradient) = node.style.background_gradient {
        paint_gradient(x, y, w, h, gradient, radii, opacity, pixmap);
    } else if node.style.background_color.alpha() > 0.0 {
        paint_rect(x, y, w, h, node.style.background_color, radii, opacity, pixmap);
    }

    // --- Border (per-side) ---
    let bt = node.style.border_top_width.resolve(w, node.style.font_size, vp);
    let br = node.style.border_right_width.resolve(w, node.style.font_size, vp);
    let bb = node.style.border_bottom_width.resolve(w, node.style.font_size, vp);
    let bl = node.style.border_left_width.resolve(w, node.style.font_size, vp);
    // Check if all sides have the same width, color, and style — use unified border for rounded corners
    let uniform_border = bt == br && br == bb && bb == bl
        && node.style.border_top_color == node.style.border_right_color
        && node.style.border_right_color == node.style.border_bottom_color
        && node.style.border_bottom_color == node.style.border_left_color
        && node.style.border_top_style == node.style.border_right_style
        && node.style.border_right_style == node.style.border_bottom_style
        && node.style.border_bottom_style == node.style.border_left_style;
    let has_radius = radii.iter().any(|(rx, ry)| *rx > 0.0 || *ry > 0.0);
    if bt > 0.0 || br > 0.0 || bb > 0.0 || bl > 0.0 {
        if uniform_border {
            // Use paint_border for all uniform-border cases (handles radius and all styles correctly)
            paint_border(x, y, w, h, bt, node.style.border_top_color,
                node.style.border_top_style, radii, opacity, pixmap);
        } else {
            paint_border_sides(x, y, w, h, bt, br, bb, bl,
                node.style.border_top_color, node.style.border_right_color,
                node.style.border_bottom_color, node.style.border_left_color,
                node.style.border_top_style, node.style.border_right_style,
                node.style.border_bottom_style, node.style.border_left_style,
                opacity, pixmap);
        }
    }

    // --- Text content ---
    if let Some(ref text_str) = node.text {
        paint_text(text_str, x, y, w, &node.style, pixmap);
    }

    // --- Children (sorted by z-index for stacking context) ---
    // Avoid Vec allocation in the common case (no z-index set on any child).
    let has_zindex = node.children.iter().any(|c| c.style.z_index != 0);

    if node.style.overflow_hidden && !node.children.is_empty() && overflow_count < MAX_OVERFLOW_PIXMAPS {
        // Paint children to a temporary pixmap, then composite only the clipped region
        let pw = pixmap.width();
        let ph = pixmap.height();
        let Some(mut tmp) = Pixmap::new(pw, ph) else { return };
        if has_zindex {
            let mut sorted: Vec<(usize, &LayoutNode)> = node.children.iter().enumerate().collect();
            sorted.sort_by(|a, b| a.1.style.z_index.cmp(&b.1.style.z_index).then(a.0.cmp(&b.0)));
            for (_, child) in &sorted {
                paint_node(child, &mut tmp, depth + 1, overflow_count + 1);
            }
        } else {
            for child in &node.children {
                paint_node(child, &mut tmp, depth + 1, overflow_count + 1);
            }
        }
        // Composite tmp onto pixmap, clipped to this node's bounds
        let clip_x = x.max(0.0) as u32;
        let clip_y = y.max(0.0) as u32;
        let clip_w = (w as u32).min(pw.saturating_sub(clip_x));
        let clip_h = (h as u32).min(ph.saturating_sub(clip_y));
        let tmp_data = tmp.data();
        let stride = (pw * 4) as usize;
        for row in 0..clip_h {
            let py = clip_y + row;
            let src_off = (py as usize) * stride + (clip_x as usize) * 4;
            let src_end = src_off + (clip_w as usize) * 4;
            if src_end <= tmp_data.len() {
                let src_row = &tmp_data[src_off..src_end];
                // Alpha-composite src over dst (both premultiplied)
                let dst = pixmap.data_mut();
                for col in 0..clip_w as usize {
                    let si = col * 4;
                    let di = src_off + col * 4;
                    let sa = src_row[si + 3] as u16;
                    if sa == 0 { continue; }
                    if sa == 255 {
                        dst[di] = src_row[si];
                        dst[di+1] = src_row[si+1];
                        dst[di+2] = src_row[si+2];
                        dst[di+3] = src_row[si+3];
                    } else {
                        let inv_sa = 255 - sa;
                        dst[di]   = (src_row[si]   as u16 + (dst[di]   as u16 * inv_sa / 255)).min(255) as u8;
                        dst[di+1] = (src_row[si+1] as u16 + (dst[di+1] as u16 * inv_sa / 255)).min(255) as u8;
                        dst[di+2] = (src_row[si+2] as u16 + (dst[di+2] as u16 * inv_sa / 255)).min(255) as u8;
                        dst[di+3] = (sa + (dst[di+3] as u16 * inv_sa / 255)).min(255) as u8;
                    }
                }
            }
        }
    } else {
        if has_zindex {
            let mut sorted: Vec<(usize, &LayoutNode)> = node.children.iter().enumerate().collect();
            sorted.sort_by(|a, b| a.1.style.z_index.cmp(&b.1.style.z_index).then(a.0.cmp(&b.0)));
            for (_, child) in &sorted {
                paint_node(child, pixmap, depth + 1, overflow_count);
            }
        } else {
            for child in &node.children {
                paint_node(child, pixmap, depth + 1, overflow_count);
            }
        }
    }
}

fn paint_rect(x: f32, y: f32, w: f32, h: f32, color: Color, radii: [(f32, f32); 4], opacity: f32, pixmap: &mut Pixmap) {
    let mut paint = Paint::default();
    let (r, g, b, a) = color_to_rgba8(color, opacity);
    paint.set_color_rgba8(r, g, b, a);
    paint.anti_alias = true;

    let has_radius = radii.iter().any(|(rx, ry)| *rx > 0.0 || *ry > 0.0);
    if has_radius {
        if let Some(path) = rounded_rect_path(x, y, w, h, radii) {
            pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
        }
    } else {
        if let Some(rect) = Rect::from_xywh(x, y, w, h) {
            pixmap.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }
}

fn paint_gradient(
    x: f32, y: f32, w: f32, h: f32,
    gradient: &style::LinearGradient,
    radii: [(f32, f32); 4],
    opacity: f32,
    pixmap: &mut Pixmap,
) {
    // CSS spec gradient line length: abs(W*sin(a)) + abs(H*cos(a)).
    let angle_rad = gradient.angle.to_radians();
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let half_len = (w * angle_rad.sin().abs() + h * angle_rad.cos().abs()) / 2.0;
    let dx = angle_rad.sin() * half_len;
    let dy = -angle_rad.cos() * half_len;

    // Fix transparent stops: CSS "transparent" fades to the neighboring color
    // at alpha=0, not through black.
    let raw: Vec<(f32, tiny_skia::Color)> = gradient.stops.iter().map(|s| {
        (s.position.map(|f| f.value()).unwrap_or(0.0), color_with_opacity(s.color, opacity))
    }).collect();
    let n = raw.len();
    let mut stops: Vec<GradientStop> = Vec::with_capacity(n + 4);
    for i in 0..n {
        let (pos, col) = raw[i];
        if col.alpha() > 0.0 { stops.push(GradientStop::new(pos, col)); continue; }
        let prev = (0..i).rev().find(|&j| raw[j].1.alpha() > 0.0).map(|j| raw[j].1);
        let next = ((i+1)..n).find(|&j| raw[j].1.alpha() > 0.0).map(|j| raw[j].1);
        match (prev, next) {
            (Some(l), Some(r)) => {
                let tl = tiny_skia::Color::from_rgba(l.red(), l.green(), l.blue(), 0.0).unwrap_or(col);
                let tr = tiny_skia::Color::from_rgba(r.red(), r.green(), r.blue(), 0.0).unwrap_or(col);
                stops.push(GradientStop::new(pos, tl));
                stops.push(GradientStop::new(pos, tr));
            }
            (Some(d), None) | (None, Some(d)) => {
                stops.push(GradientStop::new(pos, tiny_skia::Color::from_rgba(d.red(), d.green(), d.blue(), 0.0).unwrap_or(col)));
            }
            (None, None) => stops.push(GradientStop::new(pos, col)),
        }
    }

    if stops.len() < 2 { return; }

    let shader = LinearGradient::new(
        Point::from_xy(cx - dx, cy - dy),
        Point::from_xy(cx + dx, cy + dy),
        stops,
        SpreadMode::Pad,
        Transform::identity(),
    );

    let Some(shader) = shader else { return };
    let mut paint = Paint::default();
    paint.shader = shader;
    paint.anti_alias = true;

    let has_r = radii.iter().any(|(rx, ry)| *rx > 0.0 || *ry > 0.0);
    if has_r {
        if let Some(path) = rounded_rect_path(x, y, w, h, radii) {
            pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
        }
    } else {
        if let Some(rect) = Rect::from_xywh(x, y, w, h) {
            pixmap.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }
}

fn paint_radial_gradient(
    x: f32, y: f32, w: f32, h: f32,
    gradient: &style::RadialGradient,
    radii: [(f32, f32); 4],
    opacity: f32,
    pixmap: &mut Pixmap,
) {
    let cx = x + w * gradient.position.0;
    let cy = y + h * gradient.position.1;

    // Build gradient stops (same transparent-stop fix as linear gradient)
    let raw: Vec<(f32, tiny_skia::Color)> = gradient.stops.iter().map(|s| {
        (s.position.map(|f| f.value()).unwrap_or(0.0), color_with_opacity(s.color, opacity))
    }).collect();
    let n = raw.len();
    let mut stops: Vec<GradientStop> = Vec::with_capacity(n + 4);
    for i in 0..n {
        let (pos, col) = raw[i];
        if col.alpha() > 0.0 { stops.push(GradientStop::new(pos, col)); continue; }
        let prev = (0..i).rev().find(|&j| raw[j].1.alpha() > 0.0).map(|j| raw[j].1);
        let next = ((i+1)..n).find(|&j| raw[j].1.alpha() > 0.0).map(|j| raw[j].1);
        match (prev, next) {
            (Some(l), Some(r)) => {
                let tl = tiny_skia::Color::from_rgba(l.red(), l.green(), l.blue(), 0.0).unwrap_or(col);
                let tr = tiny_skia::Color::from_rgba(r.red(), r.green(), r.blue(), 0.0).unwrap_or(col);
                stops.push(GradientStop::new(pos, tl));
                stops.push(GradientStop::new(pos, tr));
            }
            (Some(d), None) | (None, Some(d)) => {
                stops.push(GradientStop::new(pos, tiny_skia::Color::from_rgba(d.red(), d.green(), d.blue(), 0.0).unwrap_or(col)));
            }
            (None, None) => stops.push(GradientStop::new(pos, col)),
        }
    }
    if stops.len() < 2 { return; }

    let shader = match gradient.shape {
        style::RadialShape::Circle => {
            // Radius = distance from center to farthest corner (CSS "farthest-corner" default)
            let corners = [
                ((x - cx).hypot(y - cy)),
                ((x + w - cx).hypot(y - cy)),
                ((x - cx).hypot(y + h - cy)),
                ((x + w - cx).hypot(y + h - cy)),
            ];
            let radius = corners.iter().cloned().fold(0.0f32, f32::max);
            if radius <= 0.0 { return; }
            RadialGradient::new(
                Point::from_xy(cx, cy),
                0.0,
                Point::from_xy(cx, cy),
                radius,
                stops,
                SpreadMode::Pad,
                Transform::identity(),
            )
        }
        style::RadialShape::Ellipse => {
            // CSS spec farthest-corner ellipse:
            // - The ellipse aspect ratio equals the element aspect ratio (w/h).
            // - The ellipse passes through the farthest corner from the center.
            //
            // Find farthest corner distance in *normalized* element space.
            // normalized_dist = sqrt((corner_dx/w)^2 + (corner_dy/h)^2)
            // Then rx = normalized_dist * w, ry = normalized_dist * h.
            let corners = [
                ((cx - x) / w, (cy - y) / h),
                ((x + w - cx) / w, (cy - y) / h),
                ((cx - x) / w, (y + h - cy) / h),
                ((x + w - cx) / w, (y + h - cy) / h),
            ];
            let norm_dist = corners.iter()
                .map(|&(nx, ny)| (nx * nx + ny * ny).sqrt())
                .fold(0.0f32, f32::max);
            let rx = norm_dist * w;
            let ry = norm_dist * h;
            if rx <= 0.0 || ry <= 0.0 { return; }

            // Map ellipse to circle by scaling y by rx/ry.
            // pass transform=scale(1, rx/ry) so world coords -> gradient space
            // performs (px-cx)/rx along x and (py-cy)/ry along y.
            let scale_y = rx / ry;
            let transform = Transform::from_scale(1.0, scale_y);
            RadialGradient::new(
                Point::from_xy(cx, cy * scale_y),
                0.0,
                Point::from_xy(cx, cy * scale_y),
                rx,
                stops,
                SpreadMode::Pad,
                transform,
            )
        }
    };

    let Some(shader) = shader else { return };
    let mut paint = Paint::default();
    paint.shader = shader;
    paint.anti_alias = true;

    let has_r = radii.iter().any(|(rx, ry)| *rx > 0.0 || *ry > 0.0);
    if has_r {
        if let Some(path) = rounded_rect_path(x, y, w, h, radii) {
            pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
        }
    } else {
        if let Some(rect) = Rect::from_xywh(x, y, w, h) {
            pixmap.fill_rect(rect, &paint, Transform::identity(), None);
        }
    }
}

fn paint_border(
    x: f32, y: f32, w: f32, h: f32,
    border_width: f32, color: Color, border_style: style::BorderStyle,
    radii: [(f32, f32); 4], opacity: f32,
    pixmap: &mut Pixmap,
) {
    use style::BorderStyle;

    // Build the stroke center path (inset by `inset` pixels from outer edge).
    let build_rect_path = |inset: f32| -> Option<tiny_skia::Path> {
        let has_r = radii.iter().any(|(rx, ry)| *rx > 0.0 || *ry > 0.0);
        if has_r {
            rounded_rect_path(x + inset, y + inset, w - inset * 2.0, h - inset * 2.0, radii)
        } else {
            let mut pb = PathBuilder::new();
            pb.move_to(x + inset, y + inset);
            pb.line_to(x + w - inset, y + inset);
            pb.line_to(x + w - inset, y + h - inset);
            pb.line_to(x + inset, y + h - inset);
            pb.close();
            pb.finish()
        }
    };

    match border_style {
        BorderStyle::None => {}

        BorderStyle::Double => {
            // Two strokes each ~border_width/3 thick, separated by ~border_width/3 gap.
            let line_w = (border_width / 3.0).max(1.0);
            let outer_inset = line_w / 2.0;
            let inner_inset = border_width - line_w / 2.0;
            let stroke = Stroke {
                width: line_w,
                line_cap: LineCap::Butt,
                line_join: LineJoin::Miter,
                miter_limit: 4.0,
                dash: None,
            };
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(color, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            for &inset in &[outer_inset, inner_inset] {
                if let Some(path) = build_rect_path(inset) {
                    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                }
            }
        }

        BorderStyle::Dotted => {
            // Draw filled circles along each edge. Chrome evenly distributes dots so that the
            // first and last dot on each edge are centered at the corner centers, with spacing
            // computed as span / round(span / (2 * border_width)).
            let dot_r = border_width / 2.0;
            let half = border_width / 2.0;
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(color, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;

            let draw_dot = |cx: f32, cy: f32, paint: &Paint, pix: &mut Pixmap| {
                let k = 0.5522847498_f32;
                let mut pb = PathBuilder::new();
                pb.move_to(cx + dot_r, cy);
                pb.cubic_to(cx+dot_r, cy+dot_r*k, cx+dot_r*k, cy+dot_r, cx, cy+dot_r);
                pb.cubic_to(cx-dot_r*k, cy+dot_r, cx-dot_r, cy+dot_r*k, cx-dot_r, cy);
                pb.cubic_to(cx-dot_r, cy-dot_r*k, cx-dot_r*k, cy-dot_r, cx, cy-dot_r);
                pb.cubic_to(cx+dot_r*k, cy-dot_r, cx+dot_r, cy-dot_r*k, cx+dot_r, cy);
                pb.close();
                if let Some(path) = pb.finish() {
                    pix.fill_path(&path, paint, FillRule::Winding, Transform::identity(), None);
                }
            };

            // Compute evenly-distributed spacing for an edge of the given span.
            // span goes from first dot center to last dot center.
            let dot_spacing = |span: f32| -> f32 {
                let nominal = border_width * 2.0;
                let n_gaps = (span / nominal).round().max(1.0) as i32;
                span / n_gaps as f32
            };

            // Top edge: dot centers from (x+half, y+half) to (x+w-half, y+half)
            let y_top = y + half;
            let x_start = x + half;
            let x_end = x + w - half;
            let h_span = x_end - x_start;
            let h_step = dot_spacing(h_span);
            let h_n = ((h_span / h_step).round() as i32) + 1;
            for i in 0..h_n {
                let cx = x_start + i as f32 * h_step;
                draw_dot(cx, y_top, &paint, pixmap);
            }

            // Bottom edge
            let y_bot = y + h - half;
            for i in 0..h_n {
                let cx = x_start + i as f32 * h_step;
                draw_dot(cx, y_bot, &paint, pixmap);
            }

            // Left/right edges: vertical span, skip corners (first and last dot already drawn)
            let y_start = y + half;
            let y_end = y + h - half;
            let v_span = y_end - y_start;
            let v_step = dot_spacing(v_span);
            let v_n = ((v_span / v_step).round() as i32) + 1;

            // Left edge (skip i=0 and i=v_n-1 as they are corner dots drawn above)
            let x_left = x + half;
            for i in 1..(v_n - 1) {
                let cy = y_start + i as f32 * v_step;
                draw_dot(x_left, cy, &paint, pixmap);
            }

            // Right edge
            let x_right = x + w - half;
            for i in 1..(v_n - 1) {
                let cy = y_start + i as f32 * v_step;
                draw_dot(x_right, cy, &paint, pixmap);
            }
        }

        BorderStyle::Dashed => {
            // Stroke with dash pattern: dash = 2*width, gap = width (matches Chrome).
            // Phase offset = border_width/2 so that the first dash aligns with the outer corner.
            let dash_len = border_width * 2.0;
            let gap_len = border_width;
            let phase = border_width / 2.0;
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(color, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            let stroke = Stroke {
                width: border_width,
                line_cap: LineCap::Butt,
                line_join: LineJoin::Miter,
                miter_limit: 4.0,
                dash: StrokeDash::new(vec![dash_len, gap_len], phase),
            };
            if let Some(path) = build_rect_path(border_width / 2.0) {
                pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
            }
        }

        BorderStyle::Solid => {
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(color, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            let stroke = Stroke {
                width: border_width,
                line_cap: LineCap::Butt,
                line_join: LineJoin::Miter,
                miter_limit: 4.0,
                dash: None,
            };
            if let Some(path) = build_rect_path(border_width / 2.0) {
                pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
            }
        }
    }
}
/// Paint each border side with its own width, color, and style.
fn paint_border_sides(
    x: f32, y: f32, w: f32, h: f32,
    bt: f32, br: f32, bb: f32, bl: f32,
    ct: Color, cr: Color, cb: Color, cl: Color,
    st: style::BorderStyle, sr: style::BorderStyle,
    sb: style::BorderStyle, sl: style::BorderStyle,
    opacity: f32,
    pixmap: &mut Pixmap,
) {
    use style::BorderStyle;

    // For all-solid, use trapezoid approach for sharp miter corners.
    // For patterned, stroke centered lines per edge.
    let all_solid = (st == BorderStyle::Solid || st == BorderStyle::None)
        && (sr == BorderStyle::Solid || sr == BorderStyle::None)
        && (sb == BorderStyle::Solid || sb == BorderStyle::None)
        && (sl == BorderStyle::Solid || sl == BorderStyle::None);

    if all_solid {
        if bt > 0.0 && st != BorderStyle::None {
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(ct, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            let mut pb = PathBuilder::new();
            pb.move_to(x, y);
            pb.line_to(x + w, y);
            pb.line_to(x + w - br, y + bt);
            pb.line_to(x + bl, y + bt);
            pb.close();
            if let Some(path) = pb.finish() {
                pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
            }
        }
        if br > 0.0 && sr != BorderStyle::None {
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(cr, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            let mut pb = PathBuilder::new();
            pb.move_to(x + w, y);
            pb.line_to(x + w, y + h);
            pb.line_to(x + w - br, y + h - bb);
            pb.line_to(x + w - br, y + bt);
            pb.close();
            if let Some(path) = pb.finish() {
                pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
            }
        }
        if bb > 0.0 && sb != BorderStyle::None {
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(cb, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            let mut pb = PathBuilder::new();
            pb.move_to(x + w, y + h);
            pb.line_to(x, y + h);
            pb.line_to(x + bl, y + h - bb);
            pb.line_to(x + w - br, y + h - bb);
            pb.close();
            if let Some(path) = pb.finish() {
                pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
            }
        }
        if bl > 0.0 && sl != BorderStyle::None {
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(cl, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            let mut pb = PathBuilder::new();
            pb.move_to(x, y + h);
            pb.line_to(x, y);
            pb.line_to(x + bl, y + bt);
            pb.line_to(x + bl, y + h - bb);
            pb.close();
            if let Some(path) = pb.finish() {
                pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
            }
        }
    } else {
        // Patterned borders: stroke each edge as a centered line.
        let tht = bt / 2.0;
        let thr = br / 2.0;
        let thb = bb / 2.0;
        let thl = bl / 2.0;

        let stroke_edge = |x1: f32, y1: f32, x2: f32, y2: f32, width: f32,
                           color: Color, bstyle: BorderStyle, pix: &mut Pixmap| {
            if width <= 0.0 || bstyle == BorderStyle::None { return; }
            let mut paint = Paint::default();
            let (r, g, b, a) = color_to_rgba8(color, opacity);
            paint.set_color_rgba8(r, g, b, a);
            paint.anti_alias = true;
            match bstyle {
                BorderStyle::None => {}
                BorderStyle::Dotted => {
                    let dot_r = width / 2.0;
                    let spacing = width * 2.0;
                    let dx = x2 - x1;
                    let dy = y2 - y1;
                    let len = (dx * dx + dy * dy).sqrt();
                    if len <= 0.0 { return; }
                    let ux = dx / len;
                    let uy = dy / len;
                    let k = 0.5522847498_f32;
                    let mut t = 0.0_f32;
                    while t <= len + 0.001 {
                        let t_c = t.min(len);
                        let cx = x1 + ux * t_c;
                        let cy = y1 + uy * t_c;
                        let mut pb = PathBuilder::new();
                        pb.move_to(cx + dot_r, cy);
                        pb.cubic_to(cx+dot_r, cy+dot_r*k, cx+dot_r*k, cy+dot_r, cx, cy+dot_r);
                        pb.cubic_to(cx-dot_r*k, cy+dot_r, cx-dot_r, cy+dot_r*k, cx-dot_r, cy);
                        pb.cubic_to(cx-dot_r, cy-dot_r*k, cx-dot_r*k, cy-dot_r, cx, cy-dot_r);
                        pb.cubic_to(cx+dot_r*k, cy-dot_r, cx+dot_r, cy-dot_r*k, cx+dot_r, cy);
                        pb.close();
                        if let Some(path) = pb.finish() {
                            pix.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
                        }
                        t += spacing;
                    }
                }
                BorderStyle::Dashed => {
                    let stroke = Stroke {
                        width, line_cap: LineCap::Butt, line_join: LineJoin::Miter,
                        miter_limit: 4.0,
                        dash: StrokeDash::new(vec![width * 3.0, width], 0.0),
                    };
                    let mut pb = PathBuilder::new();
                    pb.move_to(x1, y1);
                    pb.line_to(x2, y2);
                    if let Some(path) = pb.finish() {
                        pix.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                    }
                }
                BorderStyle::Double => {
                    let line_w = (width / 3.0).max(1.0);
                    let dx = x2 - x1;
                    let dy = y2 - y1;
                    let len = (dx * dx + dy * dy).sqrt();
                    if len <= 0.0 { return; }
                    let nx = -dy / len;
                    let ny = dx / len;
                    let stroke = Stroke {
                        width: line_w, line_cap: LineCap::Butt, line_join: LineJoin::Miter,
                        miter_limit: 4.0, dash: None,
                    };
                    for &off in &[line_w / 2.0, width - line_w / 2.0] {
                        let ox = nx * off;
                        let oy = ny * off;
                        let mut pb = PathBuilder::new();
                        pb.move_to(x1 + ox, y1 + oy);
                        pb.line_to(x2 + ox, y2 + oy);
                        if let Some(path) = pb.finish() {
                            pix.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                        }
                    }
                }
                BorderStyle::Solid => {
                    let stroke = Stroke {
                        width, line_cap: LineCap::Butt, line_join: LineJoin::Miter,
                        miter_limit: 4.0, dash: None,
                    };
                    let mut pb = PathBuilder::new();
                    pb.move_to(x1, y1);
                    pb.line_to(x2, y2);
                    if let Some(path) = pb.finish() {
                        pix.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                    }
                }
            }
        };

        stroke_edge(x + thl, y + tht, x + w - thr, y + tht, bt, ct, st, pixmap);
        stroke_edge(x + w - thr, y + tht, x + w - thr, y + h - thb, br, cr, sr, pixmap);
        stroke_edge(x + thl, y + h - thb, x + w - thr, y + h - thb, bb, cb, sb, pixmap);
        stroke_edge(x + thl, y + tht, x + thl, y + h - thb, bl, cl, sl, pixmap);
    }
}

fn paint_text(text_str: &str, x: f32, y: f32, max_width: f32, cs: &style::ComputedStyle, pixmap: &mut Pixmap) {
    if text_str.is_empty() { return; }

    // Apply text-transform
    let transformed = match cs.text_transform {
        style::TextTransform::Uppercase => text_str.to_uppercase(),
        style::TextTransform::Lowercase => text_str.to_lowercase(),
        style::TextTransform::Capitalize => capitalize_words(text_str),
        style::TextTransform::None => text_str.to_string(),
    };

    let mut draw_state = DrawState::default();
    draw_state.fill_color = cs.color;
    draw_state.font_size = cs.font_size;
    draw_state.font_weight = cs.font_weight;
    if let Some(ref family) = cs.font_family {
        draw_state.font_family = family.clone();
    }
    draw_state.letter_spacing = cs.letter_spacing;
    draw_state.global_alpha = cs.opacity;

    // Apply italic via skew transform
    if cs.font_style == style::FontStyle::Italic {
        draw_state.transform = Transform::from_row(1.0, 0.0, -0.2, 1.0, 0.0, 0.0);
    }

    let bold = cs.font_weight.is_bold();
    let line_h = cs.font_size * cs.line_height;

    // Word-wrap: split text into lines that fit within max_width.
    // white-space controls wrapping and whitespace preservation.
    let lines = match cs.white_space {
        style::WhiteSpace::Pre | style::WhiteSpace::PreWrap => {
            // Preserve whitespace; split on literal newlines only.
            transformed.split('\n').map(|s| s.to_string()).collect::<Vec<_>>()
        }
        style::WhiteSpace::Nowrap => {
            if cs.text_overflow_ellipsis && max_width > 0.0 {
                vec![truncate_with_ellipsis(&transformed, max_width, cs.font_size, bold)]
            } else {
                vec![transformed.clone()]
            }
        }
        _ => wrap_text(&transformed, max_width, cs.font_size, bold),
    };

    // Apply -webkit-line-clamp: truncate to n lines with ellipsis on the last visible line.
    let lines = if let Some(clamp) = cs.line_clamp {
        let clamp = clamp as usize;
        if lines.len() > clamp {
            let mut clamped = lines[..clamp].to_vec();
            // Force "..." on the last visible line (more lines exist but are hidden).
            // If the last line already fills max_width, truncate it to make room for "...".
            let last = clamped.last_mut().unwrap();
            if max_width > 0.0 {
                *last = force_ellipsis(last, max_width, cs.font_size, bold);
            } else {
                last.push_str("...");
            }
            clamped
        } else {
            lines
        }
    } else {
        lines
    };

    // --- Text shadows (painted before main text, last shadow = bottom layer) ---
    if !cs.text_shadows.is_empty() {
        for shadow in cs.text_shadows.iter().rev() {
            paint_text_shadow(&lines, x, y, &draw_state, cs, shadow, pixmap);
        }
    }

    let line_thickness = (cs.font_size / 16.0).max(1.0).round() as i32;

    for (i, line) in lines.iter().enumerate() {
        let text_y = y + cs.font_size + i as f32 * line_h;
        let text_width = text::render_text(pixmap, line, x, text_y, &draw_state, true);

        match cs.text_decoration {
            style::TextDecoration::None => {}
            style::TextDecoration::Underline => {
                let line_y = text_y + cs.font_size * 0.15;
                let color = cs.text_decoration_color.unwrap_or(cs.color);
                draw_decoration_line(pixmap, x, line_y, text_width, line_thickness, color);
            }
            style::TextDecoration::LineThrough => {
                let line_y = text_y - cs.font_size * 0.3;
                let color = cs.text_decoration_color.unwrap_or(cs.color);
                draw_decoration_line(pixmap, x, line_y, text_width, line_thickness, color);
            }
            style::TextDecoration::Overline => {
                let line_y = text_y - cs.font_size * 0.85;
                let color = cs.text_decoration_color.unwrap_or(cs.color);
                draw_decoration_line(pixmap, x, line_y, text_width, line_thickness, color);
            }
        }
    }
}

/// Paint a single text-shadow layer for the given lines.
/// If blur_radius == 0: render directly at (x + offset_x, y + offset_y) in shadow color.
/// If blur_radius > 0: render into a full-pixmap-sized temp buffer, box-blur it, composite.
fn paint_text_shadow(
    lines: &[String],
    x: f32,
    y: f32,
    base_draw_state: &DrawState,
    cs: &style::ComputedStyle,
    shadow: &style::TextShadow,
    pixmap: &mut Pixmap,
) {
    let line_h = cs.font_size * cs.line_height;
    let sx = x + shadow.offset_x;
    let sy = y + shadow.offset_y;

    let mut shadow_state = DrawState::default();
    shadow_state.fill_color = shadow.color;
    shadow_state.font_size = base_draw_state.font_size;
    shadow_state.font_weight = base_draw_state.font_weight;
    shadow_state.font_family = base_draw_state.font_family.clone();
    shadow_state.letter_spacing = base_draw_state.letter_spacing;
    shadow_state.global_alpha = base_draw_state.global_alpha;
    shadow_state.transform = base_draw_state.transform;

    if shadow.blur_radius <= 0.0 {
        // No blur — paint directly at shadow offset position.
        for (i, line) in lines.iter().enumerate() {
            let text_y = sy + cs.font_size + i as f32 * line_h;
            text::render_text(pixmap, line, sx, text_y, &shadow_state, true);
        }
    } else {
        // Blur — render shadow text into a temp pixmap, blur, composite.
        let pw = pixmap.width();
        let ph = pixmap.height();
        let Some(mut tmp) = Pixmap::new(pw, ph) else { return };

        for (i, line) in lines.iter().enumerate() {
            let text_y = sy + cs.font_size + i as f32 * line_h;
            text::render_text(&mut tmp, line, sx, text_y, &shadow_state, true);
        }

        // Compute 3-pass box blur approximating Gaussian for given blur_radius.
        let sigma = shadow.blur_radius;
        let w_ideal = (12.0 * sigma * sigma / 3.0 + 1.0).sqrt();
        let wl_floor = w_ideal.floor() as usize;
        let wl = if wl_floor % 2 == 1 { wl_floor } else { wl_floor.saturating_sub(1) | 1 };
        let wu = wl + 2;
        let m_ideal = (12.0 * sigma * sigma - (3 * wl * wl + 12 * wl + 9) as f32)
            / (4 * (wl + wu)) as f32;
        let m = m_ideal.round().max(0.0) as usize;

        let w = pw as usize;
        let h = ph as usize;
        let data = tmp.data_mut();
        for pass in 0..3usize {
            let box_w = if pass < m { wl } else { wu };
            let r = box_w / 2;
            if r > 0 {
                box_blur_rgba(data, w, h, r);
            }
        }

        // Composite blurred shadow onto main pixmap using SourceOver.
        let paint = PixmapPaint {
            opacity: 1.0,
            blend_mode: BlendMode::SourceOver,
            quality: FilterQuality::Nearest,
        };
        pixmap.draw_pixmap(0, 0, tmp.as_ref(), &paint, Transform::identity(), None);
    }
}

/// Truncate text to fit within `max_width`, appending "..." if truncated.
fn truncate_with_ellipsis(text: &str, max_width: f32, font_size: f32, bold: bool) -> String {
    let full_w = text::measure_text_with(text, font_size, bold);
    if full_w <= max_width + 1.0 {
        return text.to_string();
    }
    let ellipsis_w = text::measure_text_with("...", font_size, bold);
    let target = max_width - ellipsis_w;
    if target <= 0.0 {
        return "...".to_string();
    }
    let mut result = String::new();
    let mut w: f32 = 0.0;
    for ch in text.chars() {
        let cw = text::measure_text_with(&ch.to_string(), font_size, bold);
        if w + cw > target {
            break;
        }
        result.push(ch);
        w += cw;
    }
    result.push_str("...");
    result
}

/// Always append "..." to text, truncating the text if needed to fit within max_width.
/// Unlike truncate_with_ellipsis, this forces the ellipsis even if the text already fits.
fn force_ellipsis(text: &str, max_width: f32, font_size: f32, bold: bool) -> String {
    let ellipsis_w = text::measure_text_with("...", font_size, bold);
    let target = max_width - ellipsis_w;
    if target <= 0.0 {
        return "...".to_string();
    }
    let mut result = String::new();
    let mut w: f32 = 0.0;
    for ch in text.chars() {
        let cw = text::measure_text_with(&ch.to_string(), font_size, bold);
        if w + cw > target {
            break;
        }
        result.push(ch);
        w += cw;
    }
    result.push_str("...");
    result
}

/// Word-wrap text into lines that fit within `max_width`.
fn wrap_text(text: &str, max_width: f32, font_size: f32, bold: bool) -> Vec<String> {
    if max_width <= 0.0 || font_size <= 0.0 {
        return vec![text.to_string()];
    }

    let full_width = text::measure_text_with(text, font_size, bold);
    // 1px tolerance for subpixel rounding between layout and paint
    if full_width <= max_width + 1.0 {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();
    let mut current_line = String::new();
    let mut current_width: f32 = 0.0;
    let space_width = text::measure_text_with(" ", font_size, bold);

    for word in text.split_whitespace() {
        let word_width = text::measure_text_with(word, font_size, bold);

        if current_line.is_empty() {
            // First word on line — if it's wider than max_width, break it character-by-character
            if word_width > max_width {
                let mut char_line = String::new();
                let mut char_w: f32 = 0.0;
                for ch in word.chars() {
                    let ch_str = ch.to_string();
                    let cw = text::measure_text_with(&ch_str, font_size, bold);
                    if char_w + cw > max_width && !char_line.is_empty() {
                        lines.push(char_line);
                        char_line = String::new();
                        char_w = 0.0;
                    }
                    char_line.push(ch);
                    char_w += cw;
                }
                current_line = char_line;
                current_width = char_w;
            } else {
                current_line = word.to_string();
                current_width = word_width;
            }
        } else if current_width + space_width + word_width <= max_width {
            current_line.push(' ');
            current_line.push_str(word);
            current_width += space_width + word_width;
        } else {
            lines.push(current_line);
            // Same overflow check for the new word
            if word_width > max_width {
                let mut char_line = String::new();
                let mut char_w: f32 = 0.0;
                for ch in word.chars() {
                    let ch_str = ch.to_string();
                    let cw = text::measure_text_with(&ch_str, font_size, bold);
                    if char_w + cw > max_width && !char_line.is_empty() {
                        lines.push(char_line);
                        char_line = String::new();
                        char_w = 0.0;
                    }
                    char_line.push(ch);
                    char_w += cw;
                }
                current_line = char_line;
                current_width = char_w;
            } else {
                current_line = word.to_string();
                current_width = word_width;
            }
        }
    }

    if !current_line.is_empty() {
        lines.push(current_line);
    }

    if lines.is_empty() {
        lines.push(text.to_string());
    }

    lines
}

/// Capitalize the first letter of each word.
fn capitalize_words(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut capitalize_next = true;
    for ch in s.chars() {
        if ch.is_whitespace() {
            capitalize_next = true;
            result.push(ch);
        } else if capitalize_next {
            for upper in ch.to_uppercase() {
                result.push(upper);
            }
            capitalize_next = false;
        } else {
            result.push(ch);
        }
    }
    result
}

/// Draw a horizontal decoration line (underline, strikethrough, overline).
fn draw_decoration_line(pixmap: &mut Pixmap, x: f32, y: f32, width: f32, thickness: i32, color: Color) {
    let ix = x.round() as i32;
    let iy = y.round() as i32;
    let iw = width.ceil() as i32;
    let px_w = pixmap.width() as i32;
    let px_h = pixmap.height() as i32;
    let r = (color.red() * 255.0) as u8;
    let g = (color.green() * 255.0) as u8;
    let b = (color.blue() * 255.0) as u8;
    let dst = pixmap.data_mut();
    for row in 0..thickness {
        let dy = iy + row;
        if dy < 0 || dy >= px_h { continue; }
        for col in ix.max(0)..((ix + iw).min(px_w)) {
            let di = (dy as usize * px_w as usize + col as usize) * 4;
            dst[di] = r; dst[di+1] = g; dst[di+2] = b; dst[di+3] = 255;
        }
    }
}

/// Rasterize inline SVG markup and composite at the given position.
fn paint_inline_svg(svg_data: &str, x: f32, y: f32, w: f32, h: f32, pixmap: &mut Pixmap) {
    let tree = match resvg::usvg::Tree::from_str(svg_data, &resvg::usvg::Options::default()) {
        Ok(t) => t,
        Err(e) => {
            log::warn!("Inline SVG parse failed: {}", e);
            return;
        }
    };

    // Cap SVG pixmap to 2048x2048 (16MB) to prevent OOM from multiple large SVGs
    let svg_w = w.max(1.0).min(2048.0) as u32;
    let svg_h = h.max(1.0).min(2048.0) as u32;
    let Some(mut svg_pixmap) = resvg::tiny_skia::Pixmap::new(svg_w, svg_h) else { return };

    // Scale SVG to fit the layout box
    let svg_size = tree.size();
    let sx = w / svg_size.width();
    let sy = h / svg_size.height();
    let scale = resvg::tiny_skia::Transform::from_scale(sx, sy);
    resvg::render(&tree, scale, &mut svg_pixmap.as_mut());

    // Composite SVG pixels onto the main pixmap at (x, y) using alpha blending.
    // resvg uses its own bundled tiny-skia, so we copy raw RGBA bytes.
    let svg_data = svg_pixmap.data();
    let dst_w = pixmap.width() as usize;
    let dst_h = pixmap.height() as usize;
    let dst = pixmap.data_mut();
    let ox = x.max(0.0) as usize;
    let oy = y.max(0.0) as usize;

    for row in 0..svg_h as usize {
        let dy = oy + row;
        if dy >= dst_h { break; }
        for col in 0..svg_w as usize {
            let dx = ox + col;
            if dx >= dst_w { break; }
            let si = (row * svg_w as usize + col) * 4;
            let di = (dy * dst_w + dx) * 4;
            let sa = svg_data[si + 3] as u16;
            if sa == 0 { continue; }
            if sa == 255 {
                dst[di]   = svg_data[si];
                dst[di+1] = svg_data[si+1];
                dst[di+2] = svg_data[si+2];
                dst[di+3] = 255;
            } else {
                let inv = 255 - sa;
                dst[di]   = ((svg_data[si]   as u16) + (dst[di]   as u16) * inv / 255).min(255) as u8;
                dst[di+1] = ((svg_data[si+1] as u16) + (dst[di+1] as u16) * inv / 255).min(255) as u8;
                dst[di+2] = ((svg_data[si+2] as u16) + (dst[di+2] as u16) * inv / 255).min(255) as u8;
                dst[di+3] = (sa + (dst[di+3] as u16) * inv / 255).min(255) as u8;
            }
        }
    }
}

/// Paint decoded RGBA image data, scaled to fit the layout bounds.
fn paint_image(
    rgba: &[u8], src_w: u32, src_h: u32,
    x: f32, y: f32, w: f32, h: f32,
    pixmap: &mut Pixmap,
) {
    if src_w == 0 || src_h == 0 || w <= 0.0 || h <= 0.0 { return; }
    let dst_w_px = w.ceil().max(1.0).min(8192.0) as u32;
    let dst_h_px = h.ceil().max(1.0).min(8192.0) as u32;

    // Scale image to fit layout bounds using nearest-neighbor for speed
    let px_w = pixmap.width() as usize;
    let px_h = pixmap.height() as usize;
    let dst = pixmap.data_mut();
    let ox = x.max(0.0) as usize;
    let oy = y.max(0.0) as usize;

    for row in 0..dst_h_px as usize {
        let dy = oy + row;
        if dy >= px_h { break; }
        let src_row = ((row as f32 / dst_h_px as f32) * src_h as f32) as usize;
        let src_row = src_row.min(src_h as usize - 1);
        for col in 0..dst_w_px as usize {
            let dx = ox + col;
            if dx >= px_w { break; }
            let src_col = ((col as f32 / dst_w_px as f32) * src_w as f32) as usize;
            let src_col = src_col.min(src_w as usize - 1);
            let si = (src_row * src_w as usize + src_col) * 4;
            if si + 3 >= rgba.len() { continue; }
            let sa = rgba[si + 3] as u16;
            if sa == 0 { continue; }
            let di = (dy * px_w + dx) * 4;
            if sa == 255 {
                // Premultiply for tiny-skia's premultiplied alpha format
                dst[di]   = rgba[si];
                dst[di+1] = rgba[si+1];
                dst[di+2] = rgba[si+2];
                dst[di+3] = 255;
            } else {
                // Alpha composite (src is straight RGBA, dst is premultiplied)
                let sr = (rgba[si]   as u16 * sa / 255) as u16;
                let sg = (rgba[si+1] as u16 * sa / 255) as u16;
                let sb = (rgba[si+2] as u16 * sa / 255) as u16;
                let inv = 255 - sa;
                dst[di]   = (sr + (dst[di]   as u16) * inv / 255).min(255) as u8;
                dst[di+1] = (sg + (dst[di+1] as u16) * inv / 255).min(255) as u8;
                dst[di+2] = (sb + (dst[di+2] as u16) * inv / 255).min(255) as u8;
                dst[di+3] = (sa + (dst[di+3] as u16) * inv / 255).min(255) as u8;
            }
        }
    }
}

/// Paint a box shadow behind an element.
fn paint_box_shadow(
    x: f32, y: f32, w: f32, h: f32,
    shadow: &style::BoxShadow, radii: [(f32, f32); 4],
    pixmap: &mut Pixmap,
) {
    let sx = x + shadow.offset_x - shadow.spread;
    let sy = y + shadow.offset_y - shadow.spread;
    let sw = w + shadow.spread * 2.0;
    let sh = h + shadow.spread * 2.0;

    if sw <= 0.0 || sh <= 0.0 { return; }

    if shadow.blur <= 0.0 {
        // No blur — just paint a solid rect at offset
        paint_rect(sx, sy, sw, sh, shadow.color, radii, 1.0, pixmap);
        return;
    }

    // Paint shadow rect into a temp pixmap, then blur and composite
    let pad = (shadow.blur * 2.0).ceil().min(1024.0) as u32 + 2;
    let base_w = (sw.ceil().max(0.0).min(4096.0)) as u32;
    let base_h = (sh.ceil().max(0.0).min(4096.0)) as u32;
    let tmp_w = base_w.saturating_add(pad.saturating_mul(2));
    let tmp_h = base_h.saturating_add(pad.saturating_mul(2));
    if tmp_w == 0 || tmp_h == 0 || tmp_w > 4096 || tmp_h > 4096 { return; }

    let Some(mut tmp) = Pixmap::new(tmp_w, tmp_h) else { return };
    paint_rect(pad as f32, pad as f32, sw, sh, shadow.color, radii, 1.0, &mut tmp);

    // 3-pass box blur (approximates Gaussian)
    let radius = (shadow.blur / 2.0).ceil() as usize;
    if radius > 0 {
        box_blur_rgba(tmp.data_mut(), tmp_w as usize, tmp_h as usize, radius);
        box_blur_rgba(tmp.data_mut(), tmp_w as usize, tmp_h as usize, radius);
        box_blur_rgba(tmp.data_mut(), tmp_w as usize, tmp_h as usize, radius);
    }

    // Composite blurred shadow onto main pixmap
    let dst_x = (sx - pad as f32).round() as i32;
    let dst_y = (sy - pad as f32).round() as i32;
    let pp = PixmapPaint {
        opacity: 1.0,
        blend_mode: BlendMode::SourceOver,
        quality: FilterQuality::Nearest,
    };
    pixmap.draw_pixmap(dst_x, dst_y, tmp.as_ref(), &pp, Transform::identity(), None);
}

/// Apply backdrop-filter blur to the region behind an element.
///
/// We extract a padded region (element bounds + blur radius on each side) so that
/// the blur can sample real backdrop pixels instead of clamped edges.  After
/// blurring, only the inner (element-sized) portion is written back.
fn apply_backdrop_blur(x: f32, y: f32, w: f32, h: f32, blur_radius: f32, pixmap: &mut Pixmap) {
    let pw = pixmap.width() as usize;
    let ph = pixmap.height() as usize;

    // Element rectangle in pixel coords (clamped to pixmap)
    let ex = x.max(0.0) as usize;
    let ey = y.max(0.0) as usize;
    let ew = (w as usize).min(pw.saturating_sub(ex)).min(MAX_BACKDROP_BLUR_DIM);
    let eh = (h as usize).min(ph.saturating_sub(ey)).min(MAX_BACKDROP_BLUR_DIM);
    if ew == 0 || eh == 0 { return; }

    // Pad extraction region by blur radius so edge pixels blur correctly.
    let pad = (blur_radius * 1.5).ceil() as usize; // 1.5× radius is enough for 3-pass box
    let rx = ex.saturating_sub(pad);
    let ry = ey.saturating_sub(pad);
    let rw = (ex + ew + pad).min(pw) - rx;
    let rh = (ey + eh + pad).min(ph) - ry;

    // Extract the padded region into a temp buffer
    let mut region = vec![0u8; rw * rh * 4];
    let data = pixmap.data();
    for row in 0..rh {
        let src_off = ((ry + row) * pw + rx) * 4;
        let dst_off = row * rw * 4;
        region[dst_off..dst_off + rw * 4].copy_from_slice(&data[src_off..src_off + rw * 4]);
    }

    // 3-pass box blur approximating Gaussian with sigma = blur_radius (CSS spec).
    // Ideal box width for n=3 passes: w = sqrt(12 * sigma^2 / 3 + 1)
    // We compute per-pass radii using the standard algorithm (W3C / SVG spec):
    let sigma = blur_radius;
    let w_ideal = (12.0 * sigma * sigma / 3.0 + 1.0).sqrt();
    let wl_floor = w_ideal.floor() as usize;
    let wl = if wl_floor % 2 == 1 { wl_floor } else { wl_floor.saturating_sub(1) | 1 }; // largest odd integer <= w_ideal
    let wu = wl + 2; // next odd integer
    // Number of passes that should use wl (the rest use wu):
    let m_ideal = (12.0 * sigma * sigma
        - (3 * wl * wl + 12 * wl + 9) as f32) as f32
        / (4 * (wl + wu)) as f32;
    let m = m_ideal.round().max(0.0) as usize;
    for pass in 0..3u32 {
        let box_w = if (pass as usize) < m { wl } else { wu };
        let r = box_w / 2;
        if r > 0 {
            box_blur_rgba(&mut region, rw, rh, r);
        }
    }

    // Write back only the inner element-sized portion
    let inner_x = ex - rx; // offset of element within padded region
    let inner_y = ey - ry;
    let data = pixmap.data_mut();
    for row in 0..eh {
        let dst_off = ((ey + row) * pw + ex) * 4;
        let src_off = ((inner_y + row) * rw + inner_x) * 4;
        data[dst_off..dst_off + ew * 4].copy_from_slice(&region[src_off..src_off + ew * 4]);
    }
}

/// Single-pass horizontal+vertical box blur on RGBA data.
fn box_blur_rgba(data: &mut [u8], w: usize, h: usize, radius: usize) {
    if radius == 0 || w == 0 || h == 0 { return; }
    let mut tmp = vec![0u8; data.len()];
    let r = radius as i64;
    let kernel = (2 * radius + 1) as i64;

    // Horizontal pass (data → tmp)
    for row in 0..h {
        let off = row * w * 4;
        for ch in 0..4usize {
            // Initialize sum for col=0: window is [-r, r] clamped to [0, w-1]
            let mut sum = 0i64;
            for i in 0..=r.min(w as i64 - 1) {
                sum += data[off + i as usize * 4 + ch] as i64;
            }
            // Edge pixels are repeated (clamp mode)
            for i in 1..=r {
                sum += data[off + ch] as i64; // clamp left edge
            }

            for col in 0..w {
                tmp[off + col * 4 + ch] = (sum / kernel) as u8;
                // Slide window: remove left, add right
                let old_left = (col as i64 - r).max(0) as usize;
                let new_right = (col as i64 + r + 1).min(w as i64 - 1) as usize;
                sum -= data[off + old_left * 4 + ch] as i64;
                sum += data[off + new_right * 4 + ch] as i64;
            }
        }
    }

    // Vertical pass (tmp → data)
    for col in 0..w {
        for ch in 0..4usize {
            let mut sum = 0i64;
            for i in 0..=r.min(h as i64 - 1) {
                sum += tmp[i as usize * w * 4 + col * 4 + ch] as i64;
            }
            for i in 1..=r {
                sum += tmp[col * 4 + ch] as i64; // clamp top edge
            }
            for row in 0..h {
                data[row * w * 4 + col * 4 + ch] = (sum / kernel) as u8;
                let old_top = (row as i64 - r).max(0) as usize;
                let new_bottom = (row as i64 + r + 1).min(h as i64 - 1) as usize;
                sum -= tmp[old_top * w * 4 + col * 4 + ch] as i64;
                sum += tmp[new_bottom * w * 4 + col * 4 + ch] as i64;
            }
        }
    }
}

/// Build a rounded rectangle path.
fn rounded_rect_path(x: f32, y: f32, w: f32, h: f32, radii: [(f32, f32); 4]) -> Option<Path> {
    // Per-corner radii: [TL, TR, BR, BL], each is (rx, ry)
    let tl = (radii[0].0.min(w / 2.0), radii[0].1.min(h / 2.0));
    let tr = (radii[1].0.min(w / 2.0), radii[1].1.min(h / 2.0));
    let br = (radii[2].0.min(w / 2.0), radii[2].1.min(h / 2.0));
    let bl = (radii[3].0.min(w / 2.0), radii[3].1.min(h / 2.0));

    let k = 0.5523; // cubic Bezier approximation for quarter-ellipse
    let mut pb = PathBuilder::new();

    // Start at top-left + TL radius
    pb.move_to(x + tl.0, y);

    // Top edge → top-right corner
    pb.line_to(x + w - tr.0, y);
    if tr.0 > 0.0 || tr.1 > 0.0 {
        pb.cubic_to(x + w - tr.0 + tr.0 * k, y, x + w, y + tr.1 - tr.1 * k, x + w, y + tr.1);
    }

    // Right edge → bottom-right corner
    pb.line_to(x + w, y + h - br.1);
    if br.0 > 0.0 || br.1 > 0.0 {
        pb.cubic_to(x + w, y + h - br.1 + br.1 * k, x + w - br.0 + br.0 * k, y + h, x + w - br.0, y + h);
    }

    // Bottom edge → bottom-left corner
    pb.line_to(x + bl.0, y + h);
    if bl.0 > 0.0 || bl.1 > 0.0 {
        pb.cubic_to(x + bl.0 - bl.0 * k, y + h, x, y + h - bl.1 + bl.1 * k, x, y + h - bl.1);
    }

    // Left edge → top-left corner
    pb.line_to(x, y + tl.1);
    if tl.0 > 0.0 || tl.1 > 0.0 {
        pb.cubic_to(x, y + tl.1 - tl.1 * k, x + tl.0 - tl.0 * k, y, x + tl.0, y);
    }

    pb.close();
    pb.finish()
}


// ---------------------------------------------------------------------------
// CSS filter support
// ---------------------------------------------------------------------------

/// Paint a node that has CSS `filter` applied.
/// Paints the node (and children) into a full-size temp pixmap, applies filters
/// to that temp pixmap, then composites the result onto the main pixmap.
///
/// Note: paint_node_inner does NOT check style.filters, so calling it here
/// on the original node is safe and avoids cloning LayoutNode (which does not impl Clone).
fn paint_node_filtered(node: &LayoutNode, pixmap: &mut Pixmap, depth: u32, overflow_count: u32) {
    let pw = pixmap.width();
    let ph = pixmap.height();
    let Some(mut tmp) = Pixmap::new(pw, ph) else {
        // Fallback: paint without filter
        paint_node_inner(node, pixmap, depth, overflow_count);
        return;
    };

    // paint_node_inner does not check style.filters — it is safe to call directly.
    // This avoids creating a modified LayoutNode copy (LayoutNode does not impl Clone).
    paint_node_inner(node, &mut tmp, depth, overflow_count);

    // Apply CSS filters in order to the temp pixmap data
    for filter in &node.style.filters {
        apply_css_filter(filter, &mut tmp);
    }

    // Composite the filtered temp pixmap onto the main pixmap
    let paint = PixmapPaint {
        opacity: node.style.opacity.value(),
        blend_mode: BlendMode::SourceOver,
        quality: FilterQuality::Nearest,
    };
    pixmap.draw_pixmap(0, 0, tmp.as_ref(), &paint, Transform::identity(), None);
}

/// Apply a single CSS filter to a pixmap in-place.
fn apply_css_filter(filter: &style::CssFilter, pixmap: &mut Pixmap) {
    match filter {
        style::CssFilter::Blur(sigma) => {
            if *sigma > 0.0 {
                apply_filter_blur(*sigma, pixmap);
            }
        }
        style::CssFilter::Grayscale(amount) => {
            apply_filter_grayscale(*amount, pixmap.data_mut());
        }
        style::CssFilter::Brightness(factor) => {
            apply_filter_brightness(*factor, pixmap.data_mut());
        }
        style::CssFilter::Contrast(factor) => {
            apply_filter_contrast(*factor, pixmap.data_mut());
        }
        style::CssFilter::DropShadow { offset_x, offset_y, blur, color } => {
            apply_filter_drop_shadow(*offset_x, *offset_y, *blur, *color, pixmap);
        }
    }
}

/// Apply Gaussian blur (via 3-pass box blur) to the entire pixmap.
fn apply_filter_blur(sigma: f32, pixmap: &mut Pixmap) {
    let w = pixmap.width() as usize;
    let h = pixmap.height() as usize;
    if w == 0 || h == 0 || sigma <= 0.0 { return; }

    // Use same 3-pass box blur approximation as backdrop-filter
    let w_ideal = (12.0_f32 * sigma * sigma / 3.0 + 1.0).sqrt();
    let wl_floor = w_ideal.floor() as usize;
    let wl = if wl_floor % 2 == 1 { wl_floor } else { wl_floor.saturating_sub(1) | 1 };
    let wu = wl + 2;
    let m_ideal = (12.0 * sigma * sigma - (3 * wl * wl + 12 * wl + 9) as f32)
        / (4 * (wl + wu)) as f32;
    let m = m_ideal.round().max(0.0) as usize;

    let data = pixmap.data_mut();
    for pass in 0..3usize {
        let box_w = if pass < m { wl } else { wu };
        let r = box_w / 2;
        if r > 0 {
            box_blur_rgba(data, w, h, r);
        }
    }
}

/// Apply grayscale filter to premultiplied RGBA data.
/// `amount` is 0.0 (no effect) to 1.0 (fully grayscale).
fn apply_filter_grayscale(amount: f32, data: &mut [u8]) {
    if amount <= 0.0 { return; }
    for px in data.chunks_exact_mut(4) {
        let r = px[0] as f32;
        let g = px[1] as f32;
        let b = px[2] as f32;
        let a = px[3] as f32;
        // Convert premultiplied to straight for luminance calculation
        let (sr, sg, sb) = if a > 0.0 {
            (r / a * 255.0, g / a * 255.0, b / a * 255.0)
        } else {
            (r, g, b)
        };
        // Luminance weights: CSS filter spec uses BT.709 linear coefficients (matches Chrome).
        let lum = 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
        let nr = sr + (lum - sr) * amount;
        let ng = sg + (lum - sg) * amount;
        let nb = sb + (lum - sb) * amount;
        // Convert back to premultiplied
        let af = a / 255.0;
        px[0] = (nr * af).round().clamp(0.0, 255.0) as u8;
        px[1] = (ng * af).round().clamp(0.0, 255.0) as u8;
        px[2] = (nb * af).round().clamp(0.0, 255.0) as u8;
        // alpha unchanged
    }
}

/// Apply brightness filter to premultiplied RGBA data.
/// `factor` > 1.0 = brighter, < 1.0 = darker, 0.0 = black.
fn apply_filter_brightness(factor: f32, data: &mut [u8]) {
    if (factor - 1.0).abs() < 1e-6 { return; }
    for px in data.chunks_exact_mut(4) {
        // In premultiplied RGBA, scaling R/G/B also scales brightness proportionally
        px[0] = (px[0] as f32 * factor).round().clamp(0.0, 255.0) as u8;
        px[1] = (px[1] as f32 * factor).round().clamp(0.0, 255.0) as u8;
        px[2] = (px[2] as f32 * factor).round().clamp(0.0, 255.0) as u8;
        // alpha unchanged
    }
}

/// Apply contrast filter to premultiplied RGBA data.
/// `factor` 1.0 = no change, > 1 = more contrast, 0.0 = gray.
fn apply_filter_contrast(factor: f32, data: &mut [u8]) {
    if (factor - 1.0).abs() < 1e-6 { return; }
    // For premultiplied data: un-premultiply, apply contrast, re-premultiply
    for px in data.chunks_exact_mut(4) {
        let a = px[3] as f32;
        if a == 0.0 { continue; }
        let inv_a = 255.0 / a;
        let sr = px[0] as f32 * inv_a;
        let sg = px[1] as f32 * inv_a;
        let sb = px[2] as f32 * inv_a;
        // CSS contrast: f * (c - 0.5) + 0.5, where c is 0–1
        let cr = ((sr - 127.5) * factor + 127.5).clamp(0.0, 255.0);
        let cg = ((sg - 127.5) * factor + 127.5).clamp(0.0, 255.0);
        let cb = ((sb - 127.5) * factor + 127.5).clamp(0.0, 255.0);
        let af = a / 255.0;
        px[0] = (cr * af).round().clamp(0.0, 255.0) as u8;
        px[1] = (cg * af).round().clamp(0.0, 255.0) as u8;
        px[2] = (cb * af).round().clamp(0.0, 255.0) as u8;
    }
}

/// Apply drop-shadow filter.
/// Creates a blurred shadow copy of the element (based on alpha) offset by (dx, dy),
/// composites the shadow behind the original content.
fn apply_filter_drop_shadow(dx: f32, dy: f32, blur: f32, color: Color, pixmap: &mut Pixmap) {
    let pw = pixmap.width() as usize;
    let ph = pixmap.height() as usize;
    if pw == 0 || ph == 0 { return; }

    let data = pixmap.data();

    // Build shadow by taking alpha of source, fill with shadow color
    let mut shadow = vec![0u8; data.len()];
    let sr = (color.red() * 255.0) as u8;
    let sg = (color.green() * 255.0) as u8;
    let sb = (color.blue() * 255.0) as u8;
    let sa = color.alpha();

    for i in 0..pw * ph {
        let src_a = data[i * 4 + 3] as f32 / 255.0;
        let final_a = src_a * sa;
        let final_a_u8 = (final_a * 255.0).round() as u8;
        // Premultiplied
        shadow[i * 4]     = (sr as f32 * final_a).round().clamp(0.0, 255.0) as u8;
        shadow[i * 4 + 1] = (sg as f32 * final_a).round().clamp(0.0, 255.0) as u8;
        shadow[i * 4 + 2] = (sb as f32 * final_a).round().clamp(0.0, 255.0) as u8;
        shadow[i * 4 + 3] = final_a_u8;
    }

    // Blur the shadow
    let radius = (blur / 2.0).ceil() as usize;
    if radius > 0 {
        box_blur_rgba(&mut shadow, pw, ph, radius);
        box_blur_rgba(&mut shadow, pw, ph, radius);
        box_blur_rgba(&mut shadow, pw, ph, radius);
    }

    // Shift shadow by (dx, dy)
    let idx = dx.round() as i32;
    let idy = dy.round() as i32;
    let mut shifted = vec![0u8; shadow.len()];
    for sy in 0..ph {
        let dy_i = sy as i32 + idy;
        if dy_i < 0 || dy_i >= ph as i32 { continue; }
        for sx in 0..pw {
            let dx_i = sx as i32 + idx;
            if dx_i < 0 || dx_i >= pw as i32 { continue; }
            let src_off = (sy * pw + sx) * 4;
            let dst_off = (dy_i as usize * pw + dx_i as usize) * 4;
            shifted[dst_off]     = shadow[src_off];
            shifted[dst_off + 1] = shadow[src_off + 1];
            shifted[dst_off + 2] = shadow[src_off + 2];
            shifted[dst_off + 3] = shadow[src_off + 3];
        }
    }

    // Composite: shadow goes *behind* the original content.
    // Result = shadow + original over transparent (original already on top).
    // For each pixel: blend shadow under original.
    let orig = pixmap.data().to_vec();
    let result = pixmap.data_mut();
    for i in 0..pw * ph {
        let o = i * 4;
        let oa = orig[o + 3] as u16;
        let sa = shifted[o + 3] as u16;
        if sa == 0 && oa == 0 { continue; }
        if oa == 255 {
            // Original is fully opaque — shadow is hidden behind it
            result[o]     = orig[o];
            result[o + 1] = orig[o + 1];
            result[o + 2] = orig[o + 2];
            result[o + 3] = orig[o + 3];
        } else {
            // Alpha-composite original over shadow (both premultiplied)
            let inv_oa = 255 - oa;
            result[o]     = (orig[o]     as u16 + shifted[o]     as u16 * inv_oa / 255).min(255) as u8;
            result[o + 1] = (orig[o + 1] as u16 + shifted[o + 1] as u16 * inv_oa / 255).min(255) as u8;
            result[o + 2] = (orig[o + 2] as u16 + shifted[o + 2] as u16 * inv_oa / 255).min(255) as u8;
            result[o + 3] = (oa + sa * inv_oa / 255).min(255) as u8;
        }
    }
}
