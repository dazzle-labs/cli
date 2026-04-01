#[test]
fn test_texture_shader() {
    use naga::front::glsl;
    use naga::back::wgsl;
    use naga::valid::{Capabilities, ValidationFlags, Validator};

    let fs_glsl = "#version 300 es\nprecision mediump float;\nuniform sampler2D u_texture;\nin vec2 v_texcoord;\nout vec4 fragColor;\nvoid main() {\n    fragColor = texture(u_texture, v_texcoord);\n}";

    // Use our preprocessor
    let (preprocessed, _) = stage_runtime::webgl2::preprocess_glsl(fs_glsl, naga::ShaderStage::Fragment);
    eprintln!("=== Preprocessed GLSL ===\n{}", &preprocessed);

    let mut parser = glsl::Frontend::default();
    let options = glsl::Options::from(naga::ShaderStage::Fragment);
    let module = parser.parse(&options, &preprocessed).unwrap();
    let mut validator = Validator::new(ValidationFlags::all(), Capabilities::all());
    let info = validator.validate(&module).unwrap();
    let mut out = String::new();
    let mut writer = wgsl::Writer::new(&mut out, wgsl::WriterFlags::empty());
    writer.write(&module, &info).unwrap();
    eprintln!("=== WGSL ===\n{}\n", out);
}
