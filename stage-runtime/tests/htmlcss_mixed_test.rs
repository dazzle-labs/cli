//! Mixed HTML/CSS + Canvas2D/WebGL2 rendering tests.
//!
//! Verifies the compositing pipeline: HTML background → WebGL2 → Canvas2D.
//! Also tests external script loading and @font-face support.
//!
//! Run: cargo test --test htmlcss_mixed_test
//! Video: DAZZLE_TEST_VIDEO_DIR=./test_videos cargo test --test htmlcss_mixed_test

mod test_harness;
use test_harness::*;

use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// HTML-only tests (no JS drawing)
// ---------------------------------------------------------------------------

#[test]
fn html_background_renders_solid_color() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("html_bg_solid", 64, 64);

    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; background: #ff0000; }
    </style></head>
    <body></body>
    </html>"#).unwrap();

    // Tick a few frames — HTML bg should persist
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 200, "R should be high, got {:?}", px);
    assert!(px[1] < 20 && px[2] < 20, "G/B should be low, got {:?}", px);
    assert!(px[3] > 200, "A should be high, got {:?}", px);
    rec.finish();
}

#[test]
fn html_styled_div_visible() {
    let mut rt = make_runtime(128, 128);
    let mut rec = FrameRecorder::new("html_styled_div", 128, 128);

    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; padding: 0; background: #000000; }
        .box { width: 64px; height: 64px; background: #00ff00; }
    </style></head>
    <body><div class="box"></div></body>
    </html>"#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    // Top-left corner should be green (the div)
    let px_green = pixel_at(rt.get_framebuffer(), 128, 16, 16);
    assert!(px_green[1] > 200, "should be green, got {:?}", px_green);

    // Bottom-right should be black (body background)
    let px_black = pixel_at(rt.get_framebuffer(), 128, 100, 100);
    assert!(px_black[0] < 20 && px_black[1] < 20 && px_black[2] < 20,
        "should be black, got {:?}", px_black);
    rec.finish();
}

// ---------------------------------------------------------------------------
// HTML + Canvas2D mixed tests
// ---------------------------------------------------------------------------

#[test]
fn html_background_with_canvas2d_overlay() {
    let mut rt = make_runtime(128, 128);
    let mut rec = FrameRecorder::new("html_canvas2d_mixed", 128, 128);

    // Blue HTML background, red Canvas2D rectangle on top
    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; background: #0000ff; }
    </style></head>
    <body>
    <script>
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            // Draw red square in center (32,32)-(96,96)
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(32, 32, 64, 64);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    </script>
    </body>
    </html>"#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    // Canvas2D overwrites the full framebuffer, so we check the canvas output.
    // The center should be red (Canvas2D draws there).
    let px_center = pixel_at(rt.get_framebuffer(), 128, 64, 64);
    assert!(px_center[0] > 200, "center should be red from Canvas2D, got {:?}", px_center);
    rec.finish();
}

#[test]
fn html_background_visible_without_canvas_draw() {
    let mut rt = make_runtime(128, 128);
    let mut rec = FrameRecorder::new("html_bg_no_draw", 128, 128);

    // HTML with gradient-like layout, JS that does NOT draw anything
    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; background: #336699; }
        .header { height: 32px; background: #ff6600; }
        .content { height: 96px; background: #003366; }
    </style></head>
    <body>
        <div class="header"></div>
        <div class="content"></div>
    <script>
        // JS runs but never draws to canvas — HTML bg should show through
        var counter = 0;
        function update() {
            counter++;
            requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    </script>
    </body>
    </html>"#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    // Header area (top) should be orange-ish
    let px_header = pixel_at(rt.get_framebuffer(), 128, 64, 8);
    assert!(px_header[0] > 200, "header R should be high (orange), got {:?}", px_header);
    assert!(px_header[1] > 80, "header G should be medium (orange), got {:?}", px_header);

    // Content area should be dark blue
    let px_content = pixel_at(rt.get_framebuffer(), 128, 64, 60);
    assert!(px_content[2] > 80, "content B should be >0 (dark blue), got {:?}", px_content);
    assert!(px_content[0] < 20, "content R should be low, got {:?}", px_content);
    rec.finish();
}

// ---------------------------------------------------------------------------
// HTML + WebGL2 mixed tests
// ---------------------------------------------------------------------------

#[test]
fn html_background_with_webgl2_overlay() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("html_webgl2_mixed", 64, 64);

    // Green HTML background, WebGL2 clears to magenta
    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; background: #00ff00; }
    </style></head>
    <body>
    <script>
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function draw() {
            gl.clearColor(1.0, 0.0, 1.0, 1.0); // magenta
            gl.clear(gl.COLOR_BUFFER_BIT);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    </script>
    </body>
    </html>"#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    // WebGL2 overwrites the framebuffer, so we should see magenta
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 200, "R should be high (magenta), got {:?}", px);
    assert!(px[1] < 20, "G should be low (magenta), got {:?}", px);
    assert!(px[2] > 200, "B should be high (magenta), got {:?}", px);
    rec.finish();
}

// ---------------------------------------------------------------------------
// HTML + Canvas2D + WebGL2 (full pipeline)
// ---------------------------------------------------------------------------

#[test]
fn html_grid_layout_with_script_counter() {
    let mut rt = make_runtime(256, 256);
    let mut rec = FrameRecorder::new("html_grid_counter", 256, 256);

    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #1a1a2e; font-family: sans-serif; }
        .grid { display: flex; gap: 8px; padding: 16px; }
        .card {
            width: 100px; height: 80px;
            background: #16213e;
            border-radius: 8px;
            padding: 8px;
        }
    </style></head>
    <body>
        <div class="grid">
            <div class="card"></div>
            <div class="card"></div>
        </div>
    <script>
        // Overlay a Canvas2D counter on top of the HTML layout
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var frame = 0;

        function draw() {
            // Draw a small red indicator in the corner to prove Canvas2D is active
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 16, 16);
            frame++;
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    </script>
    </body>
    </html>"#).unwrap();

    for _ in 0..5 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    // The Canvas2D should have drawn a red square in the top-left corner.
    // Canvas2D read_pixels_premultiplied overwrites the framebuffer,
    // but the red rect should be visible at (4, 4).
    let px_red = pixel_at(rt.get_framebuffer(), 256, 4, 4);
    assert!(px_red[0] > 200, "top-left should have red from Canvas2D, got {:?}", px_red);
    rec.finish();
}

#[test]
fn html_background_persists_across_frames() {
    let mut rt = make_runtime(64, 64);

    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; background: #884422; }
    </style></head>
    <body></body>
    </html>"#).unwrap();

    // Run many frames — HTML bg should be stable
    for _ in 0..30 {
        rt.tick();
    }

    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    // #884422 → R=0x88=136, G=0x44=68, B=0x22=34
    assert!((px[0] as i32 - 136).unsigned_abs() < 10, "R should be ~136, got {:?}", px);
    assert!((px[1] as i32 - 68).unsigned_abs() < 10, "G should be ~68, got {:?}", px);
    assert!((px[2] as i32 - 34).unsigned_abs() < 10, "B should be ~34, got {:?}", px);
}

#[test]
fn html_only_no_scripts() {
    let mut rt = make_runtime(128, 64);

    // Pure HTML/CSS, no scripts at all
    rt.load_html(r#"<!DOCTYPE html>
    <html>
    <head><style>
        body { margin: 0; background: #222222; color: white; }
        .banner { height: 32px; background: linear-gradient(135deg, #e94560, #0f3460); }
    </style></head>
    <body>
        <div class="banner"></div>
    </body>
    </html>"#).unwrap();

    for _ in 0..3 {
        rt.tick();
    }

    // Banner area should not be the body background color (#222222 = 34,34,34)
    let px_banner = pixel_at(rt.get_framebuffer(), 128, 64, 8);
    let is_body_bg = px_banner[0] < 40 && px_banner[1] < 40 && px_banner[2] < 40;
    assert!(!is_body_bg, "banner should have gradient, not body bg — got {:?}", px_banner);

    // Below banner should be body bg
    let px_body = pixel_at(rt.get_framebuffer(), 128, 64, 48);
    assert!((px_body[0] as i32 - 34).unsigned_abs() < 10, "body bg R should be ~34, got {:?}", px_body);
}

// ---------------------------------------------------------------------------
// External script loading tests
// ---------------------------------------------------------------------------

fn make_runtime_with_dir(w: u32, h: u32) -> (dazzle_render::runtime::Runtime, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Mutex::new(
        dazzle_render::storage::Storage::new(&dir.path().join("storage.json")).unwrap(),
    ));
    let rt = dazzle_render::runtime::Runtime::new(w, h, 30, store).unwrap();
    (rt, dir)
}

#[test]
fn external_script_src_loads_and_executes() {
    let (mut rt, dir) = make_runtime_with_dir(64, 64);

    // Write an external JS file that draws a red rectangle
    std::fs::write(dir.path().join("draw.js"), r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        function draw() {
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 64, 64);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // HTML references the external script
    let html = r#"<!DOCTYPE html>
    <html>
    <head><style>body { margin: 0; background: #000000; }</style></head>
    <body>
        <script src="draw.js"></script>
    </body>
    </html>"#;

    rt.load_html_with_dir(html, Some(dir.path())).unwrap();

    for _ in 0..3 {
        rt.tick();
    }

    // External script should have drawn red
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 200, "external script should draw red, got {:?}", px);
}

#[test]
fn mixed_inline_and_external_scripts() {
    let (mut rt, dir) = make_runtime_with_dir(64, 64);

    // External script sets a global variable
    std::fs::write(dir.path().join("setup.js"), r#"
        window.__testColor = '#00ff00';
    "#).unwrap();

    // HTML has external script first, then inline script uses it
    let html = r#"<!DOCTYPE html>
    <html>
    <head><style>body { margin: 0; }</style></head>
    <body>
        <script src="setup.js"></script>
        <script>
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            function draw() {
                ctx.fillStyle = window.__testColor || '#ff0000';
                ctx.fillRect(0, 0, 64, 64);
                requestAnimationFrame(draw);
            }
            requestAnimationFrame(draw);
        </script>
    </body>
    </html>"#;

    rt.load_html_with_dir(html, Some(dir.path())).unwrap();

    for _ in 0..3 {
        rt.tick();
    }

    // Should be green (set by external script), not red (fallback)
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[1] > 200, "should be green from external script var, got {:?}", px);
    assert!(px[0] < 20, "R should be low, got {:?}", px);
}

#[test]
fn missing_external_script_doesnt_crash() {
    let (mut rt, dir) = make_runtime_with_dir(64, 64);

    let html = r#"<!DOCTYPE html>
    <html>
    <head><style>body { margin: 0; background: #0000ff; }</style></head>
    <body>
        <script src="nonexistent.js"></script>
        <script>
            // This inline script should still run
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 32, 32);
        </script>
    </body>
    </html>"#;

    // Should not panic even with missing script
    rt.load_html_with_dir(html, Some(dir.path())).unwrap();
    rt.tick();

    // Inline script should have still executed
    let px = pixel_at(rt.get_framebuffer(), 64, 4, 4);
    assert!(px[0] > 200, "inline script should still run despite missing external, got {:?}", px);
}

// ---------------------------------------------------------------------------
// @font-face loading tests
// ---------------------------------------------------------------------------

#[test]
fn font_face_loads_from_content_dir() {
    let (mut rt, dir) = make_runtime_with_dir(256, 64);

    // Copy the embedded DejaVu font to a file in the content dir to simulate a custom font
    // (We use a font we know exists in the binary — the actual rendering test is that
    //  load_font doesn't error and text still renders)
    let font_data = include_bytes!("../src/canvas2d/fonts/DejaVuSans.ttf");
    let fonts_dir = dir.path().join("fonts");
    std::fs::create_dir_all(&fonts_dir).unwrap();
    std::fs::write(fonts_dir.join("CustomFont.ttf"), &font_data[..]).unwrap();

    let html = r#"<!DOCTYPE html>
    <html>
    <head><style>
        @font-face {
            font-family: 'CustomFont';
            src: url('fonts/CustomFont.ttf');
        }
        body { margin: 0; background: #000000; color: white; font-family: 'CustomFont'; }
    </style></head>
    <body>
        <div>Hello Custom Font</div>
    </body>
    </html>"#;

    // Should load the font without errors
    rt.load_html_with_dir(html, Some(dir.path())).unwrap();

    for _ in 0..3 {
        rt.tick();
    }

    // The text "Hello Custom Font" should render — check that some pixels are non-black
    // Scan the full framebuffer since text position depends on layout + font metrics
    let fb = rt.get_framebuffer();
    let has_text = (0..64u32).any(|y| {
        (0..256u32).any(|x| {
            let px = pixel_at(fb, 256, x, y);
            px[0] > 100 || px[1] > 100 || px[2] > 100
        })
    });
    assert!(has_text, "text should render with custom font");
}

#[test]
fn font_face_missing_file_doesnt_crash() {
    let (mut rt, dir) = make_runtime_with_dir(128, 64);

    let html = r#"<!DOCTYPE html>
    <html>
    <head><style>
        @font-face {
            font-family: 'MissingFont';
            src: url('fonts/doesnt_exist.ttf');
        }
        body { margin: 0; background: #0000ff; font-family: 'MissingFont', sans-serif; }
    </style></head>
    <body><div>Fallback text</div></body>
    </html>"#;

    // Should not panic
    rt.load_html_with_dir(html, Some(dir.path())).unwrap();
    rt.tick();

    // Background should still render (blue)
    let px = pixel_at(rt.get_framebuffer(), 128, 64, 48);
    assert!(px[2] > 200, "background should still render despite missing font, got {:?}", px);
}
