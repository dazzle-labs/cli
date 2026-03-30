//! Shared test harness for stage-runtime integration tests.
//!
//! Provides runtime construction, pixel helpers, and optional video output.
//! Set `DAZZLE_TEST_VIDEO_DIR` to write per-test MP4s via ffmpeg, or PNG
//! frame sequences if ffmpeg is not available.

use std::sync::{Arc, Mutex};

/// Create a Runtime with the given dimensions at 30fps.
pub fn make_runtime(w: u32, h: u32) -> stage_runtime::runtime::Runtime {
    let dir = tempfile::tempdir().unwrap();
    let dir = Box::leak(Box::new(dir));
    let store = Arc::new(Mutex::new(
        stage_runtime::storage::Storage::new(&dir.path().join("storage.json")).unwrap(),
    ));
    stage_runtime::runtime::Runtime::new(w, h, 30, store).unwrap()
}

/// Get pixel RGBA at (x, y) from a framebuffer.
pub fn pixel_at(fb: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
    let idx = ((y * w + x) * 4) as usize;
    [fb[idx], fb[idx + 1], fb[idx + 2], fb[idx + 3]]
}

/// Collects frames and optionally writes video output.
///
/// Usage:
/// ```ignore
/// let mut rec = FrameRecorder::new("test_name", 64, 64);
/// for _ in 0..10 {
///     rt.tick();
///     rec.capture(rt.get_framebuffer());
/// }
/// rec.finish(); // writes video if DAZZLE_TEST_VIDEO_DIR is set
/// ```
pub struct FrameRecorder {
    name: String,
    width: u32,
    height: u32,
    frames: Vec<Vec<u8>>,
}

impl FrameRecorder {
    pub fn new(name: &str, width: u32, height: u32) -> Self {
        Self {
            name: name.to_string(),
            width,
            height,
            frames: Vec::new(),
        }
    }

    /// Capture a frame (copies the framebuffer).
    pub fn capture(&mut self, fb: &[u8]) {
        self.frames.push(fb.to_vec());
    }

    /// Get the last captured frame's pixel at (x, y).
    pub fn last_pixel(&self, x: u32, y: u32) -> [u8; 4] {
        pixel_at(self.frames.last().unwrap(), self.width, x, y)
    }

    /// Get frame N's pixel at (x, y).
    pub fn frame_pixel(&self, frame: usize, x: u32, y: u32) -> [u8; 4] {
        pixel_at(&self.frames[frame], self.width, x, y)
    }

    /// Write video output if DAZZLE_TEST_VIDEO_DIR is set.
    /// Tries ffmpeg first (MP4), falls back to PNG frame sequence.
    pub fn finish(&self) {
        let Some(dir) = std::env::var("DAZZLE_TEST_VIDEO_DIR").ok() else {
            return;
        };
        let out_dir = std::path::PathBuf::from(&dir);
        std::fs::create_dir_all(&out_dir).unwrap();

        if self.try_write_mp4(&out_dir) {
            return;
        }
        self.write_png_frames(&out_dir);
    }

    fn try_write_mp4(&self, out_dir: &std::path::Path) -> bool {
        let mp4_path = out_dir.join(format!("{}.mp4", self.name));
        let mut child = match std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-f", "rawvideo",
                "-pixel_format", "rgba",
                "-video_size", &format!("{}x{}", self.width, self.height),
                "-framerate", "30",
                "-i", "pipe:0",
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-crf", "18",
            ])
            .arg(mp4_path.as_os_str())
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(_) => return false,
        };

        {
            use std::io::Write;
            let stdin = child.stdin.as_mut().unwrap();
            for frame in &self.frames {
                stdin.write_all(frame).unwrap();
            }
        }
        let status = child.wait().unwrap();
        if status.success() {
            eprintln!("  video: {}", mp4_path.display());
            true
        } else {
            false
        }
    }

    fn write_png_frames(&self, out_dir: &std::path::Path) {
        let frame_dir = out_dir.join(&self.name);
        std::fs::create_dir_all(&frame_dir).unwrap();

        for (i, frame) in self.frames.iter().enumerate() {
            let path = frame_dir.join(format!("frame_{:04}.png", i));
            let file = std::fs::File::create(&path).unwrap();
            let ref mut w = std::io::BufWriter::new(file);
            let mut encoder = png::Encoder::new(w, self.width, self.height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(frame).unwrap();
        }
        eprintln!("  frames: {}/", frame_dir.display());
    }
}
