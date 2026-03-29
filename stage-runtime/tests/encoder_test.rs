//! Encoder round-trip tests.
//!
//! Encodes RGBA video + f32 PCM audio via ffmpeg-next, then decodes and verifies
//! the output is structurally correct (codec, dimensions, frame count, etc.).
//!
//! Requires: cargo test --features encoder --test encoder_test
//!
//! These tests are gated on the `encoder` feature since they need FFmpeg dev headers.

#![cfg(feature = "encoder")]

extern crate ffmpeg_next as ffmpeg;

use dazzle_render::encoder::{Encoder, EncoderConfig, OutputDest};
use std::path::Path;

fn test_config(width: u32, height: u32) -> EncoderConfig {
    EncoderConfig {
        width,
        height,
        fps: 30,
        video_codec: "libx264".to_string(),
        video_bitrate: 500_000,
        audio_bitrate: 128_000,
        audio_sample_rate: 44100,
        keyframe_interval: 30,
        gpu_device_index: 0,
    }
}

fn encode_test_file(path: &Path, config: &EncoderConfig, num_frames: usize, with_audio: bool) {
    let mut enc = Encoder::new(EncoderConfig {
        width: config.width,
        height: config.height,
        fps: config.fps,
        video_codec: config.video_codec.clone(),
        video_bitrate: config.video_bitrate,
        audio_bitrate: config.audio_bitrate,
        audio_sample_rate: config.audio_sample_rate,
        keyframe_interval: config.keyframe_interval,
        gpu_device_index: config.gpu_device_index,
    }).expect("failed to create encoder");

    enc.set_outputs(vec![OutputDest {
        name: "test".to_string(),
        url: format!("file:{}", path.display()),
        watermarked: false,
    }]);

    let pixels = make_test_pattern(config.width, config.height);
    let samples_per_frame = (config.audio_sample_rate / config.fps) as usize;
    let audio: Vec<f32> = if with_audio {
        // 440Hz sine wave, stereo interleaved
        (0..samples_per_frame * 2)
            .map(|i| {
                let t = (i / 2) as f32 / config.audio_sample_rate as f32;
                (t * 440.0 * 2.0 * std::f32::consts::PI).sin() * 0.5
            })
            .collect()
    } else {
        vec![]
    };

    for _ in 0..num_frames {
        if with_audio {
            enc.encode_frame(&pixels, Some(&audio));
        } else {
            enc.encode_frame(&pixels, None);
        }
    }

    // Drop triggers flush + trailer
    drop(enc);
}

/// Generate a test pattern: red/green/blue/white quadrants.
fn make_test_pattern(width: u32, height: u32) -> Vec<u8> {
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let hw = width / 2;
    let hh = height / 2;
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            let (r, g, b) = match (x < hw, y < hh) {
                (true, true) => (255, 0, 0),     // top-left: red
                (false, true) => (0, 255, 0),     // top-right: green
                (true, false) => (0, 0, 255),     // bottom-left: blue
                (false, false) => (255, 255, 255), // bottom-right: white
            };
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
            pixels[idx + 3] = 255;
        }
    }
    pixels
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn output_is_valid_flv() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("valid.flv");
    let config = test_config(64, 64);
    encode_test_file(&path, &config, 30, false);

    assert!(path.exists(), "output file should exist");
    let size = std::fs::metadata(&path).unwrap().len();
    assert!(size > 100, "output file should have meaningful size, got {} bytes", size);

    // Verify we can open it as a valid media container
    ffmpeg::init().unwrap();
    let ictx = ffmpeg::format::input(&path).expect("should open as valid media file");

    let num_streams = ictx.streams().count();
    assert!(num_streams >= 1, "should have at least 1 stream, got {}", num_streams);
}

#[test]
fn video_stream_properties() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("video_props.flv");
    let config = test_config(128, 96);
    encode_test_file(&path, &config, 15, false);

    ffmpeg::init().unwrap();
    let ictx = ffmpeg::format::input(&path).unwrap();

    // Find video stream
    let video_stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .expect("should have a video stream");

    let codec_params = video_stream.parameters();
    let decoder = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .unwrap()
        .decoder()
        .video()
        .unwrap();

    assert_eq!(decoder.width(), 128, "video width");
    assert_eq!(decoder.height(), 96, "video height");
    assert_eq!(
        decoder.codec().map(|c| c.id()),
        Some(ffmpeg::codec::Id::H264),
        "video codec should be H.264"
    );
}

#[test]
fn audio_stream_properties() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("audio_props.flv");
    let config = test_config(64, 64);
    encode_test_file(&path, &config, 30, true);

    ffmpeg::init().unwrap();
    let ictx = ffmpeg::format::input(&path).unwrap();

    // Find audio stream
    let audio_stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .expect("should have an audio stream");

    let codec_params = audio_stream.parameters();
    let decoder = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .unwrap()
        .decoder()
        .audio()
        .unwrap();

    assert_eq!(
        decoder.codec().map(|c| c.id()),
        Some(ffmpeg::codec::Id::AAC),
        "audio codec should be AAC"
    );
    assert_eq!(decoder.rate(), 44100, "audio sample rate");
}

#[test]
fn decode_video_frames() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("decode_frames.flv");
    let config = test_config(64, 64);
    let num_input_frames = 10;
    encode_test_file(&path, &config, num_input_frames, false);

    ffmpeg::init().unwrap();
    let mut ictx = ffmpeg::format::input(&path).unwrap();

    let video_stream_idx = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .unwrap()
        .index();

    let codec_params = ictx.stream(video_stream_idx).unwrap().parameters();
    let mut decoder = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .unwrap()
        .decoder()
        .video()
        .unwrap();

    let mut decoded_count = 0u32;
    let mut frame = ffmpeg::frame::Video::empty();

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_stream_idx {
            continue;
        }
        decoder.send_packet(&packet).unwrap();
        while decoder.receive_frame(&mut frame).is_ok() {
            decoded_count += 1;
            assert_eq!(frame.width(), 64);
            assert_eq!(frame.height(), 64);
        }
    }

    // Flush decoder
    decoder.send_eof().unwrap();
    while decoder.receive_frame(&mut frame).is_ok() {
        decoded_count += 1;
    }

    assert!(
        decoded_count >= (num_input_frames as u32 - 2),
        "should decode most input frames, got {} of {}",
        decoded_count,
        num_input_frames
    );
}

#[test]
fn video_frame_has_color_data() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("color_check.flv");
    let config = test_config(64, 64);
    encode_test_file(&path, &config, 5, false);

    ffmpeg::init().unwrap();
    let mut ictx = ffmpeg::format::input(&path).unwrap();

    let video_stream_idx = ictx
        .streams()
        .best(ffmpeg::media::Type::Video)
        .unwrap()
        .index();

    let codec_params = ictx.stream(video_stream_idx).unwrap().parameters();
    let mut decoder = ffmpeg::codec::context::Context::from_parameters(codec_params)
        .unwrap()
        .decoder()
        .video()
        .unwrap();

    let mut got_frame = false;
    let mut frame = ffmpeg::frame::Video::empty();

    for (stream, packet) in ictx.packets() {
        if stream.index() != video_stream_idx {
            continue;
        }
        decoder.send_packet(&packet).unwrap();
        while decoder.receive_frame(&mut frame).is_ok() {
            if !got_frame {
                // Convert decoded YUV frame back to RGBA for inspection
                let mut scaler = ffmpeg::software::scaling::Context::get(
                    frame.format(),
                    frame.width(),
                    frame.height(),
                    ffmpeg::util::format::Pixel::RGBA,
                    frame.width(),
                    frame.height(),
                    ffmpeg::software::scaling::Flags::BILINEAR,
                )
                .unwrap();

                let mut rgba_frame = ffmpeg::frame::Video::empty();
                scaler.run(&frame, &mut rgba_frame).unwrap();

                let data = rgba_frame.data(0);
                let stride = rgba_frame.stride(0);

                // Check top-left quadrant is reddish (our test pattern)
                let tl_r = data[0];
                let tl_g = data[1];
                let tl_b = data[2];
                assert!(
                    tl_r > 150 && tl_g < 100 && tl_b < 100,
                    "top-left should be reddish after decode, got RGB({},{},{})",
                    tl_r, tl_g, tl_b
                );

                // Check top-right quadrant is greenish
                let tr_offset = 48 * 4; // ~75% across the 64px width
                let tr_r = data[tr_offset];
                let tr_g = data[tr_offset + 1];
                let tr_b = data[tr_offset + 2];
                assert!(
                    tr_g > 150 && tr_r < 100,
                    "top-right should be greenish after decode, got RGB({},{},{})",
                    tr_r, tr_g, tr_b
                );

                // Check bottom-left is bluish
                let bl_row = 48; // ~75% down
                let bl_offset = bl_row * stride + 4; // second pixel
                let bl_r = data[bl_offset];
                let bl_g = data[bl_offset + 1];
                let bl_b = data[bl_offset + 2];
                assert!(
                    bl_b > 150 && bl_r < 100 && bl_g < 100,
                    "bottom-left should be bluish after decode, got RGB({},{},{})",
                    bl_r, bl_g, bl_b
                );

                got_frame = true;
            }
        }
    }

    assert!(got_frame, "should have decoded at least one frame");
}

#[test]
fn stats_track_encoding_progress() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stats.flv");

    let mut enc = Encoder::new(test_config(64, 64)).expect("failed to create encoder");

    // Before any encoding, stats should be zero
    let stats = enc.stats();
    assert_eq!(stats.total_bytes, 0);

    enc.set_outputs(vec![OutputDest {
        name: "test".to_string(),
        url: format!("file:{}", path.display()),
        watermarked: false,
    }]);

    let pixels = vec![128u8; 64 * 64 * 4];
    for _ in 0..30 {
        enc.encode_frame(&pixels, None);
    }

    let stats = enc.stats();
    assert!(stats.total_bytes > 0, "should have encoded bytes");
    assert!(stats.encode_fps > 0.0, "should report encode fps");
    assert_eq!(stats.dropped_frames, 0, "should have no dropped frames");
}

#[test]
fn multiple_outputs() {
    let dir = tempfile::tempdir().unwrap();
    let path1 = dir.path().join("out1.flv");
    let path2 = dir.path().join("out2.flv");

    let mut enc = Encoder::new(test_config(64, 64)).expect("failed to create encoder");
    enc.set_outputs(vec![
        OutputDest {
            name: "first".to_string(),
            url: format!("file:{}", path1.display()),
            watermarked: false,
        },
        OutputDest {
            name: "second".to_string(),
            url: format!("file:{}", path2.display()),
            watermarked: false,
        },
    ]);

    assert_eq!(enc.output_count(), 2);

    let pixels = vec![255u8; 64 * 64 * 4];
    for _ in 0..10 {
        enc.encode_frame(&pixels, None);
    }

    drop(enc);

    // Both output files should exist and be valid
    assert!(path1.exists(), "first output should exist");
    assert!(path2.exists(), "second output should exist");

    let size1 = std::fs::metadata(&path1).unwrap().len();
    let size2 = std::fs::metadata(&path2).unwrap().len();
    assert!(size1 > 100, "first output should have data: {} bytes", size1);
    assert!(size2 > 100, "second output should have data: {} bytes", size2);

    // Both should be valid FLV containers
    ffmpeg::init().unwrap();
    ffmpeg::format::input(&path1).expect("first output should be valid media");
    ffmpeg::format::input(&path2).expect("second output should be valid media");
}

#[test]
fn different_resolutions() {
    for (w, h) in [(64, 64), (128, 72), (320, 240), (1280, 720)] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(format!("{}x{}.flv", w, h));
        let config = test_config(w, h);
        encode_test_file(&path, &config, 5, false);

        ffmpeg::init().unwrap();
        let ictx = ffmpeg::format::input(&path).unwrap();
        let video = ictx.streams().best(ffmpeg::media::Type::Video).unwrap();
        let dec = ffmpeg::codec::context::Context::from_parameters(video.parameters())
            .unwrap()
            .decoder()
            .video()
            .unwrap();

        assert_eq!(dec.width(), w, "width for {}x{}", w, h);
        assert_eq!(dec.height(), h, "height for {}x{}", w, h);
    }
}
