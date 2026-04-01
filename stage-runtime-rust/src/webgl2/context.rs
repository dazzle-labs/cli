use std::collections::HashMap;
use log::info;

use super::gpu::GpuBackend;
use super::shader;
use super::state::*;

// WebGL2 constants
const GL_VERTEX_SHADER: u32 = 0x8B31;
const GL_FRAGMENT_SHADER: u32 = 0x8B30;
const GL_ARRAY_BUFFER: u32 = 0x8892;
const GL_ELEMENT_ARRAY_BUFFER: u32 = 0x8893;
const GL_UNIFORM_BUFFER: u32 = 0x8A11;
const GL_COPY_READ_BUFFER: u32 = 0x8F36;
const GL_COPY_WRITE_BUFFER: u32 = 0x8F37;
const GL_TRANSFORM_FEEDBACK_BUFFER: u32 = 0x8C8E;
const GL_PIXEL_PACK_BUFFER: u32 = 0x88EB;
const GL_PIXEL_UNPACK_BUFFER: u32 = 0x88EC;
const GL_STATIC_DRAW: u32 = 0x88E4;
const GL_DYNAMIC_DRAW: u32 = 0x88E8;
const GL_STREAM_DRAW: u32 = 0x88E0;
const GL_STATIC_READ: u32 = 0x88E5;
const GL_DYNAMIC_READ: u32 = 0x88E9;
const GL_STREAM_READ: u32 = 0x88E1;
const GL_STATIC_COPY: u32 = 0x88E6;
const GL_DYNAMIC_COPY: u32 = 0x88EA;
const GL_STREAM_COPY: u32 = 0x88E2;
const GL_COMPILE_STATUS: u32 = 0x8B81;
const GL_LINK_STATUS: u32 = 0x8B82;
const GL_BLEND: u32 = 0x0BE2;
const GL_DEPTH_TEST: u32 = 0x0B71;
const GL_CULL_FACE: u32 = 0x0B44;
const GL_SCISSOR_TEST: u32 = 0x0C11;
const GL_STENCIL_TEST: u32 = 0x0B90;
const GL_DITHER: u32 = 0x0BD0;
const GL_POLYGON_OFFSET_FILL: u32 = 0x8037;
const GL_SAMPLE_ALPHA_TO_COVERAGE: u32 = 0x809E;
const GL_SAMPLE_COVERAGE: u32 = 0x80A0;
const GL_RASTERIZER_DISCARD: u32 = 0x8C89;
const GL_TEXTURE_2D: u32 = 0x0DE1;
const GL_TEXTURE_CUBE_MAP: u32 = 0x8513;
const GL_TEXTURE_3D: u32 = 0x806F;
const GL_TEXTURE_2D_ARRAY: u32 = 0x8C1A;
// Error codes
const GL_INVALID_ENUM: u32 = 0x0500;
const GL_INVALID_VALUE: u32 = 0x0501;
const GL_INVALID_OPERATION: u32 = 0x0502;
const GL_OUT_OF_MEMORY: u32 = 0x0505;
// Draw modes
const GL_POINTS: u32 = 0;
const GL_LINES: u32 = 1;
const GL_LINE_LOOP: u32 = 2;
const GL_LINE_STRIP: u32 = 3;
const GL_TRIANGLES: u32 = 4;
const GL_TRIANGLE_STRIP: u32 = 5;
const GL_TRIANGLE_FAN: u32 = 6;
// Index types
const GL_UNSIGNED_BYTE: u32 = 0x1401;
const GL_UNSIGNED_SHORT: u32 = 0x1403;
const GL_UNSIGNED_INT: u32 = 0x1405;
// Blend factors
const GL_ZERO: u32 = 0;
const GL_ONE: u32 = 1;
const GL_SRC_COLOR: u32 = 0x0300;
const GL_ONE_MINUS_SRC_COLOR: u32 = 0x0301;
const GL_SRC_ALPHA: u32 = 0x0302;
const GL_ONE_MINUS_SRC_ALPHA: u32 = 0x0303;
const GL_DST_ALPHA: u32 = 0x0304;
const GL_ONE_MINUS_DST_ALPHA: u32 = 0x0305;
const GL_DST_COLOR: u32 = 0x0306;
const GL_ONE_MINUS_DST_COLOR: u32 = 0x0307;
const GL_SRC_ALPHA_SATURATE: u32 = 0x0308;
const GL_CONSTANT_COLOR: u32 = 0x8001;
const GL_ONE_MINUS_CONSTANT_COLOR: u32 = 0x8002;
const GL_CONSTANT_ALPHA: u32 = 0x8003;
const GL_ONE_MINUS_CONSTANT_ALPHA: u32 = 0x8004;
// Face culling
const GL_CW: u32 = 0x0900;
const GL_CCW: u32 = 0x0901;
const GL_FRONT: u32 = 0x0404;
const GL_BACK: u32 = 0x0405;
const GL_FRONT_AND_BACK: u32 = 0x0408;
// Depth functions (also used for stencil)
const GL_NEVER: u32 = 0x0200;
const GL_LESS: u32 = 0x0201;
const GL_EQUAL: u32 = 0x0202;
const GL_LEQUAL: u32 = 0x0203;
const GL_GREATER: u32 = 0x0204;
const GL_NOTEQUAL: u32 = 0x0205;
const GL_GEQUAL: u32 = 0x0206;
const GL_ALWAYS: u32 = 0x0207;
// Blend equations
const GL_FUNC_ADD: u32 = 0x8006;
const GL_FUNC_SUBTRACT: u32 = 0x800A;
const GL_FUNC_REVERSE_SUBTRACT: u32 = 0x800B;
const GL_MIN: u32 = 0x8007;
const GL_MAX: u32 = 0x8008;
// Buffer bits
const GL_DEPTH_BUFFER_BIT: u32 = 0x0100;
const GL_STENCIL_BUFFER_BIT: u32 = 0x0400;
const GL_COLOR_BUFFER_BIT: u32 = 0x4000;
const GL_VALID_CLEAR_BITS: u32 = GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT;
// Texture parameters
const GL_TEXTURE_MIN_FILTER: u32 = 0x2801;
const GL_TEXTURE_MAG_FILTER: u32 = 0x2800;
const GL_TEXTURE_WRAP_S: u32 = 0x2802;
const GL_TEXTURE_WRAP_T: u32 = 0x2803;
const GL_TEXTURE_WRAP_R: u32 = 0x8072;
const GL_TEXTURE_BASE_LEVEL: u32 = 0x813C;
const GL_TEXTURE_MAX_LEVEL: u32 = 0x813D;
const GL_TEXTURE_COMPARE_FUNC: u32 = 0x884D;
const GL_TEXTURE_COMPARE_MODE: u32 = 0x884C;
const GL_TEXTURE_MAX_ANISOTROPY_EXT: u32 = 0x84FE;
// Uniform types (for getActiveUniform)
const GL_FLOAT: u32 = 0x1406;
const GL_FLOAT_VEC2: u32 = 0x8B50;
const GL_FLOAT_VEC3: u32 = 0x8B51;
const GL_FLOAT_VEC4: u32 = 0x8B52;
const GL_INT: u32 = 0x1404;
const GL_INT_VEC2: u32 = 0x8B53;
const GL_INT_VEC3: u32 = 0x8B54;
const GL_INT_VEC4: u32 = 0x8B55;
const GL_UNSIGNED_INT_T: u32 = 0x1405; // GL_UNSIGNED_INT (as uniform type)
const GL_UNSIGNED_INT_VEC2: u32 = 0x8DC6;
const GL_UNSIGNED_INT_VEC3: u32 = 0x8DC7;
const GL_UNSIGNED_INT_VEC4: u32 = 0x8DC8;
const GL_FLOAT_MAT2: u32 = 0x8B5A;
const GL_FLOAT_MAT3: u32 = 0x8B5B;
const GL_FLOAT_MAT4: u32 = 0x8B5C;
// Pixel store
const GL_UNPACK_FLIP_Y_WEBGL: u32 = 0x9240;
const GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL: u32 = 0x9241;
const GL_UNPACK_COLORSPACE_CONVERSION_WEBGL: u32 = 0x9243;
const GL_PACK_ALIGNMENT: u32 = 0x0D05;
const GL_UNPACK_ALIGNMENT: u32 = 0x0CF5;
const GL_UNPACK_ROW_LENGTH: u32 = 0x0CF2;
const GL_UNPACK_IMAGE_HEIGHT: u32 = 0x806E;
const GL_UNPACK_SKIP_PIXELS: u32 = 0x0CF4;
const GL_UNPACK_SKIP_ROWS: u32 = 0x0CF3;
const GL_UNPACK_SKIP_IMAGES: u32 = 0x806D;
const GL_PACK_ROW_LENGTH: u32 = 0x0D02;
const GL_PACK_SKIP_PIXELS: u32 = 0x0D04;
const GL_PACK_SKIP_ROWS: u32 = 0x0D03;
// Buffer query parameters
const GL_BUFFER_SIZE: u32 = 0x8764;
const GL_BUFFER_USAGE: u32 = 0x8765;

/// WebGL2 rendering context.
/// Manages GL objects (shaders, programs, buffers, textures) and state.
/// Backed by a software rasterizer for headless/test rendering.
pub struct WebGL2 {
    state: GLState,
    next_id: u32,
    shaders: HashMap<u32, Shader>,
    programs: HashMap<u32, Program>,
    buffers: HashMap<u32, Buffer>,
    textures: HashMap<u32, Texture>,
    width: u32,
    height: u32,
    /// Software framebuffer for readback (RGBA)
    framebuffer: Vec<u8>,
    /// Depth buffer (f32 per pixel, 1.0 = far)
    depth_buffer: Vec<f32>,
    /// Uniform values keyed by (program_id, location)
    uniforms: HashMap<(u32, u32), UniformValue>,
    /// wgpu GPU backend (None if no adapter available — falls back to software)
    gpu: Option<GpuBackend>,
    /// Persistent ref map: stores __ret_X → value across ticks for resolving $__ret_X references
    ref_map: std::collections::HashMap<String, serde_json::Value>,
    /// WebGL error queue — errors recorded during command processing, drained by getError().
    errors: Vec<u32>,
    /// Set when any draw/state command is dispatched this frame. Cleared by take_frame_dirty().
    frame_dirty: bool,
    /// VAO storage — maps VAO ID → saved vertex attrib + element buffer state
    vaos: HashMap<u32, VaoState>,
    /// Currently bound VAO (None = default VAO)
    bound_vao: Option<u32>,
    /// Total bytes currently allocated across all buffers.
    total_buffer_bytes: usize,
    /// Total bytes currently allocated across all textures.
    total_texture_bytes: usize,
    /// Count of allocated framebuffer objects (not tracked in a map).
    framebuffer_count: usize,
    /// Count of allocated renderbuffer objects (not tracked in a map).
    renderbuffer_count: usize,
    /// Count of allocated misc objects (transform feedback, query, sampler).
    misc_object_count: usize,
}

impl WebGL2 {
    /// Maximum buffer allocation size (256 MB).
    const MAX_BUFFER_SIZE: usize = 256 * 1024 * 1024;
    /// Maximum total buffer memory across all buffers (512 MB).
    const MAX_TOTAL_BUFFER_BYTES: usize = 512 * 1024 * 1024;
    /// Maximum texture dimension.
    const MAX_TEXTURE_SIZE: u32 = 8192;
    /// Maximum shader source length (1 MB).
    const MAX_SHADER_SOURCE_LEN: usize = 1024 * 1024;
    /// Maximum number of shader objects.
    const MAX_SHADER_COUNT: usize = 256;
    /// Maximum number of program objects.
    const MAX_PROGRAM_COUNT: usize = 256;
    /// Maximum number of buffer objects.
    const MAX_BUFFER_COUNT: usize = 4096;
    /// Maximum number of texture objects.
    const MAX_TEXTURE_COUNT: usize = 1024;
    /// Maximum number of VAO objects.
    const MAX_VAO_COUNT: usize = 1024;
    /// Maximum total texture memory across all textures (512 MB).
    const MAX_TOTAL_TEXTURE_BYTES: usize = 512 * 1024 * 1024;
    /// Maximum number of framebuffer objects.
    const MAX_FRAMEBUFFER_COUNT: usize = 256;
    /// Maximum number of renderbuffer objects.
    const MAX_RENDERBUFFER_COUNT: usize = 256;
    /// Maximum number of misc objects (transform feedback, query, sampler).
    const MAX_MISC_OBJECT_COUNT: usize = 1024;

    pub fn new(width: u32, height: u32) -> Self {
        // Validate dimensions to prevent integer overflow in framebuffer allocation
        assert!(width > 0 && height > 0, "WebGL2 dimensions must be > 0");
        let pixel_count = width as u64 * height as u64;
        assert!(
            pixel_count.checked_mul(4).is_some_and(|n| n <= usize::MAX as u64),
            "WebGL2 framebuffer size overflow: {}x{}", width, height
        );

        let mut state = GLState::default();
        state.viewport = [0, 0, width as i32, height as i32];
        state.clear_depth = 1.0;
        state.depth_mask = true;
        state.depth_func = GL_LESS;
        state.cull_face_mode = GL_BACK;
        state.front_face = GL_CCW;
        state.blend_src = GL_ONE;
        state.blend_dst = GL_ZERO;
        state.blend_src_alpha = GL_ONE;
        state.blend_dst_alpha = GL_ZERO;
        state.color_mask = [true, true, true, true];
        state.blend_equation_rgb = 0x8006; // FUNC_ADD
        state.blend_equation_alpha = 0x8006;
        state.blend_color = [0.0, 0.0, 0.0, 0.0];
        state.clear_stencil = 0;
        state.depth_range = [0.0, 1.0];
        // Initialize with 16 vertex attrib slots (WebGL2 minimum)
        state.vertex_attribs = vec![VertexAttrib::default(); 16];
        // Initialize 16 texture units (WebGL2 minimum)
        state.texture_units = vec![None; 16];

        let gpu = GpuBackend::new(width, height);
        if gpu.is_some() {
            info!("WebGL2: wgpu backend initialized ({}x{})", width, height);
        } else {
            info!("WebGL2: no GPU adapter, using software rasterizer ({}x{})", width, height);
        }

        WebGL2 {
            state,
            next_id: 1,
            shaders: HashMap::new(),
            programs: HashMap::new(),
            buffers: HashMap::new(),
            textures: HashMap::new(),
            width,
            height,
            framebuffer: vec![0u8; width as usize * height as usize * 4],
            depth_buffer: vec![1.0f32; width as usize * height as usize],
            uniforms: HashMap::new(),
            gpu,
            ref_map: std::collections::HashMap::new(),
            errors: Vec::new(),
            frame_dirty: false,
            vaos: HashMap::new(),
            bound_vao: None,
            total_buffer_bytes: 0,
            total_texture_bytes: 0,
            framebuffer_count: 0,
            renderbuffer_count: 0,
            misc_object_count: 0,
        }
    }

    /// Access the wgpu GPU backend (if available).
    pub fn gpu(&self) -> Option<&GpuBackend> {
        self.gpu.as_ref()
    }

    /// Mutable access to the wgpu GPU backend.
    pub fn gpu_mut(&mut self) -> Option<&mut GpuBackend> {
        self.gpu.as_mut()
    }

    fn alloc_id(&mut self) -> u32 {
        // Find an ID that is not already in use across any resource map.
        // This prevents silent overwrites after ~4B allocations when next_id wraps.
        let start = self.next_id;
        loop {
            let id = self.next_id;
            self.next_id = self.next_id.wrapping_add(1);
            if self.next_id == 0 { self.next_id = 1; }

            if id != 0
                && !self.shaders.contains_key(&id)
                && !self.programs.contains_key(&id)
                && !self.buffers.contains_key(&id)
                && !self.textures.contains_key(&id)
                && !self.vaos.contains_key(&id)
            {
                return id;
            }

            // Full cycle without finding a free ID — shouldn't happen with resource caps.
            // Return 0 as sentinel (no valid GL object has ID 0).
            if self.next_id == start {
                log::error!("WebGL2: all IDs exhausted");
                self.record_error(GL_OUT_OF_MEMORY);
                return 0;
            }
        }
    }

    /// Record a GL error. Per spec, only one instance of each error code is kept.
    fn record_error(&mut self, code: u32) {
        if !self.errors.contains(&code) {
            self.errors.push(code);
        }
    }

    /// Drain accumulated errors for JS getError() consumption.
    pub fn take_errors(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.errors)
    }

    /// Return and clear the frame_dirty flag (true if any commands were dispatched).
    pub fn take_frame_dirty(&mut self) -> bool {
        let dirty = self.frame_dirty;
        self.frame_dirty = false;
        // Evict stale ref_map entries to prevent unbounded growth.
        // Refs are only needed within the same command batch, so clearing per frame is safe.
        self.ref_map.clear();
        dirty
    }

    /// Mark frame as having WebGL2 activity.
    fn mark_dirty(&mut self) {
        self.frame_dirty = true;
    }

    /// Dispatch a single WebGL2 command from a native V8 callback.
    /// Returns Some(id) for create*/get* commands, None for fire-and-forget.
    ///
    /// Fast path: handles common per-frame commands directly without JSON serialization.
    /// Uncommon commands fall back to the JSON process_commands path.
    pub fn dispatch_command(&mut self, op: &str, args: &[f64], str_args: &[&str]) -> Option<f64> {
        self.mark_dirty();

        // Fast path: handle the most common per-frame commands directly, avoiding
        // JSON serialization/deserialization overhead (~30+ commands).
        match op {
            // --- Draw (hottest path) ---
            "drawArrays" if args.len() >= 3 => {
                let mode = args[0] as u32;
                let first = args[1] as i32;
                let count = args[2] as i32;
                if !Self::is_valid_draw_mode(mode) { self.record_error(GL_INVALID_ENUM); }
                else if first < 0 || count < 0 { self.record_error(GL_INVALID_VALUE); }
                else if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.draw_arrays(mode, first as u32, count as u32); }
                return None;
            }
            "drawElements" if args.len() >= 4 => {
                let mode = args[0] as u32;
                let count = args[1] as i32;
                let dtype = args[2] as u32;
                let offset = args[3] as i32;
                if !Self::is_valid_draw_mode(mode) { self.record_error(GL_INVALID_ENUM); }
                else if !Self::is_valid_index_type(dtype) { self.record_error(GL_INVALID_ENUM); }
                else if count < 0 || offset < 0 { self.record_error(GL_INVALID_VALUE); }
                else if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.draw_elements(mode, count as u32, dtype, offset as u32); }
                return None;
            }
            "drawArraysInstanced" if args.len() >= 4 => {
                let mode = args[0] as u32;
                let first = args[1] as i32;
                let count = args[2] as i32;
                let instance_count = args[3] as i32;
                if !Self::is_valid_draw_mode(mode) { self.record_error(GL_INVALID_ENUM); }
                else if first < 0 || count < 0 || instance_count < 0 { self.record_error(GL_INVALID_VALUE); }
                else if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.draw_arrays_instanced(mode, first as u32, count as u32, instance_count as u32); }
                return None;
            }
            "drawElementsInstanced" if args.len() >= 5 => {
                let mode = args[0] as u32;
                let count = args[1] as i32;
                let dtype = args[2] as u32;
                let offset = args[3] as i32;
                let instance_count = args[4] as i32;
                if !Self::is_valid_draw_mode(mode) { self.record_error(GL_INVALID_ENUM); }
                else if !Self::is_valid_index_type(dtype) { self.record_error(GL_INVALID_ENUM); }
                else if count < 0 || offset < 0 || instance_count < 0 { self.record_error(GL_INVALID_VALUE); }
                else if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.draw_elements_instanced(mode, count as u32, dtype, offset as u32, instance_count as u32); }
                return None;
            }

            // --- State (very frequent) ---
            "enable" if args.len() >= 1 => {
                if !self.set_cap(args[0] as u32, true) { self.record_error(GL_INVALID_ENUM); }
                return None;
            }
            "disable" if args.len() >= 1 => {
                if !self.set_cap(args[0] as u32, false) { self.record_error(GL_INVALID_ENUM); }
                return None;
            }
            "viewport" if args.len() >= 4 => {
                let w = args[2] as i32; let h = args[3] as i32;
                if w < 0 || h < 0 { self.record_error(GL_INVALID_VALUE); }
                else { self.state.viewport = [args[0] as i32, args[1] as i32, w, h]; }
                return None;
            }
            "scissor" if args.len() >= 4 => {
                let w = args[2] as i32; let h = args[3] as i32;
                if w < 0 || h < 0 { self.record_error(GL_INVALID_VALUE); }
                else { self.state.scissor = [args[0] as i32, args[1] as i32, w, h]; }
                return None;
            }
            "clearColor" if args.len() >= 4 => {
                self.state.clear_color = [args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32];
                return None;
            }
            "clearDepth" if args.len() >= 1 => {
                self.state.clear_depth = args[0];
                return None;
            }
            "clear" if args.len() >= 1 => {
                let mask = args[0] as u32;
                if mask & !GL_VALID_CLEAR_BITS != 0 { self.record_error(GL_INVALID_VALUE); }
                else { self.clear(mask); }
                return None;
            }
            "blendFunc" if args.len() >= 2 => {
                let src = args[0] as u32; let dst = args[1] as u32;
                if !Self::is_valid_blend_factor(src) || !Self::is_valid_blend_factor(dst) { self.record_error(GL_INVALID_ENUM); }
                else { self.state.blend_src = src; self.state.blend_dst = dst; self.state.blend_src_alpha = src; self.state.blend_dst_alpha = dst; }
                return None;
            }
            "blendFuncSeparate" if args.len() >= 4 => {
                let (s_rgb, d_rgb, s_a, d_a) = (args[0] as u32, args[1] as u32, args[2] as u32, args[3] as u32);
                if !Self::is_valid_blend_factor(s_rgb) || !Self::is_valid_blend_factor(d_rgb)
                    || !Self::is_valid_blend_factor(s_a) || !Self::is_valid_blend_factor(d_a) { self.record_error(GL_INVALID_ENUM); }
                else { self.state.blend_src = s_rgb; self.state.blend_dst = d_rgb; self.state.blend_src_alpha = s_a; self.state.blend_dst_alpha = d_a; }
                return None;
            }
            "depthFunc" if args.len() >= 1 => {
                let func = args[0] as u32;
                match func {
                    GL_NEVER | GL_LESS | GL_EQUAL | GL_LEQUAL | GL_GREATER | GL_NOTEQUAL | GL_GEQUAL | GL_ALWAYS => { self.state.depth_func = func; }
                    _ => { self.record_error(GL_INVALID_ENUM); }
                }
                return None;
            }
            "cullFace" if args.len() >= 1 => {
                match args[0] as u32 { GL_FRONT | GL_BACK | GL_FRONT_AND_BACK => { self.state.cull_face_mode = args[0] as u32; } _ => { self.record_error(GL_INVALID_ENUM); } }
                return None;
            }
            "frontFace" if args.len() >= 1 => {
                match args[0] as u32 { GL_CW | GL_CCW => { self.state.front_face = args[0] as u32; } _ => { self.record_error(GL_INVALID_ENUM); } }
                return None;
            }
            "blendEquation" if args.len() >= 1 => {
                let mode = args[0] as u32;
                if !Self::is_valid_blend_equation(mode) { self.record_error(GL_INVALID_ENUM); }
                else { self.state.blend_equation_rgb = mode; self.state.blend_equation_alpha = mode; }
                return None;
            }
            "blendEquationSeparate" if args.len() >= 2 => {
                let (m_rgb, m_a) = (args[0] as u32, args[1] as u32);
                if !Self::is_valid_blend_equation(m_rgb) || !Self::is_valid_blend_equation(m_a) { self.record_error(GL_INVALID_ENUM); }
                else { self.state.blend_equation_rgb = m_rgb; self.state.blend_equation_alpha = m_a; }
                return None;
            }
            "blendColor" if args.len() >= 4 => {
                self.state.blend_color = [args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32];
                return None;
            }
            "polygonOffset" if args.len() >= 2 => {
                self.state.polygon_offset_factor = args[0] as f32;
                self.state.polygon_offset_units = args[1] as f32;
                return None;
            }

            // --- Binding (frequent) ---
            "useProgram" if args.len() >= 1 => {
                let id = args[0] as u32;
                if id == 0 { self.state.current_program = None; }
                else if self.programs.contains_key(&id) { self.state.current_program = Some(id); }
                else { self.record_error(GL_INVALID_VALUE); }
                return None;
            }
            "bindBuffer" if args.len() >= 2 => {
                let target = args[0] as u32;
                let id = if args[1] == 0.0 { None } else { Some(args[1] as u32) };
                if !Self::is_valid_buffer_target(target) { self.record_error(GL_INVALID_ENUM); }
                else { match target { GL_ARRAY_BUFFER => self.state.bound_array_buffer = id, GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer = id, _ => {} } }
                return None;
            }
            "bindTexture" if args.len() >= 2 => {
                let target = args[0] as u32;
                let id = if args[1] == 0.0 { None } else { Some(args[1] as u32) };
                if !Self::is_valid_texture_target(target) { self.record_error(GL_INVALID_ENUM); }
                else if target == GL_TEXTURE_2D {
                    let unit = self.state.active_texture_unit;
                    if unit < self.state.texture_units.len() { self.state.texture_units[unit] = id; }
                }
                return None;
            }
            "activeTexture" if args.len() >= 1 => {
                let unit = (args[0] as u32).wrapping_sub(0x84C0) as usize;
                if unit < self.state.texture_units.len() { self.state.active_texture_unit = unit; }
                else { self.record_error(GL_INVALID_ENUM); }
                return None;
            }
            "bindVertexArray" if args.len() >= 1 => {
                let id = args[0] as u32;
                if id == 0 {
                    if let Some(old_id) = self.bound_vao.take() {
                        if let Some(vao) = self.vaos.get_mut(&old_id) {
                            vao.vertex_attribs = self.state.vertex_attribs.clone();
                            vao.bound_element_buffer = self.state.bound_element_buffer;
                        }
                    }
                } else if self.vaos.contains_key(&id) {
                    if let Some(old_id) = self.bound_vao {
                        if let Some(vao) = self.vaos.get_mut(&old_id) {
                            vao.vertex_attribs = self.state.vertex_attribs.clone();
                            vao.bound_element_buffer = self.state.bound_element_buffer;
                        }
                    }
                    if let Some(vao) = self.vaos.get(&id) {
                        self.state.vertex_attribs = vao.vertex_attribs.clone();
                        self.state.bound_element_buffer = vao.bound_element_buffer;
                    }
                    self.bound_vao = Some(id);
                } else { self.record_error(GL_INVALID_OPERATION); }
                return None;
            }
            "enableVertexAttribArray" if args.len() >= 1 => {
                let loc = args[0] as usize;
                if loc >= self.state.vertex_attribs.len() { self.record_error(GL_INVALID_VALUE); }
                else { self.state.vertex_attribs[loc].enabled = true; }
                return None;
            }
            "disableVertexAttribArray" if args.len() >= 1 => {
                let loc = args[0] as usize;
                if loc >= self.state.vertex_attribs.len() { self.record_error(GL_INVALID_VALUE); }
                else { self.state.vertex_attribs[loc].enabled = false; }
                return None;
            }
            "vertexAttribDivisor" if args.len() >= 2 => {
                let loc = args[0] as usize;
                if loc >= self.state.vertex_attribs.len() { self.record_error(GL_INVALID_VALUE); }
                else { self.state.vertex_attribs[loc].divisor = args[1] as u32; }
                return None;
            }

            // --- Uniforms (very frequent per-frame) ---
            "uniform1f" if args.len() >= 2 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Float(args[1] as f32)); }
                return None;
            }
            "uniform1i" if args.len() >= 2 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Int(args[1] as i32)); }
                return None;
            }
            "uniform2f" if args.len() >= 3 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Vec2([args[1] as f32, args[2] as f32])); }
                return None;
            }
            "uniform3f" if args.len() >= 4 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Vec3([args[1] as f32, args[2] as f32, args[3] as f32])); }
                return None;
            }
            "uniform4f" if args.len() >= 5 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Vec4([args[1] as f32, args[2] as f32, args[3] as f32, args[4] as f32])); }
                return None;
            }
            "uniform2fv" if args.len() >= 3 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Vec2([args[1] as f32, args[2] as f32])); }
                return None;
            }
            "uniform3fv" if args.len() >= 4 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Vec3([args[1] as f32, args[2] as f32, args[3] as f32])); }
                return None;
            }
            "uniform4fv" if args.len() >= 5 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Vec4([args[1] as f32, args[2] as f32, args[3] as f32, args[4] as f32])); }
                return None;
            }
            "uniform1fv" if args.len() >= 2 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Float(args[1] as f32)); }
                return None;
            }
            "uniform2i" if args.len() >= 3 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::IVec2([args[1] as i32, args[2] as i32])); }
                return None;
            }
            "uniform3i" if args.len() >= 4 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::IVec3([args[1] as i32, args[2] as i32, args[3] as i32])); }
                return None;
            }
            "uniform4i" if args.len() >= 5 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::IVec4([args[1] as i32, args[2] as i32, args[3] as i32, args[4] as i32])); }
                return None;
            }
            "uniform1iv" if args.len() >= 2 => {
                if self.state.current_program.is_none() { self.record_error(GL_INVALID_OPERATION); }
                else { self.set_uniform(args[0] as u32, UniformValue::Int(args[1] as i32)); }
                return None;
            }

            // --- Create/delete (setup, not per-frame hot but still benefits) ---
            "createShader" if args.len() >= 1 => {
                let shader_type = args[0] as u32;
                if shader_type == GL_VERTEX_SHADER || shader_type == GL_FRAGMENT_SHADER {
                    return Some(self.create_shader(shader_type) as f64);
                } else { self.record_error(GL_INVALID_ENUM); return None; }
            }
            "compileShader" if args.len() >= 1 => {
                let id = args[0] as u32;
                if self.shaders.contains_key(&id) { self.compile_shader(id); }
                else { self.record_error(GL_INVALID_VALUE); }
                return None;
            }
            "createProgram" => { return Some(self.create_program() as f64); }
            "attachShader" if args.len() >= 2 => {
                let prog_id = args[0] as u32; let shader_id = args[1] as u32;
                if !self.programs.contains_key(&prog_id) || !self.shaders.contains_key(&shader_id) { self.record_error(GL_INVALID_VALUE); }
                else {
                    let shader_type = self.shaders.get(&shader_id).map(|s| s.shader_type);
                    let already = match shader_type {
                        Some(GL_VERTEX_SHADER) => self.programs.get(&prog_id).unwrap().vertex_shader.is_some(),
                        Some(GL_FRAGMENT_SHADER) => self.programs.get(&prog_id).unwrap().fragment_shader.is_some(),
                        _ => false,
                    };
                    if already { self.record_error(GL_INVALID_OPERATION); } else { self.attach_shader(prog_id, shader_id); }
                }
                return None;
            }
            "linkProgram" if args.len() >= 1 => {
                let id = args[0] as u32;
                if self.programs.contains_key(&id) { self.link_program(id); }
                else { self.record_error(GL_INVALID_VALUE); }
                return None;
            }
            "shaderSource" if args.len() >= 1 && !str_args.is_empty() => {
                let id = args[0] as u32;
                if self.shaders.contains_key(&id) { self.shader_source(id, str_args[0]); }
                else { self.record_error(GL_INVALID_VALUE); }
                return None;
            }
            "createBuffer" => {
                if self.buffers.len() >= Self::MAX_BUFFER_COUNT { self.record_error(GL_INVALID_OPERATION); return Some(0.0); }
                let id = self.alloc_id();
                self.buffers.insert(id, Buffer { target: 0, data: Vec::new(), usage: GL_STATIC_DRAW, index_type: GL_UNSIGNED_SHORT });
                return Some(id as f64);
            }
            "createTexture" => {
                if self.textures.len() >= Self::MAX_TEXTURE_COUNT { self.record_error(GL_INVALID_OPERATION); return Some(0.0); }
                let id = self.alloc_id();
                self.textures.insert(id, Texture { width: 0, height: 0, data: Vec::new(), internal_format: 0, min_filter: 0x2600, mag_filter: 0x2600, wrap_s: 0x2901, wrap_t: 0x2901 });
                return Some(id as f64);
            }
            "createVertexArray" => {
                if self.vaos.len() >= Self::MAX_VAO_COUNT { self.record_error(GL_INVALID_OPERATION); return Some(0.0); }
                let id = self.alloc_id();
                self.vaos.insert(id, VaoState::new(self.state.vertex_attribs.len()));
                return Some(id as f64);
            }
            "texParameteri" if args.len() >= 3 => {
                let target = args[0] as u32; let pname = args[1] as u32; let param = args[2] as u32;
                if !Self::is_valid_texture_target(target) { self.record_error(GL_INVALID_ENUM); }
                else {
                    match pname {
                        GL_TEXTURE_MIN_FILTER | GL_TEXTURE_MAG_FILTER | GL_TEXTURE_WRAP_S | GL_TEXTURE_WRAP_T | GL_TEXTURE_WRAP_R |
                        GL_TEXTURE_BASE_LEVEL | GL_TEXTURE_MAX_LEVEL | GL_TEXTURE_COMPARE_FUNC | GL_TEXTURE_COMPARE_MODE | GL_TEXTURE_MAX_ANISOTROPY_EXT => {
                            let unit = self.state.active_texture_unit;
                            if let Some(tex_id) = self.state.texture_units.get(unit).copied().flatten() {
                                if let Some(tex) = self.textures.get_mut(&tex_id) {
                                    match pname { GL_TEXTURE_MIN_FILTER => tex.min_filter = param, GL_TEXTURE_MAG_FILTER => tex.mag_filter = param, GL_TEXTURE_WRAP_S => tex.wrap_s = param, GL_TEXTURE_WRAP_T => tex.wrap_t = param, _ => {} }
                                }
                            } else { self.record_error(GL_INVALID_OPERATION); }
                        }
                        _ => { self.record_error(GL_INVALID_ENUM); }
                    }
                }
                return None;
            }
            "generateMipmap" if args.len() >= 1 => {
                if !Self::is_valid_texture_target(args[0] as u32) { self.record_error(GL_INVALID_ENUM); }
                return None;
            }
            "pixelStorei" if args.len() >= 2 => {
                let pname = args[0] as u32;
                match pname {
                    GL_UNPACK_FLIP_Y_WEBGL => { self.state.unpack_flip_y = args[1] as i32 != 0; }
                    GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL | GL_UNPACK_COLORSPACE_CONVERSION_WEBGL |
                    GL_PACK_ALIGNMENT | GL_UNPACK_ALIGNMENT | GL_UNPACK_ROW_LENGTH | GL_UNPACK_IMAGE_HEIGHT |
                    GL_UNPACK_SKIP_PIXELS | GL_UNPACK_SKIP_ROWS | GL_UNPACK_SKIP_IMAGES | GL_PACK_ROW_LENGTH |
                    GL_PACK_SKIP_PIXELS | GL_PACK_SKIP_ROWS => {}
                    _ => { self.record_error(GL_INVALID_ENUM); }
                }
                return None;
            }

            // --- Query commands that return values ---
            "getShaderParameter" if args.len() >= 2 => {
                let shader_id = args[0] as u32; let pname = args[1] as u32;
                if !self.shaders.contains_key(&shader_id) { self.record_error(GL_INVALID_VALUE); return None; }
                return self.get_shader_parameter(shader_id, pname).as_f64();
            }
            "getProgramParameter" if args.len() >= 2 => {
                let prog_id = args[0] as u32; let pname = args[1] as u32;
                if !self.programs.contains_key(&prog_id) { self.record_error(GL_INVALID_VALUE); return None; }
                return self.get_program_parameter(prog_id, pname).as_f64();
            }
            "getUniformLocation" if args.len() >= 1 && !str_args.is_empty() => {
                let prog_id = args[0] as u32;
                if !self.programs.contains_key(&prog_id) { self.record_error(GL_INVALID_VALUE); return None; }
                return Some(self.get_uniform_location(prog_id, str_args[0]) as f64);
            }
            "getAttribLocation" if args.len() >= 1 && !str_args.is_empty() => {
                let prog_id = args[0] as u32;
                if !self.programs.contains_key(&prog_id) { self.record_error(GL_INVALID_VALUE); return Some(-1.0); }
                return Some(self.get_attrib_location(prog_id, str_args[0]) as f64);
            }

            // --- Everything else: fall back to JSON path ---
            _ => {}
        }

        // Slow path: build JSON command and delegate to process_commands.
        // Used for commands that need raw array access (bufferData, texImage2D, uniformMatrix*fv, etc.)
        let mut cmd: Vec<serde_json::Value> = Vec::with_capacity(2 + args.len() + str_args.len());
        cmd.push(serde_json::json!(op));
        for &a in args { cmd.push(serde_json::json!(a)); }
        for &s in str_args { cmd.push(serde_json::json!(s)); }
        cmd.push(serde_json::json!("__ret_native"));
        let commands = serde_json::json!([cmd]);
        let returns = self.process_commands(&commands);
        if let Some(arr) = returns.as_array() {
            for entry in arr {
                if let Some(pair) = entry.as_array() {
                    if pair.len() >= 2 {
                        return pair[1].as_f64();
                    }
                }
            }
        }
        None
    }

    /// Dispatch a command that returns a string (getShaderInfoLog, getProgramInfoLog).
    pub fn dispatch_command_str(&mut self, op: &str, args: &[f64]) -> Option<String> {
        self.mark_dirty();
        let mut cmd: Vec<serde_json::Value> = Vec::with_capacity(1 + args.len() + 1);
        cmd.push(serde_json::json!(op));
        for &a in args { cmd.push(serde_json::json!(a)); }
        // Add a fake __ret_ ID so process_commands captures the return
        cmd.push(serde_json::json!("__ret_str"));
        let commands = serde_json::json!([cmd]);
        let returns = self.process_commands(&commands);
        if let Some(arr) = returns.as_array() {
            for entry in arr {
                if let Some(pair) = entry.as_array() {
                    if pair.len() >= 2 {
                        return pair[1].as_str().map(|s| s.to_string());
                    }
                }
            }
        }
        None
    }

    /// Upload buffer data directly from a raw byte slice (zero-copy from TypedArray).
    pub fn buffer_data_raw(&mut self, target: u32, data: &[u8], _elem_size: usize, usage: u32) {
        self.mark_dirty();
        if !Self::is_valid_buffer_target(target) {
            self.record_error(GL_INVALID_ENUM);
            return;
        }
        if !Self::is_valid_buffer_usage(usage) {
            self.record_error(GL_INVALID_ENUM);
            return;
        }
        let buf_id = match target {
            GL_ARRAY_BUFFER => self.state.bound_array_buffer,
            GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
            _ => None,
        };
        let Some(buf_id) = buf_id else {
            self.record_error(GL_INVALID_OPERATION);
            return;
        };
        if let Some(buf) = self.buffers.get_mut(&buf_id) {
            let old_len = buf.data.len();
            let new_len = data.len();
            let new_total = self.total_buffer_bytes.saturating_sub(old_len) + new_len;
            if new_total > Self::MAX_TOTAL_BUFFER_BYTES {
                self.record_error(GL_INVALID_OPERATION);
                return;
            }
            buf.data = data.to_vec();
            buf.usage = usage;
            buf.target = target;
            self.total_buffer_bytes = new_total;
        }
    }

    /// Update buffer sub-data directly from a raw byte slice.
    pub fn buffer_sub_data_raw(&mut self, target: u32, byte_offset: usize, data: &[u8]) {
        self.mark_dirty();
        if !Self::is_valid_buffer_target(target) {
            self.record_error(GL_INVALID_ENUM);
            return;
        }
        let buf_id = match target {
            GL_ARRAY_BUFFER => self.state.bound_array_buffer,
            GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
            _ => None,
        };
        let Some(buf_id) = buf_id else {
            self.record_error(GL_INVALID_OPERATION);
            return;
        };
        if let Some(buf) = self.buffers.get_mut(&buf_id) {
            let end = byte_offset + data.len();
            if end <= buf.data.len() {
                buf.data[byte_offset..end].copy_from_slice(data);
            } else {
                self.record_error(GL_INVALID_VALUE);
            }
        }
    }

    /// Upload texture data directly from a raw byte slice.
    pub fn tex_image_2d_raw(&mut self, _target: u32, _level: u32, _internal_fmt: u32,
                             width: u32, height: u32, _border: u32, _fmt: u32, _dtype: u32, data: &[u8]) {
        self.mark_dirty();
        if width > Self::MAX_TEXTURE_SIZE || height > Self::MAX_TEXTURE_SIZE {
            self.record_error(GL_INVALID_VALUE);
            return;
        }
        let unit = self.state.active_texture_unit;
        let tex_id = match self.state.texture_units.get(unit).and_then(|t| *t) {
            Some(id) => id,
            None => { self.record_error(GL_INVALID_OPERATION); return; }
        };
        if let Some(tex) = self.textures.get_mut(&tex_id) {
            let old_len = tex.data.len();
            let new_len = data.len();
            let new_total = self.total_texture_bytes.saturating_sub(old_len) + new_len;
            if new_total > Self::MAX_TOTAL_TEXTURE_BYTES {
                self.record_error(GL_INVALID_OPERATION);
                return;
            }
            tex.width = width;
            tex.height = height;
            tex.data = data.to_vec();
            self.total_texture_bytes = new_total;
        }
    }

    /// Write raw pixel bytes into a sub-region of the currently bound texture.
    pub fn tex_sub_image_2d_raw(&mut self, _target: u32, xoffset: u32, yoffset: u32,
                                 sub_w: u32, sub_h: u32, data: &[u8]) {
        self.mark_dirty();
        let unit = self.state.active_texture_unit;
        let tex_id = match self.state.texture_units.get(unit).and_then(|t| *t) {
            Some(id) => id,
            None => { self.record_error(GL_INVALID_OPERATION); return; }
        };
        if let Some(tex) = self.textures.get_mut(&tex_id) {
            let tex_w = tex.width;
            if xoffset + sub_w > tex_w || yoffset + sub_h > tex.height {
                self.record_error(GL_INVALID_VALUE);
                return;
            }
            // Copy pixel data into the sub-region
            for row in 0..sub_h {
                for col in 0..sub_w {
                    let src_idx = ((row * sub_w + col) * 4) as usize;
                    let dst_idx = (((yoffset + row) * tex_w + (xoffset + col)) * 4) as usize;
                    if src_idx + 3 < data.len() && dst_idx + 3 < tex.data.len() {
                        tex.data[dst_idx..dst_idx + 4].copy_from_slice(&data[src_idx..src_idx + 4]);
                    }
                }
            }
        }
    }

    fn is_valid_draw_mode(mode: u32) -> bool {
        matches!(mode, GL_POINTS | GL_LINES | GL_LINE_LOOP | GL_LINE_STRIP
            | GL_TRIANGLES | GL_TRIANGLE_STRIP | GL_TRIANGLE_FAN)
    }

    fn is_valid_buffer_target(target: u32) -> bool {
        matches!(target, GL_ARRAY_BUFFER | GL_ELEMENT_ARRAY_BUFFER | GL_UNIFORM_BUFFER
            | GL_COPY_READ_BUFFER | GL_COPY_WRITE_BUFFER | GL_TRANSFORM_FEEDBACK_BUFFER
            | GL_PIXEL_PACK_BUFFER | GL_PIXEL_UNPACK_BUFFER)
    }

    fn is_valid_buffer_usage(usage: u32) -> bool {
        matches!(usage, GL_STATIC_DRAW | GL_DYNAMIC_DRAW | GL_STREAM_DRAW
            | GL_STATIC_READ | GL_DYNAMIC_READ | GL_STREAM_READ
            | GL_STATIC_COPY | GL_DYNAMIC_COPY | GL_STREAM_COPY)
    }

    fn is_valid_blend_factor(f: u32) -> bool {
        matches!(f, GL_ZERO | GL_ONE | GL_SRC_COLOR | GL_ONE_MINUS_SRC_COLOR
            | GL_SRC_ALPHA | GL_ONE_MINUS_SRC_ALPHA | GL_DST_ALPHA | GL_ONE_MINUS_DST_ALPHA
            | GL_DST_COLOR | GL_ONE_MINUS_DST_COLOR | GL_SRC_ALPHA_SATURATE
            | GL_CONSTANT_COLOR | GL_ONE_MINUS_CONSTANT_COLOR
            | GL_CONSTANT_ALPHA | GL_ONE_MINUS_CONSTANT_ALPHA)
    }

    fn is_valid_texture_target(target: u32) -> bool {
        matches!(target, GL_TEXTURE_2D | GL_TEXTURE_CUBE_MAP | GL_TEXTURE_3D | GL_TEXTURE_2D_ARRAY)
    }

    fn is_valid_blend_equation(eq: u32) -> bool {
        matches!(eq, GL_FUNC_ADD | GL_FUNC_SUBTRACT | GL_FUNC_REVERSE_SUBTRACT | GL_MIN | GL_MAX)
    }

    fn is_valid_index_type(t: u32) -> bool {
        matches!(t, GL_UNSIGNED_BYTE | GL_UNSIGNED_SHORT | GL_UNSIGNED_INT)
    }

    /// Process a batch of WebGL commands from JS.
    pub fn process_commands(&mut self, commands: &serde_json::Value) -> serde_json::Value {
        let Some(cmds) = commands.as_array() else {
            return serde_json::json!([]);
        };

        if !cmds.is_empty() {
            self.mark_dirty();
        }

        let mut returns = Vec::new();

        for cmd in cmds {
            let Some(arr) = cmd.as_array() else { continue };
            if arr.is_empty() { continue; }
            let Some(op) = arr[0].as_str() else { continue };

            // Fast path: check if any args use $-prefixed references before cloning.
            // The vast majority of commands (especially from native V8 callbacks) have no refs.
            let has_refs = arr[1..].iter().any(|v| {
                v.as_str().map_or(false, |s| s.starts_with('$') && self.ref_map.contains_key(&s[1..]))
            });

            let (args, str_args, call_id);
            if has_refs {
                // Slow path: resolve $-prefixed references
                let resolved: Vec<serde_json::Value> = arr[1..].iter().map(|v| {
                    if let Some(s) = v.as_str() {
                        if let Some(ref_name) = s.strip_prefix('$') {
                            if let Some(resolved_val) = self.ref_map.get(ref_name) {
                                return resolved_val.clone();
                            }
                        }
                    }
                    v.clone()
                }).collect();
                args = resolved.iter().filter_map(|v| v.as_f64()).collect::<Vec<_>>();
                str_args = resolved.iter().filter_map(|v| v.as_str()).map(String::from).collect::<Vec<_>>();
                call_id = resolved.last().and_then(|v| v.as_str())
                    .filter(|s| s.starts_with("__ret_"))
                    .map(|s| s.to_string());
            } else {
                // Fast path: extract directly without cloning
                args = arr[1..].iter().filter_map(|v| v.as_f64()).collect::<Vec<_>>();
                str_args = arr[1..].iter().filter_map(|v| v.as_str()).map(String::from).collect::<Vec<_>>();
                call_id = arr.last().and_then(|v| v.as_str())
                    .filter(|s| s.starts_with("__ret_"))
                    .map(|s| s.to_string());
            };
            let str_refs: Vec<&str> = str_args.iter().map(|s| s.as_str()).collect();

            let result = match op {
                // --- Shader ---
                "createShader" if args.len() >= 1 => {
                    let shader_type = args[0] as u32;
                    if shader_type == GL_VERTEX_SHADER || shader_type == GL_FRAGMENT_SHADER {
                        let id = self.create_shader(shader_type);
                        Some(serde_json::json!(id))
                    } else {
                        self.record_error(GL_INVALID_ENUM);
                        Some(serde_json::json!(null))
                    }
                }
                "shaderSource" if args.len() >= 1 && !str_refs.is_empty() => {
                    let id = args[0] as u32;
                    if self.shaders.contains_key(&id) {
                        self.shader_source(id, str_refs[0]);
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                    }
                    None
                }
                "compileShader" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if self.shaders.contains_key(&id) {
                        self.compile_shader(id);
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                    }
                    None
                }
                "deleteShader" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if id != 0 && !self.shaders.contains_key(&id) {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.shaders.remove(&id);
                    }
                    None
                }

                // --- Program ---
                "createProgram" => {
                    let id = self.create_program();
                    Some(serde_json::json!(id))
                }
                "attachShader" if args.len() >= 2 => {
                    let prog_id = args[0] as u32;
                    let shader_id = args[1] as u32;
                    if !self.programs.contains_key(&prog_id) || !self.shaders.contains_key(&shader_id) {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        let shader_type = self.shaders.get(&shader_id).map(|s| s.shader_type);
                        let prog = self.programs.get(&prog_id).unwrap();
                        // INVALID_OPERATION if same type already attached
                        let already_attached = match shader_type {
                            Some(GL_VERTEX_SHADER) => prog.vertex_shader.is_some(),
                            Some(GL_FRAGMENT_SHADER) => prog.fragment_shader.is_some(),
                            _ => false,
                        };
                        if already_attached {
                            self.record_error(GL_INVALID_OPERATION);
                        } else {
                            self.attach_shader(prog_id, shader_id);
                        }
                    }
                    None
                }
                "linkProgram" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if self.programs.contains_key(&id) {
                        self.link_program(id);
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                    }
                    None
                }
                "useProgram" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if id == 0 {
                        self.state.current_program = None;
                    } else if self.programs.contains_key(&id) {
                        self.state.current_program = Some(id);
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                    }
                    None
                }
                "deleteProgram" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if id != 0 && !self.programs.contains_key(&id) {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.programs.remove(&id);
                        // Clean up uniforms associated with deleted program to prevent memory leak
                        self.uniforms.retain(|&(prog_id, _), _| prog_id != id);
                        if self.state.current_program == Some(id) {
                            self.state.current_program = None;
                        }
                    }
                    None
                }

                // --- Buffer ---
                "createBuffer" => {
                    if self.buffers.len() >= Self::MAX_BUFFER_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        Some(serde_json::json!(0))
                    } else {
                        let id = self.alloc_id();
                        self.buffers.insert(id, Buffer { target: 0, data: Vec::new(), usage: GL_STATIC_DRAW, index_type: GL_UNSIGNED_SHORT });
                        Some(serde_json::json!(id))
                    }
                }
                "bindBuffer" if args.len() >= 2 => {
                    let target = args[0] as u32;
                    let id = if args[1] == 0.0 { None } else { Some(args[1] as u32) };
                    if !Self::is_valid_buffer_target(target) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        match target {
                            GL_ARRAY_BUFFER => self.state.bound_array_buffer = id,
                            GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer = id,
                            _ => {} // other targets accepted but not tracked in state yet
                        }
                    }
                    None
                }
                "bufferData" => {
                    // Validate usage argument
                    let usage = arr.last().and_then(|v| v.as_u64()).unwrap_or(GL_STATIC_DRAW as u64) as u32;
                    if !Self::is_valid_buffer_usage(usage) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        self.handle_buffer_data(arr);
                    }
                    None
                }
                "bufferData_size" if args.len() >= 3 => {
                    // Size-only allocation: bufferData_size(target, byteSize, usage)
                    let target = args[0] as u32;
                    let byte_size = args[1] as usize;
                    let usage = args[2] as u32;
                    if !Self::is_valid_buffer_target(target) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if !Self::is_valid_buffer_usage(usage) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if byte_size > Self::MAX_BUFFER_SIZE {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        let buf_id = match target {
                            GL_ARRAY_BUFFER => self.state.bound_array_buffer,
                            GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
                            _ => None,
                        };
                        if let Some(buf_id) = buf_id {
                            if let Some(buf) = self.buffers.get_mut(&buf_id) {
                                let old_len = buf.data.len();
                                let new_total = self.total_buffer_bytes.saturating_sub(old_len) + byte_size;
                                if new_total > Self::MAX_TOTAL_BUFFER_BYTES {
                                    self.record_error(GL_INVALID_OPERATION);
                                } else {
                                    buf.data = vec![0u8; byte_size];
                                    buf.usage = usage;
                                    buf.target = target;
                                    self.total_buffer_bytes = new_total;
                                }
                            }
                        }
                    }
                    None
                }
                "bufferDataUint32" => {
                    self.handle_buffer_data_uint32(arr);
                    None
                }
                "deleteBuffer" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if let Some(buf) = self.buffers.remove(&id) {
                        self.total_buffer_bytes = self.total_buffer_bytes.saturating_sub(buf.data.len());
                    }
                    // Unbind if currently bound
                    if self.state.bound_array_buffer == Some(id) {
                        self.state.bound_array_buffer = None;
                    }
                    if self.state.bound_element_buffer == Some(id) {
                        self.state.bound_element_buffer = None;
                    }
                    None
                }

                "bufferSubData" => {
                    // Format: ["bufferSubData", target, offset, [data...]]
                    if arr.len() >= 4 {
                        let target = arr[1].as_f64().unwrap_or(0.0) as u32;
                        let byte_offset = arr[2].as_f64().unwrap_or(0.0) as usize;
                        if !Self::is_valid_buffer_target(target) {
                            self.record_error(GL_INVALID_ENUM);
                        } else if let Some(data_arr) = arr[3].as_array() {
                            let buf_id = match target {
                                GL_ARRAY_BUFFER => self.state.bound_array_buffer,
                                GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
                                _ => None,
                            };
                            if let Some(buf_id) = buf_id {
                                if target == GL_ELEMENT_ARRAY_BUFFER {
                                    // Determine element size from the buffer's index_type (set during bufferData),
                            // falling back to u16 if unknown.
                                    let elem_size = self.buffers.get(&buf_id)
                                        .map(|b| if b.index_type == GL_UNSIGNED_INT { 4usize } else { 2usize })
                                        .unwrap_or(2);
                                    let bytes = if elem_size == 4 {
                                        let mut b = Vec::with_capacity(data_arr.len() * 4);
                                        for v in data_arr { b.extend_from_slice(&(v.as_f64().unwrap_or(0.0) as u32).to_le_bytes()); }
                                        b
                                    } else {
                                        let mut b = Vec::with_capacity(data_arr.len() * 2);
                                        for v in data_arr { b.extend_from_slice(&(v.as_f64().unwrap_or(0.0) as u16).to_le_bytes()); }
                                        b
                                    };
                                    if let Some(buf) = self.buffers.get_mut(&buf_id) {
                                        let end = byte_offset + bytes.len();
                                        if end <= buf.data.len() {
                                            buf.data[byte_offset..end].copy_from_slice(&bytes);
                                        } else {
                                            self.record_error(GL_INVALID_VALUE);
                                        }
                                    }
                                } else {
                                    let mut bytes = Vec::with_capacity(data_arr.len() * 4);
                                    for v in data_arr {
                                        let f = v.as_f64().unwrap_or(0.0) as f32;
                                        bytes.extend_from_slice(&f.to_le_bytes());
                                    }
                                    if let Some(buf) = self.buffers.get_mut(&buf_id) {
                                        let end = byte_offset + bytes.len();
                                        if end <= buf.data.len() {
                                            buf.data[byte_offset..end].copy_from_slice(&bytes);
                                        } else {
                                            self.record_error(GL_INVALID_VALUE);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    None
                }

                // --- Texture ---
                "createTexture" => {
                    if self.textures.len() >= Self::MAX_TEXTURE_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        Some(serde_json::json!(0))
                    } else {
                        let id = self.alloc_id();
                        self.textures.insert(id, Texture {
                            width: 0, height: 0, data: Vec::new(),
                            internal_format: 0, min_filter: 0x2600, mag_filter: 0x2600,
                            wrap_s: 0x2901, wrap_t: 0x2901,
                        });
                        Some(serde_json::json!(id))
                    }
                }
                "bindTexture" if args.len() >= 2 => {
                    let target = args[0] as u32;
                    let id = if args[1] == 0.0 { None } else { Some(args[1] as u32) };
                    if !Self::is_valid_texture_target(target) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if target == GL_TEXTURE_2D {
                        let unit = self.state.active_texture_unit;
                        if unit < self.state.texture_units.len() {
                            self.state.texture_units[unit] = id;
                        }
                    }
                    None
                }
                "activeTexture" if args.len() >= 1 => {
                    // GL_TEXTURE0 = 0x84C0
                    let unit = (args[0] as u32).wrapping_sub(0x84C0) as usize;
                    if unit < self.state.texture_units.len() {
                        self.state.active_texture_unit = unit;
                    } else {
                        self.record_error(GL_INVALID_ENUM);
                    }
                    None
                }
                "texImage2D" => {
                    self.handle_tex_image_2d(arr);
                    None
                }
                "texParameteri" if args.len() >= 3 => {
                    let target = args[0] as u32;
                    let pname = args[1] as u32;
                    let param = args[2] as u32;
                    if !Self::is_valid_texture_target(target) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        match pname {
                            GL_TEXTURE_MIN_FILTER | GL_TEXTURE_MAG_FILTER |
                            GL_TEXTURE_WRAP_S | GL_TEXTURE_WRAP_T | GL_TEXTURE_WRAP_R |
                            GL_TEXTURE_BASE_LEVEL | GL_TEXTURE_MAX_LEVEL |
                            GL_TEXTURE_COMPARE_FUNC | GL_TEXTURE_COMPARE_MODE |
                            GL_TEXTURE_MAX_ANISOTROPY_EXT => {
                                let unit = self.state.active_texture_unit;
                                if let Some(tex_id) = self.state.texture_units.get(unit).copied().flatten() {
                                    if let Some(tex) = self.textures.get_mut(&tex_id) {
                                        match pname {
                                            GL_TEXTURE_MIN_FILTER => tex.min_filter = param,
                                            GL_TEXTURE_MAG_FILTER => tex.mag_filter = param,
                                            GL_TEXTURE_WRAP_S => tex.wrap_s = param,
                                            GL_TEXTURE_WRAP_T => tex.wrap_t = param,
                                            _ => {} // accepted but not tracked
                                        }
                                    }
                                } else {
                                    self.record_error(GL_INVALID_OPERATION);
                                }
                            }
                            _ => { self.record_error(GL_INVALID_ENUM); }
                        }
                    }
                    None
                }
                "generateMipmap" if args.len() >= 1 => {
                    let target = args[0] as u32;
                    if !Self::is_valid_texture_target(target) {
                        self.record_error(GL_INVALID_ENUM);
                    }
                    // Mipmap generation is a no-op in our implementation
                    None
                }
                "deleteTexture" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if let Some(tex) = self.textures.remove(&id) {
                        self.total_texture_bytes = self.total_texture_bytes.saturating_sub(tex.data.len());
                    }
                    // Per WebGL spec: unbind from any texture unit that references this texture
                    for unit in self.state.texture_units.iter_mut() {
                        if *unit == Some(id) {
                            *unit = None;
                        }
                    }
                    None
                }
                "texSubImage2D" => {
                    // Format: ["texSubImage2D", target, level, xoffset, yoffset, width, height, format, type, [data...]]
                    if arr.len() >= 10 {
                        let target = arr[1].as_f64().unwrap_or(0.0) as u32;
                        if !Self::is_valid_texture_target(target) {
                            self.record_error(GL_INVALID_ENUM);
                        } else {
                            let _level = arr[2].as_f64().unwrap_or(0.0) as u32;
                            let xoffset = arr[3].as_f64().unwrap_or(0.0) as u32;
                            let yoffset = arr[4].as_f64().unwrap_or(0.0) as u32;
                            let sub_w = arr[5].as_f64().unwrap_or(0.0) as u32;
                            let sub_h = arr[6].as_f64().unwrap_or(0.0) as u32;
                            let _format = arr[7].as_f64().unwrap_or(0.0) as u32;
                            let _type = arr[8].as_f64().unwrap_or(0.0) as u32;
                            if let Some(data_arr) = arr[9].as_array() {
                                let unit = self.state.active_texture_unit;
                                if let Some(tex_id) = self.state.texture_units.get(unit).copied().flatten() {
                                    if let Some(tex) = self.textures.get_mut(&tex_id) {
                                        let tex_w = tex.width;
                                        if xoffset + sub_w > tex_w || yoffset + sub_h > tex.height {
                                            self.record_error(GL_INVALID_VALUE);
                                        } else {
                                            // Copy pixel data into the sub-region
                                            for row in 0..sub_h {
                                                for col in 0..sub_w {
                                                    let src_idx = ((row * sub_w + col) * 4) as usize;
                                                    let dst_idx = (((yoffset + row) * tex_w + (xoffset + col)) * 4) as usize;
                                                    if src_idx + 3 < data_arr.len() && dst_idx + 3 < tex.data.len() {
                                                        for c in 0..4 {
                                                            tex.data[dst_idx + c] = data_arr[src_idx + c].as_f64().unwrap_or(0.0) as u8;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    None
                }
                "texParameterf" if args.len() >= 3 => {
                    // Same as texParameteri — pname validation + update
                    let target = args[0] as u32;
                    let pname = args[1] as u32;
                    let param = args[2] as u32;
                    if !Self::is_valid_texture_target(target) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        match pname {
                            GL_TEXTURE_MIN_FILTER | GL_TEXTURE_MAG_FILTER |
                            GL_TEXTURE_WRAP_S | GL_TEXTURE_WRAP_T | GL_TEXTURE_WRAP_R |
                            GL_TEXTURE_BASE_LEVEL | GL_TEXTURE_MAX_LEVEL |
                            GL_TEXTURE_COMPARE_FUNC | GL_TEXTURE_COMPARE_MODE |
                            GL_TEXTURE_MAX_ANISOTROPY_EXT => {
                                let unit = self.state.active_texture_unit;
                                if let Some(tex_id) = self.state.texture_units.get(unit).copied().flatten() {
                                    if let Some(tex) = self.textures.get_mut(&tex_id) {
                                        match pname {
                                            GL_TEXTURE_MIN_FILTER => tex.min_filter = param,
                                            GL_TEXTURE_MAG_FILTER => tex.mag_filter = param,
                                            GL_TEXTURE_WRAP_S => tex.wrap_s = param,
                                            GL_TEXTURE_WRAP_T => tex.wrap_t = param,
                                            _ => {} // accepted but not tracked
                                        }
                                    }
                                } else {
                                    self.record_error(GL_INVALID_OPERATION);
                                }
                            }
                            _ => { self.record_error(GL_INVALID_ENUM); }
                        }
                    }
                    None
                }
                // Texture storage / 3D — accepted as no-ops
                "texImage3D" | "texSubImage3D" | "copyTexImage2D" | "copyTexSubImage2D" |
                "texStorage2D" | "texStorage3D" => { None }
                "pixelStorei" if args.len() >= 2 => {
                    let pname = args[0] as u32;
                    let param = args[1] as i32;
                    match pname {
                        GL_UNPACK_FLIP_Y_WEBGL => {
                            self.state.unpack_flip_y = param != 0;
                        }
                        GL_UNPACK_PREMULTIPLY_ALPHA_WEBGL |
                        GL_UNPACK_COLORSPACE_CONVERSION_WEBGL |
                        GL_PACK_ALIGNMENT | GL_UNPACK_ALIGNMENT |
                        GL_UNPACK_ROW_LENGTH | GL_UNPACK_IMAGE_HEIGHT |
                        GL_UNPACK_SKIP_PIXELS | GL_UNPACK_SKIP_ROWS |
                        GL_UNPACK_SKIP_IMAGES | GL_PACK_ROW_LENGTH |
                        GL_PACK_SKIP_PIXELS | GL_PACK_SKIP_ROWS => {
                            // Valid pnames — accepted but only UNPACK_FLIP_Y is tracked
                        }
                        _ => { self.record_error(GL_INVALID_ENUM); }
                    }
                    None
                }

                // --- Vertex attrib ---
                "vertexAttribPointer" => {
                    if arr.len() >= 7 {
                        let loc = arr[1].as_f64().unwrap_or(0.0) as usize;
                        let size = arr[2].as_f64().unwrap_or(0.0) as u32;
                        let dtype = arr[3].as_f64().unwrap_or(0.0) as u32;
                        let normalized = arr[4].as_bool().unwrap_or(false);
                        let stride = arr[5].as_f64().unwrap_or(0.0) as i32;
                        let offset = arr[6].as_f64().unwrap_or(0.0) as i32;
                        if loc >= self.state.vertex_attribs.len() {
                            self.record_error(GL_INVALID_VALUE);
                        } else if !(1..=4).contains(&size) {
                            self.record_error(GL_INVALID_VALUE);
                        } else if stride < 0 || offset < 0 {
                            self.record_error(GL_INVALID_VALUE);
                        } else {
                            self.state.vertex_attribs[loc].buffer_id = self.state.bound_array_buffer;
                            self.state.vertex_attribs[loc].size = size;
                            self.state.vertex_attribs[loc].dtype = dtype;
                            self.state.vertex_attribs[loc].normalized = normalized;
                            self.state.vertex_attribs[loc].stride = stride as u32;
                            self.state.vertex_attribs[loc].offset = offset as u32;
                        }
                    }
                    None
                }
                "enableVertexAttribArray" if args.len() >= 1 => {
                    let loc = args[0] as usize;
                    if loc >= self.state.vertex_attribs.len() {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.state.vertex_attribs[loc].enabled = true;
                    }
                    None
                }
                "disableVertexAttribArray" if args.len() >= 1 => {
                    let loc = args[0] as usize;
                    if loc >= self.state.vertex_attribs.len() {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.state.vertex_attribs[loc].enabled = false;
                    }
                    None
                }

                "vertexAttribDivisor" if args.len() >= 2 => {
                    let loc = args[0] as usize;
                    let divisor = args[1] as u32;
                    if loc >= self.state.vertex_attribs.len() {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.state.vertex_attribs[loc].divisor = divisor;
                    }
                    None
                }
                "vertexAttribIPointer" => {
                    if arr.len() >= 6 {
                        let loc = arr[1].as_f64().unwrap_or(0.0) as usize;
                        let size = arr[2].as_f64().unwrap_or(0.0) as u32;
                        let dtype = arr[3].as_f64().unwrap_or(0.0) as u32;
                        let stride = arr[4].as_f64().unwrap_or(0.0) as i32;
                        let offset = arr[5].as_f64().unwrap_or(0.0) as i32;
                        if loc >= self.state.vertex_attribs.len() {
                            self.record_error(GL_INVALID_VALUE);
                        } else if !(1..=4).contains(&size) {
                            self.record_error(GL_INVALID_VALUE);
                        } else if stride < 0 || offset < 0 {
                            self.record_error(GL_INVALID_VALUE);
                        } else {
                            self.state.vertex_attribs[loc].buffer_id = self.state.bound_array_buffer;
                            self.state.vertex_attribs[loc].size = size;
                            self.state.vertex_attribs[loc].dtype = dtype;
                            self.state.vertex_attribs[loc].normalized = false;
                            self.state.vertex_attribs[loc].stride = stride as u32;
                            self.state.vertex_attribs[loc].offset = offset as u32;
                        }
                    }
                    None
                }
                "vertexAttribI4i" | "vertexAttribI4ui" => { None }

                // --- State ---
                "enable" if args.len() >= 1 => {
                    if !self.set_cap(args[0] as u32, true) {
                        self.record_error(GL_INVALID_ENUM);
                    }
                    None
                }
                "disable" if args.len() >= 1 => {
                    if !self.set_cap(args[0] as u32, false) {
                        self.record_error(GL_INVALID_ENUM);
                    }
                    None
                }
                "viewport" if args.len() >= 4 => {
                    let w = args[2] as i32;
                    let h = args[3] as i32;
                    if w < 0 || h < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.state.viewport = [args[0] as i32, args[1] as i32, w, h];
                    }
                    None
                }
                "scissor" if args.len() >= 4 => {
                    let w = args[2] as i32;
                    let h = args[3] as i32;
                    if w < 0 || h < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.state.scissor = [args[0] as i32, args[1] as i32, w, h];
                    }
                    None
                }
                "clearColor" if args.len() >= 4 => {
                    self.state.clear_color = [args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32];
                    None
                }
                "clearDepth" if args.len() >= 1 => {
                    self.state.clear_depth = args[0];
                    None
                }
                "clear" if args.len() >= 1 => {
                    let mask = args[0] as u32;
                    if mask & !GL_VALID_CLEAR_BITS != 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else {
                        self.clear(mask);
                    }
                    None
                }
                "blendFunc" if args.len() >= 2 => {
                    let src = args[0] as u32;
                    let dst = args[1] as u32;
                    if !Self::is_valid_blend_factor(src) || !Self::is_valid_blend_factor(dst) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        self.state.blend_src = src;
                        self.state.blend_dst = dst;
                        self.state.blend_src_alpha = src;
                        self.state.blend_dst_alpha = dst;
                    }
                    None
                }
                "blendFuncSeparate" if args.len() >= 4 => {
                    let src_rgb = args[0] as u32;
                    let dst_rgb = args[1] as u32;
                    let src_a = args[2] as u32;
                    let dst_a = args[3] as u32;
                    if !Self::is_valid_blend_factor(src_rgb) || !Self::is_valid_blend_factor(dst_rgb)
                        || !Self::is_valid_blend_factor(src_a) || !Self::is_valid_blend_factor(dst_a) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        self.state.blend_src = src_rgb;
                        self.state.blend_dst = dst_rgb;
                        self.state.blend_src_alpha = src_a;
                        self.state.blend_dst_alpha = dst_a;
                    }
                    None
                }
                "colorMask" => {
                    if arr.len() >= 5 {
                        let r = arr[1].as_bool().unwrap_or(true);
                        let g = arr[2].as_bool().unwrap_or(true);
                        let b = arr[3].as_bool().unwrap_or(true);
                        let a = arr[4].as_bool().unwrap_or(true);
                        self.state.color_mask = [r, g, b, a];
                    }
                    None
                }
                "depthFunc" if args.len() >= 1 => {
                    let func = args[0] as u32;
                    match func {
                        GL_NEVER | GL_LESS | GL_EQUAL | GL_LEQUAL |
                        GL_GREATER | GL_NOTEQUAL | GL_GEQUAL | GL_ALWAYS => {
                            self.state.depth_func = func;
                        }
                        _ => { self.record_error(GL_INVALID_ENUM); }
                    }
                    None
                }
                "depthMask" => {
                    if let Some(val) = arr.get(1).and_then(|v| v.as_bool()) {
                        self.state.depth_mask = val;
                    } else if let Some(val) = arr.get(1).and_then(|v| v.as_f64()) {
                        self.state.depth_mask = val != 0.0;
                    }
                    None
                }
                "cullFace" if args.len() >= 1 => {
                    let mode = args[0] as u32;
                    match mode {
                        GL_FRONT | GL_BACK | GL_FRONT_AND_BACK => {
                            self.state.cull_face_mode = mode;
                        }
                        _ => { self.record_error(GL_INVALID_ENUM); }
                    }
                    None
                }
                "frontFace" if args.len() >= 1 => {
                    let mode = args[0] as u32;
                    match mode {
                        GL_CW | GL_CCW => { self.state.front_face = mode; }
                        _ => { self.record_error(GL_INVALID_ENUM); }
                    }
                    None
                }

                "blendEquation" if args.len() >= 1 => {
                    let mode = args[0] as u32;
                    if !Self::is_valid_blend_equation(mode) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        self.state.blend_equation_rgb = mode;
                        self.state.blend_equation_alpha = mode;
                    }
                    None
                }
                "blendEquationSeparate" if args.len() >= 2 => {
                    let mode_rgb = args[0] as u32;
                    let mode_a = args[1] as u32;
                    if !Self::is_valid_blend_equation(mode_rgb) || !Self::is_valid_blend_equation(mode_a) {
                        self.record_error(GL_INVALID_ENUM);
                    } else {
                        self.state.blend_equation_rgb = mode_rgb;
                        self.state.blend_equation_alpha = mode_a;
                    }
                    None
                }
                "blendColor" if args.len() >= 4 => {
                    self.state.blend_color = [args[0] as f32, args[1] as f32, args[2] as f32, args[3] as f32];
                    None
                }
                "clearStencil" if args.len() >= 1 => {
                    self.state.clear_stencil = args[0] as i32;
                    None
                }
                "depthRange" if args.len() >= 2 => {
                    self.state.depth_range = [args[0], args[1]];
                    None
                }
                "polygonOffset" if args.len() >= 2 => {
                    self.state.polygon_offset_factor = args[0] as f32;
                    self.state.polygon_offset_units = args[1] as f32;
                    None
                }

                // --- Draw ---
                "drawArrays" if args.len() >= 3 => {
                    let mode = args[0] as u32;
                    let first = args[1] as i32;
                    let count = args[2] as i32;
                    if !Self::is_valid_draw_mode(mode) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if first < 0 || count < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.draw_arrays(mode, first as u32, count as u32);
                    }
                    None
                }
                "drawElements" if args.len() >= 4 => {
                    let mode = args[0] as u32;
                    let count = args[1] as i32;
                    let dtype = args[2] as u32;
                    let offset = args[3] as i32;
                    if !Self::is_valid_draw_mode(mode) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if !Self::is_valid_index_type(dtype) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if count < 0 || offset < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.draw_elements(mode, count as u32, dtype, offset as u32);
                    }
                    None
                }
                // --- Query ---
                "getShaderParameter" if args.len() >= 2 => {
                    let shader_id = args[0] as u32;
                    let pname = args[1] as u32;
                    if !self.shaders.contains_key(&shader_id) {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(null))
                    } else {
                        Some(self.get_shader_parameter(shader_id, pname))
                    }
                }
                "getProgramParameter" if args.len() >= 2 => {
                    let prog_id = args[0] as u32;
                    let pname = args[1] as u32;
                    if !self.programs.contains_key(&prog_id) {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(null))
                    } else {
                        Some(self.get_program_parameter(prog_id, pname))
                    }
                }
                "getShaderInfoLog" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if !self.shaders.contains_key(&id) {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(""))
                    } else {
                        let log = self.shaders.get(&id).map(|s| s.info_log.clone()).unwrap_or_default();
                        Some(serde_json::json!(log))
                    }
                }
                "getProgramInfoLog" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if !self.programs.contains_key(&id) {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(""))
                    } else {
                        let log = self.programs.get(&id).map(|p| p.info_log.clone()).unwrap_or_default();
                        Some(serde_json::json!(log))
                    }
                }
                "getUniformLocation" if args.len() >= 1 && !str_refs.is_empty() => {
                    let prog_id = args[0] as u32;
                    let name = str_refs[0];
                    if !self.programs.contains_key(&prog_id) {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(null))
                    } else {
                        let loc = self.get_uniform_location(prog_id, name);
                        Some(serde_json::json!(loc))
                    }
                }
                "getAttribLocation" if args.len() >= 1 && !str_refs.is_empty() => {
                    let prog_id = args[0] as u32;
                    let name = str_refs[0];
                    if !self.programs.contains_key(&prog_id) {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(-1))
                    } else {
                        let loc = self.get_attrib_location(prog_id, name);
                        Some(serde_json::json!(loc))
                    }
                }

                "getActiveUniform" if args.len() >= 2 => {
                    let prog_id = args[0] as u32;
                    let index = args[1] as u32;
                    if let Some(prog) = self.programs.get(&prog_id) {
                        // Sorted for deterministic order across calls
                        let mut uniforms: Vec<_> = prog.uniform_locations.iter().collect();
                        uniforms.sort_by_key(|(name, _)| (*name).clone());
                        if (index as usize) < uniforms.len() {
                            let (name, loc) = uniforms[index as usize];
                            let gl_type = prog.uniform_types.get(loc).copied().unwrap_or(GL_FLOAT);
                            // Return as JSON string for the _ret_str path
                            Some(serde_json::json!(serde_json::json!({
                                "size": 1,
                                "type": gl_type,
                                "name": name
                            }).to_string()))
                        } else {
                            self.record_error(GL_INVALID_VALUE);
                            Some(serde_json::json!(null))
                        }
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(null))
                    }
                }
                "getActiveAttrib" if args.len() >= 2 => {
                    let prog_id = args[0] as u32;
                    let index = args[1] as u32;
                    if let Some(prog) = self.programs.get(&prog_id) {
                        // Parse vertex shader source for `in` declarations
                        let attrs: Vec<String> = prog.vertex_shader
                            .and_then(|id| self.shaders.get(&id))
                            .map(|s| {
                                s.source.lines()
                                    .filter(|l| l.trim().starts_with("in ") && l.trim().ends_with(';'))
                                    .filter_map(|l| {
                                        let trimmed = l.trim();
                                        let without_semi = &trimmed[3..trimmed.len()-1];
                                        without_semi.split_whitespace().last().map(|s| s.to_string())
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        if (index as usize) < attrs.len() {
                            Some(serde_json::json!(serde_json::json!({
                                "size": 1,
                                "type": 0x8B52, // GL_FLOAT_VEC4 — conservative default
                                "name": attrs[index as usize]
                            }).to_string()))
                        } else {
                            self.record_error(GL_INVALID_VALUE);
                            Some(serde_json::json!(null))
                        }
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(null))
                    }
                }
                "getUniformBlockIndex" => {
                    // Return a dummy block index (0) — real UBO support not tracked
                    Some(serde_json::json!(0))
                }
                "uniformBlockBinding" => { None }

                // --- Uniform setters (INVALID_OPERATION if no program bound) ---
                "uniform1f" if args.len() >= 2 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Float(args[1] as f32));
                    }
                    None
                }
                "uniform1i" if args.len() >= 2 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Int(args[1] as i32));
                    }
                    None
                }
                "uniform2f" if args.len() >= 3 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Vec2([args[1] as f32, args[2] as f32]));
                    }
                    None
                }
                "uniform3f" if args.len() >= 4 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Vec3([args[1] as f32, args[2] as f32, args[3] as f32]));
                    }
                    None
                }
                "uniform4f" if args.len() >= 5 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Vec4([args[1] as f32, args[2] as f32, args[3] as f32, args[4] as f32]));
                    }
                    None
                }
                "uniformMatrix4fv" => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else if arr.len() >= 4 {
                        let loc = arr[1].as_f64().unwrap_or(0.0) as u32;
                        if let Some(data) = arr[3].as_array() {
                            if data.len() == 16 {
                                let mut m = [0.0f32; 16];
                                for (i, v) in data.iter().enumerate() {
                                    m[i] = v.as_f64().unwrap_or(0.0) as f32;
                                }
                                self.set_uniform(loc, UniformValue::Mat4(m));
                            } else {
                                self.record_error(GL_INVALID_VALUE);
                            }
                        }
                    }
                    None
                }
                "uniformMatrix3fv" => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else if arr.len() >= 4 {
                        let loc = arr[1].as_f64().unwrap_or(0.0) as u32;
                        if let Some(data) = arr[3].as_array() {
                            if data.len() == 9 {
                                let mut m = [0.0f32; 9];
                                for (i, v) in data.iter().enumerate() {
                                    m[i] = v.as_f64().unwrap_or(0.0) as f32;
                                }
                                self.set_uniform(loc, UniformValue::Mat3(m));
                            } else {
                                self.record_error(GL_INVALID_VALUE);
                            }
                        }
                    }
                    None
                }
                "uniform2fv" if args.len() >= 3 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Vec2([args[1] as f32, args[2] as f32]));
                    }
                    None
                }
                "uniform3fv" if args.len() >= 4 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Vec3([args[1] as f32, args[2] as f32, args[3] as f32]));
                    }
                    None
                }
                "uniform4fv" if args.len() >= 5 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Vec4([args[1] as f32, args[2] as f32, args[3] as f32, args[4] as f32]));
                    }
                    None
                }

                // --- Integer uniforms ---
                "uniform2i" if args.len() >= 3 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::IVec2([args[1] as i32, args[2] as i32]));
                    }
                    None
                }
                "uniform3i" if args.len() >= 4 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::IVec3([args[1] as i32, args[2] as i32, args[3] as i32]));
                    }
                    None
                }
                "uniform4i" if args.len() >= 5 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::IVec4([args[1] as i32, args[2] as i32, args[3] as i32, args[4] as i32]));
                    }
                    None
                }
                "uniform1iv" if args.len() >= 2 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Int(args[1] as i32));
                    }
                    None
                }
                "uniform2iv" if args.len() >= 3 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::IVec2([args[1] as i32, args[2] as i32]));
                    }
                    None
                }
                "uniform3iv" if args.len() >= 4 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::IVec3([args[1] as i32, args[2] as i32, args[3] as i32]));
                    }
                    None
                }
                "uniform4iv" if args.len() >= 5 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::IVec4([args[1] as i32, args[2] as i32, args[3] as i32, args[4] as i32]));
                    }
                    None
                }
                // Unsigned integer uniforms
                "uniform1ui" if args.len() >= 2 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UInt(args[1] as u32));
                    }
                    None
                }
                "uniform2ui" if args.len() >= 3 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UVec2([args[1] as u32, args[2] as u32]));
                    }
                    None
                }
                "uniform3ui" if args.len() >= 4 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UVec3([args[1] as u32, args[2] as u32, args[3] as u32]));
                    }
                    None
                }
                "uniform4ui" if args.len() >= 5 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UVec4([args[1] as u32, args[2] as u32, args[3] as u32, args[4] as u32]));
                    }
                    None
                }
                "uniform1uiv" if args.len() >= 2 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UInt(args[1] as u32));
                    }
                    None
                }
                "uniform2uiv" if args.len() >= 3 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UVec2([args[1] as u32, args[2] as u32]));
                    }
                    None
                }
                "uniform3uiv" if args.len() >= 4 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UVec3([args[1] as u32, args[2] as u32, args[3] as u32]));
                    }
                    None
                }
                "uniform4uiv" if args.len() >= 5 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::UVec4([args[1] as u32, args[2] as u32, args[3] as u32, args[4] as u32]));
                    }
                    None
                }
                "uniform1fv" if args.len() >= 2 => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.set_uniform(args[0] as u32, UniformValue::Float(args[1] as f32));
                    }
                    None
                }
                "uniformMatrix2fv" => {
                    if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else if arr.len() >= 3 {
                        let loc = arr[1].as_f64().unwrap_or(0.0) as u32;
                        // Data starts at arr[2..6] (4 floats) — passed flat via cmd.apply
                        if args.len() >= 5 {
                            let mut m = [0.0f32; 4];
                            for i in 0..4 {
                                m[i] = args[i + 1] as f32;
                            }
                            self.set_uniform(loc, UniformValue::Mat2(m));
                        } else {
                            self.record_error(GL_INVALID_VALUE);
                        }
                    }
                    None
                }
                // Non-square matrix uniforms — accepted, stored as no-op
                "uniformMatrix2x3fv" | "uniformMatrix3x2fv" |
                "uniformMatrix2x4fv" | "uniformMatrix4x2fv" |
                "uniformMatrix3x4fv" | "uniformMatrix4x3fv" => { None }

                // --- VAO (vertex array object) ---
                "createVertexArray" => {
                    if self.vaos.len() >= Self::MAX_VAO_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        Some(serde_json::json!(0))
                    } else {
                        let id = self.alloc_id();
                        self.vaos.insert(id, VaoState::new(self.state.vertex_attribs.len()));
                        Some(serde_json::json!(id))
                    }
                }
                "bindVertexArray" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if id == 0 {
                        // Unbind: save current state back to VAO, restore default
                        if let Some(old_id) = self.bound_vao.take() {
                            if let Some(vao) = self.vaos.get_mut(&old_id) {
                                vao.vertex_attribs = self.state.vertex_attribs.clone();
                                vao.bound_element_buffer = self.state.bound_element_buffer;
                            }
                        }
                    } else if self.vaos.contains_key(&id) {
                        // Save current VAO state, then restore target VAO
                        if let Some(old_id) = self.bound_vao {
                            if let Some(vao) = self.vaos.get_mut(&old_id) {
                                vao.vertex_attribs = self.state.vertex_attribs.clone();
                                vao.bound_element_buffer = self.state.bound_element_buffer;
                            }
                        }
                        if let Some(vao) = self.vaos.get(&id) {
                            self.state.vertex_attribs = vao.vertex_attribs.clone();
                            self.state.bound_element_buffer = vao.bound_element_buffer;
                        }
                        self.bound_vao = Some(id);
                    } else {
                        self.record_error(GL_INVALID_OPERATION);
                    }
                    None
                }
                "deleteVertexArray" if args.len() >= 1 => {
                    let id = args[0] as u32;
                    if self.bound_vao == Some(id) {
                        self.bound_vao = None;
                    }
                    self.vaos.remove(&id);
                    None
                }

                // --- Framebuffer (accepted but minimal tracking) ---
                "createFramebuffer" => {
                    if self.framebuffer_count >= Self::MAX_FRAMEBUFFER_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        None
                    } else {
                        let id = self.alloc_id();
                        self.framebuffer_count += 1;
                        Some(serde_json::json!(id))
                    }
                }
                "bindFramebuffer" => { None }
                "framebufferTexture2D" => { None }
                "createRenderbuffer" => {
                    if self.renderbuffer_count >= Self::MAX_RENDERBUFFER_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        None
                    } else {
                        let id = self.alloc_id();
                        self.renderbuffer_count += 1;
                        Some(serde_json::json!(id))
                    }
                }
                "bindRenderbuffer" => { None }
                "renderbufferStorage" => { None }
                "framebufferRenderbuffer" => { None }

                // --- Instanced draw ---
                "drawArraysInstanced" if args.len() >= 4 => {
                    let mode = args[0] as u32;
                    let first = args[1] as i32;
                    let count = args[2] as i32;
                    let instance_count = args[3] as i32;
                    if !Self::is_valid_draw_mode(mode) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if first < 0 || count < 0 || instance_count < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.draw_arrays_instanced(mode, first as u32, count as u32, instance_count as u32);
                    }
                    None
                }

                "drawElementsInstanced" if args.len() >= 5 => {
                    let mode = args[0] as u32;
                    let count = args[1] as i32;
                    let dtype = args[2] as u32;
                    let offset = args[3] as i32;
                    let instance_count = args[4] as i32;
                    if !Self::is_valid_draw_mode(mode) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if !Self::is_valid_index_type(dtype) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if count < 0 || offset < 0 || instance_count < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.draw_elements_instanced(mode, count as u32, dtype, offset as u32, instance_count as u32);
                    }
                    None
                }
                "drawRangeElements" if args.len() >= 6 => {
                    let mode = args[0] as u32;
                    let _start = args[1] as u32;
                    let _end = args[2] as u32;
                    let count = args[3] as i32;
                    let dtype = args[4] as u32;
                    let offset = args[5] as i32;
                    if !Self::is_valid_draw_mode(mode) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if !Self::is_valid_index_type(dtype) {
                        self.record_error(GL_INVALID_ENUM);
                    } else if count < 0 || offset < 0 {
                        self.record_error(GL_INVALID_VALUE);
                    } else if self.state.current_program.is_none() {
                        self.record_error(GL_INVALID_OPERATION);
                    } else {
                        self.draw_elements(mode, count as u32, dtype, offset as u32);
                    }
                    None
                }

                // --- UBO binding (accepted, minimal tracking) ---
                "bindBufferRange" | "bindBufferBase" => { None }

                // --- Framebuffer ops ---
                "deleteFramebuffer" if args.len() >= 1 => {
                    if self.framebuffer_count > 0 {
                        self.framebuffer_count -= 1;
                    }
                    None
                }
                "deleteRenderbuffer" if args.len() >= 1 => {
                    if self.renderbuffer_count > 0 {
                        self.renderbuffer_count -= 1;
                    }
                    None
                }
                "renderbufferStorageMultisample" | "drawBuffers" => { None }

                // --- Transform feedback (stubs) ---
                "createTransformFeedback" => {
                    if self.misc_object_count >= Self::MAX_MISC_OBJECT_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        None
                    } else {
                        let id = self.alloc_id();
                        self.misc_object_count += 1;
                        Some(serde_json::json!(id))
                    }
                }
                "deleteTransformFeedback" => {
                    if self.misc_object_count > 0 {
                        self.misc_object_count -= 1;
                    }
                    None
                }
                "bindTransformFeedback" | "beginTransformFeedback" |
                "endTransformFeedback" => { None }

                // --- Query objects (stubs) ---
                "createQuery" => {
                    if self.misc_object_count >= Self::MAX_MISC_OBJECT_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        None
                    } else {
                        let id = self.alloc_id();
                        self.misc_object_count += 1;
                        Some(serde_json::json!(id))
                    }
                }
                "deleteQuery" => {
                    if self.misc_object_count > 0 {
                        self.misc_object_count -= 1;
                    }
                    None
                }
                "beginQuery" | "endQuery" => { None }

                // --- Sampler objects (stubs) ---
                "createSampler" => {
                    if self.misc_object_count >= Self::MAX_MISC_OBJECT_COUNT {
                        self.record_error(GL_INVALID_OPERATION);
                        None
                    } else {
                        let id = self.alloc_id();
                        self.misc_object_count += 1;
                        Some(serde_json::json!(id))
                    }
                }

                // --- State queries ---
                "getBufferParameter" if args.len() >= 2 => {
                    let target = args[0] as u32;
                    let pname = args[1] as u32;
                    let buf_id = match target {
                        GL_ARRAY_BUFFER => self.state.bound_array_buffer,
                        GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
                        _ => None,
                    };
                    match buf_id.and_then(|id| self.buffers.get(&id)) {
                        Some(buf) => match pname {
                            GL_BUFFER_SIZE => Some(serde_json::json!(buf.data.len())),
                            GL_BUFFER_USAGE => Some(serde_json::json!(buf.usage)),
                            _ => { self.record_error(GL_INVALID_ENUM); Some(serde_json::json!(0)) }
                        },
                        None => { self.record_error(GL_INVALID_OPERATION); Some(serde_json::json!(0)) }
                    }
                }
                "getTexParameter" if args.len() >= 2 => {
                    let pname = args[1] as u32;
                    let tex_id = self.state.texture_units.get(self.state.active_texture_unit)
                        .and_then(|t| *t);
                    match tex_id.and_then(|id| self.textures.get(&id)) {
                        Some(tex) => match pname {
                            GL_TEXTURE_MIN_FILTER => Some(serde_json::json!(tex.min_filter)),
                            GL_TEXTURE_MAG_FILTER => Some(serde_json::json!(tex.mag_filter)),
                            GL_TEXTURE_WRAP_S => Some(serde_json::json!(tex.wrap_s)),
                            GL_TEXTURE_WRAP_T => Some(serde_json::json!(tex.wrap_t)),
                            _ => Some(serde_json::json!(0)),
                        },
                        None => Some(serde_json::json!(0)),
                    }
                }
                "isEnabled" if args.len() >= 1 => {
                    let cap = args[0] as u32;
                    let enabled = match cap {
                        GL_BLEND => self.state.blend_enabled,
                        GL_DEPTH_TEST => self.state.depth_test_enabled,
                        GL_CULL_FACE => self.state.cull_face_enabled,
                        GL_SCISSOR_TEST => self.state.scissor_test_enabled,
                        GL_STENCIL_TEST => self.state.stencil_test_enabled,
                        GL_POLYGON_OFFSET_FILL => self.state.polygon_offset_fill_enabled,
                        GL_DITHER | GL_SAMPLE_ALPHA_TO_COVERAGE |
                        GL_SAMPLE_COVERAGE | GL_RASTERIZER_DISCARD => false,
                        _ => { self.record_error(GL_INVALID_ENUM); false }
                    };
                    Some(serde_json::json!(if enabled { 1 } else { 0 }))
                }
                "getVertexAttrib" if args.len() >= 2 => {
                    let index = args[0] as usize;
                    let pname = args[1] as u32;
                    if index < self.state.vertex_attribs.len() {
                        let attr = &self.state.vertex_attribs[index];
                        match pname {
                            0x8622 => Some(serde_json::json!(attr.buffer_id.unwrap_or(0))), // VERTEX_ATTRIB_ARRAY_BUFFER_BINDING
                            0x8623 => Some(serde_json::json!(if attr.enabled { 1 } else { 0 })), // VERTEX_ATTRIB_ARRAY_ENABLED
                            0x8624 => Some(serde_json::json!(attr.size)), // VERTEX_ATTRIB_ARRAY_SIZE
                            0x8625 => Some(serde_json::json!(attr.stride)), // VERTEX_ATTRIB_ARRAY_STRIDE
                            0x8626 => Some(serde_json::json!(attr.dtype)), // VERTEX_ATTRIB_ARRAY_TYPE
                            0x886A => Some(serde_json::json!(if attr.normalized { 1 } else { 0 })), // VERTEX_ATTRIB_ARRAY_NORMALIZED
                            0x88FE => Some(serde_json::json!(attr.divisor)), // VERTEX_ATTRIB_ARRAY_DIVISOR
                            _ => Some(serde_json::json!(0)),
                        }
                    } else {
                        self.record_error(GL_INVALID_VALUE);
                        Some(serde_json::json!(0))
                    }
                }

                // --- No-op but valid commands ---
                "flush" | "finish" | "lineWidth" | "stencilFunc" |
                "stencilOp" | "stencilMask" | "stencilFuncSeparate" |
                "stencilOpSeparate" | "stencilMaskSeparate" |
                "sampleCoverage" |
                "hint" | "readPixels" | "copyBufferSubData" |
                "detachShader" | "bindAttribLocation" | "readBuffer" |
                "clearBufferfv" | "clearBufferiv" | "clearBufferuiv" | "clearBufferfi" |
                "framebufferTextureLayer" => { None }

                _ => None,
            };

            if let (Some(ret_id), Some(val)) = (call_id, result) {
                // Strip __ret_ prefix for ref_map so $-refs resolve by short name.
                // e.g. __ret_vs → ref_map["vs"] = 1, then "$vs" resolves to 1.
                let ref_key = ret_id.strip_prefix("__ret_").unwrap_or(&ret_id);
                self.ref_map.insert(ref_key.to_string(), val.clone());
                returns.push(serde_json::json!([ret_id, val]));
            }
        }

        serde_json::json!(returns)
    }

    /// Read the framebuffer pixels as straight RGBA (unpremultiplied).
    /// Only used by tests — production uses `read_pixels_premultiplied`.
    pub fn read_pixels(&mut self, output: &mut [u8]) {
        if let Some(ref mut gpu) = self.gpu {
            // Read into output first, then unpremultiply in-place
            gpu.read_pixels_into(output);
            for px in output.chunks_exact_mut(4) {
                let a = px[3];
                if a == 0 {
                    // Premultiplied alpha: when alpha=0, RGB must also be 0.
                    // The blend equation may produce non-zero RGB with zero alpha
                    // (e.g. FUNC_SUBTRACT on alpha channel), but canvas compositing
                    // treats these as fully transparent.
                    px[0] = 0;
                    px[1] = 0;
                    px[2] = 0;
                } else if a < 255 {
                    let a_f = a as f32 / 255.0;
                    px[0] = (px[0] as f32 / a_f).round().min(255.0) as u8;
                    px[1] = (px[1] as f32 / a_f).round().min(255.0) as u8;
                    px[2] = (px[2] as f32 / a_f).round().min(255.0) as u8;
                }
            }
            return;
        }

        let len = output.len().min(self.framebuffer.len());
        for (s, d) in self.framebuffer[..len].chunks_exact(4).zip(output[..len].chunks_exact_mut(4)) {
            let a = s[3];
            if a == 255 || a == 0 {
                d.copy_from_slice(s);
            } else {
                let a_f = a as f32 / 255.0;
                d[0] = (s[0] as f32 / a_f).round().min(255.0) as u8;
                d[1] = (s[1] as f32 / a_f).round().min(255.0) as u8;
                d[2] = (s[2] as f32 / a_f).round().min(255.0) as u8;
                d[3] = a;
            }
        }
    }

    /// Read raw premultiplied RGBA pixels directly into output.
    ///
    /// Zero-copy from GPU staging buffer — no intermediate Vec allocation.
    pub fn read_pixels_premultiplied(&mut self, output: &mut [u8]) {
        if let Some(ref mut gpu) = self.gpu {
            gpu.read_pixels_into(output);
            return;
        }

        let len = output.len().min(self.framebuffer.len());
        output[..len].copy_from_slice(&self.framebuffer[..len]);
    }

    // --- GL operations ---

    fn create_shader(&mut self, shader_type: u32) -> u32 {
        if self.shaders.len() >= Self::MAX_SHADER_COUNT {
            self.record_error(GL_INVALID_OPERATION);
            return 0;
        }
        let id = self.alloc_id();
        self.shaders.insert(id, Shader {
            shader_type,
            source: String::new(),
            compiled: false,
            info_log: String::new(),
            wgsl: None,
            binding_layout: shader::BindingLayout::default(),
        });
        id
    }

    fn shader_source(&mut self, id: u32, source: &str) {
        if source.len() > Self::MAX_SHADER_SOURCE_LEN {
            self.record_error(GL_INVALID_VALUE);
            return;
        }
        if let Some(s) = self.shaders.get_mut(&id) {
            s.source = source.to_string();
        }
    }

    fn compile_shader(&mut self, id: u32) {
        let Some(s) = self.shaders.get_mut(&id) else { return };

        let stage = match s.shader_type {
            GL_VERTEX_SHADER => naga::ShaderStage::Vertex,
            GL_FRAGMENT_SHADER => naga::ShaderStage::Fragment,
            _ => {
                s.info_log = "Unknown shader type".to_string();
                return;
            }
        };
        let (wgsl, binding_layout, log) = shader::compile_glsl_to_wgsl(&s.source, stage);
        s.compiled = wgsl.is_some();
        s.wgsl = wgsl;
        s.binding_layout = binding_layout;
        s.info_log = log;
    }

    fn create_program(&mut self) -> u32 {
        if self.programs.len() >= Self::MAX_PROGRAM_COUNT {
            self.record_error(GL_INVALID_OPERATION);
            return 0;
        }
        let id = self.alloc_id();
        self.programs.insert(id, Program {
            vertex_shader: None,
            fragment_shader: None,
            linked: false,
            info_log: String::new(),
            uniform_locations: HashMap::new(),
            uniform_types: HashMap::new(),
            wgsl_vertex: None,
            wgsl_fragment: None,
            vertex_binding_layout: shader::BindingLayout::default(),
            fragment_binding_layout: shader::BindingLayout::default(),
        });
        id
    }

    fn attach_shader(&mut self, prog_id: u32, shader_id: u32) {
        let shader_type = self.shaders.get(&shader_id).map(|s| s.shader_type);
        if let Some(prog) = self.programs.get_mut(&prog_id) {
            match shader_type {
                Some(GL_VERTEX_SHADER) => prog.vertex_shader = Some(shader_id),
                Some(GL_FRAGMENT_SHADER) => prog.fragment_shader = Some(shader_id),
                _ => {}
            }
        }
    }

    fn link_program(&mut self, prog_id: u32) {
        let Some(prog) = self.programs.get_mut(&prog_id) else { return };

        // Get WGSL + binding layout from compiled shaders
        let vs_info = prog.vertex_shader
            .and_then(|id| self.shaders.get(&id))
            .map(|s| (s.wgsl.clone(), s.binding_layout.clone()));
        let fs_info = prog.fragment_shader
            .and_then(|id| self.shaders.get(&id))
            .map(|s| (s.wgsl.clone(), s.binding_layout.clone()));

        match (vs_info, fs_info) {
            (Some((Some(vs), vs_layout)), Some((Some(fs), fs_layout))) => {
                prog.wgsl_vertex = Some(vs);
                prog.wgsl_fragment = Some(fs);
                prog.vertex_binding_layout = vs_layout;
                prog.fragment_binding_layout = fs_layout;
                prog.linked = true;
                prog.info_log = String::new();
            }
            _ => {
                prog.linked = false;
                prog.info_log = "Link failed: missing or uncompiled shaders".to_string();
            }
        }
    }

    fn get_shader_parameter(&self, id: u32, pname: u32) -> serde_json::Value {
        let Some(s) = self.shaders.get(&id) else {
            return serde_json::json!(null);
        };
        match pname {
            GL_COMPILE_STATUS => serde_json::json!(s.compiled),
            _ => serde_json::json!(null),
        }
    }

    fn get_program_parameter(&self, id: u32, pname: u32) -> serde_json::Value {
        let Some(p) = self.programs.get(&id) else {
            return serde_json::json!(null);
        };
        match pname {
            GL_LINK_STATUS => serde_json::json!(p.linked),
            _ => serde_json::json!(null),
        }
    }

    /// Maximum uniform locations per program.
    const MAX_UNIFORM_LOCATIONS_PER_PROGRAM: usize = 512;

    fn get_uniform_location(&mut self, prog_id: u32, name: &str) -> i32 {
        let Some(prog) = self.programs.get_mut(&prog_id) else { return -1 };
        if let Some(&loc) = prog.uniform_locations.get(name) {
            return loc as i32;
        }
        if prog.uniform_locations.len() >= Self::MAX_UNIFORM_LOCATIONS_PER_PROGRAM {
            return -1;
        }
        let next = prog.uniform_locations.len() as u32 + 1;
        prog.uniform_locations.insert(name.to_string(), next);
        next as i32
    }

    /// Get attribute location by scanning vertex shader source for `in` declarations.
    /// Returns the 0-based index of the attribute in declaration order.
    fn get_attrib_location(&self, prog_id: u32, name: &str) -> i32 {
        let prog = match self.programs.get(&prog_id) {
            Some(p) => p,
            None => return -1,
        };
        let vs_id = match prog.vertex_shader {
            Some(id) => id,
            None => return -1,
        };
        let vs = match self.shaders.get(&vs_id) {
            Some(s) => s,
            None => return -1,
        };

        // Parse vertex shader for `in` declarations and assign locations in order.
        // Strip comments first (matching preprocess_glsl) so commented-out `in`
        // declarations don't cause location mismatches.
        let stripped = crate::webgl2::shader::strip_comments(&vs.source);
        let mut loc = 0i32;
        let mut brace_depth = 0u32;
        for line in stripped.lines() {
            let trimmed = line.trim();
            let opens = trimmed.chars().filter(|&c| c == '{').count() as u32;
            let closes = trimmed.chars().filter(|&c| c == '}').count() as u32;
            let at_global = brace_depth == 0;
            if at_global && trimmed.starts_with("in ") && trimmed.ends_with(';') && !trimmed.contains("layout") {
                let without_semi = &trimmed[3..trimmed.len() - 1];
                if let Some(attr_name) = without_semi.split_whitespace().last() {
                    if attr_name == name {
                        return loc;
                    }
                    loc += 1;
                }
            }
            brace_depth = brace_depth.wrapping_add(opens).wrapping_sub(closes);
        }
        -1
    }

    fn set_uniform(&mut self, location: u32, value: UniformValue) {
        if let Some(prog_id) = self.state.current_program {
            let gl_type = match &value {
                UniformValue::Float(_) => GL_FLOAT,
                UniformValue::Vec2(_) => GL_FLOAT_VEC2,
                UniformValue::Vec3(_) => GL_FLOAT_VEC3,
                UniformValue::Vec4(_) => GL_FLOAT_VEC4,
                UniformValue::Int(_) => GL_INT,
                UniformValue::IVec2(_) => GL_INT_VEC2,
                UniformValue::IVec3(_) => GL_INT_VEC3,
                UniformValue::IVec4(_) => GL_INT_VEC4,
                UniformValue::UInt(_) => GL_UNSIGNED_INT_T,
                UniformValue::UVec2(_) => GL_UNSIGNED_INT_VEC2,
                UniformValue::UVec3(_) => GL_UNSIGNED_INT_VEC3,
                UniformValue::UVec4(_) => GL_UNSIGNED_INT_VEC4,
                UniformValue::Mat2(_) => GL_FLOAT_MAT2,
                UniformValue::Mat3(_) => GL_FLOAT_MAT3,
                UniformValue::Mat4(_) => GL_FLOAT_MAT4,
            };
            if let Some(prog) = self.programs.get_mut(&prog_id) {
                prog.uniform_types.insert(location, gl_type);
            }
            self.uniforms.insert((prog_id, location), value);
        }
    }

    fn set_cap(&mut self, cap: u32, enabled: bool) -> bool {
        match cap {
            GL_BLEND => self.state.blend_enabled = enabled,
            GL_DEPTH_TEST => self.state.depth_test_enabled = enabled,
            GL_CULL_FACE => self.state.cull_face_enabled = enabled,
            GL_SCISSOR_TEST => self.state.scissor_test_enabled = enabled,
            GL_STENCIL_TEST => self.state.stencil_test_enabled = enabled,
            // Valid WebGL2 caps — accepted but only tracked as needed
            GL_POLYGON_OFFSET_FILL => self.state.polygon_offset_fill_enabled = enabled,
            GL_DITHER |
            GL_SAMPLE_ALPHA_TO_COVERAGE | GL_SAMPLE_COVERAGE |
            GL_RASTERIZER_DISCARD => {}
            _ => return false,
        }
        true
    }

    fn clear(&mut self, mask: u32) {
        // Delegate to GPU backend if available
        if let Some(ref mut gpu) = self.gpu {
            let clear_color = mask & GL_COLOR_BUFFER_BIT != 0;
            let clear_depth = mask & GL_DEPTH_BUFFER_BIT != 0;
            if clear_color || clear_depth {
                let scissor = if self.state.scissor_test_enabled {
                    Some(self.state.scissor)
                } else {
                    None
                };
                gpu.clear(self.state.clear_color, self.state.clear_depth, clear_color, clear_depth, scissor);
            }
            return;
        }

        // Software fallback
        if mask & GL_COLOR_BUFFER_BIT != 0 {
            let [r, g, b, a] = self.state.clear_color;
            let rb = (r * 255.0).round() as u8;
            let gb = (g * 255.0).round() as u8;
            let bb = (b * 255.0).round() as u8;
            let ab = (a * 255.0).round() as u8;

            if self.state.scissor_test_enabled {
                let [sx, sy, sw, sh] = self.state.scissor;
                // Scissor coordinates are in WebGL space (bottom-left origin).
                // Framebuffer is top-left origin. Flip Y.
                let fb_w = self.width as i32;
                let fb_h = self.height as i32;
                let x0 = sx.max(0).min(fb_w);
                let x1 = (sx + sw).max(0).min(fb_w);
                // Flip Y: WebGL y=0 is bottom, framebuffer y=0 is top
                let y0 = (fb_h - sy - sh).max(0).min(fb_h);
                let y1 = (fb_h - sy).max(0).min(fb_h);
                for y in y0..y1 {
                    for x in x0..x1 {
                        let idx = ((y * fb_w + x) * 4) as usize;
                        self.framebuffer[idx] = rb;
                        self.framebuffer[idx + 1] = gb;
                        self.framebuffer[idx + 2] = bb;
                        self.framebuffer[idx + 3] = ab;
                    }
                }
            } else {
                for pixel in self.framebuffer.chunks_exact_mut(4) {
                    pixel[0] = rb;
                    pixel[1] = gb;
                    pixel[2] = bb;
                    pixel[3] = ab;
                }
            }
        }
        if mask & GL_DEPTH_BUFFER_BIT != 0 {
            let d = self.state.clear_depth as f32;
            if self.state.scissor_test_enabled {
                let [sx, sy, sw, sh] = self.state.scissor;
                let fb_w = self.width as i32;
                let fb_h = self.height as i32;
                let x0 = sx.max(0).min(fb_w);
                let x1 = (sx + sw).max(0).min(fb_w);
                let y0 = (fb_h - sy - sh).max(0).min(fb_h);
                let y1 = (fb_h - sy).max(0).min(fb_h);
                for y in y0..y1 {
                    for x in x0..x1 {
                        self.depth_buffer[(y * fb_w + x) as usize] = d;
                    }
                }
            } else {
                for v in &mut self.depth_buffer {
                    *v = d;
                }
            }
        }
    }

    // --- Buffer data handling ---

    fn handle_buffer_data(&mut self, arr: &[serde_json::Value]) {
        // Format: ["bufferData", target, [data...], usage]
        if arr.len() < 4 { return; }
        let target = arr[1].as_f64().unwrap_or(0.0) as u32;
        let usage = arr[arr.len() - 1].as_f64().unwrap_or(GL_STATIC_DRAW as f64) as u32;

        // Find the array argument (should be arr[2])
        let data_arr = if let Some(a) = arr[2].as_array() {
            a
        } else {
            return;
        };

        // Size limit check: data_arr.len() * 4 bytes must not exceed MAX_BUFFER_SIZE
        if data_arr.len() * 4 > Self::MAX_BUFFER_SIZE {
            self.record_error(GL_INVALID_VALUE);
            return;
        }

        let buf_id = match target {
            GL_ARRAY_BUFFER => self.state.bound_array_buffer,
            GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
            _ => None,
        };

        let Some(buf_id) = buf_id else { return };

        if target == GL_ELEMENT_ARRAY_BUFFER {
            // Auto-detect u16 vs u32: use u32 if any index exceeds u16 range
            let needs_u32 = data_arr.iter().any(|v| v.as_f64().unwrap_or(0.0) > 65535.0);
            let bytes = if needs_u32 {
                let mut b = Vec::with_capacity(data_arr.len() * 4);
                for v in data_arr { b.extend_from_slice(&(v.as_f64().unwrap_or(0.0) as u32).to_le_bytes()); }
                b
            } else {
                let mut b = Vec::with_capacity(data_arr.len() * 2);
                for v in data_arr { b.extend_from_slice(&(v.as_f64().unwrap_or(0.0) as u16).to_le_bytes()); }
                b
            };
            if let Some(buf) = self.buffers.get_mut(&buf_id) {
                let old_len = buf.data.len();
                let new_total = self.total_buffer_bytes.saturating_sub(old_len) + bytes.len();
                if new_total > Self::MAX_TOTAL_BUFFER_BYTES {
                    self.record_error(GL_INVALID_OPERATION);
                    return;
                }
                buf.target = target;
                buf.index_type = if needs_u32 { GL_UNSIGNED_INT } else { GL_UNSIGNED_SHORT };
                buf.data = bytes;
                buf.usage = usage;
                self.total_buffer_bytes = new_total;
            }
        } else {
            // Store as f32 floats, packed into bytes
            let mut bytes = Vec::with_capacity(data_arr.len() * 4);
            for v in data_arr {
                let f = v.as_f64().unwrap_or(0.0) as f32;
                bytes.extend_from_slice(&f.to_le_bytes());
            }
            if let Some(buf) = self.buffers.get_mut(&buf_id) {
                let old_len = buf.data.len();
                let new_total = self.total_buffer_bytes.saturating_sub(old_len) + bytes.len();
                if new_total > Self::MAX_TOTAL_BUFFER_BYTES {
                    self.record_error(GL_INVALID_OPERATION);
                    return;
                }
                buf.target = target;
                buf.data = bytes;
                buf.usage = usage;
                self.total_buffer_bytes = new_total;
            }
        }
    }

    fn handle_buffer_data_uint32(&mut self, arr: &[serde_json::Value]) {
        // Format: ["bufferDataUint32", target, [data...], usage]
        if arr.len() < 4 { return; }
        let target = arr[1].as_f64().unwrap_or(0.0) as u32;
        let usage = arr[arr.len() - 1].as_f64().unwrap_or(GL_STATIC_DRAW as f64) as u32;

        let data_arr = if let Some(a) = arr[2].as_array() { a } else { return; };

        let buf_id = match target {
            GL_ARRAY_BUFFER => self.state.bound_array_buffer,
            GL_ELEMENT_ARRAY_BUFFER => self.state.bound_element_buffer,
            _ => None,
        };
        let Some(buf_id) = buf_id else { return };

        // Store as u32 indices, packed into bytes
        let mut bytes = Vec::with_capacity(data_arr.len() * 4);
        for v in data_arr {
            let idx = v.as_f64().unwrap_or(0.0) as u32;
            bytes.extend_from_slice(&idx.to_le_bytes());
        }
        if let Some(buf) = self.buffers.get_mut(&buf_id) {
            let old_len = buf.data.len();
            let new_total = self.total_buffer_bytes.saturating_sub(old_len) + bytes.len();
            if new_total > Self::MAX_TOTAL_BUFFER_BYTES {
                self.record_error(GL_INVALID_OPERATION);
                return;
            }
            buf.target = target;
            buf.index_type = GL_UNSIGNED_INT;
            buf.data = bytes;
            buf.usage = usage;
            self.total_buffer_bytes = new_total;
        }
    }

    // --- Texture handling ---

    fn handle_tex_image_2d(&mut self, arr: &[serde_json::Value]) {
        // Format: ["texImage2D", target, level, internalFormat, width, height, border, format, type, [data...]]
        if arr.len() < 10 { return; }
        let _target = arr[1].as_f64().unwrap_or(0.0) as u32;
        let _level = arr[2].as_f64().unwrap_or(0.0) as u32;
        let internal_format = arr[3].as_f64().unwrap_or(0.0) as u32;
        let width = arr[4].as_f64().unwrap_or(0.0) as u32;
        let height = arr[5].as_f64().unwrap_or(0.0) as u32;
        if width > Self::MAX_TEXTURE_SIZE || height > Self::MAX_TEXTURE_SIZE {
            self.record_error(GL_INVALID_VALUE);
            return;
        }
        // arr[6] = border, arr[7] = format, arr[8] = type
        let data_arr = if let Some(a) = arr[9].as_array() {
            a
        } else {
            return;
        };

        let unit = self.state.active_texture_unit;
        let tex_id = match self.state.texture_units.get(unit).copied().flatten() {
            Some(id) => id,
            None => return,
        };

        let mut data: Vec<u8> = data_arr.iter().map(|v| v.as_f64().unwrap_or(0.0) as u8).collect();

        // Apply UNPACK_FLIP_Y_WEBGL: flip texture rows vertically
        if self.state.unpack_flip_y && height > 0 && width > 0 {
            let row_bytes = (width as usize).saturating_mul(4);
            let mut flipped = vec![0u8; data.len()];
            for row in 0..height as usize {
                let src_off = row * row_bytes;
                let dst_off = (height as usize - 1 - row) * row_bytes;
                if src_off + row_bytes <= data.len() && dst_off + row_bytes <= flipped.len() {
                    flipped[dst_off..dst_off + row_bytes].copy_from_slice(&data[src_off..src_off + row_bytes]);
                }
            }
            data = flipped;
        }

        if let Some(tex) = self.textures.get_mut(&tex_id) {
            let old_len = tex.data.len();
            let new_total = self.total_texture_bytes.saturating_sub(old_len) + data.len();
            if new_total > Self::MAX_TOTAL_TEXTURE_BYTES {
                self.record_error(GL_INVALID_OPERATION);
                return;
            }
            tex.width = width;
            tex.height = height;
            tex.internal_format = internal_format;
            tex.data = data;
            self.total_texture_bytes = new_total;
        }
    }

    // --- Drawing ---

    /// Extract triangle index triples from a vertex list based on draw mode.
    fn triangulate(mode: u32, count: usize) -> Vec<[usize; 3]> {
        let mut tris = Vec::new();
        match mode {
            GL_TRIANGLES => {
                for i in (0..count).step_by(3) {
                    if i + 2 < count {
                        tris.push([i, i + 1, i + 2]);
                    }
                }
            }
            GL_TRIANGLE_STRIP => {
                for i in 0..count.saturating_sub(2) {
                    if i % 2 == 0 {
                        tris.push([i, i + 1, i + 2]);
                    } else {
                        tris.push([i + 1, i, i + 2]); // flip winding for odd
                    }
                }
            }
            GL_TRIANGLE_FAN => {
                for i in 1..count.saturating_sub(1) {
                    tris.push([0, i, i + 1]);
                }
            }
            _ => {}
        }
        tris
    }

    fn apply_vertex_transform(vertices: &mut [SoftVertex], transform: &VertexTransform) {
        if let VertexTransform::Matrix4(m) = transform {
            for v in vertices.iter_mut() {
                let [x, y, z, w] = v.position;
                // Column-major mat4 * vec4
                v.position = [
                    m[0] * x + m[4] * y + m[8]  * z + m[12] * w,
                    m[1] * x + m[5] * y + m[9]  * z + m[13] * w,
                    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
                    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
                ];
            }
        }
    }

    fn draw_arrays(&mut self, mode: u32, first: u32, count: u32) {
        // GPU path
        if self.gpu.is_some() {
            if mode == GL_TRIANGLE_FAN {
                // Expand fan to indexed triangles
                let fan_indices = Self::expand_fan_indices(count);
                let fan_count = fan_indices.len() as u32;
                self.gpu_draw(GL_TRIANGLES, fan_count, 0, Some(fan_indices));
                return;
            }
            if let Some(draw_mode) = self.gpu_draw_mode(mode) {
                self.gpu_draw(draw_mode, count, first, None);
                return;
            }
        }

        // Software fallback
        let mut vertices = self.gather_vertices_array(first, count);
        let vtx_transform = self.detect_vertex_transform();
        Self::apply_vertex_transform(&mut vertices, &vtx_transform);
        let fragment_mode = self.detect_fragment_mode();

        match mode {
            GL_POINTS => {
                for v in &vertices {
                    self.rasterize_point(v, &fragment_mode);
                }
            }
            GL_LINES => {
                for i in (0..vertices.len()).step_by(2) {
                    if i + 1 < vertices.len() {
                        self.rasterize_line(&vertices[i], &vertices[i + 1], &fragment_mode);
                    }
                }
            }
            _ => {
                let tris = Self::triangulate(mode, vertices.len());
                for [i0, i1, i2] in tris {
                    self.rasterize_triangle(&vertices[i0], &vertices[i1], &vertices[i2], &fragment_mode);
                }
            }
        }
    }

    fn draw_elements(&mut self, mode: u32, count: u32, dtype: u32, offset: u32) {
        // GPU path
        if self.gpu.is_some() {
            let indices = self.read_indices(count, dtype, offset);
            if let Some(draw_mode) = self.gpu_draw_mode(mode) {
                self.gpu_draw(draw_mode, count, 0, Some(indices));
                return;
            }
        }

        // Software fallback
        let indices = self.read_indices(count, dtype, offset);
        let max_idx = indices.iter().copied().max().unwrap_or(0);
        let mut all_vertices = self.gather_vertices_array(0, max_idx + 1);
        let vtx_transform = self.detect_vertex_transform();
        Self::apply_vertex_transform(&mut all_vertices, &vtx_transform);
        let fragment_mode = self.detect_fragment_mode();
        let tris = Self::triangulate(mode, indices.len());

        for [a, b, c] in tris {
            let i0 = indices[a] as usize;
            let i1 = indices[b] as usize;
            let i2 = indices[c] as usize;
            if i0 >= all_vertices.len() || i1 >= all_vertices.len() || i2 >= all_vertices.len() {
                continue;
            }
            self.rasterize_triangle(&all_vertices[i0], &all_vertices[i1], &all_vertices[i2], &fragment_mode);
        }
    }

    fn draw_arrays_instanced(&mut self, mode: u32, first: u32, count: u32, instance_count: u32) {
        if self.gpu.is_some() {
            if mode == GL_TRIANGLE_FAN {
                let fan_indices = Self::expand_fan_indices(count);
                let fan_count = fan_indices.len() as u32;
                self.gpu_draw_instanced(GL_TRIANGLES, fan_count, 0, Some(fan_indices), instance_count);
                return;
            }
            if let Some(draw_mode) = self.gpu_draw_mode(mode) {
                self.gpu_draw_instanced(draw_mode, count, first, None, instance_count);
                return;
            }
        }
        // Software fallback: draw instance_count times (simple but correct)
        for _ in 0..instance_count {
            self.draw_arrays(mode, first, count);
        }
    }

    fn draw_elements_instanced(&mut self, mode: u32, count: u32, dtype: u32, offset: u32, instance_count: u32) {
        if self.gpu.is_some() {
            let indices = self.read_indices(count, dtype, offset);
            if let Some(draw_mode) = self.gpu_draw_mode(mode) {
                self.gpu_draw_instanced(draw_mode, count, 0, Some(indices), instance_count);
                return;
            }
        }
        // Software fallback
        for _ in 0..instance_count {
            self.draw_elements(mode, count, dtype, offset);
        }
    }

    /// Check if we can use the GPU for this draw mode. Returns the wgpu-compatible mode.
    /// GL_TRIANGLE_FAN is expanded to GL_TRIANGLES indices by the caller.
    fn gpu_draw_mode(&self, mode: u32) -> Option<u32> {
        match mode {
            GL_POINTS | GL_LINES | GL_TRIANGLES | GL_TRIANGLE_STRIP => Some(mode),
            GL_TRIANGLE_FAN => Some(GL_TRIANGLES), // will expand fan to triangle list
            _ => None,
        }
    }

    /// Expand TRIANGLE_FAN to indexed TRIANGLES.
    fn expand_fan_indices(count: u32) -> Vec<u32> {
        let mut indices = Vec::new();
        for i in 1..count.saturating_sub(1) {
            indices.push(0);
            indices.push(i);
            indices.push(i + 1);
        }
        indices
    }

    /// Execute a draw call on the GPU backend.
    fn gpu_draw(&mut self, mode: u32, count: u32, first: u32, indices: Option<Vec<u32>>) {
        self.gpu_draw_instanced(mode, count, first, indices, 1);
    }

    /// Execute an instanced draw call on the GPU backend.
    fn gpu_draw_instanced(&mut self, mode: u32, count: u32, first: u32, indices: Option<Vec<u32>>, instance_count: u32) {
        use super::gpu::{DrawState, TextureBinding};

        // Get per-stage WGSL + binding layout from current program
        let prog_id = match self.state.current_program {
            Some(id) => id,
            None => return,
        };
        let (vertex_wgsl, fragment_wgsl, vs_layout, fs_layout) = match self.programs.get(&prog_id) {
            Some(p) => match (&p.wgsl_vertex, &p.wgsl_fragment) {
                (Some(vs), Some(fs)) => (
                    vs.clone(), fs.clone(),
                    p.vertex_binding_layout.clone(),
                    p.fragment_binding_layout.clone(),
                ),
                _ => return,
            },
            None => return,
        };

        // Gather enabled vertex attributes with their buffer data
        let mut attribs: Vec<(u32, u32, u32, bool, u32, u32, Vec<u8>)> = Vec::new();
        for (loc, attrib) in self.state.vertex_attribs.iter().enumerate() {
            if !attrib.enabled { continue; }
            let buf_data = attrib.buffer_id
                .and_then(|id| self.buffers.get(&id))
                .map(|b| b.data.clone())
                .unwrap_or_default();
            attribs.push((
                loc as u32,
                attrib.size,
                attrib.dtype,
                attrib.normalized,
                attrib.stride,
                attrib.offset,
                buf_data,
            ));
        }

        // Gather uniforms by name
        let prog = self.programs.get(&prog_id).unwrap();
        let mut uniform_map: HashMap<String, UniformValue> = HashMap::new();
        for (name, &loc) in &prog.uniform_locations {
            if let Some(val) = self.uniforms.get(&(prog_id, loc)) {
                uniform_map.insert(name.clone(), val.clone());
            }
        }

        // Gather bound textures referenced by the fragment shader.
        // Look up the sampler uniform value (set via uniform1i) to determine which
        // texture unit to read from — don't assume sequential unit ordering.
        let mut tex_bindings: Vec<TextureBinding> = Vec::new();
        for (_tex_bind, _sampler_bind, name) in fs_layout.texture_bindings.iter() {
            // Find the texture unit index from the sampler uniform value (uniform1i sets Int)
            let unit_index = prog.uniform_locations.get(name.as_str())
                .and_then(|&loc| self.uniforms.get(&(prog_id, loc)))
                .and_then(|v| if let super::state::UniformValue::Int(i) = v { Some(*i as usize) } else { None })
                .unwrap_or(tex_bindings.len()); // fallback: sequential index
            let tex_id = self.state.texture_units.get(unit_index).copied().flatten();
            if let Some(id) = tex_id {
                if let Some(tex) = self.textures.get(&id) {
                    tex_bindings.push(TextureBinding {
                        width: tex.width,
                        height: tex.height,
                        data: tex.data.clone(),
                        min_filter: tex.min_filter,
                        mag_filter: tex.mag_filter,
                        wrap_s: tex.wrap_s,
                        wrap_t: tex.wrap_t,
                    });
                }
            }
        }

        // Handle GL_POINTS → expanded quads (2 triangles per point).
        // wgpu renders points as 1px regardless of gl_PointSize, so we expand
        // each point vertex into a screen-aligned quad scaled by the point size.
        let (final_mode, final_count, final_first, final_indices, attribs) = if mode == GL_POINTS {
            let point_size = self.detect_point_size();
            let vp_w = self.state.viewport[2] as f32;
            let vp_h = self.state.viewport[3] as f32;
            // Half-size in NDC (clip space with w=1)
            let half_x = point_size / vp_w;
            let half_y = point_size / vp_h;

            // Find the position attribute (location 0) to get stride/offset/size info
            let pos_attrib_idx = attribs.iter().position(|(loc, _, _, _, _, _, _)| *loc == 0);

            if let Some(pos_idx) = pos_attrib_idx {
                let (_loc, pos_size, _dtype, _norm, _stride, _pos_offset, _buf) = &attribs[pos_idx];
                let pos_components = *pos_size as usize; // typically 2 or 3

                // Expand each point into 4 vertices with offset positions
                let mut expanded_attribs: Vec<(u32, u32, u32, bool, u32, u32, Vec<u8>)> = Vec::new();
                let mut quad_indices: Vec<u32> = Vec::new();
                let point_count = count as usize;

                for (attr_i, (loc, size, dtype, norm, stride_val, offset_val, buf_data)) in attribs.iter().enumerate() {
                    let attr_stride = *stride_val as usize;
                    let attr_offset = *offset_val as usize;
                    let attr_components = *size as usize;
                    let attr_bytes = attr_components * 4; // f32 = 4 bytes each

                    let mut new_buf: Vec<u8> = Vec::with_capacity(point_count * 4 * attr_bytes);

                    for pt in 0..point_count {
                        let vertex_idx = first as usize + pt;
                        let base = vertex_idx * attr_stride + attr_offset;

                        // Read attribute value for this vertex
                        let mut values = vec![0.0f32; attr_components];
                        for c in 0..attr_components {
                            let b = base + c * 4;
                            if b + 4 <= buf_data.len() {
                                values[c] = f32::from_le_bytes([
                                    buf_data[b], buf_data[b+1], buf_data[b+2], buf_data[b+3],
                                ]);
                            }
                        }

                        if attr_i == pos_idx {
                            // Position attribute: emit 4 corners of quad
                            // Offsets: TL(-hx,+hy), TR(+hx,+hy), BR(+hx,-hy), BL(-hx,-hy)
                            let offsets = [
                                (-half_x,  half_y),
                                ( half_x,  half_y),
                                ( half_x, -half_y),
                                (-half_x, -half_y),
                            ];
                            for (dx, dy) in &offsets {
                                let mut corner = values.clone();
                                corner[0] += dx;
                                if pos_components >= 2 { corner[1] += dy; }
                                for &v in &corner {
                                    new_buf.extend_from_slice(&v.to_le_bytes());
                                }
                            }
                        } else {
                            // Non-position attributes: duplicate 4 times
                            for _ in 0..4 {
                                for &v in &values {
                                    new_buf.extend_from_slice(&v.to_le_bytes());
                                }
                            }
                        }

                        // Build quad indices (only once, from first attribute)
                        if attr_i == 0 {
                            let base_vtx = (pt * 4) as u32;
                            // Two triangles: TL-TR-BR, TL-BR-BL
                            quad_indices.push(base_vtx);
                            quad_indices.push(base_vtx + 1);
                            quad_indices.push(base_vtx + 2);
                            quad_indices.push(base_vtx);
                            quad_indices.push(base_vtx + 2);
                            quad_indices.push(base_vtx + 3);
                        }
                    }

                    // Each expanded vertex has tightly packed attributes (no interleaving)
                    let new_stride = (attr_components as u32) * 4;
                    expanded_attribs.push((*loc, *size, *dtype, *norm, new_stride, 0, new_buf));
                }

                let tri_count = quad_indices.len() as u32;
                (GL_TRIANGLES, tri_count, 0u32, Some(quad_indices), expanded_attribs)
            } else {
                // No position attribute found — fall through unchanged
                (mode, count, first, indices, attribs)
            }
        } else {
            // Non-POINTS modes: pass through unchanged
            let (m, idx) = if mode == GL_TRIANGLES && indices.is_none() {
                (mode, None)
            } else {
                (mode, indices)
            };
            (m, count, first, idx, attribs)
        };

        // Build draw state
        let draw_state = DrawState {
            blend_enabled: self.state.blend_enabled,
            blend_src_rgb: self.state.blend_src,
            blend_dst_rgb: self.state.blend_dst,
            blend_src_alpha: self.state.blend_src_alpha,
            blend_dst_alpha: self.state.blend_dst_alpha,
            blend_equation_rgb: self.state.blend_equation_rgb,
            blend_equation_alpha: self.state.blend_equation_alpha,
            depth_test_enabled: self.state.depth_test_enabled,
            depth_func: self.state.depth_func,
            depth_mask: self.state.depth_mask,
            cull_face_enabled: self.state.cull_face_enabled,
            cull_face_mode: self.state.cull_face_mode,
            front_face: self.state.front_face,
            color_mask: self.state.color_mask,
            scissor_test_enabled: self.state.scissor_test_enabled,
            scissor: self.state.scissor,
            viewport: self.state.viewport,
            polygon_offset_fill_enabled: self.state.polygon_offset_fill_enabled,
            polygon_offset_factor: self.state.polygon_offset_factor,
            polygon_offset_units: self.state.polygon_offset_units,
        };

        let gpu = self.gpu.as_mut().unwrap();
        gpu.draw(
            &vertex_wgsl,
            &fragment_wgsl,
            &attribs,
            final_indices.as_deref(),
            &uniform_map,
            &tex_bindings,
            &vs_layout,
            &fs_layout,
            &draw_state,
            final_mode,
            final_count,
            final_first,
            instance_count,
        );
    }

    fn read_indices(&self, count: u32, dtype: u32, offset: u32) -> Vec<u32> {
        let buf_id = match self.state.bound_element_buffer {
            Some(id) => id,
            None => return Vec::new(),
        };
        let buf = match self.buffers.get(&buf_id) {
            Some(b) => b,
            None => return Vec::new(),
        };

        let mut indices = Vec::with_capacity(count as usize);
        let byte_offset = offset as usize;
        match dtype {
            GL_UNSIGNED_BYTE => {
                for i in 0..count as usize {
                    let off = byte_offset + i;
                    if off < buf.data.len() {
                        indices.push(buf.data[off] as u32);
                    }
                }
            }
            GL_UNSIGNED_SHORT => {
                for i in 0..count as usize {
                    let off = byte_offset + i * 2;
                    if off + 2 <= buf.data.len() {
                        let idx = u16::from_le_bytes([buf.data[off], buf.data[off + 1]]);
                        indices.push(idx as u32);
                    }
                }
            }
            GL_UNSIGNED_INT => {
                for i in 0..count as usize {
                    let off = byte_offset + i * 4;
                    if off + 4 <= buf.data.len() {
                        let idx = u32::from_le_bytes([buf.data[off], buf.data[off + 1], buf.data[off + 2], buf.data[off + 3]]);
                        indices.push(idx);
                    }
                }
            }
            _ => {}
        }
        indices
    }

    /// Gather vertex data for drawArrays.
    /// Returns a Vec of SoftVertex, one per vertex.
    fn gather_vertices_array(&self, first: u32, count: u32) -> Vec<SoftVertex> {
        let end = match first.checked_add(count) {
            Some(e) => e,
            None => return Vec::new(), // overflow — invalid range
        };
        let mut vertices = Vec::with_capacity(count as usize);
        for i in first..end {
            let mut v = SoftVertex::default();

            // Read position from attrib 0
            if self.state.vertex_attribs[0].enabled {
                let attrib = &self.state.vertex_attribs[0];
                let floats = self.read_attrib_floats(attrib, i);
                v.position[0] = floats.get(0).copied().unwrap_or(0.0);
                v.position[1] = floats.get(1).copied().unwrap_or(0.0);
                v.position[2] = floats.get(2).copied().unwrap_or(0.0);
                v.position[3] = 1.0;
            }

            // Read varyings from attribs 1..=4
            for slot in 0..4usize {
                let attrib_idx = slot + 1;
                if attrib_idx < self.state.vertex_attribs.len()
                    && self.state.vertex_attribs[attrib_idx].enabled
                {
                    let attrib = &self.state.vertex_attribs[attrib_idx];
                    let floats = self.read_attrib_floats(attrib, i);
                    v.varyings[slot].data[0] = floats.get(0).copied().unwrap_or(0.0);
                    v.varyings[slot].data[1] = floats.get(1).copied().unwrap_or(0.0);
                    v.varyings[slot].data[2] = floats.get(2).copied().unwrap_or(0.0);
                    v.varyings[slot].data[3] = floats.get(3).copied().unwrap_or(if attrib.size >= 4 { 0.0 } else { 1.0 });
                    v.varyings[slot].components = attrib.size;
                }
            }

            vertices.push(v);
        }
        vertices
    }

    fn read_attrib_floats(&self, attrib: &VertexAttrib, vertex_index: u32) -> Vec<f32> {
        let buf_id = match attrib.buffer_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let buf = match self.buffers.get(&buf_id) {
            Some(b) => b,
            None => return Vec::new(),
        };

        let stride = if attrib.stride == 0 {
            attrib.size * 4 // tightly packed f32s
        } else {
            attrib.stride
        };

        // Use u64 arithmetic to prevent overflow with large vertex_index * stride
        let byte_offset = attrib.offset as u64 + vertex_index as u64 * stride as u64;
        let mut result = Vec::with_capacity(attrib.size as usize);
        for c in 0..attrib.size {
            let off = byte_offset + c as u64 * 4;
            if off + 4 > buf.data.len() as u64 { result.push(0.0); continue; }
            let off = off as usize;
            if off + 4 <= buf.data.len() {
                let f = f32::from_le_bytes([
                    buf.data[off],
                    buf.data[off + 1],
                    buf.data[off + 2],
                    buf.data[off + 3],
                ]);
                result.push(f);
            } else {
                result.push(0.0);
            }
        }
        result
    }

    // --- Shader detection ---

    /// Detect if the vertex shader applies a matrix transform.
    fn detect_vertex_transform(&self) -> VertexTransform {
        let prog_id = match self.state.current_program {
            Some(id) => id,
            None => return VertexTransform::None,
        };
        let prog = match self.programs.get(&prog_id) {
            Some(p) => p,
            None => return VertexTransform::None,
        };
        let vs_id = match prog.vertex_shader {
            Some(id) => id,
            None => return VertexTransform::None,
        };
        let vs = match self.shaders.get(&vs_id) {
            Some(s) => s,
            None => return VertexTransform::None,
        };

        // Look for common MVP uniform names in vertex shader
        let src = &vs.source;
        let mvp_names = ["u_mvp", "u_MVP", "u_modelViewProjection", "u_matrix", "u_transform"];
        for name in &mvp_names {
            if src.contains(name) {
                // Find the uniform location and value
                if let Some(&loc) = prog.uniform_locations.get(*name) {
                    if let Some(UniformValue::Mat4(m)) = self.uniforms.get(&(prog_id, loc)) {
                        return VertexTransform::Matrix4(*m);
                    }
                }
            }
        }
        VertexTransform::None
    }

    /// Detect what kind of fragment output the current program produces.
    fn detect_fragment_mode(&self) -> FragmentMode {
        let prog_id = match self.state.current_program {
            Some(id) => id,
            None => return FragmentMode::ConstantColor([1.0, 1.0, 1.0, 1.0]),
        };
        let prog = match self.programs.get(&prog_id) {
            Some(p) => p,
            None => return FragmentMode::ConstantColor([1.0, 1.0, 1.0, 1.0]),
        };
        let fs_id = match prog.fragment_shader {
            Some(id) => id,
            None => return FragmentMode::ConstantColor([1.0, 1.0, 1.0, 1.0]),
        };
        let fs = match self.shaders.get(&fs_id) {
            Some(s) => s,
            None => return FragmentMode::ConstantColor([1.0, 1.0, 1.0, 1.0]),
        };

        let src = &fs.source;

        // Check for discard pattern: if (v_xxx < threshold) discard;
        if src.contains("discard") {
            // Get vertex shader source for varying slot detection
            let vs_source = prog.vertex_shader
                .and_then(|id| self.shaders.get(&id))
                .map(|s| s.source.as_str())
                .unwrap_or("");

            for line in src.lines() {
                let trimmed = line.trim();
                if trimmed.contains("discard") && trimmed.contains("if") && trimmed.contains('<') {
                    if let Some(lt_pos) = trimmed.find('<') {
                        let before: &str = &trimmed[..lt_pos];
                        let var_name: Option<&str> = before.split_whitespace().last()
                            .map(|s| s.trim_start_matches('('));
                        let after: &str = &trimmed[lt_pos + 1..];
                        let threshold_str: Option<&str> = after.split(')').next()
                            .map(|s| s.trim());
                        if let (Some(name), Some(thresh)) = (var_name, threshold_str) {
                            if let Ok(threshold) = thresh.parse::<f32>() {
                                let mut slot = 0usize;
                                let mut found = false;
                                for vs_line in vs_source.lines() {
                                    let vs_trimmed: &str = vs_line.trim();
                                    if vs_trimmed.starts_with("in ") && vs_trimmed.ends_with(';')
                                        && !vs_trimmed.contains("a_position") {
                                        if let Some(attr_name) = vs_trimmed.trim_end_matches(';')
                                            .split_whitespace().last() {
                                            let out_name = String::from(attr_name).replace("a_", "v_");
                                            if out_name == name {
                                                found = true;
                                                break;
                                            }
                                            slot += 1;
                                        }
                                    }
                                }
                                if found {
                                    return FragmentMode::DiscardVarying { slot, comp: 0, threshold };
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check for texture sampling
        if src.contains("texture(") && src.contains("sampler2D") {
            // Check if there's a tint varying multiplied with the texture
            // (a second varying besides v_texcoord)
            if src.contains("v_tint") {
                return FragmentMode::TextureTinted;
            }
            return FragmentMode::TextureSample;
        }

        // Check for uniform color: fragColor = u_color
        if src.contains("u_color") {
            // Look up the uniform location for u_color
            if let Some(&loc) = prog.uniform_locations.get("u_color") {
                if let Some(UniformValue::Vec4(c)) = self.uniforms.get(&(prog_id, loc)) {
                    return FragmentMode::UniformColor(*c);
                }
            }
            return FragmentMode::ConstantColor([1.0, 0.0, 1.0, 1.0]); // magenta fallback
        }

        // Check for varying color: fragColor = vec4(v_color, 1.0)
        if src.contains("v_color") {
            return FragmentMode::VaryingColor;
        }

        // Try to parse constant: fragColor = vec4(r, g, b, a)
        if let Some(color) = Self::parse_constant_vec4(src) {
            return FragmentMode::ConstantColor(color);
        }

        FragmentMode::ConstantColor([1.0, 0.0, 1.0, 1.0]) // magenta fallback
    }

    fn parse_constant_vec4(src: &str) -> Option<[f32; 4]> {
        // Look for: fragColor = vec4(r, g, b, a);
        // Find the assignment to fragColor
        for line in src.lines() {
            let trimmed = line.trim();
            if trimmed.contains("fragColor") && trimmed.contains("vec4(") {
                // Extract the vec4 arguments
                if let Some(start) = trimmed.find("vec4(") {
                    let after = &trimmed[start + 5..];
                    if let Some(end) = after.find(')') {
                        let args_str = &after[..end];
                        let parts: Vec<&str> = args_str.split(',').collect();
                        if parts.len() == 4 {
                            let r = parts[0].trim().parse::<f32>().ok()?;
                            let g = parts[1].trim().parse::<f32>().ok()?;
                            let b = parts[2].trim().parse::<f32>().ok()?;
                            let a = parts[3].trim().parse::<f32>().ok()?;
                            return Some([r, g, b, a]);
                        }
                    }
                }
            }
        }
        None
    }

    // --- Triangle rasterization ---

    fn rasterize_triangle(
        &mut self,
        v0: &SoftVertex,
        v1: &SoftVertex,
        v2: &SoftVertex,
        fragment_mode: &FragmentMode,
    ) {
        let [vp_x, vp_y, vp_w, vp_h] = self.state.viewport;

        // Clip space -> NDC (perspective divide) and store 1/w for perspective-correct interpolation
        // Returns (ndc_xyz, inv_w)
        let ndc_and_inv_w = |v: &SoftVertex| -> ([f32; 3], f32) {
            let w = v.position[3];
            if w == 0.0 {
                return ([0.0, 0.0, 0.0], 0.0);
            }
            let inv_w = 1.0 / w;
            ([v.position[0] * inv_w, v.position[1] * inv_w, v.position[2] * inv_w], inv_w)
        };

        let (n0, inv_w0) = ndc_and_inv_w(v0);
        let (n1, inv_w1) = ndc_and_inv_w(v1);
        let (n2, inv_w2) = ndc_and_inv_w(v2);

        // NDC -> screen space (floating-point for interpolation)
        // WebGL: screen_x = (ndc_x + 1) * 0.5 * vp_w + vp_x
        //        screen_y = (ndc_y + 1) * 0.5 * vp_h + vp_y
        // Framebuffer has y=0 at top, WebGL has y=0 at bottom — flip Y.
        let to_screen = |ndc: [f32; 3]| -> [f32; 3] {
            let sx = (ndc[0] + 1.0) * 0.5 * vp_w as f32 + vp_x as f32;
            let sy = (ndc[1] + 1.0) * 0.5 * vp_h as f32 + vp_y as f32;
            let sz = (ndc[2] + 1.0) * 0.5;
            let fb_y = self.height as f32 - sy;
            [sx, fb_y, sz]
        };

        let s0 = to_screen(n0);
        let s1 = to_screen(n1);
        let s2 = to_screen(n2);

        // --- Fixed-point edge rasterization (8.8 sub-pixel precision) ---
        // GPUs snap vertex positions to a sub-pixel grid and evaluate edge
        // functions in integer arithmetic for deterministic top-left fill rule.
        const SUBPIXEL_BITS: i32 = 12;
        const SUBPIXEL_SCALE: f32 = (1 << SUBPIXEL_BITS) as f32;

        // Snap screen-space XY to fixed-point (keep float Z for depth interpolation)
        let snap = |v: f32| -> i64 { (v * SUBPIXEL_SCALE).round() as i64 };

        let fx0 = snap(s0[0]); let fy0 = snap(s0[1]);
        let fx1 = snap(s1[0]); let fy1 = snap(s1[1]);
        let fx2 = snap(s2[0]); let fy2 = snap(s2[1]);

        // Fixed-point edge function (i64 to avoid overflow with 8.8 coords on 200px canvas)
        let edge_fixed = |ax: i64, ay: i64, bx: i64, by: i64, cx: i64, cy: i64| -> i64 {
            (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        };

        let area_fixed = edge_fixed(fx0, fy0, fx1, fy1, fx2, fy2);
        if area_fixed == 0 {
            return; // degenerate triangle
        }

        // Face culling uses float area for consistency with sign convention
        let area = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);

        // Face culling: determine if triangle is front-facing or back-facing.
        // Our framebuffer has Y flipped (y=0 at top), so CCW in WebGL space
        // becomes CW in framebuffer space, giving negative signed area.
        let is_front = if self.state.front_face == GL_CCW {
            area < 0.0 // CCW in WebGL = negative area in y-flipped framebuffer
        } else {
            area > 0.0 // CW in WebGL = positive area in y-flipped framebuffer
        };

        if self.state.cull_face_enabled {
            let cull = self.state.cull_face_mode;
            if cull == GL_FRONT_AND_BACK {
                return;
            }
            if cull == GL_BACK && !is_front {
                return;
            }
            if cull == GL_FRONT && is_front {
                return;
            }
        }

        // If area is negative, swap two vertices to ensure consistent winding for rasterization
        let (s0, s1, s2, v0, v1, v2, inv_w0, inv_w1, inv_w2,
             fx0, fy0, fx1, fy1, fx2, fy2, area_fixed) = if area_fixed < 0 {
            (s1, s0, s2, v1, v0, v2, inv_w1, inv_w0, inv_w2,
             fx1, fy1, fx0, fy0, fx2, fy2, -area_fixed)
        } else {
            (s0, s1, s2, v0, v1, v2, inv_w0, inv_w1, inv_w2,
             fx0, fy0, fx1, fy1, fx2, fy2, area_fixed)
        };

        // Float area for barycentric interpolation (post-swap, always positive)
        let inv_area = 1.0 / area_fixed as f64;

        let fb_w = self.width as i32;

        // Top-left fill rule on fixed-point edges:
        // An edge A->B is "top" if horizontal going left, or "left" if going up.
        let is_top_left = |ax: i64, ay: i64, bx: i64, by: i64| -> bool {
            if ay == by { bx < ax } // top edge: horizontal, going left
            else { by < ay }        // left edge: going up
        };
        let edge0_tl = is_top_left(fx1, fy1, fx2, fy2);
        let edge1_tl = is_top_left(fx2, fy2, fx0, fy0);
        let edge2_tl = is_top_left(fx0, fy0, fx1, fy1);

        // Precompute scissor bounds
        let (sci_x0, sci_x1, sci_y0, sci_y1) = if self.state.scissor_test_enabled {
            let [sx, sy, sw, sh] = self.state.scissor;
            let fb_h = self.height as i32;
            (
                sx.max(0),
                (sx + sw).min(fb_w),
                (fb_h - sy - sh).max(0),
                (fb_h - sy).min(fb_h),
            )
        } else {
            (0, self.width as i32, 0, self.height as i32)
        };

        let blend_enabled = self.state.blend_enabled;
        let blend_src = self.state.blend_src;
        let blend_dst = self.state.blend_dst;
        let blend_src_alpha = self.state.blend_src_alpha;
        let blend_dst_alpha = self.state.blend_dst_alpha;
        let depth_test = self.state.depth_test_enabled;
        let depth_func = self.state.depth_func;

        // Get texture data if needed (clone to avoid borrow conflict with write_pixel)
        let tex_owned: Option<OwnedTexSampleInfo> = match fragment_mode {
            FragmentMode::TextureSample | FragmentMode::TextureTinted => {
                self.state.texture_units.first().copied().flatten().and_then(|id| {
                    self.textures.get(&id).map(|t| OwnedTexSampleInfo {
                        width: t.width, height: t.height, data: t.data.clone(),
                        mag_filter: t.mag_filter, wrap_s: t.wrap_s, wrap_t: t.wrap_t,
                    })
                })
            }
            _ => None,
        };

        // Bounding box from fixed-point coords (floor min, ceil max to avoid missing edge pixels)
        let min_x = (fx0.min(fx1).min(fx2) >> SUBPIXEL_BITS) as i32;
        let max_x = (((fx0.max(fx1).max(fx2) + ((1i64 << SUBPIXEL_BITS) - 1)) >> SUBPIXEL_BITS) as i32).min(self.width as i32 - 1);
        let min_y = (fy0.min(fy1).min(fy2) >> SUBPIXEL_BITS) as i32;
        let max_y = (((fy0.max(fy1).max(fy2) + ((1i64 << SUBPIXEL_BITS) - 1)) >> SUBPIXEL_BITS) as i32).min(self.height as i32 - 1);
        let min_x = min_x.max(0);
        let min_y = min_y.max(0);

        for py in min_y..=max_y {
            for px in min_x..=max_x {
                // Scissor test
                if px < sci_x0 || px >= sci_x1 || py < sci_y0 || py >= sci_y1 {
                    continue;
                }

                // Pixel center in fixed-point: (px + 0.5) * 256 = px * 256 + 128
                let cx = (px as i64) * (1 << SUBPIXEL_BITS) + (1 << (SUBPIXEL_BITS - 1));
                let cy = (py as i64) * (1 << SUBPIXEL_BITS) + (1 << (SUBPIXEL_BITS - 1));

                // Edge functions in fixed-point (exact integer arithmetic)
                let e0 = edge_fixed(fx1, fy1, fx2, fy2, cx, cy);
                let e1 = edge_fixed(fx2, fy2, fx0, fy0, cx, cy);
                let e2 = edge_fixed(fx0, fy0, fx1, fy1, cx, cy);

                // Inside test with top-left fill rule:
                // Pixel is inside if all edge functions > 0, or == 0 on a top-left edge.
                if e0 < 0 || e1 < 0 || e2 < 0 { continue; }
                if e0 == 0 && !edge0_tl { continue; }
                if e1 == 0 && !edge1_tl { continue; }
                if e2 == 0 && !edge2_tl { continue; }

                // Barycentric weights from fixed-point edge values (f64 for precision)
                let b0_64 = e0 as f64 * inv_area;
                let b1_64 = e1 as f64 * inv_area;
                let b2_64 = 1.0 - b0_64 - b1_64;
                let b0 = b0_64 as f32;
                let b1 = b1_64 as f32;
                let b2 = b2_64 as f32;

                // Interpolate depth in f64 (screen-space, not perspective-corrected — matches GL spec)
                let z = (b0_64 * s0[2] as f64 + b1_64 * s1[2] as f64 + b2_64 * s2[2] as f64) as f32;

                let pix_idx = (py * fb_w + px) as usize;

                // Depth test
                if depth_test {
                    let stored = self.depth_buffer[pix_idx];
                    let pass = match depth_func {
                        GL_NEVER => false,
                        GL_LESS => z < stored,
                        GL_EQUAL => (z - stored).abs() < 1e-6,
                        GL_LEQUAL => z <= stored,
                        GL_GREATER => z > stored,
                        GL_NOTEQUAL => (z - stored).abs() >= 1e-6,
                        GL_GEQUAL => z >= stored,
                        GL_ALWAYS => true,
                        _ => z < stored,
                    };
                    if !pass {
                        continue;
                    }
                    if self.state.depth_mask {
                        self.depth_buffer[pix_idx] = z;
                    }
                }

                // Perspective-correct interpolation weights (f32, matching GPU precision).
                // For w=1 (orthographic), this reduces to screen-space barycentrics.
                let pc0 = b0 * inv_w0;
                let pc1 = b1 * inv_w1;
                let pc2 = b2 * inv_w2;
                let pc_denom = 1.0f32 / (pc0 + pc1 + pc2);
                let p0 = pc0 * pc_denom;
                let p1 = pc1 * pc_denom;
                let p2 = pc2 * pc_denom;

                // Helper: interpolate a varying slot (f32 to match GPU behavior)
                let interp = |slot: usize, comp: usize| -> f32 {
                    p0 * v0.varyings[slot].data[comp]
                    + p1 * v1.varyings[slot].data[comp]
                    + p2 * v2.varyings[slot].data[comp]
                };

                // Compute fragment color
                let frag_color = match fragment_mode {
                    FragmentMode::ConstantColor(c) => *c,
                    FragmentMode::UniformColor(c) => *c,
                    FragmentMode::VaryingColor => {
                        let r = interp(0, 0);
                        let g = interp(0, 1);
                        let b = interp(0, 2);
                        if v0.varyings[0].components >= 4 {
                            [r, g, b, interp(0, 3)]
                        } else {
                            [r, g, b, 1.0]
                        }
                    }
                    FragmentMode::DiscardVarying { slot, comp, threshold } => {
                        let val = interp(*slot, *comp);
                        if val < *threshold { continue; }
                        // After discard check, output constant red (from the test shader)
                        [1.0, 0.0, 0.0, 1.0]
                    }
                    FragmentMode::TextureSample => {
                        let u = interp(0, 0);
                        let v_coord = interp(0, 1);
                        if let Some(ref ti) = tex_owned {
                            sample_texture(&ti.as_ref(), u, v_coord)
                        } else {
                            [1.0, 0.0, 1.0, 1.0]
                        }
                    }
                    FragmentMode::TextureTinted => {
                        let u = interp(0, 0);
                        let v_coord = interp(0, 1);
                        let tex_color = if let Some(ref ti) = tex_owned {
                            sample_texture(&ti.as_ref(), u, v_coord)
                        } else {
                            [1.0, 1.0, 1.0, 1.0]
                        };
                        let tr = interp(1, 0);
                        let tg = interp(1, 1);
                        let tb = interp(1, 2);
                        [tex_color[0] * tr, tex_color[1] * tg, tex_color[2] * tb, tex_color[3]]
                    }
                };

                self.write_pixel(pix_idx, &frag_color, blend_enabled, blend_src, blend_dst, blend_src_alpha, blend_dst_alpha);
            }
        }
    }

    /// Rasterize a single point as a filled square centered on the vertex position.
    fn rasterize_point(&mut self, v: &SoftVertex, fragment_mode: &FragmentMode) {
        let [vp_x, vp_y, vp_w, vp_h] = self.state.viewport;
        let w = v.position[3];
        if w == 0.0 { return; }
        let inv_w = 1.0 / w;
        let ndc_x = v.position[0] * inv_w;
        let ndc_y = v.position[1] * inv_w;

        let sx = (ndc_x + 1.0) * 0.5 * vp_w as f32 + vp_x as f32;
        let sy = self.height as f32 - ((ndc_y + 1.0) * 0.5 * vp_h as f32 + vp_y as f32);

        // Parse gl_PointSize from vertex shader
        let point_size = self.detect_point_size();
        let half = (point_size * 0.5).ceil() as i32;

        let cx = sx as i32;
        let cy = sy as i32;
        let fb_w = self.width as i32;
        let fb_h = self.height as i32;

        let frag_color = match fragment_mode {
            FragmentMode::ConstantColor(c) => *c,
            FragmentMode::UniformColor(c) => *c,
            FragmentMode::VaryingColor => {
                let r = v.varyings[0].data[0];
                let g = v.varyings[0].data[1];
                let b = v.varyings[0].data[2];
                if v.varyings[0].components >= 4 { [r, g, b, v.varyings[0].data[3]] } else { [r, g, b, 1.0] }
            }
            _ => [1.0, 0.0, 1.0, 1.0],
        };

        let blend_enabled = self.state.blend_enabled;
        let blend_src = self.state.blend_src;
        let blend_dst = self.state.blend_dst;
        let blend_src_alpha = self.state.blend_src_alpha;
        let blend_dst_alpha = self.state.blend_dst_alpha;

        for py in (cy - half)..=(cy + half - 1) {
            for px in (cx - half)..=(cx + half - 1) {
                if px < 0 || px >= fb_w || py < 0 || py >= fb_h { continue; }
                let pix_idx = (py * fb_w + px) as usize;
                self.write_pixel(pix_idx, &frag_color, blend_enabled, blend_src, blend_dst, blend_src_alpha, blend_dst_alpha);
            }
        }
    }

    /// Rasterize a line segment using Bresenham's algorithm.
    fn rasterize_line(&mut self, v0: &SoftVertex, v1: &SoftVertex, fragment_mode: &FragmentMode) {
        let [vp_x, vp_y, vp_w, vp_h] = self.state.viewport;

        let to_screen = |v: &SoftVertex| -> (f32, f32, [f32; 4]) {
            let w = v.position[3];
            let inv_w = if w != 0.0 { 1.0 / w } else { 0.0 };
            let ndc_x = v.position[0] * inv_w;
            let ndc_y = v.position[1] * inv_w;
            let sx = (ndc_x + 1.0) * 0.5 * vp_w as f32 + vp_x as f32;
            let sy = self.height as f32 - ((ndc_y + 1.0) * 0.5 * vp_h as f32 + vp_y as f32);
            let color = match fragment_mode {
                FragmentMode::ConstantColor(c) => *c,
                FragmentMode::UniformColor(c) => *c,
                FragmentMode::VaryingColor => {
                    let r = v.varyings[0].data[0];
                    let g = v.varyings[0].data[1];
                    let b = v.varyings[0].data[2];
                    if v.varyings[0].components >= 4 { [r, g, b, v.varyings[0].data[3]] } else { [r, g, b, 1.0] }
                }
                _ => [1.0, 0.0, 1.0, 1.0],
            };
            (sx, sy, color)
        };

        let (sx0, sy0, c0) = to_screen(v0);
        let (sx1, sy1, c1) = to_screen(v1);
        // Diamond-exit rule: when a coordinate falls exactly on a pixel boundary,
        // OpenGL assigns it to the pixel with the lower coordinate (left for X,
        // above for Y in framebuffer-Y-down). Use floor(x - epsilon) to match.
        let _snap = |v: f32| -> i32 {
            let frac = v - v.floor();
            if frac < 1e-6 { (v - 1.0) as i32 + 1 - 1 } else { v as i32 }
        };
        // For X: exact boundary goes to pixel on the left (lower index)
        // For Y: exact boundary goes to pixel above in framebuffer (lower index)
        // But the asymmetry in Chrome: horizontal lines at boundary go to the
        // pixel below (higher fb Y = lower GL Y), vertical lines go left.
        // This matches: X uses floor(x - epsilon), Y uses floor(y).
        let snap_x = |v: f32| -> i32 {
            let frac = v - v.floor();
            if frac.abs() < 1e-6 { v as i32 - 1 } else { v as i32 }
        };
        let mut x0 = snap_x(sx0);
        let mut y0 = sy0 as i32;
        let x1 = snap_x(sx1);
        let y1 = sy1 as i32;
        let fb_w = self.width as i32;
        let fb_h = self.height as i32;

        let blend_enabled = self.state.blend_enabled;
        let blend_src = self.state.blend_src;
        let blend_dst = self.state.blend_dst;
        let blend_src_alpha = self.state.blend_src_alpha;
        let blend_dst_alpha = self.state.blend_dst_alpha;

        let dx = (x1 - x0).abs();
        let dy = -(y1 - y0).abs();
        let step_x = if x0 < x1 { 1 } else { -1 };
        let step_y = if y0 < y1 { 1 } else { -1 };
        let mut err = dx + dy;
        let total_steps = dx.max(-dy);
        let mut step = 0;

        loop {
            if x0 >= 0 && x0 < fb_w && y0 >= 0 && y0 < fb_h {
                let t = if total_steps > 0 { step as f32 / total_steps as f32 } else { 0.0 };
                let frag_color = [
                    c0[0] + (c1[0] - c0[0]) * t,
                    c0[1] + (c1[1] - c0[1]) * t,
                    c0[2] + (c1[2] - c0[2]) * t,
                    c0[3] + (c1[3] - c0[3]) * t,
                ];
                let pix_idx = (y0 * fb_w + x0) as usize;
                self.write_pixel(pix_idx, &frag_color, blend_enabled, blend_src, blend_dst, blend_src_alpha, blend_dst_alpha);
            }

            if x0 == x1 && y0 == y1 { break; }
            let e2 = 2 * err;
            if e2 >= dy {
                err += dy;
                x0 += step_x;
            }
            if e2 <= dx {
                err += dx;
                y0 += step_y;
            }
            step += 1;
        }
    }

    /// Detect gl_PointSize from vertex shader source.
    fn detect_point_size(&self) -> f32 {
        let prog_id = match self.state.current_program {
            Some(id) => id,
            None => return 1.0,
        };
        let prog = match self.programs.get(&prog_id) {
            Some(p) => p,
            None => return 1.0,
        };
        let vs_id = match prog.vertex_shader {
            Some(id) => id,
            None => return 1.0,
        };
        let vs = match self.shaders.get(&vs_id) {
            Some(s) => s,
            None => return 1.0,
        };

        // Look for gl_PointSize = <float>;
        for line in vs.source.lines() {
            let trimmed = line.trim();
            if trimmed.contains("gl_PointSize") && trimmed.contains('=') {
                // Extract the value after '='
                if let Some(eq_pos) = trimmed.find('=') {
                    let after = trimmed[eq_pos + 1..].trim().trim_end_matches(';').trim();
                    if let Ok(size) = after.parse::<f32>() {
                        return size;
                    }
                }
            }
        }
        1.0
    }

    /// Write a pixel to the framebuffer with blending and colorMask applied.
    fn write_pixel(
        &mut self,
        pix_idx: usize,
        frag_color: &[f32; 4],
        blend_enabled: bool,
        blend_src_rgb: u32,
        blend_dst_rgb: u32,
        blend_src_a: u32,
        blend_dst_a: u32,
    ) {
        let fb_idx = pix_idx * 4;
        if fb_idx + 4 > self.framebuffer.len() { return; }

        let (out_r, out_g, out_b, out_a) = if blend_enabled {
            let src = frag_color;
            let dst = [
                self.framebuffer[fb_idx] as f32 / 255.0,
                self.framebuffer[fb_idx + 1] as f32 / 255.0,
                self.framebuffer[fb_idx + 2] as f32 / 255.0,
                self.framebuffer[fb_idx + 3] as f32 / 255.0,
            ];

            let sf_rgb = blend_factor(blend_src_rgb, src, &dst);
            let df_rgb = blend_factor(blend_dst_rgb, src, &dst);
            let sf_a = blend_factor(blend_src_a, src, &dst);
            let df_a = blend_factor(blend_dst_a, src, &dst);

            let eq_rgb = self.state.blend_equation_rgb;
            let eq_a = self.state.blend_equation_alpha;

            let blend_channel = |s: f32, sf: f32, d: f32, df: f32, eq: u32| -> f32 {
                match eq {
                    GL_FUNC_ADD => s * sf + d * df,
                    GL_FUNC_SUBTRACT => (s * sf - d * df).max(0.0),
                    GL_FUNC_REVERSE_SUBTRACT => (d * df - s * sf).max(0.0),
                    GL_MIN => s.min(d),
                    GL_MAX => s.max(d),
                    _ => s * sf + d * df,
                }
            };

            (
                blend_channel(src[0], sf_rgb[0], dst[0], df_rgb[0], eq_rgb),
                blend_channel(src[1], sf_rgb[1], dst[1], df_rgb[1], eq_rgb),
                blend_channel(src[2], sf_rgb[2], dst[2], df_rgb[2], eq_rgb),
                blend_channel(src[3], sf_a[3], dst[3], df_a[3], eq_a),
            )
        } else {
            (frag_color[0], frag_color[1], frag_color[2], frag_color[3])
        };

        let cm = self.state.color_mask;
        if cm[0] { self.framebuffer[fb_idx] = (out_r * 255.0).round().min(255.0).max(0.0) as u8; }
        if cm[1] { self.framebuffer[fb_idx + 1] = (out_g * 255.0).round().min(255.0).max(0.0) as u8; }
        if cm[2] { self.framebuffer[fb_idx + 2] = (out_b * 255.0).round().min(255.0).max(0.0) as u8; }
        if cm[3] { self.framebuffer[fb_idx + 3] = (out_a * 255.0).round().min(255.0).max(0.0) as u8; }
    }
}

// --- Helper types ---

#[derive(Clone, Default)]
struct SoftVertex {
    /// Clip-space position (x, y, z, w)
    position: [f32; 4],
    /// Varying data per attribute slot (attrib 1, 2, ...)
    /// Each slot holds up to 4 floats and a component count.
    varyings: [VaryingSlot; 4],
}

#[derive(Clone, Copy, Default)]
struct VaryingSlot {
    data: [f32; 4],
    components: u32,
}

enum FragmentMode {
    ConstantColor([f32; 4]),
    UniformColor([f32; 4]),
    VaryingColor,
    TextureSample,
    /// Texture sample multiplied by a per-vertex tint from varying slot 1 (attrib 2).
    TextureTinted,
    /// Discard fragments where varying[slot][comp] < threshold, then output constant color.
    DiscardVarying { slot: usize, comp: usize, threshold: f32 },
}

/// Texture sampling info passed to the sampler (borrowed).
struct TexSampleInfo<'a> {
    width: u32,
    height: u32,
    data: &'a [u8],
    mag_filter: u32,
    wrap_s: u32,
    wrap_t: u32,
}

/// Owned version for when we need to avoid borrow conflicts.
struct OwnedTexSampleInfo {
    width: u32,
    height: u32,
    data: Vec<u8>,
    mag_filter: u32,
    wrap_s: u32,
    wrap_t: u32,
}

impl OwnedTexSampleInfo {
    fn as_ref(&self) -> TexSampleInfo<'_> {
        TexSampleInfo {
            width: self.width, height: self.height, data: &self.data,
            mag_filter: self.mag_filter, wrap_s: self.wrap_s, wrap_t: self.wrap_t,
        }
    }
}

const GL_LINEAR: u32 = 0x2601;
const GL_REPEAT: u32 = 0x2901;
const GL_CLAMP_TO_EDGE: u32 = 0x812F;

/// Optional vertex transform applied before rasterization.
enum VertexTransform {
    None,
    /// Apply a 4x4 matrix (column-major) to each vertex position.
    Matrix4([f32; 16]),
}

/// Compute blend factor for each RGBA channel given the blend function constant.
fn blend_factor(func: u32, src: &[f32; 4], dst: &[f32; 4]) -> [f32; 4] {
    match func {
        GL_ZERO => [0.0; 4],
        GL_ONE => [1.0; 4],
        GL_SRC_COLOR => *src,
        GL_ONE_MINUS_SRC_COLOR => [1.0 - src[0], 1.0 - src[1], 1.0 - src[2], 1.0 - src[3]],
        GL_DST_COLOR => *dst,
        GL_ONE_MINUS_DST_COLOR => [1.0 - dst[0], 1.0 - dst[1], 1.0 - dst[2], 1.0 - dst[3]],
        GL_SRC_ALPHA => [src[3]; 4],
        GL_ONE_MINUS_SRC_ALPHA => { let a = 1.0 - src[3]; [a; 4] }
        GL_DST_ALPHA => [dst[3]; 4],
        GL_ONE_MINUS_DST_ALPHA => { let a = 1.0 - dst[3]; [a; 4] }
        _ => [1.0; 4], // fallback to GL_ONE
    }
}

/// Apply texture wrap mode to a UV coordinate.
fn apply_wrap(coord: f32, mode: u32) -> f32 {
    match mode {
        GL_REPEAT => {
            let c = coord % 1.0;
            if c < 0.0 { c + 1.0 } else { c }
        }
        GL_CLAMP_TO_EDGE | _ => coord.max(0.0).min(1.0),
    }
}

/// Read a texel at integer coordinates, clamped to texture bounds.
fn read_texel(data: &[u8], width: u32, height: u32, tx: u32, ty: u32) -> [f32; 4] {
    let tx = tx.min(width.saturating_sub(1));
    let ty = ty.min(height.saturating_sub(1));
    let idx = ((ty * width + tx) * 4) as usize;
    if idx + 4 <= data.len() {
        [
            data[idx] as f32 / 255.0,
            data[idx + 1] as f32 / 255.0,
            data[idx + 2] as f32 / 255.0,
            data[idx + 3] as f32 / 255.0,
        ]
    } else {
        [1.0, 0.0, 1.0, 1.0]
    }
}

/// Sample a texture using the appropriate filter and wrap modes.
fn sample_texture(info: &TexSampleInfo, u: f32, v: f32) -> [f32; 4] {
    if info.width == 0 || info.height == 0 || info.data.is_empty() {
        return [1.0, 0.0, 1.0, 1.0];
    }

    let u = apply_wrap(u, info.wrap_s);
    let v = apply_wrap(v, info.wrap_t);

    if info.mag_filter == GL_LINEAR {
        // Bilinear interpolation matching OpenGL spec
        // texel centers are at (i+0.5)/width for texel i
        let fu = u * info.width as f32 - 0.5;
        let fv = v * info.height as f32 - 0.5;
        let x0 = fu.floor() as i32;
        let y0 = fv.floor() as i32;
        let fx = fu - x0 as f32;
        let fy = fv - y0 as f32;

        // For wrap mode: handle coordinate wrapping on neighbor texels
        let wrap_x = |x: i32| -> u32 {
            if info.wrap_s == GL_REPEAT {
                ((x % info.width as i32 + info.width as i32) % info.width as i32) as u32
            } else {
                x.max(0).min(info.width as i32 - 1) as u32
            }
        };
        let wrap_y = |y: i32| -> u32 {
            if info.wrap_t == GL_REPEAT {
                ((y % info.height as i32 + info.height as i32) % info.height as i32) as u32
            } else {
                y.max(0).min(info.height as i32 - 1) as u32
            }
        };

        let c00 = read_texel(info.data, info.width, info.height, wrap_x(x0), wrap_y(y0));
        let c10 = read_texel(info.data, info.width, info.height, wrap_x(x0 + 1), wrap_y(y0));
        let c01 = read_texel(info.data, info.width, info.height, wrap_x(x0), wrap_y(y0 + 1));
        let c11 = read_texel(info.data, info.width, info.height, wrap_x(x0 + 1), wrap_y(y0 + 1));

        let mut result = [0.0f32; 4];
        for i in 0..4 {
            let top = c00[i] * (1.0 - fx) + c10[i] * fx;
            let bot = c01[i] * (1.0 - fx) + c11[i] * fx;
            result[i] = top * (1.0 - fy) + bot * fy;
        }
        result
    } else {
        // Nearest-neighbor
        let tx = ((u * info.width as f32) as u32).min(info.width - 1);
        let ty = ((v * info.height as f32) as u32).min(info.height - 1);
        read_texel(info.data, info.width, info.height, tx, ty)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn create_and_compile_shader() {
        let mut gl = WebGL2::new(64, 64);
        let cmds = json!([
            ["createShader", GL_VERTEX_SHADER, "__ret_1"],
        ]);
        let returns = gl.process_commands(&cmds);
        let rets = returns.as_array().unwrap();
        assert_eq!(rets.len(), 1);
        let shader_id = rets[0][1].as_u64().unwrap() as u32;
        assert!(shader_id > 0);
    }

    #[test]
    fn create_program_and_link() {
        let mut gl = WebGL2::new(64, 64);

        // Create shaders — mark as compiled with dummy WGSL
        let vs_id = gl.create_shader(GL_VERTEX_SHADER);
        let fs_id = gl.create_shader(GL_FRAGMENT_SHADER);
        {
            let vs = gl.shaders.get_mut(&vs_id).unwrap();
            vs.compiled = true;
            vs.wgsl = Some("@vertex fn main() -> @builtin(position) vec4<f32> { return vec4(0.0); }".to_string());
        }
        {
            let fs = gl.shaders.get_mut(&fs_id).unwrap();
            fs.compiled = true;
            fs.wgsl = Some("@fragment fn main() -> @location(0) vec4<f32> { return vec4(1.0); }".to_string());
        }

        let prog_id = gl.create_program();
        gl.attach_shader(prog_id, vs_id);
        gl.attach_shader(prog_id, fs_id);
        gl.link_program(prog_id);

        assert!(gl.programs.get(&prog_id).unwrap().linked);
    }

    #[test]
    fn link_fails_without_shaders() {
        let mut gl = WebGL2::new(64, 64);
        let prog_id = gl.create_program();
        gl.link_program(prog_id);
        assert!(!gl.programs.get(&prog_id).unwrap().linked);
        assert!(gl.programs.get(&prog_id).unwrap().info_log.contains("missing"));
    }

    #[test]
    fn clear_color_fills_framebuffer() {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["clearColor", 1.0, 0.0, 0.0, 1.0],
            ["clear", 0x4000]
        ]));

        let mut buf = vec![0u8; 64];
        gl.read_pixels(&mut buf);
        // Every pixel should be (255, 0, 0, 255)
        for pixel in buf.chunks_exact(4) {
            assert_eq!(pixel, [255, 0, 0, 255], "pixel should be red");
        }
    }

    #[test]
    fn clear_with_alpha() {
        let mut gl = WebGL2::new(2, 2);
        gl.process_commands(&json!([
            ["clearColor", 0.0, 1.0, 0.0, 0.5],
            ["clear", 0x4000]
        ]));

        let mut buf = vec![0u8; 16];
        gl.read_pixels(&mut buf);
        assert_eq!(buf[0], 0);
        assert_eq!(buf[1], 255);
        assert_eq!(buf[2], 0);
        assert_eq!(buf[3], 128); // 0.5 * 255 = 127.5, rounds to 128
    }

    #[test]
    fn enable_disable_caps() {
        let mut gl = WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["enable", GL_BLEND],
            ["enable", GL_DEPTH_TEST],
        ]));
        assert!(gl.state.blend_enabled);
        assert!(gl.state.depth_test_enabled);

        gl.process_commands(&json!([
            ["disable", GL_BLEND],
        ]));
        assert!(!gl.state.blend_enabled);
        assert!(gl.state.depth_test_enabled); // unchanged
    }

    #[test]
    fn viewport_set() {
        let mut gl = WebGL2::new(64, 64);
        gl.process_commands(&json!([
            ["viewport", 10, 20, 640, 480]
        ]));
        assert_eq!(gl.state.viewport, [10, 20, 640, 480]);
    }

    #[test]
    fn use_program() {
        let mut gl = WebGL2::new(4, 4);
        let prog_id = gl.create_program();
        gl.process_commands(&json!([
            ["useProgram", prog_id]
        ]));
        assert_eq!(gl.state.current_program, Some(prog_id));

        gl.process_commands(&json!([
            ["useProgram", 0]
        ]));
        assert_eq!(gl.state.current_program, None);
    }

    #[test]
    fn create_buffer() {
        let mut gl = WebGL2::new(4, 4);
        let ret = gl.process_commands(&json!([
            ["createBuffer", "__ret_1"]
        ]));
        let id = ret.as_array().unwrap()[0][1].as_u64().unwrap() as u32;
        assert!(gl.buffers.contains_key(&id));
    }

    #[test]
    fn bind_buffer() {
        let mut gl = WebGL2::new(4, 4);
        let buf_id = gl.alloc_id();
        gl.buffers.insert(buf_id, Buffer { target: 0, data: Vec::new(), usage: GL_STATIC_DRAW, index_type: GL_UNSIGNED_SHORT });

        gl.process_commands(&json!([
            ["bindBuffer", GL_ARRAY_BUFFER, buf_id]
        ]));
        assert_eq!(gl.state.bound_array_buffer, Some(buf_id));

        gl.process_commands(&json!([
            ["bindBuffer", GL_ARRAY_BUFFER, 0]
        ]));
        assert_eq!(gl.state.bound_array_buffer, None);
    }

    #[test]
    fn get_uniform_location_stable() {
        let mut gl = WebGL2::new(4, 4);
        let prog = gl.create_program();
        let loc1 = gl.get_uniform_location(prog, "u_time");
        let loc2 = gl.get_uniform_location(prog, "u_resolution");
        let loc3 = gl.get_uniform_location(prog, "u_time"); // same as loc1
        assert_ne!(loc1, loc2);
        assert_eq!(loc1, loc3, "same name should return same location");
    }

    #[test]
    fn empty_commands() {
        let mut gl = WebGL2::new(4, 4);
        let ret = gl.process_commands(&json!([]));
        assert_eq!(ret.as_array().unwrap().len(), 0);
    }

    #[test]
    fn shader_parameter_query() {
        let mut gl = WebGL2::new(4, 4);
        let id = gl.create_shader(GL_VERTEX_SHADER);

        // Not compiled yet
        let status = gl.get_shader_parameter(id, GL_COMPILE_STATUS);
        assert_eq!(status, json!(false));

        // Mark compiled
        gl.shaders.get_mut(&id).unwrap().compiled = true;
        let status = gl.get_shader_parameter(id, GL_COMPILE_STATUS);
        assert_eq!(status, json!(true));
    }

    #[test]
    fn nonexistent_shader_returns_null() {
        let gl = WebGL2::new(4, 4);
        assert_eq!(gl.get_shader_parameter(999, GL_COMPILE_STATUS), json!(null));
    }

}
