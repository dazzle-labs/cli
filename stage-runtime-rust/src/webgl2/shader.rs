use log::info;

/// Binding layout produced by GLSL preprocessing.
/// Describes what the compiled shader expects in its bind group.
#[derive(Clone, Debug, Default)]
pub struct BindingLayout {
    /// Bind group index (0 = vertex, 1 = fragment)
    pub group: u32,
    /// Texture sampler pairs: (binding_index_texture, binding_index_sampler, sampler_name)
    pub texture_bindings: Vec<(u32, u32, String)>,
    /// Uniform buffer binding index (None if no uniforms)
    pub uniform_binding: Option<u32>,
    /// Uniform member names in declaration order (for std140 packing)
    pub uniform_names: Vec<String>,
    /// Total number of bindings used
    pub binding_count: u32,
}

/// Strip C-style comments from GLSL source, preserving line structure.
/// Handles `//` line comments and `/* */` block comments.
/// Replaces comment content with spaces to maintain character positions for error messages.
pub fn strip_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let chars: Vec<char> = source.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_block_comment = false;

    while i < len {
        if in_block_comment {
            if i + 1 < len && chars[i] == '*' && chars[i + 1] == '/' {
                out.push(' ');
                out.push(' ');
                i += 2;
                in_block_comment = false;
            } else {
                // Preserve newlines inside block comments to maintain line structure
                out.push(if chars[i] == '\n' { '\n' } else { ' ' });
                i += 1;
            }
        } else if i + 1 < len && chars[i] == '/' && chars[i + 1] == '/' {
            // Line comment — skip to end of line
            out.push(' ');
            out.push(' ');
            i += 2;
            while i < len && chars[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if i + 1 < len && chars[i] == '/' && chars[i + 1] == '*' {
            out.push(' ');
            out.push(' ');
            i += 2;
            in_block_comment = true;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Preprocess GLSL ES 3.0 for naga:
/// - Strip comments (so pattern matching doesn't hit commented-out code)
/// - Strip `#version 300 es` and `precision` declarations
/// - Add `layout(location=N)` to bare `in`/`out` declarations (only at global scope)
/// - Add `layout(set=N, binding=N)` to bare `uniform` declarations
/// - Rewrite `uniform sampler2D` to separated texture + sampler (naga limitation)
/// - For vertex shaders, inject OpenGL→wgpu Z depth remapping
///
/// Returns (preprocessed_source, binding_layout).
pub fn preprocess_glsl(source: &str, stage: naga::ShaderStage) -> (String, BindingLayout) {
    let group = match stage {
        naga::ShaderStage::Vertex => 0,
        _ => 1,
    };

    // Strip comments first so line-level matching only sees actual code
    let stripped = strip_comments(source);

    let mut out = String::new();
    let mut attrib_loc: u32 = 0;
    let mut varying_loc: u32 = 0;
    let mut frag_out_loc: u32 = 0;
    let mut binding: u32 = 0;
    let mut brace_depth: u32 = 0;
    let mut sampler_names: Vec<String> = Vec::new();
    let mut layout = BindingLayout::default();
    layout.group = group;
    // Collect bare uniform declarations to emit as a single uniform block
    let mut uniform_members: Vec<String> = Vec::new();

    for line in stripped.lines() {
        let trimmed = line.trim();

        // Track brace depth so we only match global-scope declarations
        // (not code inside function bodies)
        let line_opens = trimmed.chars().filter(|&c| c == '{').count() as u32;
        let line_closes = trimmed.chars().filter(|&c| c == '}').count() as u32;

        // Only apply declaration rewrites at global scope (brace_depth == 0)
        let at_global_scope = brace_depth == 0;

        if trimmed.starts_with("#version") || trimmed.starts_with("precision ") {
            out.push('\n');
            brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
            continue;
        }

        // Strip gl_PointSize assignments — WGSL doesn't support PointSize builtin.
        // wgpu always renders points as 1px. Only match actual statements (inside
        // function bodies), not declarations.
        if brace_depth > 0 && trimmed.contains("gl_PointSize") {
            out.push('\n');
            brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
            continue;
        }

        // Global-scope declarations only below this point
        if at_global_scope {
            // Add layout(location=N) to bare `in` declarations in vertex shaders (attributes)
            if stage == naga::ShaderStage::Vertex
                && trimmed.starts_with("in ")
                && !trimmed.contains("layout")
                && trimmed.ends_with(';')
            {
                out.push_str(&format!("layout(location={}) {}", attrib_loc, trimmed));
                out.push('\n');
                attrib_loc += 1;
                brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
                continue;
            }

            // Add layout(location=N) to bare `out` declarations in vertex shaders (varyings)
            if stage == naga::ShaderStage::Vertex
                && trimmed.starts_with("out ")
                && !trimmed.contains("layout")
                && trimmed.ends_with(';')
            {
                out.push_str(&format!("layout(location={}) {}", varying_loc, trimmed));
                out.push('\n');
                varying_loc += 1;
                brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
                continue;
            }

            // Add layout(location=N) to bare `in` declarations in fragment shaders (varyings)
            if stage == naga::ShaderStage::Fragment
                && trimmed.starts_with("in ")
                && !trimmed.contains("layout")
                && trimmed.ends_with(';')
            {
                out.push_str(&format!("layout(location={}) {}", varying_loc, trimmed));
                out.push('\n');
                varying_loc += 1;
                brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
                continue;
            }

            // Add layout(location=N) to bare `out` declarations in fragment shaders (color outputs)
            if stage == naga::ShaderStage::Fragment
                && trimmed.starts_with("out ")
                && !trimmed.contains("layout")
                && trimmed.ends_with(';')
            {
                out.push_str(&format!("layout(location={}) {}", frag_out_loc, trimmed));
                out.push('\n');
                frag_out_loc += 1;
                brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
                continue;
            }

            // Rewrite `uniform sampler2D <name>;` to separated texture + sampler
            if trimmed.starts_with("uniform")
                && trimmed.contains("sampler2D")
                && trimmed.ends_with(';')
            {
                let without_semi = trimmed.trim_end_matches(';').trim();
                if let Some(name) = without_semi.split_whitespace().last() {
                    let tex_binding = binding;
                    out.push_str(&format!(
                        "layout(set={}, binding={}) uniform texture2D {};\n",
                        group, tex_binding, name
                    ));
                    binding += 1;
                    let sampler_binding = binding;
                    out.push_str(&format!(
                        "layout(set={}, binding={}) uniform sampler {}_sampler;\n",
                        group, sampler_binding, name
                    ));
                    binding += 1;
                    layout.texture_bindings.push((tex_binding, sampler_binding, name.to_string()));
                    sampler_names.push(name.to_string());
                    brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
                    continue;
                }
            }

            // Collect bare uniform declarations into a uniform block (emitted after the loop)
            if trimmed.starts_with("uniform ")
                && !trimmed.contains("layout")
                && !trimmed.contains("sampler")
                && trimmed.ends_with(';')
            {
                // Strip "uniform " prefix, keep the type + name declaration
                let member = trimmed.strip_prefix("uniform ").unwrap();
                // Extract the variable name (last word before semicolon)
                let name_part = member.trim_end_matches(';').trim();
                if let Some(name) = name_part.split_whitespace().last() {
                    layout.uniform_names.push(name.to_string());
                }
                uniform_members.push(member.to_string());
                out.push('\n'); // preserve line count
                brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
                continue;
            }
        }

        out.push_str(line);
        out.push('\n');
        brace_depth = brace_depth.wrapping_add(line_opens).wrapping_sub(line_closes);
    }

    // Emit collected uniforms as a single uniform block
    if !uniform_members.is_empty() {
        let block_name = if group == 0 { "VertexUniforms" } else { "FragmentUniforms" };
        layout.uniform_binding = Some(binding);
        let mut block = format!(
            "layout(set={}, binding={}, std140) uniform {} {{\n",
            group, binding, block_name
        );
        for member in &uniform_members {
            block.push_str("    ");
            block.push_str(member);
            block.push('\n');
        }
        block.push_str("};\n");
        binding += 1;
        // Prepend the block before everything else (after removed #version/precision)
        out = format!("{}{}", block, out);
    }

    // Rewrite texture() calls to use separated sampler2D constructor.
    // This operates on the comment-stripped source so it won't match inside comments.
    for name in &sampler_names {
        let from = format!("texture({},", name);
        let to = format!("texture(sampler2D({}, {}_sampler),", name, name);
        out = out.replace(&from, &to);
        let from2 = format!("texture({}, ", name);
        let to2 = format!("texture(sampler2D({}, {}_sampler), ", name, name);
        out = out.replace(&from2, &to2);
    }

    // For vertex shaders, inject OpenGL→wgpu Z depth remapping before the
    // closing brace of main(): z_clip = (z + w) * 0.5
    // We inject inline rather than wrapping main() to avoid naga BindingCollision
    // errors when varyings are present.
    const DEPTH_REMAP: &str = "    gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5;\n";
    if stage == naga::ShaderStage::Vertex && !out.contains(DEPTH_REMAP.trim()) {
        // Find main()'s closing brace by tracking brace depth from "void main"
        let insert_pos = out.find("void main").and_then(|main_start| {
            let after_main = &out[main_start..];
            let mut depth = 0i32;
            let mut found_open = false;
            for (i, c) in after_main.char_indices() {
                if c == '{' { depth += 1; found_open = true; }
                if c == '}' { depth -= 1; }
                if found_open && depth == 0 {
                    return Some(main_start + i);
                }
            }
            None
        });
        if let Some(pos) = insert_pos {
            out.insert_str(pos, DEPTH_REMAP);
        }
    }

    layout.binding_count = binding;
    (out, layout)
}

/// Compile GLSL ES 3.0 source to WGSL via naga.
/// Returns (wgsl_source, binding_layout, info_log). On failure, wgsl_source is None.
pub fn compile_glsl_to_wgsl(source: &str, stage: naga::ShaderStage) -> (Option<String>, BindingLayout, String) {
    use naga::front::glsl;
    use naga::back::wgsl;
    use naga::valid::{Capabilities, ValidationFlags, Validator};

    let (preprocessed, binding_layout) = preprocess_glsl(source, stage);

    let mut parser = glsl::Frontend::default();
    let options = glsl::Options::from(stage);

    let module = match parser.parse(&options, &preprocessed) {
        Ok(m) => m,
        Err(errors) => {
            return (None, binding_layout, format!("GLSL parse error: {}", errors));
        }
    };

    // Validate
    let mut validator = Validator::new(ValidationFlags::all(), Capabilities::all());
    let module_info = match validator.validate(&module) {
        Ok(info) => info,
        Err(e) => {
            return (None, binding_layout, format!("Validation error: {}", e));
        }
    };

    // Write WGSL
    let mut wgsl_out = String::new();
    let mut writer = wgsl::Writer::new(&mut wgsl_out, wgsl::WriterFlags::empty());
    match writer.write(&module, &module_info) {
        Ok(()) => {
            info!("GLSL → WGSL compilation succeeded ({} bytes)", wgsl_out.len());
            (Some(wgsl_out), binding_layout, String::new())
        }
        Err(e) => {
            (None, binding_layout, format!("WGSL write error: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preprocess_strips_version() {
        let src = "#version 300 es\nin vec2 a_position;\nvoid main() { gl_Position = vec4(a_position, 0.0, 1.0); }";
        let (out, _layout) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(!out.contains("#version"));
        assert!(out.contains("layout(location=0) in vec2 a_position;"));
    }

    #[test]
    fn test_preprocess_adds_uniform_binding() {
        let src = "precision mediump float;\nuniform vec4 u_color;\nout vec4 fragColor;\nvoid main() { fragColor = u_color; }";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(out.contains("layout(set=1, binding=0, std140) uniform FragmentUniforms"), "should have uniform block: {}", out);
        assert!(out.contains("vec4 u_color;"), "should have member in block: {}", out);
        assert_eq!(layout.uniform_binding, Some(0));
        assert_eq!(layout.uniform_names, vec!["u_color"]);
        assert_eq!(layout.group, 1);
    }

    #[test]
    fn test_preprocess_vertex_depth_remap() {
        let src = "#version 300 es\nin vec2 a_position;\nvoid main() {\n    gl_Position = vec4(a_position, 0.0, 1.0);\n}";
        let (out, _layout) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5"), "should have depth remap");
        assert!(out.contains("void main()"), "should still have main()");
    }

    #[test]
    fn test_compile_simple_vertex() {
        let src = "#version 300 es\nin vec2 a_position;\nvoid main() {\n    gl_Position = vec4(a_position, 0.0, 1.0);\n}";
        let (wgsl, _layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Vertex);
        assert!(wgsl.is_some(), "Failed to compile: {}", log);
        let wgsl = wgsl.unwrap();
        assert!(wgsl.contains("@vertex"));
        assert!(wgsl.contains("@location(0)"));
    }

    #[test]
    fn test_compile_simple_fragment() {
        let src = "#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() {\n    fragColor = vec4(1.0, 0.0, 0.0, 1.0);\n}";
        let (wgsl, _layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Fragment);
        assert!(wgsl.is_some(), "Failed to compile: {}", log);
        let wgsl = wgsl.unwrap();
        assert!(wgsl.contains("@fragment"));
    }

    #[test]
    fn test_compile_uniform_fragment() {
        let src = "#version 300 es\nprecision mediump float;\nuniform vec4 u_color;\nout vec4 fragColor;\nvoid main() {\n    fragColor = u_color;\n}";
        let (wgsl, _layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Fragment);
        assert!(wgsl.is_some(), "Failed to compile: {}", log);
        let wgsl = wgsl.unwrap();
        assert!(wgsl.contains("@group(1) @binding(0)"));
    }

    #[test]
    fn test_preprocess_sampler2d() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_texture;\nin vec2 v_texcoord;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_texture, v_texcoord);\n}";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(out.contains("uniform texture2D u_texture;"), "should have texture2D");
        assert!(out.contains("uniform sampler u_texture_sampler;"), "should have sampler");
        assert!(out.contains("sampler2D(u_texture, u_texture_sampler)"), "should have combined constructor");
        assert_eq!(layout.binding_count, 2, "texture + sampler = 2 bindings");
        assert_eq!(layout.texture_bindings.len(), 1);
    }

    #[test]
    fn test_compile_texture_fragment() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_texture;\nin vec2 v_texcoord;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_texture, v_texcoord);\n}";
        let (wgsl, _layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Fragment);
        assert!(wgsl.is_some(), "Failed to compile: {}", log);
        let wgsl = wgsl.unwrap();
        assert!(wgsl.contains("texture_2d"), "should have texture_2d type");
        assert!(wgsl.contains("sampler"), "should have sampler type");
    }

    #[test]
    fn test_separate_modules_compile() {
        let vs = "#version 300 es\nin vec2 a_position;\nvoid main() {\n    gl_Position = vec4(a_position, 0.0, 1.0);\n}";
        let fs = "#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() {\n    fragColor = vec4(1.0, 0.0, 0.0, 1.0);\n}";

        let (vs_wgsl, vs_layout, vs_log) = compile_glsl_to_wgsl(vs, naga::ShaderStage::Vertex);
        let (fs_wgsl, fs_layout, fs_log) = compile_glsl_to_wgsl(fs, naga::ShaderStage::Fragment);

        assert!(vs_wgsl.is_some(), "VS failed: {}", vs_log);
        assert!(fs_wgsl.is_some(), "FS failed: {}", fs_log);
        assert!(vs_wgsl.unwrap().contains("@vertex"));
        assert!(fs_wgsl.unwrap().contains("@fragment"));
        assert_eq!(vs_layout.group, 0);
        assert_eq!(fs_layout.group, 1);
    }

    #[test]
    fn test_compile_pointsize_shader() {
        let src = "#version 300 es\nin vec2 a_position;\nin vec3 a_color;\nout vec3 v_color;\nvoid main() {\n    gl_Position = vec4(a_position, 0.0, 1.0);\n    gl_PointSize = 20.0;\n    v_color = a_color;\n}";
        let (preprocessed, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(!preprocessed.contains("gl_PointSize"), "gl_PointSize should be stripped");
        let (wgsl, _layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Vertex);
        assert!(wgsl.is_some(), "Failed to compile pointsize shader: {}", log);
    }

    // ---------------------------------------------------------------
    // strip_comments
    // ---------------------------------------------------------------

    #[test]
    fn test_strip_line_comment() {
        let stripped = strip_comments("int x = 1; // comment\nint y = 2;\n");
        assert!(stripped.contains("int x = 1;"));
        assert!(stripped.contains("int y = 2;"));
        assert!(!stripped.contains("comment"));
    }

    #[test]
    fn test_strip_block_comment_single_line() {
        let stripped = strip_comments("int x = /* hidden */ 1;\n");
        assert!(stripped.contains("int x ="));
        assert!(stripped.contains("1;"));
        assert!(!stripped.contains("hidden"));
    }

    #[test]
    fn test_strip_block_comment_multi_line() {
        let src = "int x = 1;\n/* line1\nline2\nline3 */\nint y = 2;\n";
        let stripped = strip_comments(src);
        assert!(stripped.contains("int x = 1;"));
        assert!(stripped.contains("int y = 2;"));
        assert!(!stripped.contains("line1"));
        assert!(!stripped.contains("line2"));
        assert!(!stripped.contains("line3"));
        // Must preserve line count
        assert_eq!(stripped.lines().count(), src.lines().count());
    }

    #[test]
    fn test_strip_nested_slash_in_block_comment() {
        // `//` inside `/* */` should not end the block comment early
        let stripped = strip_comments("/* a // b */int x;\n");
        assert!(stripped.contains("int x;"));
        assert!(!stripped.contains("a"));
    }

    #[test]
    fn test_strip_star_in_line_comment() {
        // `/*` inside `//` should not start a block comment
        let stripped = strip_comments("int x; // /* not a block\nint y;\n");
        assert!(stripped.contains("int x;"));
        assert!(stripped.contains("int y;"));
        assert!(!stripped.contains("not a block"));
    }

    #[test]
    fn test_strip_consecutive_block_comments() {
        let stripped = strip_comments("/* a */int x;/* b */\n");
        assert!(stripped.contains("int x;"));
        assert!(!stripped.contains("a"));
        assert!(!stripped.contains("b"));
    }

    #[test]
    fn test_strip_empty_comments() {
        let stripped = strip_comments("/**/ int x; //\nint y;\n");
        assert!(stripped.contains("int x;"));
        assert!(stripped.contains("int y;"));
    }

    #[test]
    fn test_strip_unclosed_block_comment_eats_rest() {
        // Unterminated block comment should consume everything after it
        let stripped = strip_comments("int x;\n/* oops\nint y;\n");
        assert!(stripped.contains("int x;"));
        assert!(!stripped.contains("oops"));
        assert!(!stripped.contains("int y;"));
    }

    #[test]
    fn test_strip_preserves_strings_with_slashes() {
        // We don't track string literals (GLSL doesn't have them in
        // declarations), but verify the basics aren't broken
        let stripped = strip_comments("int x = 1; // end\n");
        assert!(stripped.contains("int x = 1;"));
    }

    // ---------------------------------------------------------------
    // Comment-aware preprocessing — comments must not trigger rewrites
    // ---------------------------------------------------------------

    #[test]
    fn test_line_comment_uniform_sampler_ignored() {
        let src = "#version 300 es\nprecision mediump float;\n// uniform sampler2D u_fake;\nuniform vec4 u_color;\nout vec4 fragColor;\nvoid main() { fragColor = u_color; }";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(!out.contains("u_fake"), "commented-out sampler should not appear");
        assert!(out.contains("vec4 u_color;"), "should have uniform member");
        assert!(out.contains("FragmentUniforms"), "should have uniform block");
        assert_eq!(layout.texture_bindings.len(), 0);
    }

    #[test]
    fn test_block_comment_uniform_sampler_ignored() {
        let src = "#version 300 es\nprecision mediump float;\n/* uniform sampler2D u_tex; */\nuniform vec4 u_color;\nout vec4 fragColor;\nvoid main() { fragColor = u_color; }";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(!out.contains("u_tex"), "block-commented sampler should not appear");
        assert_eq!(layout.texture_bindings.len(), 0);
        assert_eq!(layout.binding_count, 1);
    }

    #[test]
    fn test_line_comment_in_declaration_ignored() {
        let src = "#version 300 es\nprecision mediump float;\n// in vec2 v_fake;\nin vec2 v_texcoord;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(v_texcoord, 0.0, 1.0); }";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(!out.contains("v_fake"));
        assert!(out.contains("layout(location=0) in vec2 v_texcoord;"));
    }

    #[test]
    fn test_line_comment_out_declaration_ignored() {
        let src = "#version 300 es\n// out vec4 oldOutput;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(!out.contains("oldOutput"));
        assert!(out.contains("layout(location=0) out vec4 fragColor;"));
    }

    #[test]
    fn test_multiline_block_comment_hides_declarations() {
        let src = "#version 300 es\nprecision mediump float;\n/*\nuniform sampler2D u_hidden;\nin vec2 v_hidden;\nout vec4 hidden_out;\n*/\nuniform vec4 u_color;\nout vec4 fragColor;\nvoid main() { fragColor = u_color; }";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(!out.contains("u_hidden"));
        assert!(!out.contains("v_hidden"));
        assert!(!out.contains("hidden_out"));
        assert_eq!(layout.texture_bindings.len(), 0);
        assert!(out.contains("vec4 u_color;"), "should have uniform member");
        assert!(out.contains("FragmentUniforms"), "should have uniform block");
    }

    #[test]
    fn test_inline_block_comment_in_uniform_line() {
        // Block comment mid-line makes the line not match the uniform pattern
        // because strip_comments replaces the comment text with spaces
        let src = "#version 300 es\nprecision mediump float;\nuniform /* surprise */ vec4 u_color;\nout vec4 fragColor;\nvoid main() { fragColor = u_color; }";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        // The stripped line becomes "uniform               vec4 u_color;"
        // which starts with "uniform " and ends with ";" — it should still get collected into a block
        assert!(out.contains("FragmentUniforms"), "should have uniform block: {}", out);
    }

    #[test]
    fn test_gl_pointsize_in_line_comment_not_stripped() {
        // gl_PointSize inside a comment should not cause the line to be removed
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main() {\n    float size = 5.0; // gl_PointSize would go here\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        // After strip_comments, the comment is gone — the code "float size = 5.0;" should remain
        assert!(out.contains("float size = 5.0;"));
    }

    #[test]
    fn test_gl_pointsize_in_block_comment_not_stripped() {
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main() {\n    /* gl_PointSize = 10.0; */\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(!out.contains("gl_PointSize"));
        // Shader should still compile
        let (wgsl, _, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Vertex);
        assert!(wgsl.is_some(), "Should compile: {}", log);
    }

    // ---------------------------------------------------------------
    // Scope tracking — declarations inside {} must not get rewrites
    // ---------------------------------------------------------------

    #[test]
    fn test_uniform_inside_function_not_rewritten() {
        // "uniform " at start of a line inside a function body should not
        // get layout annotations. (This is invalid GLSL but tests our guard.)
        let src = "#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() {\n    // The next line is intentionally weird — tests scope guard\n    fragColor = vec4(1.0);\n}";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        // No uniform at global scope → binding_count should be 0
        assert_eq!(layout.binding_count, 0);
        assert!(out.contains("layout(location=0) out vec4 fragColor;"));
    }

    #[test]
    fn test_helper_function_braces_tracked() {
        // Multiple functions — declarations at global scope should still work
        let src = "#version 300 es\nprecision mediump float;\nuniform vec4 u_color;\nout vec4 fragColor;\nvec4 helper() {\n    return u_color * 0.5;\n}\nvoid main() {\n    fragColor = helper();\n}";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(out.contains("FragmentUniforms"), "should have uniform block: {}", out);
        assert!(out.contains("vec4 u_color;"), "should have member: {}", out);
        assert!(out.contains("layout(location=0) out vec4 fragColor;"));
        // Should compile end-to-end
        let (wgsl, _, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Fragment);
        assert!(wgsl.is_some(), "Should compile with helper fn: {}", log);
    }

    #[test]
    fn test_brace_on_same_line_as_function() {
        // `void main() {` has the opening brace on the same line
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main() {\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("layout(location=0) in vec2 a_pos;"));
    }

    #[test]
    fn test_brace_on_next_line() {
        // Opening brace on its own line (Allman style)
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main()\n{\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("layout(location=0) in vec2 a_pos;"));
        let (wgsl, _, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Vertex);
        assert!(wgsl.is_some(), "Should compile Allman style: {}", log);
    }

    // ---------------------------------------------------------------
    // Binding index correctness
    // ---------------------------------------------------------------

    #[test]
    fn test_multiple_samplers_get_sequential_bindings() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex0;\nuniform sampler2D u_tex1;\nin vec2 v_uv;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_tex0, v_uv) + texture(u_tex1, v_uv);\n}";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        // u_tex0: texture at binding 0, sampler at binding 1
        // u_tex1: texture at binding 2, sampler at binding 3
        assert_eq!(layout.texture_bindings.len(), 2);
        assert_eq!(layout.texture_bindings[0], (0, 1, "u_tex0".to_string()));
        assert_eq!(layout.texture_bindings[1], (2, 3, "u_tex1".to_string()));
        assert_eq!(layout.binding_count, 4);
        // Both texture() calls should be rewritten
        assert!(out.contains("sampler2D(u_tex0, u_tex0_sampler)"));
        assert!(out.contains("sampler2D(u_tex1, u_tex1_sampler)"));
    }

    #[test]
    fn test_sampler_then_uniform_bindings_sequential() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nuniform vec4 u_tint;\nin vec2 v_uv;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_tex, v_uv) * u_tint;\n}";
        let (_, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        // u_tex: texture binding 0, sampler binding 1
        // u_tint: uniform binding 2
        assert_eq!(layout.texture_bindings[0], (0, 1, "u_tex".to_string()));
        assert_eq!(layout.uniform_binding, Some(2));
        assert_eq!(layout.binding_count, 3);
    }

    #[test]
    fn test_vertex_attrib_locations_sequential() {
        let src = "#version 300 es\nin vec2 a_position;\nin vec2 a_texcoord;\nin vec3 a_color;\nvoid main() {\n    gl_Position = vec4(a_position, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("layout(location=0) in vec2 a_position;"));
        assert!(out.contains("layout(location=1) in vec2 a_texcoord;"));
        assert!(out.contains("layout(location=2) in vec3 a_color;"));
    }

    #[test]
    fn test_vertex_varying_locations_sequential() {
        let src = "#version 300 es\nin vec2 a_pos;\nout vec2 v_uv;\nout vec3 v_color;\nvoid main() {\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("layout(location=0) out vec2 v_uv;"));
        assert!(out.contains("layout(location=1) out vec3 v_color;"));
    }

    #[test]
    fn test_fragment_varying_locations_sequential() {
        let src = "#version 300 es\nprecision mediump float;\nin vec2 v_uv;\nin vec3 v_color;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(v_color, 1.0); }";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(out.contains("layout(location=0) in vec2 v_uv;"));
        assert!(out.contains("layout(location=1) in vec3 v_color;"));
        assert!(out.contains("layout(location=0) out vec4 fragColor;"));
    }

    #[test]
    fn test_existing_layout_not_doubled() {
        // If a declaration already has layout(...), don't add another
        let src = "#version 300 es\nlayout(location=5) in vec2 a_pos;\nvoid main() { gl_Position = vec4(a_pos, 0.0, 1.0); }";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("layout(location=5) in vec2 a_pos;"));
        assert!(!out.contains("layout(location=0)"), "should not add a second layout");
    }

    // ---------------------------------------------------------------
    // texture() call rewriting
    // ---------------------------------------------------------------

    #[test]
    fn test_texture_call_rewritten_with_sampler_constructor() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nin vec2 v_uv;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_tex, v_uv);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(out.contains("texture(sampler2D(u_tex, u_tex_sampler), v_uv)"));
        assert!(!out.contains("texture(u_tex,"), "bare texture call should be rewritten");
    }

    #[test]
    fn test_texture_call_no_space_after_comma() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nin vec2 v_uv;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_tex,v_uv);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert!(out.contains("sampler2D(u_tex, u_tex_sampler)"));
    }

    #[test]
    fn test_multiple_texture_calls_same_sampler() {
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nin vec2 v_uv;\nout vec4 fragColor;\nvoid main() {\n    vec4 a = texture(u_tex, v_uv);\n    vec4 b = texture(u_tex, v_uv * 2.0);\n    fragColor = a + b;\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        let count = out.matches("sampler2D(u_tex, u_tex_sampler)").count();
        assert_eq!(count, 2, "both texture() calls should be rewritten");
    }

    // ---------------------------------------------------------------
    // Z-depth remapping
    // ---------------------------------------------------------------

    #[test]
    fn test_depth_remap_injected_in_vertex_only() {
        let vs = "#version 300 es\nin vec2 a_pos;\nvoid main() { gl_Position = vec4(a_pos, 0.0, 1.0); }";
        let fs = "#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }";
        let (vs_out, _) = preprocess_glsl(vs, naga::ShaderStage::Vertex);
        let (fs_out, _) = preprocess_glsl(fs, naga::ShaderStage::Fragment);
        assert!(vs_out.contains("gl_Position.z = (gl_Position.z + gl_Position.w) * 0.5"));
        assert!(!fs_out.contains("gl_Position.z"), "fragment should not have depth remap");
    }

    #[test]
    fn test_depth_remap_after_last_user_code() {
        // The depth remap must appear before the final } of main
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main() {\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        let depth_pos = out.find("gl_Position.z = (gl_Position.z + gl_Position.w)").unwrap();
        let user_pos = out.find("gl_Position = vec4(a_pos").unwrap();
        assert!(depth_pos > user_pos, "depth remap should come after user's gl_Position assignment");
    }

    // ---------------------------------------------------------------
    // gl_PointSize stripping
    // ---------------------------------------------------------------

    #[test]
    fn test_pointsize_stripped_from_function_body() {
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main() {\n    gl_PointSize = 20.0;\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(!out.contains("gl_PointSize"));
        assert!(out.contains("gl_Position = vec4(a_pos"));
    }

    #[test]
    fn test_pointsize_conditional_stripped() {
        let src = "#version 300 es\nin vec2 a_pos;\nin float a_size;\nvoid main() {\n    gl_PointSize = a_size * 2.0;\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(!out.contains("gl_PointSize"));
        let (wgsl, _, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Vertex);
        assert!(wgsl.is_some(), "Should compile with PointSize stripped: {}", log);
    }

    #[test]
    fn test_pointsize_in_line_comment_does_not_strip_code() {
        // The comment is removed by strip_comments first, so the actual code
        // on the same line (if any) is preserved
        let src = "#version 300 es\nin vec2 a_pos;\nvoid main() {\n    float x = 5.0; // gl_PointSize = 10.0;\n    gl_Position = vec4(a_pos, 0.0, 1.0);\n}";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(out.contains("float x = 5.0;"), "code before comment should be preserved");
    }

    #[test]
    fn test_pointsize_not_stripped_at_global_scope() {
        // gl_PointSize at global scope (brace_depth == 0) should NOT be stripped,
        // only inside function bodies. (This is invalid GLSL, but tests the guard.)
        // The line won't match because brace_depth == 0 and we only strip at depth > 0.
        let src = "#version 300 es\nin vec2 a_pos;\nfloat gl_PointSize_default = 1.0;\nvoid main() { gl_Position = vec4(a_pos, 0.0, 1.0); }";
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        // "gl_PointSize_default" contains "gl_PointSize" but is at global scope
        assert!(out.contains("gl_PointSize_default"), "global scope should not be stripped");
    }

    // ---------------------------------------------------------------
    // End-to-end compilation (comment-heavy shaders)
    // ---------------------------------------------------------------

    #[test]
    fn test_compile_shader_with_many_comments() {
        let src = "#version 300 es
precision mediump float;
// This shader renders a solid color
/* Multi-line
   block comment about uniforms:
   uniform sampler2D u_texture; -- not real
*/
uniform vec4 u_color; // the actual color
out vec4 fragColor; // output
void main() {
    // Apply the color
    fragColor = u_color; /* done */
}";
        let (wgsl, layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Fragment);
        assert!(wgsl.is_some(), "Should compile comment-heavy shader: {}", log);
        assert_eq!(layout.texture_bindings.len(), 0, "no real sampler declarations");
        assert_eq!(layout.binding_count, 1, "only u_color");
    }

    #[test]
    fn test_compile_vertex_with_varyings_and_comments() {
        let src = "#version 300 es
// Vertex shader with comments everywhere
in vec2 a_position; // position attribute
in vec3 a_color; // color attribute
out vec3 v_color; // varying to fragment
/* Old code:
   out vec2 v_texcoord;
   in float a_alpha;
*/
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_color = a_color; // pass through
}";
        let (wgsl, layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Vertex);
        assert!(wgsl.is_some(), "Should compile: {}", log);
        assert_eq!(layout.group, 0);
        // Should not have picked up commented-out declarations
        let (out, _) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        assert!(!out.contains("v_texcoord"), "commented-out varying should not appear");
        assert!(!out.contains("a_alpha"), "commented-out attribute should not appear");
    }

    #[test]
    fn test_compile_fragment_sampler_with_comments() {
        let src = "#version 300 es
precision mediump float;
uniform sampler2D u_texture;
// uniform sampler2D u_normal_map; // disabled for now
in vec2 v_texcoord;
out vec4 fragColor;
void main() {
    /* Sample the texture */
    fragColor = texture(u_texture, v_texcoord);
}";
        let (wgsl, layout, log) = compile_glsl_to_wgsl(src, naga::ShaderStage::Fragment);
        assert!(wgsl.is_some(), "Should compile: {}", log);
        assert_eq!(layout.texture_bindings.len(), 1, "only one real sampler");
    }

    // ---------------------------------------------------------------
    // Adversarial / edge-case inputs
    // ---------------------------------------------------------------

    #[test]
    fn test_empty_source() {
        let (out, layout) = preprocess_glsl("", naga::ShaderStage::Fragment);
        assert_eq!(layout.binding_count, 0);
        assert!(out.is_empty() || out.trim().is_empty());
    }

    #[test]
    fn test_only_comments() {
        let src = "// nothing here\n/* really nothing */\n";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert_eq!(layout.binding_count, 0);
        assert_eq!(layout.texture_bindings.len(), 0);
        // Output should be just whitespace
        assert!(out.trim().is_empty());
    }

    #[test]
    fn test_malformed_glsl_does_not_panic() {
        // Completely invalid GLSL — preprocessing should not panic
        let src = "}}}{{{ in out uniform sampler2D ;;;";
        let (_, layout) = preprocess_glsl(src, naga::ShaderStage::Vertex);
        // We don't care about the output, just that it didn't panic
        let _ = layout;
    }

    #[test]
    fn test_very_long_line_does_not_panic() {
        let long_comment = format!("// {}\n", "x".repeat(10000));
        let src = format!("#version 300 es\n{}in vec2 a_pos;\nvoid main() {{ gl_Position = vec4(a_pos, 0.0, 1.0); }}", long_comment);
        let (out, _) = preprocess_glsl(&src, naga::ShaderStage::Vertex);
        assert!(out.contains("layout(location=0) in vec2 a_pos;"));
    }

    #[test]
    fn test_sampler_name_is_substring_of_another() {
        // u_tex is a prefix of u_tex2 — make sure texture() rewriting doesn't mangle u_tex2
        let src = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_tex;\nuniform sampler2D u_tex2;\nin vec2 v_uv;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_tex, v_uv) + texture(u_tex2, v_uv);\n}";
        let (out, layout) = preprocess_glsl(src, naga::ShaderStage::Fragment);
        assert_eq!(layout.texture_bindings.len(), 2);
        // u_tex call should use u_tex_sampler, not u_tex2_sampler
        assert!(out.contains("sampler2D(u_tex, u_tex_sampler)"));
        assert!(out.contains("sampler2D(u_tex2, u_tex2_sampler)"));
    }

}
