// Web Audio API polyfill for stage-runtime
// Provides AudioContext with node creation that pushes commands
// to __dz_audio_cmds for Rust-side processing.

(function() {
  var sampleRate = 44100;

  // Command buffer — Rust drains this each frame to sync audio graph state.
  globalThis.__dz_audio_cmds = [];
  // Mono-mixed audio samples from Rust (set each frame after render_frame).
  // AnalyserNode reads this for FFT computation. Empty until first audio frame.
  globalThis.__dz_audio_samples = [];
  function audioCmd() { __dz_audio_cmds.push(Array.prototype.slice.call(arguments)); }

  // ── AudioParam ────────────────────────────────────────────────────
  // When cmdName is set, changing .value emits [cmdName, nodeId, newValue].
  // Scheduling methods emit param automation commands.

  function AudioParam(defaultValue, nodeId, paramName) {
    this._value = defaultValue;
    this._nodeId = nodeId || 0;
    this._paramName = paramName || null;
    this.defaultValue = defaultValue;
    this.minValue = -3.4e38;
    this.maxValue = 3.4e38;
  }
  Object.defineProperty(AudioParam.prototype, 'value', {
    get: function() { return this._value; },
    set: function(v) {
      this._value = v;
      if (this._paramName) audioCmd('param_set', this._nodeId, this._paramName, v);
    }
  });
  AudioParam.prototype.setValueAtTime = function(v, t) {
    if (this._paramName) audioCmd('param_setValueAtTime', this._nodeId, this._paramName, v, t);
    else this._value = v;
    return this;
  };
  AudioParam.prototype.linearRampToValueAtTime = function(v, t) {
    if (this._paramName) audioCmd('param_linearRamp', this._nodeId, this._paramName, v, t);
    else this._value = v;
    return this;
  };
  AudioParam.prototype.exponentialRampToValueAtTime = function(v, t) {
    if (this._paramName) audioCmd('param_exponentialRamp', this._nodeId, this._paramName, v, t);
    else this._value = v;
    return this;
  };
  AudioParam.prototype.setTargetAtTime = function(target, startTime, timeConstant) {
    if (this._paramName) audioCmd('param_setTarget', this._nodeId, this._paramName, target, startTime, timeConstant);
    return this;
  };
  AudioParam.prototype.setValueCurveAtTime = function(values, startTime, duration) {
    if (this._paramName) audioCmd('param_setValueCurve', this._nodeId, this._paramName, Array.prototype.slice.call(values), startTime, duration);
    return this;
  };
  AudioParam.prototype.cancelScheduledValues = function(startTime) {
    if (this._paramName) audioCmd('param_cancel', this._nodeId, this._paramName, startTime);
    return this;
  };
  AudioParam.prototype.cancelAndHoldAtTime = function(cancelTime) {
    if (this._paramName) audioCmd('param_cancel', this._nodeId, this._paramName, cancelTime);
    return this;
  };

  // ── AudioNode base ────────────────────────────────────────────────

  var __dz_audio_next_id = 1;
  function AudioNode() { this._id = __dz_audio_next_id++; this.numberOfInputs = 1; this.numberOfOutputs = 1; this.channelCount = 2; this.channelCountMode = 'max'; this.channelInterpretation = 'speakers'; }
  AudioNode.prototype.connect = function(dest, outputIdx, inputIdx) { audioCmd('connect', this._id, dest._id || 'destination'); return dest; };
  AudioNode.prototype.disconnect = function() { audioCmd('disconnect', this._id); };
  AudioNode.prototype.addEventListener = function() {};
  AudioNode.prototype.removeEventListener = function() {};

  // ── AudioDestinationNode ──────────────────────────────────────────

  function AudioDestinationNode() { this._id = 'destination'; this.numberOfInputs = 1; this.numberOfOutputs = 0; this.maxChannelCount = 2; this.channelCount = 2; }
  AudioDestinationNode.prototype = Object.create(AudioNode.prototype);

  // ── OscillatorNode ────────────────────────────────────────────────

  function OscillatorNode(ctx) {
    AudioNode.call(this);
    audioCmd('osc_create', this._id);
    this.frequency = new AudioParam(440, this._id, 'frequency');
    this.detune = new AudioParam(0, this._id, 'detune');
    this.type = 'sine';
    this.context = ctx;
    this._started = false;
  }
  OscillatorNode.prototype = Object.create(AudioNode.prototype);
  OscillatorNode.prototype.start = function(t) {
    this._started = true;
    audioCmd('osc_start', this._id, this.type, this.frequency._value, t || 0);
  };
  OscillatorNode.prototype.stop = function(t) { audioCmd('osc_stop', this._id, t || 0); };
  OscillatorNode.prototype.setPeriodicWave = function(wave) { this.type = 'custom'; };

  // ── GainNode ──────────────────────────────────────────────────────

  function GainNode(ctx) {
    AudioNode.call(this);
    audioCmd('gain_create', this._id, 1);
    this.gain = new AudioParam(1, this._id, 'gain');
    this.context = ctx;
  }
  GainNode.prototype = Object.create(AudioNode.prototype);

  // ── BiquadFilterNode ──────────────────────────────────────────────

  function BiquadFilterNode(ctx) {
    AudioNode.call(this);
    audioCmd('biquad_create', this._id, 'lowpass');
    this.frequency = new AudioParam(350, this._id, 'frequency');
    this.Q = new AudioParam(1, this._id, 'Q');
    this.gain = new AudioParam(0, this._id, 'gain');
    this._type = 'lowpass';
    this.context = ctx;
  }
  BiquadFilterNode.prototype = Object.create(AudioNode.prototype);
  Object.defineProperty(BiquadFilterNode.prototype, 'type', {
    get: function() { return this._type; },
    set: function(v) { this._type = v; audioCmd('biquad_type', this._id, v); }
  });
  BiquadFilterNode.prototype.getFrequencyResponse = function(freqHz, magResponse, phaseResponse) {};

  // ── DelayNode ─────────────────────────────────────────────────────

  function DelayNode(ctx, maxDelayTime) {
    AudioNode.call(this);
    var maxTime = maxDelayTime || 1.0;
    audioCmd('delay_create', this._id, maxTime);
    this.delayTime = new AudioParam(0, this._id, 'delayTime');
    this.context = ctx;
  }
  DelayNode.prototype = Object.create(AudioNode.prototype);

  // ── DynamicsCompressorNode ────────────────────────────────────────

  function DynamicsCompressorNode(ctx) {
    AudioNode.call(this);
    audioCmd('compressor_create', this._id);
    this.threshold = new AudioParam(-24, this._id, 'threshold');
    this.knee = new AudioParam(30, this._id, 'knee');
    this.ratio = new AudioParam(12, this._id, 'ratio');
    this.attack = new AudioParam(0.003, this._id, 'attack');
    this.release = new AudioParam(0.25, this._id, 'release');
    this.reduction = 0;
    this.context = ctx;
  }
  DynamicsCompressorNode.prototype = Object.create(AudioNode.prototype);

  // ── StereoPannerNode ──────────────────────────────────────────────

  function StereoPannerNode(ctx) {
    AudioNode.call(this);
    audioCmd('panner_create', this._id);
    this.pan = new AudioParam(0, this._id, 'pan');
    this.context = ctx;
  }
  StereoPannerNode.prototype = Object.create(AudioNode.prototype);

  // ── WaveShaperNode ────────────────────────────────────────────────

  function WaveShaperNode(ctx) {
    AudioNode.call(this);
    audioCmd('shaper_create', this._id);
    this._curve = null;
    this._oversample = 'none';
    this.context = ctx;
  }
  WaveShaperNode.prototype = Object.create(AudioNode.prototype);
  Object.defineProperty(WaveShaperNode.prototype, 'curve', {
    get: function() { return this._curve; },
    set: function(v) {
      this._curve = v;
      if (v) audioCmd('shaper_curve', this._id, Array.prototype.slice.call(v));
    }
  });
  Object.defineProperty(WaveShaperNode.prototype, 'oversample', {
    get: function() { return this._oversample; },
    set: function(v) { this._oversample = v; audioCmd('shaper_oversample', this._id, v); }
  });

  // ── AudioBufferSourceNode ─────────────────────────────────────────

  function AudioBufferSourceNode(ctx) {
    AudioNode.call(this);
    audioCmd('source_create', this._id);
    this._buffer = null;
    this.playbackRate = new AudioParam(1, this._id, 'playbackRate');
    this.detune = new AudioParam(0, this._id, 'detune');
    this.loop = false;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.context = ctx;
    this.numberOfInputs = 0;
  }
  AudioBufferSourceNode.prototype = Object.create(AudioNode.prototype);
  Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', {
    get: function() { return this._buffer; },
    set: function(v) {
      this._buffer = v;
      if (v && v.getChannelData) {
        // Send all channels, not just channel 0
        var channels = [];
        for (var c = 0; c < v.numberOfChannels; c++) {
          channels.push(Array.prototype.slice.call(v.getChannelData(c)));
        }
        audioCmd('source_buffer', this._id, channels);
      }
    }
  });
  AudioBufferSourceNode.prototype.start = function(when, offset, duration) {
    audioCmd('source_start', this._id);
    if (this.loop) audioCmd('source_loop', this._id, true);
  };
  AudioBufferSourceNode.prototype.stop = function(when) { audioCmd('source_stop', this._id); };

  // ── ConstantSourceNode ────────────────────────────────────────────

  function ConstantSourceNode(ctx) {
    AudioNode.call(this);
    audioCmd('constant_create', this._id);
    this.offset = new AudioParam(1, this._id, 'offset');
    this.context = ctx;
    this.numberOfInputs = 0;
  }
  ConstantSourceNode.prototype = Object.create(AudioNode.prototype);
  ConstantSourceNode.prototype.start = function(when) { audioCmd('constant_start', this._id); };
  ConstantSourceNode.prototype.stop = function(when) { audioCmd('constant_stop', this._id); };

  // ── ConvolverNode ─────────────────────────────────────────────────

  function ConvolverNode(ctx) {
    AudioNode.call(this);
    audioCmd('convolver_create', this._id);
    this.buffer = null;
    this.normalize = true;
    this.context = ctx;
  }
  ConvolverNode.prototype = Object.create(AudioNode.prototype);

  // ── IIRFilterNode ─────────────────────────────────────────────────

  function IIRFilterNode(ctx, feedforward, feedback) {
    AudioNode.call(this);
    audioCmd('iir_create', this._id, feedforward, feedback);
    this.context = ctx;
  }
  IIRFilterNode.prototype = Object.create(AudioNode.prototype);
  IIRFilterNode.prototype.getFrequencyResponse = function(freqHz, magResponse, phaseResponse) {};

  // ── ChannelMergerNode ─────────────────────────────────────────────

  function ChannelMergerNode(ctx, numberOfInputs) {
    AudioNode.call(this);
    audioCmd('merger_create', this._id);
    this.numberOfInputs = numberOfInputs || 6;
    this.context = ctx;
  }
  ChannelMergerNode.prototype = Object.create(AudioNode.prototype);

  // ── ChannelSplitterNode ───────────────────────────────────────────

  function ChannelSplitterNode(ctx, numberOfOutputs) {
    AudioNode.call(this);
    audioCmd('splitter_create', this._id);
    this.numberOfOutputs = numberOfOutputs || 6;
    this.context = ctx;
  }
  ChannelSplitterNode.prototype = Object.create(AudioNode.prototype);

  // ── AnalyserNode ──────────────────────────────────────────────────

  // Radix-2 Cooley-Tukey FFT (in-place, O(N log N))
  // re/im are Float64Arrays of length N (must be power of 2)
  function _fft(re, im, N) {
    // Bit-reversal permutation
    for (var i = 1, j = 0; i < N; i++) {
      var bit = N >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        var tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }
    // Butterfly stages
    for (var len = 2; len <= N; len <<= 1) {
      var half = len >> 1;
      var angle = -2 * Math.PI / len;
      var wRe = Math.cos(angle), wIm = Math.sin(angle);
      for (var i = 0; i < N; i += len) {
        var curRe = 1, curIm = 0;
        for (var k = 0; k < half; k++) {
          var evenIdx = i + k, oddIdx = i + k + half;
          var tRe = curRe * re[oddIdx] - curIm * im[oddIdx];
          var tIm = curRe * im[oddIdx] + curIm * re[oddIdx];
          re[oddIdx] = re[evenIdx] - tRe;
          im[oddIdx] = im[evenIdx] - tIm;
          re[evenIdx] += tRe;
          im[evenIdx] += tIm;
          var nextRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe;
          curRe = nextRe;
        }
      }
    }
  }

  function AnalyserNode(ctx) {
    AudioNode.call(this);
    audioCmd('analyser_create', this._id);
    this.fftSize = 2048;
    this.frequencyBinCount = 1024;
    this.minDecibels = -100;
    this.maxDecibels = -30;
    this.smoothingTimeConstant = 0.8;
    this.context = ctx;
    // Internal buffers for FFT computation
    this._prevMagnitudes = null; // for smoothing
  }
  AnalyserNode.prototype = Object.create(AudioNode.prototype);

  // Read time-domain samples from Rust-rendered audio (set each frame as __dz_audio_samples)
  // Returns a Float64Array of fftSize samples, zero-padded if needed.
  AnalyserNode.prototype._getTimeDomain = function() {
    var fftSize = this.fftSize;
    var td = new Float64Array(fftSize);
    var samples = globalThis.__dz_audio_samples;
    if (samples && samples.length > 0) {
      var len = Math.min(samples.length, fftSize);
      for (var i = 0; i < len; i++) td[i] = samples[i];
    }
    return td;
  };

  AnalyserNode.prototype.getFloatTimeDomainData = function(arr) {
    var td = this._getTimeDomain();
    var len = Math.min(arr.length, this.fftSize);
    for (var i = 0; i < len; i++) arr[i] = td[i];
  };

  AnalyserNode.prototype.getByteTimeDomainData = function(arr) {
    var td = this._getTimeDomain();
    var len = Math.min(arr.length, this.fftSize);
    for (var i = 0; i < len; i++) {
      // Map [-1, 1] float to [0, 255] byte (128 = silence/zero)
      arr[i] = Math.max(0, Math.min(255, Math.round(128 + td[i] * 128)));
    }
  };

  AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
    var fftSize = this.fftSize;
    var binCount = fftSize / 2;
    var td = this._getTimeDomain();
    var re = new Float64Array(fftSize);
    var im = new Float64Array(fftSize);
    // Apply Blackman window (matches Chrome's AnalyserNode)
    var a0 = 0.42, a1 = 0.5, a2 = 0.08;
    for (var i = 0; i < fftSize; i++) {
      var w = a0 - a1 * Math.cos(2 * Math.PI * i / fftSize) + a2 * Math.cos(4 * Math.PI * i / fftSize);
      re[i] = td[i] * w;
    }
    _fft(re, im, fftSize);
    // Compute magnitudes with smoothing
    var smooth = this.smoothingTimeConstant;
    if (!this._prevMagnitudes || this._prevMagnitudes.length !== binCount) {
      this._prevMagnitudes = new Float64Array(binCount);
    }
    var prev = this._prevMagnitudes;
    var len = Math.min(arr.length, binCount);
    for (var i = 0; i < len; i++) {
      var mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / fftSize;
      // Apply time smoothing
      mag = smooth * prev[i] + (1 - smooth) * mag;
      prev[i] = mag;
      arr[i] = 20 * Math.log10(Math.max(mag, 1e-20));
    }
  };

  AnalyserNode.prototype.getByteFrequencyData = function(arr) {
    var binCount = this.fftSize / 2;
    var minDb = this.minDecibels;
    var maxDb = this.maxDecibels;
    // Use a temporary Float32Array for the float frequency data
    var floatData = new Float32Array(binCount);
    this.getFloatFrequencyData(floatData);
    var len = Math.min(arr.length, binCount);
    var range = maxDb - minDb;
    for (var i = 0; i < len; i++) {
      var scaled = 255 * (floatData[i] - minDb) / range;
      arr[i] = Math.max(0, Math.min(255, Math.round(scaled)));
    }
  };

  // ── PeriodicWave ──────────────────────────────────────────────────

  function PeriodicWave(ctx, options) {
    this.real = (options && options.real) || null;
    this.imag = (options && options.imag) || null;
  }

  // ── AudioBuffer ───────────────────────────────────────────────────

  function AudioBuffer(options) {
    var channels = (options && options.numberOfChannels) || 1;
    var length = (options && options.length) || 0;
    var sr = (options && options.sampleRate) || sampleRate;
    var bufs = [];
    for (var i = 0; i < channels; i++) bufs.push(new Float32Array(length));
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sr;
    this.duration = length / sr;
    this.getChannelData = function(ch) { return bufs[ch]; };
    this.copyFromChannel = function(dest, ch, offset) {
      var src = bufs[ch];
      var off = offset || 0;
      for (var i = 0; i < dest.length && (i + off) < src.length; i++) dest[i] = src[i + off];
    };
    this.copyToChannel = function(src, ch, offset) {
      var dest = bufs[ch];
      var off = offset || 0;
      for (var i = 0; i < src.length && (i + off) < dest.length; i++) dest[i + off] = src[i];
    };
  }

  // ── AudioContext ──────────────────────────────────────────────────

  function AudioContext() {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new AudioDestinationNode();
    this.listener = { positionX: new AudioParam(0), positionY: new AudioParam(0), positionZ: new AudioParam(0), forwardX: new AudioParam(0), forwardY: new AudioParam(0), forwardZ: new AudioParam(-1), upX: new AudioParam(0), upY: new AudioParam(1), upZ: new AudioParam(0) };
  }

  AudioContext.prototype.createGain = function() { return new GainNode(this); };
  AudioContext.prototype.createOscillator = function() { return new OscillatorNode(this); };
  AudioContext.prototype.createAnalyser = function() { return new AnalyserNode(this); };
  AudioContext.prototype.createBiquadFilter = function() { return new BiquadFilterNode(this); };
  AudioContext.prototype.createBufferSource = function() { return new AudioBufferSourceNode(this); };
  AudioContext.prototype.createDelay = function(maxTime) { return new DelayNode(this, maxTime); };
  AudioContext.prototype.createDynamicsCompressor = function() { return new DynamicsCompressorNode(this); };
  AudioContext.prototype.createStereoPanner = function() { return new StereoPannerNode(this); };
  AudioContext.prototype.createConvolver = function() { return new ConvolverNode(this); };
  AudioContext.prototype.createWaveShaper = function() { return new WaveShaperNode(this); };
  AudioContext.prototype.createChannelMerger = function(inputs) { return new ChannelMergerNode(this, inputs); };
  AudioContext.prototype.createChannelSplitter = function(outputs) { return new ChannelSplitterNode(this, outputs); };
  AudioContext.prototype.createConstantSource = function() { return new ConstantSourceNode(this); };
  AudioContext.prototype.createIIRFilter = function(feedforward, feedback) { return new IIRFilterNode(this, feedforward, feedback); };
  AudioContext.prototype.createPeriodicWave = function(real, imag, constraints) { return new PeriodicWave(this, { real: real, imag: imag }); };
  AudioContext.prototype.createBuffer = function(channels, length, sr) {
    return new AudioBuffer({ numberOfChannels: channels, length: length, sampleRate: sr });
  };
  AudioContext.prototype.decodeAudioData = function(buf, success, error) {
    var sr = this.sampleRate || 44100;
    var ab = new AudioBuffer({ length: 1, sampleRate: sr, numberOfChannels: 1 });
    if (success) setTimeout(function() { success(ab); }, 0);
    return Promise.resolve(ab);
  };
  AudioContext.prototype.resume = function() { this.state = 'running'; return Promise.resolve(); };
  AudioContext.prototype.suspend = function() { this.state = 'suspended'; return Promise.resolve(); };
  AudioContext.prototype.close = function() { this.state = 'closed'; return Promise.resolve(); };

  // ── OfflineAudioContext (stub) ────────────────────────────────────

  function OfflineAudioContext(channels, length, sr) {
    AudioContext.call(this);
    this.length = length;
  }
  OfflineAudioContext.prototype = Object.create(AudioContext.prototype);
  OfflineAudioContext.prototype.startRendering = function() { return Promise.resolve(null); };

  // ── Globals ───────────────────────────────────────────────────────

  globalThis.AudioContext = AudioContext;
  globalThis.webkitAudioContext = AudioContext;
  globalThis.OfflineAudioContext = OfflineAudioContext;
  globalThis.AudioBuffer = AudioBuffer;
  globalThis.AudioParam = AudioParam;
  globalThis.PeriodicWave = PeriodicWave;

  if (typeof __dz_reset_hooks !== 'undefined') {
    __dz_reset_hooks.push(function() {
      __dz_audio_next_id = 1;
      __dz_audio_cmds.length = 0;
    });
  }
})();
