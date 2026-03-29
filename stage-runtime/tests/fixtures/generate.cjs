#!/usr/bin/env node
// Generate reference PNGs by rendering test scenes in Chrome via Puppeteer.
// Usage: node generate.js
//
// Reads scenes.json, renders each scene on a Canvas 2D element in Chrome,
// and saves the screenshot as <scene_name>.png in this directory.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const scenesPath = path.join(__dirname, 'scenes.json');
const scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));

// Translate our command array format into Canvas 2D API calls
function commandsToJS(commands, width, height) {
  let js = `
    const canvas = document.createElement('canvas');
    canvas.width = ${width};
    canvas.height = ${height};
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
  `;

  // Track named gradients for gradient commands
  js += `const _gradients = {};\n`;

  for (const cmd of commands) {
    const op = cmd[0];
    const args = cmd.slice(1);

    // --- Gradient commands (custom protocol) ---
    if (op === '_createLinearGradient') {
      // args: [name, x0, y0, x1, y1]
      const name = args[0];
      js += `_gradients[${JSON.stringify(name)}] = ctx.createLinearGradient(${args[1]}, ${args[2]}, ${args[3]}, ${args[4]});\n`;
      continue;
    }
    if (op === '_createRadialGradient') {
      // args: [name, x0, y0, r0, x1, y1, r1]
      const name = args[0];
      js += `_gradients[${JSON.stringify(name)}] = ctx.createRadialGradient(${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]});\n`;
      continue;
    }
    if (op === '_addColorStop') {
      // args: [name, offset, color]
      const name = args[0];
      js += `_gradients[${JSON.stringify(name)}].addColorStop(${args[1]}, ${JSON.stringify(args[2])});\n`;
      continue;
    }
    if (op === '_setFillGradient') {
      // args: [name]
      const name = args[0];
      js += `ctx.fillStyle = _gradients[${JSON.stringify(name)}];\n`;
      continue;
    }
    if (op === '_setStrokeGradient') {
      // args: [name]
      const name = args[0];
      js += `ctx.strokeStyle = _gradients[${JSON.stringify(name)}];\n`;
      continue;
    }

    // Property setters (string value)
    const stringProps = [
      'fillStyle', 'strokeStyle', 'lineCap', 'lineJoin',
      'font', 'textAlign', 'textBaseline', 'shadowColor',
      'globalCompositeOperation'
    ];
    if (stringProps.includes(op)) {
      let val = args[0];
      // Remap generic font families to DejaVu Sans so Chrome uses the
      // same font embedded in stage-runtime
      if (op === 'font' && typeof val === 'string') {
        val = val.replace(/\bsans-serif\b/g, "'DejaVu Sans'")
                 .replace(/\bserif\b/g, "'DejaVu Sans'")
                 .replace(/\bmonospace\b/g, "'DejaVu Sans'");
      }
      js += `ctx.${op} = ${JSON.stringify(val)};\n`;
      continue;
    }

    // Property setters (numeric value)
    const numProps = [
      'lineWidth', 'miterLimit', 'globalAlpha',
      'shadowBlur', 'shadowOffsetX', 'shadowOffsetY',
      'lineDashOffset'
    ];
    if (numProps.includes(op)) {
      js += `ctx.${op} = ${args[0]};\n`;
      continue;
    }

    if (op === 'imageSmoothingEnabled') {
      js += `ctx.imageSmoothingEnabled = ${args[0] ? 'true' : 'false'};\n`;
      continue;
    }

    if (op === 'setLineDash') {
      js += `ctx.setLineDash([${args.join(',')}]);\n`;
      continue;
    }

    // --- drawImage with inline pixel data ---
    // Format: ["drawImage", "__inline", dx, dy, w, h, r,g,b,a, ...]
    if (op === 'drawImage' && args[0] === '__inline') {
      const dx = args[1], dy = args[2], w = args[3], h = args[4];
      const pixels = args.slice(5);
      js += `{
        const _tmpC = document.createElement('canvas');
        _tmpC.width = ${w}; _tmpC.height = ${h};
        const _tmpCtx = _tmpC.getContext('2d');
        const _id = _tmpCtx.createImageData(${w}, ${h});
        const _px = [${pixels.join(',')}];
        for (let i = 0; i < _px.length; i++) _id.data[i] = _px[i];
        _tmpCtx.putImageData(_id, 0, 0);
        ctx.drawImage(_tmpC, ${dx}, ${dy});
      }\n`;
      continue;
    }

    // --- drawImage with inline pixel data (5-arg dest) ---
    // Format: ["drawImage", "__inline5", dx, dy, dw, dh, srcW, srcH, r,g,b,a, ...]
    if (op === 'drawImage' && args[0] === '__inline5') {
      const dx = args[1], dy = args[2], dw = args[3], dh = args[4];
      const srcW = args[5], srcH = args[6];
      const pixels = args.slice(7);
      js += `{
        const _tmpC = document.createElement('canvas');
        _tmpC.width = ${srcW}; _tmpC.height = ${srcH};
        const _tmpCtx = _tmpC.getContext('2d');
        const _id = _tmpCtx.createImageData(${srcW}, ${srcH});
        const _px = [${pixels.join(',')}];
        for (let i = 0; i < _px.length; i++) _id.data[i] = _px[i];
        _tmpCtx.putImageData(_id, 0, 0);
        ctx.drawImage(_tmpC, ${dx}, ${dy}, ${dw}, ${dh});
      }\n`;
      continue;
    }

    // --- drawImage with inline pixel data (9-arg crop+dest) ---
    // Format: ["drawImage", "__inline9", sx, sy, sw, sh, dx, dy, dw, dh, srcW, srcH, r,g,b,a, ...]
    if (op === 'drawImage' && args[0] === '__inline9') {
      const sx = args[1], sy = args[2], sw = args[3], sh = args[4];
      const dx = args[5], dy = args[6], dw = args[7], dh = args[8];
      const srcW = args[9], srcH = args[10];
      const pixels = args.slice(11);
      js += `{
        const _tmpC = document.createElement('canvas');
        _tmpC.width = ${srcW}; _tmpC.height = ${srcH};
        const _tmpCtx = _tmpC.getContext('2d');
        const _id = _tmpCtx.createImageData(${srcW}, ${srcH});
        const _px = [${pixels.join(',')}];
        for (let i = 0; i < _px.length; i++) _id.data[i] = _px[i];
        _tmpCtx.putImageData(_id, 0, 0);
        ctx.drawImage(_tmpC, ${sx}, ${sy}, ${sw}, ${sh}, ${dx}, ${dy}, ${dw}, ${dh});
      }\n`;
      continue;
    }

    // --- putImageData with inline pixel data ---
    // Format: ["putImageData", "__inline", dx, dy, w, h, r,g,b,a, ...]
    if (op === 'putImageData' && args[0] === '__inline') {
      const dx = args[1], dy = args[2], w = args[3], h = args[4];
      const pixels = args.slice(5);
      js += `{
        const _id = ctx.createImageData(${w}, ${h});
        const _px = [${pixels.join(',')}];
        for (let i = 0; i < _px.length; i++) _id.data[i] = _px[i];
        ctx.putImageData(_id, ${dx}, ${dy});
      }\n`;
      continue;
    }

    // Methods — note: our JSON uses 'rect_path' for path rect to distinguish from fillRect
    const methodOp = op === 'rect_path' ? 'rect' : op;

    // Method calls — arrays (e.g. roundRect radii) must be emitted as JS array literals
    const methodArgs = args.map(a => {
      if (typeof a === 'string') return JSON.stringify(a);
      if (Array.isArray(a)) return JSON.stringify(a);
      return a;
    });
    js += `ctx.${methodOp}(${methodArgs.join(', ')});\n`;
  }

  return js;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  // Load DejaVu Sans fonts so Chrome uses the same font as stage-runtime
  const fontsDir = path.join(__dirname, '..', '..', 'src', 'canvas2d', 'fonts');
  const dejaVuRegular = fs.readFileSync(path.join(fontsDir, 'DejaVuSans.ttf'));
  const dejaVuBold = fs.readFileSync(path.join(fontsDir, 'DejaVuSans-Bold.ttf'));
  const dejaVuRegularB64 = dejaVuRegular.toString('base64');
  const dejaVuBoldB64 = dejaVuBold.toString('base64');

  const fontFaceCSS = `
    @font-face {
      font-family: 'DejaVu Sans';
      src: url(data:font/ttf;base64,${dejaVuRegularB64}) format('truetype');
      font-weight: normal;
      font-style: normal;
    }
    @font-face {
      font-family: 'DejaVu Sans';
      src: url(data:font/ttf;base64,${dejaVuBoldB64}) format('truetype');
      font-weight: bold;
      font-style: normal;
    }
  `;

  const { width, height } = scenes;
  let generated = 0;

  for (const [name, scene] of Object.entries(scenes.scenes)) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    const js = commandsToJS(scene.commands, width, height);

    await page.setContent(`<!DOCTYPE html>
      <html><head><style>
        ${fontFaceCSS}
        body { margin: 0; padding: 0; background: transparent; }
        * { font-family: 'DejaVu Sans', sans-serif; }
      </style></head><body></body></html>`);

    // Force-load all @font-face fonts before rendering.
    // document.fonts.ready resolves immediately if no DOM elements reference the font,
    // so we must explicitly call .load() on each FontFace.
    await page.evaluate(async () => {
      const loads = [];
      document.fonts.forEach(f => loads.push(f.load()));
      await Promise.all(loads);
    });

    await page.evaluate(js);

    // Screenshot just the canvas element
    const canvas = await page.$('canvas');
    if (canvas) {
      const outPath = path.join(__dirname, `${name}.truth.png`);
      await canvas.screenshot({ path: outPath, omitBackground: true });
      console.log(`  ✓ ${name} → ${outPath}`);
      generated++;
    } else {
      console.error(`  ✗ ${name}: no canvas found`);
    }

    await page.close();
  }

  await browser.close();
  console.log(`\nGenerated ${generated} reference images.`);
}

main().catch(e => { console.error(e); process.exit(1); });
