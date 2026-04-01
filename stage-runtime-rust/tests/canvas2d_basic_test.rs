//! Canvas 2D basic rendering tests: JS in V8 → Canvas2D polyfill → software raster → framebuffer.
//!
//! Run: cargo test --test canvas2d_basic_test
//! Video: DAZZLE_TEST_VIDEO_DIR=./test_videos cargo test --test canvas2d_basic_test

mod test_harness;
use test_harness::*;

#[test]
fn fill_rect_solid_color() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("fill_rect_solid", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 64, 64);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 240, "should be red, got {:?}", px);
    assert!(px[1] < 10 && px[2] < 10, "G/B should be ~0, got {:?}", px);
    rec.finish();
}

#[test]
fn clear_rect() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("clear_rect", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            // Fill everything blue
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(0, 0, 64, 64);
            // Clear the center
            ctx.clearRect(16, 16, 32, 32);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    // Corner should be blue
    let px_corner = pixel_at(fb, 64, 4, 4);
    assert!(px_corner[2] > 240, "corner should be blue, got {:?}", px_corner);

    // Center should be cleared (transparent → composited as white or black depending on pipeline)
    let px_center = pixel_at(fb, 64, 32, 32);
    assert!(px_center[2] < 10, "center B should be cleared, got {:?}", px_center);
    assert!(px_center[3] < 10, "center alpha should be 0, got {:?}", px_center);
    rec.finish();
}

#[test]
fn multiple_colored_rects() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("multiple_rects", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.clearRect(0, 0, 64, 64);

            // Red top-left quadrant
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 32, 32);

            // Green top-right quadrant
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(32, 0, 32, 32);

            // Blue bottom-left quadrant
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(0, 32, 32, 32);

            // Yellow bottom-right quadrant
            ctx.fillStyle = '#ffff00';
            ctx.fillRect(32, 32, 32, 32);

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    let tl = pixel_at(fb, 64, 8, 8);
    let tr = pixel_at(fb, 64, 48, 8);
    let bl = pixel_at(fb, 64, 8, 48);
    let br = pixel_at(fb, 64, 48, 48);

    assert!(tl[0] > 240 && tl[1] < 10, "top-left should be red, got {:?}", tl);
    assert!(tr[1] > 240 && tr[0] < 10, "top-right should be green, got {:?}", tr);
    assert!(bl[2] > 240 && bl[0] < 10, "bottom-left should be blue, got {:?}", bl);
    assert!(br[0] > 240 && br[1] > 240 && br[2] < 10, "bottom-right should be yellow, got {:?}", br);
    rec.finish();
}

#[test]
fn global_alpha() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("global_alpha", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.clearRect(0, 0, 64, 64);

            // Full opacity red
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 32, 64);

            // 50% opacity red
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(32, 0, 32, 64);

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    let px_full = pixel_at(fb, 64, 16, 32);
    let px_half = pixel_at(fb, 64, 48, 32);

    assert!(px_full[0] > 240, "left should be full red, got {:?}", px_full);
    assert!(px_full[3] > 240, "left alpha should be ~255, got {:?}", px_full);
    // 50% alpha red: R should be ~128 premultiplied, alpha ~128
    assert!(px_half[0] > 100 && px_half[0] < 180, "right R should be ~128, got {:?}", px_half);
    assert!(px_half[3] > 100 && px_half[3] < 180, "right alpha should be ~128, got {:?}", px_half);
    rec.finish();
}

#[test]
fn save_restore_state() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("save_restore", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.clearRect(0, 0, 64, 64);

            // Set fill to red and save
            ctx.fillStyle = '#ff0000';
            ctx.save();

            // Change to green and draw top half
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(0, 0, 64, 32);

            // Restore → back to red, draw bottom half
            ctx.restore();
            ctx.fillRect(0, 32, 64, 32);

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    let px_top = pixel_at(fb, 64, 32, 8);
    let px_bottom = pixel_at(fb, 64, 32, 48);

    assert!(px_top[1] > 240 && px_top[0] < 10, "top should be green, got {:?}", px_top);
    assert!(px_bottom[0] > 240 && px_bottom[1] < 10, "bottom should be red (restored), got {:?}", px_bottom);
    rec.finish();
}

#[test]
fn translate_transform() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("translate", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.clearRect(0, 0, 64, 64);

            // Draw a 10x10 red square at (20, 20) via translate
            ctx.save();
            ctx.translate(20, 20);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 10, 10);
            ctx.restore();

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    // Inside the translated rect
    let px_inside = pixel_at(fb, 64, 25, 25);
    // Outside
    let px_outside = pixel_at(fb, 64, 5, 5);

    assert!(px_inside[0] > 240, "translated rect should be red, got {:?}", px_inside);
    assert!(px_outside[0] < 10 && px_outside[3] < 10, "outside should be clear, got {:?}", px_outside);
    rec.finish();
}

#[test]
fn path_fill() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("path_fill", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.clearRect(0, 0, 64, 64);

            // Draw a filled triangle
            ctx.fillStyle = '#00ff00';
            ctx.beginPath();
            ctx.moveTo(32, 4);
            ctx.lineTo(60, 60);
            ctx.lineTo(4, 60);
            ctx.closePath();
            ctx.fill();

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    // Center of the triangle should be green
    let px_center = pixel_at(fb, 64, 32, 40);
    // Top-left corner should be clear (outside triangle)
    let px_outside = pixel_at(fb, 64, 2, 2);

    assert!(px_center[1] > 200, "triangle center should be green, got {:?}", px_center);
    assert!(px_outside[3] < 10, "outside triangle should be clear, got {:?}", px_outside);
    rec.finish();
}

// =============================================================================
// getImageData tests
// =============================================================================

#[test]
fn get_image_data_reads_pixels() {
    let mut rt = make_runtime(64, 64);

    // Draw a red rect, then immediately call getImageData in the same frame.
    // getImageData must flush pending commands and return correct pixel data.
    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var result = { r: 0, g: 0, b: 0, a: 0 };

        function draw() {
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 64, 64);

            // getImageData should flush and read back the red fill
            var imgData = ctx.getImageData(32, 32, 1, 1);
            result.r = imgData.data[0];
            result.g = imgData.data[1];
            result.b = imgData.data[2];
            result.a = imgData.data[3];

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let result_str = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(result_str).unwrap();
    assert_eq!(result["r"], 255, "red channel should be 255, got {}", result["r"]);
    assert!(result["g"].as_u64().unwrap() < 10, "green should be ~0, got {}", result["g"]);
    assert!(result["b"].as_u64().unwrap() < 10, "blue should be ~0, got {}", result["b"]);
    assert_eq!(result["a"], 255, "alpha should be 255, got {}", result["a"]);
}

#[test]
fn get_image_data_partial_rect() {
    let mut rt = make_runtime(64, 64);

    // Draw two colors, read back a region spanning both
    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var result = {};

        function draw() {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 32, 64);
            ctx.fillStyle = '#0000ff';
            ctx.fillRect(32, 0, 32, 64);

            // Read a 2x1 region crossing the boundary
            var imgData = ctx.getImageData(31, 32, 2, 1);
            result.left_r = imgData.data[0];
            result.left_b = imgData.data[2];
            result.right_r = imgData.data[4];
            result.right_b = imgData.data[6];

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let result_str = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(result_str).unwrap();
    // Left pixel (x=31) should be red
    assert!(result["left_r"].as_u64().unwrap() > 240, "left should be red");
    assert!(result["left_b"].as_u64().unwrap() < 10, "left should have no blue");
    // Right pixel (x=32) should be blue
    assert!(result["right_r"].as_u64().unwrap() < 10, "right should have no red");
    assert!(result["right_b"].as_u64().unwrap() > 240, "right should be blue");
}

// =============================================================================
// drawImage tests
// =============================================================================

/// Create a 4x4 red PNG in memory and write it to a temp dir.
fn create_test_png(dir: &std::path::Path, filename: &str, r: u8, g: u8, b: u8, w: u32, h: u32) {
    use std::io::Write;
    let path = dir.join(filename);
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        let mut data = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..w * h {
            data.extend_from_slice(&[r, g, b, 255]);
        }
        writer.write_image_data(&data).unwrap();
    }
    std::fs::write(&path, &buf).unwrap();
}

#[test]
fn draw_image_basic() {
    let content_dir = tempfile::tempdir().unwrap();
    create_test_png(content_dir.path(), "red.png", 255, 0, 0, 4, 4);

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var img = new Image();
        img.onload = function() {
            // Draw the 4x4 red image at (10, 10)
            ctx.drawImage(img, 10, 10);
        };
        img.src = 'red.png';
    "#).unwrap();

    // Frame 1: JS sets img.src → pushes load request
    rt.tick();
    // Frame 2: Rust loaded image, fires onload → drawImage called
    rt.tick();
    // Frame 3: drawImage command processed and rendered
    rt.tick();

    let fb = rt.get_framebuffer();
    // Pixel at (12, 12) should be red (inside the 4x4 image drawn at 10,10)
    let px = pixel_at(fb, 64, 12, 12);
    assert!(px[0] > 240, "should be red, got {:?}", px);
    assert!(px[3] > 240, "should be opaque, got {:?}", px);

    // Pixel at (0, 0) should be transparent (outside image)
    let px0 = pixel_at(fb, 64, 0, 0);
    assert!(px0[3] < 10, "should be transparent, got {:?}", px0);
}

#[test]
fn draw_image_scaled() {
    let content_dir = tempfile::tempdir().unwrap();
    create_test_png(content_dir.path(), "green.png", 0, 255, 0, 2, 2);

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var img = new Image();
        img.onload = function() {
            // Draw 2x2 green image scaled to 32x32 at (0, 0)
            ctx.drawImage(img, 0, 0, 32, 32);
        };
        img.src = 'green.png';
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let fb = rt.get_framebuffer();
    // Center of the scaled image should be green
    let px = pixel_at(fb, 64, 16, 16);
    assert!(px[1] > 240, "should be green, got {:?}", px);
    assert!(px[3] > 240, "should be opaque, got {:?}", px);

    // Outside the 32x32 area should be transparent
    let px_out = pixel_at(fb, 64, 48, 48);
    assert!(px_out[3] < 10, "should be transparent, got {:?}", px_out);
}

#[test]
fn draw_image_source_rect() {
    let content_dir = tempfile::tempdir().unwrap();
    // Create a 4x4 image: top-left 2x2 = blue, rest = black
    {
        use std::io::Write;
        let path = content_dir.path().join("quad.png");
        let mut buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut buf, 4, 4);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            let mut data = vec![0u8; 4 * 4 * 4];
            // Top-left 2x2 = blue
            for row in 0..2u32 {
                for col in 0..2u32 {
                    let i = ((row * 4 + col) * 4) as usize;
                    data[i] = 0; data[i+1] = 0; data[i+2] = 255; data[i+3] = 255;
                }
            }
            writer.write_image_data(&data).unwrap();
        }
        std::fs::write(&path, &buf).unwrap();
    }

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var img = new Image();
        img.onload = function() {
            // Draw only the top-left 2x2 (blue) portion, scaled to 32x32
            ctx.drawImage(img, 0, 0, 2, 2, 0, 0, 32, 32);
        };
        img.src = 'quad.png';
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let fb = rt.get_framebuffer();
    let px = pixel_at(fb, 64, 16, 16);
    assert!(px[2] > 240, "should be blue, got {:?}", px);
    assert!(px[3] > 240, "should be opaque, got {:?}", px);
}

#[test]
fn draw_image_width_height_set_on_load() {
    let content_dir = tempfile::tempdir().unwrap();
    create_test_png(content_dir.path(), "sized.png", 128, 128, 128, 16, 8);

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var result = { w: 0, h: 0, nw: 0, nh: 0, complete: false };
        var img = new Image();
        img.onload = function() {
            result.w = img.width;
            result.h = img.height;
            result.nw = img.naturalWidth;
            result.nh = img.naturalHeight;
            result.complete = img.complete;
        };
        img.src = 'sized.png';
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let result_str = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(result_str).unwrap();
    assert_eq!(result["w"], 16);
    assert_eq!(result["h"], 8);
    assert_eq!(result["nw"], 16);
    assert_eq!(result["nh"], 8);
    assert_eq!(result["complete"], true);
}

// =============================================================================
// Canvas 2D spec completeness tests
// =============================================================================

#[test]
fn canvas2d_roundrect_draws_rounded_shape() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        function draw() {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.roundRect(8, 8, 48, 48, 10);
            ctx.fill();
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let fb = rt.get_framebuffer();
    // Center should be red (inside rounded rect)
    let px = pixel_at(fb, 64, 32, 32);
    assert!(px[0] > 240, "center should be red, got {:?}", px);
    // Corner (0,0) should be transparent (outside rounded rect)
    let px_corner = pixel_at(fb, 64, 1, 1);
    assert!(px_corner[3] < 30, "corner should be transparent, got {:?}", px_corner);
    // Just inside the corner radius area (9,9) — for radius=10 from (8,8), the corner
    // arc clips here, so it may or may not be filled depending on curve
}

#[test]
fn canvas2d_reset_clears_state() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var result = {};

        function draw() {
            // Set non-default state
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 64, 64);
            ctx.globalAlpha = 0.5;
            ctx.font = '20px serif';

            // Reset should clear everything
            ctx.reset();

            result.fillStyle = ctx.fillStyle;
            result.globalAlpha = ctx.globalAlpha;
            result.font = ctx.font;

            // After reset, pixmap should be cleared
            var img = ctx.getImageData(32, 32, 1, 1);
            result.r = img.data[0];
            result.a = img.data[3];

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["fillStyle"], "#000000", "fillStyle should reset");
    assert_eq!(result["globalAlpha"], 1.0, "globalAlpha should reset");
    assert_eq!(result["font"], "10px sans-serif", "font should reset");
    assert_eq!(result["a"], 0, "pixmap should be cleared");
}

#[test]
fn canvas2d_new_methods_exist() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var result = {
            roundRect: typeof ctx.roundRect,
            reset: typeof ctx.reset,
            isContextLost: typeof ctx.isContextLost,
            getContextAttributes: typeof ctx.getContextAttributes,
            createConicGradient: typeof ctx.createConicGradient,
            isContextLostVal: ctx.isContextLost(),
            contextAttrs: JSON.stringify(ctx.getContextAttributes()),
        };
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["roundRect"], "function");
    assert_eq!(result["reset"], "function");
    assert_eq!(result["isContextLost"], "function");
    assert_eq!(result["getContextAttributes"], "function");
    assert_eq!(result["createConicGradient"], "function");
    assert_eq!(result["isContextLostVal"], false);
}

#[test]
fn canvas2d_new_properties_exist() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var result = {
            direction: ctx.direction,
            filter: ctx.filter,
            imageSmoothingQuality: ctx.imageSmoothingQuality,
            letterSpacing: ctx.letterSpacing,
            wordSpacing: ctx.wordSpacing,
            fontKerning: ctx.fontKerning,
            fontStretch: ctx.fontStretch,
            fontVariantCaps: ctx.fontVariantCaps,
            textRendering: ctx.textRendering,
        };
        // Verify setters work
        ctx.direction = 'rtl';
        ctx.filter = 'blur(5px)';
        result.directionAfter = ctx.direction;
        result.filterAfter = ctx.filter;
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["direction"], "ltr");
    assert_eq!(result["filter"], "none");
    assert_eq!(result["imageSmoothingQuality"], "low");
    assert_eq!(result["letterSpacing"], "0px");
    assert_eq!(result["fontKerning"], "auto");
    assert_eq!(result["directionAfter"], "rtl");
    assert_eq!(result["filterAfter"], "blur(5px)");
}

// =============================================================================
// Polyfill / browser environment tests
// =============================================================================

#[test]
fn polyfill_localstorage() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        localStorage.setItem('key1', 'value1');
        localStorage.setItem('key2', 'value2');
        var result = {
            get1: localStorage.getItem('key1'),
            get2: localStorage.getItem('key2'),
            missing: localStorage.getItem('nope'),
            length: localStorage.length,
        };
        localStorage.removeItem('key1');
        result.afterRemove = localStorage.getItem('key1');
        result.lengthAfter = localStorage.length;
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["get1"], "value1");
    assert_eq!(result["get2"], "value2");
    assert!(result["missing"].is_null());
    assert_eq!(result["length"], 2);
    assert!(result["afterRemove"].is_null());
    assert_eq!(result["lengthAfter"], 1);
}

#[test]
fn polyfill_browser_apis_exist() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = {
            // Core APIs
            fetch: typeof fetch,
            Headers: typeof Headers,
            Request: typeof Request,
            Response: typeof Response,
            XMLHttpRequest: typeof XMLHttpRequest,
            // DOM
            MutationObserver: typeof MutationObserver,
            ResizeObserver: typeof ResizeObserver,
            IntersectionObserver: typeof IntersectionObserver,
            // Scheduling
            requestIdleCallback: typeof requestIdleCallback,
            queueMicrotask: typeof queueMicrotask,
            // Storage
            localStorage: typeof localStorage,
            sessionStorage: typeof sessionStorage,
            // Comms
            WebSocket: typeof WebSocket,
            Worker: typeof Worker,
            MessageChannel: typeof MessageChannel,
            // Data
            Blob: typeof Blob,
            File: typeof File,
            FormData: typeof FormData,
            URL: typeof URL,
            URLSearchParams: typeof URLSearchParams,
            // Crypto
            crypto: typeof crypto,
            cryptoRandom: typeof crypto.getRandomValues,
            cryptoUUID: typeof crypto.randomUUID,
            // Abort
            AbortController: typeof AbortController,
            AbortSignal: typeof AbortSignal,
            // Clone
            structuredClone: typeof structuredClone,
            // DOM types
            HTMLElement: typeof HTMLElement,
            Node: typeof Node,
            Element: typeof Element,
            DocumentFragment: typeof DocumentFragment,
            DOMException: typeof DOMException,
            // Events
            CustomEvent: typeof CustomEvent,
            KeyboardEvent: typeof KeyboardEvent,
            MouseEvent: typeof MouseEvent,
            PointerEvent: typeof PointerEvent,
            // History
            historyPush: typeof history.pushState,
            // Document
            createFragment: typeof document.createDocumentFragment,
            createComment: typeof document.createComment,
        };
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();

    let expected_functions = [
        "fetch", "Headers", "Request", "Response", "XMLHttpRequest",
        "MutationObserver", "ResizeObserver", "IntersectionObserver",
        "requestIdleCallback", "queueMicrotask",
        "WebSocket", "Worker", "MessageChannel",
        "Blob", "File", "FormData", "URL", "URLSearchParams",
        "AbortController", "AbortSignal",
        "structuredClone",
        "HTMLElement", "Element", "DocumentFragment", "DOMException",
        "CustomEvent", "KeyboardEvent", "MouseEvent", "PointerEvent",
        "historyPush", "createFragment", "createComment",
        "cryptoRandom", "cryptoUUID",
    ];
    for name in expected_functions {
        assert_eq!(result[name], "function", "{} should be 'function', got {:?}", name, result[name]);
    }
    assert_eq!(result["localStorage"], "object");
    assert_eq!(result["sessionStorage"], "object");
    assert_eq!(result["crypto"], "object");
    assert_eq!(result["Node"], "object");
}

#[test]
fn polyfill_dom_element_features() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        div.classList.add('foo', 'bar');
        var result = {
            hasFoo: div.classList.contains('foo'),
            hasBar: div.classList.contains('bar'),
            classStr: div.classList.toString(),
            nodeType: div.nodeType,
        };
        div.classList.remove('foo');
        result.afterRemove = div.classList.contains('foo');
        result.toggle = div.classList.toggle('baz');
        result.hasBaz = div.classList.contains('baz');

        // Test parent/child relationships
        var child = document.createElement('span');
        div.appendChild(child);
        result.parentNode = child.parentNode === div;
        result.parentElement = child.parentElement === div;
        result.contains = div.contains(child);

        // Test createDocumentFragment
        var frag = document.createDocumentFragment();
        result.fragType = frag.nodeType;

        // Test createComment
        var comment = document.createComment('test');
        result.commentType = comment.nodeType;
        result.commentText = comment.textContent;

        // Test hasAttribute/removeAttribute
        div.setAttribute('data-x', '42');
        result.hasAttr = div.hasAttribute('data-x');
        result.getAttr = div.getAttribute('data-x');
        div.removeAttribute('data-x');
        result.hasAttrAfter = div.hasAttribute('data-x');

        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasFoo"], true);
    assert_eq!(result["hasBar"], true);
    assert_eq!(result["classStr"], "foo bar");
    assert_eq!(result["nodeType"], 1);
    assert_eq!(result["afterRemove"], false);
    assert_eq!(result["toggle"], true);
    assert_eq!(result["hasBaz"], true);
    assert_eq!(result["parentNode"], true);
    assert_eq!(result["parentElement"], true);
    assert_eq!(result["contains"], true);
    assert_eq!(result["fragType"], 11);
    assert_eq!(result["commentType"], 8);
    assert_eq!(result["commentText"], "test");
    assert_eq!(result["hasAttr"], true);
    assert_eq!(result["getAttr"], "42");
    assert_eq!(result["hasAttrAfter"], false);
}

#[test]
fn polyfill_url_parsing() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var u = new URL('https://example.com:8080/path?q=1#frag');
        var result = {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port,
            pathname: u.pathname,
            search: u.search,
            hash: u.hash,
            origin: u.origin,
        };
        // URLSearchParams
        var sp = new URLSearchParams('?a=1&b=2');
        result.spA = sp.get('a');
        result.spB = sp.get('b');
        result.spHas = sp.has('a');
        result.spMissing = sp.get('nope');

        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["protocol"], "https:");
    assert_eq!(result["hostname"], "example.com");
    assert_eq!(result["port"], "8080");
    assert_eq!(result["pathname"], "/path");
    assert_eq!(result["search"], "?q=1");
    assert_eq!(result["hash"], "#frag");
    assert_eq!(result["spA"], "1");
    assert_eq!(result["spB"], "2");
    assert_eq!(result["spHas"], true);
    assert!(result["spMissing"].is_null());
}

#[test]
fn polyfill_crypto_random() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        var nonZero = 0;
        for (var i = 0; i < arr.length; i++) if (arr[i] !== 0) nonZero++;
        var uuid = crypto.randomUUID();
        globalThis.__testResult = {
            nonZero: nonZero,
            uuidLen: uuid.length,
            uuidDashes: uuid.split('-').length,
        };
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    // At least some bytes should be non-zero (probabilistically guaranteed)
    assert!(result["nonZero"].as_u64().unwrap() > 0, "some random bytes should be non-zero");
    assert_eq!(result["uuidLen"], 36, "UUID should be 36 chars");
    assert_eq!(result["uuidDashes"], 5, "UUID should have 5 segments");
}

#[test]
fn polyfill_mutation_observer() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = { calls: 0, type: '', addedCount: 0, attrName: '' };
        var div = document.createElement('div');
        var obs = new MutationObserver(function(records) {
            for (var i = 0; i < records.length; i++) {
                result.calls++;
                result.type = records[i].type;
                if (records[i].addedNodes) result.addedCount += records[i].addedNodes.length;
                if (records[i].attributeName) result.attrName = records[i].attributeName;
            }
        });
        obs.observe(div, { childList: true, attributes: true, subtree: false });

        // Trigger childList mutation
        var child = document.createElement('span');
        div.appendChild(child);

        // Trigger attribute mutation
        div.setAttribute('data-x', '1');

        globalThis.__testResult = result;
    "#).unwrap();

    // MutationObserver fires via queueMicrotask → needs tick to process
    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert!(result["calls"].as_u64().unwrap() >= 2, "should have at least 2 mutation calls, got {}", result["calls"]);
    assert_eq!(result["attrName"], "data-x");
}

#[test]
fn polyfill_resize_observer() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = { called: false, width: 0, height: 0 };
        var canvas = document.createElement('canvas');
        var obs = new ResizeObserver(function(entries) {
            result.called = true;
            if (entries.length > 0) {
                result.width = entries[0].contentRect.width;
                result.height = entries[0].contentRect.height;
            }
        });
        obs.observe(canvas);
        globalThis.__testResult = result;
    "#).unwrap();

    // ResizeObserver fires via queueMicrotask
    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["called"], true, "ResizeObserver should fire");
    assert!(result["width"].as_f64().unwrap() > 0.0, "should have non-zero width");
}

#[test]
fn polyfill_intersection_observer() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = { called: false, intersecting: false, ratio: 0 };
        var div = document.createElement('div');
        var obs = new IntersectionObserver(function(entries) {
            result.called = true;
            if (entries.length > 0) {
                result.intersecting = entries[0].isIntersecting;
                result.ratio = entries[0].intersectionRatio;
            }
        });
        obs.observe(div);
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["called"], true, "IntersectionObserver should fire");
    assert_eq!(result["intersecting"], true, "everything should be intersecting");
    assert_eq!(result["ratio"], 1.0);
}

#[test]
fn polyfill_message_channel() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = { received: false, data: null };
        var mc = new MessageChannel();
        mc.port2.onmessage = function(e) {
            result.received = true;
            result.data = e.data;
        };
        mc.port1.postMessage('hello');
        globalThis.__testResult = result;
    "#).unwrap();

    // MessageChannel uses setTimeout internally, need a few ticks
    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["received"], true);
    assert_eq!(result["data"], "hello");
}

#[test]
fn canvas_to_data_url() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 64, 64);

        var result = { dataUrl: canvas.toDataURL() };
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    let data_url = result["dataUrl"].as_str().unwrap();
    assert!(data_url.starts_with("data:image/png;base64,"), "should be a PNG data URI, got: {}...", &data_url[..40.min(data_url.len())]);
    assert!(data_url.len() > 100, "data URI should have substantial content, got len={}", data_url.len());
}

#[test]
fn fetch_local_file() {
    let content_dir = tempfile::tempdir().unwrap();
    std::fs::write(content_dir.path().join("data.json"), r#"{"hello":"world"}"#).unwrap();

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var result = { status: 0, body: '', error: '' };
        fetch('data.json').then(function(resp) {
            result.status = resp.status;
            return resp.json();
        }).then(function(data) {
            result.body = data.hello;
        }).catch(function(e) {
            result.error = e.message || String(e);
        });
        globalThis.__testResult = result;
    "#).unwrap();

    // tick 1: JS runs, fetch queued
    // tick 2: fetch drained, promise resolved
    // tick 3: .then() runs
    for _ in 0..5 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["status"], 200);
    assert_eq!(result["body"], "world");
    assert_eq!(result["error"], "");
}

#[test]
fn fetch_missing_file_rejects() {
    let content_dir = tempfile::tempdir().unwrap();

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var result = { caught: false, message: '' };
        fetch('nonexistent.json').then(function(resp) {
            result.caught = false;
        }).catch(function(e) {
            result.caught = true;
            result.message = e.message || String(e);
        });
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..5 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["caught"], true);
    assert!(result["message"].as_str().unwrap().contains("not found") || result["message"].as_str().unwrap().contains("No such file"),
        "error should mention file not found, got: {}", result["message"]);
}

#[test]
fn polyfill_match_media() {
    // Use 64x64 viewport — innerWidth/innerHeight = 64
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = {
            light: matchMedia('(prefers-color-scheme: light)').matches,
            dark: matchMedia('(prefers-color-scheme: dark)').matches,
            minW: matchMedia('(min-width: 32px)').matches,
            minWFail: matchMedia('(min-width: 100px)').matches,
            maxW: matchMedia('(max-width: 100px)').matches,
            noMotion: matchMedia('(prefers-reduced-motion: no-preference)').matches,
            // 64x64 is square, not landscape
            square: matchMedia('(orientation: landscape)').matches,
        };
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["light"], true, "should match prefers-color-scheme: light");
    assert_eq!(result["dark"], false, "should not match dark");
    assert_eq!(result["minW"], true, "64 >= 32");
    assert_eq!(result["minWFail"], false, "64 < 100");
    assert_eq!(result["maxW"], true, "64 <= 100");
    assert_eq!(result["noMotion"], true);
    assert_eq!(result["square"], false, "64x64 square is not landscape (w > h)");
}

#[test]
fn polyfill_get_computed_style() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        div.style.color = 'red';
        div.style.fontSize = '24px';
        var cs = getComputedStyle(div);
        var result = {
            color: cs.color,
            fontSize: cs.fontSize,
            display: cs.display,
            getProperty: cs.getPropertyValue('color'),
        };
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["color"], "red", "should reflect inline style");
    assert_eq!(result["fontSize"], "24px", "should reflect inline style");
    assert_eq!(result["display"], "block", "should return default");
    assert_eq!(result["getProperty"], "red");
}

#[test]
fn polyfill_query_selector_by_class_and_tag() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var container = document.createElement('div');
        container.id = 'root';
        document.body.appendChild(container);

        var child1 = document.createElement('span');
        child1.classList.add('foo');
        container.appendChild(child1);

        var child2 = document.createElement('div');
        child2.classList.add('bar');
        container.appendChild(child2);

        var child3 = document.createElement('span');
        child3.classList.add('foo');
        container.appendChild(child3);

        var result = {
            byId: document.querySelector('#root') === container,
            byClass: document.querySelector('.foo') === child1,
            byTag: document.querySelector('div') === container,
            allByClass: document.querySelectorAll('.foo').length,
            allByTag: document.querySelectorAll('span').length,
            containerQuery: container.querySelector('.bar') === child2,
            getElementsByClass: document.getElementsByClassName('foo').length,
        };
        globalThis.__testResult = result;
    "#).unwrap();

    rt.tick();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["byId"], true);
    assert_eq!(result["byClass"], true);
    assert_eq!(result["byTag"], true);
    assert_eq!(result["allByClass"], 2);
    assert_eq!(result["allByTag"], 2);
    assert_eq!(result["containerQuery"], true);
    assert_eq!(result["getElementsByClass"], 2);
}

#[test]
fn polyfill_reactive_style_triggers_mutation() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var result = { mutations: 0, attrName: '' };
        var div = document.createElement('div');
        var obs = new MutationObserver(function(records) {
            for (var i = 0; i < records.length; i++) {
                result.mutations++;
                result.attrName = records[i].attributeName || '';
            }
        });
        obs.observe(div, { attributes: true });

        // Setting style property should trigger attribute mutation
        div.style.color = 'red';
        div.style.transform = 'translateX(10px)';

        // Test cssText
        result.cssText = div.style.cssText;

        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert!(result["mutations"].as_u64().unwrap() >= 2, "should have at least 2 style mutations, got {}", result["mutations"]);
    assert_eq!(result["attrName"], "style");
    let css_text = result["cssText"].as_str().unwrap();
    assert!(css_text.contains("color"), "cssText should contain color, got: {}", css_text);
    assert!(css_text.contains("transform"), "cssText should contain transform, got: {}", css_text);
}

#[test]
fn element_event_listeners() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        var result = { clicks: 0, customs: 0, onceCount: 0 };

        // Regular listener
        div.addEventListener('click', function(e) { result.clicks++; });

        // Once listener
        div.addEventListener('test', function() { result.onceCount++; }, { once: true });

        // Custom event
        div.addEventListener('custom', function(e) { result.customs++; });

        div.dispatchEvent(new Event('click'));
        div.dispatchEvent(new Event('click'));
        div.dispatchEvent(new Event('test'));
        div.dispatchEvent(new Event('test')); // should not fire (once)
        div.dispatchEvent(new CustomEvent('custom', { detail: 42 }));

        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["clicks"], 2, "should have 2 clicks");
    assert_eq!(result["onceCount"], 1, "once listener should fire once");
    assert_eq!(result["customs"], 1, "custom event should fire");
}

#[test]
fn dom_tree_bookkeeping() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var parent = document.createElement('div');
        var a = document.createElement('span');
        var b = document.createElement('span');
        var c = document.createElement('span');

        parent.appendChild(a);
        parent.appendChild(b);
        parent.appendChild(c);

        var result = {};
        result.firstChildIsA = parent.firstChild === a;
        result.lastChildIsC = parent.lastChild === c;
        result.aPrev = a.previousSibling === null;
        result.aNext = a.nextSibling === b;
        result.bPrev = b.previousSibling === a;
        result.bNext = b.nextSibling === c;
        result.cPrev = c.previousSibling === b;
        result.cNext = c.nextSibling === null;
        result.childCount = parent.childNodes.length;

        // Remove middle child
        parent.removeChild(b);
        result.afterRemoveFirst = parent.firstChild === a;
        result.afterRemoveLast = parent.lastChild === c;
        result.aNextAfterRemove = a.nextSibling === c;
        result.cPrevAfterRemove = c.previousSibling === a;
        result.bOrphaned = b.parentNode === null && b.nextSibling === null && b.previousSibling === null;

        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["firstChildIsA"], true);
    assert_eq!(result["lastChildIsC"], true);
    assert_eq!(result["aPrev"], true);
    assert_eq!(result["aNext"], true);
    assert_eq!(result["bPrev"], true);
    assert_eq!(result["bNext"], true);
    assert_eq!(result["cPrev"], true);
    assert_eq!(result["cNext"], true);
    assert_eq!(result["childCount"], 3);
    assert_eq!(result["afterRemoveFirst"], true);
    assert_eq!(result["afterRemoveLast"], true);
    assert_eq!(result["aNextAfterRemove"], true);
    assert_eq!(result["cPrevAfterRemove"], true);
    assert_eq!(result["bOrphaned"], true);
}

#[test]
fn element_remove() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var parent = document.createElement('div');
        var child = document.createElement('span');
        parent.appendChild(child);
        child.remove();
        globalThis.__testResult = {
            parentChildCount: parent.childNodes.length,
            childParent: child.parentNode === null
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["parentChildCount"], 0);
    assert_eq!(result["childParent"], true);
}

#[test]
fn dataset_property() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        div.dataset.fooBar = 'hello';
        div.dataset.count = '42';

        globalThis.__testResult = {
            fooBar: div.dataset.fooBar,
            count: div.dataset.count,
            attr: div.getAttribute('data-foo-bar'),
            attrCount: div.getAttribute('data-count')
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["fooBar"], "hello");
    assert_eq!(result["count"], "42");
    assert_eq!(result["attr"], "hello");
    assert_eq!(result["attrCount"], "42");
}

#[test]
fn path2d_fill_stroke() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("path2d_fill", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var path = new Path2D();
        path.rect(0, 0, 64, 64);

        function draw() {
            ctx.fillStyle = '#00ff00';
            ctx.fill(path);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[1] > 240, "should be green, got {:?}", px);
    assert!(px[0] < 10 && px[2] < 10, "R/B should be ~0, got {:?}", px);
    rec.finish();
}

#[test]
fn path2d_addpath() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var p1 = new Path2D();
        p1.moveTo(0, 0);
        p1.lineTo(10, 10);

        var p2 = new Path2D();
        p2.moveTo(20, 20);
        p2.lineTo(30, 30);

        var combined = new Path2D();
        combined.addPath(p1);
        combined.addPath(p2);

        globalThis.__testResult = { cmdCount: combined._cmds.length };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["cmdCount"], 4, "combined path should have 4 commands");
}

#[test]
fn offscreen_canvas_exists() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var oc = new OffscreenCanvas(100, 100);
        globalThis.__testResult = {
            hasOffscreenCanvas: typeof OffscreenCanvas === 'function',
            width: oc.width,
            height: oc.height,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasOffscreenCanvas"], true);
    assert_eq!(result["width"], 100);
    assert_eq!(result["height"], 100);
}

#[test]
fn navigator_extensions() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        globalThis.__testResult = {
            onLine: navigator.onLine,
            cookieEnabled: navigator.cookieEnabled,
            hasClipboard: typeof navigator.clipboard === 'object',
            hasMediaDevices: typeof navigator.mediaDevices === 'object',
            hasSendBeacon: typeof navigator.sendBeacon === 'function',
            hasPermissions: typeof navigator.permissions === 'object',
            hasConnection: typeof navigator.connection === 'object',
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["onLine"], true);
    assert_eq!(result["cookieEnabled"], true);
    assert_eq!(result["hasClipboard"], true);
    assert_eq!(result["hasMediaDevices"], true);
    assert_eq!(result["hasSendBeacon"], true);
    assert_eq!(result["hasPermissions"], true);
    assert_eq!(result["hasConnection"], true);
}

#[test]
fn window_scroll_apis() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        globalThis.__testResult = {
            hasScrollTo: typeof window.scrollTo === 'function',
            hasScroll: typeof window.scroll === 'function',
            hasScrollBy: typeof window.scrollBy === 'function',
            pageXOffset: window.pageXOffset,
            pageYOffset: window.pageYOffset,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasScrollTo"], true);
    assert_eq!(result["hasScroll"], true);
    assert_eq!(result["hasScrollBy"], true);
    assert_eq!(result["pageXOffset"], 0);
    assert_eq!(result["scrollX"], 0);
}

#[test]
fn performance_mark_measure() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var mark = performance.mark('test-start');
        var measure = performance.measure('test-duration', 'test-start');
        globalThis.__testResult = {
            hasMark: typeof performance.mark === 'function',
            hasMeasure: typeof performance.measure === 'function',
            hasClearMarks: typeof performance.clearMarks === 'function',
            markName: mark.name,
            measureName: measure.name,
            hasPerformanceObserver: typeof PerformanceObserver === 'function',
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasMark"], true);
    assert_eq!(result["hasMeasure"], true);
    assert_eq!(result["hasClearMarks"], true);
    assert_eq!(result["markName"], "test-start");
    assert_eq!(result["measureName"], "test-duration");
    assert_eq!(result["hasPerformanceObserver"], true);
}

#[test]
fn document_create_event() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var evt = document.createEvent('Event');
        evt.initEvent('myevent', true, true);

        var div = document.createElement('div');
        var fired = false;
        div.addEventListener('myevent', function() { fired = true; });
        div.dispatchEvent(evt);

        globalThis.__testResult = {
            hasCreateEvent: typeof document.createEvent === 'function',
            fired: fired,
            eventType: evt.type,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasCreateEvent"], true);
    assert_eq!(result["fired"], true);
    assert_eq!(result["eventType"], "myevent");
}

#[test]
fn canvas_event_listeners() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var clicks = 0;
        canvas.addEventListener('click', function() { clicks++; });
        canvas.dispatchEvent(new Event('click'));
        canvas.dispatchEvent(new Event('click'));

        globalThis.__testResult = { clicks: clicks };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["clicks"], 2);
}

#[test]
fn create_image_bitmap_exists() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        globalThis.__testResult = {
            hasCreateImageBitmap: typeof createImageBitmap === 'function',
            hasImageBitmap: typeof ImageBitmap === 'function',
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasCreateImageBitmap"], true);
    assert_eq!(result["hasImageBitmap"], true);
}

#[test]
fn element_offset_properties() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        var canvas = document.createElement('canvas');

        globalThis.__testResult = {
            divHasOffsetWidth: typeof div.offsetWidth === 'number',
            divHasOffsetHeight: typeof div.offsetHeight === 'number',
            divHasClientWidth: typeof div.clientWidth === 'number',
            canvasOffsetWidth: canvas.offsetWidth,
            canvasOffsetHeight: canvas.offsetHeight,
            canvasClientWidth: canvas.clientWidth,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["divHasOffsetWidth"], true);
    assert_eq!(result["divHasOffsetHeight"], true);
    assert_eq!(result["divHasClientWidth"], true);
    // Canvas offset dimensions should match canvas width
    assert!(result["canvasOffsetWidth"].as_u64().unwrap() > 0);
    assert!(result["canvasOffsetHeight"].as_u64().unwrap() > 0);
}

#[test]
fn event_prevent_default_stop_propagation() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        var result = { prevented: false, stopped: false, secondFired: true };

        div.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopImmediatePropagation();
            result.prevented = e.defaultPrevented;
            result.stopped = true;
        });
        div.addEventListener('click', function(e) {
            result.secondFired = true; // should NOT fire due to stopImmediate
        });

        result.secondFired = false;
        var returned = div.dispatchEvent(new Event('click', { cancelable: true }));

        result.dispatchReturnedFalse = !returned;
        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["prevented"], true);
    assert_eq!(result["stopped"], true);
    assert_eq!(result["secondFired"], false, "stopImmediatePropagation should prevent second listener");
    assert_eq!(result["dispatchReturnedFalse"], true, "dispatchEvent should return false when prevented");
}

#[test]
fn element_owner_document_and_default_view() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        var canvas = document.createElement('canvas');
        var textNode = document.createTextNode('hello');

        globalThis.__testResult = {
            divOwnerDoc: div.ownerDocument === document,
            canvasOwnerDoc: canvas.ownerDocument === document,
            textOwnerDoc: textNode.ownerDocument === document,
            defaultView: document.defaultView === window,
            docNodeType: document.nodeType,
            divNamespaceURI: div.namespaceURI,
            canvasNamespaceURI: canvas.namespaceURI,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["divOwnerDoc"], true);
    assert_eq!(result["canvasOwnerDoc"], true);
    assert_eq!(result["textOwnerDoc"], true);
    assert_eq!(result["defaultView"], true);
    assert_eq!(result["docNodeType"], 9);
    assert_eq!(result["divNamespaceURI"], "http://www.w3.org/1999/xhtml");
    assert_eq!(result["canvasNamespaceURI"], "http://www.w3.org/1999/xhtml");
}

#[test]
fn textcontent_setter_clears_children() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        var child = document.createElement('span');
        div.appendChild(child);

        // Setting textContent should clear children
        div.textContent = 'hello world';

        globalThis.__testResult = {
            text: div.textContent,
            childCount: div.childNodes.length,
            firstChildIsText: div.firstChild && div.firstChild.nodeType === 3,
            childParentNull: child.parentNode === null,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["text"], "hello world");
    assert_eq!(result["childCount"], 1, "should have one text node child");
    assert_eq!(result["firstChildIsText"], true);
    assert_eq!(result["childParentNull"], true, "old child should be detached");
}

#[test]
fn text_node_node_value() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var tn = document.createTextNode('hello');
        var result = {};
        result.nodeValue = tn.nodeValue;
        result.textContent = tn.textContent;
        result.data = tn.data;
        result.length = tn.length;

        tn.nodeValue = 'world';
        result.afterSet = tn.textContent;
        result.afterSetData = tn.data;

        tn.appendData('!');
        result.afterAppend = tn.nodeValue;

        globalThis.__testResult = result;
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["nodeValue"], "hello");
    assert_eq!(result["textContent"], "hello");
    assert_eq!(result["data"], "hello");
    assert_eq!(result["length"], 5);
    assert_eq!(result["afterSet"], "world");
    assert_eq!(result["afterSetData"], "world");
    assert_eq!(result["afterAppend"], "world!");
}

#[test]
fn innerhtml_setter_creates_children() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        div.innerHTML = '<span class="test">hello</span><br/>';

        globalThis.__testResult = {
            childCount: div.childNodes.length,
            firstTag: div.childNodes[0] ? div.childNodes[0].tagName : null,
            firstClass: div.childNodes[0] ? div.childNodes[0].className : null,
            firstText: div.childNodes[0] ? div.childNodes[0].textContent : null,
            secondTag: div.childNodes[1] ? div.childNodes[1].tagName : null,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["childCount"], 2, "should have 2 children (span + br)");
    assert_eq!(result["firstTag"], "SPAN");
    assert_eq!(result["firstClass"], "test");
    assert_eq!(result["firstText"], "hello");
    assert_eq!(result["secondTag"], "BR");
}

#[test]
fn dom_parser() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var parser = new DOMParser();
        var doc = parser.parseFromString('<div id="test">content</div>', 'text/html');

        globalThis.__testResult = {
            hasDOMParser: typeof DOMParser === 'function',
            hasBody: doc.body !== null,
            bodyChildCount: doc.body.childNodes.length,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasDOMParser"], true);
    assert_eq!(result["hasBody"], true);
    assert!(result["bodyChildCount"].as_u64().unwrap() >= 1);
}

#[test]
fn create_tree_walker() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        var a = document.createElement('span');
        a.id = 'first';
        var b = document.createElement('span');
        b.id = 'second';
        div.appendChild(a);
        div.appendChild(b);

        var walker = document.createTreeWalker(div);
        var nodes = [];
        var node;
        while ((node = walker.nextNode()) !== null) {
            nodes.push(node.id || node.tagName || 'unknown');
        }

        globalThis.__testResult = {
            hasTreeWalker: typeof document.createTreeWalker === 'function',
            nodeCount: nodes.length,
            nodes: nodes,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasTreeWalker"], true);
    assert_eq!(result["nodeCount"], 2);
}

#[test]
fn websocket_polyfill_exists() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        globalThis.__testResult = {
            hasWebSocket: typeof WebSocket === 'function',
            CONNECTING: WebSocket.CONNECTING,
            OPEN: WebSocket.OPEN,
            CLOSING: WebSocket.CLOSING,
            CLOSED: WebSocket.CLOSED,
            hasWsRegistry: typeof __dz_ws_registry === 'object',
            hasWsRequests: Array.isArray(__dz_ws_requests),
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasWebSocket"], true);
    assert_eq!(result["CONNECTING"], 0);
    assert_eq!(result["OPEN"], 1);
    assert_eq!(result["CLOSING"], 2);
    assert_eq!(result["CLOSED"], 3);
    assert_eq!(result["hasWsRegistry"], true);
    assert_eq!(result["hasWsRequests"], true);
}

#[test]
fn svg_namespace_create_element() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        var circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        var div = document.createElement('div');

        globalThis.__testResult = {
            svgNS: svg.namespaceURI,
            circleNS: circle.namespaceURI,
            divNS: div.namespaceURI,
            svgTag: svg.tagName,
            circleTag: circle.tagName,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["svgNS"], "http://www.w3.org/2000/svg");
    assert_eq!(result["circleNS"], "http://www.w3.org/2000/svg");
    assert_eq!(result["divNS"], "http://www.w3.org/1999/xhtml");
    assert_eq!(result["svgTag"], "SVG");
    assert_eq!(result["circleTag"], "CIRCLE");
}

#[test]
fn document_create_range() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var range = document.createRange();
        globalThis.__testResult = {
            hasCreateRange: typeof document.createRange === 'function',
            hasSetStart: typeof range.setStart === 'function',
            hasGetBCR: typeof range.getBoundingClientRect === 'function',
            collapsed: range.collapsed,
        };
    "#).unwrap();

    for _ in 0..3 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["hasCreateRange"], true);
    assert_eq!(result["hasSetStart"], true);
    assert_eq!(result["hasGetBCR"], true);
    assert_eq!(result["collapsed"], true);
}

// ============================================================================
// Security tests
// ============================================================================

#[test]
fn fetch_path_traversal_blocked() {
    let content_dir = tempfile::tempdir().unwrap();
    // Create a file outside content_dir to verify it can't be read
    let parent = content_dir.path().parent().unwrap();
    std::fs::write(parent.join("secret.txt"), "sensitive data").ok();

    let mut rt = make_runtime(64, 64);
    rt.state.content_dir = Some(content_dir.path().to_path_buf());

    rt.load_js("<test>", r#"
        var results = { dotdot: '', absolute: '' };
        fetch('../secret.txt').then(function(r) {
            results.dotdot = 'resolved:' + r.status;
        }).catch(function(e) {
            results.dotdot = 'blocked';
        });
        fetch('subdir/../../secret.txt').then(function(r) {
            results.absolute = 'resolved:' + r.status;
        }).catch(function(e) {
            results.absolute = 'blocked';
        });
        globalThis.__testResult = results;
    "#).unwrap();

    for _ in 0..5 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["dotdot"], "blocked", ".. traversal should be blocked");
    assert_eq!(result["absolute"], "blocked", "nested .. traversal should be blocked");
}

#[test]
fn dz_globals_frozen() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var results = {};
        // Try to reassign __dz_fetch_requests (an array — should be frozen)
        var origFetch = globalThis.__dz_fetch_requests;
        globalThis.__dz_fetch_requests = 'hijacked';
        results.fetch_hijacked = (globalThis.__dz_fetch_requests === 'hijacked');
        // In non-strict mode, assignment silently fails — value should still be original
        if (!results.fetch_hijacked) results.fetch_hijacked = false;

        // Try to reassign __dz_resolve_fetch (a function — should be frozen)
        var origResolve = globalThis.__dz_resolve_fetch;
        globalThis.__dz_resolve_fetch = 'hijacked';
        results.resolve_hijacked = (globalThis.__dz_resolve_fetch === 'hijacked');
        // Primitives should still be writable
        var old = globalThis.__dz_html_dirty;
        globalThis.__dz_html_dirty = true;
        results.primitive_writable = (globalThis.__dz_html_dirty === true);
        globalThis.__dz_html_dirty = old;

        globalThis.__testResult = results;
    "#).unwrap();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["fetch_hijacked"], false, "__dz_fetch_requests should not be reassignable");
    assert_eq!(result["resolve_hijacked"], false, "__dz_resolve_fetch should not be reassignable");
    assert_eq!(result["primitive_writable"], true, "primitive __dz_* should remain writable");
}

#[test]
fn fetch_data_uri_base64() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var results = { plain: '', base64: '' };
        fetch('data:text/plain,hello%20world').then(function(r) {
            return r.text();
        }).then(function(t) {
            results.plain = t;
        });
        fetch('data:application/json;base64,eyJhIjoxfQ==').then(function(r) {
            return r.text();
        }).then(function(t) {
            results.base64 = t;
        });
        globalThis.__testResult = results;
    "#).unwrap();

    for _ in 0..5 { rt.tick(); }

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["plain"], "hello%20world");
    assert_eq!(result["base64"], "{\"a\":1}", "base64 data URI should be decoded");
}

// ============================================================================
// Canvas2D correctness tests
// ============================================================================

#[test]
fn get_transform_tracks_state() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        // Identity initially
        var t0 = ctx.getTransform();
        var identity = (t0.a === 1 && t0.b === 0 && t0.c === 0 && t0.d === 1 && t0.e === 0 && t0.f === 0);

        // After translate
        ctx.translate(10, 20);
        var t1 = ctx.getTransform();
        var translated = (t1.e === 10 && t1.f === 20);

        // After save/restore
        ctx.save();
        ctx.scale(2, 3);
        var t2 = ctx.getTransform();
        var scaled = (t2.a === 2 && t2.d === 3);
        ctx.restore();
        var t3 = ctx.getTransform();
        var restored = (t3.e === 10 && t3.f === 20 && t3.a === 1);

        // After resetTransform
        ctx.resetTransform();
        var t4 = ctx.getTransform();
        var reset = (t4.a === 1 && t4.e === 0);

        globalThis.__testResult = {
            identity: identity,
            translated: translated,
            scaled: scaled,
            restored: restored,
            reset: reset
        };
    "#).unwrap();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["identity"], true, "initial transform should be identity");
    assert_eq!(result["translated"], true, "translate should update e,f");
    assert_eq!(result["scaled"], true, "scale should update a,d");
    assert_eq!(result["restored"], true, "restore should undo scale");
    assert_eq!(result["reset"], true, "resetTransform should return to identity");
}

#[test]
fn navigation_reset_clears_state() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        // Set up some state that should be cleared
        globalThis.__dz_html_dirty = true;

        // Call reset
        if (typeof __dz_reset_page_state === 'function') {
            __dz_reset_page_state();
        }

        globalThis.__testResult = {
            dirty_cleared: (globalThis.__dz_html_dirty === false),
            reset_fn_exists: (typeof __dz_reset_page_state === 'function'),
            hooks_exist: (Array.isArray(globalThis.__dz_reset_hooks))
        };
    "#).unwrap();

    let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
    let s = val["result"]["value"].as_str().unwrap();
    let result: serde_json::Value = serde_json::from_str(s).unwrap();
    assert_eq!(result["reset_fn_exists"], true, "__dz_reset_page_state should exist");
    assert_eq!(result["hooks_exist"], true, "__dz_reset_hooks should be an array");
    assert_eq!(result["dirty_cleared"], true, "html_dirty should be cleared after reset");
}
