//! HTML parsing via html5ever → RcDom tree.

use std::path::Path;
use html5ever::tendril::TendrilSink;
use html5ever::{parse_document, ParseOpts};
use log::{info, warn};
use markup5ever_rcdom::{Handle, NodeData, RcDom};

/// Parse an HTML string into an RcDom.
/// Falls back to an empty DOM if parsing fails (should be extremely rare with html5ever).
pub fn parse_html(html: &str) -> RcDom {
    let opts = ParseOpts::default();
    parse_document(RcDom::default(), opts)
        .from_utf8()
        .read_from(&mut html.as_bytes())
        .unwrap_or_else(|e| {
            warn!("HTML parsing failed: {}", e);
            RcDom::default()
        })
}

/// Extract `<script>` contents from the DOM. Returns (html_without_scripts, scripts).
/// Only extracts inline scripts (no `src` attribute support).
pub fn extract_scripts(dom: &RcDom) -> (String, String) {
    extract_scripts_with_dir(dom, None)
}

/// Extract `<script>` contents from the DOM, resolving `src` attributes
/// relative to `content_dir`. Returns (unused_html, joined_scripts).
pub fn extract_scripts_with_dir(dom: &RcDom, content_dir: Option<&Path>) -> (String, String) {
    let mut scripts = Vec::new();
    collect_scripts(&dom.document, &mut scripts, content_dir);
    (String::new(), scripts.join("\n;\n"))
}

const MAX_DOM_DEPTH: usize = 256;

fn collect_scripts(node: &Handle, scripts: &mut Vec<String>, content_dir: Option<&Path>) {
    collect_scripts_inner(node, scripts, content_dir, 0);
}

fn collect_scripts_inner(node: &Handle, scripts: &mut Vec<String>, content_dir: Option<&Path>, depth: usize) {
    if depth > MAX_DOM_DEPTH {
        return;
    }
    if let NodeData::Element { ref name, .. } = node.data {
        if name.local.as_ref() == super::style::tag::SCRIPT {
            // Check for src attribute (external script)
            if let Some(src) = get_attr(node, "src") {
                if src.starts_with("http://") || src.starts_with("https://") {
                    // Remote script — fetch from URL
                    match crate::content::fetch_url(&src) {
                        Ok(content) => {
                            info!("Loaded remote script: {}", src);
                            scripts.push(content);
                        }
                        Err(e) => {
                            warn!("Failed to fetch remote script {}: {}", src, e);
                        }
                    }
                } else if let Some(dir) = content_dir {
                    // Local script — use safe_content_path to prevent directory traversal
                    match crate::content::loader::safe_content_path_pub(dir, &src) {
                        Some(script_path) => {
                            match std::fs::read_to_string(&script_path) {
                                Ok(content) => {
                                    info!("Loaded external script: {}", src);
                                    scripts.push(content);
                                }
                                Err(e) => {
                                    warn!("Failed to load script {}: {}", src, e);
                                }
                            }
                        }
                        None => {
                            warn!("Blocked path traversal in script src: {}", src);
                        }
                    }
                } else {
                    warn!("External script src=\"{}\" ignored (no content directory)", src);
                }
                return; // Don't also collect inline text for src scripts
            }

            // Inline script — collect text children
            let mut text = String::new();
            for child in node.children.borrow().iter() {
                if let NodeData::Text { ref contents } = child.data {
                    text.push_str(&contents.borrow());
                }
            }
            if !text.is_empty() {
                scripts.push(text);
            }
        }
    }
    for child in node.children.borrow().iter() {
        collect_scripts_inner(child, scripts, content_dir, depth + 1);
    }
}

/// Extract CSS from `<link rel="stylesheet">` tags in the DOM.
/// Resolves href attributes: local paths read from filesystem, HTTP URLs fetched.
pub fn extract_link_stylesheets(dom: &RcDom, content_dir: &Path) -> Vec<String> {
    let mut sheets = Vec::new();
    collect_link_stylesheets(&dom.document, &mut sheets, content_dir, 0);
    sheets
}

fn collect_link_stylesheets(node: &Handle, sheets: &mut Vec<String>, content_dir: &Path, depth: usize) {
    if depth > MAX_DOM_DEPTH { return; }
    if let NodeData::Element { ref name, .. } = node.data {
        if name.local.as_ref() == "link" {
            // Only process stylesheet links
            let is_stylesheet = get_attr(node, "rel")
                .map(|r| r.to_lowercase().contains("stylesheet"))
                .unwrap_or(false);
            if is_stylesheet {
                if let Some(href) = get_attr(node, "href") {
                    if href.starts_with("http://") || href.starts_with("https://") {
                        match crate::content::fetch_url(&href) {
                            Ok(css) => {
                                info!("Loaded remote stylesheet: {}", href);
                                sheets.push(css);
                            }
                            Err(e) => {
                                warn!("Failed to fetch stylesheet {}: {}", href, e);
                            }
                        }
                    } else {
                        match crate::content::loader::safe_content_path_pub(content_dir, &href) {
                            Some(path) => {
                                match std::fs::read_to_string(&path) {
                                    Ok(css) => {
                                        info!("Loaded local stylesheet: {}", href);
                                        sheets.push(css);
                                    }
                                    Err(e) => {
                                        warn!("Failed to read stylesheet {}: {}", href, e);
                                    }
                                }
                            }
                            None => {
                                warn!("Blocked path traversal in stylesheet href: {}", href);
                            }
                        }
                    }
                }
            }
        }
    }
    for child in node.children.borrow().iter() {
        collect_link_stylesheets(child, sheets, content_dir, depth + 1);
    }
}

/// Extract all `<style>` element text contents from the DOM.
/// Returns a vector of CSS strings (one per `<style>` tag).
pub fn extract_styles(dom: &RcDom) -> Vec<String> {
    let mut styles = Vec::new();
    collect_styles(&dom.document, &mut styles, 0);
    styles
}

fn collect_styles(node: &Handle, styles: &mut Vec<String>, depth: usize) {
    if depth > MAX_DOM_DEPTH { return; }
    if let NodeData::Element { ref name, .. } = node.data {
        if name.local.as_ref() == "style" {
            let mut text = String::new();
            for child in node.children.borrow().iter() {
                if let NodeData::Text { ref contents } = child.data {
                    text.push_str(&contents.borrow());
                }
            }
            if !text.is_empty() {
                styles.push(text);
            }
        }
    }
    for child in node.children.borrow().iter() {
        collect_styles(child, styles, depth + 1);
    }
}

/// Get the tag name of a node, or None if not an element.
pub fn tag_name(node: &Handle) -> Option<&str> {
    match node.data {
        NodeData::Element { ref name, .. } => Some(name.local.as_ref()),
        _ => None,
    }
}

/// Get an attribute value from an element node.
pub fn get_attr(node: &Handle, attr_name: &str) -> Option<String> {
    match node.data {
        NodeData::Element { ref attrs, .. } => {
            for attr in attrs.borrow().iter() {
                if attr.name.local.as_ref() == attr_name {
                    return Some(attr.value.to_string());
                }
            }
            None
        }
        _ => None,
    }
}

/// Get classes from an element's class attribute.
pub fn get_classes(node: &Handle) -> Vec<String> {
    get_attr(node, "class")
        .map(|c| c.split_whitespace().map(String::from).collect())
        .unwrap_or_default()
}

/// Get the id attribute.
pub fn get_id(node: &Handle) -> Option<String> {
    get_attr(node, "id")
}

/// Serialize a DOM node and its subtree back to an HTML/SVG string.
pub fn serialize_node(node: &Handle) -> String {
    let mut out = String::new();
    serialize_node_inner(node, &mut out);
    out
}

fn serialize_node_inner(node: &Handle, out: &mut String) {
    serialize_node_depth(node, out, 0);
}

fn serialize_node_depth(node: &Handle, out: &mut String, depth: usize) {
    if depth > MAX_DOM_DEPTH {
        return;
    }
    match &node.data {
        NodeData::Element { ref name, ref attrs, .. } => {
            let tag = name.local.as_ref();
            out.push('<');
            out.push_str(tag);
            // Add xmlns for SVG root elements (html5ever stores namespace separately from attrs)
            if tag == "svg" {
                let has_xmlns = attrs.borrow().iter().any(|a| a.name.local.as_ref() == "xmlns");
                if !has_xmlns {
                    out.push_str(" xmlns=\"http://www.w3.org/2000/svg\"");
                }
            }
            for attr in attrs.borrow().iter() {
                out.push(' ');
                out.push_str(attr.name.local.as_ref());
                out.push_str("=\"");
                // Escape attribute value
                for ch in attr.value.chars() {
                    match ch {
                        '"' => out.push_str("&quot;"),
                        '&' => out.push_str("&amp;"),
                        '<' => out.push_str("&lt;"),
                        _ => out.push(ch),
                    }
                }
                out.push('"');
            }
            out.push('>');
            for child in node.children.borrow().iter() {
                serialize_node_depth(child, out, depth + 1);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
        NodeData::Text { ref contents } => {
            for ch in contents.borrow().chars() {
                match ch {
                    '&' => out.push_str("&amp;"),
                    '<' => out.push_str("&lt;"),
                    '>' => out.push_str("&gt;"),
                    _ => out.push(ch),
                }
            }
        }
        _ => {
            for child in node.children.borrow().iter() {
                serialize_node_depth(child, out, depth + 1);
            }
        }
    }
}

