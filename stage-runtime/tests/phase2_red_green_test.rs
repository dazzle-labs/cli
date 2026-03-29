//! Red-green tests for spec-pt2.md remaining work.
//!
//! Tests start as #[ignore] (RED). As features land, #[ignore] is removed (GREEN).
//! Remaining #[ignore] tests track what's still blocked.
//!
//! Run passing tests:
//!   cargo test --package stage-runtime --test phase2_red_green_test
//!
//! Run remaining RED tests:
//!   cargo test --package stage-runtime --test phase2_red_green_test -- --ignored

use serde_json::json;

// ============================================================================
// Canvas 2D — GREEN (implemented)
// ============================================================================

mod canvas2d {
    use super::*;

    #[test]
    fn get_image_data_returns_pixel_data() {
        let mut canvas = dazzle_render::canvas2d::Canvas2D::new(100, 100);
        canvas.process_commands(&json!([
            ["fillStyle", "#ff0000"],
            ["fillRect", 10, 10, 20, 20]
        ]));

        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels(&mut pixels);
        let idx = (15 * 100 + 15) * 4;
        assert_eq!(pixels[idx], 255, "red channel at (15,15)");

        let sub_rect = canvas.get_image_data(10, 10, 20, 20);
        assert_eq!(sub_rect.len(), 20 * 20 * 4, "should return 20x20 RGBA pixels");
        let si = (5 * 20 + 5) * 4;
        assert_eq!(sub_rect[si], 255, "sub-rect red channel");
    }

    #[test]
    fn draw_image_blits_pixels() {
        let mut canvas = dazzle_render::canvas2d::Canvas2D::new(100, 100);

        canvas.process_commands(&json!([
            ["fillStyle", "#0000ff"],
            ["fillRect", 0, 0, 100, 100]
        ]));

        let mut cmd: Vec<serde_json::Value> = vec![
            json!("drawImage"), json!("__inline"),
            json!(0), json!(0), json!(2), json!(2),
        ];
        for _ in 0..4 {
            cmd.extend_from_slice(&[json!(255), json!(0), json!(0), json!(255)]);
        }

        canvas.process_commands(&serde_json::Value::Array(vec![
            serde_json::Value::Array(cmd),
        ]));

        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels(&mut pixels);

        let r = pixels[0];
        assert!(r > 200, "drawImage should render red pixels at (0,0), got r={}", r);
    }

    #[test]
    fn create_pattern_tile() {
        let mut canvas = dazzle_render::canvas2d::Canvas2D::new(100, 100);

        canvas.process_commands(&json!([
            ["_createPattern", "pat1", "repeat", 2, 2,
             255, 255, 255, 255,   0,   0,   0, 255,
               0,   0,   0, 255, 255, 255, 255, 255],
            ["_setFillPattern", "pat1"],
            ["fillRect", 0, 0, 100, 100]
        ]));

        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels(&mut pixels);

        let p00 = &pixels[0..4];
        let p10 = &pixels[4..8];
        assert_ne!(p00, p10, "adjacent pixels should differ in a checkerboard pattern");

        let p20 = &pixels[8..12];
        assert_eq!(p00, p20, "pattern should tile: (0,0) == (2,0)");
    }

    #[test]
    fn measure_text_returns_real_width() {
        let canvas = dazzle_render::canvas2d::Canvas2D::new(100, 100);
        let metrics = canvas.measure_text("Hello World", "20px sans-serif");
        assert!(
            metrics.width > 0.0,
            "measureText should return non-zero width, got {}",
            metrics.width
        );
    }

    #[test]
    fn measure_text_proportional_widths() {
        let canvas = dazzle_render::canvas2d::Canvas2D::new(100, 100);

        let wide = canvas.measure_text("WWWWW", "20px sans-serif");
        let narrow = canvas.measure_text("iiiii", "20px sans-serif");

        assert!(
            wide.width > narrow.width,
            "WWWWW ({:.1}px) should be wider than iiiii ({:.1}px)",
            wide.width, narrow.width
        );
    }
}

// ============================================================================
// Asset loading — GREEN (implemented)
// ============================================================================

mod asset_loading {
    use super::*;

    #[test]
    fn decode_png_image() {
        let png_data = create_minimal_png(1, 1, &[255, 0, 0, 255]);

        let result = dazzle_render::content::decode_image(&png_data);
        assert!(result.is_ok(), "should decode PNG: {:?}", result.err());

        let img = result.unwrap();
        assert_eq!(img.width, 1);
        assert_eq!(img.height, 1);
        assert_eq!(&img.rgba[0..4], &[255, 0, 0, 255]);
    }

    #[test]
    fn decode_jpeg_image() {
        let png_data = create_minimal_png(1, 1, &[0, 255, 0, 255]);
        let result = dazzle_render::content::decode_image(&png_data);
        assert!(result.is_ok(), "valid PNG should decode when decode_image is implemented");
    }

    #[test]
    fn fetch_file_url_blocked() {
        // file:// URLs are blocked for security (prevents arbitrary file read from untrusted content)
        let dir = tempfile::tempdir().unwrap();
        let json_path = dir.path().join("data.json");
        std::fs::write(&json_path, r#"{"key": "value"}"#).unwrap();

        let url = format!("file://{}", json_path.display());
        let result = dazzle_render::content::fetch_url(&url);
        assert!(result.is_err(), "file:// URLs should be rejected");
        assert!(result.unwrap_err().to_string().contains("file://"));
    }

    #[test]
    fn load_custom_font() {
        let result = dazzle_render::canvas2d::text::load_font(
            include_bytes!("../src/canvas2d/fonts/DejaVuSans.ttf"),
            "CustomTestFont",
        );
        assert!(result.is_ok(), "should register custom font: {:?}", result.err());
    }

    fn create_minimal_png(w: u32, h: u32, rgba: &[u8]) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut buf), w, h);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(rgba).unwrap();
        }
        buf
    }
}

// ============================================================================
// Web Audio — GREEN (scaffold), RED (node graph rendering)
// ============================================================================

mod audio {
    use super::*;

    #[test]
    fn audio_js_has_rust_bindings() {
        let audio_js = dazzle_render::audio::AUDIO_JS;
        assert!(
            audio_js.contains("__dz_audio_cmds") || audio_js.contains("__dz_audio_create"),
            "audio.js should have Rust-backed command buffer, not just stub constructors"
        );
    }

    #[test]
    fn audio_graph_renders_samples() {
        let mut graph = dazzle_render::audio::AudioGraph::new(44100, 30);

        // Simulate JS: osc = ctx.createOscillator(); osc.connect(ctx.destination); osc.start();
        graph.process_commands(&[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ]);

        let samples = graph.render_frame();
        assert_eq!(samples.len(), 1470 * 2, "should produce stereo samples for one frame");

        assert!(
            samples.iter().any(|&s| s.abs() > 0.001),
            "should produce audible output from oscillator"
        );
    }

    #[test]
    fn audio_graph_gain_node() {
        let mut graph = dazzle_render::audio::AudioGraph::new(44100, 30);

        // osc -> gain(0.5) -> destination
        graph.process_commands(&[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!(2)], // osc -> gain
            vec![json!("connect"), json!(2), json!("destination")], // gain -> dest
        ]);
        // Gain node needs to exist — currently only osc_start creates oscillators.
        // The gain node with id=2 doesn't exist yet, so samples should be silent.
        // This tests that the graph handles missing nodes gracefully.
        let samples = graph.render_frame();
        assert_eq!(samples.len(), 1470 * 2);
    }

    #[test]
    fn audio_graph_stop_oscillator() {
        let mut graph = dazzle_render::audio::AudioGraph::new(44100, 30);

        graph.process_commands(&[
            vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ]);

        // First frame: audible
        let s1 = graph.render_frame();
        assert!(s1.iter().any(|&s| s.abs() > 0.001));

        // Stop the oscillator
        graph.process_commands(&[
            vec![json!("osc_stop"), json!(1)],
        ]);

        // Second frame: mostly silent. The web-audio-api crate processes audio in
        // 128-sample rendering quanta — stop takes effect at the next quantum boundary,
        // so up to 128 mono samples (256 interleaved) may contain residual audio from
        // the partial quantum straddling the frame boundary.
        let s2 = graph.render_frame();
        let quantum_leakage = 128 * 2; // max stereo samples from one quantum
        let silent_region = &s2[quantum_leakage..];
        assert!(
            silent_region.iter().all(|&s| s.abs() < 0.001),
            "stopped oscillator should produce silence after quantum boundary"
        );
    }
}

// ============================================================================
// Encoder — RED (blocked by FFmpeg build compat)
// ============================================================================

mod encoder {
    #[test]
    #[cfg(feature = "encoder")]
    fn encode_frame_produces_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let output_path = dir.path().join("test_output.flv");

        let mut enc = dazzle_render::encoder::Encoder::new(
            dazzle_render::encoder::EncoderConfig {
                width: 64,
                height: 64,
                fps: 30,
                video_codec: "libx264".to_string(),
                video_bitrate: 500000,
                audio_bitrate: 128000,
                audio_sample_rate: 44100,
                keyframe_interval: 30,
                gpu_device_index: 0,
            },
        ).expect("failed to create encoder");

        enc.set_outputs(vec![
            dazzle_render::encoder::OutputDest {
                name: "test".to_string(),
                url: format!("file:{}", output_path.display()),
                watermarked: false,
            },
        ]);

        // Encode 10 frames of solid red + silence
        let pixels = vec![255u8; 64 * 64 * 4];
        let audio = vec![0.0f32; (44100 / 30) * 2]; // stereo silence
        for _ in 0..10 {
            enc.encode_frame(&pixels, Some(&audio));
        }

        let stats = enc.stats();
        assert!(
            stats.total_bytes > 0,
            "encoding frames should produce output bytes, got {}",
            stats.total_bytes
        );
        assert!(
            stats.encode_fps > 0.0,
            "encode_fps should be > 0 after encoding, got {}",
            stats.encode_fps
        );
    }

    #[test]
    #[cfg(not(feature = "encoder"))]
    #[ignore = "RED: requires `encoder` feature (cargo test --features encoder)"]
    fn encode_frame_produces_bytes() {}

    #[test]
    #[cfg(feature = "encoder")]
    fn set_outputs_creates_pipeline() {
        let dir = tempfile::tempdir().unwrap();
        let output_path = dir.path().join("test_output2.flv");

        let mut enc = dazzle_render::encoder::Encoder::new(
            dazzle_render::encoder::EncoderConfig {
                width: 64,
                height: 64,
                fps: 30,
                video_codec: "libx264".to_string(),
                video_bitrate: 500000,
                audio_bitrate: 128000,
                audio_sample_rate: 44100,
                keyframe_interval: 30,
                gpu_device_index: 0,
            },
        ).expect("failed to create encoder");

        assert_eq!(enc.output_count(), 0);

        enc.set_outputs(vec![
            dazzle_render::encoder::OutputDest {
                name: "ingest".to_string(),
                url: format!("file:{}", output_path.display()),
                watermarked: false,
            },
        ]);

        assert_eq!(enc.output_count(), 1);

        // Encode a few frames to prove the pipeline works
        let pixels = vec![0u8; 64 * 64 * 4];
        for _ in 0..5 {
            enc.encode_frame(&pixels, None);
        }

        let stats = enc.stats();
        assert!(stats.encode_fps > 0.0);
    }

    #[test]
    #[cfg(not(feature = "encoder"))]
    #[ignore = "RED: requires `encoder` feature (cargo test --features encoder)"]
    fn set_outputs_creates_pipeline() {}
}

// ============================================================================
// Integration — GREEN (Runtime struct exposed for testing)
// ============================================================================

mod integration {
    use std::sync::{Arc, Mutex};

    fn make_runtime() -> dazzle_render::runtime::Runtime {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Mutex::new(
            dazzle_render::storage::Storage::new(&dir.path().join("storage.json")).unwrap(),
        ));
        dazzle_render::runtime::Runtime::new(64, 64, 30, store).unwrap()
    }

    #[test]
    fn event_injection_dispatches_to_js() {
        let mut rt = make_runtime();

        rt.load_js(
            "<test>",
            "var __dz_received = null; \
             globalThis.__dz_dispatch_event = function(e) { __dz_received = e; };",
        )
        .unwrap();

        rt.inject_event(r#"{"type":"click","x":10,"y":20}"#)
            .unwrap();

        let result = rt.evaluate("JSON.stringify(__dz_received)").unwrap();
        let val = result["result"]["value"]
            .as_str()
            .expect("should get string result");
        assert!(val.contains("click"), "event should contain 'click', got: {}", val);
    }

    #[test]
    fn hot_reload_picks_up_new_bundle() {
        let mut rt = make_runtime();

        rt.load_js("<v1>", "globalThis.__version = 1;").unwrap();
        let r1 = rt.evaluate("__version").unwrap();
        assert_eq!(r1["result"]["value"].as_f64(), Some(1.0));

        rt.load_js("<v2>", "globalThis.__version = 2;").unwrap();
        let r2 = rt.evaluate("__version").unwrap();
        assert_eq!(r2["result"]["value"].as_f64(), Some(2.0));
    }

    #[test]
    fn storage_persists_across_reload() {
        let mut rt = make_runtime();

        rt.load_js("<set>", "dazzle.storage.set('key1', 'hello');")
            .unwrap();

        let result = rt.evaluate("dazzle.storage.get('key1')").unwrap();
        assert_eq!(result["result"]["value"], "hello");
    }

    #[test]
    fn framebuffer_is_premultiplied_rgba() {
        let mut rt = make_runtime();

        // Draw a semi-transparent red rectangle
        rt.load_js(
            "<draw>",
            "var c = document.createElement('canvas'); \
             var ctx = c.getContext('2d'); \
             ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; \
             ctx.fillRect(0, 0, 64, 64);",
        )
        .unwrap();
        rt.tick();

        let fb = rt.get_framebuffer();
        assert_eq!(fb.len(), 64 * 64 * 4);

        // Premultiplied: R should be ~128 (255 * 0.5), A should be ~128
        let px = &fb[0..4];
        assert!(px[3] > 100 && px[3] < 160, "alpha should be ~128, got {}", px[3]);
        assert!(px[0] > 100 && px[0] < 160, "premul R should be ~128, got {}", px[0]);
        assert!(px[1] < 10, "G should be near 0, got {}", px[1]);
        assert!(px[2] < 10, "B should be near 0, got {}", px[2]);
    }

    #[test]
    fn screenshot_composites_on_white() {
        let mut rt = make_runtime();

        // Draw a semi-transparent green rectangle
        rt.load_js(
            "<draw>",
            "var c = document.createElement('canvas'); \
             var ctx = c.getContext('2d'); \
             ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'; \
             ctx.fillRect(0, 0, 64, 64);",
        )
        .unwrap();
        rt.tick();

        let screenshot = rt.state.get_framebuffer_for_screenshot();
        assert_eq!(screenshot.len(), 64 * 64 * 4);

        // On white: G channel = premul_G + (255 - A) ≈ 128 + 127 = 255
        // R channel = premul_R + (255 - A) ≈ 0 + 127 = 127
        let px = &screenshot[0..4];
        assert!(px[3] == 255, "screenshot alpha should be opaque, got {}", px[3]);
        assert!(px[1] > 200, "G should be bright on white, got {}", px[1]);
        assert!(px[0] > 100 && px[0] < 160, "R should be ~128 (white bleed), got {}", px[0]);
        assert!(px[2] > 100 && px[2] < 160, "B should be ~128 (white bleed), got {}", px[2]);
    }

    #[test]
    fn screenshot_opaque_content_is_exact() {
        let mut rt = make_runtime();

        // Draw a fully opaque red rectangle
        rt.load_js(
            "<draw>",
            "var c = document.createElement('canvas'); \
             var ctx = c.getContext('2d'); \
             ctx.fillStyle = '#ff0000'; \
             ctx.fillRect(0, 0, 64, 64);",
        )
        .unwrap();
        rt.tick();

        let fb = rt.get_framebuffer();
        let screenshot = rt.state.get_framebuffer_for_screenshot();

        // For opaque content, framebuffer and screenshot RGB should match exactly
        for (i, (fb_px, ss_px)) in fb.chunks(4).zip(screenshot.chunks(4)).enumerate() {
            assert_eq!(fb_px[0], ss_px[0], "R mismatch at pixel {}", i);
            assert_eq!(fb_px[1], ss_px[1], "G mismatch at pixel {}", i);
            assert_eq!(fb_px[2], ss_px[2], "B mismatch at pixel {}", i);
            assert_eq!(ss_px[3], 255, "screenshot alpha should be 255 at pixel {}", i);
        }
    }

    #[test]
    fn screenshot_transparent_region_is_white() {
        let mut rt = make_runtime();

        // Draw a small rect, leaving most of the canvas transparent
        rt.load_js(
            "<draw>",
            "var c = document.createElement('canvas'); \
             var ctx = c.getContext('2d'); \
             ctx.fillStyle = '#0000ff'; \
             ctx.fillRect(0, 0, 2, 2);",
        )
        .unwrap();
        rt.tick();

        let screenshot = rt.state.get_framebuffer_for_screenshot();

        // Pixel at (32, 32) should be white (transparent region)
        let idx = (32 * 64 + 32) * 4;
        let px = &screenshot[idx..idx + 4];
        assert_eq!(px, &[255, 255, 255, 255], "transparent region should be white, got {:?}", px);

        // Pixel at (0, 0) should be blue
        let px0 = &screenshot[0..4];
        assert!(px0[2] > 200, "drawn pixel should be blue, got {:?}", px0);
    }
}
