//! HTML/CSS renderer that paints to a tiny-skia Pixmap.
//!
//! Pipeline: HTML → html5ever DOM → CSS cascade → taffy layout → tiny-skia paint
//!
//! Supports a practical subset of CSS: display (block/flex/grid/none), margin,
//! padding, background-color, linear-gradient, color, font-size, font-weight,
//! border, border-radius, width/height (px/%), gap, grid-template-columns,
//! opacity, line-height, overflow, box-sizing.

pub mod dom;
pub mod style;
pub mod layout;
mod paint;
pub mod incremental;

use std::path::Path;
use tiny_skia::Pixmap;

/// Re-export DOM parsing for use by runtime (incremental DOM bootstrap).
pub fn dom_parse_html(html: &str) -> markup5ever_rcdom::RcDom {
    dom::parse_html(html)
}

/// Render an HTML document to a tiny-skia Pixmap.
///
/// This is the main entry point. Parses HTML, extracts `<style>` blocks,
/// resolves CSS cascade, computes layout with taffy, and paints to the pixmap.
pub fn render_html(html: &str, pixmap: &mut Pixmap) {
    let width = pixmap.width() as f32;
    let height = pixmap.height() as f32;

    // 1. Parse HTML → DOM tree
    let document = dom::parse_html(html);

    // 2. Extract <style> blocks and parse CSS rules
    let rules = style::extract_and_parse_styles(&document);

    // 3. Build styled tree (DOM + computed styles via cascade)
    let styled = style::compute_styles(&document, &rules);

    // 4. Build taffy layout tree and compute layout
    let layout_tree = layout::compute_layout(&styled, width, height);

    // 5. Paint to pixmap
    paint::paint(&layout_tree, pixmap);
}

/// Extract `<script>` tag contents from HTML (for V8 evaluation).
/// Returns (unused, concatenated_scripts). Only handles inline scripts.
pub fn extract_scripts(html: &str) -> (String, String) {
    let document = dom::parse_html(html);
    dom::extract_scripts(&document)
}

/// Extract all `<style>` element text contents from an HTML string.
pub fn extract_style_elements(html: &str) -> Vec<String> {
    let document = dom::parse_html(html);
    dom::extract_styles(&document)
}

/// Extract `<script>` tag contents from HTML, resolving `src` attributes
/// relative to `content_dir`. Also loads any `@font-face` fonts found in
/// `<style>` blocks.
pub fn extract_scripts_from_dir(html: &str, content_dir: &Path) -> (String, String) {
    let document = dom::parse_html(html);

    // Load @font-face fonts from <style> blocks
    let rules_text = style::extract_style_text(&document);
    load_font_faces(&rules_text, content_dir);

    dom::extract_scripts_with_dir(&document, Some(content_dir))
}

/// Parse @font-face rules from CSS text and load fonts from the filesystem.
fn load_font_faces(css: &str, content_dir: &Path) {
    use crate::canvas2d::text;
    use log::{info, warn};

    // Find @font-face blocks
    let lower = css.to_lowercase();
    let mut pos = 0;
    while let Some(start) = lower[pos..].find("@font-face") {
        let abs_start = pos + start;
        let Some(brace_start) = lower[abs_start..].find('{') else { break };
        let block_start = abs_start + brace_start + 1;
        let Some(brace_end) = lower[block_start..].find('}') else { break };
        let block = &css[block_start..block_start + brace_end];

        // Extract font-family name
        let family = extract_css_value(block, "font-family")
            .map(|s| s.trim_matches(|c: char| c == '\'' || c == '"').to_string());

        // Extract src url()
        let src_url = extract_css_value(block, "src").and_then(|s| {
            // Parse url('path') or url("path")
            let lower_s = s.to_lowercase();
            let url_start = lower_s.find("url(")?;
            let rest = &s[url_start + 4..];
            let url_end = rest.find(')')?;
            let url = rest[..url_end].trim().trim_matches(|c: char| c == '\'' || c == '"');
            Some(url.to_string())
        });

        if let (Some(name), Some(url)) = (family, src_url) {
            if url.starts_with("http://") || url.starts_with("https://") {
                // Remote font — validate against SSRF before fetching.
                // fetch_url already blocks private/loopback IPs, so this is safe.
                match crate::content::fetch_url(&url) {
                    Ok(data) => {
                        if data.len() > 10 * 1024 * 1024 {
                            warn!("Remote font too large ({}B), skipping: {}", data.len(), url);
                        } else {
                            match text::load_font(data.as_bytes(), &name) {
                                Ok(()) => info!("Loaded remote @font-face '{}' from {}", name, url),
                                Err(e) => warn!("Failed to parse remote font '{}': {}", name, e),
                            }
                        }
                    }
                    Err(e) => warn!("Failed to fetch remote font {}: {}", url, e),
                }
            } else {
                // Local font — use path traversal protection
                match crate::content::loader::safe_content_path_pub(content_dir, &url) {
                    Some(font_path) => {
                        match std::fs::read(&font_path) {
                            Ok(data) => {
                                match text::load_font(&data, &name) {
                                    Ok(()) => info!("Loaded @font-face '{}' from {}", name, url),
                                    Err(e) => warn!("Failed to parse font '{}': {}", name, e),
                                }
                            }
                            Err(e) => warn!("Failed to read font file {}: {}", url, e),
                        }
                    }
                    None => warn!("Blocked path traversal in @font-face url: {}", url),
                }
            }
        }

        pos = block_start + brace_end + 1;
    }
}

/// Extract a CSS property value from a declaration block.
fn extract_css_value(block: &str, property: &str) -> Option<String> {
    let lower = block.to_lowercase();
    let prop_pos = lower.find(property)?;
    let rest = &block[prop_pos + property.len()..];
    let colon = rest.find(':')?;
    let after_colon = &rest[colon + 1..];
    let end = after_colon.find(';').unwrap_or(after_colon.len());
    Some(after_colon[..end].trim().to_string())
}

/// Render HTML with content directory support: loads external fonts, scripts, and linked stylesheets.
pub fn render_html_with_dir(html: &str, pixmap: &mut Pixmap, content_dir: &Path) {
    let document = dom::parse_html(html);

    // Load linked stylesheets (<link rel="stylesheet">) via DOM
    let linked_css = dom::extract_link_stylesheets(&document, content_dir);

    // Load @font-face fonts from inline <style> blocks
    let rules_text = style::extract_style_text(&document);
    load_font_faces(&rules_text, content_dir);

    // Also load @font-face from linked stylesheets (e.g., Google Fonts)
    for css in &linked_css {
        load_font_faces(css, content_dir);
    }

    let width = pixmap.width() as f32;
    let height = pixmap.height() as f32;

    // Parse CSS rules: linked stylesheets first, then inline <style> blocks
    let mut rules = Vec::new();
    for css in &linked_css {
        rules.extend(style::parse_css_rules(css));
    }
    rules.extend(style::extract_and_parse_styles(&document));

    let styled = style::compute_styles(&document, &rules);
    let layout_tree = layout::compute_layout_with_dir(&styled, width, height, Some(content_dir));
    paint::paint(&layout_tree, pixmap);
}
