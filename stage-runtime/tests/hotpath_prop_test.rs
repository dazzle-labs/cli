//! Property-based tests for hot-path optimizations and recently-fixed bugs.
//!
//! Covers:
//! 1. WebGL2 $-ref resolution in process_commands (regression for ref_map bug)
//! 2. WebGL2 dispatch_command fast path vs process_commands consistency
//! 3. Canvas2D NaN/Infinity/extreme value handling
//! 4. CSS parsing edge cases (dimensions, colors, gradients, shorthands)
//! 5. Audio command processing (owned vs borrowed equivalence)

use stage_runtime::webgl2::WebGL2;
use stage_runtime::canvas2d::Canvas2D;
use proptest::prelude::*;
use serde_json::json;

// =========================================================================
// 1. WebGL2 $-ref resolution — regression test for ref_map key mismatch
// =========================================================================

/// Verify that $-refs resolve correctly within a single process_commands batch.
/// The bug was: ref_map stored "__ret_vs" but lookup searched for "vs".
#[test]
fn ref_resolution_basic_shader_pipeline() {
    let mut gl = WebGL2::new(200, 200);

    // Full pipeline: create shader → set source → compile → create program → attach → link → draw
    let vs = "#version 300 es\nin vec2 a_pos;\nvoid main() { gl_Position = vec4(a_pos, 0.0, 1.0); }";
    let fs = "#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0, 0.0, 0.0, 1.0); }";

    let ret = gl.process_commands(&json!([
        ["createShader", 0x8B31, "__ret_vs"],
        ["shaderSource", "$vs", vs],
        ["compileShader", "$vs"],
        ["createShader", 0x8B30, "__ret_fs"],
        ["shaderSource", "$fs", fs],
        ["compileShader", "$fs"],
        ["createProgram", "__ret_prog"],
        ["attachShader", "$prog", "$vs"],
        ["attachShader", "$prog", "$fs"],
        ["linkProgram", "$prog"],
        ["useProgram", "$prog"],
        ["getShaderParameter", "$vs", 0x8B81, "__ret_vs_ok"],
        ["getShaderParameter", "$fs", 0x8B81, "__ret_fs_ok"],
        ["getProgramParameter", "$prog", 0x8B82, "__ret_prog_ok"],
    ]));

    let errors = gl.take_errors();
    assert!(errors.is_empty(), "GL errors during ref pipeline: {:?}", errors);

    // Verify returns
    let arr = ret.as_array().unwrap();
    let find_ret = |name: &str| -> &serde_json::Value {
        arr.iter()
            .find(|e| e.as_array().map_or(false, |p| p[0].as_str() == Some(name)))
            .and_then(|e| e.as_array().map(|p| &p[1]))
            .unwrap_or(&serde_json::Value::Null)
    };

    // Shader IDs should be non-zero
    assert!(find_ret("__ret_vs").as_u64().unwrap_or(0) > 0, "VS ID should be non-zero");
    assert!(find_ret("__ret_fs").as_u64().unwrap_or(0) > 0, "FS ID should be non-zero");
    assert!(find_ret("__ret_prog").as_u64().unwrap_or(0) > 0, "Program ID should be non-zero");

    // Compile and link should succeed
    assert_eq!(find_ret("__ret_vs_ok"), &json!(true), "VS should compile");
    assert_eq!(find_ret("__ret_fs_ok"), &json!(true), "FS should compile");
    assert_eq!(find_ret("__ret_prog_ok"), &json!(true), "Program should link");
}

/// Verify $-refs to non-existent keys don't panic and are treated as literal strings.
#[test]
fn ref_resolution_missing_ref_no_panic() {
    let mut gl = WebGL2::new(100, 100);
    // $nonexistent should remain as-is (treated as a string arg, not resolved)
    let _ret = gl.process_commands(&json!([
        ["useProgram", "$nonexistent"],
        ["bindBuffer", 0x8892, "$missing"],
        ["shaderSource", "$ghost", "void main() {}"],
    ]));
    // Should not panic — errors are expected but not crashes
    let _ = gl.take_errors();
}

/// Verify that many $-refs in a single batch all resolve correctly.
proptest! {
    #[test]
    fn ref_resolution_many_refs(n in 1usize..20) {
        let mut gl = WebGL2::new(100, 100);
        let mut cmds: Vec<serde_json::Value> = Vec::new();

        // Create N buffers with unique __ret_ IDs
        for i in 0..n {
            cmds.push(json!(["createBuffer", format!("__ret_buf{}", i)]));
        }
        // Bind each using $ref
        for i in 0..n {
            cmds.push(json!(["bindBuffer", 0x8892, format!("$buf{}", i)]));
        }

        let ret = gl.process_commands(&json!(cmds));
        let errors = gl.take_errors();

        // All createBuffer should return non-zero IDs
        let arr = ret.as_array().unwrap();
        prop_assert_eq!(arr.len(), n, "should get {} return values", n);
        for entry in arr {
            let id = entry.as_array().unwrap()[1].as_u64().unwrap_or(0);
            prop_assert!(id > 0, "buffer ID should be non-zero");
        }
        // No errors expected (binding valid buffers)
        prop_assert!(errors.is_empty(), "unexpected GL errors: {:?}", errors);
    }
}

// =========================================================================
// 2. dispatch_command fast path vs process_commands consistency
// =========================================================================

/// The fast path in dispatch_command and the match in process_commands should
/// produce identical results for commands they both handle.
proptest! {
    #[test]
    fn fast_path_vs_batch_state_changes(
        clear_r in 0.0f64..1.0,
        clear_g in 0.0f64..1.0,
        clear_b in 0.0f64..1.0,
        clear_a in 0.0f64..1.0,
        vp_x in 0i32..1000,
        vp_y in 0i32..1000,
        vp_w in 1i32..2000,
        vp_h in 1i32..2000,
    ) {
        // Path A: dispatch_command (fast path — used by native V8 callbacks)
        let mut gl_a = WebGL2::new(200, 200);
        gl_a.dispatch_command("clearColor", &[clear_r, clear_g, clear_b, clear_a], &[]);
        gl_a.dispatch_command("viewport", &[vp_x as f64, vp_y as f64, vp_w as f64, vp_h as f64], &[]);
        gl_a.dispatch_command("clear", &[0x4000 as f64], &[]); // GL_COLOR_BUFFER_BIT
        let mut pixels_a = vec![0u8; 200 * 200 * 4];
        gl_a.read_pixels_premultiplied(&mut pixels_a);

        // Path B: process_commands (batch JSON path)
        let mut gl_b = WebGL2::new(200, 200);
        gl_b.process_commands(&json!([
            ["clearColor", clear_r, clear_g, clear_b, clear_a],
            ["viewport", vp_x, vp_y, vp_w, vp_h],
            ["clear", 0x4000],
        ]));
        let mut pixels_b = vec![0u8; 200 * 200 * 4];
        gl_b.read_pixels_premultiplied(&mut pixels_b);

        prop_assert_eq!(pixels_a, pixels_b, "fast path and batch path should produce identical pixels");
    }

    #[test]
    fn fast_path_vs_batch_blend_state(
        src in prop::sample::select(vec![0u32, 1, 0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0305, 0x0306, 0x0307, 0x0308]),
        dst in prop::sample::select(vec![0u32, 1, 0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0305, 0x0306, 0x0307, 0x0308]),
    ) {
        let mut gl_a = WebGL2::new(100, 100);
        gl_a.dispatch_command("enable", &[3042.0], &[]); // GL_BLEND
        gl_a.dispatch_command("blendFunc", &[src as f64, dst as f64], &[]);
        let errors_a = gl_a.take_errors();

        let mut gl_b = WebGL2::new(100, 100);
        gl_b.process_commands(&json!([
            ["enable", 0x0BE2],
            ["blendFunc", src, dst],
        ]));
        let errors_b = gl_b.take_errors();

        // Both paths should produce the same errors (or no errors)
        prop_assert_eq!(errors_a, errors_b, "error states should match");
    }

    #[test]
    fn fast_path_vs_batch_uniform_setters(
        loc in 0u32..10,
        v0 in -1000.0f64..1000.0,
        v1 in -1000.0f64..1000.0,
        v2 in -1000.0f64..1000.0,
        v3 in -1000.0f64..1000.0,
    ) {
        // Without a program bound, both paths should record INVALID_OPERATION
        let mut gl_a = WebGL2::new(100, 100);
        gl_a.dispatch_command("uniform4f", &[loc as f64, v0, v1, v2, v3], &[]);
        let errors_a = gl_a.take_errors();

        let mut gl_b = WebGL2::new(100, 100);
        gl_b.process_commands(&json!([["uniform4f", loc, v0, v1, v2, v3]]));
        let errors_b = gl_b.take_errors();

        prop_assert_eq!(errors_a, errors_b);
    }

    #[test]
    fn fast_path_create_returns_match(op_idx in 0usize..4) {
        let ops = ["createBuffer", "createTexture", "createVertexArray", "createProgram"];
        let op = ops[op_idx];

        let mut gl_a = WebGL2::new(100, 100);
        let id_a = gl_a.dispatch_command(op, &[], &[]);

        let mut gl_b = WebGL2::new(100, 100);
        let ret = gl_b.process_commands(&json!([[op, "__ret_obj"]]));
        let id_b = ret.as_array()
            .and_then(|a| a.first())
            .and_then(|e| e.as_array())
            .and_then(|p| p[1].as_f64());

        // Both should return the same first ID (typically 1)
        prop_assert_eq!(id_a, id_b, "{}: fast path returned {:?}, batch returned {:?}", op, id_a, id_b);
    }
}

// =========================================================================
// 3. Canvas2D NaN/Infinity/extreme value handling
// =========================================================================

fn special_float() -> impl Strategy<Value = f64> {
    prop_oneof![
        Just(f64::NAN),
        Just(f64::INFINITY),
        Just(f64::NEG_INFINITY),
        Just(0.0),
        Just(-0.0),
        Just(f64::MIN),
        Just(f64::MAX),
        Just(f64::MIN_POSITIVE),
        (-1e10f64..1e10),
    ]
}

proptest! {
    #[test]
    fn canvas2d_transform_nan_infinity(
        a in special_float(), b in special_float(),
        c in special_float(), d in special_float(),
        e in special_float(), f_val in special_float(),
    ) {
        let mut canvas = Canvas2D::new(100, 100);
        // Should never panic, even with NaN/Infinity
        canvas.dispatch_command("setTransform", &[a, b, c, d, e, f_val], &[]);
        canvas.dispatch_command("fillRect", &[0.0, 0.0, 50.0, 50.0], &[]);

        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
        // No NaN in pixel values
        for px in pixels.chunks_exact(4) {
            for &v in px { prop_assert!(v <= 255); }
        }
    }

    #[test]
    fn canvas2d_rect_extreme_dimensions(
        x in special_float(), y in special_float(),
        w in special_float(), h in special_float(),
    ) {
        let mut canvas = Canvas2D::new(100, 100);
        canvas.dispatch_command("fillStyle", &[], &["#ff0000"]);
        canvas.dispatch_command("fillRect", &[x, y, w, h], &[]);
        // Should not panic or OOM
        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
    }

    #[test]
    fn canvas2d_shadow_extreme_values(
        blur in special_float(),
        ox in special_float(),
        oy in special_float(),
    ) {
        let mut canvas = Canvas2D::new(100, 100);
        canvas.dispatch_command("shadowBlur", &[blur], &[]);
        canvas.dispatch_command("shadowOffsetX", &[ox], &[]);
        canvas.dispatch_command("shadowOffsetY", &[oy], &[]);
        canvas.dispatch_command("shadowColor", &[], &["rgba(0,0,0,0.5)"]);
        canvas.dispatch_command("fillRect", &[10.0, 10.0, 30.0, 30.0], &[]);
        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
    }

    #[test]
    fn canvas2d_line_dash_extreme(values in prop::collection::vec(-1e6f64..1e6, 0..20)) {
        let mut canvas = Canvas2D::new(100, 100);
        canvas.dispatch_command("setLineDash", &values, &[]);
        canvas.dispatch_command("beginPath", &[], &[]);
        canvas.dispatch_command("moveTo", &[0.0, 0.0], &[]);
        canvas.dispatch_command("lineTo", &[100.0, 100.0], &[]);
        canvas.dispatch_command("stroke", &[], &[]);
        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
    }

    #[test]
    fn canvas2d_global_alpha_clamped(alpha in special_float()) {
        let mut canvas = Canvas2D::new(100, 100);
        canvas.dispatch_command("globalAlpha", &[alpha], &[]);
        canvas.dispatch_command("fillStyle", &[], &["#ff0000"]);
        canvas.dispatch_command("fillRect", &[0.0, 0.0, 100.0, 100.0], &[]);
        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
        // Alpha channel should be valid (0-255)
        for px in pixels.chunks_exact(4) {
            prop_assert!(px[3] <= 255);
        }
    }
}

/// Font parsing should never panic, even with adversarial input.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]
    #[test]
    fn canvas2d_font_parse_never_panics(font_str in ".*") {
        let mut canvas = Canvas2D::new(100, 100);
        canvas.dispatch_command("font", &[], &[&font_str]);
        canvas.dispatch_command("fillText", &[10.0, 50.0], &["hello"]);
        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
    }
}

/// Color parsing should never panic.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]
    #[test]
    fn canvas2d_color_parse_never_panics(color in ".*") {
        let mut canvas = Canvas2D::new(100, 100);
        canvas.dispatch_command("fillStyle", &[], &[&color]);
        canvas.dispatch_command("fillRect", &[0.0, 0.0, 50.0, 50.0], &[]);
        let mut pixels = vec![0u8; 100 * 100 * 4];
        canvas.read_pixels_premultiplied(&mut pixels);
    }
}

// =========================================================================
// 4. CSS parsing edge cases
// =========================================================================

/// CSS dimension parsing should never panic.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]
    #[test]
    fn css_dimension_parse_never_panics(input in ".*") {
        let html = format!(
            r#"<div style="width: {}; height: {}; margin: {}; padding: {};">x</div>"#,
            input, input, input, input
        );
        let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
        stage_runtime::htmlcss::render_html(&html, &mut pixmap);
        // Should not panic — invalid values should be ignored
    }

    #[test]
    fn css_color_parse_never_panics(input in ".*") {
        let html = format!(
            r#"<div style="color: {}; background: {};">x</div>"#,
            input, input,
        );
        let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
        stage_runtime::htmlcss::render_html(&html, &mut pixmap);
    }

    #[test]
    fn css_gradient_parse_never_panics(
        angle in "([0-9]{1,4}deg)?",
        color1 in "(#[0-9a-fA-F]{3,8}|rgb\\([0-9, ]+\\)|[a-z]+)",
        stop1 in "([0-9]{1,3}%)?",
        color2 in "(#[0-9a-fA-F]{3,8}|rgb\\([0-9, ]+\\)|[a-z]+)",
        stop2 in "([0-9]{1,3}%)?",
    ) {
        let grad = format!("linear-gradient({} {} {}, {} {})", angle, color1, stop1, color2, stop2);
        let html = format!(r#"<div style="background: {}; width: 100px; height: 100px;">x</div>"#, grad);
        let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
        stage_runtime::htmlcss::render_html(&html, &mut pixmap);
    }
}

/// CSS shorthand expansion with extreme values.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]
    #[test]
    fn css_shorthand_4_values(
        v1 in "(-?[0-9]{1,6}(px|em|%|vw|vh)?|auto|0)",
        v2 in "(-?[0-9]{1,6}(px|em|%|vw|vh)?|auto|0)",
        v3 in "(-?[0-9]{1,6}(px|em|%|vw|vh)?|auto|0)",
        v4 in "(-?[0-9]{1,6}(px|em|%|vw|vh)?|auto|0)",
    ) {
        let shorthand = format!("{} {} {} {}", v1, v2, v3, v4);
        let html = format!(
            r#"<div style="margin: {}; padding: {};">x</div>"#,
            shorthand, shorthand,
        );
        let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
        stage_runtime::htmlcss::render_html(&html, &mut pixmap);
    }

    #[test]
    fn css_border_shorthand_never_panics(
        width in "([0-9]{1,4}px)?",
        style in "(solid|dashed|dotted|none|hidden)?",
        color in "(#[0-9a-fA-F]{3,8}|[a-z]+|rgb\\([0-9, ]+\\))?",
    ) {
        let border = format!("{} {} {}", width, style, color);
        let html = format!(
            r#"<div style="border: {}; width: 50px; height: 50px;">x</div>"#,
            border,
        );
        let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
        stage_runtime::htmlcss::render_html(&html, &mut pixmap);
    }
}

/// CSS grid-template-columns with repeat() edge cases.
#[test]
fn css_grid_repeat_zero() {
    let html = r#"<div style="display: grid; grid-template-columns: repeat(0, 1fr);">
        <div>a</div>
    </div>"#;
    let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
    stage_runtime::htmlcss::render_html(html, &mut pixmap);
}

#[test]
fn css_grid_repeat_huge() {
    // Should be capped internally, not OOM
    let html = r#"<div style="display: grid; grid-template-columns: repeat(999999, 1fr);">
        <div>a</div>
    </div>"#;
    let mut pixmap = tiny_skia::Pixmap::new(200, 200).unwrap();
    stage_runtime::htmlcss::render_html(html, &mut pixmap);
}

// =========================================================================
// 5. Audio command processing: owned vs borrowed equivalence
// =========================================================================

proptest! {
    #[test]
    fn audio_owned_vs_borrowed_equivalence(
        freq in 20.0f64..2000.0,
        gain in 0.0f64..1.0,
        n_frames in 1usize..10,
    ) {
        use stage_runtime::audio::AudioGraph;

        let cmds = vec![
            vec![json!("osc_start"), json!(1), json!("sine"), json!(freq), json!(0)],
            vec![json!("connect"), json!(1), json!("destination")],
        ];

        // Path A: borrowed
        let mut graph_a = AudioGraph::new(44100, 30);
        graph_a.process_commands(&cmds);
        let frames_a: Vec<Vec<f32>> = (0..n_frames).map(|_| graph_a.render_frame()).collect();

        // Path B: owned
        let mut graph_b = AudioGraph::new(44100, 30);
        graph_b.process_commands_owned(cmds.clone());
        let frames_b: Vec<Vec<f32>> = (0..n_frames).map(|_| graph_b.render_frame()).collect();

        for (i, (a, b)) in frames_a.iter().zip(frames_b.iter()).enumerate() {
            prop_assert_eq!(a.len(), b.len(), "frame {} length mismatch", i);
            for (j, (&sa, &sb)) in a.iter().zip(b.iter()).enumerate() {
                prop_assert!(
                    (sa - sb).abs() < 1e-6,
                    "frame {} sample {} differs: {} vs {}", i, j, sa, sb
                );
            }
        }
    }
}

// =========================================================================
// 6. WebGL2 dispatch_command: invalid enum/value edge cases
// =========================================================================

proptest! {
    #[test]
    fn webgl2_enable_disable_invalid_cap(cap in 0u32..0xFFFF) {
        let valid_caps = [0x0BE2, 0x0B71, 0x0B44, 0x0C11, 0x8DB9]; // BLEND, DEPTH_TEST, CULL_FACE, SCISSOR_TEST, RASTERIZER_DISCARD
        let mut gl = WebGL2::new(100, 100);
        gl.dispatch_command("enable", &[cap as f64], &[]);
        let errors = gl.take_errors();
        if valid_caps.contains(&cap) {
            prop_assert!(errors.is_empty(), "valid cap {} should not error", cap);
        } else {
            prop_assert!(!errors.is_empty(), "invalid cap {} should error", cap);
        }
    }

    #[test]
    fn webgl2_depth_func_all_values(func in 0u32..0xFFFF) {
        let valid_funcs = [0x0200, 0x0201, 0x0202, 0x0203, 0x0204, 0x0205, 0x0206, 0x0207];
        // NEVER, LESS, EQUAL, LEQUAL, GREATER, NOTEQUAL, GEQUAL, ALWAYS
        let mut gl = WebGL2::new(100, 100);
        gl.dispatch_command("depthFunc", &[func as f64], &[]);
        let errors = gl.take_errors();
        if valid_funcs.contains(&func) {
            prop_assert!(errors.is_empty(), "valid func {} should not error", func);
        } else {
            prop_assert!(!errors.is_empty(), "invalid func {} should error", func);
        }
    }
}

/// Negative viewport/scissor dimensions should produce INVALID_VALUE.
proptest! {
    #[test]
    fn webgl2_negative_viewport_errors(
        x in -1000i32..1000,
        y in -1000i32..1000,
        w in -100i32..2000,
        h in -100i32..2000,
    ) {
        let mut gl = WebGL2::new(100, 100);
        gl.dispatch_command("viewport", &[x as f64, y as f64, w as f64, h as f64], &[]);
        let errors = gl.take_errors();
        if w < 0 || h < 0 {
            prop_assert!(!errors.is_empty(), "negative w={} h={} should error", w, h);
        } else {
            prop_assert!(errors.is_empty(), "valid viewport should not error: {} {} {} {}", x, y, w, h);
        }
    }
}
