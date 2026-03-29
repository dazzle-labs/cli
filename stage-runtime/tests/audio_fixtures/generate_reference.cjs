#!/usr/bin/env node
// Generate audio reference data from Chrome's Web Audio API via OfflineAudioContext.
//
// Renders each test scene for exactly 1 frame (1470 samples at 44100Hz/30fps)
// and exports raw PCM f32 stereo interleaved data as JSON.
//
// Usage: node generate_reference.cjs
//
// Output: audio_reference.json

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const FPS = 30;
const SAMPLES_PER_FRAME = Math.floor(SAMPLE_RATE / FPS); // 1470
const DEFAULT_FRAMES = 3;

// Test scenes: each defines Web Audio API calls and expected behavior
const scenes = [
  // === Basic waveforms ===
  {
    name: 'sine_440',
    description: 'Single 440Hz sine oscillator → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'square_440',
    description: 'Single 440Hz square oscillator → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'sawtooth_440',
    description: 'Single 440Hz sawtooth oscillator → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'triangle_440',
    description: 'Single 440Hz triangle oscillator → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'sine_880',
    description: 'Single 880Hz sine oscillator → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 880;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'silence',
    description: 'No oscillators, should produce silence',
    setup: `
      // nothing
    `,
  },

  // === Gain routing ===
  {
    name: 'gain_half',
    description: '440Hz sine → gain(0.5) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'gain_quarter',
    description: '440Hz sawtooth → gain(0.25) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'gain_chain',
    description: '440Hz sine → gain(0.8) → gain(0.5) → destination (cascaded gains)',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const g1 = ctx.createGain();
      g1.gain.value = 0.8;
      const g2 = ctx.createGain();
      g2.gain.value = 0.5;
      osc.connect(g1);
      g1.connect(g2);
      g2.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // === Multi-oscillator scenes ===
  {
    name: 'two_oscillators',
    description: '440Hz sine + 660Hz sine → destination (chord)',
    setup: `
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 440;
      osc1.connect(ctx.destination);
      osc1.start(0);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 660;
      osc2.connect(ctx.destination);
      osc2.start(0);
    `,
  },
  {
    name: 'three_osc_chord',
    description: 'Major triad: 440 + 554.37 + 659.26 Hz sine → destination',
    setup: `
      for (const freq of [440, 554.37, 659.26]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(ctx.destination);
        osc.start(0);
      }
    `,
  },
  {
    name: 'mixed_waveforms',
    description: 'sine(440) + square(220) + triangle(880) → destination',
    setup: `
      const types = [['sine', 440], ['square', 220], ['triangle', 880]];
      for (const [type, freq] of types) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(ctx.destination);
        osc.start(0);
      }
    `,
  },
  {
    name: 'detuned_beating',
    description: '440Hz + 441Hz sine → destination (1Hz beating pattern)',
    num_frames: 30, // 1 second to capture full beat cycle
    setup: `
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 440;
      osc1.connect(ctx.destination);
      osc1.start(0);

      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 441;
      osc2.connect(ctx.destination);
      osc2.start(0);
    `,
  },

  // === Extreme frequencies (band-limiting stress) ===
  {
    name: 'square_high',
    description: '8000Hz square — few harmonics below Nyquist',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 8000;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'sawtooth_high',
    description: '8000Hz sawtooth — few harmonics below Nyquist',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 8000;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'sine_low',
    description: '55Hz sine — sub-bass, long wavelength',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'sawtooth_low',
    description: '80Hz sawtooth — bass, many harmonics (275)',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 80;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // === Gain routing with mixed waveforms ===
  {
    name: 'parallel_gains',
    description: 'Two oscillators through separate gains: sine(440)→gain(0.7) + square(330)→gain(0.3) → destination',
    setup: `
      const osc1 = ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.value = 440;
      const g1 = ctx.createGain();
      g1.gain.value = 0.7;
      osc1.connect(g1);
      g1.connect(ctx.destination);
      osc1.start(0);

      const osc2 = ctx.createOscillator();
      osc2.type = 'square';
      osc2.frequency.value = 330;
      const g2 = ctx.createGain();
      g2.gain.value = 0.3;
      osc2.connect(g2);
      g2.connect(ctx.destination);
      osc2.start(0);
    `,
  },

  // === Phase continuity over many frames ===
  {
    name: 'long_sine',
    description: '440Hz sine over 30 frames — tests phase drift',
    num_frames: 30,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'long_square',
    description: '440Hz square over 30 frames — tests wavetable phase drift',
    num_frames: 30,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 440;
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // BiquadFilterNode — all 8 filter types
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'biquad_lowpass',
    description: 'Sawtooth 440Hz → lowpass filter at 500Hz → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      f.Q.value = 1;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_highpass',
    description: 'Sawtooth 440Hz → highpass filter at 2000Hz → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 2000;
      f.Q.value = 1;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_bandpass',
    description: 'Sawtooth 440Hz → bandpass filter at 1000Hz Q=5 → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1000;
      f.Q.value = 5;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_notch',
    description: 'Sawtooth 440Hz → notch filter at 880Hz → destination (remove 2nd harmonic)',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'notch';
      f.frequency.value = 880;
      f.Q.value = 10;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_allpass',
    description: 'Sine 440Hz → allpass filter at 1000Hz → destination (phase shift only)',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'allpass';
      f.frequency.value = 1000;
      f.Q.value = 1;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_peaking',
    description: 'Sawtooth 440Hz → peaking EQ at 440Hz +12dB → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'peaking';
      f.frequency.value = 440;
      f.Q.value = 2;
      f.gain.value = 12;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_lowshelf',
    description: 'Sawtooth 440Hz → lowshelf at 200Hz +6dB → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'lowshelf';
      f.frequency.value = 200;
      f.gain.value = 6;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'biquad_highshelf',
    description: 'Sawtooth 440Hz → highshelf at 3000Hz +6dB → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'highshelf';
      f.frequency.value = 3000;
      f.gain.value = 6;
      osc.connect(f);
      f.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // DelayNode
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'delay_100ms',
    description: 'Sine 440Hz → delay 100ms → destination (first 100ms should be silence)',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const d = ctx.createDelay(1.0);
      d.delayTime.value = 0.1;
      osc.connect(d);
      d.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'delay_chain',
    description: 'Sine 440Hz → delay(50ms) → delay(50ms) → destination (100ms total delay)',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const d1 = ctx.createDelay(1.0);
      d1.delayTime.value = 0.05;
      const d2 = ctx.createDelay(1.0);
      d2.delayTime.value = 0.05;
      osc.connect(d1);
      d1.connect(d2);
      d2.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // DynamicsCompressorNode
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'compressor_basic',
    description: 'Sawtooth 220Hz → compressor(threshold=-24, ratio=4) → destination',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 220;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 30;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // StereoPannerNode
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'pan_left',
    description: 'Sine 440Hz → pan left (-1) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const pan = ctx.createStereoPanner();
      pan.pan.value = -1;
      osc.connect(pan);
      pan.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'pan_right',
    description: 'Sine 440Hz → pan right (+1) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const pan = ctx.createStereoPanner();
      pan.pan.value = 1;
      osc.connect(pan);
      pan.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'pan_center',
    description: 'Sine 440Hz → pan center (0) → destination (should equal no panner)',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const pan = ctx.createStereoPanner();
      pan.pan.value = 0;
      osc.connect(pan);
      pan.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // WaveShaperNode
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'waveshaper_clip',
    description: 'Sine 440Hz → hard clip waveshaper → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.value = 2.0; // overdrive into clipping
      const shaper = ctx.createWaveShaper();
      // Hard clip transfer function
      const n = 256;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.max(-0.5, Math.min(0.5, x));
      }
      shaper.curve = curve;
      osc.connect(gain);
      gain.connect(shaper);
      shaper.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // ConstantSourceNode
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'constant_source',
    description: 'ConstantSourceNode(offset=0.5) → destination (DC signal)',
    setup: `
      const cs = ctx.createConstantSource();
      cs.offset.value = 0.5;
      cs.connect(ctx.destination);
      cs.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // AudioParam scheduling
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'param_set_value_at_time',
    description: 'Sine 440Hz, frequency jumps to 880Hz at t=0.05s (frame ~2)',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, 0);
      osc.frequency.setValueAtTime(880, 0.05);
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'param_linear_ramp',
    description: 'Sine frequency ramps linearly 440→880 over 0.1s',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, 0);
      osc.frequency.linearRampToValueAtTime(880, 0.1);
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'param_exponential_ramp',
    description: 'Sine frequency ramps exponentially 440→880 over 0.1s',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, 0);
      osc.frequency.exponentialRampToValueAtTime(880, 0.1);
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'param_set_target',
    description: 'Sine frequency approaches 880Hz from 440Hz with timeConstant=0.05',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, 0);
      osc.frequency.setTargetAtTime(880, 0.0, 0.05);
      osc.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'param_gain_linear_ramp',
    description: 'Sine 440Hz → gain ramps 0→1 over 0.1s (fade in)',
    num_frames: 10,
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(1, 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(0);
    `,
  },

  // ════════════════════════════════════════════════════════════════════
  // Complex routing patterns
  // ════════════════════════════════════════════════════════════════════
  {
    name: 'routing_long_chain',
    description: 'Sine 440Hz → gain(0.9) → gain(0.9) → gain(0.9) → gain(0.9) → gain(0.9) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      let prev = osc;
      for (let i = 0; i < 5; i++) {
        const g = ctx.createGain();
        g.gain.value = 0.9;
        prev.connect(g);
        prev = g;
      }
      prev.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'routing_fanout',
    description: 'One osc → 4 separate gains(0.25 each) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440;
      for (let i = 0; i < 4; i++) {
        const g = ctx.createGain();
        g.gain.value = 0.25;
        osc.connect(g);
        g.connect(ctx.destination);
      }
      osc.start(0);
    `,
  },
  {
    name: 'routing_biquad_chain',
    description: 'Sawtooth 440Hz → lowpass(800Hz) → highpass(200Hz) → destination (bandpass via chain)',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 800;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 200;
      osc.connect(lp);
      lp.connect(hp);
      hp.connect(ctx.destination);
      osc.start(0);
    `,
  },
  {
    name: 'routing_filter_gain_chain',
    description: 'Sawtooth 440Hz → lowpass(1000Hz) → gain(0.5) → destination',
    setup: `
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 440;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      osc.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      osc.start(0);
    `,
  },
];

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  const results = {};

  for (const scene of scenes) {
    const numFrames = scene.num_frames || DEFAULT_FRAMES;
    const totalSamples = SAMPLES_PER_FRAME * numFrames;
    const page = await browser.newPage();
    const errors = [];
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    try {
      const data = await page.evaluate(`(async function() {
        const ctx = new OfflineAudioContext(2, ${totalSamples}, ${SAMPLE_RATE});
        ${scene.setup}
        const buffer = await ctx.startRendering();
        const left = Array.from(buffer.getChannelData(0));
        const right = Array.from(buffer.getChannelData(1));
        // Interleave stereo
        const interleaved = new Array(left.length * 2);
        for (let i = 0; i < left.length; i++) {
          interleaved[i * 2] = left[i];
          interleaved[i * 2 + 1] = right[i];
        }
        return interleaved;
      })()`);

      if (errors.length > 0) {
        console.error(`  ${scene.name}: ${errors.join('; ')}`);
      }

      // Split into per-frame chunks
      const frames = [];
      for (let f = 0; f < numFrames; f++) {
        const start = f * SAMPLES_PER_FRAME * 2;
        const end = start + SAMPLES_PER_FRAME * 2;
        frames.push(data.slice(start, end));
      }

      results[scene.name] = {
        description: scene.description,
        sample_rate: SAMPLE_RATE,
        fps: FPS,
        samples_per_frame: SAMPLES_PER_FRAME,
        num_frames: numFrames,
        frames,
      };

      // Quick sanity check
      const maxAbs = Math.max(...data.map(Math.abs));
      console.log(`  ${scene.name}: ${numFrames} frames, ${data.length} samples, max: ${maxAbs.toFixed(4)}`);
    } catch (e) {
      console.error(`  ${scene.name}: FAILED — ${e.message}`);
    }

    await page.close();
  }

  await browser.close();

  const outPath = path.join(__dirname, 'audio_reference.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
