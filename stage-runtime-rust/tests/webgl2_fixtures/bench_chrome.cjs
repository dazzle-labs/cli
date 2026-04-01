#!/usr/bin/env node
// Benchmark WebGL2 scenes in Chrome via Puppeteer.
//
// Splits each scene into setup (shader compile, buffer upload — runs once)
// and draw (clear, uniforms, draw calls — runs every frame).
//
// Two modes:
//   rAF:      requestAnimationFrame loop, measures real vsync-driven FPS
//   uncapped: tight JS loop with gl.finish(), measures max GPU throughput
//
// Usage:
//   node bench_chrome.cjs [--scenes name1,name2] [--frames 300] [--mode uncapped|raf|both]
//
// Outputs: scene name, avg frame time, FPS, p50/p95/p99 frame times.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const scenesPath = path.join(__dirname, 'scenes.json');
const allScenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));

// --- CLI args ---
const argv = process.argv.slice(2);
let filterScenes = null;
let numFrames = 300;
let mode = 'both'; // 'raf', 'uncapped', 'readback', or 'both'
let benchWidth = 1280;
let benchHeight = 720;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--scenes' && argv[i+1]) filterScenes = argv[++i].split(',');
  else if (argv[i] === '--frames' && argv[i+1]) numFrames = parseInt(argv[++i], 10);
  else if (argv[i] === '--mode' && argv[i+1]) mode = argv[++i];
  else if (argv[i] === '--width' && argv[i+1]) benchWidth = parseInt(argv[++i], 10);
  else if (argv[i] === '--height' && argv[i+1]) benchHeight = parseInt(argv[++i], 10);
  else if (argv[i] === '--200') { benchWidth = 200; benchHeight = 200; }
  else if (argv[i] === '--720p') { benchWidth = 1280; benchHeight = 720; }
  else if (argv[i] === '--1080p') { benchWidth = 1920; benchHeight = 1080; }
}

if (!filterScenes) {
  filterScenes = Object.keys(allScenes.scenes).filter(n => n.startsWith('bench_'));
}

// --- Shader resolution ---
function resolveShaderRefs(commands) {
  return commands.map(cmd => cmd.map(arg => {
    if (typeof arg === 'string' && arg.startsWith('@')) {
      return fs.readFileSync(path.join(__dirname, arg.slice(1)), 'utf8');
    }
    return arg;
  }));
}

// --- Command classification ---
// Setup commands allocate GPU resources (run once).
// Draw commands set state and issue draw calls (run every frame).
const SETUP_OPS = new Set([
  'createShader', 'shaderSource', 'compileShader',
  'createProgram', 'attachShader', 'linkProgram',
  'createBuffer', 'bufferData', 'bufferDataUint32',
  'createTexture', 'texImage2D', 'texParameteri', 'pixelStorei',
  'vertexAttribPointer', 'enableVertexAttribArray', 'disableVertexAttribArray',
  'getUniformLocation', 'getAttribLocation',
]);

// These are setup when they occur before the first draw, but draw-phase
// when they occur after (e.g. bindBuffer to switch VBOs between draws).
// We use a simple heuristic: once we see the first clear or draw, everything
// after is draw-phase.
const DRAW_TRIGGER_OPS = new Set([
  'clearColor', 'clearDepth', 'clear',
  'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced',
]);

function splitCommands(commands) {
  commands = resolveShaderRefs(commands);
  const setup = [];
  const draw = [];
  let inDraw = false;

  for (const cmd of commands) {
    const op = cmd[0];
    if (!inDraw && DRAW_TRIGGER_OPS.has(op)) {
      inDraw = true;
    }
    if (inDraw) {
      draw.push(cmd);
    } else {
      setup.push(cmd);
    }
  }

  return { setup, draw };
}

// --- Code generation ---
// Emits JS for a single command. Returns { line, retName } or { block, retName }.
function emitCommand(cmd) {
  const op = cmd[0];
  const rawArgs = cmd.slice(1);

  let retName = null;
  let args = rawArgs;
  if (args.length > 0 && typeof args[args.length - 1] === 'string' && args[args.length - 1].startsWith('__ret_')) {
    retName = args[args.length - 1].replace('__ret_', '');
    args = args.slice(0, -1);
  }

  const r = args.map(a => {
    if (typeof a === 'string' && a.startsWith('$')) return `_refs[${JSON.stringify(a.slice(1))}]`;
    if (Array.isArray(a)) return a; // handled per-op
    if (typeof a === 'string') return JSON.stringify(a);
    if (typeof a === 'boolean') return a ? 'true' : 'false';
    return a;
  });

  let line;
  let block = null;

  switch (op) {
    case 'createShader': line = `gl.createShader(${r[0]})`; break;
    case 'shaderSource': line = `gl.shaderSource(${r[0]}, ${r[1]})`; break;
    case 'compileShader':
      block = `gl.compileShader(${r[0]});\n` +
              `if (!gl.getShaderParameter(${r[0]}, gl.COMPILE_STATUS)) console.error('Shader:', gl.getShaderInfoLog(${r[0]}));`;
      return { block, retName };
    case 'createProgram': line = `gl.createProgram()`; break;
    case 'attachShader': line = `gl.attachShader(${r[0]}, ${r[1]})`; break;
    case 'linkProgram':
      block = `gl.linkProgram(${r[0]});\n` +
              `if (!gl.getProgramParameter(${r[0]}, gl.LINK_STATUS)) console.error('Link:', gl.getProgramInfoLog(${r[0]}));`;
      return { block, retName };
    case 'bufferData': {
      const data = r[1];
      if (Array.isArray(data)) {
        const isIndex = (args[0] === 34963);
        const ctor = isIndex ? 'Uint16Array' : 'Float32Array';
        line = `gl.bufferData(${r[0]}, new ${ctor}(${JSON.stringify(data)}), ${r[2]})`;
      } else {
        line = `gl.bufferData(${r[0]}, ${data}, ${r[2]})`;
      }
      break;
    }
    case 'bufferDataUint32': {
      const data = r[1];
      if (Array.isArray(data)) {
        line = `gl.bufferData(${r[0]}, new Uint32Array(${JSON.stringify(data)}), ${r[2]})`;
      } else {
        line = `gl.bufferData(${r[0]}, ${data}, ${r[2]})`;
      }
      break;
    }
    case 'texImage2D': {
      const data = r[8];
      if (Array.isArray(data)) {
        line = `gl.texImage2D(${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}, ${r[4]}, ${r[5]}, ${r[6]}, ${r[7]}, new Uint8Array(${JSON.stringify(data)}))`;
      } else {
        line = `gl.texImage2D(${r.join(', ')})`;
      }
      break;
    }
    case 'uniformMatrix4fv':
    case 'uniformMatrix3fv': {
      const data = r[2];
      if (Array.isArray(data)) {
        line = `gl.${op}(${r[0]}, ${r[1]}, new Float32Array(${JSON.stringify(data)}))`;
      } else {
        line = `gl.${op}(${r[0]}, ${r[1]}, ${data})`;
      }
      break;
    }
    default:
      line = `gl.${op}(${r.map(a => Array.isArray(a) ? JSON.stringify(a) : a).join(', ')})`;
      break;
  }

  return { line, retName };
}

function commandsToJS(commands) {
  let js = '';
  for (const cmd of commands) {
    const { line, block, retName } = emitCommand(cmd);
    if (block) {
      js += block + '\n';
    } else if (retName) {
      js += `_refs[${JSON.stringify(retName)}] = ${line};\n`;
    } else {
      js += `${line};\n`;
    }
  }
  return js;
}

// --- Percentile helper ---
function percentile(sorted, p) {
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function fmtMs(ms) {
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  return `${ms.toFixed(2)}ms`;
}

function fmtFps(ms) {
  if (ms <= 0) return '∞';
  return `${(1000 / ms).toFixed(0)}`;
}

// --- Main ---
async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--enable-webgl',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--run-all-compositor-stages-before-draw',
    ],
    protocolTimeout: 120000,
  });

  const results = [];

  for (const sceneName of filterScenes) {
    const scene = allScenes.scenes[sceneName];
    if (!scene) { console.error(`Scene not found: ${sceneName}`); continue; }

    const { setup, draw } = splitCommands(scene.commands);

    // Rewrite viewport commands in draw to use bench resolution
    const patchedDraw = draw.map(cmd => {
      if (cmd[0] === 'viewport') return ['viewport', 0, 0, benchWidth, benchHeight];
      return cmd;
    });

    const setupJS = commandsToJS(setup);
    const drawJS = commandsToJS(patchedDraw);

    const sceneResults = { name: sceneName };

    // --- Uncapped mode: tight loop, gl.finish() each frame ---
    // Uses batch timing: runs B draws per measurement to defeat timer quantization.
    if (mode === 'uncapped' || mode === 'both') {
      const page = await browser.newPage();
      await page.setViewport({ width: benchWidth, height: benchHeight });
      const errors = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.setContent(`<!DOCTYPE html><html><head><style>body{margin:0;}</style></head><body></body></html>`);

      try {
        const times = await page.evaluate(`(function() {
          const canvas = document.createElement('canvas');
          canvas.width = ${benchWidth}; canvas.height = ${benchHeight};
          document.body.appendChild(canvas);
          const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
          if (!gl) throw new Error('WebGL2 not supported');
          const _refs = {};

          // === SETUP (one-time) ===
          ${setupJS}
          gl.finish();

          // === WARMUP (10 frames) ===
          for (let i = 0; i < 10; i++) {
            ${drawJS}
            gl.finish();
          }

          // GPU fence: readPixels forces full pipeline flush (data must reach CPU).
          // gl.finish() on macOS ANGLE/Metal is unreliable — work stays queued.
          const fenceBuf = new Uint8Array(4);
          function gpuFence() {
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, fenceBuf);
          }

          // === CALIBRATE batch size ===
          let calStart = performance.now();
          for (let i = 0; i < 10; i++) { ${drawJS} gpuFence(); }
          let calMs = (performance.now() - calStart) / 10;

          // Pick batch size so each measurement is >= 5ms (defeats 100µs timer quantization)
          const batchSize = Math.max(1, Math.ceil(5.0 / Math.max(calMs, 0.001)));

          // === BENCHMARK ===
          const samples = ${numFrames};
          const times = new Float64Array(samples);
          for (let s = 0; s < samples; s++) {
            const t0 = performance.now();
            for (let b = 0; b < batchSize; b++) {
              ${drawJS}
              gpuFence();
            }
            times[s] = (performance.now() - t0) / batchSize;
          }
          return { times: Array.from(times), batchSize };
        })()`);

        if (errors.length > 0) console.error(`  ${sceneName} (uncapped): ${errors.join('; ')}`);

        const { times: rawTimes, batchSize } = times;
        rawTimes.sort((a, b) => a - b);
        sceneResults.uncapped = {
          median: percentile(rawTimes, 50),
          p90: percentile(rawTimes, 90),
          p95: percentile(rawTimes, 95),
          p99: percentile(rawTimes, 99),
          min: rawTimes[0],
          max: rawTimes[rawTimes.length - 1],
          batchSize,
        };
      } catch (e) {
        console.error(`  ${sceneName} (uncapped): FAILED — ${e.message}`);
      }
      await page.close();
    }

    // --- Readback mode: draw + full-frame readPixels (matches stage-runtime full_frame_720p) ---
    if (mode === 'readback' || mode === 'both') {
      const page = await browser.newPage();
      await page.setViewport({ width: benchWidth, height: benchHeight });
      const errors = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.setContent(`<!DOCTYPE html><html><head><style>body{margin:0;}</style></head><body></body></html>`);

      try {
        const times = await page.evaluate(`(function() {
          const canvas = document.createElement('canvas');
          canvas.width = ${benchWidth}; canvas.height = ${benchHeight};
          document.body.appendChild(canvas);
          const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
          if (!gl) throw new Error('WebGL2 not supported');
          const _refs = {};

          // === SETUP (one-time) ===
          ${setupJS}
          gl.finish();

          // === WARMUP (10 frames) ===
          const fullBuf = new Uint8Array(${benchWidth} * ${benchHeight} * 4);
          for (let i = 0; i < 10; i++) {
            ${drawJS}
            gl.readPixels(0, 0, ${benchWidth}, ${benchHeight}, gl.RGBA, gl.UNSIGNED_BYTE, fullBuf);
          }

          // === CALIBRATE batch size ===
          let calStart = performance.now();
          for (let i = 0; i < 10; i++) {
            ${drawJS}
            gl.readPixels(0, 0, ${benchWidth}, ${benchHeight}, gl.RGBA, gl.UNSIGNED_BYTE, fullBuf);
          }
          let calMs = (performance.now() - calStart) / 10;

          const batchSize = Math.max(1, Math.ceil(5.0 / Math.max(calMs, 0.001)));

          // === BENCHMARK ===
          const samples = ${numFrames};
          const times = new Float64Array(samples);
          for (let s = 0; s < samples; s++) {
            const t0 = performance.now();
            for (let b = 0; b < batchSize; b++) {
              ${drawJS}
              gl.readPixels(0, 0, ${benchWidth}, ${benchHeight}, gl.RGBA, gl.UNSIGNED_BYTE, fullBuf);
            }
            times[s] = (performance.now() - t0) / batchSize;
          }
          return { times: Array.from(times), batchSize };
        })()`);

        if (errors.length > 0) console.error(`  ${sceneName} (readback): ${errors.join('; ')}`);

        const { times: rawTimes, batchSize } = times;
        rawTimes.sort((a, b) => a - b);
        sceneResults.readback = {
          median: percentile(rawTimes, 50),
          p90: percentile(rawTimes, 90),
          p95: percentile(rawTimes, 95),
          p99: percentile(rawTimes, 99),
          min: rawTimes[0],
          max: rawTimes[rawTimes.length - 1],
          batchSize,
        };
      } catch (e) {
        console.error(`  ${sceneName} (readback): FAILED — ${e.message}`);
      }
      await page.close();
    }

    // --- rAF mode: requestAnimationFrame, measures real frame delivery ---
    if (mode === 'raf' || mode === 'both') {
      const page = await browser.newPage();
      await page.setViewport({ width: benchWidth, height: benchHeight });
      const errors = [];
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      await page.setContent(`<!DOCTYPE html><html><head><style>body{margin:0;}</style></head><body></body></html>`);

      try {
        const rafTimes = await page.evaluate(`new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          canvas.width = ${benchWidth}; canvas.height = ${benchHeight};
          document.body.appendChild(canvas);
          const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
          if (!gl) throw new Error('WebGL2 not supported');
          const _refs = {};

          // === SETUP ===
          ${setupJS}
          gl.finish();

          const times = [];
          let warmup = 10;
          let count = 0;
          let lastT = 0;

          function frame(t) {
            if (warmup > 0) {
              ${drawJS}
              warmup--;
              lastT = t;
              requestAnimationFrame(frame);
              return;
            }

            const dt = t - lastT;
            lastT = t;

            const t0 = performance.now();
            ${drawJS}
            const gpuSubmit = performance.now() - t0;

            times.push({ dt, gpuSubmit });
            count++;

            if (count >= ${numFrames}) {
              resolve(times);
            } else {
              requestAnimationFrame(frame);
            }
          }
          requestAnimationFrame(frame);
        })`);

        if (errors.length > 0) console.error(`  ${sceneName} (raf): ${errors.join('; ')}`);

        const dts = rafTimes.map(t => t.dt).sort((a, b) => a - b);
        const submits = rafTimes.map(t => t.gpuSubmit).sort((a, b) => a - b);
        sceneResults.raf = {
          frameDt: { median: percentile(dts, 50), p95: percentile(dts, 95) },
          gpuSubmit: { median: percentile(submits, 50), p95: percentile(submits, 95) },
        };
      } catch (e) {
        console.error(`  ${sceneName} (raf): FAILED — ${e.message}`);
      }
      await page.close();
    }

    results.push(sceneResults);
  }

  await browser.close();

  // --- Print results ---
  console.log('');
  console.log(`Chrome WebGL2 Benchmark — ${benchWidth}x${benchHeight}, ${numFrames} frames`);

  if (mode === 'uncapped' || mode === 'both') {
    console.log('');
    console.log('UNCAPPED (tight loop + gl.finish) — max GPU throughput');
    console.log('Setup runs once; only draw commands (clear/uniforms/draw) are timed.');
    console.log('─'.repeat(88));
    console.log(
      'Scene'.padEnd(30) +
      'p50'.padStart(10) +
      'p90'.padStart(10) +
      'p95'.padStart(10) +
      'p99'.padStart(10) +
      'Min'.padStart(10) +
      'Max'.padStart(10) +
      'FPS'.padStart(8) +
      'Batch'.padStart(7)
    );
    console.log('─'.repeat(105));
    for (const r of results) {
      if (!r.uncapped) continue;
      const u = r.uncapped;
      console.log(
        r.name.padEnd(30) +
        fmtMs(u.median).padStart(10) +
        fmtMs(u.p90).padStart(10) +
        fmtMs(u.p95).padStart(10) +
        fmtMs(u.p99).padStart(10) +
        fmtMs(u.min).padStart(10) +
        fmtMs(u.max).padStart(10) +
        fmtFps(u.median).padStart(8) +
        `${u.batchSize}x`.padStart(7)
      );
    }
    console.log('─'.repeat(105));
  }

  if (mode === 'readback' || mode === 'both') {
    console.log('');
    console.log(`FULL READBACK (draw + readPixels ${benchWidth}x${benchHeight}) — render + ${(benchWidth*benchHeight*4/1024/1024).toFixed(1)}MB readback`);
    console.log('Comparable to stage-runtime webgl2/full_frame_720p benchmark.');
    console.log('─'.repeat(105));
    console.log(
      'Scene'.padEnd(30) +
      'p50'.padStart(10) +
      'p90'.padStart(10) +
      'p95'.padStart(10) +
      'p99'.padStart(10) +
      'Min'.padStart(10) +
      'Max'.padStart(10) +
      'FPS'.padStart(8) +
      'Batch'.padStart(7)
    );
    console.log('─'.repeat(105));
    for (const r of results) {
      if (!r.readback) continue;
      const u = r.readback;
      console.log(
        r.name.padEnd(30) +
        fmtMs(u.median).padStart(10) +
        fmtMs(u.p90).padStart(10) +
        fmtMs(u.p95).padStart(10) +
        fmtMs(u.p99).padStart(10) +
        fmtMs(u.min).padStart(10) +
        fmtMs(u.max).padStart(10) +
        fmtFps(u.median).padStart(8) +
        `${u.batchSize}x`.padStart(7)
      );
    }
    console.log('─'.repeat(105));
  }

  if (mode === 'raf' || mode === 'both') {
    console.log('');
    console.log('rAF (requestAnimationFrame) — real frame delivery');
    console.log('frame dt = time between rAF callbacks; gpu submit = draw command time.');
    console.log('─'.repeat(70));
    console.log(
      'Scene'.padEnd(30) +
      'Frame dt p50'.padStart(12) +
      'dt p95'.padStart(10) +
      'Submit p50'.padStart(12) +
      'Sub p95'.padStart(10)
    );
    console.log('─'.repeat(70));
    for (const r of results) {
      if (!r.raf) continue;
      console.log(
        r.name.padEnd(30) +
        fmtMs(r.raf.frameDt.median).padStart(12) +
        fmtMs(r.raf.frameDt.p95).padStart(10) +
        fmtMs(r.raf.gpuSubmit.median).padStart(12) +
        fmtMs(r.raf.gpuSubmit.p95).padStart(10)
      );
    }
    console.log('─'.repeat(70));
  }

  // JSON output
  const jsonPath = path.join(__dirname, 'bench_chrome_results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\nJSON: ${jsonPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
