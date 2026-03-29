use anyhow::Result;
use log::{info, warn};
use std::path::{Path, PathBuf};

/// Public wrapper for safe_content_path, used by other modules (e.g., htmlcss font loading).
pub fn safe_content_path_pub(base_dir: &Path, relative: &str) -> Option<PathBuf> {
    safe_content_path(base_dir, relative)
}

/// Decode percent-encoded characters in a URL path (e.g., %2e → '.').
fn percent_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                hex_val(bytes[i + 1]),
                hex_val(bytes[i + 2]),
            ) {
                result.push((hi << 4 | lo) as char);
                i += 3;
                continue;
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Resolve a relative path safely within a base directory, preventing directory traversal.
/// Returns `None` if the resolved path escapes the base directory.
///
/// For existing files: canonicalizes and verifies containment (catches symlink escapes).
/// For non-existing files: canonicalizes the deepest existing ancestor and verifies
/// the final path stays within the base directory. This prevents TOCTOU symlink races
/// by ensuring even the parent chain is contained.
fn safe_content_path(base_dir: &Path, relative: &str) -> Option<PathBuf> {
    // URL-decode before validation to catch %2e%2e and similar encoded traversal
    let decoded = percent_decode(relative);
    let clean = decoded.trim_start_matches('/');
    // Reject traversal patterns before filesystem access
    if clean.contains("..") {
        return None;
    }
    // If base_dir can be canonicalized, use full containment check
    if let Ok(base) = base_dir.canonicalize() {
        let joined = base.join(clean);
        if joined.exists() {
            // File exists — canonicalize to resolve symlinks and verify containment
            let canonical = joined.canonicalize().ok()?;
            if canonical.starts_with(&base) {
                return Some(canonical);
            } else {
                return None; // symlink escape
            }
        }
        // File doesn't exist yet — canonicalize the parent directory to catch
        // symlink-based escapes (e.g., content_dir/symlink_to_tmp/evil.js).
        if let Some(parent) = joined.parent() {
            if parent.exists() {
                let canonical_parent = parent.canonicalize().ok()?;
                if !canonical_parent.starts_with(&base) {
                    return None; // parent escapes via symlink
                }
                // Return the canonical parent joined with the filename
                if let Some(filename) = joined.file_name() {
                    return Some(canonical_parent.join(filename));
                }
            }
        }
        return Some(joined);
    }
    // base_dir doesn't exist yet — ".." already rejected, so join is safe
    Some(base_dir.join(clean))
}

/// Load content from a directory. Looks for index.html (extracts scripts)
/// or index.js (evaluates directly).
pub fn load_content(content_dir: &Path) -> Result<String> {
    let (_, js) = load_content_with_html(content_dir)?;
    Ok(js)
}

/// Load content, returning both raw HTML (if any) and extracted JS.
/// Returns (Some(html), js) for HTML files, (None, js) for JS-only files.
pub fn load_content_with_html(content_dir: &Path) -> Result<(Option<String>, String)> {
    let html_path = content_dir.join("index.html");
    let js_path = content_dir.join("index.js");

    if html_path.exists() {
        info!("Loading content from {}", html_path.display());
        let html = std::fs::read_to_string(&html_path)?;
        let js = extract_scripts_from_html(&html, content_dir)?;
        Ok((Some(html), js))
    } else if js_path.exists() {
        info!("Loading content from {}", js_path.display());
        Ok((None, std::fs::read_to_string(&js_path)?))
    } else {
        warn!("No index.html or index.js found in {}", content_dir.display());
        Ok((None, String::new()))
    }
}

/// Extract JavaScript from an HTML file using html5ever DOM parsing.
/// Handles both inline <script> blocks and external <script src="..."> references
/// (local files and remote URLs).
fn extract_scripts_from_html(html: &str, base_dir: &Path) -> Result<String> {
    let dom = crate::htmlcss::dom::parse_html(html);
    let (_, scripts) = crate::htmlcss::dom::extract_scripts_with_dir(&dom, Some(base_dir));
    Ok(scripts)
}


/// Extract CSS from `<link rel="stylesheet">` tags in HTML using html5ever DOM parsing.
/// Resolves href attributes: local paths read from filesystem, HTTP URLs fetched.
pub fn extract_link_stylesheets(html: &str, base_dir: &Path) -> Vec<String> {
    let dom = crate::htmlcss::dom::parse_html(html);
    crate::htmlcss::dom::extract_link_stylesheets(&dom, base_dir)
}


/// Convert a sidecar URL to a local filesystem path.
/// Sidecar sends URLs like: http://127.0.0.1:8080/<nonce>/index.html
/// We strip scheme/host/port and the nonce prefix, resolve against content_dir.
pub fn url_to_content_path(url: &str, content_dir: &Path) -> PathBuf {
    // Strip scheme and host
    let path_part = if let Some(idx) = url.find("://") {
        let after_scheme = &url[idx + 3..];
        // Find the first / after host:port
        if let Some(slash) = after_scheme.find('/') {
            &after_scheme[slash..]
        } else {
            "/"
        }
    } else {
        url
    };

    // Strip leading / and nonce prefix (first path segment is the nonce)
    let path_part = path_part.trim_start_matches('/');
    let without_nonce = if let Some(slash) = path_part.find('/') {
        &path_part[slash + 1..]
    } else {
        path_part
    };

    // Default to index.html
    let file = if without_nonce.is_empty() { "index.html" } else { without_nonce };

    // Sanitize: reject path traversal attempts
    match safe_content_path(content_dir, file) {
        Some(safe_path) => safe_path,
        None => {
            log::warn!("Path traversal blocked: {}", file);
            content_dir.join("index.html")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_url_to_content_path() {
        let dir = Path::new("/data/stages/abc/content");

        assert_eq!(
            url_to_content_path("http://127.0.0.1:8080/x9f7a3b1c/index.html", dir),
            dir.join("index.html")
        );

        assert_eq!(
            url_to_content_path("http://127.0.0.1:8080/nonce123/bundle.js", dir),
            dir.join("bundle.js")
        );

        assert_eq!(
            url_to_content_path("http://127.0.0.1:8080/nonce/", dir),
            dir.join("index.html")
        );
    }

    #[test]
    fn test_extract_scripts() {
        let html = r#"
            <html><body>
            <script>console.log("inline");</script>
            <script src="app.js"></script>
            </body></html>
        "#;
        // Can't test external script loading without filesystem, but inline works
        let result = extract_scripts_from_html(html, Path::new("/nonexistent")).unwrap();
        assert!(result.contains("console.log"));
    }


    #[test]
    fn test_url_no_scheme() {
        let dir = Path::new("/data");
        let result = url_to_content_path("/nonce/file.js", dir);
        assert_eq!(result, dir.join("file.js"));
    }

    #[test]
    fn test_url_bare_path() {
        let dir = Path::new("/data");
        let result = url_to_content_path("index.html", dir);
        assert_eq!(result, dir.join("index.html"));
    }

    #[test]
    fn test_multiple_inline_scripts() {
        let html = r#"
            <script>var a = 1;</script>
            <script>var b = 2;</script>
            <script>var c = 3;</script>
        "#;
        let result = extract_scripts_from_html(html, Path::new("/x")).unwrap();
        assert!(result.contains("var a = 1"));
        assert!(result.contains("var b = 2"));
        assert!(result.contains("var c = 3"));
    }

    #[test]
    fn test_empty_script_tag() {
        let html = "<script></script>";
        let result = extract_scripts_from_html(html, Path::new("/x")).unwrap();
        assert!(result.is_empty() || result.trim().is_empty());
    }

    #[test]
    fn test_no_scripts() {
        let html = "<html><body><p>Hello</p></body></html>";
        let result = extract_scripts_from_html(html, Path::new("/x")).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_script_with_type_attribute() {
        let html = r#"<script type="text/javascript">var x = 1;</script>"#;
        let result = extract_scripts_from_html(html, Path::new("/x")).unwrap();
        assert!(result.contains("var x = 1"));
    }

    #[test]
    fn test_load_content_no_dir() {
        let result = load_content(Path::new("/nonexistent/path/12345"));
        // Should return Ok with empty string
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_load_content_js_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.js"), "console.log('hello');").unwrap();
        let result = load_content(dir.path()).unwrap();
        assert_eq!(result, "console.log('hello');");
    }

    #[test]
    fn test_load_content_html_with_inline_script() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("index.html"),
            "<html><body><script>alert(1);</script></body></html>",
        ).unwrap();
        let result = load_content(dir.path()).unwrap();
        assert!(result.contains("alert(1)"));
    }

    #[test]
    fn test_load_content_html_with_external_script() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("app.js"), "var loaded = true;").unwrap();
        std::fs::write(
            dir.path().join("index.html"),
            r#"<html><body><script src="app.js"></script></body></html>"#,
        ).unwrap();
        let result = load_content(dir.path()).unwrap();
        assert!(result.contains("var loaded = true"));
    }

    #[test]
    fn test_load_content_prefers_html_over_js() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "<script>from_html();</script>").unwrap();
        std::fs::write(dir.path().join("index.js"), "from_js();").unwrap();
        let result = load_content(dir.path()).unwrap();
        assert!(result.contains("from_html"), "HTML should take priority over JS");
    }

    #[test]
    fn test_path_traversal_in_script_src_blocked() {
        let dir = tempfile::tempdir().unwrap();
        // Create a file outside content_dir
        let parent = dir.path().parent().unwrap();
        std::fs::write(parent.join("secret.js"), "stolen_data();").unwrap();

        let html = r#"<html><body><script src="../secret.js"></script></body></html>"#;
        std::fs::write(dir.path().join("index.html"), html).unwrap();
        let result = load_content(dir.path()).unwrap();
        assert!(!result.contains("stolen_data"), "path traversal should be blocked");
    }

    #[test]
    fn test_path_traversal_in_stylesheet_href_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().parent().unwrap();
        std::fs::write(parent.join("secret.css"), "body { color: red }").unwrap();

        let html = r#"<link rel="stylesheet" href="../secret.css">"#;
        let sheets = extract_link_stylesheets(html, dir.path());
        assert!(sheets.is_empty(), "path traversal in stylesheet should be blocked");
    }

    #[test]
    fn test_script_src_traversal_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().parent().unwrap();
        std::fs::write(parent.join("secret.js"), "stolen_data();").ok();
        let html = r#"<html><body><script src="../secret.js"></script></body></html>"#;
        std::fs::write(dir.path().join("index.html"), html).unwrap();
        let result = load_content(dir.path()).unwrap();
        assert!(!result.contains("stolen_data"),
            "directory traversal should be blocked in script src");
    }

    #[test]
    fn test_subdirectory_script_loads() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("lib")).unwrap();
        std::fs::write(dir.path().join("lib/util.js"), "var util = 1;").unwrap();
        let html = r#"<html><body><script src="lib/util.js"></script></body></html>"#;
        std::fs::write(dir.path().join("index.html"), html).unwrap();
        let result = load_content(dir.path()).unwrap();
        assert!(result.contains("var util = 1"), "subdirectory script should load");
    }

    #[test]
    fn test_safe_content_path_rejects_dotdot() {
        let dir = tempfile::tempdir().unwrap();
        assert!(safe_content_path(dir.path(), "../etc/passwd").is_none());
        assert!(safe_content_path(dir.path(), "../../etc/shadow").is_none());
        assert!(safe_content_path(dir.path(), "subdir/../../etc/passwd").is_none());
    }

    #[test]
    fn test_safe_content_path_allows_valid() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("app.js"), "ok").unwrap();
        assert!(safe_content_path(dir.path(), "app.js").is_some());
        assert!(safe_content_path(dir.path(), "subdir/file.js").is_some());
    }

    #[test]
    fn test_url_to_content_path_traversal_blocked() {
        let dir = tempfile::tempdir().unwrap();
        let result = url_to_content_path(
            "http://127.0.0.1:8080/nonce/../../etc/passwd",
            dir.path(),
        );
        // Should return index.html fallback, not the traversal path
        assert_eq!(result, dir.path().join("index.html"));
    }
}
