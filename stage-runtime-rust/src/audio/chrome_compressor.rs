/// Port of Chromium's DynamicsCompressor DSP.
/// Source: third_party/blink/renderer/platform/audio/dynamics_compressor.cc
///
/// This is a direct translation of Chrome's compressor algorithm, including:
/// - 6ms pre-delay (lookahead)
/// - Adaptive 4th-order polynomial release envelope
/// - Exponential knee curve with binary-search k parameter
/// - sin(π/2 * gain) post-warp
/// - Empirical makeup gain: pow(1/Saturate(1, k), 0.6)
/// - 32-frame processing divisions

use std::f32::consts::FRAC_PI_2;

const METERING_RELEASE_TIME_CONSTANT: f32 = 0.325;
const PRE_DELAY: f32 = 0.006; // seconds
const MAX_PRE_DELAY_FRAMES: usize = 1024;
const MAX_PRE_DELAY_FRAMES_MASK: usize = MAX_PRE_DELAY_FRAMES - 1;
const DEFAULT_PRE_DELAY_FRAMES: usize = 256;
const NUMBER_OF_DIVISION_FRAMES: usize = 32;
const SAT_RELEASE_TIME: f32 = 0.0025;

// Release zone values 0 -> 1
const RELEASE_ZONE1: f32 = 0.09;
const RELEASE_ZONE2: f32 = 0.16;
const RELEASE_ZONE3: f32 = 0.42;
const RELEASE_ZONE4: f32 = 0.98;

// 4th order polynomial coefficients for adaptive release curve
const A_BASE: f32 = 0.9999999999999999 * RELEASE_ZONE1
    + 1.8432219684323923e-16 * RELEASE_ZONE2
    - 1.9373394351676423e-16 * RELEASE_ZONE3
    + 8.8245160118162450e-18 * RELEASE_ZONE4;
const B_BASE: f32 = -1.5788320352845888 * RELEASE_ZONE1
    + 2.3305837032074286 * RELEASE_ZONE2
    - 0.91411942048404290 * RELEASE_ZONE3
    + 0.16236775256120320 * RELEASE_ZONE4;
const C_BASE: f32 = 0.53341428691064240 * RELEASE_ZONE1
    - 1.2727367892136310 * RELEASE_ZONE2
    + 0.92588560422075120 * RELEASE_ZONE3
    - 0.18656310191776220 * RELEASE_ZONE4;
const D_BASE: f32 = 0.087834631382072340 * RELEASE_ZONE1
    - 0.16941629679256220 * RELEASE_ZONE2
    + 0.085880579515952720 * RELEASE_ZONE3
    - 0.0042989141054628300 * RELEASE_ZONE4;
const E_BASE: f32 = -0.042416883008123070 * RELEASE_ZONE1
    + 0.11156938279876020 * RELEASE_ZONE2
    - 0.097646763252658720 * RELEASE_ZONE3
    + 0.028494263462021570 * RELEASE_ZONE4;

fn decibels_to_linear(db: f32) -> f32 {
    10.0f32.powf(0.05 * db)
}

fn linear_to_decibels(linear: f32) -> f32 {
    // Floor at 1e-30 to prevent -inf (log10(0)) and NaN (log10(negative))
    // from propagating through the compressor gain chain.
    20.0 * linear.max(1e-30).log10()
}

fn discrete_time_constant_for_sample_rate(time_constant: f64, sample_rate: f64) -> f32 {
    (1.0 - (-1.0 / (sample_rate * time_constant)).exp()) as f32
}

fn ensure_finite(x: f32, default: f32) -> f32 {
    if x.is_finite() { x } else { default }
}

fn clamp(x: f32, lo: f32, hi: f32) -> f32 {
    x.max(lo).min(hi)
}

/// Chrome-compatible DynamicsCompressor.
/// Processes stereo interleaved audio.
pub struct ChromeCompressor {
    sample_rate: f32,
    // Static curve parameters
    ratio: f32,
    slope: f32,
    linear_threshold: f32,
    db_threshold: f32,
    db_knee: f32,
    knee_threshold: f32,
    db_knee_threshold: f32,
    db_yknee_threshold: f32,
    knee: f32,
    // Envelope state
    detector_average: f32,
    compressor_gain: f32,
    metering_gain: f32,
    metering_release_k: f32,
    db_max_attack_compression_diff: f32,
    // Pre-delay (lookahead) buffers — one per channel
    pre_delay_left: Vec<f32>,
    pre_delay_right: Vec<f32>,
    pre_delay_read_index: usize,
    pre_delay_write_index: usize,
    last_pre_delay_frames: usize,
    // Parameters
    param_threshold: f32,
    param_knee: f32,
    param_ratio: f32,
    param_attack: f32,
    param_release: f32,
}

impl ChromeCompressor {
    pub fn new(sample_rate: f32) -> Self {
        let sample_rate = if sample_rate <= 0.0 {
            log::warn!("ChromeCompressor: sample_rate must be > 0, defaulting to 44100");
            44100.0
        } else {
            sample_rate
        };
        let metering_release_k = discrete_time_constant_for_sample_rate(
            METERING_RELEASE_TIME_CONSTANT as f64,
            sample_rate as f64,
        );
        let mut comp = ChromeCompressor {
            sample_rate,
            ratio: -1.0,
            slope: -1.0,
            linear_threshold: -1.0,
            db_threshold: -1.0,
            db_knee: -1.0,
            knee_threshold: -1.0,
            db_knee_threshold: -1.0,
            db_yknee_threshold: -1.0,
            knee: -1.0,
            detector_average: 0.0,
            compressor_gain: 1.0,
            metering_gain: 1.0,
            metering_release_k,
            db_max_attack_compression_diff: -1.0,
            pre_delay_left: vec![0.0; MAX_PRE_DELAY_FRAMES],
            pre_delay_right: vec![0.0; MAX_PRE_DELAY_FRAMES],
            pre_delay_read_index: 0,
            pre_delay_write_index: DEFAULT_PRE_DELAY_FRAMES,
            last_pre_delay_frames: DEFAULT_PRE_DELAY_FRAMES,
            // Default parameters (same as Chrome)
            param_threshold: -24.0,
            param_knee: 30.0,
            param_ratio: 12.0,
            param_attack: 0.003,
            param_release: 0.250,
        };
        comp.set_pre_delay_time(PRE_DELAY);
        comp
    }

    pub fn set_threshold(&mut self, db: f32) { self.param_threshold = db; }
    pub fn set_knee(&mut self, db: f32) { self.param_knee = db; }
    pub fn set_ratio(&mut self, ratio: f32) { self.param_ratio = ratio.max(0.001); }
    pub fn set_attack(&mut self, seconds: f32) { self.param_attack = seconds; }
    pub fn set_release(&mut self, seconds: f32) { self.param_release = seconds.max(0.001); }

    /// Process interleaved stereo samples in-place.
    /// `samples` must have even length (L R L R ...).
    pub fn process(&mut self, samples: &mut [f32]) {
        let num_samples = samples.len() / 2; // stereo frames
        let k = self.update_static_curve_parameters(
            self.param_threshold,
            self.param_knee,
            self.param_ratio,
        );

        // Makeup gain with empirical/perceptual tuning
        let linear_post_gain = (1.0 / self.saturate(1.0, k)).powf(0.6);

        let attack_time = self.param_attack;
        let release_time = self.param_release;

        let attack_frames = (0.001f32.max(attack_time) * self.sample_rate) as f64;
        let release_frames = self.sample_rate * release_time;
        let sat_release_frames = SAT_RELEASE_TIME * self.sample_rate;

        // Adaptive release polynomial coefficients
        let a = release_frames * A_BASE;
        let b = release_frames * B_BASE;
        let c = release_frames * C_BASE;
        let d = release_frames * D_BASE;
        let e = release_frames * E_BASE;

        self.set_pre_delay_time(PRE_DELAY);

        // Round up to process all samples including the tail (num_samples % 32)
        let number_of_divisions = (num_samples + NUMBER_OF_DIVISION_FRAMES - 1) / NUMBER_OF_DIVISION_FRAMES;
        let mut frame_index = 0usize;

        for _ in 0..number_of_divisions {
            self.detector_average = ensure_finite(self.detector_average, 1.0);
            let desired_gain = clamp(self.detector_average, 0.0, 1.0);

            // Pre-warp so we get desired_gain after sin() warp below
            let scaled_desired_gain = desired_gain.asin() / FRAC_PI_2;

            // Envelope rate
            let is_releasing = scaled_desired_gain > self.compressor_gain;

            let db_compression_diff = if scaled_desired_gain == 0.0 {
                if is_releasing { -1.0 } else { 1.0 }
            } else {
                linear_to_decibels(self.compressor_gain / scaled_desired_gain)
            };

            let envelope_rate;

            if is_releasing {
                // Release mode
                self.db_max_attack_compression_diff = -1.0;
                let db_compression_diff = ensure_finite(db_compression_diff, -1.0);

                // Adaptive release: higher compression releases faster
                let mut x = clamp(db_compression_diff, -12.0, 0.0);
                x = 0.25 * (x + 12.0);

                let x2 = x * x;
                let x3 = x2 * x;
                let x4 = x2 * x2;
                let calc_release_frames = a + b * x + c * x2 + d * x3 + e * x4;

                let db_per_frame = 5.0 / calc_release_frames;
                envelope_rate = decibels_to_linear(db_per_frame);
            } else {
                // Attack mode
                let db_compression_diff = ensure_finite(db_compression_diff, 1.0);

                if self.db_max_attack_compression_diff == -1.0
                    || self.db_max_attack_compression_diff < db_compression_diff
                {
                    self.db_max_attack_compression_diff = db_compression_diff;
                }

                let db_eff_atten_diff = 0.5f32.max(self.db_max_attack_compression_diff);
                let x = 0.25 / db_eff_atten_diff as f64;
                envelope_rate = 1.0 - x.powf(1.0 / attack_frames) as f32;
            };

            // Inner loop — process 32 frames
            let mut pre_delay_read = self.pre_delay_read_index;
            let mut pre_delay_write = self.pre_delay_write_index;
            let mut detector_average = self.detector_average;
            let mut compressor_gain = self.compressor_gain;

            for _ in 0..NUMBER_OF_DIVISION_FRAMES {
                if frame_index >= num_samples {
                    break;
                }
                let li = frame_index * 2;
                let ri = frame_index * 2 + 1;

                let left = samples[li];
                let right = samples[ri];

                // Write to pre-delay
                self.pre_delay_left[pre_delay_write] = left;
                self.pre_delay_right[pre_delay_write] = right;

                // Max of abs values across channels (stereo-linked)
                let compressor_input = left.abs().max(right.abs());

                // Static compression curve
                let shaped_input = self.saturate(compressor_input, k);
                let attenuation = if compressor_input <= 0.0001 {
                    1.0
                } else {
                    shaped_input / compressor_input
                };

                // Detector with fast attack, exponential release
                let db_attenuation =
                    2.0f32.max(-linear_to_decibels(attenuation));
                let db_per_frame = db_attenuation / sat_release_frames;
                let sat_release_rate = decibels_to_linear(db_per_frame) - 1.0;

                let is_release = attenuation > detector_average;
                let rate = if is_release { sat_release_rate } else { 1.0 };

                detector_average += (attenuation - detector_average) * rate;
                detector_average = detector_average.min(1.0);
                detector_average = ensure_finite(detector_average, 1.0);

                // Exponential approach to desired gain
                if envelope_rate < 1.0 {
                    // Attack
                    compressor_gain +=
                        (scaled_desired_gain - compressor_gain) * envelope_rate;
                } else {
                    // Release
                    compressor_gain *= envelope_rate;
                    compressor_gain = compressor_gain.min(1.0);
                }

                // Post-warp
                let post_warp = (FRAC_PI_2 * compressor_gain).sin();
                let total_gain = linear_post_gain * post_warp;

                // Metering
                let db_real_gain = linear_to_decibels(post_warp);
                if db_real_gain < self.metering_gain {
                    self.metering_gain = db_real_gain;
                } else {
                    self.metering_gain +=
                        (db_real_gain - self.metering_gain) * self.metering_release_k;
                }

                // Apply gain from pre-delayed signal
                samples[li] = self.pre_delay_left[pre_delay_read] * total_gain;
                samples[ri] = self.pre_delay_right[pre_delay_read] * total_gain;

                frame_index += 1;
                pre_delay_read = (pre_delay_read + 1) & MAX_PRE_DELAY_FRAMES_MASK;
                pre_delay_write = (pre_delay_write + 1) & MAX_PRE_DELAY_FRAMES_MASK;
            }

            self.pre_delay_read_index = pre_delay_read;
            self.pre_delay_write_index = pre_delay_write;
            // Flush denormals
            self.detector_average = flush_denormal(detector_average);
            self.compressor_gain = flush_denormal(compressor_gain);
        }
    }

    // ── Static compression curve ──

    /// Exponential knee curve, 1st-derivative matched at linear_threshold.
    fn knee_curve(&self, x: f32, k: f32) -> f32 {
        if x < self.linear_threshold {
            return x;
        }
        self.linear_threshold
            + (1.0 - (-k * (x - self.linear_threshold)).exp()) / k
    }

    /// Full compression curve: knee + constant ratio after knee.
    fn saturate(&self, x: f32, k: f32) -> f32 {
        if x < self.knee_threshold {
            return self.knee_curve(x, k);
        }
        let db_x = linear_to_decibels(x);
        let db_y = self.db_yknee_threshold + self.slope * (db_x - self.db_knee_threshold);
        decibels_to_linear(db_y)
    }

    /// Binary search for knee parameter k that gives the desired slope.
    fn k_at_slope(&self, desired_slope: f32) -> f32 {
        let db_x = self.db_threshold + self.db_knee;
        let x = decibels_to_linear(db_x);
        let mut x2 = 1.0f32;
        let mut db_x2 = 0.0f32;

        if !(x < self.linear_threshold) {
            x2 = x * 1.001;
            db_x2 = linear_to_decibels(x2);
        }

        let mut min_k = 0.1f32;
        let mut max_k = 10000.0f32;
        let mut k = 5.0f32;

        for _ in 0..15 {
            if !(x < self.linear_threshold) {
                let db_y = linear_to_decibels(self.knee_curve(x, k));
                let db_y2 = linear_to_decibels(self.knee_curve(x2, k));
                let slope = (db_y2 - db_y) / (db_x2 - db_x);
                if slope < desired_slope {
                    max_k = k;
                } else {
                    min_k = k;
                }
            }
            k = (min_k * max_k).sqrt();
        }

        k
    }

    fn update_static_curve_parameters(
        &mut self,
        db_threshold: f32,
        db_knee: f32,
        ratio: f32,
    ) -> f32 {
        if db_threshold != self.db_threshold
            || db_knee != self.db_knee
            || ratio != self.ratio
        {
            self.db_threshold = db_threshold;
            self.linear_threshold = decibels_to_linear(db_threshold);
            self.db_knee = db_knee;
            self.ratio = ratio;
            self.slope = 1.0 / ratio;

            let k = self.k_at_slope(1.0 / ratio);

            self.db_knee_threshold = db_threshold + db_knee;
            self.knee_threshold = decibels_to_linear(self.db_knee_threshold);
            self.db_yknee_threshold =
                linear_to_decibels(self.knee_curve(self.knee_threshold, k));
            self.knee = k;
        }
        self.knee
    }

    fn set_pre_delay_time(&mut self, pre_delay_time: f32) {
        let mut pre_delay_frames =
            (pre_delay_time * self.sample_rate) as usize;
        if pre_delay_frames > MAX_PRE_DELAY_FRAMES - 1 {
            pre_delay_frames = MAX_PRE_DELAY_FRAMES - 1;
        }
        if self.last_pre_delay_frames != pre_delay_frames {
            self.last_pre_delay_frames = pre_delay_frames;
            self.pre_delay_left.fill(0.0);
            self.pre_delay_right.fill(0.0);
            self.pre_delay_read_index = 0;
            self.pre_delay_write_index = pre_delay_frames;
        }
    }

    pub fn reset(&mut self) {
        self.detector_average = 0.0;
        self.compressor_gain = 1.0;
        self.metering_gain = 1.0;
        self.pre_delay_left.fill(0.0);
        self.pre_delay_right.fill(0.0);
        self.pre_delay_read_index = 0;
        self.pre_delay_write_index = DEFAULT_PRE_DELAY_FRAMES;
        self.db_max_attack_compression_diff = -1.0;
    }
}

fn flush_denormal(x: f32) -> f32 {
    if x.abs() < f32::MIN_POSITIVE { 0.0 } else { x }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_input_no_nan() {
        let mut comp = ChromeCompressor::new(44100.0);
        let mut samples = vec![0.0f32; 256];
        comp.process(&mut samples);
        assert!(samples.iter().all(|s| s.is_finite()),
            "silence should not produce NaN/Inf");
    }

    #[test]
    fn extreme_parameters_no_nan() {
        let mut comp = ChromeCompressor::new(44100.0);
        comp.set_threshold(-100.0);
        comp.set_knee(40.0);
        comp.set_ratio(0.0); // clamped to 0.001
        comp.set_attack(0.0);
        comp.set_release(0.0); // clamped to 0.001
        let mut samples: Vec<f32> = (0..256).map(|i| (i as f32 / 256.0 * std::f32::consts::TAU).sin()).collect();
        comp.process(&mut samples);
        assert!(samples.iter().all(|s| s.is_finite()),
            "extreme parameters should not produce NaN/Inf");
    }

    #[test]
    fn process_empty_buffer() {
        let mut comp = ChromeCompressor::new(44100.0);
        let mut samples: Vec<f32> = vec![];
        comp.process(&mut samples);
    }

    #[test]
    fn process_single_frame() {
        let mut comp = ChromeCompressor::new(44100.0);
        let mut samples = vec![0.5f32, -0.3];
        comp.process(&mut samples);
        assert!(samples.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn reset_then_process() {
        let mut comp = ChromeCompressor::new(44100.0);
        let mut samples = vec![1.0f32; 128];
        comp.process(&mut samples);
        comp.reset();
        let mut samples2 = vec![0.5f32; 128];
        comp.process(&mut samples2);
        assert!(samples2.iter().all(|s| s.is_finite()),
            "should work correctly after reset");
    }

    #[test]
    fn max_amplitude_input() {
        let mut comp = ChromeCompressor::new(44100.0);
        comp.set_threshold(-24.0);
        comp.set_ratio(12.0);
        let mut samples: Vec<f32> = (0..256).map(|_| 1.0).collect();
        comp.process(&mut samples);
        assert!(samples.iter().all(|s| s.is_finite()),
            "max amplitude should not produce NaN/Inf");
    }

    #[test]
    fn ratio_clamped_to_minimum() {
        let mut comp = ChromeCompressor::new(44100.0);
        comp.set_ratio(0.0);
        assert!(comp.param_ratio >= 0.001, "ratio should be clamped");
    }

    #[test]
    fn release_clamped_to_minimum() {
        let mut comp = ChromeCompressor::new(44100.0);
        comp.set_release(0.0);
        assert!(comp.param_release >= 0.001, "release should be clamped");
    }
}
