//! Layout computation: maps ComputedStyle → taffy Style, builds layout tree.

use std::path::Path;
use markup5ever_rcdom::NodeData;
use taffy::prelude::TaffyGridLine;
use super::style::*;
use super::dom;

/// A laid-out element with resolved position, size, style, and children.
#[derive(Debug, Clone)]
pub struct LayoutNode {
    pub bounds: Rect,
    pub style: ComputedStyle,
    pub text: Option<String>,
    pub tag: Option<String>,
    /// Raw SVG markup for inline <svg> elements (serialized for resvg).
    pub svg_data: Option<String>,
    /// Decoded RGBA image data for <img> elements.
    pub image_data: Option<Vec<u8>>,
    /// Natural (intrinsic) dimensions of the image.
    pub image_natural_size: Option<(u32, u32)>,
    pub children: Vec<LayoutNode>,
}

/// Compute layout for the styled tree using taffy.
pub fn compute_layout(styled: &StyledNode, viewport_w: f32, viewport_h: f32) -> LayoutNode {
    compute_layout_with_dir(styled, viewport_w, viewport_h, None)
}

/// Compute layout with optional content directory for resolving image paths.
pub fn compute_layout_with_dir(styled: &StyledNode, viewport_w: f32, viewport_h: f32, content_dir: Option<&Path>) -> LayoutNode {
    let mut tree = taffy::TaffyTree::<()>::new();

    // Build taffy tree recursively — pick up root font-size for rem resolution
    let root_fs = styled.style.font_size;
    let vp = Viewport { w: viewport_w, h: viewport_h, root_font_size: root_fs };
    let root_id = build_taffy_node(&mut tree, styled, viewport_w, vp, 0, content_dir);

    // Force root to fill viewport (body/html always fills the viewport in browsers)
    if let Ok(mut root_style) = tree.style(root_id).cloned() {
        if root_style.size.width == taffy::Dimension::auto() {
            root_style.size.width = taffy::Dimension::length(viewport_w);
        }
        if root_style.size.height == taffy::Dimension::auto() {
            root_style.min_size.height = taffy::Dimension::length(viewport_h);
        }
        let _ = tree.set_style(root_id, root_style);
    }

    let available = taffy::Size {
        width: taffy::AvailableSpace::Definite(viewport_w),
        height: taffy::AvailableSpace::Definite(viewport_h),
    };

    // First layout pass — gets approximate widths
    if let Err(e) = tree.compute_layout(root_id, available) {
        log::warn!("Layout computation failed: {:?}", e);
    }

    // Second pass: fix text node heights based on actual laid-out widths (for wrapping)
    let changed = fix_text_heights(&mut tree, root_id, styled);
    if changed {
        // Re-compute layout with corrected text heights
        if let Err(e) = tree.compute_layout(root_id, available) {
            log::warn!("Layout recomputation failed: {:?}", e);
        }
    }

    // Extract layout results into our tree
    extract_layout(&tree, root_id, styled, 0.0, 0.0, content_dir)
}

/// Maximum recursion depth for taffy tree building (matches MAX_DOM_DEPTH in style.rs).
const MAX_TAFFY_DEPTH: usize = 256;

fn build_taffy_node(tree: &mut taffy::TaffyTree<()>, styled: &StyledNode, parent_width: f32, vp: Viewport, depth: usize, content_dir: Option<&Path>) -> taffy::NodeId {
    if depth > MAX_TAFFY_DEPTH {
        // Prevent stack overflow from deeply nested DOM — return an empty leaf
        return tree.new_leaf(taffy::Style::default()).unwrap_or_else(|_| tree.new_leaf(taffy::Style::default()).unwrap());
    }

    let taffy_style = to_taffy_style(&styled.style, parent_width, vp);

    // Check if this is an <img> element — use intrinsic image dimensions for sizing
    let img_size = get_img_natural_size(styled, content_dir);

    if styled.children.is_empty() {
        // Leaf node — might be text or an <img>
        if let Some(ref text) = styled.text {
            let font_size = styled.style.font_size;
            let line_h = font_size * styled.style.line_height;
            let bold = styled.style.font_weight.is_bold();
            // Apply text-transform before measuring (paint applies it too)
            let display_text = match styled.style.text_transform {
                super::style::TextTransform::Uppercase => text.to_uppercase(),
                super::style::TextTransform::Lowercase => text.to_lowercase(),
                super::style::TextTransform::Capitalize => {
                    // Capitalize first letter of each word — affects width slightly
                    let mut result = String::with_capacity(text.len());
                    let mut cap_next = true;
                    for ch in text.chars() {
                        if ch.is_whitespace() { cap_next = true; result.push(ch); }
                        else if cap_next { for u in ch.to_uppercase() { result.push(u); } cap_next = false; }
                        else { result.push(ch); }
                    }
                    result
                }
                super::style::TextTransform::None => text.clone(),
            };
            let mut style = taffy_style;
            // white-space: pre/pre-wrap preserves whitespace and splits on \n
            if matches!(
                styled.style.white_space,
                super::style::WhiteSpace::Pre | super::style::WhiteSpace::PreWrap
            ) {
                let pre_lines: Vec<&str> = display_text.split('\n').collect();
                let max_line_w = pre_lines
                    .iter()
                    .map(|l| crate::canvas2d::text::measure_text_with(l, font_size, bold))
                    .fold(0.0_f32, f32::max);
                if matches!(styled.style.width, Dimension::Auto) {
                    style.size.width = taffy::Dimension::length(max_line_w.max(1.0));
                }
                if matches!(styled.style.height, Dimension::Auto) {
                    style.size.height = taffy::Dimension::length(line_h * pre_lines.len() as f32);
                }
            } else {
                let full_width = crate::canvas2d::text::measure_text_with(&display_text, font_size, bold);
                if matches!(styled.style.width, Dimension::Auto) {
                    // Don't set a fixed width — let the text node inherit its parent's
                    // content width. The two-pass layout will fix the height for wrapping.
                    // Only set width if the text is short enough that it shouldn't fill the parent.
                    if full_width < parent_width * 0.95 || parent_width <= 0.0 {
                        style.size.width = taffy::Dimension::length(full_width);
                    }
                    // else: leave as auto → inherits parent width, paint wraps within it
                }
                if matches!(styled.style.height, Dimension::Auto) {
                    style.size.height = taffy::Dimension::length(line_h);
                }
            }

            return tree.new_leaf(style).unwrap_or_else(|_| tree.new_leaf(taffy::Style::default()).unwrap());
        }

        // For <img>, use HTML width/height attributes or intrinsic size as default dimensions
        if is_img_element(styled) {
            let mut style = taffy_style;
            let attr_w = get_attr(&styled.node, "width").and_then(|v| v.parse::<f32>().ok());
            let attr_h = get_attr(&styled.node, "height").and_then(|v| v.parse::<f32>().ok());
            if matches!(styled.style.width, Dimension::Auto) {
                if let Some(aw) = attr_w {
                    style.size.width = taffy::Dimension::length(aw);
                } else if let Some((iw, _)) = img_size {
                    style.size.width = taffy::Dimension::length(iw as f32);
                }
            }
            if matches!(styled.style.height, Dimension::Auto) {
                if let Some(ah) = attr_h {
                    style.size.height = taffy::Dimension::length(ah);
                } else if let Some((_, ih)) = img_size {
                    style.size.height = taffy::Dimension::length(ih as f32);
                }
            }
            return tree.new_leaf(style).unwrap_or_else(|_| tree.new_leaf(taffy::Style::default()).unwrap());
        }

        tree.new_leaf(taffy_style).unwrap_or_else(|_| tree.new_leaf(taffy::Style::default()).unwrap())
    } else {
        let child_ids: Vec<taffy::NodeId> = styled.children.iter()
            .map(|child| build_taffy_node(tree, child, parent_width, vp, depth + 1, content_dir))
            .collect();
        // If this is a Block parent with inline-block or inline children,
        // switch to flex-row so children flow horizontally (inline formatting context).
        let mut style = taffy_style;
        if styled.style.display == Display::Block {
            let has_inline_children = styled.children.iter().any(|c|
                c.style.display == Display::InlineBlock || c.style.display == Display::Inline
            );
            if has_inline_children {
                style.display = taffy::Display::Flex;
                style.flex_direction = taffy::FlexDirection::Row;
                style.flex_wrap = taffy::FlexWrap::Wrap;
                // Map vertical-align of inline children to flex align-items.
                // Baseline → flex-end (bottom of line box ≈ text baseline).
                // Middle → center, Top → flex-start, Bottom → flex-end.
                let child_va = styled
                    .children
                    .iter()
                    .filter(|c| {
                        c.style.display == Display::InlineBlock
                            || c.style.display == Display::Inline
                    })
                    .map(|c| c.style.vertical_align)
                    .fold(
                        super::style::VerticalAlign::Baseline,
                        |acc, va| {
                            if acc == super::style::VerticalAlign::Baseline {
                                va
                            } else {
                                acc
                            }
                        },
                    );
                style.align_items = Some(match child_va {
                    super::style::VerticalAlign::Middle => taffy::AlignItems::Center,
                    super::style::VerticalAlign::Top => taffy::AlignItems::FlexStart,
                    super::style::VerticalAlign::Bottom => taffy::AlignItems::FlexEnd,
                    super::style::VerticalAlign::Baseline => taffy::AlignItems::FlexEnd,
                });
                // Apply line-height as min-height for the inline formatting context.
                // CSS: line-height on a block creates a minimum line box height.
                let lh_multiplier = styled.style.line_height;
                let fs = styled.style.font_size;
                let lh_px = lh_multiplier * fs;
                // Only apply line-height as explicit height if it's meaningfully large
                // (more than 2x font size — i.e., an explicit px line-height, not just 1.2 default)
                if lh_px > fs * 2.0 {
                    if style.size.height == taffy::Dimension::auto() {
                        style.size.height = taffy::Dimension::length(lh_px);
                    }
                    // Use align-content: center to vertically center the flex row within the line box.
                    // This mimics CSS line-height centering: the line box (height=lh_px) contains
                    // the flex row (height = tallest item), centered via align-content.
                    style.align_content = Some(taffy::AlignContent::Center);
                }
            }
        }
        tree.new_with_children(style, &child_ids)
            .unwrap_or_else(|_| tree.new_leaf(taffy::Style::default()).unwrap())
    }
}

/// After the first layout pass, walk the taffy tree + styled tree in parallel.
/// For text nodes whose laid-out width is narrower than their text, compute the
/// correct wrapped height and update the taffy node's style so the second layout
/// pass allocates the right space.
fn fix_text_heights(tree: &mut taffy::TaffyTree<()>, node_id: taffy::NodeId, styled: &StyledNode) -> bool {
    fix_text_heights_inner(tree, node_id, styled, 0)
}

fn fix_text_heights_inner(tree: &mut taffy::TaffyTree<()>, node_id: taffy::NodeId, styled: &StyledNode, depth: usize) -> bool {
    if depth > MAX_TAFFY_DEPTH { return false; }
    let mut changed = false;

    if let Some(ref text) = styled.text {
        let font_size = styled.style.font_size;
        if font_size > 0.0 {
            let layout = tree.layout(node_id).ok().cloned();
            if let Some(layout) = layout {
                let laid_out_w = layout.size.width;
                if laid_out_w > 0.0 {
                    let bold = styled.style.font_weight.is_bold();
                    let display_text = match styled.style.text_transform {
                        super::style::TextTransform::Uppercase => text.to_uppercase(),
                        super::style::TextTransform::Lowercase => text.to_lowercase(),
                        super::style::TextTransform::Capitalize => {
                            let mut r = String::with_capacity(text.len());
                            let mut cn = true;
                            for ch in text.chars() {
                                if ch.is_whitespace() { cn = true; r.push(ch); }
                                else if cn { for u in ch.to_uppercase() { r.push(u); } cn = false; }
                                else { r.push(ch); }
                            }
                            r
                        }
                        super::style::TextTransform::None => text.clone(),
                    };
                    let full_w = crate::canvas2d::text::measure_text_with(&display_text, font_size, bold);
                    // 1px tolerance for subpixel rounding
                    if full_w > laid_out_w + 1.0 {
                        let line_h = font_size * styled.style.line_height;
                        let num_lines = (full_w / laid_out_w).ceil();
                        let wrapped_h = num_lines * line_h;
                        if wrapped_h > layout.size.height + 0.5 {
                            if let Ok(mut style) = tree.style(node_id).cloned() {
                                style.size.height = taffy::Dimension::length(wrapped_h);
                                let _ = tree.set_style(node_id, style);
                                changed = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // Recurse into children
    let child_ids = tree.children(node_id).unwrap_or_default();
    for (i, &child_id) in child_ids.iter().enumerate() {
        if let Some(child_styled) = styled.children.get(i) {
            if fix_text_heights_inner(tree, child_id, child_styled, depth + 1) {
                changed = true;
            }
        }
    }

    changed
}

/// Check if a styled node is an <img> element.
fn is_img_element(styled: &StyledNode) -> bool {
    matches!(&styled.node.data, NodeData::Element { ref name, .. } if name.local.as_ref() == "img")
}

/// Get the natural (intrinsic) dimensions of an <img> element by trying to decode it.
/// Returns None if not an img tag or image can't be loaded.
fn get_img_natural_size(styled: &StyledNode, content_dir: Option<&Path>) -> Option<(u32, u32)> {
    if !is_img_element(styled) { return None; }

    let src = get_attr(&styled.node, "src")?;
    if src.is_empty() { return None; }

    // Try to load and get dimensions
    let data = load_img_data(&src, content_dir)?;
    crate::content::decode_image(&data).ok().map(|img| (img.width, img.height))
}

/// Get an HTML attribute value from a Handle.
fn get_attr(handle: &markup5ever_rcdom::Handle, name: &str) -> Option<String> {
    match &handle.data {
        NodeData::Element { ref attrs, .. } => {
            attrs.borrow().iter()
                .find(|a| a.name.local.as_ref() == name)
                .map(|a| a.value.to_string())
        }
        _ => None,
    }
}

/// Load image bytes from a src path (local file or URL).
fn load_img_data(src: &str, content_dir: Option<&Path>) -> Option<Vec<u8>> {
    if src.starts_with("http://") || src.starts_with("https://") {
        crate::content::fetch_url_bytes(src).ok()
    } else if src.starts_with("data:") {
        // Data URL: data:image/png;base64,iVBOR...
        let comma = src.find(',')?;
        let encoded = &src[comma + 1..];
        if src[..comma].contains("base64") {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.decode(encoded).ok()
        } else {
            Some(encoded.as_bytes().to_vec())
        }
    } else if let Some(dir) = content_dir {
        let path = crate::content::loader::safe_content_path_pub(dir, src)?;
        std::fs::read(&path).ok()
    } else {
        None
    }
}

fn extract_layout(
    tree: &taffy::TaffyTree<()>,
    node_id: taffy::NodeId,
    styled: &StyledNode,
    parent_x: f32,
    parent_y: f32,
    content_dir: Option<&Path>,
) -> LayoutNode {
    let layout = match tree.layout(node_id) {
        Ok(l) => l,
        Err(_) => return LayoutNode {
            bounds: super::style::Rect { x: parent_x, y: parent_y, w: 0.0, h: 0.0 },
            style: styled.style.clone(),
            text: styled.text.clone(),
            tag: None,
            svg_data: None,
            image_data: None,
            image_natural_size: None,
            children: vec![],
        },
    };
    let x = parent_x + layout.location.x;
    let y = parent_y + layout.location.y;

    let taffy_children = tree.children(node_id).unwrap_or_default();
    let children: Vec<LayoutNode> = taffy_children.iter()
        .zip(styled.children.iter())
        .map(|(&child_id, child_styled)| extract_layout(tree, child_id, child_styled, x, y, content_dir))
        .collect();

    let tag = match &styled.node.data {
        NodeData::Element { ref name, .. } => Some(name.local.as_ref().to_string()),
        _ => None,
    };

    // Serialize inline <svg> elements for resvg rendering
    let svg_data = if tag.as_deref() == Some(super::style::tag::SVG) {
        Some(dom::serialize_node(&styled.node))
    } else {
        None
    };

    // Load image data for <img> elements
    let (image_data, image_natural_size) = if tag.as_deref() == Some("img") {
        if let Some(src) = get_attr(&styled.node, "src") {
            if let Some(raw) = load_img_data(&src, content_dir) {
                if let Ok(img) = crate::content::decode_image(&raw) {
                    (Some(img.rgba), Some((img.width, img.height)))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    LayoutNode {
        bounds: Rect { x, y, w: layout.size.width, h: layout.size.height },
        style: styled.style.clone(),
        text: styled.text.clone(),
        tag,
        svg_data,
        image_data,
        image_natural_size,
        children,
    }
}

fn to_taffy_style(cs: &ComputedStyle, parent_width: f32, vp: Viewport) -> taffy::Style {
    let fs = cs.font_size;
    let pw = parent_width;

    taffy::Style {
        box_sizing: match cs.box_sizing {
            BoxSizing::ContentBox => taffy::BoxSizing::ContentBox,
            BoxSizing::BorderBox => taffy::BoxSizing::BorderBox,
        },
        display: match cs.display {
            Display::Flex => taffy::Display::Flex,
            Display::Grid => taffy::Display::Grid,
            Display::None => taffy::Display::None,
            Display::Block | Display::InlineBlock => taffy::Display::Block,
            Display::Inline => taffy::Display::Flex,
        },
        position: match cs.position {
            Position::Absolute | Position::Fixed => taffy::Position::Absolute,
            _ => taffy::Position::Relative,
        },
        inset: taffy::Rect {
            top: dim_to_lpa(cs.top, fs, vp, pw),
            right: dim_to_lpa(cs.right, fs, vp, pw),
            bottom: dim_to_lpa(cs.bottom, fs, vp, pw),
            left: dim_to_lpa(cs.left, fs, vp, pw),
        },
        size: taffy::Size {
            width: dim_to_taffy(cs.width, fs, vp, pw),
            height: dim_to_taffy(cs.height, fs, vp, pw),
        },
        min_size: taffy::Size {
            width: dim_to_taffy(cs.min_width, fs, vp, pw),
            height: dim_to_taffy(cs.min_height, fs, vp, pw),
        },
        max_size: taffy::Size {
            width: dim_to_taffy(cs.max_width, fs, vp, pw),
            height: dim_to_taffy(cs.max_height, fs, vp, pw),
        },
        margin: taffy::Rect {
            top: dim_to_lpa(cs.margin_top, fs, vp, pw),
            right: dim_to_lpa(cs.margin_right, fs, vp, pw),
            bottom: dim_to_lpa(cs.margin_bottom, fs, vp, pw),
            left: dim_to_lpa(cs.margin_left, fs, vp, pw),
        },
        padding: taffy::Rect {
            top: dim_to_lp(cs.padding_top, fs, vp, pw),
            right: dim_to_lp(cs.padding_right, fs, vp, pw),
            bottom: dim_to_lp(cs.padding_bottom, fs, vp, pw),
            left: dim_to_lp(cs.padding_left, fs, vp, pw),
        },
        border: taffy::Rect {
            top: dim_to_lp(cs.border_top_width, fs, vp, pw),
            right: dim_to_lp(cs.border_right_width, fs, vp, pw),
            bottom: dim_to_lp(cs.border_bottom_width, fs, vp, pw),
            left: dim_to_lp(cs.border_left_width, fs, vp, pw),
        },
        flex_direction: match cs.flex_direction {
            FlexDirection::Row => taffy::FlexDirection::Row,
            FlexDirection::Column => taffy::FlexDirection::Column,
            FlexDirection::RowReverse => taffy::FlexDirection::RowReverse,
            FlexDirection::ColumnReverse => taffy::FlexDirection::ColumnReverse,
        },
        flex_wrap: match cs.flex_wrap {
            FlexWrap::NoWrap => taffy::FlexWrap::NoWrap,
            FlexWrap::Wrap => taffy::FlexWrap::Wrap,
        },
        flex_grow: cs.flex_grow,
        flex_shrink: cs.flex_shrink,
        flex_basis: dim_to_taffy(cs.flex_basis, fs, vp, pw),
        align_items: Some(match cs.align_items {
            AlignItems::Stretch => taffy::AlignItems::Stretch,
            AlignItems::FlexStart => taffy::AlignItems::FlexStart,
            AlignItems::FlexEnd => taffy::AlignItems::FlexEnd,
            AlignItems::Center => taffy::AlignItems::Center,
            AlignItems::Baseline => taffy::AlignItems::Baseline,
        }),
        align_content: Some(match cs.align_content {
            AlignContent::Normal | AlignContent::FlexStart => taffy::AlignContent::FlexStart,
            AlignContent::Stretch => taffy::AlignContent::Stretch,
            AlignContent::FlexEnd => taffy::AlignContent::FlexEnd,
            AlignContent::Center => taffy::AlignContent::Center,
            AlignContent::SpaceBetween => taffy::AlignContent::SpaceBetween,
            AlignContent::SpaceAround => taffy::AlignContent::SpaceAround,
            AlignContent::SpaceEvenly => taffy::AlignContent::SpaceEvenly,
        }),
        justify_content: Some(match cs.justify_content {
            JustifyContent::FlexStart => taffy::JustifyContent::FlexStart,
            JustifyContent::FlexEnd => taffy::JustifyContent::FlexEnd,
            JustifyContent::Center => taffy::JustifyContent::Center,
            JustifyContent::SpaceBetween => taffy::JustifyContent::SpaceBetween,
            JustifyContent::SpaceAround => taffy::JustifyContent::SpaceAround,
            JustifyContent::SpaceEvenly => taffy::JustifyContent::SpaceEvenly,
        }),
        gap: taffy::Size {
            width: dim_to_lp(cs.gap_column, fs, vp, pw),
            height: dim_to_lp(cs.gap_row, fs, vp, pw),
        },
        grid_template_columns: grid_entries_to_taffy(&cs.grid_template_columns, fs, vp),
        grid_template_rows: grid_entries_to_taffy(&cs.grid_template_rows, fs, vp),
        overflow: taffy::Point {
            x: if cs.overflow_hidden { taffy::Overflow::Hidden } else { taffy::Overflow::Visible },
            y: if cs.overflow_hidden { taffy::Overflow::Hidden } else { taffy::Overflow::Visible },
        },
        grid_column: taffy::Line {
            start: cs.grid_column_start
                .map(|n| <taffy::GridPlacement as TaffyGridLine>::from_line_index(n))
                .unwrap_or(taffy::GridPlacement::Auto),
            end: cs.grid_column_end
                .map(|n| <taffy::GridPlacement as TaffyGridLine>::from_line_index(n))
                .unwrap_or(taffy::GridPlacement::Auto),
        },
        grid_row: taffy::Line {
            start: cs.grid_row_start
                .map(|n| <taffy::GridPlacement as TaffyGridLine>::from_line_index(n))
                .unwrap_or(taffy::GridPlacement::Auto),
            end: cs.grid_row_end
                .map(|n| <taffy::GridPlacement as TaffyGridLine>::from_line_index(n))
                .unwrap_or(taffy::GridPlacement::Auto),
        },
        ..taffy::Style::DEFAULT
    }
}

fn dim_to_taffy(d: Dimension, fs: f32, vp: Viewport, parent_w: f32) -> taffy::Dimension {
    match d {
        Dimension::Auto => taffy::Dimension::auto(),
        Dimension::Px(v) => taffy::Dimension::length(v),
        Dimension::Percent(v) => taffy::Dimension::percent(v),
        Dimension::Em(v) => taffy::Dimension::length(v * fs),
        Dimension::Rem(v) => taffy::Dimension::length(v * ROOT_FONT_SIZE),
        Dimension::Vw(v) => taffy::Dimension::length(v / 100.0 * vp.w),
        Dimension::Vh(v) => taffy::Dimension::length(v / 100.0 * vp.h),
        Dimension::Fr(_) => taffy::Dimension::auto(),
        Dimension::Calc(frac, px) => {
            // Resolve calc() against parent width (for horizontal properties).
            let ref_px = if parent_w > 0.0 { parent_w } else { vp.w };
            taffy::Dimension::length(frac * ref_px + px)
        }
    }
}

fn dim_to_lp(d: Dimension, fs: f32, vp: Viewport, parent_w: f32) -> taffy::LengthPercentage {
    match d {
        Dimension::Percent(v) => taffy::LengthPercentage::percent(v),
        Dimension::Calc(frac, px) => {
            let ref_px = if parent_w > 0.0 { parent_w } else { vp.w };
            taffy::LengthPercentage::length(frac * ref_px + px)
        }
        other => taffy::LengthPercentage::length(other.resolve(0.0, fs, vp)),
    }
}

fn dim_to_lpa(d: Dimension, fs: f32, vp: Viewport, parent_w: f32) -> taffy::LengthPercentageAuto {
    match d {
        Dimension::Auto => taffy::LengthPercentageAuto::auto(),
        Dimension::Percent(v) => taffy::LengthPercentageAuto::percent(v),
        Dimension::Calc(frac, px) => {
            let ref_px = if parent_w > 0.0 { parent_w } else { vp.w };
            taffy::LengthPercentageAuto::length(frac * ref_px + px)
        }
        other => taffy::LengthPercentageAuto::length(other.resolve(0.0, fs, vp)),
    }
}

fn dim_to_min_track(d: &Dimension, fs: f32, vp: Viewport) -> taffy::MinTrackSizingFunction {
    match d {
        Dimension::Auto => taffy::MinTrackSizingFunction::auto(),
        Dimension::Fr(_) => taffy::MinTrackSizingFunction::auto(), // fr not valid for min
        Dimension::Percent(v) => taffy::MinTrackSizingFunction::percent(*v),
        other => taffy::MinTrackSizingFunction::length(other.resolve(0.0, fs, vp)),
    }
}

fn dim_to_max_track(d: &Dimension, fs: f32, vp: Viewport) -> taffy::MaxTrackSizingFunction {
    match d {
        Dimension::Auto => taffy::MaxTrackSizingFunction::auto(),
        Dimension::Fr(v) => taffy::MaxTrackSizingFunction::fr(*v),
        Dimension::Percent(v) => taffy::MaxTrackSizingFunction::percent(*v),
        other => taffy::MaxTrackSizingFunction::length(other.resolve(0.0, fs, vp)),
    }
}

fn track_def_to_taffy(def: &GridTrackDef, fs: f32, vp: Viewport) -> taffy::TrackSizingFunction {
    taffy::MinMax { min: dim_to_min_track(&def.min, fs, vp), max: dim_to_max_track(&def.max, fs, vp) }
}

fn grid_entries_to_taffy(entries: &[GridTrackEntry], fs: f32, vp: Viewport) -> Vec<taffy::GridTemplateComponent<String>> {
    let mut result = Vec::new();
    for entry in entries {
        match entry {
            GridTrackEntry::Single(def) => {
                result.push(taffy::GridTemplateComponent::Single(track_def_to_taffy(def, fs, vp)));
            }
            GridTrackEntry::Repeat(kind, defs) => {
                let taffy_count = match kind {
                    GridRepeatKind::AutoFill => taffy::RepetitionCount::AutoFill,
                    GridRepeatKind::AutoFit => taffy::RepetitionCount::AutoFit,
                    GridRepeatKind::Count(n) => taffy::RepetitionCount::Count(*n),
                };
                let taffy_tracks: Vec<taffy::TrackSizingFunction> = defs.iter()
                    .map(|d| track_def_to_taffy(d, fs, vp))
                    .collect();
                result.push(taffy::prelude::repeat(taffy_count, taffy_tracks));
            }
        }
    }
    result
}

/// Rough text width estimate (0.6 * font_size per character).
fn estimate_text_width(text: &str, font_size: f32) -> f32 {
    text.len() as f32 * font_size * 0.6
}

/// Public wrapper for `to_taffy_style` (used by incremental.rs).
pub fn to_taffy_style_pub(cs: &ComputedStyle, vp: Viewport) -> taffy::Style {
    to_taffy_style(cs, 0.0, vp)
}

/// Public wrapper for `estimate_text_width` (used by incremental.rs).
pub fn estimate_text_width_pub(text: &str, font_size: f32) -> f32 {
    estimate_text_width(text, font_size)
}

#[cfg(test)]
mod tests {
    use super::super::{dom, style};
    use tiny_skia::Pixmap;

    #[test]
    fn empty_html_does_not_panic() {
        let mut pixmap = Pixmap::new(128, 128).unwrap();
        super::super::render_html("", &mut pixmap);
    }

    #[test]
    fn malformed_css_does_not_panic() {
        let html = r#"<html><head><style>
            body { width: ????px; height: NaN; margin: -999999px }
            div { display: flex; flex: invalid }
        </style></head><body><div>test</div></body></html>"#;
        let mut pixmap = Pixmap::new(128, 128).unwrap();
        super::super::render_html(html, &mut pixmap);
    }

    #[test]
    fn nested_flexbox_does_not_panic() {
        let mut html = String::from("<html><body>");
        for _ in 0..50 {
            html.push_str("<div style='display:flex'>");
        }
        html.push_str("content");
        for _ in 0..50 {
            html.push_str("</div>");
        }
        html.push_str("</body></html>");
        let mut pixmap = Pixmap::new(128, 128).unwrap();
        super::super::render_html(&html, &mut pixmap);
    }
}
