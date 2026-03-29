pub mod loader;

pub use loader::load_content_with_html;
pub use loader::url_to_content_path;

/// Decoded image data (RGBA pixels).
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Maximum image dimension to prevent OOM from image bombs.
const MAX_IMAGE_DIMENSION: u32 = 8192;

/// Decode a PNG/JPEG/WebP/SVG image from raw bytes into RGBA pixels.
pub fn decode_image(data: &[u8]) -> anyhow::Result<DecodedImage> {
    // Check for SVG: starts with <svg or <?xml (after trimming whitespace)
    let trimmed = trim_leading_whitespace(data);
    if trimmed.starts_with(b"<svg") || trimmed.starts_with(b"<?xml") || trimmed.starts_with(b"<SVG") {
        return decode_svg(data);
    }

    // Check image dimensions from headers BEFORE full decode to prevent OOM
    if let Ok(reader) = image::ImageReader::new(std::io::Cursor::new(data)).with_guessed_format() {
        if let Ok((w, h)) = reader.into_dimensions() {
            if w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION {
                return Err(anyhow::anyhow!(
                    "image dimensions {}x{} exceed maximum {}x{}",
                    w, h, MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION
                ));
            }
        }
    }
    let img = image::load_from_memory(data)
        .map_err(|e| anyhow::anyhow!("image decode failed: {}", e))?;
    let rgba = img.to_rgba8();
    Ok(DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
    })
}

fn trim_leading_whitespace(data: &[u8]) -> &[u8] {
    let mut i = 0;
    while i < data.len() && data[i].is_ascii_whitespace() { i += 1; }
    &data[i..]
}

/// Decode SVG data into RGBA pixels via resvg.
fn decode_svg(data: &[u8]) -> anyhow::Result<DecodedImage> {
    let tree = resvg::usvg::Tree::from_data(data, &resvg::usvg::Options::default())
        .map_err(|e| anyhow::anyhow!("SVG parse failed: {}", e))?;
    let size = tree.size();
    let sw = size.width();
    let sh = size.height();
    if !sw.is_finite() || !sh.is_finite() || sw <= 0.0 || sh <= 0.0 {
        return Err(anyhow::anyhow!("SVG has invalid dimensions: {}x{}", sw, sh));
    }
    let w = sw.ceil() as u32;
    let h = sh.ceil() as u32;
    if w == 0 || h == 0 {
        return Err(anyhow::anyhow!("SVG has zero dimensions"));
    }
    if w > MAX_IMAGE_DIMENSION || h > MAX_IMAGE_DIMENSION {
        return Err(anyhow::anyhow!(
            "SVG dimensions {}x{} exceed maximum {}x{}",
            w, h, MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION
        ));
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| anyhow::anyhow!("failed to create SVG pixmap {}x{}", w, h))?;
    resvg::render(&tree, resvg::tiny_skia::Transform::identity(), &mut pixmap.as_mut());
    Ok(DecodedImage {
        width: w,
        height: h,
        rgba: pixmap.take(),
    })
}


/// Fetch a URL and return the response body as a string.
/// Only supports http(s):// via reqwest. file:// is rejected for security.
/// Blocks requests to private/loopback/link-local addresses (SSRF protection).
/// Uses DNS pinning to prevent DNS rebinding attacks.
pub fn fetch_url(url: &str) -> anyhow::Result<String> {
    if url.starts_with("file://") {
        return Err(anyhow::anyhow!("file:// URLs are not allowed"));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(anyhow::anyhow!("unsupported URL scheme"));
    }
    // SSRF protection: resolve DNS once, check for private IPs, then pin the resolved
    // address so reqwest connects to the same IP (prevents DNS rebinding TOCTOU).
    let (resolved_ip, host, port) = resolve_and_check_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        // Disable redirects to prevent SSRF via HTTP 302 to private/metadata endpoints.
        // DNS pinning only prevents rebinding, not redirect-based SSRF.
        .redirect(reqwest::redirect::Policy::none())
        .resolve(&host, std::net::SocketAddr::new(resolved_ip, port))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {}", e))?;
    let rt = tokio::runtime::Handle::try_current();
    // Cap response size to prevent OOM from malicious large responses (50 MB).
    const MAX_RESPONSE_SIZE: u64 = 50 * 1024 * 1024;
    async fn do_fetch(client: reqwest::Client, url: String) -> anyhow::Result<String> {
        let resp = client.get(&url).send().await
            .map_err(|e| anyhow::anyhow!("fetch failed: {}", e))?;
        if let Some(len) = resp.content_length() {
            if len > MAX_RESPONSE_SIZE {
                return Err(anyhow::anyhow!("response too large: {} bytes (max {})", len, MAX_RESPONSE_SIZE));
            }
        }
        let body = resp.text().await
            .map_err(|e| anyhow::anyhow!("fetch failed: {}", e))?;
        if body.len() as u64 > MAX_RESPONSE_SIZE {
            return Err(anyhow::anyhow!("response body too large: {} bytes", body.len()));
        }
        Ok(body)
    }
    let url_owned = url.to_string();
    let body = if let Ok(handle) = rt {
        handle.block_on(do_fetch(client, url_owned))?
    } else {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(do_fetch(client, url_owned))?
    };
    Ok(body)
}

/// Fetch a URL and return the response body as raw bytes (for images, fonts, etc.).
/// Same SSRF protection as `fetch_url`.
pub fn fetch_url_bytes(url: &str) -> anyhow::Result<Vec<u8>> {
    if url.starts_with("file://") {
        return Err(anyhow::anyhow!("file:// URLs are not allowed"));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(anyhow::anyhow!("unsupported URL scheme"));
    }
    let (resolved_ip, host, port) = resolve_and_check_url(url)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .resolve(&host, std::net::SocketAddr::new(resolved_ip, port))
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build HTTP client: {}", e))?;
    let rt = tokio::runtime::Handle::try_current();
    const MAX_RESPONSE_SIZE: u64 = 50 * 1024 * 1024;
    async fn do_fetch(client: reqwest::Client, url: String) -> anyhow::Result<Vec<u8>> {
        let resp = client.get(&url).send().await
            .map_err(|e| anyhow::anyhow!("fetch failed: {}", e))?;
        if let Some(len) = resp.content_length() {
            if len > MAX_RESPONSE_SIZE {
                return Err(anyhow::anyhow!("response too large: {} bytes", len));
            }
        }
        let body = resp.bytes().await
            .map_err(|e| anyhow::anyhow!("fetch failed: {}", e))?;
        if body.len() as u64 > MAX_RESPONSE_SIZE {
            return Err(anyhow::anyhow!("response body too large: {} bytes", body.len()));
        }
        Ok(body.to_vec())
    }
    let url_owned = url.to_string();
    let body = if let Ok(handle) = rt {
        handle.block_on(do_fetch(client, url_owned))?
    } else {
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(do_fetch(client, url_owned))?
    };
    Ok(body)
}

/// Resolve a URL's hostname to an IP, verify it's not private/internal, and return
/// the pinned IP + host + port for use with reqwest's `resolve()`.
/// This prevents DNS rebinding by resolving once and pinning the result.
pub fn resolve_and_check_url(url: &str) -> anyhow::Result<(std::net::IpAddr, String, u16)> {
    use std::net::ToSocketAddrs;
    let parsed = url::Url::parse(url)
        .map_err(|_| anyhow::anyhow!("unparseable URL"))?;
    let host = parsed.host_str()
        .ok_or_else(|| anyhow::anyhow!("URL has no host"))?
        .to_string();
    let port = parsed.port().unwrap_or(match parsed.scheme() {
        "https" | "wss" => 443,
        _ => 80,
    });
    let addr_str = format!("{}:{}", host, port);
    let addrs: Vec<_> = addr_str.to_socket_addrs()
        .map_err(|_| anyhow::anyhow!("DNS resolution failed for {}", host))?
        .collect();
    if addrs.is_empty() {
        return Err(anyhow::anyhow!("DNS resolution returned no addresses for {}", host));
    }
    // Check ALL resolved addresses — block if any is private
    for addr in &addrs {
        let ip = addr.ip();
        if is_private_ip(ip) {
            return Err(anyhow::anyhow!("requests to private/internal hosts are blocked"));
        }
    }
    // Pin to the first resolved address
    Ok((addrs[0].ip(), host, port))
}

/// Check if an IP address is private/loopback/link-local.
/// Covers IPv4 RFC1918, link-local, and IPv6 loopback, link-local, ULA, and
/// IPv4-mapped addresses (which could bypass IPv4-only checks).
fn is_private_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_unspecified()
                || v4.is_private()
                || v4.is_link_local()
                || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
        }
        std::net::IpAddr::V6(v6) => {
            if v6.is_loopback() || v6.is_unspecified() {
                return true;
            }
            let seg0 = v6.segments()[0];
            // Link-local (fe80::/10)
            if seg0 & 0xffc0 == 0xfe80 { return true; }
            // Unique Local Address (fc00::/7 — includes fd00::/8)
            if seg0 & 0xfe00 == 0xfc00 { return true; }
            // Deprecated site-local (fec0::/10)
            if seg0 & 0xffc0 == 0xfec0 { return true; }
            // IPv4-mapped IPv6 (::ffff:0:0/96) — check the embedded IPv4 address
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_private_ip(std::net::IpAddr::V4(v4));
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_svg() {
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{}" height="{}">
                <rect width="100%" height="100%" fill="red"/>
            </svg>"#,
            10000, 10000
        );
        let result = decode_image(svg.as_bytes());
        assert!(result.is_err(), "should reject image exceeding MAX_IMAGE_DIMENSION");
    }

    #[test]
    fn accepts_normal_sized_image() {
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
            <rect width="64" height="64" fill="blue"/>
        </svg>"#;
        let result = decode_image(svg.as_bytes());
        assert!(result.is_ok());
        let img = result.unwrap();
        assert_eq!(img.width, 64);
        assert_eq!(img.height, 64);
    }

    #[test]
    fn rejects_corrupt_data() {
        let result = decode_image(b"this is not an image");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_blocks_metadata_endpoint() {
        let result = resolve_and_check_url("http://169.254.169.254/latest/meta-data/");
        assert!(result.is_err(), "should block cloud metadata endpoint");
    }

    #[test]
    fn resolve_returns_pinned_ip() {
        if let Ok((ip, host, port)) = resolve_and_check_url("http://example.com/test") {
            assert!(!ip.is_loopback());
            assert_eq!(host, "example.com");
            assert_eq!(port, 80);
        }
    }

    #[test]
    fn resolve_https_default_port() {
        if let Ok((_, _, port)) = resolve_and_check_url("https://example.com/") {
            assert_eq!(port, 443);
        }
    }
}
