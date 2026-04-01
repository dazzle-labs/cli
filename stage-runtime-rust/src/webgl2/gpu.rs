use std::collections::HashMap;
use log::{info, warn};
use wgpu;

use super::shader::BindingLayout;
use super::state::*;

/// Texture data to bind for a draw call.
pub struct TextureBinding {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
    pub min_filter: u32,
    pub mag_filter: u32,
    pub wrap_s: u32,
    pub wrap_t: u32,
}

/// Cast a slice of f32 to a byte slice (safe for uniform buffer uploads).
fn bytemuck_cast_slice(data: &[f32]) -> &[u8] {
    bytemuck::cast_slice(data)
}

/// WGSL shader for fullscreen quad clears (scissored color + depth).
const CLEAR_SHADER_WGSL: &str = "
struct ClearUniforms {
    color: vec4<f32>,
    depth: f32,
}

@group(0) @binding(0) var<uniform> u: ClearUniforms;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    // Fullscreen triangle (3 vertices cover the entire clip space)
    let x = f32(i32(vi & 1u)) * 4.0 - 1.0;
    let y = f32(i32(vi >> 1u)) * 4.0 - 1.0;
    var out: VsOut;
    out.pos = vec4<f32>(x, y, u.depth, 1.0);
    return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return u.color;
}
";

/// Key for the render pipeline cache, capturing all state that affects pipeline creation.
#[derive(Hash, PartialEq, Eq, Clone)]
struct PipelineKey {
    vs_hash: u64,
    fs_hash: u64,
    // Vertex layout
    attrib_formats: Vec<(u32, wgpu::VertexFormat, u64, u64)>, // (location, format, stride, offset)
    // Blend state
    blend_enabled: bool,
    blend_src_rgb: u32,
    blend_dst_rgb: u32,
    blend_src_alpha: u32,
    blend_dst_alpha: u32,
    blend_equation_rgb: u32,
    blend_equation_alpha: u32,
    // Depth
    depth_test: bool,
    depth_mask: bool,
    depth_func: u32,
    // Polygon offset
    polygon_offset_fill: bool,
    polygon_offset_factor: i32, // f32 bits as i32 for Hash/Eq
    polygon_offset_units: i32,
    // Cull
    cull_enabled: bool,
    cull_mode: u32,
    front_face: u32,
    // Color mask
    color_mask: [bool; 4],
    // Topology
    mode: u32,
    // Bind group layout structure
    vs_has_uniforms: bool,
    fs_has_uniforms: bool,
    texture_count: usize,
}

/// Cached pipeline with its bind group layouts.
struct CachedPipeline {
    pipeline: wgpu::RenderPipeline,
    vs_bgl: wgpu::BindGroupLayout,
    fs_bgl: wgpu::BindGroupLayout,
}

/// wgpu-backed rendering for WebGL2.
pub struct GpuBackend {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    /// Render target (RGBA8Unorm)
    color_texture: wgpu::Texture,
    color_view: wgpu::TextureView,
    /// Depth buffer (Depth32Float) — _depth_texture kept alive for depth_view
    _depth_texture: wgpu::Texture,
    depth_view: wgpu::TextureView,
    /// Double-buffered staging for async readback. Read from the buffer that
    /// was copied to last frame (already mapped), submit a new copy to the other.
    staging_buffers: [wgpu::Buffer; 2],
    staging_read_idx: usize,
    has_pending_readback: bool,
    pub width: u32,
    pub height: u32,
    /// Cached shader modules by WGSL source hash
    shader_cache: HashMap<String, wgpu::ShaderModule>,
    /// Pipeline + bind group layout for scissored clears
    clear_pipeline: Option<(wgpu::RenderPipeline, wgpu::BindGroupLayout)>,
    /// Cached render pipelines keyed by full state
    pipeline_cache: HashMap<PipelineKey, CachedPipeline>,
    /// Accumulated command buffers — flushed in a single queue.submit() on readback.
    pending_commands: Vec<wgpu::CommandBuffer>,
}

impl GpuBackend {
    /// Create a new headless wgpu backend.
    pub fn new(width: u32, height: u32) -> Option<Self> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            flags: wgpu::InstanceFlags::default(),
            backend_options: wgpu::BackendOptions::default(),
            memory_budget_thresholds: wgpu::MemoryBudgetThresholds::default(),
            display: None,
        });

        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::LowPower,
            compatible_surface: None,
            force_fallback_adapter: false,
        }));
        let adapter = match adapter {
            Ok(a) => a,
            Err(e) => {
                warn!("wgpu: no adapter available: {}", e);
                return None;
            }
        };

        let adapter_info = adapter.get_info();
        info!("wgpu adapter: {} ({:?}, {:?})", adapter_info.name, adapter_info.backend, adapter_info.device_type);

        let (device, queue) = pollster::block_on(adapter.request_device(
            &wgpu::DeviceDescriptor {
                label: Some("stage-runtime"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_defaults(),
                memory_hints: wgpu::MemoryHints::default(),
                trace: wgpu::Trace::Off,
                experimental_features: wgpu::ExperimentalFeatures::default(),
            },
        )).ok()?;

        let color_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("color_target"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let color_view = color_texture.create_view(&wgpu::TextureViewDescriptor::default());

        let depth_texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("depth_target"),
            size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let depth_view = depth_texture.create_view(&wgpu::TextureViewDescriptor::default());

        // Double-buffered staging for pixel readback (use u64 to avoid overflow)
        let bytes_per_row = Self::padded_bytes_per_row(width);
        let buf_size = bytes_per_row as u64 * height as u64;
        let staging_buffers = [
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("staging_0"),
                size: buf_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }),
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("staging_1"),
                size: buf_size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }),
        ];

        Some(GpuBackend {
            device,
            queue,
            color_texture,
            color_view,
            _depth_texture: depth_texture,
            depth_view,
            staging_buffers,
            staging_read_idx: 0,
            has_pending_readback: false,
            width,
            height,
            shader_cache: HashMap::new(),
            clear_pipeline: None,
            pipeline_cache: HashMap::new(),
            pending_commands: Vec::new(),
        })
    }

    /// wgpu requires rows to be aligned to 256 bytes.
    fn padded_bytes_per_row(width: u32) -> u32 {
        // Use u64 to avoid overflow on large widths, then truncate (wgpu will reject huge values)
        let unpadded = width as u64 * 4;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as u64;
        ((unpadded + align - 1) / align * align) as u32
    }

    /// Accessor for the render target texture (needed by NV12 compute converter).
    pub fn color_texture(&self) -> &wgpu::Texture {
        &self.color_texture
    }

    /// Maximum pending command buffers before forcing a flush.
    const MAX_PENDING_COMMANDS: usize = 1024;

    /// Drain accumulated draw/clear command buffers (for external submission).
    pub fn take_pending_commands(&mut self) -> Vec<wgpu::CommandBuffer> {
        self.pending_commands.drain(..).collect()
    }

    /// Push a command buffer, flushing to GPU if too many are pending.
    fn push_command(&mut self, cmd: wgpu::CommandBuffer) {
        self.pending_commands.push(cmd);
        if self.pending_commands.len() >= Self::MAX_PENDING_COMMANDS {
            let cmds: Vec<_> = self.pending_commands.drain(..).collect();
            self.queue.submit(cmds);
        }
    }

    /// Lazily create the clear pipeline (fullscreen quad with uniform color + depth).
    fn ensure_clear_pipeline(&mut self) {
        if self.clear_pipeline.is_some() { return; }

        let shader = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("clear_shader"),
            source: wgpu::ShaderSource::Wgsl(CLEAR_SHADER_WGSL.into()),
        });

        let bind_group_layout = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("clear_bgl"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });

        let pipeline_layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("clear_pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("clear_pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        self.clear_pipeline = Some((pipeline, bind_group_layout));
    }

    /// Clear the render target with the given color and depth.
    /// If scissor is Some, only clears within the scissor rect [x, y, w, h] (WebGL coords, y=0 at bottom).
    /// Full-frame clears use LoadOp::Clear. Scissored clears draw a fullscreen quad with set_scissor_rect.
    pub fn clear(&mut self, color: [f32; 4], depth: f64, clear_color: bool, clear_depth: bool, scissor: Option<[i32; 4]>) {
        if let Some([sx, sy, sw, sh]) = scissor {
            // Scissored clear via fullscreen quad pipeline + set_scissor_rect
            self.ensure_clear_pipeline();
            let (pipeline, bgl) = self.clear_pipeline.as_ref().unwrap();

            let fb_w = self.width as i32;
            let fb_h = self.height as i32;
            let x0 = sx.max(0).min(fb_w) as u32;
            let x1 = (sx + sw).max(0).min(fb_w) as u32;
            // Flip Y: WebGL y=0 is bottom, texture y=0 is top
            let y0 = (fb_h - sy - sh).max(0).min(fb_h) as u32;
            let y1 = (fb_h - sy).max(0).min(fb_h) as u32;
            let region_w = x1.saturating_sub(x0);
            let region_h = y1.saturating_sub(y0);

            if region_w == 0 || region_h == 0 { return; }

            // Uniform buffer: vec4<f32> color + f32 depth (padded to 32 bytes for alignment)
            let uniform_data: [f32; 8] = [
                color[0], color[1], color[2], color[3],
                depth as f32, 0.0, 0.0, 0.0,
            ];
            let uniform_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("clear_uniform"),
                size: 32,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.queue.write_buffer(&uniform_buf, 0, bytemuck_cast_slice(&uniform_data));

            let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("clear_bg"),
                layout: bgl,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buf.as_entire_binding(),
                }],
            });

            let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("clear_scissor"),
            });

            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("clear_scissor_pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &self.color_view,
                        depth_slice: None,
                        resolve_target: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &self.depth_view,
                        depth_ops: Some(wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        }),
                        stencil_ops: None,
                    }),
                    timestamp_writes: None,
                    occlusion_query_set: None,
                    multiview_mask: None,
                });

                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.set_scissor_rect(x0, y0, region_w, region_h);
                pass.draw(0..3, 0..1);
            }

            self.push_command(encoder.finish());
            return;
        }

        // Full-frame clear via render pass LoadOp::Clear
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("clear"),
        });

        {
            let _pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("clear_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: if clear_color {
                            wgpu::LoadOp::Clear(wgpu::Color {
                                r: color[0] as f64,
                                g: color[1] as f64,
                                b: color[2] as f64,
                                a: color[3] as f64,
                            })
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: if clear_depth {
                            wgpu::LoadOp::Clear(depth as f32)
                        } else {
                            wgpu::LoadOp::Load
                        },
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
        }

        self.push_command(encoder.finish());
    }

    /// Read pixels using double-buffered async readback.
    ///
    /// Reads from the staging buffer that was copied to on the *previous* call
    /// (already mapped, no GPU stall), then kicks off a new copy to the other
    /// buffer for next time. First call falls back to synchronous readback.
    pub fn read_pixels_into(&mut self, output: &mut [u8]) {
        let padded_bpr = Self::padded_bytes_per_row(self.width);
        let unpadded_bpr = (self.width * 4) as usize;
        if self.has_pending_readback {
            // Read from the staging buffer that was copied to last frame (already submitted).
            let read_buf = &self.staging_buffers[self.staging_read_idx];
            let buffer_slice = read_buf.slice(..);
            let (tx, rx) = std::sync::mpsc::channel();
            buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
                tx.send(result).unwrap();
            });

            // Fast poll loop: avoids wgpu Metal backend's 1ms sleep in poll(Wait).
            // At 30fps the previous frame completed long ago — first poll succeeds (58ns).
            // In benchmarks, spins ~250µs. Bounded to 5ms to avoid pegging CPU on GPU stall.
            let deadline = std::time::Instant::now() + std::time::Duration::from_millis(5);
            loop {
                let _ = self.device.poll(wgpu::PollType::Poll);
                if rx.try_recv().is_ok() { break; }
                if std::time::Instant::now() >= deadline {
                    // GPU stall or unusually long frame — fall back to blocking poll
                    let _ = self.device.poll(wgpu::PollType::Wait {
                        submission_index: None, timeout: None,
                    });
                    if let Ok(Ok(())) = rx.recv() {
                        break;
                    } else {
                        warn!("GPU readback failed (device lost?) — returning blank frame");
                        return;
                    }
                }
                std::hint::spin_loop();
            }

            let data = buffer_slice.get_mapped_range();
            Self::copy_rows(&data, output, padded_bpr as usize, unpadded_bpr, self.height as usize);
            drop(data);
            read_buf.unmap();
        } else {
            // First call — flush pending draws + synchronous readback
            self.flush_with_copy(self.staging_read_idx, padded_bpr);

            let buf = &self.staging_buffers[self.staging_read_idx];
            let buffer_slice = buf.slice(..);
            let (tx, rx) = std::sync::mpsc::channel();
            buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
                let _ = tx.send(result);
            });
            let _ = self.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None });
            if rx.recv().ok().and_then(|r| r.ok()).is_none() {
                warn!("GPU readback failed (device lost?) — returning blank frame");
                return;
            }

            let data = buffer_slice.get_mapped_range();
            Self::copy_rows(&data, output, padded_bpr as usize, unpadded_bpr, self.height as usize);
            drop(data);
            buf.unmap();
        }

        // Flush all pending draw/clear commands + copy current frame to the
        // other staging buffer — all in a single queue.submit().
        let write_idx = 1 - self.staging_read_idx;
        self.flush_with_copy(write_idx, padded_bpr);
        self.staging_read_idx = write_idx;
        self.has_pending_readback = true;
    }

    /// Copy mapped GPU buffer to output, stripping row padding if needed.
    #[inline]
    fn copy_rows(src: &[u8], dst: &mut [u8], padded_bpr: usize, unpadded_bpr: usize, height: usize) {
        // Only copy rows that fit in the output buffer
        let max_rows = dst.len() / unpadded_bpr;
        let rows = height.min(max_rows);
        if rows == 0 { return; }

        if padded_bpr == unpadded_bpr {
            let total = unpadded_bpr * rows;
            dst[..total].copy_from_slice(&src[..total]);
        } else {
            for row in 0..rows {
                let src_offset = row * padded_bpr;
                let dst_offset = row * unpadded_bpr;
                dst[dst_offset..dst_offset + unpadded_bpr]
                    .copy_from_slice(&src[src_offset..src_offset + unpadded_bpr]);
            }
        }
    }

    /// Flush all accumulated draw/clear commands + a readback copy in one submit.
    fn flush_with_copy(&mut self, buf_idx: usize, padded_bpr: u32) {
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("readback_copy"),
        });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &self.color_texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &self.staging_buffers[buf_idx],
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bpr),
                    rows_per_image: Some(self.height),
                },
            },
            wgpu::Extent3d {
                width: self.width,
                height: self.height,
                depth_or_array_layers: 1,
            },
        );
        // Drain all pending draw/clear commands, append the readback copy — single submit.
        let mut cmds: Vec<wgpu::CommandBuffer> = self.pending_commands.drain(..).collect();
        cmds.push(encoder.finish());
        self.queue.submit(cmds);
    }

    /// Map GL blend equation to wgpu.
    pub fn map_blend_operation(gl_eq: u32) -> wgpu::BlendOperation {
        match gl_eq {
            0x8006 => wgpu::BlendOperation::Add,              // GL_FUNC_ADD
            0x800A => wgpu::BlendOperation::Subtract,          // GL_FUNC_SUBTRACT
            0x800B => wgpu::BlendOperation::ReverseSubtract,   // GL_FUNC_REVERSE_SUBTRACT
            0x8007 => wgpu::BlendOperation::Min,               // GL_MIN
            0x8008 => wgpu::BlendOperation::Max,               // GL_MAX
            _ => wgpu::BlendOperation::Add,
        }
    }

    /// Map GL blend factor to wgpu.
    pub fn map_blend_factor(gl_factor: u32) -> wgpu::BlendFactor {
        match gl_factor {
            0 => wgpu::BlendFactor::Zero,           // GL_ZERO
            1 => wgpu::BlendFactor::One,             // GL_ONE
            0x0300 => wgpu::BlendFactor::Src,        // GL_SRC_COLOR
            0x0301 => wgpu::BlendFactor::OneMinusSrc, // GL_ONE_MINUS_SRC_COLOR
            0x0302 => wgpu::BlendFactor::SrcAlpha,   // GL_SRC_ALPHA
            0x0303 => wgpu::BlendFactor::OneMinusSrcAlpha, // GL_ONE_MINUS_SRC_ALPHA
            0x0304 => wgpu::BlendFactor::DstAlpha,   // GL_DST_ALPHA
            0x0305 => wgpu::BlendFactor::OneMinusDstAlpha, // GL_ONE_MINUS_DST_ALPHA
            0x0306 => wgpu::BlendFactor::Dst,        // GL_DST_COLOR
            0x0307 => wgpu::BlendFactor::OneMinusDst, // GL_ONE_MINUS_DST_COLOR
            0x0308 => wgpu::BlendFactor::SrcAlphaSaturated, // GL_SRC_ALPHA_SATURATE
            0x8001 => wgpu::BlendFactor::Constant,    // GL_CONSTANT_COLOR
            0x8002 => wgpu::BlendFactor::OneMinusConstant, // GL_ONE_MINUS_CONSTANT_COLOR
            0x8003 => wgpu::BlendFactor::Constant,    // GL_CONSTANT_ALPHA (approx)
            0x8004 => wgpu::BlendFactor::OneMinusConstant, // GL_ONE_MINUS_CONSTANT_ALPHA (approx)
            _ => wgpu::BlendFactor::One,
        }
    }

    /// Map GL depth function to wgpu.
    pub fn map_compare_function(gl_func: u32) -> wgpu::CompareFunction {
        match gl_func {
            0x0200 => wgpu::CompareFunction::Never,
            0x0201 => wgpu::CompareFunction::Less,
            0x0202 => wgpu::CompareFunction::Equal,
            0x0203 => wgpu::CompareFunction::LessEqual,
            0x0204 => wgpu::CompareFunction::Greater,
            0x0205 => wgpu::CompareFunction::NotEqual,
            0x0206 => wgpu::CompareFunction::GreaterEqual,
            0x0207 => wgpu::CompareFunction::Always,
            _ => wgpu::CompareFunction::Less,
        }
    }

    /// Map GL cull mode to wgpu.
    pub fn map_cull_mode(gl_mode: u32) -> Option<wgpu::Face> {
        match gl_mode {
            0x0404 => Some(wgpu::Face::Front),  // GL_FRONT
            0x0405 => Some(wgpu::Face::Back),    // GL_BACK
            _ => None,
        }
    }

    /// Map GL front face to wgpu.
    pub fn map_front_face(gl_face: u32) -> wgpu::FrontFace {
        match gl_face {
            0x0900 => wgpu::FrontFace::Cw,   // GL_CW
            _ => wgpu::FrontFace::Ccw,         // GL_CCW (default)
        }
    }

    /// Map GL primitive topology to wgpu.
    pub fn map_topology(gl_mode: u32) -> wgpu::PrimitiveTopology {
        match gl_mode {
            0 => wgpu::PrimitiveTopology::PointList,    // GL_POINTS
            1 => wgpu::PrimitiveTopology::LineList,      // GL_LINES
            2 => wgpu::PrimitiveTopology::LineList,      // GL_LINE_LOOP (expanded by caller)
            3 => wgpu::PrimitiveTopology::LineStrip,     // GL_LINE_STRIP
            5 => wgpu::PrimitiveTopology::TriangleStrip, // GL_TRIANGLE_STRIP
            _ => wgpu::PrimitiveTopology::TriangleList,  // GL_TRIANGLES, GL_TRIANGLE_FAN (fan expanded by caller)
        }
    }

    /// Map GL vertex attribute type to wgpu vertex format.
    fn map_vertex_format(size: u32, dtype: u32, _normalized: bool) -> wgpu::VertexFormat {
        match (dtype, size) {
            (0x1406, 1) => wgpu::VertexFormat::Float32,     // GL_FLOAT, 1 component
            (0x1406, 2) => wgpu::VertexFormat::Float32x2,   // GL_FLOAT, 2 components
            (0x1406, 3) => wgpu::VertexFormat::Float32x3,   // GL_FLOAT, 3 components
            (0x1406, 4) => wgpu::VertexFormat::Float32x4,   // GL_FLOAT, 4 components
            _ => wgpu::VertexFormat::Float32x4,              // fallback
        }
    }

    /// Get byte size of a vertex format.
    fn vertex_format_size(fmt: wgpu::VertexFormat) -> u64 {
        match fmt {
            wgpu::VertexFormat::Float32 => 4,
            wgpu::VertexFormat::Float32x2 => 8,
            wgpu::VertexFormat::Float32x3 => 12,
            wgpu::VertexFormat::Float32x4 => 16,
            _ => 16,
        }
    }

    /// Hash a string using DefaultHasher.
    fn hash_str(s: &str) -> u64 {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        s.hash(&mut hasher);
        hasher.finish()
    }

    /// Get or create a cached shader module from WGSL source.
    fn get_or_create_shader_module(&mut self, wgsl: &str) -> wgpu::ShaderModule {
        if let Some(module) = self.shader_cache.get(wgsl) {
            return module.clone();
        }

        let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("cached_shader"),
            source: wgpu::ShaderSource::Wgsl(wgsl.into()),
        });
        // Evict 25% of oldest entries to prevent unbounded GPU memory growth from adversarial content
        if self.shader_cache.len() >= 256 {
            let to_remove = (256 / 4).max(1);
            let mut keys: Vec<_> = self.shader_cache.keys().cloned().collect();
            keys.sort();
            for k in keys.into_iter().take(to_remove) { self.shader_cache.remove(&k); }
        }
        self.shader_cache.insert(wgsl.to_string(), module.clone());
        module
    }

    /// Draw geometry using the GPU pipeline.
    ///
    /// Parameters:
    /// - `merged_wgsl`: The merged WGSL shader module source
    /// - `attribs`: Enabled vertex attributes (location, size, dtype, normalized, stride, offset, buffer_data)
    /// - `index_data`: Optional index buffer data (indices as u32)
    /// - `uniforms`: Map of (name → UniformValue) for the current program
    /// - `uniform_locations`: Map of (name → location) from the program
    /// - `textures`: Bound texture data for sampler uniforms
    /// - `state`: Current GL state for blend/depth/cull/scissor/viewport/color_mask
    /// - `mode`: GL draw mode (GL_TRIANGLES, etc.)
    /// - `count`: Number of vertices or indices to draw
    /// - `first`: First vertex (for drawArrays)
    pub fn draw(
        &mut self,
        vertex_wgsl: &str,
        fragment_wgsl: &str,
        attribs: &[(u32, u32, u32, bool, u32, u32, Vec<u8>)], // (location, size, dtype, normalized, stride, offset, buffer_data)
        index_data: Option<&[u32]>,
        uniforms: &HashMap<String, UniformValue>,
        textures: &[TextureBinding],
        vs_binding_layout: &BindingLayout,
        fs_binding_layout: &BindingLayout,
        state: &DrawState,
        mode: u32,
        count: u32,
        first: u32,
        instance_count: u32,
    ) {
        // 1. Build pipeline key for cache lookup
        let vs_hash = Self::hash_str(vertex_wgsl);
        let fs_hash = Self::hash_str(fragment_wgsl);

        let attrib_formats: Vec<(u32, wgpu::VertexFormat, u64, u64)> = attribs.iter().map(|(loc, size, dtype, norm, stride, offset, _)| {
            let fmt = Self::map_vertex_format(*size, *dtype, *norm);
            let byte_stride = if *stride > 0 { *stride as u64 } else { Self::vertex_format_size(fmt) };
            (*loc, fmt, byte_stride, *offset as u64)
        }).collect();

        let pipeline_key = PipelineKey {
            vs_hash,
            fs_hash,
            attrib_formats: attrib_formats.clone(),
            blend_enabled: state.blend_enabled,
            blend_src_rgb: state.blend_src_rgb,
            blend_dst_rgb: state.blend_dst_rgb,
            blend_src_alpha: state.blend_src_alpha,
            blend_dst_alpha: state.blend_dst_alpha,
            blend_equation_rgb: state.blend_equation_rgb,
            blend_equation_alpha: state.blend_equation_alpha,
            depth_test: state.depth_test_enabled,
            depth_mask: state.depth_mask,
            depth_func: state.depth_func,
            polygon_offset_fill: state.polygon_offset_fill_enabled,
            polygon_offset_factor: state.polygon_offset_factor.to_bits() as i32,
            polygon_offset_units: state.polygon_offset_units.to_bits() as i32,
            cull_enabled: state.cull_face_enabled,
            cull_mode: state.cull_face_mode,
            front_face: state.front_face,
            color_mask: state.color_mask,
            mode,
            vs_has_uniforms: vs_binding_layout.uniform_binding.is_some(),
            fs_has_uniforms: fs_binding_layout.uniform_binding.is_some(),
            texture_count: fs_binding_layout.texture_bindings.len(),
        };

        // 2. Create or retrieve cached pipeline + bind group layouts
        if !self.pipeline_cache.contains_key(&pipeline_key) {
            let vs_module = self.get_or_create_shader_module(vertex_wgsl);
            let fs_module = self.get_or_create_shader_module(fragment_wgsl);

            // Build vertex buffer layouts
            let vertex_attributes: Vec<Vec<wgpu::VertexAttribute>> = attrib_formats.iter().map(|(loc, fmt, _, off)| {
                vec![wgpu::VertexAttribute { format: *fmt, offset: *off, shader_location: *loc }]
            }).collect();
            let strides: Vec<u64> = attrib_formats.iter().map(|(_, _, s, _)| *s).collect();
            let vertex_buffer_layouts: Vec<wgpu::VertexBufferLayout> = vertex_attributes.iter().enumerate().map(|(i, attrs)| {
                wgpu::VertexBufferLayout { array_stride: strides[i], step_mode: wgpu::VertexStepMode::Vertex, attributes: attrs }
            }).collect();

            // Build bind group layouts (without data)
            let vs_bgl = self.build_bind_group_layout(&[], vs_binding_layout, pipeline_key.vs_has_uniforms);
            let fs_bgl = self.build_bind_group_layout(&fs_binding_layout.texture_bindings, fs_binding_layout, pipeline_key.fs_has_uniforms);

            let pipeline_layout = self.device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("draw_pl"),
                bind_group_layouts: &[Some(&vs_bgl), Some(&fs_bgl)],
                immediate_size: 0,
            });

            let blend = if state.blend_enabled {
                Some(wgpu::BlendState {
                    color: wgpu::BlendComponent {
                        src_factor: Self::map_blend_factor(state.blend_src_rgb),
                        dst_factor: Self::map_blend_factor(state.blend_dst_rgb),
                        operation: Self::map_blend_operation(state.blend_equation_rgb),
                    },
                    alpha: wgpu::BlendComponent {
                        src_factor: Self::map_blend_factor(state.blend_src_alpha),
                        dst_factor: Self::map_blend_factor(state.blend_dst_alpha),
                        operation: Self::map_blend_operation(state.blend_equation_alpha),
                    },
                })
            } else {
                None
            };

            let depth_bias = if state.polygon_offset_fill_enabled {
                wgpu::DepthBiasState {
                    constant: state.polygon_offset_units as i32,
                    slope_scale: state.polygon_offset_factor,
                    clamp: 0.0,
                }
            } else {
                wgpu::DepthBiasState::default()
            };

            let depth_stencil = Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(state.depth_mask),
                depth_compare: if state.depth_test_enabled {
                    Some(Self::map_compare_function(state.depth_func))
                } else {
                    Some(wgpu::CompareFunction::Always)
                },
                stencil: wgpu::StencilState::default(),
                bias: depth_bias,
            });

            let mut write_mask = wgpu::ColorWrites::empty();
            if state.color_mask[0] { write_mask |= wgpu::ColorWrites::RED; }
            if state.color_mask[1] { write_mask |= wgpu::ColorWrites::GREEN; }
            if state.color_mask[2] { write_mask |= wgpu::ColorWrites::BLUE; }
            if state.color_mask[3] { write_mask |= wgpu::ColorWrites::ALPHA; }

            let cull_mode = if state.cull_face_enabled {
                Self::map_cull_mode(state.cull_face_mode)
            } else {
                None
            };

            let topology = Self::map_topology(mode);

            let pipeline = self.device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("draw_pipeline"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &vs_module,
                    entry_point: Some("main"),
                    buffers: &vertex_buffer_layouts,
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &fs_module,
                    entry_point: Some("main"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: wgpu::TextureFormat::Rgba8Unorm,
                        blend,
                        write_mask,
                    })],
                    compilation_options: wgpu::PipelineCompilationOptions::default(),
                }),
                primitive: wgpu::PrimitiveState {
                    topology,
                    front_face: Self::map_front_face(state.front_face),
                    cull_mode,
                    strip_index_format: if topology == wgpu::PrimitiveTopology::TriangleStrip
                        || topology == wgpu::PrimitiveTopology::LineStrip
                    {
                        Some(wgpu::IndexFormat::Uint32)
                    } else {
                        None
                    },
                    ..Default::default()
                },
                depth_stencil,
                multisample: wgpu::MultisampleState::default(),
                multiview_mask: None,
                cache: None,
            });

            // Evict 25% of oldest entries to prevent unbounded GPU memory growth
            if self.pipeline_cache.len() >= 512 {
                let to_remove = (512 / 4).max(1);
                let mut keys: Vec<_> = self.pipeline_cache.keys().cloned().collect();
                keys.sort_by_key(|k| (k.vs_hash, k.fs_hash));
                for k in keys.into_iter().take(to_remove) { self.pipeline_cache.remove(&k); }
            }
            self.pipeline_cache.insert(pipeline_key.clone(), CachedPipeline { pipeline, vs_bgl, fs_bgl });
        }

        let cached = self.pipeline_cache.get(&pipeline_key).unwrap();
        let pipeline = &cached.pipeline;

        // 3. Create vertex buffers (data changes per draw, can't cache)
        let mut vertex_buffers: Vec<wgpu::Buffer> = Vec::new();
        for (_location, _size, _dtype, _normalized, _stride, _offset, data) in attribs.iter() {
            let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("vertex_buf"),
                size: data.len() as u64,
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.queue.write_buffer(&buf, 0, data);
            vertex_buffers.push(buf);
        }

        // 4. Build bind groups using cached layouts
        let vs_bg = self.build_bind_group_with_layout(&cached.vs_bgl, uniforms, &[], vs_binding_layout);
        let fs_bg = self.build_bind_group_with_layout(&cached.fs_bgl, uniforms, textures, fs_binding_layout);

        // 10. Create index buffer if needed
        let index_buffer = index_data.map(|indices| {
            let bytes: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
            let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("index_buf"),
                size: bytes.len() as u64,
                usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.queue.write_buffer(&buf, 0, &bytes);
            buf
        });

        // 11. Encode render pass
        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("draw"),
        });

        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("draw_pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.color_view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });

            pass.set_pipeline(&pipeline);
            pass.set_bind_group(0, &vs_bg, &[]);
            pass.set_bind_group(1, &fs_bg, &[]);

            // Set vertex buffers
            for (i, buf) in vertex_buffers.iter().enumerate() {
                pass.set_vertex_buffer(i as u32, buf.slice(..));
            }

            // Set viewport (WebGL y=0 is bottom, wgpu y=0 is top)
            let vp = &state.viewport;
            let flipped_y = self.height as f32 - vp[1] as f32 - vp[3] as f32;
            pass.set_viewport(vp[0] as f32, flipped_y, vp[2] as f32, vp[3] as f32, 0.0, 1.0);

            // Set scissor rect if enabled
            if state.scissor_test_enabled {
                let sc = &state.scissor;
                let sc_y = self.height as i32 - sc[1] - sc[3];
                pass.set_scissor_rect(
                    sc[0].max(0) as u32,
                    sc_y.max(0) as u32,
                    sc[2].max(0) as u32,
                    sc[3].max(0) as u32,
                );
            }

            // Draw
            if let Some(ref idx_buf) = index_buffer {
                pass.set_index_buffer(idx_buf.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..count, 0, 0..instance_count);
            } else {
                pass.draw(first..first + count, 0..instance_count);
            }
        }

        self.push_command(encoder.finish());
    }

    /// Build just a bind group layout (no data) for pipeline caching.
    fn build_bind_group_layout(
        &self,
        texture_bindings: &[(u32, u32, String)],
        binding_layout: &BindingLayout,
        has_uniforms: bool,
    ) -> wgpu::BindGroupLayout {
        let has_textures = !texture_bindings.is_empty();
        if !has_textures && !has_uniforms {
            return self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("empty_bgl"),
                entries: &[],
            });
        }

        let mut entries: Vec<wgpu::BindGroupLayoutEntry> = Vec::new();
        for (tex_binding, sampler_binding, _name) in texture_bindings {
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: *tex_binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            });
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: *sampler_binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            });
        }
        if has_uniforms {
            entries.push(wgpu::BindGroupLayoutEntry {
                binding: binding_layout.uniform_binding.unwrap(),
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            });
        }
        self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("cached_bgl"),
            entries: &entries,
        })
    }

    /// Build a bind group using an existing layout + data.
    fn build_bind_group_with_layout(
        &self,
        layout: &wgpu::BindGroupLayout,
        uniforms: &HashMap<String, UniformValue>,
        textures: &[TextureBinding],
        binding_layout: &BindingLayout,
    ) -> wgpu::BindGroup {
        let has_textures = !binding_layout.texture_bindings.is_empty();
        let has_uniforms = binding_layout.uniform_binding.is_some();

        if !has_textures && !has_uniforms {
            return self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("empty_bg"), layout, entries: &[],
            });
        }

        let mut gpu_textures: Vec<wgpu::Texture> = Vec::new();
        let mut gpu_texture_views: Vec<wgpu::TextureView> = Vec::new();
        let mut gpu_samplers: Vec<wgpu::Sampler> = Vec::new();

        for (i, (_tex_binding, _sampler_binding, _name)) in binding_layout.texture_bindings.iter().enumerate() {
            if i < textures.len() {
                let tex_data = &textures[i];
                let size = wgpu::Extent3d {
                    width: tex_data.width.max(1), height: tex_data.height.max(1), depth_or_array_layers: 1,
                };
                let gpu_tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("draw_texture"), size, mip_level_count: 1, sample_count: 1,
                    dimension: wgpu::TextureDimension::D2, format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST, view_formats: &[],
                });
                let expected_bytes = (4u64 * tex_data.width as u64 * tex_data.height as u64) as usize;
                if tex_data.data.len() < expected_bytes {
                    // Skip this texture — data buffer is undersized
                    continue;
                }
                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo { texture: &gpu_tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
                    &tex_data.data[..expected_bytes],
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(4 * tex_data.width), rows_per_image: Some(tex_data.height) },
                    size,
                );
                let view = gpu_tex.create_view(&wgpu::TextureViewDescriptor::default());
                gpu_textures.push(gpu_tex);
                gpu_texture_views.push(view);
                let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
                    label: Some("draw_sampler"),
                    address_mode_u: Self::map_wrap_mode(tex_data.wrap_s),
                    address_mode_v: Self::map_wrap_mode(tex_data.wrap_t),
                    mag_filter: Self::map_filter_mode(tex_data.mag_filter),
                    min_filter: Self::map_filter_mode(tex_data.min_filter),
                    ..Default::default()
                });
                gpu_samplers.push(sampler);
            }
        }

        let mut uniform_buf: Option<wgpu::Buffer> = None;
        if has_uniforms {
            let mut data = Self::pack_uniforms(uniforms, &binding_layout.uniform_names);
            // wgpu requires uniform buffers to be at least 16 bytes (vec4 aligned).
            // If the shader declares uniforms but none are set, provide a zero-filled buffer.
            if data.is_empty() {
                data = vec![0.0f32; 4];
            }
            let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("uniform_buf"), size: (data.len() * 4) as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
            });
            self.queue.write_buffer(&buf, 0, bytemuck_cast_slice(&data));
            uniform_buf = Some(buf);
        }

        let mut bg_entries: Vec<wgpu::BindGroupEntry> = Vec::new();
        for (i, (tex_binding, sampler_binding, _name)) in binding_layout.texture_bindings.iter().enumerate() {
            if i < gpu_texture_views.len() {
                bg_entries.push(wgpu::BindGroupEntry { binding: *tex_binding, resource: wgpu::BindingResource::TextureView(&gpu_texture_views[i]) });
                bg_entries.push(wgpu::BindGroupEntry { binding: *sampler_binding, resource: wgpu::BindingResource::Sampler(&gpu_samplers[i]) });
            }
        }
        if let Some(ref buf) = uniform_buf {
            bg_entries.push(wgpu::BindGroupEntry { binding: binding_layout.uniform_binding.unwrap(), resource: buf.as_entire_binding() });
        }

        self.device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("draw_bg"), layout, entries: &bg_entries })
    }

    /// Build a bind group matching the shader's binding layout.
    /// Handles textures, samplers, and uniform buffers at their correct binding indices.
    #[allow(dead_code)]
    fn build_bind_group(
        &self,
        uniforms: &HashMap<String, UniformValue>,
        textures: &[TextureBinding],
        binding_layout: &BindingLayout,
    ) -> (wgpu::BindGroupLayout, wgpu::BindGroup) {
        let has_textures = !binding_layout.texture_bindings.is_empty();
        let has_uniforms = binding_layout.uniform_binding.is_some() && !uniforms.is_empty();

        if !has_textures && !has_uniforms {
            let layout = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("empty_bgl"),
                entries: &[],
            });
            let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("empty_bg"),
                layout: &layout,
                entries: &[],
            });
            return (layout, group);
        }

        // Build layout entries and bind group entries
        let mut layout_entries: Vec<wgpu::BindGroupLayoutEntry> = Vec::new();
        let mut gpu_textures: Vec<wgpu::Texture> = Vec::new();
        let mut gpu_texture_views: Vec<wgpu::TextureView> = Vec::new();
        let mut gpu_samplers: Vec<wgpu::Sampler> = Vec::new();

        // Create textures and samplers
        for (i, (tex_binding, sampler_binding, _name)) in binding_layout.texture_bindings.iter().enumerate() {
            // Layout: texture2D at tex_binding
            layout_entries.push(wgpu::BindGroupLayoutEntry {
                binding: *tex_binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            });

            // Layout: sampler at sampler_binding
            layout_entries.push(wgpu::BindGroupLayoutEntry {
                binding: *sampler_binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            });

            // Create the actual texture + sampler from TextureBinding data
            if i < textures.len() {
                let tex_data = &textures[i];
                let size = wgpu::Extent3d {
                    width: tex_data.width.max(1),
                    height: tex_data.height.max(1),
                    depth_or_array_layers: 1,
                };

                let gpu_tex = self.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("draw_texture"),
                    size,
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });

                self.queue.write_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &gpu_tex,
                        mip_level: 0,
                        origin: wgpu::Origin3d::ZERO,
                        aspect: wgpu::TextureAspect::All,
                    },
                    &tex_data.data,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(4 * tex_data.width),
                        rows_per_image: Some(tex_data.height),
                    },
                    size,
                );

                let view = gpu_tex.create_view(&wgpu::TextureViewDescriptor::default());
                gpu_textures.push(gpu_tex);
                gpu_texture_views.push(view);

                // Map GL filter/wrap modes to wgpu sampler
                let sampler = self.device.create_sampler(&wgpu::SamplerDescriptor {
                    label: Some("draw_sampler"),
                    address_mode_u: Self::map_wrap_mode(tex_data.wrap_s),
                    address_mode_v: Self::map_wrap_mode(tex_data.wrap_t),
                    mag_filter: Self::map_filter_mode(tex_data.mag_filter),
                    min_filter: Self::map_filter_mode(tex_data.min_filter),
                    ..Default::default()
                });
                gpu_samplers.push(sampler);
            }
        }

        // Uniform buffer
        let mut uniform_buf: Option<wgpu::Buffer> = None;
        if has_uniforms {
            let binding = binding_layout.uniform_binding.unwrap();
            layout_entries.push(wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            });

            let data = Self::pack_uniforms(uniforms, &binding_layout.uniform_names);
            let buf = self.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("uniform_buf"),
                size: (data.len() * 4) as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            self.queue.write_buffer(&buf, 0, bytemuck_cast_slice(&data));
            uniform_buf = Some(buf);
        }

        let bind_group_layout = self.device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("draw_bgl"),
            entries: &layout_entries,
        });

        // Build bind group entries
        let mut bg_entries: Vec<wgpu::BindGroupEntry> = Vec::new();
        for (i, (tex_binding, sampler_binding, _name)) in binding_layout.texture_bindings.iter().enumerate() {
            if i < gpu_texture_views.len() {
                bg_entries.push(wgpu::BindGroupEntry {
                    binding: *tex_binding,
                    resource: wgpu::BindingResource::TextureView(&gpu_texture_views[i]),
                });
                bg_entries.push(wgpu::BindGroupEntry {
                    binding: *sampler_binding,
                    resource: wgpu::BindingResource::Sampler(&gpu_samplers[i]),
                });
            }
        }
        if let Some(ref buf) = uniform_buf {
            bg_entries.push(wgpu::BindGroupEntry {
                binding: binding_layout.uniform_binding.unwrap(),
                resource: buf.as_entire_binding(),
            });
        }

        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("draw_bg"),
            layout: &bind_group_layout,
            entries: &bg_entries,
        });

        (bind_group_layout, bind_group)
    }

    /// Pack uniform values into a flat f32 buffer with proper WGSL/std140 alignment.
    /// `ordered_names` gives the declaration order from the shader's uniform block.
    ///
    /// WGSL alignment rules (same as std140):
    /// - float/int: align 4, size 4
    /// - vec2: align 8, size 8
    /// - vec3: align 16, size 12
    /// - vec4: align 16, size 16
    /// - mat3x3: align 16, size 48 (3 columns of vec3, each padded to vec4)
    /// - mat4x4: align 16, size 64
    /// Struct size rounds up to max member alignment.
    fn pack_uniforms(uniforms: &HashMap<String, UniformValue>, ordered_names: &[String]) -> Vec<f32> {
        let mut data: Vec<u8> = Vec::new();

        // Use declaration order if available, fall back to sorted for backwards compat
        let names: Vec<&String> = if !ordered_names.is_empty() {
            ordered_names.iter().collect()
        } else {
            let mut sorted: Vec<&String> = uniforms.keys().collect();
            sorted.sort();
            sorted
        };

        let mut max_align: usize = 4;

        for name in &names {
            let Some(value) = uniforms.get(*name) else { continue };
            let (align, bytes): (usize, Vec<u8>) = match value {
                UniformValue::Float(f) => (4, f.to_le_bytes().to_vec()),
                UniformValue::Int(i) => (4, i.to_le_bytes().to_vec()),
                UniformValue::Vec2(v) => {
                    let mut b = Vec::with_capacity(8);
                    for f in v.iter().take(2) { b.extend_from_slice(&f.to_le_bytes()); }
                    (8, b)
                }
                UniformValue::Vec3(v) => {
                    let mut b = Vec::with_capacity(12);
                    for f in v { b.extend_from_slice(&f.to_le_bytes()); }
                    (16, b) // vec3 has align 16 in WGSL
                }
                UniformValue::Vec4(v) => {
                    let mut b = Vec::with_capacity(16);
                    for f in v { b.extend_from_slice(&f.to_le_bytes()); }
                    (16, b)
                }
                UniformValue::Mat3(m) => {
                    // 3 columns of vec3, each padded to 16 bytes
                    let mut b = Vec::with_capacity(48);
                    for col in 0..3 {
                        for row in 0..3 { b.extend_from_slice(&m[col * 3 + row].to_le_bytes()); }
                        b.extend_from_slice(&0.0_f32.to_le_bytes()); // pad to vec4
                    }
                    (16, b)
                }
                UniformValue::Mat4(m) => {
                    let mut b = Vec::with_capacity(64);
                    for f in m { b.extend_from_slice(&f.to_le_bytes()); }
                    (16, b)
                }
                UniformValue::UInt(u) => (4, u.to_le_bytes().to_vec()),
                UniformValue::IVec2(v) => {
                    let mut b = Vec::with_capacity(8);
                    for i in v { b.extend_from_slice(&i.to_le_bytes()); }
                    (8, b)
                }
                UniformValue::IVec3(v) => {
                    let mut b = Vec::with_capacity(12);
                    for i in v { b.extend_from_slice(&i.to_le_bytes()); }
                    (16, b)
                }
                UniformValue::IVec4(v) => {
                    let mut b = Vec::with_capacity(16);
                    for i in v { b.extend_from_slice(&i.to_le_bytes()); }
                    (16, b)
                }
                UniformValue::UVec2(v) => {
                    let mut b = Vec::with_capacity(8);
                    for u in v { b.extend_from_slice(&u.to_le_bytes()); }
                    (8, b)
                }
                UniformValue::UVec3(v) => {
                    let mut b = Vec::with_capacity(12);
                    for u in v { b.extend_from_slice(&u.to_le_bytes()); }
                    (16, b)
                }
                UniformValue::UVec4(v) => {
                    let mut b = Vec::with_capacity(16);
                    for u in v { b.extend_from_slice(&u.to_le_bytes()); }
                    (16, b)
                }
                UniformValue::Mat2(m) => {
                    // std140: each column of mat2x2 is padded to vec4 (16 bytes)
                    let mut b = Vec::with_capacity(32);
                    // Column 0: m[0], m[1], pad, pad
                    b.extend_from_slice(&m[0].to_le_bytes());
                    b.extend_from_slice(&m[1].to_le_bytes());
                    b.extend_from_slice(&[0u8; 8]); // pad to 16 bytes
                    // Column 1: m[2], m[3], pad, pad
                    b.extend_from_slice(&m[2].to_le_bytes());
                    b.extend_from_slice(&m[3].to_le_bytes());
                    b.extend_from_slice(&[0u8; 8]); // pad to 16 bytes
                    (16, b)
                }
            };

            if align > max_align { max_align = align; }

            // Pad to alignment
            let offset = data.len();
            let aligned_offset = (offset + align - 1) & !(align - 1);
            data.resize(aligned_offset, 0);
            data.extend_from_slice(&bytes);
        }

        // Round total size up to max alignment
        let total = (data.len() + max_align - 1) & !(max_align - 1);
        data.resize(total, 0);

        if data.is_empty() {
            data.resize(16, 0); // min uniform buffer size
        }

        // Convert raw bytes to f32 slice for the caller (bytemuck_cast_slice expects &[f32]).
        // Pad to f32 alignment, then use safe transmutation.
        let remainder = data.len() % 4;
        if remainder != 0 {
            data.resize(data.len() + (4 - remainder), 0);
        }
        // SAFETY: data.len() is guaranteed to be a multiple of 4, and all bit patterns are
        // valid for f32. The data is layout-compatible (both are sequences of 4-byte values).
        let f32_count = data.len() / 4;
        let mut result = vec![0.0f32; f32_count];
        // Safe copy via byte slices — no raw pointer arithmetic
        let dst_bytes: &mut [u8] = bytemuck::cast_slice_mut(&mut result);
        dst_bytes.copy_from_slice(&data);
        result
    }

    /// Map GL wrap mode to wgpu AddressMode.
    fn map_wrap_mode(gl_wrap: u32) -> wgpu::AddressMode {
        match gl_wrap {
            0x2901 => wgpu::AddressMode::Repeat,       // GL_REPEAT
            0x812F => wgpu::AddressMode::ClampToEdge,   // GL_CLAMP_TO_EDGE
            0x8370 => wgpu::AddressMode::MirrorRepeat,  // GL_MIRRORED_REPEAT
            _ => wgpu::AddressMode::Repeat,
        }
    }

    /// Map GL filter mode to wgpu FilterMode.
    fn map_filter_mode(gl_filter: u32) -> wgpu::FilterMode {
        match gl_filter {
            0x2600 => wgpu::FilterMode::Nearest,  // GL_NEAREST
            0x2601 => wgpu::FilterMode::Linear,   // GL_LINEAR
            0x2700 => wgpu::FilterMode::Nearest,  // GL_NEAREST_MIPMAP_NEAREST
            0x2701 => wgpu::FilterMode::Linear,   // GL_LINEAR_MIPMAP_NEAREST
            _ => wgpu::FilterMode::Nearest,
        }
    }
}

/// State needed for a draw call (extracted from GLState to avoid borrow issues).
#[derive(Clone)]
pub struct DrawState {
    pub blend_enabled: bool,
    pub blend_src_rgb: u32,
    pub blend_dst_rgb: u32,
    pub blend_src_alpha: u32,
    pub blend_dst_alpha: u32,
    pub blend_equation_rgb: u32,
    pub blend_equation_alpha: u32,
    pub depth_test_enabled: bool,
    pub depth_func: u32,
    pub depth_mask: bool,
    pub cull_face_enabled: bool,
    pub cull_face_mode: u32,
    pub front_face: u32,
    pub color_mask: [bool; 4],
    pub scissor_test_enabled: bool,
    pub scissor: [i32; 4],
    pub viewport: [i32; 4],
    pub polygon_offset_fill_enabled: bool,
    pub polygon_offset_factor: f32,
    pub polygon_offset_units: f32,
}
