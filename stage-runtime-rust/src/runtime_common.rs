/// Shared types used by both V8 and Servo runtimes.

/// Console log entry captured from JS.
#[derive(Debug, Clone)]
pub struct ConsoleEntry {
    pub level: String,
    pub text: String,
    pub timestamp: f64,
}

/// Frame pacer: sleeps between frames to hit a target FPS.
/// Uses spin-wait for the final microseconds to avoid OS timer granularity.
pub struct FramePacer {
    frame_duration: std::time::Duration,
    next_frame: std::time::Instant,
}

impl FramePacer {
    pub fn new(fps: u32) -> Self {
        FramePacer {
            frame_duration: std::time::Duration::from_secs_f64(1.0 / fps as f64),
            next_frame: std::time::Instant::now(),
        }
    }

    /// Sleep until the next frame is due. Returns immediately if already past deadline.
    pub fn wait(&mut self) {
        let now = std::time::Instant::now();
        if now < self.next_frame {
            let remaining = self.next_frame - now;
            if remaining > std::time::Duration::from_micros(500) {
                std::thread::sleep(remaining - std::time::Duration::from_micros(500));
            }
            while std::time::Instant::now() < self.next_frame {
                std::hint::spin_loop();
            }
        }
        self.next_frame += self.frame_duration;
    }
}
