/// Video/Audio encoder module.
/// Encodes framebuffer (RGBA) → H.264 + PCM audio → AAC, muxed to FLV for RTMP output.
/// Uses ffmpeg-next for in-process encoding when the `encoder` feature is enabled.

use std::time::Instant;

/// Encoder configuration matching the sidecar's ffmpeg pipeline.
pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub video_codec: String,    // "h264_nvenc" or "libx264"
    pub video_bitrate: u32,     // 2500000 (2.5 Mbps)
    pub audio_bitrate: u32,     // 128000 (128 kbps)
    pub audio_sample_rate: u32, // 44100
    pub keyframe_interval: u32, // 60 frames (2s at 30fps)
    pub gpu_device_index: u32,
}

/// RTMP output destination.
pub struct OutputDest {
    pub name: String,
    pub url: String,
    pub watermarked: bool,
}

/// Encoding statistics.
pub struct EncoderStats {
    pub encode_fps: f64,
    pub dropped_frames: u64,
    pub total_bytes: u64,
}

/// Manages encoding and RTMP output.
pub struct Encoder {
    config: EncoderConfig,
    outputs: Vec<OutputDest>,
    stats: EncoderStats,
    frame_count: u64,
    start_time: Instant,
    pipelines: Vec<OutputPipeline>,
}

struct OutputPipeline {
    octx: ffmpeg_next::format::context::Output,
    video_encoder: ffmpeg_next::encoder::video::Encoder,
    audio_encoder: ffmpeg_next::encoder::audio::Encoder,
    /// RGBA→YUV420P scaler (None when using NV12 path or VideoToolbox)
    scaler: Option<ffmpeg_next::software::scaling::Context>,
    video_stream_idx: usize,
    audio_stream_idx: usize,
    /// Encoder's configured time_base for video (1/fps)
    video_enc_time_base: ffmpeg_next::Rational,
    /// Encoder's configured time_base for audio (1/sample_rate)
    audio_enc_time_base: ffmpeg_next::Rational,
    /// Muxer stream time_base (may differ from encoder after write_header)
    video_time_base: ffmpeg_next::Rational,
    audio_time_base: ffmpeg_next::Rational,
    video_pts: i64,
    audio_pts: i64,
    total_bytes: u64,
}

impl Encoder {
    pub fn new(config: EncoderConfig) -> anyhow::Result<Self> {
        if config.fps == 0 || config.fps > 240 {
            return Err(anyhow::anyhow!("EncoderConfig.fps must be 1..=240, got {}", config.fps));
        }

        ffmpeg_next::init().map_err(|e| anyhow::anyhow!("Failed to initialize ffmpeg: {}", e))?;

        Ok(Encoder {
            config,
            outputs: Vec::new(),
            stats: EncoderStats {
                encode_fps: 0.0,
                dropped_frames: 0,
                total_bytes: 0,
            },
            frame_count: 0,
            start_time: Instant::now(),
            pipelines: Vec::new(),
        })
    }

    /// Set RTMP output destinations. Tears down old pipelines, creates new ones.
    pub fn set_outputs(&mut self, outputs: Vec<OutputDest>) {
        // Flush and drop old pipelines
        for mut p in self.pipelines.drain(..) {
            let _ = flush_pipeline(&mut p);
        }

        // Create new pipelines — only keep outputs whose pipelines succeed
        let mut successful_outputs = Vec::new();
        for dest in outputs {
            log::info!("Creating output pipeline for {} -> {}", dest.name, dest.url);
            match create_pipeline(&self.config, &dest.url) {
                Ok(p) => {
                    log::info!("Output pipeline for {} created successfully", dest.name);
                    self.pipelines.push(p);
                    successful_outputs.push(dest);
                }
                Err(e) => log::error!("Failed to create output pipeline for {}: {} (errno {:?})", dest.name, e, e),
            }
        }
        self.outputs = successful_outputs;
    }

    /// Feed a frame (RGBA pixels) and optional audio samples to the encoder.
    pub fn encode_frame(&mut self, pixels: &[u8], audio_samples: Option<&[f32]>) {
        self.frame_count += 1;

        for pipeline in &mut self.pipelines {
            if let Err(e) = encode_video_frame(pipeline, pixels, &self.config) {
                log::error!("Video encode error: {}", e);
            }
            if let Some(samples) = audio_samples {
                let samples_per_frame = (self.config.audio_sample_rate / self.config.fps) as usize;
                if let Err(e) = encode_audio_samples(pipeline, samples, samples_per_frame) {
                    log::error!("Audio encode error: {}", e);
                }
            }
        }

        // Update stats
        let elapsed = self.start_time.elapsed().as_secs_f64();
        if elapsed > 0.0 {
            self.stats.encode_fps = self.frame_count as f64 / elapsed;
        }
        self.stats.total_bytes = self.pipelines.iter().map(|p| p.total_bytes).sum();
    }

    /// Number of configured output destinations.
    pub fn output_count(&self) -> usize {
        self.outputs.len()
    }

    /// Get encoder stats.
    pub fn stats(&self) -> EncoderStats {
        EncoderStats {
            encode_fps: self.stats.encode_fps,
            dropped_frames: self.stats.dropped_frames,
            total_bytes: self.stats.total_bytes,
        }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        for mut p in self.pipelines.drain(..) {
            let _ = flush_pipeline(&mut p);
        }
    }
}

// ============================================================================
// ffmpeg-next implementation
// ============================================================================

/// Resolve the video codec name: if "auto", pick the best HW encoder for this platform.
fn resolve_video_codec(requested: &str) -> String {
    if requested != "auto" {
        return requested.to_string();
    }

    // Check VIDEO_CODEC env var (set by control-plane via STREAMER_VIDEO_CODEC)
    if let Ok(codec) = std::env::var("VIDEO_CODEC") {
        if !codec.is_empty() {
            return codec;
        }
    }

    // Auto-detect: use NVENC if any NVIDIA GPU is present
    if (0..8).any(|i| std::path::Path::new(&format!("/dev/nvidia{}", i)).exists()) {
        return "h264_nvenc".to_string();
    }

    "libx264".to_string()
}

fn create_pipeline(
    config: &EncoderConfig,
    url: &str,
) -> Result<OutputPipeline, ffmpeg_next::Error> {
    use ffmpeg_next::{
        codec, encoder, format, software, channel_layout, Dictionary, Rational,
    };
    use ffmpeg_next::util::format::Pixel;
    use ffmpeg_next::util::format::sample::Sample;

    // Validate URL scheme to prevent arbitrary file writes via ffmpeg.
    // Only RTMP(S) URLs and safe .flv file paths (for benchmarks) are allowed.
    if url.starts_with("rtmp://") || url.starts_with("rtmps://") {
        // RTMP(S) — allowed
    } else if url.ends_with(".flv") {
        // Only allow .flv if it's a relative path (no scheme) — block file://, http://, etc.
        if url.contains("://") {
            log::error!("Rejected .flv output with scheme: {}", url);
            return Err(ffmpeg_next::Error::Bug);
        }
        // Block path traversal — no ".." components allowed (check both literal and URL-encoded)
        if url.contains("..") || url.contains("%2e") || url.contains("%2E") {
            log::error!("Rejected .flv output with path traversal: {}", url);
            return Err(ffmpeg_next::Error::Bug);
        }
        // Block absolute paths — only relative paths within CWD
        if url.starts_with('/') || url.starts_with('\\') {
            log::error!("Rejected .flv output with absolute path: {}", url);
            return Err(ffmpeg_next::Error::Bug);
        }
    } else {
        log::error!("Rejected output URL with unsupported scheme: {}", url);
        return Err(ffmpeg_next::Error::Bug);
    }
    log::info!("Opening output format for URL: {}", url);
    let mut octx = format::output_as(url, "flv").map_err(|e| {
        log::error!("format::output_as failed for {}: {} (errno {:?})", url, e, e);
        e
    })?;
    let global_header = octx.format().flags().contains(format::Flags::GLOBAL_HEADER);

    // --- Video stream: H.264 ---
    // Resolve codec: try requested name first, auto-detect platform HW encoder, fall back to libx264
    let codec_name = resolve_video_codec(&config.video_codec);
    let video_codec = encoder::find_by_name(&codec_name)
        .or_else(|| encoder::find(codec::Id::H264))
        .ok_or(ffmpeg_next::Error::EncoderNotFound)?;

    log::info!("Video encoder: {} (requested: {})", codec_name, config.video_codec);

    let mut video_enc = codec::context::Context::new_with_codec(video_codec)
        .encoder()
        .video()?;

    // VideoToolbox prefers NV12 input; others use YUV420P
    let pixel_fmt = if codec_name.contains("videotoolbox") {
        Pixel::NV12
    } else {
        Pixel::YUV420P
    };

    video_enc.set_width(config.width);
    video_enc.set_height(config.height);
    video_enc.set_format(pixel_fmt);
    video_enc.set_frame_rate(Some(Rational(config.fps as i32, 1)));
    video_enc.set_time_base(Rational(1, config.fps as i32));
    video_enc.set_bit_rate(config.video_bitrate as usize);

    if global_header {
        video_enc.set_flags(codec::Flags::GLOBAL_HEADER);
    }

    // Codec-specific options
    let mut codec_opts = Dictionary::new();
    let gop_str = config.keyframe_interval.to_string();
    if codec_name.contains("nvenc") {
        codec_opts.set("preset", "p4");
        codec_opts.set("tune", "ll");
        codec_opts.set("rc", "cbr");
        codec_opts.set("g", &gop_str);
    } else if codec_name.contains("videotoolbox") {
        codec_opts.set("realtime", "1");
        codec_opts.set("allow_sw", "0");
    } else {
        codec_opts.set("preset", "veryfast");
        codec_opts.set("tune", "zerolatency");
        codec_opts.set("profile", "high");
        codec_opts.set("level", "4.1");
        codec_opts.set("g", &gop_str);
    }

    let video_encoder = video_enc.open_with(codec_opts)?;

    let video_stream_idx = {
        let mut ost = octx.add_stream(video_codec)?;
        ost.set_parameters(&video_encoder);
        ost.index()
    };

    // --- Audio stream: AAC, stereo ---
    let audio_codec = encoder::find(codec::Id::AAC)
        .ok_or(ffmpeg_next::Error::EncoderNotFound)?;

    let mut audio_enc = codec::context::Context::new_with_codec(audio_codec)
        .encoder()
        .audio()?;

    audio_enc.set_rate(config.audio_sample_rate as i32);
    audio_enc.set_channel_layout(channel_layout::ChannelLayout::STEREO);
    audio_enc.set_format(Sample::F32(format::sample::Type::Planar));
    audio_enc.set_bit_rate(config.audio_bitrate as usize);
    audio_enc.set_time_base(Rational(1, config.audio_sample_rate as i32));

    if global_header {
        audio_enc.set_flags(codec::Flags::GLOBAL_HEADER);
    }

    let audio_encoder = audio_enc.open_as(audio_codec)?;

    let audio_stream_idx = {
        let mut ost = octx.add_stream(audio_codec)?;
        ost.set_parameters(&audio_encoder);
        ost.set_time_base(Rational(1, config.audio_sample_rate as i32));
        ost.index()
    };

    // --- Scaler: RGBA → target pixel format ---
    // Always create a scaler since we receive RGBA input but encoders expect YUV420P or NV12.
    let scaler = Some(software::scaling::Context::get(
        Pixel::RGBA,
        config.width,
        config.height,
        pixel_fmt,
        config.width,
        config.height,
        software::scaling::Flags::BILINEAR,
    )?);

    // --- Write header (triggers RTMP handshake for RTMP URLs) ---
    log::info!("Writing header (RTMP handshake)...");
    octx.write_header().map_err(|e| {
        log::error!("write_header failed: {} (errno {:?})", e, e);
        e
    })?;
    log::info!("Header written successfully");

    let video_time_base = octx.stream(video_stream_idx)
        .ok_or(ffmpeg_next::Error::StreamNotFound)?.time_base();
    let audio_time_base = octx.stream(audio_stream_idx)
        .ok_or(ffmpeg_next::Error::StreamNotFound)?.time_base();

    Ok(OutputPipeline {
        octx,
        video_encoder,
        audio_encoder,
        scaler,
        video_stream_idx,
        audio_stream_idx,
        video_enc_time_base: Rational(1, config.fps as i32),
        audio_enc_time_base: Rational(1, config.audio_sample_rate as i32),
        video_time_base,
        audio_time_base,
        video_pts: 0,
        audio_pts: 0,
        total_bytes: 0,
    })
}

fn encode_video_frame(
    p: &mut OutputPipeline,
    rgba_data: &[u8],
    config: &EncoderConfig,
) -> Result<(), ffmpeg_next::Error> {
    use ffmpeg_next::frame;
    use ffmpeg_next::util::format::Pixel;

    let expected_bytes = (config.width as usize)
        .checked_mul(config.height as usize)
        .and_then(|n| n.checked_mul(4))
        .ok_or(ffmpeg_next::Error::Bug)?;
    if rgba_data.len() < expected_bytes {
        return Err(ffmpeg_next::Error::Bug);
    }
    let mut src_frame = frame::Video::new(Pixel::RGBA, config.width, config.height);
    let stride = src_frame.stride(0);
    let row_bytes = (config.width as usize) * 4;
    let dst = src_frame.data_mut(0);
    if stride == row_bytes {
        // Fast path: stride matches width — single memcpy for the entire frame
        let total = row_bytes * (config.height as usize);
        dst[..total].copy_from_slice(&rgba_data[..total]);
    } else {
        // Padded stride — copy row by row
        for y in 0..config.height as usize {
            let src_offset = y * row_bytes;
            let dst_offset = y * stride;
            dst[dst_offset..dst_offset + row_bytes]
                .copy_from_slice(&rgba_data[src_offset..src_offset + row_bytes]);
        }
    }

    let mut yuv_frame = frame::Video::empty();
    let Some(scaler) = p.scaler.as_mut() else {
        log::error!("encoder pipeline missing scaler (RGBA → YUV420P/NV12)");
        return Err(ffmpeg_next::Error::Bug);
    };
    scaler.run(&src_frame, &mut yuv_frame)?;

    // PTS increments by 1 per frame with time_base = 1/fps, producing
    // correct constant-frame-rate output regardless of encode speed.
    // tick_paced() ensures wall-clock alignment for live streaming;
    // uncapped tick() produces correct playback timing in the file.
    yuv_frame.set_pts(Some(p.video_pts));
    p.video_pts += 1;

    p.video_encoder.send_frame(&yuv_frame)?;
    drain_video_packets(p)?;
    Ok(())
}

fn encode_audio_samples(
    p: &mut OutputPipeline,
    pcm_data: &[f32],
    num_samples: usize,
) -> Result<(), ffmpeg_next::Error> {
    use ffmpeg_next::{channel_layout, frame};
    use ffmpeg_next::util::format::sample::Sample;

    let mut src_frame = frame::Audio::new(
        Sample::F32(ffmpeg_next::format::sample::Type::Packed),
        num_samples,
        channel_layout::ChannelLayout::STEREO,
    );

    // Copy interleaved f32 PCM into frame data.
    // Validate that pcm_data has enough samples (stereo = 2 channels).
    let Some(required_samples) = num_samples.checked_mul(2) else {
        log::warn!("Audio sample count overflow: {}", num_samples);
        return Ok(());
    };
    if pcm_data.len() < required_samples {
        log::warn!(
            "Audio buffer too small: need {} samples (stereo), got {}",
            required_samples, pcm_data.len()
        );
        return Ok(()); // skip this frame rather than sending partial/uninitialized data
    }
    // Deinterleave stereo f32 samples into planar format (fltp):
    // Input: [L0, R0, L1, R1, ...] interleaved
    // Output: plane 0 = [L0, L1, ...], plane 1 = [R0, R1, ...]
    //
    // Use raw pointers because ffmpeg's data_mut borrows the whole frame,
    // preventing two simultaneous mutable plane references.
    unsafe {
        let ptr0 = src_frame.data_mut(0).as_mut_ptr();
        let ptr1 = src_frame.data_mut(1).as_mut_ptr();
        let plane_bytes = num_samples * 4; // 4 bytes per f32
        let plane0 = std::slice::from_raw_parts_mut(ptr0, plane_bytes);
        let plane1 = std::slice::from_raw_parts_mut(ptr1, plane_bytes);
        for i in 0..num_samples {
            let off = i * 4;
            plane0[off..off + 4].copy_from_slice(&pcm_data[i * 2].to_le_bytes());
            plane1[off..off + 4].copy_from_slice(&pcm_data[i * 2 + 1].to_le_bytes());
        }
    }

    src_frame.set_pts(Some(p.audio_pts));
    p.audio_pts += num_samples as i64;

    p.audio_encoder.send_frame(&src_frame)?;
    drain_audio_packets(p)?;
    Ok(())
}

fn drain_video_packets(p: &mut OutputPipeline) -> Result<(), ffmpeg_next::Error> {
    use ffmpeg_next::Packet;

    let mut packet = Packet::empty();
    while p.video_encoder.receive_packet(&mut packet).is_ok() {
        p.total_bytes += packet.size() as u64;
        packet.set_stream(p.video_stream_idx);
        packet.rescale_ts(
            p.video_enc_time_base,
            p.video_time_base,
        );
        packet.write_interleaved(&mut p.octx)?;
    }
    Ok(())
}

fn drain_audio_packets(p: &mut OutputPipeline) -> Result<(), ffmpeg_next::Error> {
    use ffmpeg_next::Packet;

    let mut packet = Packet::empty();
    while p.audio_encoder.receive_packet(&mut packet).is_ok() {
        p.total_bytes += packet.size() as u64;
        packet.set_stream(p.audio_stream_idx);
        packet.rescale_ts(
            p.audio_enc_time_base,
            p.audio_time_base,
        );
        packet.write_interleaved(&mut p.octx)?;
    }
    Ok(())
}

fn flush_pipeline(p: &mut OutputPipeline) -> Result<(), ffmpeg_next::Error> {
    // Flush all stages even if earlier ones fail, to avoid leaking resources.
    let r1 = p.video_encoder.send_eof().and_then(|_| drain_video_packets(p));
    let r2 = p.audio_encoder.send_eof().and_then(|_| drain_audio_packets(p));
    let r3 = p.octx.write_trailer();
    // Return the first error encountered
    r1.and(r2).and(r3)
}
