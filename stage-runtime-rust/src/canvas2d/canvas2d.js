// Canvas 2D API polyfill for stage-runtime
// Methods call native __dz_canvas_cmd() which dispatches directly to Rust Canvas2D.

(function() {
  // Native function registered by Rust before this script is evaluated.
  var cmd = __dz_canvas_cmd;

  function CanvasRenderingContext2D(canvas) {
    this.canvas = canvas;
    this._fillStyle = '#000000';
    this._strokeStyle = '#000000';
    this._lineWidth = 1;
    this._lineCap = 'butt';
    this._lineJoin = 'miter';
    this._miterLimit = 10;
    this._globalAlpha = 1;
    this._font = '10px sans-serif';
    this._textAlign = 'start';
    this._textBaseline = 'alphabetic';
    this._shadowBlur = 0;
    this._shadowColor = 'rgba(0,0,0,0)';
    this._shadowOffsetX = 0;
    this._shadowOffsetY = 0;
    this._imageSmoothingEnabled = true;
    this._globalCompositeOperation = 'source-over';
    this._lineDash = [];
    this._lineDashOffset = 0;
    // Per-instance transform tracking (not shared across contexts)
    this._t = [1, 0, 0, 1, 0, 0];
    this._tStack = [];
  }

  var proto = CanvasRenderingContext2D.prototype;

  // --- Transform tracking (JS-side mirror of Rust state for getTransform) ---
  // DOMMatrix-like: [a, b, c, d, e, f] = [m11, m12, m21, m22, m41, m42]
  function multiplyTransform(ctx, a2, b2, c2, d2, e2, f2) {
    var t = ctx._t;
    var a1 = t[0], b1 = t[1], c1 = t[2], d1 = t[3], e1 = t[4], f1 = t[5];
    t[0] = a1 * a2 + c1 * b2;
    t[1] = b1 * a2 + d1 * b2;
    t[2] = a1 * c2 + c1 * d2;
    t[3] = b1 * c2 + d1 * d2;
    t[4] = a1 * e2 + c1 * f2 + e1;
    t[5] = b1 * e2 + d1 * f2 + f1;
  }

  // --- State ---
  proto.save = function() { this._tStack.push(this._t.slice()); cmd('save'); };
  proto.restore = function() { if (this._tStack.length) this._t = this._tStack.pop(); cmd('restore'); };

  // --- Transform ---
  proto.setTransform = function(a, b, c, d, e, f) { this._t = [a, b, c, d, e, f]; cmd('setTransform', a, b, c, d, e, f); };
  proto.resetTransform = function() { this._t = [1, 0, 0, 1, 0, 0]; cmd('resetTransform'); };
  proto.translate = function(x, y) { multiplyTransform(this, 1, 0, 0, 1, x, y); cmd('translate', x, y); };
  proto.rotate = function(a) { var c = Math.cos(a), s = Math.sin(a); multiplyTransform(this, c, s, -s, c, 0, 0); cmd('rotate', a); };
  proto.scale = function(x, y) { multiplyTransform(this, x, 0, 0, y, 0, 0); cmd('scale', x, y); };
  proto.transform = function(a, b, c, d, e, f) { multiplyTransform(this, a, b, c, d, e, f); cmd('transform', a, b, c, d, e, f); };
  proto.getTransform = function() { var t = this._t; return { a: t[0], b: t[1], c: t[2], d: t[3], e: t[4], f: t[5] }; };

  // --- Style properties ---
  Object.defineProperty(proto, 'fillStyle', {
    get: function() { return this._fillStyle; },
    set: function(v) {
      this._fillStyle = v;
      if (v && v._id && v._type === 'linearGradient' || v && v._id && v._type === 'radialGradient') {
        cmd('_setFillGradient', v._id);
      } else if (v && v._id && v._type === 'pattern') {
        cmd('_setFillPattern', v._id);
      } else {
        cmd('fillStyle', String(v));
      }
    }
  });
  Object.defineProperty(proto, 'strokeStyle', {
    get: function() { return this._strokeStyle; },
    set: function(v) {
      this._strokeStyle = v;
      if (v && v._id && v._type === 'linearGradient' || v && v._id && v._type === 'radialGradient') {
        cmd('_setStrokeGradient', v._id);
      } else if (v && v._id && v._type === 'pattern') {
        cmd('_setStrokePattern', v._id);
      } else {
        cmd('strokeStyle', String(v));
      }
    }
  });
  Object.defineProperty(proto, 'lineWidth', {
    get: function() { return this._lineWidth; },
    set: function(v) { this._lineWidth = v; cmd('lineWidth', v); }
  });
  Object.defineProperty(proto, 'lineCap', {
    get: function() { return this._lineCap; },
    set: function(v) { this._lineCap = v; cmd('lineCap', v); }
  });
  Object.defineProperty(proto, 'lineJoin', {
    get: function() { return this._lineJoin; },
    set: function(v) { this._lineJoin = v; cmd('lineJoin', v); }
  });
  Object.defineProperty(proto, 'miterLimit', {
    get: function() { return this._miterLimit; },
    set: function(v) { this._miterLimit = v; cmd('miterLimit', v); }
  });
  Object.defineProperty(proto, 'globalAlpha', {
    get: function() { return this._globalAlpha; },
    set: function(v) { this._globalAlpha = v; cmd('globalAlpha', v); }
  });
  Object.defineProperty(proto, 'font', {
    get: function() { return this._font; },
    set: function(v) { this._font = v; cmd('font', v); }
  });
  Object.defineProperty(proto, 'textAlign', {
    get: function() { return this._textAlign; },
    set: function(v) { this._textAlign = v; cmd('textAlign', v); }
  });
  Object.defineProperty(proto, 'textBaseline', {
    get: function() { return this._textBaseline; },
    set: function(v) { this._textBaseline = v; cmd('textBaseline', v); }
  });
  Object.defineProperty(proto, 'shadowBlur', {
    get: function() { return this._shadowBlur; },
    set: function(v) { this._shadowBlur = v; cmd('shadowBlur', v); }
  });
  Object.defineProperty(proto, 'shadowColor', {
    get: function() { return this._shadowColor; },
    set: function(v) { this._shadowColor = v; cmd('shadowColor', String(v)); }
  });
  Object.defineProperty(proto, 'shadowOffsetX', {
    get: function() { return this._shadowOffsetX; },
    set: function(v) { this._shadowOffsetX = v; cmd('shadowOffsetX', v); }
  });
  Object.defineProperty(proto, 'shadowOffsetY', {
    get: function() { return this._shadowOffsetY; },
    set: function(v) { this._shadowOffsetY = v; cmd('shadowOffsetY', v); }
  });
  Object.defineProperty(proto, 'imageSmoothingEnabled', {
    get: function() { return this._imageSmoothingEnabled; },
    set: function(v) { this._imageSmoothingEnabled = v; cmd('imageSmoothingEnabled', v ? 1 : 0); }
  });
  Object.defineProperty(proto, 'globalCompositeOperation', {
    get: function() { return this._globalCompositeOperation; },
    set: function(v) {
      this._globalCompositeOperation = v;
      cmd('globalCompositeOperation', v);
    }
  });

  // --- Line dash ---
  proto.setLineDash = function(segments) { this._lineDash = segments; cmd.apply(null, ['setLineDash'].concat(segments)); };
  proto.getLineDash = function() { return this._lineDash.slice(); };
  Object.defineProperty(proto, 'lineDashOffset', {
    get: function() { return this._lineDashOffset; },
    set: function(v) { this._lineDashOffset = v; cmd('lineDashOffset', v); }
  });

  // --- Rect drawing ---
  proto.fillRect = function(x, y, w, h) { cmd('fillRect', x, y, w, h); };
  proto.strokeRect = function(x, y, w, h) { cmd('strokeRect', x, y, w, h); };
  proto.clearRect = function(x, y, w, h) { cmd('clearRect', x, y, w, h); };

  // --- Path ---
  proto.beginPath = function() { cmd('beginPath'); };
  proto.closePath = function() { cmd('closePath'); };
  proto.moveTo = function(x, y) { cmd('moveTo', x, y); };
  proto.lineTo = function(x, y) { cmd('lineTo', x, y); };
  proto.bezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) { cmd('bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y); };
  proto.quadraticCurveTo = function(cpx, cpy, x, y) { cmd('quadraticCurveTo', cpx, cpy, x, y); };
  proto.arc = function(x, y, r, start, end, ccw) { cmd('arc', x, y, r, start, end, ccw ? 1 : 0); };
  proto.arcTo = function(x1, y1, x2, y2, r) { cmd('arcTo', x1, y1, x2, y2, r); };
  proto.ellipse = function(x, y, rx, ry, rot, start, end, ccw) { cmd('ellipse', x, y, rx, ry, rot, start, end, ccw ? 1 : 0); };
  proto.rect = function(x, y, w, h) { cmd('rect_path', x, y, w, h); };
  proto.fill = function(pathOrRule) {
    if (pathOrRule && pathOrRule._cmds) {
      cmd('beginPath');
      for (var i = 0; i < pathOrRule._cmds.length; i++) {
        cmd.apply(null, pathOrRule._cmds[i]);
      }
      cmd('fill');
    } else {
      cmd('fill');
    }
  };
  proto.stroke = function(path) {
    if (path && path._cmds) {
      cmd('beginPath');
      for (var i = 0; i < path._cmds.length; i++) {
        cmd.apply(null, path._cmds[i]);
      }
      cmd('stroke');
    } else {
      cmd('stroke');
    }
  };
  proto.clip = function(pathOrRule) {
    if (pathOrRule && pathOrRule._cmds) {
      cmd('beginPath');
      for (var i = 0; i < pathOrRule._cmds.length; i++) {
        cmd.apply(null, pathOrRule._cmds[i]);
      }
      cmd('clip');
    } else {
      cmd('clip');
    }
  };
  proto.isPointInPath = function() { return false; };
  proto.isPointInStroke = function() { return false; };

  // --- Text ---
  proto.fillText = function(text, x, y, maxWidth) { cmd('fillText', String(text), x, y); };
  proto.strokeText = function(text, x, y, maxWidth) { cmd('strokeText', String(text), x, y); };
  proto.measureText = function(text) {
    var fontSize = parseFloat(this._font) || 10;
    var bold = /bold|[6-9]00/.test(this._font);
    return __dz_measure_text(String(text), fontSize, bold);
  };

  // --- Image ---
  // Supports all three overloads:
  //   drawImage(img, dx, dy)
  //   drawImage(img, dx, dy, dw, dh)
  //   drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  proto.drawImage = function(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (!img || !img._id) return;
    var id = img._id;
    var n = arguments.length;
    if (n <= 3) {
      // drawImage(img, dx, dy)
      cmd('drawImage', id, sx || 0, sy || 0);
    } else if (n <= 5) {
      // drawImage(img, dx, dy, dw, dh)
      cmd('drawImage', id, sx, sy, sw, sh);
    } else {
      // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
      cmd('drawImage', id, sx, sy, sw, sh, dx, dy, dw, dh);
    }
  };
  proto.createImageData = function(w, h) {
    w = Math.max(0, w | 0); h = Math.max(0, h | 0);
    if (w > 8192 || h > 8192 || w * h > 67108864) { w = 0; h = 0; } // cap at 8192x8192 = 256MB
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  };
  proto.getImageData = function(x, y, w, h) {
    w = Math.max(0, w | 0); h = Math.max(0, h | 0);
    if (w > 8192 || h > 8192 || w * h > 67108864) { return { width: 0, height: 0, data: new Uint8ClampedArray(0) }; }
    var data = new Uint8ClampedArray(w * h * 4);
    // Synchronous native call: reads pixels directly from the pixmap.
    // No flush needed — commands are dispatched inline via __dz_canvas_cmd.
    __dz_canvas_get_image_data(data, x, y, w, h);
    return { width: w, height: h, data: data };
  };
  proto.putImageData = function(imageData, dx, dy) {
    // Native call: passes Uint8ClampedArray directly to Rust (no per-pixel arg copying)
    __dz_canvas_put_image_data(imageData.data, dx, dy, imageData.width, imageData.height);
  };

  // --- Gradient & Pattern ---
  var nextGradientId = 1;
  proto.createLinearGradient = function(x0, y0, x1, y1) {
    var id = '__grad_' + (nextGradientId++);
    cmd('_createLinearGradient', id, x0, y0, x1, y1);
    return {
      _id: id,
      _type: 'linearGradient',
      addColorStop: function(offset, color) {
        cmd('_addColorStop', id, offset, String(color));
      }
    };
  };
  proto.createRadialGradient = function(x0, y0, r0, x1, y1, r1) {
    var id = '__grad_' + (nextGradientId++);
    cmd('_createRadialGradient', id, x0, y0, r0, x1, y1, r1);
    return {
      _id: id,
      _type: 'radialGradient',
      addColorStop: function(offset, color) {
        cmd('_addColorStop', id, offset, String(color));
      }
    };
  };
  var nextPatternId = 1;
  proto.createPattern = function(img, rep) {
    if (!img || !img._id) return { _type: 'pattern' };
    var id = '__pat_' + (nextPatternId++);
    cmd('_createPattern', id, img._id, rep || 'repeat');
    return { _id: id, _type: 'pattern' };
  };

  // --- Conic gradient ---
  proto.createConicGradient = function(startAngle, x, y) {
    // Conic gradients are not supported by tiny-skia; return a stub with addColorStop
    if (typeof __dz_warnOnce === 'function') __dz_warnOnce('createConicGradient() not rendered — tiny-skia does not support conic gradients');
    return {
      _type: 'conicGradient',
      addColorStop: function() {}
    };
  };

  // --- roundRect (path operation) ---
  proto.roundRect = function(x, y, w, h, radii) {
    // Normalize radii to [tl, tr, br, bl]
    var r;
    if (typeof radii === 'number' || typeof radii === 'undefined') {
      var rv = radii || 0;
      r = [rv, rv, rv, rv];
    } else if (Array.isArray(radii)) {
      if (radii.length === 1) r = [radii[0], radii[0], radii[0], radii[0]];
      else if (radii.length === 2) r = [radii[0], radii[1], radii[0], radii[1]];
      else if (radii.length === 3) r = [radii[0], radii[1], radii[2], radii[1]];
      else r = [radii[0], radii[1], radii[2], radii[3]];
    } else {
      r = [0, 0, 0, 0];
    }
    cmd('roundRect', x, y, w, h, r[0], r[1], r[2], r[3]);
  };

  // --- reset() ---
  proto.reset = function() {
    this._fillStyle = '#000000';
    this._strokeStyle = '#000000';
    this._lineWidth = 1;
    this._lineCap = 'butt';
    this._lineJoin = 'miter';
    this._miterLimit = 10;
    this._globalAlpha = 1;
    this._font = '10px sans-serif';
    this._textAlign = 'start';
    this._textBaseline = 'alphabetic';
    this._shadowBlur = 0;
    this._shadowColor = 'rgba(0,0,0,0)';
    this._shadowOffsetX = 0;
    this._shadowOffsetY = 0;
    this._imageSmoothingEnabled = true;
    this._globalCompositeOperation = 'source-over';
    this._lineDash = [];
    this._lineDashOffset = 0;
    this._direction = 'ltr';
    this._filter = 'none';
    this._imageSmoothingQuality = 'low';
    this._letterSpacing = '0px';
    this._wordSpacing = '0px';
    this._fontKerning = 'auto';
    this._fontStretch = 'normal';
    this._fontVariantCaps = 'normal';
    this._textRendering = 'auto';
    cmd('reset');
  };

  // --- isContextLost() ---
  proto.isContextLost = function() { return false; };

  // --- getContextAttributes() ---
  proto.getContextAttributes = function() {
    return {
      alpha: true,
      colorSpace: 'srgb',
      desynchronized: false,
      willReadFrequently: true // backed by CPU rasterizer (tiny-skia)
    };
  };

  // --- Missing property getters/setters ---
  // These are tracked in JS only — tiny-skia doesn't support them natively,
  // but content may set/read them without breaking.
  (function() {
    var jsOnlyProps = {
      direction: 'ltr',
      filter: 'none',
      imageSmoothingQuality: 'low',
      letterSpacing: '0px',
      wordSpacing: '0px',
      fontKerning: 'auto',
      fontStretch: 'normal',
      fontVariantCaps: 'normal',
      textRendering: 'auto'
    };
    // Properties that have no visual effect — warn once on non-default set
    var noRenderProps = { filter: true, letterSpacing: true, wordSpacing: true };
    for (var prop in jsOnlyProps) {
      (function(p, def) {
        var priv = '_' + p;
        CanvasRenderingContext2D.prototype[priv] = def;
        Object.defineProperty(proto, p, {
          get: function() { return this[priv]; },
          set: function(v) {
            if (noRenderProps[p] && v !== def && typeof __dz_warnOnce === 'function') {
              __dz_warnOnce('ctx.' + p + ' = "' + v + '" set but not rendered by stage-runtime');
            }
            this[priv] = v;
          }
        });
      })(prop, jsOnlyProps[prop]);
    }
  })();

  // --- Register as canvas context factory ---
  globalThis.__dz_create_canvas2d = function(canvas) {
    return new CanvasRenderingContext2D(canvas);
  };

  // --- Path2D ---
  function Path2D(arg) {
    this._cmds = [];
    if (arg instanceof Path2D) {
      this._cmds = arg._cmds.slice();
    }
    // SVG path string parsing not supported yet
  }
  Path2D.prototype.addPath = function(path) {
    if (path && path._cmds) {
      this._cmds = this._cmds.concat(path._cmds);
    }
  };
  Path2D.prototype.moveTo = function(x, y) { this._cmds.push(['moveTo', x, y]); };
  Path2D.prototype.lineTo = function(x, y) { this._cmds.push(['lineTo', x, y]); };
  Path2D.prototype.bezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {
    this._cmds.push(['bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y]);
  };
  Path2D.prototype.quadraticCurveTo = function(cpx, cpy, x, y) {
    this._cmds.push(['quadraticCurveTo', cpx, cpy, x, y]);
  };
  Path2D.prototype.arc = function(x, y, r, start, end, ccw) {
    this._cmds.push(['arc', x, y, r, start, end, ccw ? 1 : 0]);
  };
  Path2D.prototype.arcTo = function(x1, y1, x2, y2, r) {
    this._cmds.push(['arcTo', x1, y1, x2, y2, r]);
  };
  Path2D.prototype.ellipse = function(x, y, rx, ry, rot, start, end, ccw) {
    this._cmds.push(['ellipse', x, y, rx, ry, rot, start, end, ccw ? 1 : 0]);
  };
  Path2D.prototype.rect = function(x, y, w, h) {
    this._cmds.push(['rect_path', x, y, w, h]);
  };
  Path2D.prototype.roundRect = function(x, y, w, h, radii) {
    var r;
    if (typeof radii === 'number' || typeof radii === 'undefined') {
      var rv = radii || 0;
      r = [rv, rv, rv, rv];
    } else if (Array.isArray(radii)) {
      if (radii.length === 1) r = [radii[0], radii[0], radii[0], radii[0]];
      else if (radii.length === 2) r = [radii[0], radii[1], radii[0], radii[1]];
      else if (radii.length === 3) r = [radii[0], radii[1], radii[2], radii[1]];
      else r = [radii[0], radii[1], radii[2], radii[3]];
    } else {
      r = [0, 0, 0, 0];
    }
    this._cmds.push(['roundRect', x, y, w, h, r[0], r[1], r[2], r[3]]);
  };
  Path2D.prototype.closePath = function() { this._cmds.push(['closePath']); };

  globalThis.Path2D = Path2D;

  if (typeof __dz_reset_hooks !== 'undefined') {
    __dz_reset_hooks.push(function() {
      nextGradientId = 1;
      nextPatternId = 1;
      // Per-instance transform state is reset when new contexts are created on navigation.
    });
  }
})();
