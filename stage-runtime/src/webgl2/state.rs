use std::collections::HashMap;
use super::shader::BindingLayout;

/// WebGL2 state machine — tracks GL state for software rasterization.
#[derive(Default)]
pub struct GLState {
    pub clear_color: [f32; 4],
    pub clear_depth: f64,
    pub viewport: [i32; 4],
    pub scissor: [i32; 4],
    pub blend_enabled: bool,
    pub depth_test_enabled: bool,
    pub cull_face_enabled: bool,
    pub scissor_test_enabled: bool,
    pub stencil_test_enabled: bool,
    pub polygon_offset_fill_enabled: bool,
    pub polygon_offset_factor: f32,
    pub polygon_offset_units: f32,
    pub blend_src: u32,
    pub blend_dst: u32,
    pub blend_src_alpha: u32,
    pub blend_dst_alpha: u32,
    pub depth_func: u32,
    pub depth_mask: bool,
    pub color_mask: [bool; 4],
    pub cull_face_mode: u32,
    pub front_face: u32,
    pub blend_equation_rgb: u32,
    pub blend_equation_alpha: u32,
    pub blend_color: [f32; 4],
    pub clear_stencil: i32,
    pub depth_range: [f64; 2],
    /// Active texture unit index (0 = GL_TEXTURE0, etc.)
    pub active_texture_unit: usize,
    pub unpack_flip_y: bool,
    pub current_program: Option<u32>,
    pub bound_array_buffer: Option<u32>,
    pub bound_element_buffer: Option<u32>,
    /// Texture units: texture_units[i] = bound texture ID for unit i
    pub texture_units: Vec<Option<u32>>,
    pub vertex_attribs: Vec<VertexAttrib>,
}

/// Vertex attribute pointer state.
#[derive(Clone, Default)]
pub struct VertexAttrib {
    pub buffer_id: Option<u32>,
    pub size: u32,
    pub dtype: u32,
    pub normalized: bool,
    pub stride: u32,
    pub offset: u32,
    pub enabled: bool,
    pub divisor: u32,
}

/// A compiled shader (vertex or fragment).
pub struct Shader {
    pub shader_type: u32,
    pub source: String,
    pub compiled: bool,
    pub info_log: String,
    /// WGSL source after naga translation (set by compile_shader)
    pub wgsl: Option<String>,
    /// Binding layout from GLSL preprocessing
    pub binding_layout: BindingLayout,
}

/// A linked program (vertex + fragment shader pair).
pub struct Program {
    pub vertex_shader: Option<u32>,
    pub fragment_shader: Option<u32>,
    pub linked: bool,
    pub info_log: String,
    pub uniform_locations: HashMap<String, u32>,
    /// GL type per uniform location, set when uniform* is called.
    pub uniform_types: HashMap<u32, u32>,
    /// WGSL source per-stage (compiled independently via naga)
    pub wgsl_vertex: Option<String>,
    pub wgsl_fragment: Option<String>,
    /// Binding layouts per-stage
    pub vertex_binding_layout: BindingLayout,
    pub fragment_binding_layout: BindingLayout,
}

/// A GPU buffer (vertex or index data).
pub struct Buffer {
    pub target: u32,
    pub data: Vec<u8>,
    pub usage: u32,
    /// For element array buffers: the GL index type (GL_UNSIGNED_SHORT or GL_UNSIGNED_INT).
    /// Set during bufferData based on auto-detection or explicit uint32 path.
    pub index_type: u32,
}

/// A GPU texture.
pub struct Texture {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub internal_format: u32,
    pub min_filter: u32,
    pub mag_filter: u32,
    pub wrap_s: u32,
    pub wrap_t: u32,
}

/// VAO (Vertex Array Object) — stores vertex attribute and element buffer binding state.
#[derive(Clone)]
pub struct VaoState {
    pub vertex_attribs: Vec<VertexAttrib>,
    pub bound_element_buffer: Option<u32>,
}

impl VaoState {
    pub fn new(num_attribs: usize) -> Self {
        VaoState {
            vertex_attribs: vec![VertexAttrib::default(); num_attribs],
            bound_element_buffer: None,
        }
    }
}

/// Uniform value storage.
#[derive(Clone, Debug)]
pub enum UniformValue {
    Float(f32),
    Int(i32),
    UInt(u32),
    Vec2([f32; 2]),
    Vec3([f32; 3]),
    Vec4([f32; 4]),
    IVec2([i32; 2]),
    IVec3([i32; 3]),
    IVec4([i32; 4]),
    UVec2([u32; 2]),
    UVec3([u32; 3]),
    UVec4([u32; 4]),
    Mat2([f32; 4]),
    Mat3([f32; 9]),
    Mat4([f32; 16]),
}
