//! Property-based fuzz tests for the GLSL preprocessing pipeline.
//! Tests the public API: preprocess_glsl, compile_glsl_to_wgsl.

use dazzle_render::webgl2::{preprocess_glsl, compile_glsl_to_wgsl};
use proptest::prelude::*;

// -- Strategies for generating GLSL-like fragments --

fn glsl_ident() -> impl Strategy<Value = String> {
    "[a-zA-Z_][a-zA-Z0-9_]{0,15}".prop_filter("avoid GLSL keywords", |s| {
        !matches!(s.as_str(),
            "in" | "out" | "uniform" | "void" | "float" | "int" | "vec2"
            | "vec3" | "vec4" | "mat3" | "mat4" | "sampler2D" | "bool"
            | "if" | "else" | "for" | "while" | "return" | "true" | "false"
            | "precision" | "layout" | "texture" | "main"
        )
    })
}

fn glsl_type() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("float"), Just("int"), Just("bool"),
        Just("vec2"), Just("vec3"), Just("vec4"),
        Just("mat3"), Just("mat4"),
    ]
}

fn line_comment() -> impl Strategy<Value = String> {
    "[ -~]{0,80}".prop_map(|s| format!("// {}", s))
}

fn block_comment() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 ,.!?_=+\\-]{0,60}".prop_map(|s| format!("/* {} */", s))
}

fn global_decl() -> impl Strategy<Value = String> {
    prop_oneof![
        (glsl_type(), glsl_ident()).prop_map(|(t, n)| format!("in {} {};", t, n)),
        (glsl_type(), glsl_ident()).prop_map(|(t, n)| format!("out {} {};", t, n)),
        (glsl_type(), glsl_ident()).prop_map(|(t, n)| format!("uniform {} {};", t, n)),
        glsl_ident().prop_map(|n| format!("uniform sampler2D {};", n)),
    ]
}

fn body_line() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("    gl_PointSize = 10.0;".to_string()),
        Just("    gl_Position = vec4(0.0, 0.0, 0.0, 1.0);".to_string()),
        glsl_ident().prop_map(|n| format!("    float {} = 1.0;", n)),
        line_comment().prop_map(|c| format!("    {}", c)),
        block_comment().prop_map(|c| format!("    {}", c)),
        glsl_ident().prop_map(|n| format!("    vec4 tmp = texture({}, vec2(0.0));", n)),
    ]
}

fn random_glsl_source() -> impl Strategy<Value = String> {
    (
        prop::collection::vec(
            prop_oneof![global_decl(), line_comment(), block_comment()],
            0..6
        ),
        prop::collection::vec(body_line(), 0..9),
        any::<bool>(),
        any::<bool>(),
    ).prop_map(|(decls, body, has_version, has_precision)| {
        let mut lines = Vec::new();
        if has_version { lines.push("#version 300 es".to_string()); }
        if has_precision { lines.push("precision mediump float;".to_string()); }
        for d in &decls { lines.push(d.clone()); }
        lines.push("void main() {".to_string());
        for b in &body { lines.push(b.clone()); }
        lines.push("}".to_string());
        lines.join("\n")
    })
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    #[test]
    fn fuzz_preprocess_never_panics_vertex(src in "([^\x00]{0,300}\n){0,30}") {
        let _ = preprocess_glsl(&src, naga::ShaderStage::Vertex);
    }

    #[test]
    fn fuzz_preprocess_never_panics_fragment(src in "([^\x00]{0,300}\n){0,30}") {
        let _ = preprocess_glsl(&src, naga::ShaderStage::Fragment);
    }

    #[test]
    fn fuzz_compile_never_panics(src in "([^\x00]{0,200}\n){0,20}") {
        let _ = compile_glsl_to_wgsl(&src, naga::ShaderStage::Vertex);
        let _ = compile_glsl_to_wgsl(&src, naga::ShaderStage::Fragment);
    }

    #[test]
    fn fuzz_preprocess_strips_version_and_precision(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (out, _) = preprocess_glsl(&src, stage);
            prop_assert!(!out.contains("#version"));
            for line in out.lines() {
                prop_assert!(!line.trim().starts_with("precision "));
            }
        }
    }

    #[test]
    fn fuzz_all_global_io_get_layout(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (out, _) = preprocess_glsl(&src, stage);
            let mut depth = 0u32;
            for line in out.lines() {
                let t = line.trim();
                let opens = t.chars().filter(|&c| c == '{').count() as u32;
                let closes = t.chars().filter(|&c| c == '}').count() as u32;
                if depth == 0
                    && (t.starts_with("in ") || t.starts_with("out "))
                    && t.ends_with(';')
                {
                    prop_assert!(t.contains("layout("),
                        "global in/out must have layout(): {:?} (stage={:?})", t, stage);
                }
                depth = depth.wrapping_add(opens).wrapping_sub(closes);
            }
        }
    }

    #[test]
    fn fuzz_all_global_uniforms_get_binding(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (out, _) = preprocess_glsl(&src, stage);
            let mut depth = 0u32;
            for line in out.lines() {
                let t = line.trim();
                let opens = t.chars().filter(|&c| c == '{').count() as u32;
                let closes = t.chars().filter(|&c| c == '}').count() as u32;
                if depth == 0 && t.starts_with("uniform ") && t.ends_with(';') {
                    prop_assert!(t.contains("layout("), "uniform must have layout(): {:?}", t);
                }
                if depth == 0 && t.contains("uniform texture2D") && t.ends_with(';') {
                    prop_assert!(t.contains("layout("), "rewritten texture2D must have layout(): {:?}", t);
                }
                if depth == 0 && t.contains("uniform sampler ") && t.ends_with(';') {
                    prop_assert!(t.contains("layout("), "rewritten sampler must have layout(): {:?}", t);
                }
                depth = depth.wrapping_add(opens).wrapping_sub(closes);
            }
        }
    }

    #[test]
    fn fuzz_no_duplicate_bindings(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (out, _) = preprocess_glsl(&src, stage);
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            for line in out.lines() {
                let t = line.trim();
                if let Some(start) = t.find("layout(set=") {
                    if let Some(end) = t[start..].find(')') {
                        let key = &t[start..start+end+1];
                        prop_assert!(seen.insert(key.to_string()),
                            "duplicate binding: {} in output:\n{}", key, out);
                    }
                }
            }
        }
    }

    #[test]
    fn fuzz_pointsize_stripped_from_body(src in random_glsl_source()) {
        let (out, _) = preprocess_glsl(&src, naga::ShaderStage::Vertex);
        let mut depth = 0u32;
        for line in out.lines() {
            let t = line.trim();
            let opens = t.chars().filter(|&c| c == '{').count() as u32;
            let closes = t.chars().filter(|&c| c == '}').count() as u32;
            if depth > 0 {
                prop_assert!(!t.contains("gl_PointSize"),
                    "gl_PointSize must not appear inside function body: {:?}", t);
            }
            depth = depth.wrapping_add(opens).wrapping_sub(closes);
        }
    }

    #[test]
    fn fuzz_depth_remap_vertex_only(src in random_glsl_source()) {
        let remap = "gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5";
        let (vs_out, _) = preprocess_glsl(&src, naga::ShaderStage::Vertex);
        let (fs_out, _) = preprocess_glsl(&src, naga::ShaderStage::Fragment);
        if vs_out.contains("void main()") {
            let count = vs_out.matches(remap).count();
            prop_assert_eq!(count, 1, "vertex must have exactly one depth remap");
        }
        prop_assert!(!fs_out.contains(remap), "fragment must not have depth remap");
    }

    #[test]
    fn fuzz_sampler_texture_calls_rewritten(src in random_glsl_source()) {
        let (out, layout) = preprocess_glsl(&src, naga::ShaderStage::Fragment);
        for (_, _, name) in &layout.texture_bindings {
            let bare = format!("texture({},", name);
            let bare2 = format!("texture({}, ", name);
            prop_assert!(!out.contains(&bare) && !out.contains(&bare2),
                "texture({}) call not rewritten", name);
        }
    }

    #[test]
    fn fuzz_layout_group_matches_stage(src in random_glsl_source()) {
        let (_, vs) = preprocess_glsl(&src, naga::ShaderStage::Vertex);
        let (_, fs) = preprocess_glsl(&src, naga::ShaderStage::Fragment);
        prop_assert_eq!(vs.group, 0);
        prop_assert_eq!(fs.group, 1);
    }

    #[test]
    fn fuzz_binding_count_matches_emitted(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (out, layout) = preprocess_glsl(&src, stage);
            let emitted = out.lines()
                .filter(|l| l.trim().contains("layout(set=") && l.trim().contains("binding="))
                .count() as u32;
            prop_assert_eq!(layout.binding_count, emitted);
        }
    }

    #[test]
    fn fuzz_preprocess_idempotent(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (first, _) = preprocess_glsl(&src, stage);
            let (second, _) = preprocess_glsl(&first, stage);
            prop_assert_eq!(first, second, "preprocessing must be idempotent");
        }
    }

    #[test]
    fn fuzz_varying_locations_match_across_stages(
        types in prop::collection::vec(glsl_type(), 1..6),
    ) {
        let varyings: Vec<(&str, String)> = types.iter()
            .enumerate()
            .map(|(i, t)| (*t, format!("v_{}", i)))
            .collect();

        let mut vs_lines = vec!["#version 300 es".to_string(), "in vec2 a_pos;".to_string()];
        for (ty, name) in &varyings { vs_lines.push(format!("out {} {};", ty, name)); }
        vs_lines.push("void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }".to_string());

        let mut fs_lines = vec!["#version 300 es".to_string(), "precision mediump float;".to_string()];
        for (ty, name) in &varyings { fs_lines.push(format!("in {} {};", ty, name)); }
        fs_lines.push("out vec4 fragColor;".to_string());
        fs_lines.push("void main() { fragColor = vec4(1.0); }".to_string());

        let (vs_out, _) = preprocess_glsl(&vs_lines.join("\n"), naga::ShaderStage::Vertex);
        let (fs_out, _) = preprocess_glsl(&fs_lines.join("\n"), naga::ShaderStage::Fragment);

        for (i, (_, name)) in varyings.iter().enumerate() {
            let loc = format!("layout(location={}) ", i);
            let vs_line = vs_out.lines().find(|l| l.contains("out ") && l.contains(name.as_str())).unwrap_or("");
            let fs_line = fs_out.lines().find(|l| l.contains("in ") && l.contains(name.as_str())).unwrap_or("");
            prop_assert!(vs_line.contains(&loc), "VS {} should have loc {}: {:?}", name, i, vs_line);
            prop_assert!(fs_line.contains(&loc), "FS {} should have loc {}: {:?}", name, i, fs_line);
        }
    }

    #[test]
    fn fuzz_no_sampler2d_in_output(src in random_glsl_source()) {
        for stage in [naga::ShaderStage::Vertex, naga::ShaderStage::Fragment] {
            let (out, _) = preprocess_glsl(&src, stage);
            for line in out.lines() {
                let t = line.trim();
                prop_assert!(!(t.starts_with("uniform") && t.contains("sampler2D")),
                    "sampler2D should be rewritten: {:?}", t);
            }
        }
    }

    #[test]
    fn fuzz_uniform_after_sampler_gets_correct_binding(
        n_samplers in 1..4usize,
        n_uniforms in 1..4usize,
    ) {
        let mut lines = vec!["#version 300 es".to_string(), "precision mediump float;".to_string()];
        for i in 0..n_samplers { lines.push(format!("uniform sampler2D u_tex{};", i)); }
        for i in 0..n_uniforms { lines.push(format!("uniform vec4 u_val{};", i)); }
        lines.push("in vec2 v_uv;".to_string());
        lines.push("out vec4 fragColor;".to_string());
        lines.push("void main() { fragColor = vec4(1.0); }".to_string());

        let (out, layout) = preprocess_glsl(&lines.join("\n"), naga::ShaderStage::Fragment);
        prop_assert_eq!(layout.texture_bindings.len(), n_samplers);
        // All non-sampler uniforms go into one block, so binding_count = samplers*2 + 1
        prop_assert_eq!(layout.binding_count, (n_samplers * 2 + 1) as u32);
        prop_assert_eq!(layout.uniform_binding, Some((n_samplers * 2) as u32));
        prop_assert_eq!(layout.uniform_names.len(), n_uniforms);
        // Check the uniform block contains all members
        for i in 0..n_uniforms {
            prop_assert!(out.contains(&format!("vec4 u_val{};", i)), "missing u_val{} in block", i);
        }
    }

    #[test]
    fn fuzz_texture_binding_pairs_consecutive(n_samplers in 1..5usize) {
        let mut lines = vec!["#version 300 es".to_string(), "precision mediump float;".to_string()];
        for i in 0..n_samplers { lines.push(format!("uniform sampler2D u_s{};", i)); }
        lines.push("in vec2 v_uv;".to_string());
        lines.push("out vec4 fragColor;".to_string());
        lines.push("void main() { fragColor = vec4(1.0); }".to_string());

        let (_, layout) = preprocess_glsl(&lines.join("\n"), naga::ShaderStage::Fragment);
        for (i, (tex_b, sam_b, _)) in layout.texture_bindings.iter().enumerate() {
            prop_assert_eq!(*tex_b, (i * 2) as u32);
            prop_assert_eq!(*sam_b, (i * 2 + 1) as u32);
        }
    }

    #[test]
    fn fuzz_torture_random_with_keywords(
        prefix in "[^\x00]{0,50}",
        keyword in prop_oneof![
            Just("in "), Just("out "), Just("uniform "),
            Just("uniform sampler2D"), Just("gl_PointSize"),
            Just("#version"), Just("precision "), Just("//"),
            Just("/*"), Just("*/"), Just("texture("),
            Just("{"), Just("}"), Just("void main()"),
        ],
        suffix in "[^\x00]{0,50}",
    ) {
        let src = format!("{}{}{}", prefix, keyword, suffix);
        let _ = preprocess_glsl(&src, naga::ShaderStage::Vertex);
        let _ = preprocess_glsl(&src, naga::ShaderStage::Fragment);
        let _ = compile_glsl_to_wgsl(&src, naga::ShaderStage::Vertex);
        let _ = compile_glsl_to_wgsl(&src, naga::ShaderStage::Fragment);
    }

    #[test]
    fn fuzz_unbalanced_braces_no_panic(opens in 0..10u32, closes in 0..10u32) {
        let mut src = String::from("#version 300 es\nin vec2 a_pos;\n");
        for _ in 0..opens { src.push_str("{ "); }
        src.push_str("gl_Position = vec4(a_pos, 0.0, 1.0);");
        for _ in 0..closes { src.push_str(" }"); }
        src.push('\n');
        let _ = preprocess_glsl(&src, naga::ShaderStage::Vertex);
        let _ = preprocess_glsl(&src, naga::ShaderStage::Fragment);
    }
}
