// WebGL2 API polyfill for stage-runtime
// Commands dispatch inline via native V8 callbacks (no per-frame array drain).

(function() {
  globalThis.__dz_webgl_errors = [];

  // WebGL constants
  var GL = {
    VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88E4, DYNAMIC_DRAW: 0x88E8,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
    COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100, STENCIL_BUFFER_BIT: 0x0400,
    BLEND: 0x0BE2, DEPTH_TEST: 0x0B71, CULL_FACE: 0x0B44,
    SCISSOR_TEST: 0x0C11, STENCIL_TEST: 0x0B90,
    FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403,
    TRIANGLES: 0x0004, TRIANGLE_STRIP: 0x0005, TRIANGLE_FAN: 0x0006,
    LINES: 0x0001, LINE_STRIP: 0x0003, POINTS: 0x0000,
    TEXTURE_2D: 0x0DE1, TEXTURE0: 0x84C0,
    RGBA: 0x1908, RGB: 0x1907,
    TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601, NEAREST: 0x2600,
    REPEAT: 0x2901, CLAMP_TO_EDGE: 0x812F,
    FRAMEBUFFER: 0x8D40, RENDERBUFFER: 0x8D41,
    COLOR_ATTACHMENT0: 0x8CE0, DEPTH_ATTACHMENT: 0x8D00,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    // Blend factors
    ONE: 1, ZERO: 0,
    SRC_COLOR: 0x0300, ONE_MINUS_SRC_COLOR: 0x0301,
    SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
    DST_ALPHA: 0x0304, ONE_MINUS_DST_ALPHA: 0x0305,
    DST_COLOR: 0x0306, ONE_MINUS_DST_COLOR: 0x0307,
    SRC_ALPHA_SATURATE: 0x0308,
    CONSTANT_COLOR: 0x8001, ONE_MINUS_CONSTANT_COLOR: 0x8002,
    CONSTANT_ALPHA: 0x8003, ONE_MINUS_CONSTANT_ALPHA: 0x8004,
    // Depth / stencil functions
    NEVER: 0x0200, LESS: 0x0201, EQUAL: 0x0202, LEQUAL: 0x0203,
    GREATER: 0x0204, NOTEQUAL: 0x0205, GEQUAL: 0x0206, ALWAYS: 0x0207,
    // Face culling
    CW: 0x0900, CCW: 0x0901,
    FRONT: 0x0404, BACK: 0x0405, FRONT_AND_BACK: 0x0408,
    // Index types
    UNSIGNED_INT: 0x1405,
    // Error codes
    INVALID_ENUM: 0x0500, INVALID_VALUE: 0x0501, INVALID_OPERATION: 0x0502,
    OUT_OF_MEMORY: 0x0505, INVALID_FRAMEBUFFER_OPERATION: 0x0506,
    UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    MAX_TEXTURE_SIZE: 0x0D33,
    MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
    MAX_RENDERBUFFER_SIZE: 0x84E8,
    MAX_VIEWPORT_DIMS: 0x0D3A,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
    MAX_VERTEX_ATTRIBS: 0x8869,
    MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD,
    MAX_VARYING_VECTORS: 0x8DFC,
    ALIASED_LINE_WIDTH_RANGE: 0x846E,
    ALIASED_POINT_SIZE_RANGE: 0x846D,
    RENDERER: 0x1F01,
    VENDOR: 0x1F00,
    VERSION: 0x1F02,
    SHADING_LANGUAGE_VERSION: 0x8B8C,
    MAX_DRAW_BUFFERS: 0x8824,
    MAX_COLOR_ATTACHMENTS: 0x8CDF,
    MAX_SAMPLES: 0x8D57,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    MAX_ARRAY_TEXTURE_LAYERS: 0x88FF,
    MAX_ELEMENTS_VERTICES: 0x80E8,
    MAX_ELEMENTS_INDICES: 0x80E9,
    MAX_UNIFORM_BUFFER_BINDINGS: 0x8A2F,
    MAX_VERTEX_UNIFORM_BLOCKS: 0x8A2B,
    MAX_FRAGMENT_UNIFORM_BLOCKS: 0x8A2D,
    NO_ERROR: 0,
    // Blend equations
    FUNC_ADD: 0x8006, FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B,
    MIN: 0x8007, MAX: 0x8008,
    // Data types
    BYTE: 0x1400, SHORT: 0x1402, INT: 0x1404, HALF_FLOAT: 0x140B,
    // Texture targets
    TEXTURE_CUBE_MAP: 0x8513, TEXTURE_3D: 0x806F, TEXTURE_2D_ARRAY: 0x8C1A,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515, TEXTURE_CUBE_MAP_NEGATIVE_X: 0x8516,
    TEXTURE_CUBE_MAP_POSITIVE_Y: 0x8517, TEXTURE_CUBE_MAP_NEGATIVE_Y: 0x8518,
    TEXTURE_CUBE_MAP_POSITIVE_Z: 0x8519, TEXTURE_CUBE_MAP_NEGATIVE_Z: 0x851A,
    // Texture wrapping
    TEXTURE_WRAP_R: 0x8072, MIRRORED_REPEAT: 0x8370,
    // Texture params
    TEXTURE_BASE_LEVEL: 0x813C, TEXTURE_MAX_LEVEL: 0x813D,
    TEXTURE_COMPARE_FUNC: 0x884D, TEXTURE_COMPARE_MODE: 0x884C,
    TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE,
    // Texture filters
    NEAREST_MIPMAP_NEAREST: 0x2700, LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702, LINEAR_MIPMAP_LINEAR: 0x2703,
    // Buffer usage
    STREAM_DRAW: 0x88E0, STREAM_READ: 0x88E1, STREAM_COPY: 0x88E2,
    STATIC_READ: 0x88E5, STATIC_COPY: 0x88E6,
    DYNAMIC_READ: 0x88E9, DYNAMIC_COPY: 0x88EA,
    // Buffer targets
    UNIFORM_BUFFER: 0x8A11, COPY_READ_BUFFER: 0x8F36, COPY_WRITE_BUFFER: 0x8F37,
    TRANSFORM_FEEDBACK_BUFFER: 0x8C8E, PIXEL_PACK_BUFFER: 0x88EB, PIXEL_UNPACK_BUFFER: 0x88EC,
    // Internal formats
    R8: 0x8229, RG8: 0x822B, RGB8: 0x8051, RGBA8: 0x8058,
    R16F: 0x822D, RG16F: 0x822F, RGB16F: 0x881B, RGBA16F: 0x881A,
    R32F: 0x822E, RG32F: 0x8230, RGB32F: 0x8815, RGBA32F: 0x8814,
    DEPTH_COMPONENT16: 0x81A5, DEPTH_COMPONENT24: 0x81A6, DEPTH_COMPONENT32F: 0x8CAC,
    DEPTH24_STENCIL8: 0x88F0, DEPTH32F_STENCIL8: 0x8CAD,
    DEPTH_COMPONENT: 0x1902, DEPTH_STENCIL: 0x84F9,
    // Pixel formats
    RED: 0x1903, RG: 0x8227, RED_INTEGER: 0x8D94, RG_INTEGER: 0x8228,
    RGB_INTEGER: 0x8D98, RGBA_INTEGER: 0x8D99,
    // Framebuffer attachments
    DEPTH_STENCIL_ATTACHMENT: 0x821A,
    COLOR_ATTACHMENT1: 0x8CE1, COLOR_ATTACHMENT2: 0x8CE2, COLOR_ATTACHMENT3: 0x8CE3,
    DRAW_FRAMEBUFFER: 0x8CA9, READ_FRAMEBUFFER: 0x8CA8,
    // Renderbuffer
    RENDERBUFFER_WIDTH: 0x8D42, RENDERBUFFER_HEIGHT: 0x8D43,
    // Capabilities
    DITHER: 0x0BD0, POLYGON_OFFSET_FILL: 0x8037,
    SAMPLE_ALPHA_TO_COVERAGE: 0x809E, SAMPLE_COVERAGE: 0x80A0,
    RASTERIZER_DISCARD: 0x8C89,
    // Pixel store
    UNPACK_ALIGNMENT: 0x0CF5, PACK_ALIGNMENT: 0x0D05,
    UNPACK_ROW_LENGTH: 0x0CF2, UNPACK_IMAGE_HEIGHT: 0x806E,
    UNPACK_SKIP_PIXELS: 0x0CF4, UNPACK_SKIP_ROWS: 0x0CF3, UNPACK_SKIP_IMAGES: 0x806D,
    PACK_ROW_LENGTH: 0x0D02, PACK_SKIP_PIXELS: 0x0D04, PACK_SKIP_ROWS: 0x0D03,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    // Query / active info
    ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B89,
    FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52,
    INT_VEC2: 0x8B53, INT_VEC3: 0x8B54, INT_VEC4: 0x8B55,
    FLOAT_MAT2: 0x8B5A, FLOAT_MAT3: 0x8B5B, FLOAT_MAT4: 0x8B5C,
    SAMPLER_2D: 0x8B5E, SAMPLER_CUBE: 0x8B60,
    BOOL: 0x8B56, BOOL_VEC2: 0x8B57, BOOL_VEC3: 0x8B58, BOOL_VEC4: 0x8B59,
    // Transform feedback
    TRANSFORM_FEEDBACK: 0x8E22, INTERLEAVED_ATTRIBS: 0x8C8C, SEPARATE_ATTRIBS: 0x8C8D,
    TRANSFORM_FEEDBACK_PRIMITIVES_WRITTEN: 0x8C88,
    // Sync
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117, ALREADY_SIGNALED: 0x911A,
    TIMEOUT_EXPIRED: 0x911B, CONDITION_SATISFIED: 0x911C,
    WAIT_FAILED: 0x911D, SYNC_FLUSH_COMMANDS_BIT: 0x00000001,
    // Line
    LINE_LOOP: 0x0002,
    // Vertex attrib types
    FLOAT_MAT2x3: 0x8B65, FLOAT_MAT2x4: 0x8B66,
    FLOAT_MAT3x2: 0x8B67, FLOAT_MAT3x4: 0x8B68,
    FLOAT_MAT4x2: 0x8B69, FLOAT_MAT4x3: 0x8B6A,
    // Precision
    LOW_FLOAT: 0x8DF0, MEDIUM_FLOAT: 0x8DF1, HIGH_FLOAT: 0x8DF2,
    LOW_INT: 0x8DF3, MEDIUM_INT: 0x8DF4, HIGH_INT: 0x8DF5,
    // MRT clear buffers
    COLOR: 0x1800, DEPTH: 0x1801, STENCIL: 0x1802,
    // Read buffer
    BACK: 0x0405, NONE: 0,
    // COLOR_ATTACHMENT 4-15 for MRT
    COLOR_ATTACHMENT4: 0x8CE4, COLOR_ATTACHMENT5: 0x8CE5,
    COLOR_ATTACHMENT6: 0x8CE6, COLOR_ATTACHMENT7: 0x8CE7,
    COLOR_ATTACHMENT8: 0x8CE8, COLOR_ATTACHMENT9: 0x8CE9,
    COLOR_ATTACHMENT10: 0x8CEA, COLOR_ATTACHMENT11: 0x8CEB,
    COLOR_ATTACHMENT12: 0x8CEC, COLOR_ATTACHMENT13: 0x8CED,
    COLOR_ATTACHMENT14: 0x8CEE, COLOR_ATTACHMENT15: 0x8CEF,
    // UBO queries
    UNIFORM_BUFFER_BINDING: 0x8A28,
    UNIFORM_BUFFER_START: 0x8A29, UNIFORM_BUFFER_SIZE: 0x8A2A,
    UNIFORM_TYPE: 0x8A37, UNIFORM_SIZE: 0x8A38,
    UNIFORM_BLOCK_INDEX: 0x8A3A, UNIFORM_OFFSET: 0x8A3B,
    UNIFORM_ARRAY_STRIDE: 0x8A3C, UNIFORM_MATRIX_STRIDE: 0x8A3D,
    UNIFORM_IS_ROW_MAJOR: 0x8A3E,
    UNIFORM_BLOCK_BINDING: 0x8A3F,
    UNIFORM_BLOCK_DATA_SIZE: 0x8A40,
    UNIFORM_BLOCK_ACTIVE_UNIFORMS: 0x8A42,
    UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES: 0x8A43,
    UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER: 0x8A44,
    UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER: 0x8A46,
    // Internalformat query
    SAMPLES: 0x80A9,
    // Shader type
    VERTEX_SHADER_BIT: 0x00000001, FRAGMENT_SHADER_BIT: 0x00000002,
    // Delete status / validate
    DELETE_STATUS: 0x8B80, VALIDATE_STATUS: 0x8B83,
    ATTACHED_SHADERS: 0x8B85,
    // Misc
    SIGNALED: 0x9119,
    UNSIGNALED: 0x9118,
    MAX_VERTEX_OUTPUT_COMPONENTS: 0x9122,
    MAX_FRAGMENT_INPUT_COMPONENTS: 0x9125,
    TEXTURE_IMMUTABLE_FORMAT: 0x912F,
    TEXTURE_IMMUTABLE_LEVELS: 0x82DF,
  };

  function WebGL2RenderingContext(canvas) {
    this.canvas = canvas;
    this.drawingBufferWidth = canvas.width;
    this.drawingBufferHeight = canvas.height;
    // Copy GL constants onto the context as read-only (spec compliance)
    for (var k in GL) {
      Object.defineProperty(this, k, { value: GL[k], writable: false, enumerable: true, configurable: false });
    }
  }

  var proto = WebGL2RenderingContext.prototype;

  // --- Shader ---
  proto.createShader = function(type) { return __dz_webgl_cmd_ret('createShader', type); };
  proto.shaderSource = function(shader, source) { __dz_webgl_cmd('shaderSource', shader, source); };
  proto.compileShader = function(shader) { __dz_webgl_cmd('compileShader', shader); };
  proto.getShaderParameter = function(shader, pname) {
    var v = __dz_webgl_cmd_ret('getShaderParameter', shader, pname);
    // COMPILE_STATUS / DELETE_STATUS return booleans
    if (pname === GL.COMPILE_STATUS || pname === 0x8B80) return v !== 0;
    return v;
  };
  proto.getShaderInfoLog = function(shader) { return __dz_webgl_cmd_ret_str('getShaderInfoLog', shader) || ''; };
  proto.deleteShader = function(shader) { __dz_webgl_cmd('deleteShader', shader); };
  proto.getShaderSource = function(shader) { return ''; };
  // Three.js/Babylon.js call this at init to detect precision support
  proto.getShaderPrecisionFormat = function(shaderType, precisionType) {
    return { rangeMin: 127, rangeMax: 127, precision: 23 };
  };

  // --- Program ---
  proto.createProgram = function() { return __dz_webgl_cmd_ret('createProgram'); };
  proto.attachShader = function(prog, shader) { __dz_webgl_cmd('attachShader', prog, shader); };
  proto.detachShader = function(prog, shader) { __dz_webgl_cmd('detachShader', prog, shader); };
  proto.linkProgram = function(prog) { __dz_webgl_cmd('linkProgram', prog); };
  proto.useProgram = function(prog) { __dz_webgl_cmd('useProgram', prog || 0); };
  proto.validateProgram = function(prog) {};
  proto.getProgramParameter = function(prog, pname) {
    var v = __dz_webgl_cmd_ret('getProgramParameter', prog, pname);
    // LINK_STATUS / DELETE_STATUS / VALIDATE_STATUS return booleans
    if (pname === GL.LINK_STATUS || pname === 0x8B80 || pname === 0x8B83) return v !== 0;
    return v;
  };
  proto.getProgramInfoLog = function(prog) { return __dz_webgl_cmd_ret_str('getProgramInfoLog', prog) || ''; };
  proto.deleteProgram = function(prog) { __dz_webgl_cmd('deleteProgram', prog); };
  proto.getAttachedShaders = function(prog) { return []; };
  proto.bindAttribLocation = function(prog, index, name) { __dz_webgl_cmd('bindAttribLocation', prog, index, name); };

  // --- Buffer ---
  proto.createBuffer = function() { return __dz_webgl_cmd_ret('createBuffer'); };
  proto.bindBuffer = function(target, buf) { __dz_webgl_cmd('bindBuffer', target, buf || 0); };
  proto.bufferData = function(target, data, usage) {
    if (data && data.buffer instanceof ArrayBuffer) {
      // Typed array — zero-copy via native callback
      __dz_webgl_buf_data('bufferData', target, data, usage || GL.STATIC_DRAW);
    } else if (typeof data === 'number') {
      __dz_webgl_cmd('bufferData_size', target, data, usage || GL.STATIC_DRAW);
    } else {
      __dz_webgl_cmd('bufferData_size', target, 0, usage || GL.STATIC_DRAW);
    }
  };
  proto.deleteBuffer = function(buf) { __dz_webgl_cmd('deleteBuffer', buf); };
  proto.bufferSubData = function(target, offset, data) {
    if (data && data.buffer instanceof ArrayBuffer) {
      __dz_webgl_buf_data('bufferSubData', target, data, offset);
    } else {
      __dz_webgl_cmd('bufferSubData', target, offset, 0);
    }
  };
  proto.copyBufferSubData = function(readTarget, writeTarget, readOffset, writeOffset, size) {
    __dz_webgl_cmd('copyBufferSubData', readTarget, writeTarget, readOffset, writeOffset, size);
  };
  proto.getBufferParameter = function(target, pname) { return __dz_webgl_cmd_ret('getBufferParameter', target, pname) || 0; };
  proto.getBufferSubData = function(target, srcByteOffset, dstBuffer, dstOffset, length) {
    // Readback from GPU buffers not supported — zero-fill destination
    if (dstBuffer) {
      var start = dstOffset || 0;
      var end = length ? start + length : dstBuffer.length;
      for (var i = start; i < end; i++) dstBuffer[i] = 0;
    }
  };

  // --- Texture ---
  proto.createTexture = function() { return __dz_webgl_cmd_ret('createTexture'); };
  proto.bindTexture = function(target, tex) { __dz_webgl_cmd('bindTexture', target, tex || 0); };
  proto.activeTexture = function(unit) { __dz_webgl_cmd('activeTexture', unit); };
  proto.texImage2D = function(target, level, internalformat, width, height, border, format, type, pixels) {
    if (pixels && pixels.buffer instanceof ArrayBuffer) {
      __dz_webgl_buf_data('texImage2D', target, pixels, 0, level, internalformat, width, height, border, format, type);
    } else {
      __dz_webgl_cmd('texImage2D', target, level, internalformat, width, height, border, format, type, 0);
    }
  };
  proto.texParameteri = function(target, pname, param) { __dz_webgl_cmd('texParameteri', target, pname, param); };
  proto.generateMipmap = function(target) { __dz_webgl_cmd('generateMipmap', target); };
  proto.texSubImage2D = function(target, level, xoffset, yoffset, width, height, format, type, pixels) {
    if (pixels && pixels.buffer instanceof ArrayBuffer) {
      __dz_webgl_buf_data('texSubImage2D', target, pixels, 0, level, xoffset, yoffset, width, height, 0, format, type);
    } else {
      __dz_webgl_cmd('texSubImage2D', target, level, xoffset, yoffset, width, height, format, type, 0);
    }
  };
  proto.texImage3D = function(target, level, internalformat, width, height, depth, border, format, type, pixels) {
    __dz_webgl_cmd('texImage3D', target, level, internalformat, width, height, depth, border, format, type);
  };
  proto.texSubImage3D = function(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, pixels) {
    __dz_webgl_cmd('texSubImage3D', target, level, xoffset, yoffset, zoffset, width, height, depth, format, type);
  };
  proto.copyTexImage2D = function(target, level, internalformat, x, y, width, height, border) {
    __dz_webgl_cmd('copyTexImage2D', target, level, internalformat, x, y, width, height, border);
  };
  proto.copyTexSubImage2D = function(target, level, xoffset, yoffset, x, y, width, height) {
    __dz_webgl_cmd('copyTexSubImage2D', target, level, xoffset, yoffset, x, y, width, height);
  };
  proto.texParameterf = function(target, pname, param) { __dz_webgl_cmd('texParameterf', target, pname, param); };
  proto.texStorage2D = function(target, levels, internalformat, width, height) {
    __dz_webgl_cmd('texStorage2D', target, levels, internalformat, width, height);
  };
  proto.texStorage3D = function(target, levels, internalformat, width, height, depth) {
    __dz_webgl_cmd('texStorage3D', target, levels, internalformat, width, height, depth);
  };
  proto.compressedTexImage2D = function() {};
  proto.compressedTexSubImage2D = function() {};
  proto.compressedTexImage3D = function() {};
  proto.compressedTexSubImage3D = function() {};
  proto.copyTexSubImage3D = function(target, level, xoffset, yoffset, zoffset, x, y, width, height) {};
  proto.getTexParameter = function(target, pname) { return __dz_webgl_cmd_ret('getTexParameter', target, pname) || 0; };
  proto.deleteTexture = function(tex) { __dz_webgl_cmd('deleteTexture', tex); };
  proto.pixelStorei = function(pname, param) { __dz_webgl_cmd('pixelStorei', pname, param); };

  // --- Uniform ---
  proto.getUniformLocation = function(prog, name) { return __dz_webgl_cmd_ret('getUniformLocation', prog, name); };
  proto.getAttribLocation = function(prog, name) { var r = __dz_webgl_cmd_ret('getAttribLocation', prog, name); return r != null ? r : -1; };
  proto.uniform1f = function(loc, v) { __dz_webgl_cmd('uniform1f', loc, v); };
  proto.uniform1i = function(loc, v) { __dz_webgl_cmd('uniform1i', loc, v); };
  proto.uniform2f = function(loc, x, y) { __dz_webgl_cmd('uniform2f', loc, x, y); };
  proto.uniform3f = function(loc, x, y, z) { __dz_webgl_cmd('uniform3f', loc, x, y, z); };
  proto.uniform4f = function(loc, x, y, z, w) { __dz_webgl_cmd('uniform4f', loc, x, y, z, w); };
  proto.uniform2fv = function(loc, v) { __dz_webgl_cmd('uniform2fv', loc, v[0], v[1]); };
  proto.uniform3fv = function(loc, v) { __dz_webgl_cmd('uniform3fv', loc, v[0], v[1], v[2]); };
  proto.uniform4fv = function(loc, v) { __dz_webgl_cmd('uniform4fv', loc, v[0], v[1], v[2], v[3]); };
  proto.uniform1iv = function(loc, v) { __dz_webgl_cmd.apply(null, ['uniform1iv', loc].concat(Array.from(v))); };
  proto.uniform2i = function(loc, x, y) { __dz_webgl_cmd('uniform2i', loc, x, y); };
  proto.uniform3i = function(loc, x, y, z) { __dz_webgl_cmd('uniform3i', loc, x, y, z); };
  proto.uniform4i = function(loc, x, y, z, w) { __dz_webgl_cmd('uniform4i', loc, x, y, z, w); };
  proto.uniform2iv = function(loc, v) { __dz_webgl_cmd('uniform2iv', loc, v[0], v[1]); };
  proto.uniform3iv = function(loc, v) { __dz_webgl_cmd('uniform3iv', loc, v[0], v[1], v[2]); };
  proto.uniform4iv = function(loc, v) { __dz_webgl_cmd('uniform4iv', loc, v[0], v[1], v[2], v[3]); };
  proto.uniform1ui = function(loc, v) { __dz_webgl_cmd('uniform1ui', loc, v); };
  proto.uniform2ui = function(loc, x, y) { __dz_webgl_cmd('uniform2ui', loc, x, y); };
  proto.uniform3ui = function(loc, x, y, z) { __dz_webgl_cmd('uniform3ui', loc, x, y, z); };
  proto.uniform4ui = function(loc, x, y, z, w) { __dz_webgl_cmd('uniform4ui', loc, x, y, z, w); };
  proto.uniform1uiv = function(loc, v) { __dz_webgl_cmd.apply(null, ['uniform1uiv', loc].concat(Array.from(v))); };
  proto.uniform2uiv = function(loc, v) { __dz_webgl_cmd('uniform2uiv', loc, v[0], v[1]); };
  proto.uniform3uiv = function(loc, v) { __dz_webgl_cmd('uniform3uiv', loc, v[0], v[1], v[2]); };
  proto.uniform4uiv = function(loc, v) { __dz_webgl_cmd('uniform4uiv', loc, v[0], v[1], v[2], v[3]); };
  proto.uniform1fv = function(loc, v) { __dz_webgl_cmd.apply(null, ['uniform1fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix2fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix2fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix3fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix3fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix4fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix4fv', loc].concat(Array.from(v))); };
  // Non-square matrix uniforms (WebGL2)
  proto.uniformMatrix2x3fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix2x3fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix3x2fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix3x2fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix2x4fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix2x4fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix4x2fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix4x2fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix3x4fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix3x4fv', loc].concat(Array.from(v))); };
  proto.uniformMatrix4x3fv = function(loc, transpose, v) { __dz_webgl_cmd.apply(null,['uniformMatrix4x3fv', loc].concat(Array.from(v))); };

  // --- Vertex attrib ---
  proto.enableVertexAttribArray = function(index) { __dz_webgl_cmd('enableVertexAttribArray', index); };
  proto.disableVertexAttribArray = function(index) { __dz_webgl_cmd('disableVertexAttribArray', index); };
  proto.vertexAttribPointer = function(index, size, type, normalized, stride, offset) {
    __dz_webgl_cmd('vertexAttribPointer', index, size, type, !!normalized, stride, offset);
  };
  proto.vertexAttribDivisor = function(index, divisor) { __dz_webgl_cmd('vertexAttribDivisor', index, divisor); };
  proto.vertexAttribI4i = function(index, x, y, z, w) { __dz_webgl_cmd('vertexAttribI4i', index, x, y, z, w); };
  proto.vertexAttribI4ui = function(index, x, y, z, w) { __dz_webgl_cmd('vertexAttribI4ui', index, x, y, z, w); };
  proto.vertexAttribIPointer = function(index, size, type, stride, offset) {
    __dz_webgl_cmd('vertexAttribIPointer', index, size, type, stride, offset);
  };
  proto.vertexAttrib1f = function(index, x) {};
  proto.vertexAttrib2f = function(index, x, y) {};
  proto.vertexAttrib3f = function(index, x, y, z) {};
  proto.vertexAttrib4f = function(index, x, y, z, w) {};
  proto.vertexAttrib1fv = function(index, v) {};
  proto.vertexAttrib2fv = function(index, v) {};
  proto.vertexAttrib3fv = function(index, v) {};
  proto.vertexAttrib4fv = function(index, v) {};
  proto.vertexAttribI4iv = function(index, v) {};
  proto.vertexAttribI4uiv = function(index, v) {};
  proto.getVertexAttrib = function(index, pname) { var r = __dz_webgl_cmd_ret('getVertexAttrib', index, pname); return r != null ? r : null; };
  proto.getVertexAttribOffset = function(index, pname) { return 0; };
  proto.createVertexArray = function() { return __dz_webgl_cmd_ret('createVertexArray'); };
  proto.bindVertexArray = function(vao) { __dz_webgl_cmd('bindVertexArray', vao || 0); };
  proto.deleteVertexArray = function(vao) { __dz_webgl_cmd('deleteVertexArray', vao); };

  // --- Draw ---
  proto.drawArrays = function(mode, first, count) { __dz_webgl_cmd('drawArrays', mode, first, count); };
  proto.drawElements = function(mode, count, type, offset) { __dz_webgl_cmd('drawElements', mode, count, type, offset); };
  proto.drawArraysInstanced = function(mode, first, count, instanceCount) { __dz_webgl_cmd('drawArraysInstanced', mode, first, count, instanceCount); };
  proto.drawElementsInstanced = function(mode, count, type, offset, instanceCount) { __dz_webgl_cmd('drawElementsInstanced', mode, count, type, offset, instanceCount); };
  proto.drawRangeElements = function(mode, start, end, count, type, offset) { __dz_webgl_cmd('drawRangeElements', mode, start, end, count, type, offset); };
  proto.drawBuffers = function(buffers) { __dz_webgl_cmd.apply(null,['drawBuffers'].concat(buffers)); };

  // --- State ---
  proto.enable = function(cap) { __dz_webgl_cmd('enable', cap); };
  proto.disable = function(cap) { __dz_webgl_cmd('disable', cap); };
  proto.viewport = function(x, y, w, h) { __dz_webgl_cmd('viewport', x, y, w, h); };
  proto.scissor = function(x, y, w, h) { __dz_webgl_cmd('scissor', x, y, w, h); };
  proto.clearColor = function(r, g, b, a) { __dz_webgl_cmd('clearColor', r, g, b, a); };
  proto.clearDepth = function(d) { __dz_webgl_cmd('clearDepth', d); };
  proto.clear = function(mask) { __dz_webgl_cmd('clear', mask); };
  proto.blendFunc = function(src, dst) { __dz_webgl_cmd('blendFunc', src, dst); };
  proto.blendFuncSeparate = function(srcRGB, dstRGB, srcA, dstA) { __dz_webgl_cmd('blendFuncSeparate', srcRGB, dstRGB, srcA, dstA); };
  proto.depthFunc = function(func) { __dz_webgl_cmd('depthFunc', func); };
  proto.depthMask = function(flag) { __dz_webgl_cmd('depthMask', !!flag); };
  proto.colorMask = function(r, g, b, a) { __dz_webgl_cmd('colorMask', !!r, !!g, !!b, !!a); };
  proto.cullFace = function(mode) { __dz_webgl_cmd('cullFace', mode); };
  proto.frontFace = function(mode) { __dz_webgl_cmd('frontFace', mode); };
  proto.blendEquation = function(mode) { __dz_webgl_cmd('blendEquation', mode); };
  proto.blendEquationSeparate = function(modeRGB, modeAlpha) { __dz_webgl_cmd('blendEquationSeparate', modeRGB, modeAlpha); };
  proto.blendColor = function(r, g, b, a) { __dz_webgl_cmd('blendColor', r, g, b, a); };
  proto.clearStencil = function(s) { __dz_webgl_cmd('clearStencil', s); };
  proto.stencilFunc = function(func, ref, mask) { __dz_webgl_cmd('stencilFunc', func, ref, mask); };
  proto.stencilFuncSeparate = function(face, func, ref, mask) { __dz_webgl_cmd('stencilFuncSeparate', face, func, ref, mask); };
  proto.stencilOp = function(sfail, dpfail, dppass) { __dz_webgl_cmd('stencilOp', sfail, dpfail, dppass); };
  proto.stencilOpSeparate = function(face, sfail, dpfail, dppass) { __dz_webgl_cmd('stencilOpSeparate', face, sfail, dpfail, dppass); };
  proto.stencilMask = function(mask) { __dz_webgl_cmd('stencilMask', mask); };
  proto.stencilMaskSeparate = function(face, mask) { __dz_webgl_cmd('stencilMaskSeparate', face, mask); };
  proto.depthRange = function(near, far) { __dz_webgl_cmd('depthRange', near, far); };
  proto.lineWidth = function(width) { __dz_webgl_cmd('lineWidth', width); };
  proto.polygonOffset = function(factor, units) { __dz_webgl_cmd('polygonOffset', factor, units); };
  proto.sampleCoverage = function(value, invert) { __dz_webgl_cmd('sampleCoverage', value, invert ? 1 : 0); };
  proto.hint = function(target, mode) { __dz_webgl_cmd('hint', target, mode); };
  // MRT typed clears (Three.js uses these for clearing individual color attachments)
  proto.clearBufferfv = function(buffer, drawbuffer, values) { __dz_webgl_cmd('clearBufferfv', buffer, drawbuffer); };
  proto.clearBufferiv = function(buffer, drawbuffer, values) { __dz_webgl_cmd('clearBufferiv', buffer, drawbuffer); };
  proto.clearBufferuiv = function(buffer, drawbuffer, values) { __dz_webgl_cmd('clearBufferuiv', buffer, drawbuffer); };
  proto.clearBufferfi = function(buffer, drawbuffer, depth, stencil) { __dz_webgl_cmd('clearBufferfi', buffer, drawbuffer, depth, stencil); };
  proto.readBuffer = function(src) { __dz_webgl_cmd('readBuffer', src); };

  // --- Framebuffer ---
  proto.createFramebuffer = function() { return __dz_webgl_cmd_ret('createFramebuffer'); };
  proto.bindFramebuffer = function(target, fb) { __dz_webgl_cmd('bindFramebuffer', target, fb || 0); };
  proto.framebufferTexture2D = function(target, attachment, textarget, tex, level) {
    __dz_webgl_cmd('framebufferTexture2D', target, attachment, textarget, tex, level);
  };
  proto.checkFramebufferStatus = function() { return GL.FRAMEBUFFER_COMPLETE; };
  proto.deleteFramebuffer = function(fb) { __dz_webgl_cmd('deleteFramebuffer', fb); };
  proto.createRenderbuffer = function() { return __dz_webgl_cmd_ret('createRenderbuffer'); };
  proto.bindRenderbuffer = function(target, rb) { __dz_webgl_cmd('bindRenderbuffer', target, rb || 0); };
  proto.renderbufferStorage = function(target, format, w, h) { __dz_webgl_cmd('renderbufferStorage', target, format, w, h); };
  proto.renderbufferStorageMultisample = function(target, samples, format, w, h) { __dz_webgl_cmd('renderbufferStorageMultisample', target, samples, format, w, h); };
  proto.framebufferRenderbuffer = function(target, attachment, rbtarget, rb) { __dz_webgl_cmd('framebufferRenderbuffer', target, attachment, rbtarget, rb); };
  proto.deleteRenderbuffer = function(rb) { __dz_webgl_cmd('deleteRenderbuffer', rb); };
  proto.getRenderbufferParameter = function() { return 0; };
  proto.getFramebufferAttachmentParameter = function() { return 0; };
  proto.readPixels = function(x, y, w, h, format, type, pixels) {
    // Readback is handled via native Rust read_pixels; JS readPixels is a no-op stub
  };
  proto.invalidateFramebuffer = function(target, attachments) {};
  proto.invalidateSubFramebuffer = function(target, attachments, x, y, w, h) {};
  proto.blitFramebuffer = function(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter) {};
  proto.framebufferTextureLayer = function(target, attachment, texture, level, layer) {};
  proto.getInternalformatParameter = function(target, internalformat, pname) {
    // Return common MSAA sample counts — Three.js queries this for renderbufferStorageMultisample
    return new Int32Array([4, 2, 1]);
  };

  // --- Active info / introspection ---
  proto.getActiveUniform = function(prog, index) {
    if (prog == null) return { size: 1, type: GL.FLOAT, name: 'u_unknown_' + index };
    var s = __dz_webgl_cmd_ret_str('getActiveUniform', prog, index);
    try { return s ? JSON.parse(s) : null; } catch(e) { return null; }
  };
  proto.getActiveAttrib = function(prog, index) {
    if (prog == null) return { size: 1, type: GL.FLOAT_VEC4, name: 'a_unknown_' + index };
    var s = __dz_webgl_cmd_ret_str('getActiveAttrib', prog, index);
    try { return s ? JSON.parse(s) : null; } catch(e) { return null; }
  };
  proto.getUniformBlockIndex = function(prog, name) { return 0; };
  proto.uniformBlockBinding = function(prog, blockIndex, blockBinding) { __dz_webgl_cmd('uniformBlockBinding', prog, blockIndex, blockBinding); };
  proto.getActiveUniformBlockParameter = function(prog, blockIndex, pname) { return 0; };
  proto.getActiveUniformBlockName = function(prog, blockIndex) { return ''; };
  proto.getUniformIndices = function(prog, uniformNames) {
    // Return sequential indices — real UBO layout requires actual shader reflection
    var result = new Uint32Array(uniformNames.length);
    for (var i = 0; i < uniformNames.length; i++) result[i] = i;
    return result;
  };
  proto.getActiveUniforms = function(prog, uniformIndices, pname) {
    var result = new Int32Array(uniformIndices.length);
    for (var i = 0; i < uniformIndices.length; i++) {
      switch (pname) {
        case GL.UNIFORM_TYPE: result[i] = GL.FLOAT; break;
        case GL.UNIFORM_SIZE: result[i] = 1; break;
        case GL.UNIFORM_OFFSET: result[i] = i * 16; break;
        case GL.UNIFORM_ARRAY_STRIDE: result[i] = 0; break;
        case GL.UNIFORM_MATRIX_STRIDE: result[i] = 0; break;
        case GL.UNIFORM_IS_ROW_MAJOR: result[i] = 0; break;
        case GL.UNIFORM_BLOCK_INDEX: result[i] = 0; break;
        default: result[i] = 0;
      }
    }
    return result;
  };
  proto.getFragDataLocation = function(prog, name) { return 0; };
  proto.getUniform = function(prog, loc) { return null; };
  proto.getIndexedParameter = function(target, index) { return null; };

  // --- is* type checks ---
  proto.isBuffer = function(buf) { return buf != null && typeof buf !== 'undefined'; };
  proto.isShader = function(shader) { return shader != null && typeof shader !== 'undefined'; };
  proto.isProgram = function(prog) { return prog != null && typeof prog !== 'undefined'; };
  proto.isTexture = function(tex) { return tex != null && typeof tex !== 'undefined'; };
  proto.isFramebuffer = function(fb) { return fb != null && typeof fb !== 'undefined'; };
  proto.isRenderbuffer = function(rb) { return rb != null && typeof rb !== 'undefined'; };
  proto.isVertexArray = function(vao) { return vao != null && typeof vao !== 'undefined'; };
  proto.isEnabled = function(cap) { return !!__dz_webgl_cmd_ret('isEnabled', cap); };

  // --- UBO support ---
  proto.bindBufferRange = function(target, index, buffer, offset, size) { __dz_webgl_cmd('bindBufferRange', target, index, buffer || 0, offset, size); };
  proto.bindBufferBase = function(target, index, buffer) { __dz_webgl_cmd('bindBufferBase', target, index, buffer || 0); };

  // --- Transform feedback ---
  proto.createTransformFeedback = function() { return __dz_webgl_cmd_ret('createTransformFeedback'); };
  proto.bindTransformFeedback = function(target, tf) { __dz_webgl_cmd('bindTransformFeedback', target, tf || 0); };
  proto.beginTransformFeedback = function(primitiveMode) { __dz_webgl_cmd('beginTransformFeedback', primitiveMode); };
  proto.endTransformFeedback = function() { __dz_webgl_cmd('endTransformFeedback'); };
  proto.transformFeedbackVaryings = function(prog, varyings, bufferMode) {};
  proto.getTransformFeedbackVarying = function(prog, index) { return null; };
  proto.deleteTransformFeedback = function(tf) { __dz_webgl_cmd('deleteTransformFeedback', tf); };
  proto.pauseTransformFeedback = function() {};
  proto.resumeTransformFeedback = function() {};
  proto.isTransformFeedback = function(tf) { return tf != null && typeof tf !== 'undefined'; };

  // --- Query objects ---
  proto.createQuery = function() { return __dz_webgl_cmd_ret('createQuery'); };
  proto.deleteQuery = function(q) { __dz_webgl_cmd('deleteQuery', q); };
  proto.beginQuery = function(target, q) { __dz_webgl_cmd('beginQuery', target, q); };
  proto.endQuery = function(target) { __dz_webgl_cmd('endQuery', target); };
  proto.getQuery = function(target, pname) { return null; };
  proto.getQueryParameter = function(q, pname) { return null; };
  proto.isQuery = function(q) { return q != null && typeof q !== 'undefined'; };

  // --- Sync objects ---
  proto.fenceSync = function(condition, flags) { return {}; };
  proto.clientWaitSync = function(sync, flags, timeout) { return GL.CONDITION_SATISFIED; };
  proto.waitSync = function(sync, flags, timeout) {};
  proto.deleteSync = function(sync) {};
  proto.isSync = function(sync) { return sync != null && typeof sync === 'object'; };
  proto.getSyncParameter = function(sync, pname) { return GL.SIGNALED || 0x9119; };

  // --- Sampler objects ---
  proto.createSampler = function() { return __dz_webgl_cmd_ret('createSampler'); };
  proto.deleteSampler = function(s) {};
  proto.bindSampler = function(unit, sampler) {};
  proto.samplerParameteri = function(sampler, pname, param) {};
  proto.samplerParameterf = function(sampler, pname, param) {};
  proto.getSamplerParameter = function(sampler, pname) { return 0; };
  proto.isSampler = function(s) { return s != null && typeof s !== 'undefined'; };

  // --- Query ---
  // Values reflect wgpu backend capabilities (conservative but sufficient for frameworks).
  proto.getParameter = function(pname) {
    switch (pname) {
      // Texture limits
      case GL.MAX_TEXTURE_SIZE: return 8192;
      case GL.MAX_CUBE_MAP_TEXTURE_SIZE: return 8192;
      case GL.MAX_RENDERBUFFER_SIZE: return 8192;
      case GL.MAX_3D_TEXTURE_SIZE: return 2048;
      case GL.MAX_ARRAY_TEXTURE_LAYERS: return 256;
      case GL.MAX_VIEWPORT_DIMS: return new Int32Array([8192, 8192]);
      // Texture units
      case GL.MAX_TEXTURE_IMAGE_UNITS: return 16;
      case GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS: return 16;
      case GL.MAX_COMBINED_TEXTURE_IMAGE_UNITS: return 32;
      // Vertex
      case GL.MAX_VERTEX_ATTRIBS: return 16;
      case GL.MAX_VERTEX_UNIFORM_VECTORS: return 256;
      case GL.MAX_FRAGMENT_UNIFORM_VECTORS: return 256;
      case GL.MAX_VARYING_VECTORS: return 16;
      // Draw buffers
      case GL.MAX_DRAW_BUFFERS: return 8;
      case GL.MAX_COLOR_ATTACHMENTS: return 8;
      case GL.MAX_SAMPLES: return 4;
      // Element limits
      case GL.MAX_ELEMENTS_VERTICES: return 65536;
      case GL.MAX_ELEMENTS_INDICES: return 65536;
      // UBO
      case GL.MAX_UNIFORM_BUFFER_BINDINGS: return 12;
      case GL.MAX_VERTEX_UNIFORM_BLOCKS: return 12;
      case GL.MAX_FRAGMENT_UNIFORM_BLOCKS: return 12;
      // Ranges
      case GL.ALIASED_LINE_WIDTH_RANGE: return new Float32Array([1, 1]);
      case GL.ALIASED_POINT_SIZE_RANGE: return new Float32Array([1, 256]);
      // Info strings
      case GL.RENDERER: return 'stage-runtime (wgpu)';
      case GL.VENDOR: return 'Dazzle';
      case GL.VERSION: return 'WebGL 2.0 (stage-runtime)';
      case GL.SHADING_LANGUAGE_VERSION: return 'WebGL GLSL ES 3.00 (stage-runtime)';
      default: return null;
    }
  };

  // Supported extensions — common ones that Three.js / Babylon.js check for.
  var _supportedExtensions = [
    'EXT_color_buffer_float',
    'EXT_float_blend',
    'OES_texture_float_linear',
    'EXT_texture_filter_anisotropic',
  ];
  var _extensionObjects = {};
  _extensionObjects['EXT_texture_filter_anisotropic'] = {
    TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE,
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF,
  };

  proto.getExtension = function(name) {
    if (_supportedExtensions.indexOf(name) !== -1) {
      return _extensionObjects[name] || {};
    }
    return null;
  };
  proto.getSupportedExtensions = function() { return _supportedExtensions.slice(); };
  proto.isContextLost = function() { return false; };
  proto.getContextAttributes = function() {
    return {
      alpha: true, antialias: false, depth: true, failIfMajorPerformanceCaveat: false,
      powerPreference: 'default', premultipliedAlpha: true, preserveDrawingBuffer: false, stencil: false,
      desynchronized: false
    };
  };
  proto.getError = function() {
    var e = __dz_webgl_errors;
    return e.length > 0 ? e.shift() : GL.NO_ERROR;
  };
  proto.flush = function() {};
  proto.finish = function() {};

  // Register as context factory
  globalThis.__dz_create_webgl2 = function(canvas) {
    return new WebGL2RenderingContext(canvas);
  };
})();
