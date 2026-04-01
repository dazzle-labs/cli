#!/usr/bin/env node
// Generate reference PNGs by rendering HTML/CSS scenes in Chrome via Puppeteer.
// Usage: node generate.cjs
//
// Reads scenes.json, renders each scene's HTML in Chrome at the specified viewport,
// and saves the screenshot as <scene_name>.truth.png in this directory.
//
// Chrome uses DejaVu Sans (the same font embedded in stage-runtime) to ensure
// text rendering matches as closely as possible.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const scenesPath = path.join(__dirname, 'scenes.json');
const scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));

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
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    // Force light color scheme to match stage-runtime's default
    // (only for scenes that use prefers-color-scheme, to avoid affecting other rendering)
    if (scene.html.includes('prefers-color-scheme')) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    }

    // Inject our font into the scene HTML.
    // Replace sans-serif/serif/monospace with DejaVu Sans to match stage-runtime.
    let html = scene.html;

    // Insert font-face CSS into the <head><style> block, or add one
    if (html.includes('<style>')) {
      html = html.replace('<style>', `<style>${fontFaceCSS}`);
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', `<style>${fontFaceCSS}</style></head>`);
    }

    // Remap generic font families to DejaVu Sans
    html = html.replace(/font-family:\s*sans-serif/g, "font-family: 'DejaVu Sans', sans-serif");
    html = html.replace(/font-family:\s*serif/g, "font-family: 'DejaVu Sans', serif");
    html = html.replace(/font-family:\s*monospace/g, "font-family: 'DejaVu Sans', monospace");

    await page.setContent(html, { waitUntil: 'load' });

    // Force-load all @font-face fonts before screenshotting
    await page.evaluate(async () => {
      const loads = [];
      document.fonts.forEach(f => loads.push(f.load()));
      await Promise.all(loads);
    });

    // Small delay to ensure all painting is complete
    await new Promise(r => setTimeout(r, 100));

    const outPath = path.join(__dirname, `${name}.truth.png`);
    await page.screenshot({
      path: outPath,
      clip: { x: 0, y: 0, width, height },
      omitBackground: false,
    });
    console.log(`  ✓ ${name} → ${outPath}`);
    generated++;

    await page.close();
  }

  await browser.close();
  console.log(`\nGenerated ${generated} reference images.`);
}

main().catch(e => { console.error(e); process.exit(1); });
