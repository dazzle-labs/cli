//! Property-based fuzz tests for the WebGL2 context public API.
//! Tests: WebGL2::new(), process_commands(), read_pixels().

use stage_runtime::webgl2::WebGL2;
use proptest::prelude::*;
use serde_json::json;

// GL constants (duplicated here since they're private in the module)
const GL_VERTEX_SHADER: u32 = 0x8B31;
const GL_FRAGMENT_SHADER: u32 = 0x8B30;
const GL_ARRAY_BUFFER: u32 = 0x8892;
const GL_ELEMENT_ARRAY_BUFFER: u32 = 0x8893;
const GL_STATIC_DRAW: u32 = 0x88E4;
const GL_BLEND: u32 = 0x0BE2;
const GL_DEPTH_TEST: u32 = 0x0B71;
const GL_CULL_FACE: u32 = 0x0B44;
const GL_SCISSOR_TEST: u32 = 0x0C11;
const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_COLOR_BUFFER_BIT: u32 = 0x4000;
const GL_DEPTH_BUFFER_BIT: u32 = 0x0100;
const GL_UNSIGNED_SHORT: u32 = 0x1403;
const GL_UNSIGNED_INT: u32 = 0x1405;

fn random_op() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("createShader".to_string()),
        Just("createProgram".to_string()),
        Just("createBuffer".to_string()),
        Just("createTexture".to_string()),
        Just("bindBuffer".to_string()),
        Just("bufferData".to_string()),
        Just("vertexAttribPointer".to_string()),
        Just("enableVertexAttribArray".to_string()),
        Just("drawArrays".to_string()),
        Just("drawElements".to_string()),
        Just("texImage2D".to_string()),
        Just("clear".to_string()),
        Just("clearColor".to_string()),
        Just("viewport".to_string()),
        Just("enable".to_string()),
        Just("disable".to_string()),
        Just("uniform1f".to_string()),
        Just("uniform4f".to_string()),
        Just("uniformMatrix4fv".to_string()),
        Just("blendFunc".to_string()),
        Just("depthFunc".to_string()),
        Just("colorMask".to_string()),
        Just("useProgram".to_string()),
        Just("".to_string()),
        Just("fakeCommand".to_string()),
        Just("__proto__".to_string()),
    ]
}

fn random_arg() -> impl Strategy<Value = serde_json::Value> {
    prop_oneof![
        any::<f64>().prop_map(|f| json!(f)),
        Just(json!(0)),
        Just(json!(-1)),
        Just(json!(u32::MAX as f64)),
        Just(json!(f64::NAN)),
        Just(json!(f64::INFINITY)),
        Just(json!(f64::NEG_INFINITY)),
        any::<bool>().prop_map(|b| json!(b)),
        "[a-zA-Z_]{0,20}".prop_map(|s| json!(s)),
        Just(json!(null)),
        prop::collection::vec(
            prop_oneof![
                any::<f64>().prop_map(|f| json!(f)),
                Just(json!(0)),
                Just(json!(255)),
            ],
            0..20
        ).prop_map(|v| json!(v)),
    ]
}

fn random_command() -> impl Strategy<Value = serde_json::Value> {
    (random_op(), prop::collection::vec(random_arg(), 0..10))
        .prop_map(|(op, args)| {
            let mut cmd = vec![json!(op)];
            cmd.extend(args);
            json!(cmd)
        })
}

fn random_command_batch() -> impl Strategy<Value = serde_json::Value> {
    prop::collection::vec(random_command(), 0..8)
        .prop_map(|cmds| json!(cmds))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    #[test]
    fn fuzz_process_commands_never_panics(batch in random_command_batch()) {
        let mut gl = WebGL2::new(8, 8);
        let _ = gl.process_commands(&batch);
    }

    #[test]
    fn fuzz_process_commands_wrong_shapes(
        input in prop_oneof![
            Just(json!(null)),
            Just(json!(42)),
            Just(json!("hello")),
            Just(json!(true)),
            Just(json!({})),
            Just(json!([null])),
            Just(json!([42])),
            Just(json!([true])),
            Just(json!([{}])),
            Just(json!([[]])),
            Just(json!([[null, null]])),
            Just(json!([[42, 42]])),
        ]
    ) {
        let mut gl = WebGL2::new(4, 4);
        let _ = gl.process_commands(&input);
    }

    #[test]
    fn fuzz_vertex_attrib_pointer(
        loc in 0u32..32,
        size in 0u32..256,
        dtype in prop_oneof![Just(0x1406u32), Just(0x1400u32), Just(0u32), Just(u32::MAX)],
        stride in 0u32..1000,
        offset in 0u32..1000,
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["createBuffer", "__ret_buf"],
            ["bindBuffer", GL_ARRAY_BUFFER, 1],
            ["vertexAttribPointer", loc, size, dtype, false, stride, offset],
            ["enableVertexAttribArray", loc],
        ]));
    }

    #[test]
    fn fuzz_tex_image_2d_size_mismatch(
        width in 0u32..256,
        height in 0u32..256,
        data_len in 0usize..256,
        flip_y in any::<bool>(),
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([["createTexture", "__ret_tex"]]));
        if flip_y {
            gl.process_commands(&json!([["pixelStorei", 0x9240, true]]));
        }
        let data: Vec<serde_json::Value> = (0..data_len).map(|i| json!((i % 256) as u8)).collect();
        gl.process_commands(&json!([
            ["bindTexture", GL_TEXTURE_2D, 1],
            ["texImage2D", GL_TEXTURE_2D, 0, 0x1908, width, height, 0, 0x1908, 0x1401, data]
        ]));
    }

    #[test]
    fn fuzz_tex_image_2d_overflow_width(
        width in prop_oneof![
            Just(u32::MAX),
            Just(u32::MAX / 4 + 1),
            Just(u32::MAX / 2),
            Just(0x40000000u32),
        ],
        height in 1u32..4,
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([["createTexture", "__ret_tex"]]));
        let data = json!([0, 0, 0, 255, 255, 0, 0, 255]);
        gl.process_commands(&json!([
            ["bindTexture", GL_TEXTURE_2D, 1],
            ["texImage2D", GL_TEXTURE_2D, 0, 0x1908, width, height, 0, 0x1908, 0x1401, data]
        ]));
    }

    #[test]
    fn fuzz_draw_arrays_bounds(
        mode in prop_oneof![Just(0u32), Just(1u32), Just(4u32), Just(5u32), Just(6u32), Just(99u32)],
        first in 0u32..1000,
        count in 0u32..1000,
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["createBuffer", "__ret_buf"],
            ["bindBuffer", GL_ARRAY_BUFFER, 1],
            ["bufferData", GL_ARRAY_BUFFER, [0.0, 0.0, 1.0, 0.0, 0.5, 1.0], GL_STATIC_DRAW],
            ["vertexAttribPointer", 0, 2, 0x1406, false, 0, 0],
            ["enableVertexAttribArray", 0],
            ["clearColor", 0, 0, 0, 1],
            ["clear", GL_COLOR_BUFFER_BIT],
            ["drawArrays", mode, first, count],
        ]));
    }

    #[test]
    fn fuzz_draw_elements_bounds(
        count in 0u32..200,
        offset in 0u32..1000,
        dtype in prop_oneof![Just(GL_UNSIGNED_SHORT), Just(GL_UNSIGNED_INT), Just(0u32), Just(u32::MAX)],
        index_data in prop::collection::vec(0u16..100, 0..30),
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["createBuffer", "__ret_vbuf"],
            ["bindBuffer", GL_ARRAY_BUFFER, 1],
            ["bufferData", GL_ARRAY_BUFFER, [0.0, 0.0, 1.0, 0.0, 0.5, 1.0], GL_STATIC_DRAW],
            ["vertexAttribPointer", 0, 2, 0x1406, false, 0, 0],
            ["enableVertexAttribArray", 0],
        ]));
        let idx_floats: Vec<f64> = index_data.iter().map(|&i| i as f64).collect();
        gl.process_commands(&json!([
            ["createBuffer", "__ret_ibuf"],
            ["bindBuffer", GL_ELEMENT_ARRAY_BUFFER, 2],
            ["bufferData", GL_ELEMENT_ARRAY_BUFFER, idx_floats, GL_STATIC_DRAW],
            ["clearColor", 0, 0, 0, 1],
            ["clear", GL_COLOR_BUFFER_BIT],
            ["drawElements", 4, count, dtype, offset],
        ]));
    }

    #[test]
    fn fuzz_read_pixels_buffer_sizes(buf_size in 0usize..200) {
        let mut gl = WebGL2::new(4, 4);
        let mut output = vec![0u8; buf_size];
        gl.read_pixels(&mut output);
    }

    #[test]
    fn fuzz_uniform_values(
        loc in 0u32..100,
        f1 in any::<f64>(),
        f2 in any::<f64>(),
        f3 in any::<f64>(),
        f4 in any::<f64>(),
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["uniform1f", loc, f1],
            ["uniform2f", loc, f1, f2],
            ["uniform3f", loc, f1, f2, f3],
            ["uniform4f", loc, f1, f2, f3, f4],
        ]));
    }

    #[test]
    fn fuzz_uniform_matrix(
        loc in 0u32..100,
        matrix in prop::collection::vec(any::<f64>(), 0..20),
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([["uniformMatrix4fv", loc, false, matrix]]));
    }

    #[test]
    fn fuzz_buffer_data(data in prop::collection::vec(any::<f64>(), 0..100)) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["createBuffer", "__ret_buf"],
            ["bindBuffer", GL_ARRAY_BUFFER, 1],
            ["bufferData", GL_ARRAY_BUFFER, data, GL_STATIC_DRAW],
        ]));
    }

    #[test]
    fn fuzz_full_pipeline(
        vs_src in "[^\x00]{0,200}",
        fs_src in "[^\x00]{0,200}",
        vertex_data in prop::collection::vec(any::<f32>().prop_map(|f| if f.is_finite() { f } else { 0.0 }), 0..30),
        draw_mode in prop_oneof![Just(0u32), Just(1u32), Just(4u32), Just(5u32), Just(6u32)],
        draw_count in 0u32..20,
    ) {
        let mut gl = WebGL2::new(8, 8);
        let vd: Vec<f64> = vertex_data.iter().map(|&f| f as f64).collect();
        gl.process_commands(&json!([
            ["createShader", GL_VERTEX_SHADER, "__ret_vs"],
            ["shaderSource", 1, vs_src],
            ["compileShader", 1],
            ["createShader", GL_FRAGMENT_SHADER, "__ret_fs"],
            ["shaderSource", 2, fs_src],
            ["compileShader", 2],
            ["createProgram", "__ret_prog"],
            ["attachShader", 3, 1],
            ["attachShader", 3, 2],
            ["linkProgram", 3],
            ["useProgram", 3],
            ["createBuffer", "__ret_buf"],
            ["bindBuffer", GL_ARRAY_BUFFER, 4],
            ["bufferData", GL_ARRAY_BUFFER, vd, GL_STATIC_DRAW],
            ["vertexAttribPointer", 0, 2, 0x1406, false, 0, 0],
            ["enableVertexAttribArray", 0],
            ["clearColor", 0.0, 0.0, 0.0, 1.0],
            ["clear", GL_COLOR_BUFFER_BIT],
            ["drawArrays", draw_mode, 0, draw_count],
        ]));
        let mut output = vec![0u8; 8 * 8 * 4];
        gl.read_pixels(&mut output);
    }

    #[test]
    fn fuzz_state_transitions(
        blend in any::<bool>(),
        depth in any::<bool>(),
        cull in any::<bool>(),
        scissor in any::<bool>(),
        clear_r in 0.0f32..1.0,
        clear_g in 0.0f32..1.0,
        clear_b in 0.0f32..1.0,
        clear_a in 0.0f32..1.0,
    ) {
        let mut gl = WebGL2::new(4, 4);
        if blend { gl.process_commands(&json!([["enable", GL_BLEND]])); }
        if depth { gl.process_commands(&json!([["enable", GL_DEPTH_TEST]])); }
        if cull { gl.process_commands(&json!([["enable", GL_CULL_FACE]])); }
        if scissor { gl.process_commands(&json!([["enable", GL_SCISSOR_TEST]])); }
        gl.process_commands(&json!([
            ["clearColor", clear_r, clear_g, clear_b, clear_a],
            ["clear", GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT],
        ]));
        let mut output = vec![0u8; 4 * 4 * 4];
        gl.read_pixels(&mut output);
    }

    #[test]
    fn fuzz_blend_factors(
        src in any::<u32>(),
        dst in any::<u32>(),
        src_a in any::<u32>(),
        dst_a in any::<u32>(),
    ) {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["enable", GL_BLEND],
            ["blendFuncSeparate", src, dst, src_a, dst_a],
            ["clearColor", 0.5, 0.5, 0.5, 0.5],
            ["clear", GL_COLOR_BUFFER_BIT],
        ]));
    }
}
