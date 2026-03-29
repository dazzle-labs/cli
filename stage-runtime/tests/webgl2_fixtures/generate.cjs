#!/usr/bin/env node
// Generate WebGL2 reference PNGs by rendering test scenes in Chrome via Puppeteer.
// Usage: node generate.cjs
//
// Reads scenes.json, renders each scene on a WebGL2 canvas in Chrome,
// and saves the screenshot as <scene_name>.truth.png in this directory.

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const scenesPath = path.join(__dirname, 'scenes.json');
const scenes = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));

// WebGL2 constant map for symbolic references in args
const GL = {
  // Shader types
  VERTEX_SHADER: 35633,
  FRAGMENT_SHADER: 35632,
  // Buffer targets
  ARRAY_BUFFER: 34962,
  ELEMENT_ARRAY_BUFFER: 34963,
  // Usage
  STATIC_DRAW: 35044,
  // Data types
  FLOAT: 5126,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_BYTE: 5121,
  UNSIGNED_INT: 5125,
  // Draw modes
  POINTS: 0,
  LINES: 1,
  LINE_LOOP: 2,
  LINE_STRIP: 3,
  TRIANGLES: 4,
  TRIANGLE_STRIP: 5,
  TRIANGLE_FAN: 6,
  // Clear bits
  COLOR_BUFFER_BIT: 16384,
  DEPTH_BUFFER_BIT: 256,
  STENCIL_BUFFER_BIT: 1024,
  // Capabilities
  BLEND: 3042,
  DEPTH_TEST: 2929,
  CULL_FACE: 2884,
  SCISSOR_TEST: 3089,
  STENCIL_TEST: 2960,
  // Blend funcs
  SRC_ALPHA: 770,
  ONE_MINUS_SRC_ALPHA: 771,
  ONE: 1,
  ZERO: 0,
  SRC_COLOR: 768,
  ONE_MINUS_SRC_COLOR: 769,
  DST_ALPHA: 772,
  ONE_MINUS_DST_ALPHA: 773,
  DST_COLOR: 774,
  ONE_MINUS_DST_COLOR: 775,
  // Face culling
  CW: 2304,
  CCW: 2305,
  FRONT: 1028,
  BACK: 1029,
  FRONT_AND_BACK: 1032,
  // Depth
  LESS: 513,
  LEQUAL: 515,
  // Texture
  TEXTURE_2D: 3553,
  RGBA: 6408,
  TEXTURE_MIN_FILTER: 10241,
  TEXTURE_MAG_FILTER: 10240,
  NEAREST: 9728,
  LINEAR: 9729,
  TEXTURE_WRAP_S: 10242,
  TEXTURE_WRAP_T: 10243,
  REPEAT: 10497,
  CLAMP_TO_EDGE: 33071,
  // Pixel storage
  UNPACK_FLIP_Y_WEBGL: 37440,
  // Parameters
  COMPILE_STATUS: 35713,
  LINK_STATUS: 35714,
};

// Resolve @shaders/ file references in command arguments.
function resolveShaderRefs(commands) {
  return commands.map(cmd => cmd.map(arg => {
    if (typeof arg === 'string' && arg.startsWith('@')) {
      return fs.readFileSync(path.join(__dirname, arg.slice(1)), 'utf8');
    }
    return arg;
  }));
}

// Translate scene commands into JS code that runs on a WebGL2 context.
// Handles $ref resolution for return values from createShader, createProgram, etc.
function commandsToJS(commands, width, height) {
  commands = resolveShaderRefs(commands);
  let js = `
    const canvas = document.createElement('canvas');
    canvas.width = ${width};
    canvas.height = ${height};
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.body.appendChild(canvas);
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported');
    const _refs = {};
  `;

  for (const cmd of commands) {
    const op = cmd[0];
    const rawArgs = cmd.slice(1);

    // Check for __ret_ suffix to capture return value
    let retName = null;
    let args = rawArgs;
    if (args.length > 0 && typeof args[args.length - 1] === 'string' && args[args.length - 1].startsWith('__ret_')) {
      retName = args[args.length - 1].replace('__ret_', '');
      args = args.slice(0, -1);
    }

    // Resolve $ref arguments
    const resolvedArgs = args.map(a => {
      if (typeof a === 'string' && a.startsWith('$')) {
        return `_refs[${JSON.stringify(a.slice(1))}]`;
      }
      if (Array.isArray(a)) {
        // Array data — will be handled specially per-op
        return a;
      }
      if (typeof a === 'string') return JSON.stringify(a);
      if (typeof a === 'boolean') return a ? 'true' : 'false';
      return a;
    });

    // Generate JS for each operation
    let line = '';
    switch (op) {
      case 'createShader': {
        const typeArg = resolvedArgs[0];
        line = `gl.createShader(${typeArg})`;
        break;
      }
      case 'shaderSource': {
        line = `gl.shaderSource(${resolvedArgs[0]}, ${resolvedArgs[1]})`;
        break;
      }
      case 'compileShader': {
        line = `gl.compileShader(${resolvedArgs[0]})`;
        // Add compile check
        js += `${line};\n`;
        js += `if (!gl.getShaderParameter(${resolvedArgs[0]}, gl.COMPILE_STATUS)) {\n`;
        js += `  console.error('Shader compile error:', gl.getShaderInfoLog(${resolvedArgs[0]}));\n`;
        js += `}\n`;
        continue; // skip default line emission
      }
      case 'createProgram': {
        line = `gl.createProgram()`;
        break;
      }
      case 'attachShader': {
        line = `gl.attachShader(${resolvedArgs[0]}, ${resolvedArgs[1]})`;
        break;
      }
      case 'linkProgram': {
        line = `gl.linkProgram(${resolvedArgs[0]})`;
        js += `${line};\n`;
        js += `if (!gl.getProgramParameter(${resolvedArgs[0]}, gl.LINK_STATUS)) {\n`;
        js += `  console.error('Program link error:', gl.getProgramInfoLog(${resolvedArgs[0]}));\n`;
        js += `}\n`;
        continue;
      }
      case 'useProgram': {
        line = `gl.useProgram(${resolvedArgs[0]})`;
        break;
      }
      case 'createBuffer': {
        line = `gl.createBuffer()`;
        break;
      }
      case 'createTexture': {
        line = `gl.createTexture()`;
        break;
      }
      case 'bindBuffer': {
        line = `gl.bindBuffer(${resolvedArgs[0]}, ${resolvedArgs[1]})`;
        break;
      }
      case 'bindTexture': {
        line = `gl.bindTexture(${resolvedArgs[0]}, ${resolvedArgs[1]})`;
        break;
      }
      case 'bufferData': {
        const target = resolvedArgs[0];
        const data = resolvedArgs[1]; // array
        const usage = resolvedArgs[2];
        if (Array.isArray(data)) {
          // Determine if this is index data (ELEMENT_ARRAY_BUFFER = 34963)
          const isIndex = (args[0] === 34963);
          if (isIndex) {
            line = `gl.bufferData(${target}, new Uint16Array(${JSON.stringify(data)}), ${usage})`;
          } else {
            line = `gl.bufferData(${target}, new Float32Array(${JSON.stringify(data)}), ${usage})`;
          }
        } else {
          line = `gl.bufferData(${target}, ${data}, ${usage})`;
        }
        break;
      }
      case 'bufferDataUint32': {
        // Like bufferData but always uses Uint32Array (for GL_UNSIGNED_INT indices)
        const target = resolvedArgs[0];
        const data = resolvedArgs[1];
        const usage = resolvedArgs[2];
        if (Array.isArray(data)) {
          line = `gl.bufferData(${target}, new Uint32Array(${JSON.stringify(data)}), ${usage})`;
        } else {
          line = `gl.bufferData(${target}, ${data}, ${usage})`;
        }
        break;
      }
      case 'vertexAttribPointer': {
        // args: index, size, type, normalized, stride, offset
        line = `gl.vertexAttribPointer(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'enableVertexAttribArray': {
        line = `gl.enableVertexAttribArray(${resolvedArgs[0]})`;
        break;
      }
      case 'disableVertexAttribArray': {
        line = `gl.disableVertexAttribArray(${resolvedArgs[0]})`;
        break;
      }
      case 'getUniformLocation': {
        line = `gl.getUniformLocation(${resolvedArgs[0]}, ${resolvedArgs[1]})`;
        break;
      }
      case 'getAttribLocation': {
        line = `gl.getAttribLocation(${resolvedArgs[0]}, ${resolvedArgs[1]})`;
        break;
      }
      case 'uniform1f': {
        line = `gl.uniform1f(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'uniform1i': {
        line = `gl.uniform1i(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'uniform2f': {
        line = `gl.uniform2f(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'uniform3f': {
        line = `gl.uniform3f(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'uniform4f': {
        line = `gl.uniform4f(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'uniform2fv': {
        const loc2 = resolvedArgs[0];
        line = `gl.uniform2fv(${loc2}, [${resolvedArgs.slice(1).join(', ')}])`;
        break;
      }
      case 'uniform3fv': {
        const loc3 = resolvedArgs[0];
        line = `gl.uniform3fv(${loc3}, [${resolvedArgs.slice(1).join(', ')}])`;
        break;
      }
      case 'uniform4fv': {
        const loc4 = resolvedArgs[0];
        line = `gl.uniform4fv(${loc4}, [${resolvedArgs.slice(1).join(', ')}])`;
        break;
      }
      case 'uniformMatrix3fv': {
        const loc3m = resolvedArgs[0];
        const transpose3 = resolvedArgs[1];
        const data3 = resolvedArgs[2];
        if (Array.isArray(data3)) {
          line = `gl.uniformMatrix3fv(${loc3m}, ${transpose3}, new Float32Array(${JSON.stringify(data3)}))`;
        } else {
          line = `gl.uniformMatrix3fv(${loc3m}, ${transpose3}, ${data3})`;
        }
        break;
      }
      case 'uniformMatrix4fv': {
        const loc = resolvedArgs[0];
        const transpose = resolvedArgs[1];
        const data = resolvedArgs[2];
        if (Array.isArray(data)) {
          line = `gl.uniformMatrix4fv(${loc}, ${transpose}, new Float32Array(${JSON.stringify(data)}))`;
        } else {
          line = `gl.uniformMatrix4fv(${loc}, ${transpose}, ${data})`;
        }
        break;
      }
      case 'clearColor': {
        line = `gl.clearColor(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'clearDepth': {
        line = `gl.clearDepth(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'clear': {
        line = `gl.clear(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'drawArrays': {
        line = `gl.drawArrays(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'drawElements': {
        line = `gl.drawElements(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'enable': {
        line = `gl.enable(${resolvedArgs[0]})`;
        break;
      }
      case 'disable': {
        line = `gl.disable(${resolvedArgs[0]})`;
        break;
      }
      case 'viewport': {
        line = `gl.viewport(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'scissor': {
        line = `gl.scissor(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'blendFunc': {
        line = `gl.blendFunc(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'blendFuncSeparate': {
        line = `gl.blendFuncSeparate(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'colorMask': {
        line = `gl.colorMask(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'pixelStorei': {
        line = `gl.pixelStorei(${resolvedArgs.join(', ')})`;
        break;
      }
      case 'depthFunc': {
        line = `gl.depthFunc(${resolvedArgs[0]})`;
        break;
      }
      case 'depthMask': {
        line = `gl.depthMask(${resolvedArgs[0]})`;
        break;
      }
      case 'cullFace': {
        line = `gl.cullFace(${resolvedArgs[0]})`;
        break;
      }
      case 'frontFace': {
        line = `gl.frontFace(${resolvedArgs[0]})`;
        break;
      }
      case 'texImage2D': {
        // args: target, level, internalformat, width, height, border, format, type, data
        const tgt = resolvedArgs[0];
        const level = resolvedArgs[1];
        const ifmt = resolvedArgs[2];
        const w = resolvedArgs[3];
        const h = resolvedArgs[4];
        const border = resolvedArgs[5];
        const fmt = resolvedArgs[6];
        const dtype = resolvedArgs[7];
        const data = resolvedArgs[8];
        if (Array.isArray(data)) {
          line = `gl.texImage2D(${tgt}, ${level}, ${ifmt}, ${w}, ${h}, ${border}, ${fmt}, ${dtype}, new Uint8Array(${JSON.stringify(data)}))`;
        } else {
          line = `gl.texImage2D(${tgt}, ${level}, ${ifmt}, ${w}, ${h}, ${border}, ${fmt}, ${dtype}, ${data})`;
        }
        break;
      }
      case 'texSubImage2D': {
        // args: target, level, xoffset, yoffset, width, height, format, type, data
        const tgt2 = resolvedArgs[0];
        const level2 = resolvedArgs[1];
        const xoff = resolvedArgs[2];
        const yoff = resolvedArgs[3];
        const w2 = resolvedArgs[4];
        const h2 = resolvedArgs[5];
        const fmt2 = resolvedArgs[6];
        const dtype2 = resolvedArgs[7];
        const data2 = resolvedArgs[8];
        if (Array.isArray(data2)) {
          line = `gl.texSubImage2D(${tgt2}, ${level2}, ${xoff}, ${yoff}, ${w2}, ${h2}, ${fmt2}, ${dtype2}, new Uint8Array(${JSON.stringify(data2)}))`;
        } else {
          line = `gl.texSubImage2D(${tgt2}, ${level2}, ${xoff}, ${yoff}, ${w2}, ${h2}, ${fmt2}, ${dtype2}, ${data2})`;
        }
        break;
      }
      case 'texParameteri': {
        line = `gl.texParameteri(${resolvedArgs.join(', ')})`;
        break;
      }
      default: {
        // Generic fallback: try calling gl.op(args...)
        line = `gl.${op}(${resolvedArgs.map(a => Array.isArray(a) ? JSON.stringify(a) : a).join(', ')})`;
        break;
      }
    }

    if (retName) {
      js += `_refs[${JSON.stringify(retName)}] = ${line};\n`;
    } else {
      js += `${line};\n`;
    }
  }

  return js;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--enable-webgl'],
    protocolTimeout: 60000,
  });

  const { width, height } = scenes;
  let generated = 0;
  let failed = 0;

  for (const [name, scene] of Object.entries(scenes.scenes)) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });

    // Collect console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    const js = commandsToJS(scene.commands, width, height);

    await page.setContent(`<!DOCTYPE html>
      <html><head><style>
        body { margin: 0; padding: 0; background: transparent; }
      </style></head><body></body></html>`);

    try {
      await page.evaluate(js);
    } catch (e) {
      console.error(`  ✗ ${name}: JS evaluation failed: ${e.message}`);
      failed++;
      await page.close();
      continue;
    }

    if (errors.length > 0) {
      console.warn(`  ⚠ ${name}: ${errors.join('; ')}`);
    }

    // Screenshot just the canvas element
    const canvas = await page.$('canvas');
    if (canvas) {
      const outPath = path.join(__dirname, `${name}.truth.png`);
      await canvas.screenshot({ path: outPath, omitBackground: true });
      console.log(`  ✓ ${name} → ${outPath}`);
      generated++;
    } else {
      console.error(`  ✗ ${name}: no canvas found`);
      failed++;
    }

    await page.close();
  }

  await browser.close();
  console.log(`\nGenerated ${generated} reference images. ${failed > 0 ? `${failed} failed.` : ''}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
