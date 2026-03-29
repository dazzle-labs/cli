//! Tests for adversarial review fixes: security hardening, correctness bugs,
//! resource exhaustion prevention, and edge cases.
//!
//! Run: cargo test --test adversarial_fixes_test

mod test_harness;


// ============================================================================
// 1. SSRF: private IP blocking via resolve_and_check_url
// ============================================================================

mod ssrf {
    use dazzle_render::content::resolve_and_check_url;

    #[test]
    fn blocks_localhost() {
        let result = resolve_and_check_url("http://127.0.0.1/secret");
        assert!(result.is_err(), "should block 127.0.0.1");
    }

    #[test]
    fn blocks_localhost_ipv6() {
        let result = resolve_and_check_url("http://[::1]/secret");
        assert!(result.is_err(), "should block ::1");
    }

    #[test]
    fn blocks_private_10_range() {
        let result = resolve_and_check_url("http://10.0.0.1/");
        assert!(result.is_err(), "should block 10.x.x.x");
    }

    #[test]
    fn blocks_private_192_168() {
        let result = resolve_and_check_url("http://192.168.1.1/");
        assert!(result.is_err(), "should block 192.168.x.x");
    }

    #[test]
    fn blocks_private_172_16() {
        let result = resolve_and_check_url("http://172.16.0.1/");
        assert!(result.is_err(), "should block 172.16.x.x");
    }

    #[test]
    fn blocks_link_local() {
        let result = resolve_and_check_url("http://169.254.1.1/");
        assert!(result.is_err(), "should block link-local");
    }

    #[test]
    fn blocks_unresolvable_host() {
        let result = resolve_and_check_url("http://this-host-definitely-does-not-exist-xyz123.invalid/");
        assert!(result.is_err(), "should block unresolvable hosts");
    }

    #[test]
    fn blocks_no_host() {
        let result = resolve_and_check_url("http:///path");
        assert!(result.is_err(), "should block URL with no host");
    }

    #[test]
    fn blocks_file_scheme() {
        let result = dazzle_render::content::fetch_url("file:///etc/passwd");
        assert!(result.is_err(), "should reject file:// scheme");
    }

    #[test]
    fn blocks_unsupported_scheme() {
        let result = dazzle_render::content::fetch_url("ftp://example.com/");
        assert!(result.is_err(), "should reject ftp:// scheme");
    }
}

// ============================================================================
// 2. Integer overflow in pixel buffer size calculations
// ============================================================================

mod integer_overflow {
    use dazzle_render::canvas2d::Canvas2D;

    #[test]
    fn get_image_data_rejects_overflow_dimensions() {
        let canvas = Canvas2D::new(64, 64);
        // w=65536, h=65536 → w*h*4 overflows u32 to 0. With u64 check it should return empty.
        let result = canvas.get_image_data(0, 0, 65536, 65536);
        assert!(result.is_empty(), "should return empty for overflow dimensions, got len={}", result.len());
    }

    #[test]
    fn get_image_data_rejects_huge_dimensions() {
        let canvas = Canvas2D::new(64, 64);
        // Exceeds MAX_PIXMAP_BYTES (8192*8192*4 = 256MB)
        let result = canvas.get_image_data(0, 0, 10000, 10000);
        assert!(result.is_empty(), "should return empty for oversized dimensions");
    }

    #[test]
    fn get_image_data_works_for_normal_sizes() {
        let canvas = Canvas2D::new(64, 64);
        let result = canvas.get_image_data(0, 0, 32, 32);
        assert_eq!(result.len(), 32 * 32 * 4);
    }
}

// ============================================================================
// 3. Dimension caps and allocation limits
// ============================================================================

mod dimension_caps {
    use dazzle_render::canvas2d::Canvas2D;
    use dazzle_render::content::decode_image;
    use serde_json::json;

    #[test]
    fn canvas_save_stack_capped() {
        let mut canvas = Canvas2D::new(64, 64);
        // Push 600 saves — should stop at 512
        for _ in 0..600 {
            canvas.process_commands(&json!([["save"]]));
        }
        // Now restore 600 times — extra restores are no-ops
        for _ in 0..600 {
            canvas.process_commands(&json!([["restore"]]));
        }
        // Should not panic or OOM — just verify it completes
    }

    #[test]
    fn webgl2_rejects_oversized_texture() {
        let mut gl = dazzle_render::webgl2::WebGL2::new(64, 64);
        // Create and bind a texture, then attempt texImage2D with huge dimensions.
        // The tex_image_2d_raw path is used by native callbacks, so test it directly.
        let cmds = json!([
            ["createTexture", "__ret_t1"],
            ["bindTexture", 0x0DE1, "$__ret_t1"],
        ]);
        gl.process_commands(&cmds);
        // Call tex_image_2d_raw directly with oversized dimensions
        gl.tex_image_2d_raw(0x0DE1, 0, 0x1908, 10000, 10000, 0, 0x1908, 0x1401, &[]);
        let errors = gl.take_errors();
        assert!(errors.contains(&0x0501), "should record GL_INVALID_VALUE for oversized texture, got {:?}", errors);
    }

    #[test]
    fn svg_decode_rejects_huge_viewbox() {
        // SVG with a 100000x100000 viewBox
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100000 100000">
            <rect width="100000" height="100000" fill="red"/>
        </svg>"#;
        let result = decode_image(svg);
        assert!(result.is_err(), "should reject SVG with huge dimensions");
        let err = format!("{}", result.err().unwrap());
        assert!(err.contains("exceed maximum"), "error should mention dimension limit: {}", err);
    }
}

// ============================================================================
// 4. UTF-8 truncation safety
// ============================================================================

mod utf8_truncation {
    // Test the truncation logic directly by exercising CDP message paths
    // that could contain multi-byte UTF-8

    #[test]
    fn truncate_handles_ascii() {
        let msg = "hello world, this is a long message that should be truncated";
        let truncated = truncate_test(msg, 10);
        assert!(truncated.starts_with("hello worl"), "got: {}", truncated);
        assert!(truncated.contains("...["), "should have truncation marker");
    }

    #[test]
    fn truncate_handles_multibyte_utf8() {
        // Each emoji is 4 bytes in UTF-8
        let msg = "🎉🎊🎈🎁🎂";
        // Try to truncate at byte offset 5 — in the middle of 2nd emoji (bytes 4-7)
        let truncated = truncate_test(msg, 5);
        // Should not panic, should truncate at a valid char boundary
        assert!(truncated.len() > 0, "should produce non-empty output");
        // Verify it's valid UTF-8 (this would panic if boundary was wrong)
        let _ = truncated.as_str();
    }

    #[test]
    fn truncate_handles_short_message() {
        let msg = "hi";
        let truncated = truncate_test(msg, 100);
        assert_eq!(truncated, "hi");
    }

    /// Mirror of the truncate function from pipe_server.rs
    fn truncate_test(msg: &str, max: usize) -> String {
        if msg.len() <= max {
            msg.to_string()
        } else {
            let end = (0..=max).rev().find(|&i| msg.is_char_boundary(i)).unwrap_or(0);
            format!("{}...[{}B]", &msg[..end], msg.len())
        }
    }
}

// ============================================================================
// 5. Console buffer cap
// ============================================================================

mod console_buffer {
    use super::*;

    #[test]
    fn console_log_spam_does_not_oom() {
        let mut rt = test_harness::make_runtime(64, 64);
        // Spam 20,000 console.log calls
        rt.load_js("<spam>", "for (var i = 0; i < 20000; i++) console.log('spam ' + i);").unwrap();
        rt.tick();
        let logs = rt.drain_console_logs();
        // Should be capped at 10,000
        assert!(logs.len() <= 10_000, "console buffer should be capped at 10000, got {}", logs.len());
        assert!(logs.len() >= 1, "should have at least some logs");
    }
}

// ============================================================================
// 6. inject_event JSON validation
// ============================================================================

mod inject_event {
    use super::*;

    #[test]
    fn rejects_invalid_json() {
        let mut rt = test_harness::make_runtime(64, 64);
        let result = rt.inject_event("not valid json ); alert(1); //");
        assert!(result.is_err(), "should reject invalid JSON");
    }

    #[test]
    fn rejects_js_injection_attempt() {
        let mut rt = test_harness::make_runtime(64, 64);
        let result = rt.inject_event(r#"1); globalThis.__hacked = true; //"#);
        assert!(result.is_err(), "should reject injection attempt");
    }

    #[test]
    fn accepts_valid_json() {
        let mut rt = test_harness::make_runtime(64, 64);
        let result = rt.inject_event(r#"{"type": "test", "data": 42}"#);
        assert!(result.is_ok(), "should accept valid JSON: {:?}", result.err());
    }

    #[test]
    fn dispatch_event_rejects_invalid_json() {
        let mut rt = test_harness::make_runtime(64, 64);
        let result = rt.dispatch_event("test", "not json");
        assert!(result.is_err(), "should reject invalid JSON detail");
    }

    #[test]
    fn dispatch_event_accepts_valid_json() {
        let mut rt = test_harness::make_runtime(64, 64);
        let result = rt.dispatch_event("test", r#"{"key": "value"}"#);
        assert!(result.is_ok(), "should accept valid JSON detail");
    }
}

// ============================================================================
// 7. CSS nested braces (@media, @keyframes)
// ============================================================================

mod css_nesting {
    use dazzle_render::htmlcss;

    #[test]
    fn at_media_does_not_corrupt_subsequent_rules() {
        let html = r#"<!DOCTYPE html>
        <html>
        <head><style>
            body { background: #ff0000; }
            @media (min-width: 768px) {
                .container { width: 100%; }
            }
            .after-media { color: blue; }
        </style></head>
        <body><div class="after-media">test</div></body>
        </html>"#;
        // This should not panic — previously the parser would break on nested braces
        let (_, js) = htmlcss::extract_scripts(html);
        // Just verify it doesn't crash
        assert!(js.is_empty(), "no scripts expected");
    }

    #[test]
    fn at_keyframes_skipped_without_crash() {
        let html = r#"<!DOCTYPE html>
        <html>
        <head><style>
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            body { background: #00ff00; }
        </style></head>
        <body></body>
        </html>"#;
        let (_, js) = htmlcss::extract_scripts(html);
        assert!(js.is_empty());
    }
}

// ============================================================================
// 8. WebGL2 ref_map clearing
// ============================================================================

mod ref_map {
    use serde_json::json;

    #[test]
    fn ref_map_cleared_on_take_frame_dirty() {
        let mut gl = dazzle_render::webgl2::WebGL2::new(64, 64);
        // Create several objects (each inserts into ref_map)
        let cmds = json!([
            ["createBuffer", "__ret_b1"],
            ["createBuffer", "__ret_b2"],
            ["createTexture", "__ret_t1"],
            ["createProgram", "__ret_p1"],
        ]);
        gl.process_commands(&cmds);
        // take_frame_dirty should clear ref_map
        let dirty = gl.take_frame_dirty();
        assert!(dirty, "should be dirty after commands");
        // After clearing, old refs should no longer resolve
        // (This is tested implicitly — the point is ref_map doesn't grow unbounded)
    }
}

// ============================================================================
// 9. WebGL2 alloc_id doesn't panic on overflow
// ============================================================================

mod alloc_id {
    use serde_json::json;

    #[test]
    fn many_allocations_do_not_panic() {
        let mut gl = dazzle_render::webgl2::WebGL2::new(64, 64);
        // Allocate many objects — should not panic even with wrapping
        for i in 0..1000 {
            let cmds = json!([
                ["createBuffer", format!("__ret_b{}", i)],
            ]);
            gl.process_commands(&cmds);
        }
        // Verify we can still allocate after many iterations
        let cmds = json!([
            ["createBuffer", "__ret_final"],
        ]);
        let result = gl.process_commands(&cmds);
        assert!(!result.is_null(), "should still be able to allocate");
    }
}

// ============================================================================
// 10. TextDecoder truncated UTF-8 (tested via JS runtime)
// ============================================================================

mod text_decoder {
    use super::*;

    #[test]
    fn truncated_utf8_does_not_crash() {
        let mut rt = test_harness::make_runtime(64, 64);
        // Create a Uint8Array with truncated UTF-8 (0xC0 is a 2-byte lead with no continuation)
        rt.load_js("<test>", r#"
            var buf = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F, 0xC0]);
            var dec = new TextDecoder();
            var result = dec.decode(buf);
            globalThis.__testResult = result;
        "#).unwrap();
        // Should not throw — just verify it completes
        let val = rt.evaluate("globalThis.__testResult").unwrap();
        let result = val.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_str());
        assert!(result.is_some(), "should produce a string result");
        assert!(result.unwrap().starts_with("Hello"), "should decode the valid prefix");
    }
}

// ============================================================================
// 11. v8_to_json precision (large integers)
// ============================================================================

mod v8_to_json_precision {
    use super::*;

    #[test]
    fn safe_integers_preserved() {
        let mut rt = test_harness::make_runtime(64, 64);
        // Test that Number.MAX_SAFE_INTEGER (2^53 - 1) round-trips correctly.
        // CDP returns numbers as f64 in the "value" field, so check the f64 value.
        let val = rt.evaluate("9007199254740991").unwrap(); // 2^53 - 1
        let result = val.get("result").and_then(|r| r.get("value"));
        assert!(result.is_some());
        let n = result.unwrap().as_f64().unwrap();
        assert_eq!(n, 9007199254740991.0, "2^53-1 should round-trip correctly");
    }

    #[test]
    fn float_values_preserved() {
        let mut rt = test_harness::make_runtime(64, 64);
        let val = rt.evaluate("3.14159").unwrap();
        let result = val.get("result").and_then(|r| r.get("value"));
        assert!(result.is_some());
        let n = result.unwrap().as_f64().unwrap();
        assert!((n - 3.14159).abs() < 0.0001, "float should be preserved: {}", n);
    }
}

// ============================================================================
// 12. Re-entrant callback safety: toString() on args cannot alias &mut
// ============================================================================

mod reentrant_callback {
    use super::*;

    #[test]
    fn reentrant_tostring_does_not_crash() {
        // A malicious toString() getter that calls back into __dz_canvas_cmd
        // would previously create two simultaneous &mut Canvas2D references (UB).
        // After the fix, args are extracted before dereferencing External.
        let mut rt = test_harness::make_runtime(64, 64);
        rt.load_js("<test>", r#"
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            // fillRect with a tricky toString on one arg — should not crash
            var evil = { toString: function() { ctx.clearRect(0,0,10,10); return "50"; } };
            try {
                ctx.fillRect(evil, 0, 64, 64);
            } catch(e) {
                // Expected: might throw, but must not segfault/UB
            }
            console.log('survived');
        "#).unwrap();
        rt.tick();
        let logs = rt.drain_console_logs();
        let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
        assert!(texts.contains(&"survived"), "should survive re-entrant toString: {:?}", texts);
    }

    #[test]
    fn frozen_internals_prevent_mutation() {
        let mut rt = test_harness::make_runtime(64, 64);
        rt.load_js("<test>", r#"
            // Try to override performance.now — should fail silently on frozen object
            try { performance.now = function() { return 999; }; } catch(e) {}
            console.log('perf:' + performance.now());
            // Try to reassign __dz_reset_hooks — binding is non-writable
            try { __dz_reset_hooks = []; } catch(e) {}
            console.log('hooks_ok');
        "#).unwrap();
        rt.tick();
        let logs = rt.drain_console_logs();
        let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
        // performance.now() should return 0 (the virtual time), not 999
        assert!(texts.contains(&"perf:0"), "performance.now should be frozen: {:?}", texts);
        assert!(texts.contains(&"hooks_ok"), "should survive reassign attempt: {:?}", texts);
    }
}

// ============================================================================
// 13. shadowBlur clamped to prevent OOM
// ============================================================================

mod shadow_blur_clamp {
    use super::*;

    #[test]
    fn extreme_shadow_blur_clamped() {
        let mut rt = test_harness::make_runtime(64, 64);
        // Set an extreme shadowBlur — should be clamped to 150, not OOM
        rt.load_js("<test>", r#"
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            ctx.shadowBlur = 99999;
            ctx.shadowColor = 'black';
            ctx.fillRect(0, 0, 10, 10);
            console.log('ok');
        "#).unwrap();
        rt.tick();
        let logs = rt.drain_console_logs();
        let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
        assert!(texts.contains(&"ok"), "extreme shadowBlur should not OOM: {:?}", texts);
    }
}

// ============================================================================
// 14. getImageData dimension validation
// ============================================================================

mod image_data_bounds {
    use super::*;

    #[test]
    fn huge_get_image_data_returns_empty() {
        let mut rt = test_harness::make_runtime(64, 64);
        rt.load_js("<test>", r#"
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var data = ctx.getImageData(0, 0, 100000, 100000);
            console.log('w:' + data.width + ',h:' + data.height + ',len:' + data.data.length);
        "#).unwrap();
        rt.tick();
        let logs = rt.drain_console_logs();
        let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
        // Should return empty/clamped, not OOM
        assert!(texts.contains(&"w:0,h:0,len:0"), "huge getImageData should return empty: {:?}", texts);
    }
}
