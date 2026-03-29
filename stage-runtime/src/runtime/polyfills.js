// Browser globals polyfill for stage-runtime
// Evaluated before user content to provide browser-like environment

// --- Once-warn utility: logs each message only once ---
var __dz_warned = {};
function __dz_warnOnce(msg) {
  if (!__dz_warned[msg]) {
    __dz_warned[msg] = true;
    console.warn('[stage-runtime] ' + msg);
  }
}

// --- Reset hooks: each IIFE registers a cleanup callback for Page.navigate ---
globalThis.__dz_reset_hooks = [];

// --- HTML dirty flag: set true when DOM is mutated, checked by Rust each frame ---
globalThis.__dz_html_dirty = false;

// --- Incremental DOM: command buffer for style mutations (Phase 1) ---
// Commands: [opcode, node_id, prop_kebab, value_string]
// Opcode 1 = SET_STYLE, 2 = STRUCTURAL_CHANGE (fallback to full re-render)
globalThis.__dz_dom_cmds = [];
globalThis.__dz_layout_rects = {};
var __dz_next_node_id = 1; // 0 reserved for document.body

// --- window is the global object ---
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

// --- Window properties ---
window.innerWidth = 1280;
window.innerHeight = 720;
window.devicePixelRatio = 1;
window.location = { href: 'about:blank', origin: '', protocol: 'https:', host: '', pathname: '/' };
window.navigator = {
  userAgent: 'stage-runtime/0.1',
  language: 'en-US',
  languages: ['en-US'],
  hardwareConcurrency: 1,
  platform: 'Linux',
};
window.screen = { width: 1280, height: 720, availWidth: 1280, availHeight: 720, colorDepth: 24 };

// --- performance.now() backed by virtual frame time ---
// __dz_perf_now is updated each frame by Rust's tick_frame()
globalThis.__dz_perf_now = 0;
window.performance = {
  now: function() { return __dz_perf_now; },
  timeOrigin: Date.now(),
};

// --- Event system ---
(function() {
  const listeners = {};

  var MAX_EVENT_LISTENERS_PER_TYPE = 500;
  window.addEventListener = function(type, fn, opts) {
    if (!listeners[type]) listeners[type] = [];
    if (listeners[type].length >= MAX_EVENT_LISTENERS_PER_TYPE) return;
    listeners[type].push({ fn, opts });
  };

  window.removeEventListener = function(type, fn) {
    if (!listeners[type]) return;
    listeners[type] = listeners[type].filter(l => l.fn !== fn);
  };

  window.dispatchEvent = function(event) {
    const handlers = listeners[event.type];
    if (!handlers) return true;
    for (const h of handlers) {
      try { h.fn(event); } catch (e) { console.error('Event handler error:', e); }
      if (h.opts && h.opts.once) {
        window.removeEventListener(event.type, h.fn);
      }
    }
    return true;
  };

  // Reset hook: clear all event listeners on navigation
  __dz_reset_hooks.push(function() {
    for (var k in listeners) delete listeners[k];
  });

  // Event constructor (base)
  if (typeof globalThis.Event === 'undefined') {
    globalThis.Event = function Event(type, init) {
      init = init || {};
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.cancelable = !!init.cancelable;
      this.defaultPrevented = false;
      this.timeStamp = performance.now();
      this.target = null;
      this.currentTarget = null;
      this.eventPhase = 0;
      this.isTrusted = false;
      this._stopPropagation = false;
      this._stopImmediate = false;
    };
    Event.prototype.preventDefault = function() { if (this.cancelable) this.defaultPrevented = true; };
    Event.prototype.stopPropagation = function() { this._stopPropagation = true; };
    Event.prototype.stopImmediatePropagation = function() { this._stopPropagation = true; this._stopImmediate = true; };
    Event.prototype.composedPath = function() { return this.target ? [this.target] : []; };
  }

  // CustomEvent constructor
  globalThis.CustomEvent = function CustomEvent(type, init) {
    init = init || {};
    this.type = type;
    this.detail = init.detail !== undefined ? init.detail : null;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.defaultPrevented = false;
    this.timeStamp = performance.now();
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.isTrusted = false;
    this._stopPropagation = false;
    this._stopImmediate = false;
  };
  CustomEvent.prototype.preventDefault = function() { if (this.cancelable) this.defaultPrevented = true; };
  CustomEvent.prototype.stopPropagation = function() { this._stopPropagation = true; };
  CustomEvent.prototype.stopImmediatePropagation = function() { this._stopPropagation = true; this._stopImmediate = true; };
  CustomEvent.prototype.composedPath = function() { return this.target ? [this.target] : []; };
})();

// --- Timer system (fires at frame boundaries) ---
(function() {
  let nextId = 1;
  const timers = {};

  // __dz_timers is accessed by Rust frame loop to fire due timers
  globalThis.__dz_timers = {
    timers: timers,
    process: function(currentTimeMs) {
      const toFire = [];
      for (const id in timers) {
        const t = timers[id];
        if (currentTimeMs >= t.due) {
          toFire.push(id);
        }
      }
      for (const id of toFire) {
        const t = timers[id];
        if (!t) continue;
        try { t.fn(); } catch(e) { console.error('Timer error:', e); }
        if (t.interval) {
          t.due = currentTimeMs + t.delay;
        } else {
          delete timers[id];
        }
      }
    }
  };

  var MAX_TIMERS = 10000;
  window.setTimeout = function(fn, delay) {
    if (typeof fn !== 'function') return 0;
    if (Object.keys(timers).length >= MAX_TIMERS) return 0;
    const id = nextId++;
    timers[id] = { fn, delay: delay || 0, due: performance.now() + (delay || 0), interval: false };
    return id;
  };

  window.clearTimeout = function(id) {
    delete timers[id];
  };

  window.setInterval = function(fn, delay) {
    if (typeof fn !== 'function') return 0;
    if (Object.keys(timers).length >= MAX_TIMERS) return 0;
    const id = nextId++;
    timers[id] = { fn, delay: delay || 0, due: performance.now() + (delay || 0), interval: true };
    return id;
  };

  window.clearInterval = function(id) {
    delete timers[id];
  };

  // Reset hook: clear all timers on navigation
  __dz_reset_hooks.push(function() {
    for (var k in timers) delete timers[k];
    nextId = 1;
  });
})();

// --- requestAnimationFrame / cancelAnimationFrame ---
// Managed by Rust, but we need the JS-side callback registry
(function() {
  let nextId = 1;
  const callbacks = {};

  // __dz_raf is accessed by Rust to call registered callbacks each frame
  globalThis.__dz_raf = {
    callbacks: callbacks,
    process: function(timestamp) {
      // Copy keys — callbacks may register new ones during iteration
      const ids = Object.keys(callbacks);
      for (const id of ids) {
        const fn = callbacks[id];
        if (fn) {
          delete callbacks[id]; // rAF is one-shot
          try { fn(timestamp); } catch(e) { console.error('rAF error:', e); }
        }
      }
    }
  };

  var MAX_RAF = 10000;
  window.requestAnimationFrame = function(fn) {
    if (typeof fn !== 'function') return 0;
    if (Object.keys(callbacks).length >= MAX_RAF) return 0;
    const id = nextId++;
    callbacks[id] = fn;
    return id;
  };

  window.cancelAnimationFrame = function(id) {
    delete callbacks[id];
  };

  // Reset hook: clear all rAF callbacks on navigation
  __dz_reset_hooks.push(function() {
    for (var k in callbacks) delete callbacks[k];
    nextId = 1;
  });
})();

// --- Document stub ---
(function() {
  const canvases = [];
  const elementsById = {};
  var elementsByTag = {};    // UPPERCASE tag → [el, ...]
  var elementsByClass = {};  // className → [el, ...]

  // Helper: check if el is a descendant of root (max depth 256)
  function isDescendantOf(el, root) {
    var p = el.parentNode, d = 0;
    while (p && d < 256) { if (p === root) return true; p = p.parentNode; d++; }
    return false;
  }

  // Helper: register element in tag index
  function indexByTag(el) {
    var tag = el.tagName;
    if (!tag) return;
    if (!elementsByTag[tag]) elementsByTag[tag] = [];
    elementsByTag[tag].push(el);
  }

  // Helper: remove element from tag index
  function unindexByTag(el) {
    var tag = el.tagName;
    if (!tag || !elementsByTag[tag]) return;
    var arr = elementsByTag[tag];
    var idx = arr.indexOf(el);
    if (idx !== -1) arr.splice(idx, 1);
  }

  // Helper: update class indexes when className changes
  function updateClassIndex(el, oldName, newName) {
    var oldClasses = oldName ? oldName.split(/\s+/) : [];
    var newClasses = newName ? newName.split(/\s+/) : [];
    for (var i = 0; i < oldClasses.length; i++) {
      if (oldClasses[i] && elementsByClass[oldClasses[i]]) {
        var arr = elementsByClass[oldClasses[i]];
        var idx = arr.indexOf(el);
        if (idx !== -1) arr.splice(idx, 1);
      }
    }
    for (var i = 0; i < newClasses.length; i++) {
      if (newClasses[i]) {
        if (!elementsByClass[newClasses[i]]) elementsByClass[newClasses[i]] = [];
        if (elementsByClass[newClasses[i]].indexOf(el) === -1) elementsByClass[newClasses[i]].push(el);
      }
    }
  }

  // Minimal canvas factory — getContext returns stubs that Rust replaces with native bindings
  function createCanvas() {
    const canvas = {
      tagName: 'CANVAS',
      nodeName: 'CANVAS',
      nodeType: 1,
      width: window.innerWidth,
      height: window.innerHeight,
      style: {},
      className: '',
      _id: null,
      _attrs: {},
      _contexts: {},
      parentNode: null,
      parentElement: null,
      children: [],
      childNodes: [],
      firstChild: null,
      lastChild: null,
      nextSibling: null,
      previousSibling: null,
      getContext: function(type, attrs) {
        // Rust native bindings replace these — see canvas2d and webgl2 modules
        if (canvas._contexts[type]) return canvas._contexts[type];
        // Return null if native binding not registered yet
        if (type === '2d' && globalThis.__dz_create_canvas2d) {
          canvas._contexts[type] = globalThis.__dz_create_canvas2d(canvas);
          return canvas._contexts[type];
        }
        if ((type === 'webgl2' || type === 'webgl') && globalThis.__dz_create_webgl2) {
          canvas._contexts[type] = globalThis.__dz_create_webgl2(canvas);
          return canvas._contexts[type];
        }
        console.warn('stage-runtime: getContext("' + type + '") not yet available');
        return null;
      },
      toDataURL: function(type, quality) {
        // Read canvas pixels and encode to data URI via Rust native binding
        if (typeof __dz_canvas_to_data_url === 'function') {
          return __dz_canvas_to_data_url(type || 'image/png', quality || 0.92);
        }
        __dz_warnOnce('canvas.toDataURL() — native encoder not available, returning empty string');
        return '';
      },
      toBlob: function(cb, type, quality) {
        if (typeof __dz_canvas_to_data_url === 'function') {
          var dataUrl = __dz_canvas_to_data_url(type || 'image/png', quality || 0.92);
          if (dataUrl && cb) {
            // Convert data URI to Blob
            var parts = dataUrl.split(',');
            var mime = parts[0].match(/:(.*?);/)[1];
            var binary = atob(parts[1]);
            var arr = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
            cb(new Blob([arr], { type: mime }));
            return;
          }
        }
        __dz_warnOnce('canvas.toBlob() — native encoder not available');
        if (cb) cb(null);
      },
      appendChild: function(child) {
        if (child && child.parentNode) child.parentNode.removeChild(child);
        canvas.children.push(child);
        canvas.childNodes.push(child);
        if (child) { child.parentNode = canvas; child.parentElement = canvas; }
        updateChildLinks(canvas);
        return child;
      },
      removeChild: function(child) {
        var idx = canvas.children.indexOf(child);
        if (idx !== -1) canvas.children.splice(idx, 1);
        idx = canvas.childNodes.indexOf(child);
        if (idx !== -1) canvas.childNodes.splice(idx, 1);
        if (child) { child.parentNode = null; child.parentElement = null; child.nextSibling = null; child.previousSibling = null; }
        updateChildLinks(canvas);
        return child;
      },
      insertBefore: function(newChild, refChild) {
        if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
        var idx = canvas.childNodes.indexOf(refChild);
        if (idx === -1) { canvas.childNodes.push(newChild); canvas.children.push(newChild); }
        else { canvas.childNodes.splice(idx, 0, newChild); canvas.children.splice(idx, 0, newChild); }
        newChild.parentNode = canvas; newChild.parentElement = canvas;
        updateChildLinks(canvas);
        return newChild;
      },
      contains: function(other) {
        if (other === canvas) return true;
        for (var i = 0; i < canvas.childNodes.length; i++) {
          if (canvas.childNodes[i] === other) return true;
          if (canvas.childNodes[i].contains && canvas.childNodes[i].contains(other)) return true;
        }
        return false;
      },
      cloneNode: function() { return createCanvas(); },
      remove: function() {
        if (canvas.parentNode && canvas.parentNode.removeChild) canvas.parentNode.removeChild(canvas);
      },
      getBoundingClientRect: function() {
        return { x: 0, y: 0, width: canvas.width, height: canvas.height, top: 0, left: 0, bottom: canvas.height, right: canvas.width };
      },
      setAttribute: function(name, value) {
        canvas._attrs[name] = String(value);
        if (name === 'id') {
          canvas._id = value;
          elementsById[value] = canvas;
        }
        if (name === 'class') canvas.className = value;
      },
      getAttribute: function(name) {
        if (name === 'id') return canvas._id;
        if (name === 'class') return canvas.className;
        return canvas._attrs[name] !== undefined ? canvas._attrs[name] : null;
      },
      hasAttribute: function(name) {
        return canvas._attrs[name] !== undefined || (name === 'id' && canvas._id !== null);
      },
      removeAttribute: function(name) { delete canvas._attrs[name]; },
      closest: function() { return null; },
      matches: function() { return false; },
      querySelector: function() { return null; },
      querySelectorAll: function() { return []; },
      getElementsByTagName: function() { return []; },
      getElementsByClassName: function() { return []; },
      focus: function() {},
      blur: function() {},
    };
    canvas.classList = makeClassList(canvas);
    makeEventTarget(canvas);
    canvas.dataset = makeDataset(canvas);
    canvas.ownerDocument = window.document;
    canvas.namespaceURI = 'http://www.w3.org/1999/xhtml';
    canvas.nodeValue = null;
    canvas.offsetWidth = canvas.width;
    canvas.offsetHeight = canvas.height;
    canvas.offsetTop = 0;
    canvas.offsetLeft = 0;
    canvas.offsetParent = null;
    canvas.scrollWidth = canvas.width;
    canvas.scrollHeight = canvas.height;
    canvas.scrollTop = 0;
    canvas.scrollLeft = 0;
    canvas.clientWidth = canvas.width;
    canvas.clientHeight = canvas.height;
    canvas.clientTop = 0;
    canvas.clientLeft = 0;
    // id property
    Object.defineProperty(canvas, 'id', {
      get: function() { return canvas._id || ''; },
      set: function(v) { canvas._id = v; elementsById[v] = canvas; },
    });
    canvases.push(canvas);
    return canvas;
  }

  // Reactive style object: fires MutationObserver on property set
  function makeReactiveStyle(el) {
    var store = {};
    return new Proxy(store, {
      get: function(target, prop) {
        if (prop === 'setProperty') return function(name, value) {
          var camel = name.replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
          target[camel] = value;
          if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('attributes', el, [], [], 'style', null);
        };
        if (prop === 'removeProperty') return function(name) {
          var camel = name.replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
          var old = target[camel];
          delete target[camel];
          return old || '';
        };
        if (prop === 'getPropertyValue') return function(name) {
          var camel = name.replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
          return target[camel] || '';
        };
        if (prop === 'cssText') {
          var parts = [];
          for (var k in target) {
            var kebab = k.replace(/([A-Z])/g, '-$1').toLowerCase();
            parts.push(kebab + ': ' + target[k]);
          }
          return parts.join('; ');
        }
        if (prop === 'length') return Object.keys(target).length;
        return target[prop] !== undefined ? target[prop] : '';
      },
      set: function(target, prop, value) {
        var oldVal = target[prop];
        // Check if a CSS transition should handle this change
        if (typeof globalThis.__dz_transition_check === 'function' && oldVal !== undefined && oldVal !== value) {
          if (globalThis.__dz_transition_check(el, prop, oldVal, value)) {
            return true; // transition will drive the value
          }
        }
        target[prop] = value;
        // Push incremental style command: [SET_STYLE=1, node_id, kebab-prop, value]
        // All elements (HTML and SVG) use opcode 1. The Rust-side persistent DOM
        // detects SVG dirty nodes and falls back to full re-render when needed.
        if (el._dz_id !== undefined && typeof prop === 'string') {
          var kebab = prop.replace(/([A-Z])/g, '-$1').toLowerCase();
          globalThis.__dz_dom_cmds.push([1, el._dz_id, kebab, String(value)]);
        }
        globalThis.__dz_html_dirty = true;
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('attributes', el, [], [], 'style', null);
        return true;
      }
    });
  }
  // Style proxy: get returns stored value or '' for missing props.
  // Animation/transition hooks read directly via proxy (e.g., el.style.animation).

  // An+B formula matcher for :nth-child(), :nth-of-type(), etc.
  // idx is 1-based position.
  function matchNthFormula(formula, idx) {
    formula = formula.trim();
    if (formula === 'odd') return idx % 2 === 1;
    if (formula === 'even') return idx % 2 === 0;
    var n = parseInt(formula, 10);
    if (!isNaN(n) && String(n) === formula) return idx === n;
    // An+B syntax: "2n+1", "-n+3", "3n", "n", "-2n-1"
    var m = formula.match(/^([+-]?\d*)n([+-]\d+)?$/);
    if (m) {
      var a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10);
      var b = m[2] ? parseInt(m[2], 10) : 0;
      if (a === 0) return idx === b;
      var diff = idx - b;
      return diff % a === 0 && diff / a >= 0;
    }
    return false;
  }

  // Helper: find 1-based position among same-tagName siblings
  function typeIndex(el) {
    var parent = el.parentNode;
    if (!parent || !parent.children) return -1;
    var count = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === el.tagName) count++;
      if (parent.children[i] === el) return count;
    }
    return -1;
  }
  function typeIndexFromEnd(el) {
    var parent = el.parentNode;
    if (!parent || !parent.children) return -1;
    var count = 0;
    for (var i = parent.children.length - 1; i >= 0; i--) {
      if (parent.children[i].tagName === el.tagName) count++;
      if (parent.children[i] === el) return count;
    }
    return -1;
  }
  function typeCount(el) {
    var parent = el.parentNode;
    if (!parent || !parent.children) return 0;
    var count = 0;
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].tagName === el.tagName) count++;
    }
    return count;
  }

  // Match element against a simple CSS selector part (no combinators).
  // Supports: tag, #id, .class, [attr], [attr="val"], [attr^=], [attr$=],
  // [attr*=], [attr~=], [attr|=], :first-child, :last-child, :nth-child(An+B),
  // :nth-last-child, :nth-of-type, :nth-last-of-type, :first-of-type,
  // :last-of-type, :only-child, :only-of-type, :empty, :not(sel)
  function matchesSimple(el, sel) {
    if (!el || !el.tagName) return false;
    sel = sel.trim();
    if (!sel) return false;

    // Split compound: e.g. "div.foo[data-x]:first-child" into parts
    // Each part is one of: tag, .class, #id, [attr...], :pseudo
    var parts = [];
    var i = 0, len = sel.length;
    while (i < len) {
      var ch = sel.charAt(i);
      if (ch === '#' || ch === '.' || ch === '[' || ch === ':') {
        var start = i;
        if (ch === '[') {
          var end = sel.indexOf(']', i);
          if (end === -1) end = len;
          parts.push(sel.substring(start, end + 1));
          i = end + 1;
        } else if (ch === ':') {
          // Grab until next selector boundary or end
          var end = i + 1;
          // Handle :nth-child(...) — scan past parens
          while (end < len && sel.charAt(end) !== '.' && sel.charAt(end) !== '#' && sel.charAt(end) !== '[' && sel.charAt(end) !== ':') {
            if (sel.charAt(end) === '(') {
              var close = sel.indexOf(')', end);
              end = close === -1 ? len : close + 1;
            } else {
              end++;
            }
          }
          parts.push(sel.substring(start, end));
          i = end;
        } else {
          // # or . — grab until next boundary
          var end = i + 1;
          while (end < len && sel.charAt(end) !== '.' && sel.charAt(end) !== '#' && sel.charAt(end) !== '[' && sel.charAt(end) !== ':') end++;
          parts.push(sel.substring(start, end));
          i = end;
        }
      } else {
        // tag name
        var end = i;
        while (end < len && sel.charAt(end) !== '.' && sel.charAt(end) !== '#' && sel.charAt(end) !== '[' && sel.charAt(end) !== ':') end++;
        parts.push(sel.substring(i, end));
        i = end;
      }
    }

    // If no compound parts found, treat whole thing as tag or simple selector
    if (parts.length === 0) parts.push(sel);

    for (var p = 0; p < parts.length; p++) {
      var part = parts[p];
      var fc = part.charAt(0);
      if (fc === '#') {
        if ((el._id || el.id) !== part.substring(1)) return false;
      } else if (fc === '.') {
        var cls = part.substring(1);
        // Check classList first, fall back to className string (classList internal array
        // may be out of sync when className was set directly rather than via classList.add)
        var hasClass = el.classList ? (el.classList.contains(cls) || (el.className || '').split(' ').indexOf(cls) !== -1)
                                   : (el.className || '').split(' ').indexOf(cls) !== -1;
        if (!hasClass) return false;
      } else if (fc === '[') {
        // Attribute selector: [attr], [attr="val"], [attr^="val"], [attr$="val"], [attr*="val"]
        var inner = part.substring(1, part.length - 1);
        var eqIdx = inner.indexOf('=');
        if (eqIdx === -1) {
          // [attr] — existence
          if (el.getAttribute(inner) === null && el.getAttribute(inner) === undefined) return false;
          if (!el._attrs || !(inner in el._attrs)) {
            if (inner === 'class' && !el.className) return false;
            else if (inner === 'id' && !(el._id || el.id)) return false;
            else if (inner !== 'class' && inner !== 'id' && (!el._attrs || !(inner in el._attrs))) return false;
          }
        } else {
          var op = '';
          var attrName = inner.substring(0, eqIdx);
          var lastCh = attrName.charAt(attrName.length - 1);
          if (lastCh === '^' || lastCh === '$' || lastCh === '*' || lastCh === '~' || lastCh === '|') {
            op = lastCh;
            attrName = attrName.substring(0, attrName.length - 1);
          }
          var attrVal = inner.substring(eqIdx + 1);
          // Strip quotes
          if ((attrVal.charAt(0) === '"' || attrVal.charAt(0) === "'") && attrVal.charAt(attrVal.length - 1) === attrVal.charAt(0)) {
            attrVal = attrVal.substring(1, attrVal.length - 1);
          }
          var actual = el.getAttribute ? el.getAttribute(attrName) : null;
          if (actual === null || actual === undefined) return false;
          actual = String(actual);
          if (op === '^') { if (actual.indexOf(attrVal) !== 0) return false; }
          else if (op === '$') { if (actual.indexOf(attrVal, actual.length - attrVal.length) === -1) return false; }
          else if (op === '*') { if (actual.indexOf(attrVal) === -1) return false; }
          else if (op === '~') { if (actual.split(/\s+/).indexOf(attrVal) === -1) return false; }
          else if (op === '|') { if (actual !== attrVal && actual.indexOf(attrVal + '-') !== 0) return false; }
          else { if (actual !== attrVal) return false; }
        }
      } else if (fc === ':') {
        // Pseudo-class
        var pseudo = part.substring(1);
        if (pseudo === 'first-child') {
          var parent = el.parentNode;
          if (!parent || !parent.children || parent.children[0] !== el) return false;
        } else if (pseudo === 'last-child') {
          var parent = el.parentNode;
          if (!parent || !parent.children || parent.children[parent.children.length - 1] !== el) return false;
        } else if (pseudo.indexOf('nth-child(') === 0) {
          var arg = pseudo.substring(10, pseudo.length - 1).trim();
          var parent = el.parentNode;
          if (!parent || !parent.children) return false;
          var idx = -1;
          for (var ci = 0; ci < parent.children.length; ci++) {
            if (parent.children[ci] === el) { idx = ci + 1; break; }
          }
          if (idx === -1 || !matchNthFormula(arg, idx)) return false;
        } else if (pseudo.indexOf('nth-last-child(') === 0) {
          var arg = pseudo.substring(15, pseudo.length - 1).trim();
          var parent = el.parentNode;
          if (!parent || !parent.children) return false;
          var pos = parent.children.indexOf(el);
          if (pos === -1) return false;
          var idx = parent.children.length - pos; // 1-based from end
          if (!matchNthFormula(arg, idx)) return false;
        } else if (pseudo.indexOf('nth-of-type(') === 0) {
          var arg = pseudo.substring(12, pseudo.length - 1).trim();
          var idx = typeIndex(el);
          if (idx === -1 || !matchNthFormula(arg, idx)) return false;
        } else if (pseudo.indexOf('nth-last-of-type(') === 0) {
          var arg = pseudo.substring(17, pseudo.length - 1).trim();
          var idx = typeIndexFromEnd(el);
          if (idx === -1 || !matchNthFormula(arg, idx)) return false;
        } else if (pseudo === 'first-of-type') {
          if (typeIndex(el) !== 1) return false;
        } else if (pseudo === 'last-of-type') {
          if (typeIndexFromEnd(el) !== 1) return false;
        } else if (pseudo === 'only-child') {
          var parent = el.parentNode;
          if (!parent || !parent.children || parent.children.length !== 1) return false;
        } else if (pseudo === 'only-of-type') {
          if (typeCount(el) !== 1) return false;
        } else if (pseudo === 'empty') {
          if (el.children && el.children.length > 0) return false;
          var cn = el.childNodes || [];
          for (var ci = 0; ci < cn.length; ci++) {
            if (cn[ci].nodeType === 3 && (cn[ci].nodeValue || cn[ci].textContent || '').length > 0) return false;
          }
        } else if (pseudo.indexOf('not(') === 0) {
          var innerSel = pseudo.substring(4, pseudo.length - 1).trim();
          if (matchesSimple(el, innerSel)) return false;
        } else {
          return false; // unsupported pseudo — no match
        }
      } else {
        // Tag name
        if (el.tagName !== part.toUpperCase()) return false;
      }
    }
    return true;
  }

  // Tokenize a selector into segments and combinators for combinator matching.
  // Returns array of { sel: string, combinator: string } where combinator is
  // ' ', '>', '+', '~' (empty string for the rightmost segment).
  var HAS_COMBINATOR_RE = /[\s>+~]/;
  function tokenizeCombinators(sel) {
    var tokens = [];
    var i = 0, len = sel.length;
    var current = '';
    while (i < len) {
      var ch = sel.charAt(i);
      // Skip inside brackets
      if (ch === '[') {
        var end = sel.indexOf(']', i);
        if (end === -1) end = len - 1;
        current += sel.substring(i, end + 1);
        i = end + 1;
        continue;
      }
      // Skip inside parens (for :nth-child(...))
      if (ch === '(') {
        var end = sel.indexOf(')', i);
        if (end === -1) end = len - 1;
        current += sel.substring(i, end + 1);
        i = end + 1;
        continue;
      }
      if (ch === '>' || ch === '+' || ch === '~') {
        if (current.trim()) tokens.push({ sel: current.trim(), combinator: '' });
        tokens.push({ combinator: ch });
        current = '';
        i++;
        continue;
      }
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        // Could be descendant combinator or just whitespace around > + ~
        // Skip whitespace
        while (i < len && (sel.charAt(i) === ' ' || sel.charAt(i) === '\t' || sel.charAt(i) === '\n')) i++;
        // Check if next char is a combinator
        if (i < len && (sel.charAt(i) === '>' || sel.charAt(i) === '+' || sel.charAt(i) === '~')) continue;
        // It's a descendant combinator
        if (current.trim()) {
          tokens.push({ sel: current.trim(), combinator: '' });
          tokens.push({ combinator: ' ' });
          current = '';
        }
        continue;
      }
      current += ch;
      i++;
    }
    if (current.trim()) tokens.push({ sel: current.trim(), combinator: '' });
    return tokens;
  }

  // Match a selector with combinators: "div > .foo .bar" etc.
  // Match right-to-left.
  function matchesCompound(el, sel) {
    var tokens = tokenizeCombinators(sel);
    if (tokens.length === 0) return false;
    // Cap combinator depth
    if (tokens.length > 15) return false;

    // Build segments: array of { sel, combinator }
    // tokens alternates: sel, combinator, sel, combinator, sel
    var segments = [];
    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i].sel) {
        var comb = (i + 1 < tokens.length && tokens[i + 1].combinator && !tokens[i + 1].sel) ? tokens[i + 1].combinator : '';
        segments.push({ sel: tokens[i].sel, combinator: comb });
      }
    }
    if (segments.length === 0) return false;

    // Rightmost segment must match el
    if (!matchesSimple(el, segments[segments.length - 1].sel)) return false;
    if (segments.length === 1) return true;

    // Walk left through segments
    var current = el;
    for (var s = segments.length - 2; s >= 0; s--) {
      var seg = segments[s];
      var comb = seg.combinator; // combinator AFTER this segment (toward the right)
      if (comb === ' ') {
        // Descendant: any ancestor
        var found = false;
        current = current.parentNode;
        while (current && current.tagName) {
          if (matchesSimple(current, seg.sel)) { found = true; break; }
          current = current.parentNode;
        }
        if (!found) return false;
      } else if (comb === '>') {
        // Child: immediate parent
        current = current.parentNode;
        if (!current || !matchesSimple(current, seg.sel)) return false;
      } else if (comb === '+') {
        // Adjacent sibling: previous element sibling
        var parent = current.parentNode;
        if (!parent || !parent.children) return false;
        var idx = -1;
        for (var ci = 0; ci < parent.children.length; ci++) {
          if (parent.children[ci] === current) { idx = ci; break; }
        }
        if (idx <= 0) return false;
        current = parent.children[idx - 1];
        if (!matchesSimple(current, seg.sel)) return false;
      } else if (comb === '~') {
        // General sibling: any previous element sibling
        var parent = current.parentNode;
        if (!parent || !parent.children) return false;
        var found = false;
        for (var ci = 0; ci < parent.children.length; ci++) {
          if (parent.children[ci] === current) break;
          if (matchesSimple(parent.children[ci], seg.sel)) { found = true; current = parent.children[ci]; break; }
        }
        if (!found) return false;
      } else {
        // No combinator between segments — treat as descendant
        var found = false;
        current = current.parentNode;
        while (current && current.tagName) {
          if (matchesSimple(current, seg.sel)) { found = true; break; }
          current = current.parentNode;
        }
        if (!found) return false;
      }
    }
    return true;
  }

  // Match element against a CSS selector. Dispatches to simple or compound matching.
  function matchesSelector(el, sel) {
    if (!el || !el.tagName) return false;
    sel = sel.trim();
    // Fast path: no combinator characters → simple match
    if (!HAS_COMBINATOR_RE.test(sel) && sel.indexOf('[') === -1 && sel.indexOf(':') === -1) {
      return matchesSimple(el, sel);
    }
    // Check for combinators
    if (HAS_COMBINATOR_RE.test(sel)) {
      return matchesCompound(el, sel);
    }
    // Has attribute or pseudo selectors but no combinators
    return matchesSimple(el, sel);
  }
  // Expose for animation engine (separate IIFE scope)
  globalThis.__dz_matchesSelector = matchesSelector;

  // Recursive tree walk fallback for complex selectors
  function findElementsRecursive(root, sel, results, firstOnly) {
    var children = root.childNodes || root.children || [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (matchesSelector(child, sel)) {
        results.push(child);
        if (firstOnly) return;
      }
      findElementsRecursive(child, sel, results, firstOnly);
      if (firstOnly && results.length > 0) return;
    }
  }

  var SIMPLE_TAG_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;
  var SIMPLE_CLASS_RE = /^\.[a-zA-Z_][a-zA-Z0-9_-]*$/;

  // Find elements matching a selector in a tree.
  // Uses indexes for simple tag/class selectors, falls back to recursive walk.
  function findElements(root, sel, results, firstOnly) {
    sel = sel.trim();
    // Fast path: plain tag selector (e.g. "div")
    if (SIMPLE_TAG_RE.test(sel)) {
      var tag = sel.toUpperCase();
      var candidates = elementsByTag[tag];
      if (candidates) {
        for (var i = 0; i < candidates.length; i++) {
          if (isDescendantOf(candidates[i], root)) {
            results.push(candidates[i]);
            if (firstOnly) return;
          }
        }
      }
      return;
    }
    // Fast path: plain class selector (e.g. ".foo")
    if (SIMPLE_CLASS_RE.test(sel)) {
      var cls = sel.substring(1);
      var candidates = elementsByClass[cls];
      if (candidates) {
        for (var i = 0; i < candidates.length; i++) {
          if (isDescendantOf(candidates[i], root)) {
            results.push(candidates[i]);
            if (firstOnly) return;
          }
        }
      }
      return;
    }
    // Fallback: recursive walk
    findElementsRecursive(root, sel, results, firstOnly);
  }

  // Minimal classList implementation
  function makeClassList(el) {
    var classes = [];
    // Update el.className and fire mutation if changed
    function sync() {
      var newName = classes.join(' ');
      if (newName !== el.className) {
        var old = el.className;
        el.className = newName;
        if (typeof __dz_notify_mutation === 'function')
          __dz_notify_mutation('attributes', el, [], [], 'class', old);
      }
    }
    return {
      add: function() {
        for (var i = 0; i < arguments.length; i++) {
          if (classes.indexOf(arguments[i]) === -1) classes.push(arguments[i]);
        }
        sync();
      },
      remove: function() {
        for (var i = 0; i < arguments.length; i++) {
          var idx = classes.indexOf(arguments[i]);
          if (idx !== -1) classes.splice(idx, 1);
        }
        sync();
      },
      toggle: function(c, force) {
        var has = classes.indexOf(c) !== -1;
        if (force === true || (!has && force !== false)) { this.add(c); return true; }
        if (force === false || has) { this.remove(c); return false; }
        return false;
      },
      contains: function(c) { return classes.indexOf(c) !== -1; },
      replace: function(old, nw) {
        var idx = classes.indexOf(old);
        if (idx === -1) return false;
        classes[idx] = nw;
        sync();
        return true;
      },
      _classes: classes, // Exposed for DOM serialization (__dz_serialize_dom)
      get length() { return classes.length; },
      item: function(i) { return classes[i] || null; },
      toString: function() { return classes.join(' '); },
      forEach: function(cb) { classes.forEach(cb); },
    };
  }

  // Event target mixin — adds functional addEventListener/removeEventListener/dispatchEvent
  function makeEventTarget(el) {
    el._listeners = {};
    el.addEventListener = function(type, fn, opts) {
      if (!el._listeners[type]) el._listeners[type] = [];
      if (el._listeners[type].length >= 500) return; // MAX_EVENT_LISTENERS_PER_TYPE
      el._listeners[type].push({ fn: fn, opts: opts });
    };
    el.removeEventListener = function(type, fn) {
      if (!el._listeners[type]) return;
      el._listeners[type] = el._listeners[type].filter(function(l) { return l.fn !== fn; });
    };
    el.dispatchEvent = function(event) {
      event.target = el;
      event.currentTarget = el;
      var handlers = el._listeners[event.type];
      if (!handlers) return true;
      for (var i = 0; i < handlers.length; i++) {
        if (event._stopImmediate) break;
        try { handlers[i].fn.call(el, event); } catch(e) { console.error('Event handler error:', e); }
        if (handlers[i].opts && handlers[i].opts.once) {
          handlers.splice(i, 1); i--;
        }
      }
      return !event.defaultPrevented;
    };
  }

  // Update firstChild/lastChild/nextSibling/previousSibling from childNodes array
  function updateChildLinks(el) {
    var nodes = el.childNodes;
    el.firstChild = nodes.length > 0 ? nodes[0] : null;
    el.lastChild = nodes.length > 0 ? nodes[nodes.length - 1] : null;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i]) {
        nodes[i].previousSibling = i > 0 ? nodes[i - 1] : null;
        nodes[i].nextSibling = i < nodes.length - 1 ? nodes[i + 1] : null;
      }
    }
  }

  // dataset Proxy for data-* attributes
  function makeDataset(el) {
    return new Proxy({}, {
      get: function(target, prop) {
        if (typeof prop !== 'string') return undefined;
        var attr = 'data-' + prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        return el.getAttribute ? el.getAttribute(attr) : null;
      },
      set: function(target, prop, value) {
        var attr = 'data-' + prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (el.setAttribute) el.setAttribute(attr, value);
        return true;
      },
      deleteProperty: function(target, prop) {
        var attr = 'data-' + prop.replace(/([A-Z])/g, '-$1').toLowerCase();
        if (el.removeAttribute) el.removeAttribute(attr);
        return true;
      }
    });
  }

  // Simple HTML fragment parser — creates child elements from HTML string
  // Handles: <tag attr="val">content</tag>, text nodes, self-closing tags
  // Not a full parser — covers the common patterns content authors use
  function parseHTMLInto(parent, html) {
    var pos = 0;
    var len = html.length;
    while (pos < len) {
      var ltIdx = html.indexOf('<', pos);
      // Text before next tag (or remaining text)
      if (ltIdx === -1) {
        var text = html.substring(pos);
        if (text.trim()) {
          var tn = { nodeType: 3, nodeName: '#text', textContent: text, nodeValue: text, parentNode: parent, parentElement: parent, nextSibling: null, previousSibling: null, ownerDocument: window.document };
          parent.childNodes.push(tn);
        }
        break;
      }
      if (ltIdx > pos) {
        var text = html.substring(pos, ltIdx);
        if (text.trim()) {
          var tn = { nodeType: 3, nodeName: '#text', textContent: text, nodeValue: text, parentNode: parent, parentElement: parent, nextSibling: null, previousSibling: null, ownerDocument: window.document };
          parent.childNodes.push(tn);
        }
      }
      // Comment
      if (html.substring(ltIdx, ltIdx + 4) === '<!--') {
        var endComment = html.indexOf('-->', ltIdx + 4);
        pos = endComment === -1 ? len : endComment + 3;
        continue;
      }
      // Closing tag
      if (html.charAt(ltIdx + 1) === '/') {
        var gtIdx = html.indexOf('>', ltIdx);
        pos = gtIdx === -1 ? len : gtIdx + 1;
        continue;
      }
      // Opening tag
      var gtIdx = html.indexOf('>', ltIdx);
      if (gtIdx === -1) { pos = len; break; }
      var tagStr = html.substring(ltIdx + 1, gtIdx);
      var selfClosing = tagStr.charAt(tagStr.length - 1) === '/';
      if (selfClosing) tagStr = tagStr.substring(0, tagStr.length - 1).trim();
      // Parse tag name and attributes
      var spIdx = tagStr.indexOf(' ');
      var tagName = spIdx === -1 ? tagStr.trim() : tagStr.substring(0, spIdx).trim();
      var attrStr = spIdx === -1 ? '' : tagStr.substring(spIdx + 1).trim();
      if (!tagName) { pos = gtIdx + 1; continue; }
      var child = createGenericElement(tagName);
      child.parentNode = parent;
      child.parentElement = parent;
      // Parse attributes
      if (attrStr) {
        var attrRe = /([a-zA-Z_:][a-zA-Z0-9_:.\-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
        var m;
        while ((m = attrRe.exec(attrStr)) !== null) {
          var aName = m[1];
          var aVal = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : '';
          child._attrs[aName] = aVal;
          if (aName === 'id') { child._id = aVal; elementsById[aVal] = child; }
          if (aName === 'class') child.className = aVal;
        }
      }
      parent.childNodes.push(child);
      parent.children.push(child);
      var voidTags = {br:1,hr:1,img:1,input:1,meta:1,link:1,area:1,base:1,col:1,embed:1,source:1,track:1,wbr:1};
      if (!selfClosing && !voidTags[tagName.toLowerCase()]) {
        // Find matching close tag (simple: does not handle nested same-name tags deeply)
        var closeTag = '</' + tagName;
        var closeIdx = html.toLowerCase().indexOf(closeTag.toLowerCase(), gtIdx + 1);
        if (closeIdx !== -1) {
          var innerHTML = html.substring(gtIdx + 1, closeIdx);
          if (innerHTML.trim()) {
            if (innerHTML.indexOf('<') !== -1) {
              parseHTMLInto(child, innerHTML);
            } else {
              child._textContent = innerHTML;
              var tn = { nodeType: 3, nodeName: '#text', textContent: innerHTML, nodeValue: innerHTML, parentNode: child, parentElement: child, nextSibling: null, previousSibling: null, ownerDocument: window.document };
              child.childNodes.push(tn);
              child.firstChild = tn;
              child.lastChild = tn;
            }
          }
          var afterClose = html.indexOf('>', closeIdx);
          pos = afterClose === -1 ? len : afterClose + 1;
        } else {
          pos = gtIdx + 1;
        }
      } else {
        pos = gtIdx + 1;
      }
    }
  }

  function createGenericElement(tag) {
    var nodeId = __dz_next_node_id++;
    var el = {
      _dz_id: nodeId,
      tagName: tag.toUpperCase(),
      nodeName: tag.toUpperCase(),
      nodeType: 1,
      style: null, // replaced with reactive proxy below
      className: '',
      _id: null,
      _attrs: {},
      parentNode: null,
      parentElement: null,
      sheet: { insertRule: function() {} },
      appendChild: function(child) {
        if (child && child.parentNode) child.parentNode.removeChild(child);
        el.children.push(child);
        el.childNodes.push(child);
        if (child) { child.parentNode = el; child.parentElement = el; }
        // Signal structural change — Rust falls back to full re-render
        globalThis.__dz_dom_cmds.push([2, el._dz_id || 0]);
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('childList', el, [child], [], null, null);
        updateChildLinks(el);
        return child;
      },
      removeChild: function(child) {
        var idx = el.children.indexOf(child);
        if (idx !== -1) el.children.splice(idx, 1);
        idx = el.childNodes.indexOf(child);
        if (idx !== -1) el.childNodes.splice(idx, 1);
        if (child) { child.parentNode = null; child.parentElement = null; child.nextSibling = null; child.previousSibling = null; }
        globalThis.__dz_dom_cmds.push([2, el._dz_id || 0]);
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('childList', el, [], [child], null, null);
        updateChildLinks(el);
        return child;
      },
      insertBefore: function(newChild, refChild) {
        if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
        var idx = el.childNodes.indexOf(refChild);
        if (idx === -1) {
          el.childNodes.push(newChild);
          el.children.push(newChild);
        } else {
          el.childNodes.splice(idx, 0, newChild);
          el.children.splice(idx, 0, newChild);
        }
        newChild.parentNode = el;
        newChild.parentElement = el;
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('childList', el, [newChild], [], null, null);
        updateChildLinks(el);
        return newChild;
      },
      replaceChild: function(newChild, oldChild) {
        var idx = el.childNodes.indexOf(oldChild);
        if (idx !== -1) {
          el.childNodes[idx] = newChild;
          el.children[idx] = newChild;
          newChild.parentNode = el;
          newChild.parentElement = el;
          oldChild.parentNode = null;
          oldChild.parentElement = null;
          oldChild.nextSibling = null;
          oldChild.previousSibling = null;
        }
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('childList', el, [newChild], [oldChild], null, null);
        updateChildLinks(el);
        return oldChild;
      },
      contains: function(other) {
        if (other === el) return true;
        for (var i = 0; i < el.childNodes.length; i++) {
          if (el.childNodes[i] === other) return true;
          if (el.childNodes[i].contains && el.childNodes[i].contains(other)) return true;
        }
        return false;
      },
      cloneNode: function(deep) {
        var clone = createGenericElement(tag);
        clone.className = el.className;
        clone.textContent = el.textContent;
        clone.innerHTML = el.innerHTML;
        for (var k in el._attrs) clone._attrs[k] = el._attrs[k];
        return clone;
      },
      setAttribute: function(name, value) {
        var oldVal = el._attrs[name];
        el._attrs[name] = String(value);
        if (name === 'id') { el._id = value; elementsById[value] = el; }
        if (name === 'class') el.className = value;
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('attributes', el, [], [], name, oldVal || null);
      },
      getAttribute: function(name) {
        if (name === 'id') return el._id;
        if (name === 'class') return el.className;
        return el._attrs[name] !== undefined ? el._attrs[name] : null;
      },
      hasAttribute: function(name) {
        return el._attrs[name] !== undefined || (name === 'id' && el._id !== null);
      },
      removeAttribute: function(name) {
        var oldVal = el._attrs[name];
        delete el._attrs[name];
        if (name === 'id') { delete elementsById[el._id]; el._id = null; }
        if (typeof __dz_notify_mutation === 'function') __dz_notify_mutation('attributes', el, [], [], name, oldVal || null);
      },
      closest: function() { return null; },
      matches: function() { return false; },
      children: [],
      childNodes: [],
      firstChild: null,
      lastChild: null,
      nextSibling: null,
      previousSibling: null,
      _textContent: '',
      _innerHTML: '',
      outerHTML: '',
      nodeValue: null,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      offsetWidth: 0,
      offsetHeight: 0,
      offsetTop: 0,
      offsetLeft: 0,
      offsetParent: null,
      scrollWidth: 0,
      scrollHeight: 0,
      scrollTop: 0,
      scrollLeft: 0,
      clientWidth: 0,
      clientHeight: 0,
      clientTop: 0,
      clientLeft: 0,
      querySelectorAll: function() { return []; },
      querySelector: function() { return null; },
      getElementsByTagName: function() { return []; },
      getElementsByClassName: function() { return []; },
      getBoundingClientRect: function() {
        var r = globalThis.__dz_layout_rects && globalThis.__dz_layout_rects[el._dz_id];
        if (r) return { x: r[0], y: r[1], width: r[2], height: r[3], top: r[1], left: r[0], bottom: r[1] + r[3], right: r[0] + r[2] };
        return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 };
      },
      focus: function() {},
      blur: function() {},
      remove: function() {
        if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el);
      },
    };
    makeEventTarget(el);
    el.classList = makeClassList(el);
    el.style = makeReactiveStyle(el);
    el.dataset = makeDataset(el);
    el.ownerDocument = window.document;
    // textContent setter: clears children, sets text
    Object.defineProperty(el, 'textContent', {
      get: function() {
        if (el.childNodes.length === 0) return el._textContent;
        var text = '';
        for (var i = 0; i < el.childNodes.length; i++) {
          var c = el.childNodes[i];
          if (c.nodeType === 3) text += c.nodeValue || c.textContent || '';
          else if (c.textContent !== undefined) text += c.textContent;
        }
        return text || el._textContent;
      },
      set: function(v) {
        // Clear all children (React uses textContent = '' to clear)
        while (el.childNodes.length > 0) {
          var child = el.childNodes[el.childNodes.length - 1];
          if (child) { child.parentNode = null; child.parentElement = null; child.nextSibling = null; child.previousSibling = null; }
          el.childNodes.pop();
        }
        el.children.length = 0;
        el.firstChild = null;
        el.lastChild = null;
        el._textContent = v != null ? String(v) : '';
        if (el._textContent !== '') {
          var tn = { nodeType: 3, nodeName: '#text', textContent: el._textContent, nodeValue: el._textContent, parentNode: el, parentElement: el, nextSibling: null, previousSibling: null, ownerDocument: window.document };
          el.childNodes.push(tn);
          el.firstChild = tn;
          el.lastChild = tn;
        }
        globalThis.__dz_html_dirty = true;
      }
    });
    // innerHTML setter: parse simple HTML fragments
    Object.defineProperty(el, 'innerHTML', {
      get: function() { return el._innerHTML; },
      set: function(v) {
        globalThis.__dz_html_dirty = true;
        // Clear children
        while (el.childNodes.length > 0) {
          var child = el.childNodes[el.childNodes.length - 1];
          if (child) { child.parentNode = null; child.parentElement = null; }
          el.childNodes.pop();
        }
        el.children.length = 0;
        el.firstChild = null;
        el.lastChild = null;
        el._innerHTML = v != null ? String(v) : '';
        el._textContent = '';
        if (el._innerHTML !== '') {
          // Simple HTML parser: creates child elements for basic tags
          parseHTMLInto(el, el._innerHTML);
          updateChildLinks(el);
        }
      }
    });
    el.matches = function(sel) { return matchesSelector(el, sel); };
    el.closest = function(sel) {
      var cur = el;
      while (cur) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentNode;
      }
      return null;
    };
    el.querySelector = function(sel) {
      var parts = sel.indexOf(',') !== -1 ? sel.split(',') : null;
      if (parts) {
        for (var pi = 0; pi < parts.length; pi++) {
          var results = [];
          findElements(el, parts[pi].trim(), results, true);
          if (results.length > 0) return results[0];
        }
        return null;
      }
      var results = [];
      findElements(el, sel, results, true);
      return results[0] || null;
    };
    el.querySelectorAll = function(sel) {
      var parts = sel.indexOf(',') !== -1 ? sel.split(',') : null;
      if (parts) {
        var all = [], seen = [];
        for (var pi = 0; pi < parts.length; pi++) {
          var results = [];
          findElements(el, parts[pi].trim(), results, false);
          for (var ri = 0; ri < results.length; ri++) {
            if (seen.indexOf(results[ri]) === -1) { seen.push(results[ri]); all.push(results[ri]); }
          }
        }
        return all;
      }
      var results = [];
      findElements(el, sel, results, false);
      return results;
    };
    el.getElementsByTagName = function(tag) {
      var results = [];
      findElements(el, tag, results, false);
      return results;
    };
    el.getElementsByClassName = function(cls) {
      var results = [];
      findElements(el, '.' + cls, results, false);
      return results;
    };
    Object.defineProperty(el, 'id', {
      get: function() { return el._id || ''; },
      set: function(v) { el._id = v; elementsById[v] = el; },
    });
    // Convert className to getter/setter for class index tracking
    el._className = '';
    Object.defineProperty(el, 'className', {
      get: function() { return el._className; },
      set: function(v) {
        var old = el._className;
        el._className = v;
        updateClassIndex(el, old, v);
      },
    });
    // Register in tag index
    indexByTag(el);
    return el;
  }

  const body = createGenericElement('body');
  const head = createGenericElement('head');

  window.document = {
    body: body,
    documentElement: body,
    head: head,
    readyState: 'complete',
    title: '',
    cookie: '',
    hidden: false,
    visibilityState: 'visible',
    defaultView: window,
    characterSet: 'UTF-8',
    charset: 'UTF-8',
    contentType: 'text/html',
    compatMode: 'CSS1Compat',
    doctype: { name: 'html', publicId: '', systemId: '' },
    nodeType: 9,
    nodeName: '#document',

    createElement: function(tag) {
      if (tag === 'canvas') return createCanvas();
      return createGenericElement(tag);
    },

    createElementNS: function(ns, tag) {
      return this.createElement(tag);
    },

    getElementById: function(id) {
      return elementsById[id] || null;
    },

    querySelector: function(sel) {
      // Fast path: #id lookup
      if (sel.charAt(0) === '#' && sel.indexOf(' ') === -1) return elementsById[sel.substring(1)] || null;
      // Canvas selector
      if (sel === 'canvas' && canvases.length > 0) return canvases[0];
      // Comma-separated selectors
      var parts = sel.indexOf(',') !== -1 ? sel.split(',') : null;
      if (parts) {
        for (var pi = 0; pi < parts.length; pi++) {
          var sub = parts[pi].trim();
          for (var ci = 0; ci < canvases.length; ci++) {
            if (matchesSelector(canvases[ci], sub)) return canvases[ci];
          }
          var results = [];
          findElements(body, sub, results, true);
          if (results.length > 0) return results[0];
        }
        return null;
      }
      // Check canvases for matching selectors
      for (var i = 0; i < canvases.length; i++) {
        if (matchesSelector(canvases[i], sel)) return canvases[i];
      }
      // Search body tree
      var results = [];
      findElements(body, sel, results, true);
      return results[0] || null;
    },

    querySelectorAll: function(sel) {
      if (sel === 'canvas') return canvases.slice();
      // Comma-separated selectors
      var parts = sel.indexOf(',') !== -1 ? sel.split(',') : null;
      if (parts) {
        var all = [], seen = [];
        for (var pi = 0; pi < parts.length; pi++) {
          var sub = parts[pi].trim();
          for (var ci = 0; ci < canvases.length; ci++) {
            if (matchesSelector(canvases[ci], sub) && seen.indexOf(canvases[ci]) === -1) { seen.push(canvases[ci]); all.push(canvases[ci]); }
          }
          var subResults = [];
          findElements(body, sub, subResults, false);
          for (var ri = 0; ri < subResults.length; ri++) {
            if (seen.indexOf(subResults[ri]) === -1) { seen.push(subResults[ri]); all.push(subResults[ri]); }
          }
        }
        return all;
      }
      // Check canvases
      var results = [];
      for (var i = 0; i < canvases.length; i++) {
        if (matchesSelector(canvases[i], sel)) results.push(canvases[i]);
      }
      // Search body tree
      findElements(body, sel, results, false);
      return results;
    },

    getElementsByTagName: function(tag) {
      var results = [];
      if (tag.toLowerCase() === 'canvas') return canvases.slice();
      for (var i = 0; i < canvases.length; i++) {
        if (canvases[i].tagName === tag.toUpperCase()) results.push(canvases[i]);
      }
      findElements(body, tag, results, false);
      return results;
    },

    getElementsByClassName: function(cls) {
      var results = [];
      findElements(body, '.' + cls, results, false);
      return results;
    },

    createTextNode: function(text) {
      var tn = {
        nodeName: '#text', nodeType: 3, parentNode: null, parentElement: null,
        nextSibling: null, previousSibling: null,
        ownerDocument: window.document,
        get textContent() { return tn.nodeValue; },
        set textContent(v) { tn.nodeValue = v != null ? String(v) : ''; },
        get data() { return tn.nodeValue; },
        set data(v) { tn.nodeValue = v != null ? String(v) : ''; },
        nodeValue: text != null ? String(text) : '',
        get length() { return (tn.nodeValue || '').length; },
        appendData: function(s) { tn.nodeValue += s; },
        deleteData: function(offset, count) { tn.nodeValue = tn.nodeValue.substring(0, offset) + tn.nodeValue.substring(offset + count); },
        insertData: function(offset, s) { tn.nodeValue = tn.nodeValue.substring(0, offset) + s + tn.nodeValue.substring(offset); },
        replaceData: function(offset, count, s) { tn.nodeValue = tn.nodeValue.substring(0, offset) + s + tn.nodeValue.substring(offset + count); },
        substringData: function(offset, count) { return tn.nodeValue.substring(offset, offset + count); },
        cloneNode: function() { return window.document.createTextNode(tn.nodeValue); },
      };
      return tn;
    },

    createDocumentFragment: function() {
      var frag = {
        nodeType: 11,
        nodeName: '#document-fragment',
        childNodes: [],
        children: [],
        appendChild: function(child) { frag.childNodes.push(child); frag.children.push(child); return child; },
        removeChild: function(child) {
          var idx = frag.childNodes.indexOf(child);
          if (idx !== -1) frag.childNodes.splice(idx, 1);
          idx = frag.children.indexOf(child);
          if (idx !== -1) frag.children.splice(idx, 1);
          return child;
        },
        insertBefore: function(newChild, refChild) {
          var idx = frag.childNodes.indexOf(refChild);
          if (idx === -1) frag.childNodes.push(newChild);
          else frag.childNodes.splice(idx, 0, newChild);
          return newChild;
        },
        querySelector: function() { return null; },
        querySelectorAll: function() { return []; },
        textContent: '',
      };
      return frag;
    },

    createComment: function(text) {
      return { nodeType: 8, nodeName: '#comment', textContent: text, parentNode: null };
    },

    addEventListener: function(type, fn) {
      // DOMContentLoaded fires immediately since we have no DOM loading
      if (type === 'DOMContentLoaded' || type === 'readystatechange') {
        try { fn(); } catch(e) { console.error('DOMContentLoaded handler error:', e); }
        return;
      }
      window.addEventListener(type, fn);
    },

    removeEventListener: function(type, fn) {
      window.removeEventListener(type, fn);
    },

    createEvent: function(type) {
      var evt = new Event('');
      evt.initEvent = function(t, bubbles, cancelable) {
        evt.type = t;
        evt.bubbles = !!bubbles;
        evt.cancelable = !!cancelable;
      };
      return evt;
    },

    elementFromPoint: function() { return null; },
    elementsFromPoint: function() { return []; },
    getSelection: function() {
      return { anchorNode: null, focusNode: null, isCollapsed: true, rangeCount: 0,
        toString: function() { return ''; }, getRangeAt: function() { return null; },
        addRange: function() {}, removeAllRanges: function() {}, collapse: function() {} };
    },

    createTreeWalker: function(root, whatToShow, filter) {
      var current = root;
      var walker = {
        root: root,
        currentNode: current,
        whatToShow: whatToShow || 0xFFFFFFFF,
        filter: filter || null,
        nextNode: function() {
          // Depth-first traversal
          if (current.firstChild) { current = current.firstChild; walker.currentNode = current; return current; }
          while (current) {
            if (current.nextSibling) { current = current.nextSibling; walker.currentNode = current; return current; }
            current = current.parentNode;
            if (current === root) return null;
          }
          return null;
        },
        previousNode: function() {
          if (current === root) return null;
          if (current.previousSibling) {
            current = current.previousSibling;
            while (current.lastChild) current = current.lastChild;
            walker.currentNode = current;
            return current;
          }
          current = current.parentNode;
          if (current === root) return null;
          walker.currentNode = current;
          return current;
        },
        firstChild: function() {
          if (current.firstChild) { current = current.firstChild; walker.currentNode = current; return current; }
          return null;
        },
        lastChild: function() {
          if (current.lastChild) { current = current.lastChild; walker.currentNode = current; return current; }
          return null;
        },
        nextSibling: function() {
          if (current.nextSibling) { current = current.nextSibling; walker.currentNode = current; return current; }
          return null;
        },
        previousSibling: function() {
          if (current.previousSibling) { current = current.previousSibling; walker.currentNode = current; return current; }
          return null;
        },
        parentNode: function() {
          if (current.parentNode && current.parentNode !== root) { current = current.parentNode; walker.currentNode = current; return current; }
          return null;
        },
      };
      return walker;
    },

    createRange: function() {
      return {
        setStart: function() {}, setEnd: function() {},
        setStartBefore: function() {}, setEndAfter: function() {},
        collapse: function() {}, selectNode: function() {},
        selectNodeContents: function() {},
        cloneContents: function() { return document.createDocumentFragment(); },
        deleteContents: function() {},
        extractContents: function() { return document.createDocumentFragment(); },
        insertNode: function() {},
        surroundContents: function() {},
        getBoundingClientRect: function() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 }; },
        getClientRects: function() { return []; },
        cloneRange: function() { return window.document.createRange(); },
        toString: function() { return ''; },
        commonAncestorContainer: body,
        startContainer: body, endContainer: body,
        startOffset: 0, endOffset: 0, collapsed: true,
      };
    },

    fonts: {
      ready: Promise.resolve(),
      add: function() {},
      check: function() { return true; },
      load: function() { return Promise.resolve([]); },
    },
  };

  __dz_reset_hooks.push(function() {
    canvases.length = 0;
    for (var k in elementsById) delete elementsById[k];
  });
})();

// --- Image loading ---
// Images are loaded asynchronously: JS sets img.src → Rust loads from disk next frame → onload fires.
(function() {
  var nextImageId = 1;
  globalThis.__dz_image_loads = [];    // [[id, src], ...] — pending load requests
  globalThis.__dz_image_registry = {}; // id → { img: DzImage }

  // Called by Rust after loading images, before user JS runs.
  // readyList = [[id, width, height], ...]
  globalThis.__dz_fire_image_loads = function(readyList) {
    for (var i = 0; i < readyList.length; i++) {
      var id = readyList[i][0];
      var w = readyList[i][1];
      var h = readyList[i][2];
      var entry = __dz_image_registry[id];
      if (entry) {
        entry.img.width = w;
        entry.img.height = h;
        entry.img.naturalWidth = w;
        entry.img.naturalHeight = h;
        entry.img.complete = true;
        if (typeof entry.img.onload === 'function') {
          try { entry.img.onload(); } catch(e) { console.error('Image onload error:', e); }
        }
      }
    }
  };

  // Called by Rust for load failures.
  globalThis.__dz_fire_image_errors = function(errorList) {
    for (var i = 0; i < errorList.length; i++) {
      var id = errorList[i];
      var entry = __dz_image_registry[id];
      if (entry && typeof entry.img.onerror === 'function') {
        try { entry.img.onerror(new Error('Image load failed')); } catch(e) { console.error('Image onerror error:', e); }
      }
    }
  };

  function DzImage(w, h) {
    this._id = nextImageId++;
    this.width = w || 0;
    this.height = h || 0;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.complete = false;
    this.onload = null;
    this.onerror = null;
    this._src = '';
    __dz_image_registry[this._id] = { img: this };
  }

  Object.defineProperty(DzImage.prototype, 'src', {
    get: function() { return this._src; },
    set: function(v) {
      this._src = v;
      this.complete = false;
      __dz_image_loads.push([this._id, v]);
    }
  });

  DzImage.prototype.addEventListener = function(type, fn) {
    if (type === 'load') this.onload = fn;
    else if (type === 'error') this.onerror = fn;
  };
  DzImage.prototype.removeEventListener = function() {};

  globalThis.Image = DzImage;

  __dz_reset_hooks.push(function() {
    nextImageId = 1;
    var reg = globalThis.__dz_image_registry;
    for (var k in reg) delete reg[k];
  });
})();

// --- FPS tracking (sidecar reads this via Runtime.evaluate) ---
window.__dzFPS = { current: 0 };

// --- TextEncoder / TextDecoder (V8 doesn't provide these) ---
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = function TextEncoder() {};
  TextEncoder.prototype.encode = function(str) {
    const buf = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.codePointAt(i);
      if (c < 0x80) {
        buf.push(c);
      } else if (c < 0x800) {
        buf.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0x10000) {
        buf.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        buf.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
        i++; // skip surrogate pair low half
      }
    }
    return new Uint8Array(buf);
  };
}

if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = function TextDecoder() {};
  TextDecoder.prototype.decode = function(buf) {
    if (!buf) return '';
    const bytes = new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < bytes.length;) {
      const b = bytes[i];
      if (b < 0x80) {
        str += String.fromCharCode(b);
        i++;
      } else if (b < 0xe0) {
        if (i + 1 >= bytes.length) break; // truncated
        str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i+1] & 0x3f));
        i += 2;
      } else if (b < 0xf0) {
        if (i + 2 >= bytes.length) break; // truncated
        str += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i+1] & 0x3f) << 6) | (bytes[i+2] & 0x3f));
        i += 3;
      } else {
        if (i + 3 >= bytes.length) break; // truncated
        var cp = ((b & 0x07) << 18) | ((bytes[i+1] & 0x3f) << 12) | ((bytes[i+2] & 0x3f) << 6) | (bytes[i+3] & 0x3f);
        str += String.fromCodePoint(cp);
        i += 4;
      }
    }
    return str;
  };
}

// --- getComputedStyle ---
window.getComputedStyle = function(el, pseudoElt) {
  // CSS defaults for common properties
  var defaults = {
    display: 'block', position: 'static', visibility: 'visible',
    overflow: 'visible', opacity: '1', zIndex: 'auto',
    boxSizing: 'content-box', float: 'none', clear: 'none',
    margin: '0px', marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
    padding: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px',
    border: '0px none rgb(0, 0, 0)',
    borderWidth: '0px', borderStyle: 'none', borderColor: 'rgb(0, 0, 0)',
    borderTop: '0px none rgb(0, 0, 0)', borderRight: '0px none rgb(0, 0, 0)',
    borderBottom: '0px none rgb(0, 0, 0)', borderLeft: '0px none rgb(0, 0, 0)',
    fontSize: '16px', fontFamily: 'sans-serif', fontWeight: '400', fontStyle: 'normal',
    lineHeight: 'normal', textAlign: 'start', textDecoration: 'none',
    color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)',
    transform: 'none', transition: 'all 0s ease 0s',
    cursor: 'auto', pointerEvents: 'auto', userSelect: 'auto',
  };
  var style = el && el.style ? el.style : {};
  // Compute width/height from getBoundingClientRect when not explicitly set
  var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;

  var computed = {
    getPropertyValue: function(prop) {
      // Convert kebab-case to camelCase
      var camel = prop.replace(/-([a-z])/g, function(m, c) { return c.toUpperCase(); });
      return this[camel] || '';
    },
    setProperty: function() {},
    removeProperty: function() {},
    get length() { return Object.keys(defaults).length; },
  };

  // Populate from defaults, then override with inline style
  for (var k in defaults) computed[k] = defaults[k];
  for (var k in style) {
    if (typeof style[k] === 'string' && style[k] !== '') computed[k] = style[k];
  }

  // Width/height from bounding rect if not set inline
  if (rect) {
    if (!style.width) computed.width = rect.width + 'px';
    if (!style.height) computed.height = rect.height + 'px';
  } else {
    if (!style.width) computed.width = 'auto';
    if (!style.height) computed.height = 'auto';
  }

  return computed;
};

// --- matchMedia ---
window.matchMedia = function(query) {
  // Evaluate common media queries against known viewport (1280x720)
  var matches = false;
  var q = query.toLowerCase().replace(/\s+/g, ' ').trim();

  // prefers-color-scheme
  if (q.indexOf('prefers-color-scheme: light') !== -1) matches = true;
  else if (q.indexOf('prefers-color-scheme: dark') !== -1) matches = false;
  // prefers-reduced-motion
  else if (q.indexOf('prefers-reduced-motion: no-preference') !== -1) matches = true;
  else if (q.indexOf('prefers-reduced-motion: reduce') !== -1) matches = false;
  // min-width / max-width / min-height / max-height
  else {
    var minW = q.match(/\(min-width:\s*(\d+)px\)/);
    var maxW = q.match(/\(max-width:\s*(\d+)px\)/);
    var minH = q.match(/\(min-height:\s*(\d+)px\)/);
    var maxH = q.match(/\(max-height:\s*(\d+)px\)/);
    if (minW) matches = window.innerWidth >= parseInt(minW[1]);
    else if (maxW) matches = window.innerWidth <= parseInt(maxW[1]);
    else if (minH) matches = window.innerHeight >= parseInt(minH[1]);
    else if (maxH) matches = window.innerHeight <= parseInt(maxH[1]);
    // screen / all
    else if (q === 'screen' || q === 'all' || q === '(display-mode: browser)') matches = true;
    // orientation
    else if (q.indexOf('orientation: landscape') !== -1) matches = window.innerWidth > window.innerHeight;
    else if (q.indexOf('orientation: portrait') !== -1) matches = window.innerHeight > window.innerWidth;
  }

  var listeners = [];
  return {
    matches: matches,
    media: query,
    onchange: null,
    addEventListener: function(type, fn) { if (type === 'change') listeners.push(fn); },
    removeEventListener: function(type, fn) { listeners = listeners.filter(function(l) { return l !== fn; }); },
    addListener: function(fn) { listeners.push(fn); },
    removeListener: function(fn) { listeners = listeners.filter(function(l) { return l !== fn; }); },
  };
};

// --- URL / URLSearchParams ---
if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = function URLSearchParams(init) {
    this._params = {};
    if (typeof init === 'string') {
      var s = init.charAt(0) === '?' ? init.substring(1) : init;
      var pairs = s.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var kv = pairs[i].split('=');
        if (kv[0]) this._params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      }
    }
  };
  URLSearchParams.prototype.get = function(k) { return this._params[k] !== undefined ? this._params[k] : null; };
  URLSearchParams.prototype.set = function(k, v) { this._params[k] = String(v); };
  URLSearchParams.prototype.has = function(k) { return k in this._params; };
  URLSearchParams.prototype.delete = function(k) { delete this._params[k]; };
  URLSearchParams.prototype.toString = function() {
    var parts = [];
    for (var k in this._params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(this._params[k]));
    return parts.join('&');
  };
  URLSearchParams.prototype.forEach = function(cb) {
    for (var k in this._params) cb(this._params[k], k, this);
  };
  URLSearchParams.prototype.entries = function() {
    var arr = [];
    for (var k in this._params) arr.push([k, this._params[k]]);
    return arr[Symbol.iterator]();
  };
  URLSearchParams.prototype.keys = function() {
    var arr = [];
    for (var k in this._params) arr.push(k);
    return arr[Symbol.iterator]();
  };
  URLSearchParams.prototype.values = function() {
    var arr = [];
    for (var k in this._params) arr.push(this._params[k]);
    return arr[Symbol.iterator]();
  };
}

if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = function URL(url, base) {
    // Minimal URL parser
    var full = url;
    if (base && url.indexOf('://') === -1) {
      full = base.replace(/\/$/, '') + '/' + url.replace(/^\//, '');
    }
    var match = full.match(/^(https?:)\/\/([^\/\?#]+)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/);
    if (match) {
      this.protocol = match[1];
      this.host = match[2];
      this.hostname = match[2].split(':')[0];
      this.port = match[2].split(':')[1] || '';
      this.pathname = match[3] || '/';
      this.search = match[4] || '';
      this.hash = match[5] || '';
    } else {
      this.protocol = '';
      this.host = '';
      this.hostname = '';
      this.port = '';
      this.pathname = full;
      this.search = '';
      this.hash = '';
    }
    this.href = full;
    this.origin = this.protocol + '//' + this.host;
    this.searchParams = new URLSearchParams(this.search);
  };
  URL.prototype.toString = function() { return this.href; };
  URL.createObjectURL = function() { return 'blob:null/stub'; };
  URL.revokeObjectURL = function() {};
}

// --- queueMicrotask ---
if (typeof globalThis.queueMicrotask === 'undefined') {
  globalThis.queueMicrotask = function(fn) {
    Promise.resolve().then(fn);
  };
}

// --- structuredClone ---
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = function(obj) {
    return JSON.parse(JSON.stringify(obj));
  };
}

// --- AbortController / AbortSignal ---
if (typeof globalThis.AbortController === 'undefined') {
  function AbortSignal() {
    this.aborted = false;
    this.reason = undefined;
    this._listeners = [];
  }
  AbortSignal.prototype.addEventListener = function(type, fn) {
    if (type === 'abort') this._listeners.push(fn);
  };
  AbortSignal.prototype.removeEventListener = function(type, fn) {
    if (type === 'abort') this._listeners = this._listeners.filter(function(l) { return l !== fn; });
  };
  AbortSignal.prototype.throwIfAborted = function() {
    if (this.aborted) throw this.reason;
  };
  AbortSignal.abort = function(reason) {
    var s = new AbortSignal();
    s.aborted = true;
    s.reason = reason || new DOMException('The operation was aborted.', 'AbortError');
    return s;
  };
  AbortSignal.timeout = function(ms) {
    var s = new AbortSignal();
    setTimeout(function() {
      s.aborted = true;
      s.reason = new DOMException('The operation timed out.', 'TimeoutError');
      for (var i = 0; i < s._listeners.length; i++) {
        try { s._listeners[i](); } catch(e) {}
      }
    }, ms);
    return s;
  };

  globalThis.AbortSignal = AbortSignal;

  globalThis.AbortController = function AbortController() {
    this.signal = new AbortSignal();
  };
  AbortController.prototype.abort = function(reason) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason || new DOMException('The operation was aborted.', 'AbortError');
    for (var i = 0; i < this.signal._listeners.length; i++) {
      try { this.signal._listeners[i](); } catch(e) {}
    }
  };
}

// --- DOMException (needed by AbortController) ---
if (typeof globalThis.DOMException === 'undefined') {
  globalThis.DOMException = function DOMException(message, name) {
    this.message = message || '';
    this.name = name || 'Error';
  };
  DOMException.prototype = Object.create(Error.prototype);
  DOMException.prototype.constructor = DOMException;
}

// --- localStorage ---
// In-memory implementation. Rust-side persistence (R2) hooks into
// __dz_localstorage_data to save/restore across restarts.
(function() {
  var store = {};
  var MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB
  var MAX_KEY_COUNT = 10000;
  var totalBytes = 0;
  var dirtyKeys = {};    // key → 1 (set/update), -1 (removed)
  var dirtyClear = false;

  function recalcBytes() {
    var t = 0;
    for (var k in store) {
      if (store.hasOwnProperty(k)) t += k.length + store[k].length;
    }
    totalBytes = t;
    return t;
  }

  // Rust can pre-populate this before user JS runs
  globalThis.__dz_localstorage_data = store;
  // Rust calls this to get changed keys and reset dirty state
  globalThis.__dz_localstorage_dirty_keys = function() {
    var result = { clear: dirtyClear, keys: dirtyKeys };
    dirtyKeys = {};
    dirtyClear = false;
    return result;
  };

  var ls = {
    getItem: function(key) { return store.hasOwnProperty(key) ? store[key] : null; },
    setItem: function(key, value) {
      var strVal = String(value);
      var strKey = String(key);
      // Calculate delta: new bytes minus old bytes (if key existed)
      var oldSize = store.hasOwnProperty(strKey) ? (strKey.length + store[strKey].length) : 0;
      var newSize = strKey.length + strVal.length;
      var newTotal = totalBytes - oldSize + newSize;
      if (newTotal > MAX_TOTAL_BYTES) {
        // Match browser behavior: throw DOMException QuotaExceededError
        throw new DOMException('localStorage quota exceeded (10 MB limit)', 'QuotaExceededError');
      }
      if (!store.hasOwnProperty(strKey) && Object.keys(store).length >= MAX_KEY_COUNT) {
        throw new DOMException('localStorage key count exceeded (10,000 limit)', 'QuotaExceededError');
      }
      store[strKey] = strVal;
      totalBytes = newTotal;
      dirtyKeys[strKey] = 1;
    },
    removeItem: function(key) {
      if (store.hasOwnProperty(key)) {
        totalBytes -= key.length + store[key].length;
        delete store[key];
        dirtyKeys[key] = -1;
      }
    },
    clear: function() {
      for (var k in store) delete store[k];
      totalBytes = 0;
      dirtyKeys = {};
      dirtyClear = true;
    },
    key: function(index) {
      var keys = Object.keys(store);
      return index < keys.length ? keys[index] : null;
    },
    get length() { return Object.keys(store).length; },
  };

  window.localStorage = ls;
  // sessionStorage is the same (no cross-tab in stage-runtime)
  window.sessionStorage = ls;
})();

// --- IndexedDB (in-memory shim backed by localStorage for persistence) ---
(function() {
  var __dz_idb_dbs = {}; // dbName → { version, stores: { storeName → { data: {key→value}, autoIncrement: n } } }
  var __dz_idb_restored = false;

  // Lazy restore: localStorage is populated by Rust AFTER polyfills.js runs,
  // so we defer the read until the first indexedDB.open() call.
  function ensureRestored() {
    if (__dz_idb_restored) return;
    __dz_idb_restored = true;
    try {
      var saved = window.localStorage.getItem('__dz_idb');
      if (saved) __dz_idb_dbs = JSON.parse(saved);
    } catch(e) {}
  }

  function persistIdb() {
    try { window.localStorage.setItem('__dz_idb', JSON.stringify(__dz_idb_dbs)); } catch(e) {}
  }

  function IDBRequest() {
    this.result = undefined;
    this.error = null;
    this.source = null;
    this.transaction = null;
    this.readyState = 'pending';
    this.onsuccess = null;
    this.onerror = null;
    this._listeners = {};
  }
  IDBRequest.prototype.addEventListener = function(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  };
  IDBRequest.prototype.removeEventListener = function(type, fn) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter(function(f) { return f !== fn; });
  };
  IDBRequest.prototype._fire = function(type) {
    var self = this;
    self.readyState = 'done';
    var evt = { type: type, target: self, currentTarget: self };
    var cb = self['on' + type];
    if (cb) cb.call(self, evt);
    if (self._listeners[type]) {
      self._listeners[type].forEach(function(fn) { fn.call(self, evt); });
    }
  };

  function IDBObjectStore(db, name, storeMeta, transaction) {
    this.name = name;
    this.keyPath = null;
    this.indexNames = [];
    this.transaction = transaction;
    this.autoIncrement = false;
    this._db = db;
    this._meta = storeMeta;
  }
  IDBObjectStore.prototype.put = function(value, key) {
    var req = new IDBRequest();
    var meta = this._meta;
    if (key === undefined) {
      key = meta.autoIncrement++;
    }
    var k = String(key);
    meta.data[k] = JSON.parse(JSON.stringify(value));
    req.result = key;
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.add = function(value, key) {
    var meta = this._meta;
    if (key !== undefined && meta.data.hasOwnProperty(String(key))) {
      var req = new IDBRequest();
      req.error = new DOMException('Key already exists', 'ConstraintError');
      queueMicrotask(function() { req._fire('error'); });
      return req;
    }
    return this.put(value, key);
  };
  IDBObjectStore.prototype.get = function(key) {
    var req = new IDBRequest();
    var meta = this._meta;
    req.result = meta.data.hasOwnProperty(String(key))
      ? JSON.parse(JSON.stringify(meta.data[String(key)]))
      : undefined;
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.getAll = function() {
    var req = new IDBRequest();
    var meta = this._meta;
    req.result = Object.keys(meta.data).map(function(k) {
      return JSON.parse(JSON.stringify(meta.data[k]));
    });
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.delete = function(key) {
    var req = new IDBRequest();
    delete this._meta.data[String(key)];
    req.result = undefined;
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.clear = function() {
    var req = new IDBRequest();
    this._meta.data = {};
    req.result = undefined;
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.count = function() {
    var req = new IDBRequest();
    req.result = Object.keys(this._meta.data).length;
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.openCursor = function() {
    var req = new IDBRequest();
    var keys = Object.keys(this._meta.data).sort();
    var meta = this._meta;
    var idx = 0;
    function makeCursor() {
      if (idx >= keys.length) return null;
      return {
        key: keys[idx],
        value: JSON.parse(JSON.stringify(meta.data[keys[idx]])),
        continue: function() {
          idx++;
          req.result = makeCursor();
          req._fire('success');
        },
        delete: function() {
          delete meta.data[keys[idx]];
          var r = new IDBRequest();
          r.result = undefined;
          queueMicrotask(function() { r._fire('success'); });
          return r;
        }
      };
    }
    req.result = makeCursor();
    queueMicrotask(function() { req._fire('success'); });
    return req;
  };
  IDBObjectStore.prototype.createIndex = function(name) { return { name: name }; };
  IDBObjectStore.prototype.index = function(name) { return this; };

  function IDBTransaction(db, storeNames, mode) {
    this.db = db;
    this.mode = mode || 'readonly';
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this._storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this._db = db;
    var self = this;
    queueMicrotask(function() {
      persistIdb();
      if (self.oncomplete) self.oncomplete({ type: 'complete', target: self });
    });
  }
  IDBTransaction.prototype.objectStore = function(name) {
    var dbMeta = __dz_idb_dbs[this._db.name];
    if (!dbMeta || !dbMeta.stores[name]) {
      throw new DOMException('Object store "' + name + '" not found', 'NotFoundError');
    }
    return new IDBObjectStore(this._db, name, dbMeta.stores[name], this);
  };
  IDBTransaction.prototype.abort = function() {
    if (this.onabort) this.onabort({ type: 'abort', target: this });
  };

  function IDBDatabase(name, version) {
    this.name = name;
    this.version = version;
    this.onversionchange = null;
    this.onclose = null;
    var meta = __dz_idb_dbs[name];
    this.objectStoreNames = meta ? Object.keys(meta.stores) : [];
  }
  IDBDatabase.prototype.transaction = function(storeNames, mode) {
    return new IDBTransaction(this, storeNames, mode);
  };
  IDBDatabase.prototype.createObjectStore = function(name, opts) {
    var dbMeta = __dz_idb_dbs[this.name];
    if (!dbMeta.stores[name]) {
      dbMeta.stores[name] = { data: {}, autoIncrement: 1 };
    }
    this.objectStoreNames = Object.keys(dbMeta.stores);
    return new IDBObjectStore(this, name, dbMeta.stores[name], null);
  };
  IDBDatabase.prototype.deleteObjectStore = function(name) {
    var dbMeta = __dz_idb_dbs[this.name];
    delete dbMeta.stores[name];
    this.objectStoreNames = Object.keys(dbMeta.stores);
  };
  IDBDatabase.prototype.close = function() {};

  function IDBOpenDBRequest(name, version) {
    IDBRequest.call(this);
    this.onupgradeneeded = null;
    this.onblocked = null;
    var self = this;
    var v = version || 1;

    queueMicrotask(function() {
      var isNew = !__dz_idb_dbs[name];
      var needsUpgrade = isNew || (__dz_idb_dbs[name].version < v);
      if (isNew) {
        __dz_idb_dbs[name] = { version: v, stores: {} };
      }
      var db = new IDBDatabase(name, v);
      self.result = db;

      if (needsUpgrade && self.onupgradeneeded) {
        __dz_idb_dbs[name].version = v;
        var tx = new IDBTransaction(db, [], 'versionchange');
        self.transaction = tx;
        self.onupgradeneeded.call(self, {
          type: 'upgradeneeded',
          target: self,
          oldVersion: isNew ? 0 : __dz_idb_dbs[name].version,
          newVersion: v
        });
      }
      persistIdb();
      self._fire('success');
    });
  }
  IDBOpenDBRequest.prototype = Object.create(IDBRequest.prototype);

  var IDBKeyRange = {
    only: function(v) { return { lower: v, upper: v, lowerOpen: false, upperOpen: false }; },
    lowerBound: function(v, open) { return { lower: v, upper: undefined, lowerOpen: !!open, upperOpen: true }; },
    upperBound: function(v, open) { return { lower: undefined, upper: v, lowerOpen: true, upperOpen: !!open }; },
    bound: function(l, u, lo, uo) { return { lower: l, upper: u, lowerOpen: !!lo, upperOpen: !!uo }; }
  };

  globalThis.indexedDB = {
    open: function(name, version) { ensureRestored(); return new IDBOpenDBRequest(name, version); },
    deleteDatabase: function(name) {
      ensureRestored();
      delete __dz_idb_dbs[name];
      persistIdb();
      var req = new IDBRequest();
      req.result = undefined;
      queueMicrotask(function() { req._fire('success'); });
      return req;
    },
    cmp: function(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  };
  globalThis.IDBKeyRange = IDBKeyRange;
})();

// --- console (V8 doesn't provide console by default) ---
if (typeof globalThis.console === 'undefined') {
  globalThis.console = {
    log: function() {},
    warn: function() {},
    error: function() {},
    info: function() {},
    debug: function() {},
    trace: function() {},
    dir: function() {},
    table: function() {},
    group: function() {},
    groupEnd: function() {},
    groupCollapsed: function() {},
    time: function() {},
    timeEnd: function() {},
    timeLog: function() {},
    count: function() {},
    countReset: function() {},
    assert: function() {},
    clear: function() {},
  };
}

// --- fetch() ---
// Stub that queues requests for Rust to fulfill. For local file:// content,
// Rust reads from the content directory. Network requests need Rust-side HTTP.
(function() {
  // Pending fetch requests: Rust drains this each tick
  globalThis.__dz_fetch_requests = [];
  globalThis.__dz_fetch_responses = {};
  var nextFetchId = 1;

  function DzHeaders(init) {
    this._map = {};
    if (init) {
      if (init instanceof DzHeaders) {
        var that = this;
        init.forEach(function(v, k) { that._map[k.toLowerCase()] = v; });
      } else if (Array.isArray(init)) {
        for (var i = 0; i < init.length; i++) this._map[init[i][0].toLowerCase()] = init[i][1];
      } else {
        for (var k in init) this._map[k.toLowerCase()] = init[k];
      }
    }
  }
  DzHeaders.prototype.get = function(k) { return this._map[k.toLowerCase()] || null; };
  DzHeaders.prototype.set = function(k, v) { this._map[k.toLowerCase()] = v; };
  DzHeaders.prototype.has = function(k) { return k.toLowerCase() in this._map; };
  DzHeaders.prototype.delete = function(k) { delete this._map[k.toLowerCase()]; };
  DzHeaders.prototype.forEach = function(cb) { for (var k in this._map) cb(this._map[k], k, this); };
  DzHeaders.prototype.entries = function() {
    var arr = []; for (var k in this._map) arr.push([k, this._map[k]]);
    return arr[Symbol.iterator]();
  };
  DzHeaders.prototype.keys = function() {
    var arr = []; for (var k in this._map) arr.push(k);
    return arr[Symbol.iterator]();
  };
  DzHeaders.prototype.values = function() {
    var arr = []; for (var k in this._map) arr.push(this._map[k]);
    return arr[Symbol.iterator]();
  };
  globalThis.Headers = DzHeaders;

  function DzResponse(body, init) {
    init = init || {};
    this.ok = (init.status || 200) >= 200 && (init.status || 200) < 300;
    this.status = init.status || 200;
    this.statusText = init.statusText || 'OK';
    this.headers = new DzHeaders(init.headers);
    this.url = init.url || '';
    this.type = 'basic';
    this.redirected = false;
    this._body = body || '';
    this.bodyUsed = false;
  }
  DzResponse.prototype.text = function() {
    this.bodyUsed = true;
    return Promise.resolve(typeof this._body === 'string' ? this._body : '');
  };
  DzResponse.prototype.json = function() {
    return this.text().then(function(t) { return JSON.parse(t); });
  };
  DzResponse.prototype.arrayBuffer = function() {
    this.bodyUsed = true;
    if (this._body instanceof ArrayBuffer) return Promise.resolve(this._body);
    var enc = new TextEncoder();
    return Promise.resolve(enc.encode(typeof this._body === 'string' ? this._body : '').buffer);
  };
  DzResponse.prototype.blob = function() {
    return this.arrayBuffer().then(function(ab) { return new Blob([ab]); });
  };
  DzResponse.prototype.clone = function() {
    return new DzResponse(this._body, { status: this.status, statusText: this.statusText, headers: this.headers });
  };
  globalThis.Response = DzResponse;

  var MAX_PENDING_FETCHES = 100;
  var MAX_FETCH_URL_LEN = 8192;
  globalThis.fetch = function(input, init) {
    init = init || {};
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
    var method = (init.method || 'GET').toUpperCase();
    if (url.length > MAX_FETCH_URL_LEN) return Promise.reject(new TypeError('URL too long'));
    if (__dz_fetch_requests.length >= MAX_PENDING_FETCHES) return Promise.reject(new TypeError('Too many pending fetches'));
    var id = nextFetchId++;

    return new Promise(function(resolve, reject) {
      __dz_fetch_requests.push({
        id: id,
        url: url,
        method: method,
        headers: init.headers || {},
        body: init.body || null,
        resolve: resolve,
        reject: reject,
      });
    });
  };

  // Called by Rust to resolve pending fetches
  globalThis.__dz_resolve_fetch = function(id, status, statusText, headers, body) {
    var reqs = __dz_fetch_requests;
    for (var i = 0; i < reqs.length; i++) {
      if (reqs[i].id === id) {
        var req = reqs.splice(i, 1)[0];
        req.resolve(new DzResponse(body, { status: status, statusText: statusText, headers: headers, url: req.url }));
        return;
      }
    }
  };
  globalThis.__dz_reject_fetch = function(id, error) {
    var reqs = __dz_fetch_requests;
    for (var i = 0; i < reqs.length; i++) {
      if (reqs[i].id === id) {
        var req = reqs.splice(i, 1)[0];
        req.reject(new TypeError(error || 'Network request failed'));
        return;
      }
    }
  };

  // Reset hook: clear pending fetch requests on navigation
  __dz_reset_hooks.push(function() {
    __dz_fetch_requests.length = 0;
    for (var k in __dz_fetch_responses) delete __dz_fetch_responses[k];
    nextFetchId = 1;
  });
})();

// --- XMLHttpRequest (synchronous stub, enough for libs that feature-detect) ---
if (typeof globalThis.XMLHttpRequest === 'undefined') {
  globalThis.XMLHttpRequest = function XMLHttpRequest() {
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.responseText = '';
    this.response = '';
    this.responseType = '';
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this._method = 'GET';
    this._url = '';
    this._headers = {};
  };
  XMLHttpRequest.prototype.open = function(method, url) {
    this._method = method;
    this._url = url;
    this.readyState = 1;
  };
  XMLHttpRequest.prototype.setRequestHeader = function(k, v) { this._headers[k] = v; };
  XMLHttpRequest.prototype.getResponseHeader = function() { return null; };
  XMLHttpRequest.prototype.getAllResponseHeaders = function() { return ''; };
  XMLHttpRequest.prototype.send = function(body) {
    var self = this;
    // Use fetch under the hood
    fetch(self._url, { method: self._method, headers: self._headers, body: body }).then(function(resp) {
      self.status = resp.status;
      self.statusText = resp.statusText;
      return resp.text();
    }).then(function(text) {
      self.responseText = text;
      self.response = text;
      self.readyState = 4;
      if (self.onreadystatechange) try { self.onreadystatechange(); } catch(e) {}
      if (self.onload) try { self.onload(); } catch(e) {}
    }).catch(function(err) {
      self.readyState = 4;
      if (self.onerror) try { self.onerror(err); } catch(e) {}
    });
  };
  XMLHttpRequest.prototype.abort = function() { this.readyState = 0; };
  XMLHttpRequest.prototype.addEventListener = function(type, fn) {
    if (type === 'load') this.onload = fn;
    else if (type === 'error') this.onerror = fn;
    else if (type === 'readystatechange') this.onreadystatechange = fn;
  };
  XMLHttpRequest.prototype.removeEventListener = function() {};
  XMLHttpRequest.UNSENT = 0;
  XMLHttpRequest.OPENED = 1;
  XMLHttpRequest.HEADERS_RECEIVED = 2;
  XMLHttpRequest.LOADING = 3;
  XMLHttpRequest.DONE = 4;
}

// --- MutationObserver (functional — hooks into DOM mutation methods) ---
(function() {
  var observers = [];

  function MutationRecord(type, target, addedNodes, removedNodes, attributeName, oldValue) {
    this.type = type;
    this.target = target;
    this.addedNodes = addedNodes || [];
    this.removedNodes = removedNodes || [];
    this.attributeName = attributeName || null;
    this.attributeNamespace = null;
    this.oldValue = oldValue || null;
    this.previousSibling = null;
    this.nextSibling = null;
  }

  globalThis.MutationObserver = function MutationObserver(callback) {
    this._callback = callback;
    this._targets = [];
    this._options = [];
    this._records = [];
  };
  MutationObserver.prototype.observe = function(target, options) {
    this._targets.push(target);
    this._options.push(options || {});
    observers.push(this);
  };
  MutationObserver.prototype.disconnect = function() {
    this._targets = [];
    this._options = [];
    var idx = observers.indexOf(this);
    if (idx !== -1) observers.splice(idx, 1);
  };
  MutationObserver.prototype.takeRecords = function() {
    var r = this._records;
    this._records = [];
    return r;
  };

  // Called by our DOM mutation hooks to notify observers
  globalThis.__dz_notify_mutation = function(type, target, added, removed, attrName, oldVal) {
    // Mark HTML layer as dirty so Rust re-renders it next frame
    globalThis.__dz_html_dirty = true;
    var record = new MutationRecord(type, target, added, removed, attrName, oldVal);
    for (var i = 0; i < observers.length; i++) {
      var obs = observers[i];
      for (var j = 0; j < obs._targets.length; j++) {
        var t = obs._targets[j];
        var opts = obs._options[j];
        // Check if this mutation matches what the observer is watching
        if (t === target || (opts.subtree && t.contains && t.contains(target))) {
          if ((type === 'childList' && opts.childList) ||
              (type === 'attributes' && opts.attributes) ||
              (type === 'characterData' && opts.characterData)) {
            obs._records.push(record);
            // Batch: fire callback async (microtask)
            (function(o) {
              queueMicrotask(function() {
                var recs = o.takeRecords();
                if (recs.length > 0) {
                  try { o._callback(recs, o); } catch(e) { console.error('MutationObserver callback error:', e); }
                }
              });
            })(obs);
          }
        }
      }
    }
  };

  __dz_reset_hooks.push(function() { observers.length = 0; });
})();

// --- DOM serializer: walks polyfill DOM → HTML string for Rust re-render ---
globalThis.__dz_serialize_dom = function() {
  function serializeNode(node) {
    if (!node) return '';
    // Text node
    if (node.nodeType === 3) return node.textContent || '';
    // Not an element
    if (node.nodeType !== 1) return '';

    var tag = (node.tagName || node.nodeName || '').toLowerCase();
    if (!tag) return '';

    var html = '<' + tag;

    // Serialize attributes
    if (node._attrs) {
      for (var name in node._attrs) {
        if (node._attrs.hasOwnProperty(name)) {
          html += ' ' + name + '="' + String(node._attrs[name]).replace(/"/g, '&quot;') + '"';
        }
      }
    }

    // Serialize inline style from the reactive style proxy
    if (node.style) {
      var styleStr = node.style.cssText || '';
      if (styleStr) {
        // Only add if not already serialized via _attrs
        if (!node._attrs || !node._attrs['style']) {
          html += ' style="' + styleStr.replace(/"/g, '&quot;') + '"';
        }
      }
    }

    // Serialize class from classList
    if (node.classList && node.classList._classes && node.classList._classes.length > 0) {
      // Only add if not already in _attrs
      if (!node._attrs || !node._attrs['class']) {
        html += ' class="' + node.classList._classes.join(' ') + '"';
      }
    }

    html += '>';

    // Void elements (no closing tag)
    var voidTags = { br:1, hr:1, img:1, input:1, meta:1, link:1, area:1, base:1, col:1, embed:1, source:1, track:1, wbr:1 };
    if (voidTags[tag]) return html;

    // Serialize children
    var children = node.childNodes || node.children || [];
    for (var i = 0; i < children.length; i++) {
      html += serializeNode(children[i]);
    }

    // Special: innerHTML for style/script tags
    if ((tag === 'style' || tag === 'script') && node.textContent) {
      html += node.textContent;
    }

    html += '</' + tag + '>';
    return html;
  }

  // Serialize from <html> or document.body
  var root = document.documentElement || document.body;
  if (!root) return '';
  return '<!DOCTYPE html>' + serializeNode(root);
};

// --- CSS Animation & Transition Engine ---
// Parses @keyframes from <style> tags, drives animations + transitions per frame.
(function() {
  var matchesSelector = globalThis.__dz_matchesSelector; // From DOM polyfill scope
  var _ticking = false; // Guard: suppress transition re-registration during animation tick
  var keyframeRules = {};   // name → [{offset:0-1, props:{prop:value}}]
  var activeAnimations = []; // [{el, name, duration, delay, iterCount, direction, timingFn, fillMode, startTime, pauseTime}]
  var activeTransitions = []; // [{el, prop, from, to, duration, delay, timingFn, startTime}]

  // Cubic bezier presets
  var bezierPresets = {
    'linear': [0, 0, 1, 1],
    'ease': [0.25, 0.1, 0.25, 1.0],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1]
  };

  function cubicBezier(p1x, p1y, p2x, p2y, t) {
    // Newton-Raphson approximation for cubic bezier
    var cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
    var cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
    function sampleX(t) { return ((ax * t + bx) * t + cx) * t; }
    function sampleY(t) { return ((ay * t + by) * t + cy) * t; }
    function sampleDerivX(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    // Solve for t given x using Newton's method
    var xt = t;
    for (var i = 0; i < 8; i++) {
      var err = sampleX(xt) - t;
      if (Math.abs(err) < 1e-6) break;
      var d = sampleDerivX(xt);
      if (Math.abs(d) < 1e-6) break;
      xt -= err / d;
    }
    return sampleY(xt);
  }

  function resolveTimingFn(name) {
    if (!name) return bezierPresets['ease'];
    var preset = bezierPresets[name];
    if (preset) return preset;
    // Parse cubic-bezier(a,b,c,d)
    var m = name.match(/cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
    return bezierPresets['ease'];
  }

  function applyTiming(progress, bezier) {
    if (bezier[0] === 0 && bezier[1] === 0 && bezier[2] === 1 && bezier[3] === 1) return progress;
    return cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], progress);
  }

  // Interpolate between two CSS values
  function interpolate(from, to, t) {
    if (from === undefined || to === undefined) return to;
    from = String(from); to = String(to);
    // Try numeric interpolation (px, deg, plain numbers)
    var fromN = parseFloat(from);
    var toN = parseFloat(to);
    if (!isNaN(fromN) && !isNaN(toN)) {
      var unit = '';
      var m = from.match(/(px|deg|em|rem|%|vw|vh|turn|rad|s|ms)$/);
      if (m) unit = m[1];
      return (fromN + (toN - fromN) * t) + unit;
    }
    // Color interpolation: rgb/rgba
    var fc = parseRGBA(from), tc = parseRGBA(to);
    if (fc && tc) {
      var r = Math.round(fc[0] + (tc[0] - fc[0]) * t);
      var g = Math.round(fc[1] + (tc[1] - fc[1]) * t);
      var b = Math.round(fc[2] + (tc[2] - fc[2]) * t);
      var a = fc[3] + (tc[3] - fc[3]) * t;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
    }
    // Transform function interpolation: rotate(Xdeg), translateX(Xpx), scale(X), etc.
    var fnMatch = from.match(/^(\w+)\((.+)\)$/);
    var fnMatch2 = to.match(/^(\w+)\((.+)\)$/);
    if (fnMatch && fnMatch2 && fnMatch[1] === fnMatch2[1]) {
      var fn = fnMatch[1];
      var fromArgs = fnMatch[2].split(',');
      var toArgs = fnMatch2[2].split(',');
      if (fromArgs.length === toArgs.length) {
        var interped = [];
        for (var i = 0; i < fromArgs.length; i++) {
          interped.push(interpolate(fromArgs[i].trim(), toArgs[i].trim(), t));
        }
        return fn + '(' + interped.join(', ') + ')';
      }
    }
    // Non-interpolable: snap at 50%
    return t < 0.5 ? from : to;
  }

  function parseRGBA(s) {
    if (typeof s !== 'string') return null;
    var m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/);
    if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
    // Hex colors
    m = s.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i);
    if (m) return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16), m[4] ? parseInt(m[4],16)/255 : 1];
    m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (m) return [parseInt(m[1]+m[1],16), parseInt(m[2]+m[2],16), parseInt(m[3]+m[3],16), 1];
    return null;
  }

  // Parse @keyframes from <style> blocks
  function parseKeyframes(cssText) {
    var re = /@keyframes\s+([\w-]+)\s*\{/g;
    var match;
    while ((match = re.exec(cssText)) !== null) {
      var name = match[1];
      var braceCount = 1;
      var pos = re.lastIndex;
      while (pos < cssText.length && braceCount > 0) {
        if (cssText[pos] === '{') braceCount++;
        else if (cssText[pos] === '}') braceCount--;
        pos++;
      }
      var body = cssText.substring(re.lastIndex, pos - 1);
      keyframeRules[name] = parseKeyframeBody(body);
    }
  }

  function parseKeyframeBody(body) {
    var frames = [];
    var re = /([\d.]+%|from|to)\s*\{([^}]*)\}/g;
    var m;
    while ((m = re.exec(body)) !== null) {
      var offset = m[1] === 'from' ? 0 : m[1] === 'to' ? 1 : parseFloat(m[1]) / 100;
      var props = {};
      var decls = m[2].split(';');
      for (var i = 0; i < decls.length; i++) {
        var d = decls[i].trim();
        if (!d) continue;
        var colon = d.indexOf(':');
        if (colon < 0) continue;
        var prop = d.substring(0, colon).trim();
        var val = d.substring(colon + 1).trim();
        // Convert kebab-case to camelCase for style assignment
        prop = prop.replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
        props[prop] = val;
      }
      frames.push({ offset: offset, props: props });
    }
    frames.sort(function(a, b) { return a.offset - b.offset; });
    return frames;
  }

  // Parse animation shorthand: "name duration timing delay iterCount direction fillMode"
  function parseAnimationShorthand(value) {
    var parts = value.trim().split(/\s+/);
    var result = { name: '', duration: 0, timingFn: 'ease', delay: 0, iterCount: 1, direction: 'normal', fillMode: 'none' };
    // First non-time, non-keyword token is the name
    var timeIdx = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (/^[\d.]+m?s$/.test(p)) {
        if (timeIdx === 0) { result.duration = parseTime(p); timeIdx++; }
        else if (timeIdx === 1) { result.delay = parseTime(p); timeIdx++; }
      } else if (bezierPresets[p] || /^cubic-bezier/.test(p)) {
        result.timingFn = p;
      } else if (p === 'infinite') {
        result.iterCount = Infinity;
      } else if (/^\d+$/.test(p)) {
        result.iterCount = parseInt(p);
      } else if (/^(normal|reverse|alternate|alternate-reverse)$/.test(p)) {
        result.direction = p;
      } else if (/^(none|forwards|backwards|both)$/.test(p)) {
        result.fillMode = p;
      } else if (!result.name) {
        result.name = p;
      }
    }
    return result;
  }

  function parseTime(s) {
    if (s.endsWith('ms')) return parseFloat(s);
    if (s.endsWith('s')) return parseFloat(s) * 1000;
    return parseFloat(s) * 1000; // assume seconds if no unit
  }

  // --- CSS Rule Scanning for animation/transition declarations ---
  var cssAnimationRules = []; // [{selector, animation, transition}]
  var MAX_CSS_ANIMATION_RULES = 500;

  // Strip @-rule blocks (keyframes, media, supports) from CSS text
  function stripAtRules(css) {
    var result = '';
    var pos = 0;
    while (pos < css.length) {
      var atIdx = css.indexOf('@', pos);
      if (atIdx === -1) { result += css.substring(pos); break; }
      result += css.substring(pos, atIdx);
      // Find the opening brace
      var braceIdx = css.indexOf('{', atIdx);
      if (braceIdx === -1) { pos = css.length; break; }
      // Skip the entire @-rule block (accounting for nesting)
      var depth = 1;
      var scan = braceIdx + 1;
      while (scan < css.length && depth > 0) {
        if (css[scan] === '{') depth++;
        else if (css[scan] === '}') depth--;
        scan++;
      }
      pos = scan;
    }
    return result;
  }

  // Parse regular CSS rules for animation/transition declarations
  function parseCSSRules(cssText) {
    var stripped = stripAtRules(cssText);
    var re = /([^{}]+)\{([^}]*)\}/g;
    var match;
    while ((match = re.exec(stripped)) !== null) {
      if (cssAnimationRules.length >= MAX_CSS_ANIMATION_RULES) break;
      var selector = match[1].trim();
      if (!selector || selector.charAt(0) === '@') continue;
      var decls = match[2];
      var animation = null, transition = null;
      // Extract animation and transition declarations
      var declParts = decls.split(';');
      for (var d = 0; d < declParts.length; d++) {
        var decl = declParts[d].trim();
        if (!decl) continue;
        var colon = decl.indexOf(':');
        if (colon < 0) continue;
        var prop = decl.substring(0, colon).trim().toLowerCase();
        var val = decl.substring(colon + 1).trim().replace(/\s*!important\s*$/, '');
        if (prop === 'animation' || prop === 'animation-name') animation = val;
        if (prop === 'transition') transition = val;
      }
      if (animation || transition) {
        // Handle comma-separated selectors
        var selectors = selector.split(',');
        for (var s = 0; s < selectors.length; s++) {
          if (cssAnimationRules.length >= MAX_CSS_ANIMATION_RULES) break;
          cssAnimationRules.push({
            selector: selectors[s].trim(),
            animation: animation,
            transition: transition
          });
        }
      }
    }
  }

  var MAX_ACTIVE_ANIMATIONS = 200;
  var MAX_ACTIVE_TRANSITIONS = 200;
  var MAX_PER_ELEMENT_ANIMATIONS = 10;

  // Walk DOM element tree, calling visitor(el) on each element node.
  // Shared by style collection, animation application, and initial scan.
  var MAX_WALK_DEPTH = 100;
  function walkElements(root, visitor, depth) {
    if (!root || depth > MAX_WALK_DEPTH) return;
    var children = root.childNodes || root.children || [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].nodeType === 1) {
        visitor(children[i]);
        walkElements(children[i], visitor, depth + 1);
      }
    }
  }

  // Apply matching CSS animation/transition rules to an element
  function applyCSSAnimationsToElement(el, timestamp) {
    if (!el || !el.tagName) return;
    var matchedAnimation = null, matchedTransition = null;
    for (var i = 0; i < cssAnimationRules.length; i++) {
      var rule = cssAnimationRules[i];
      if (matchesSelector(el, rule.selector)) {
        if (rule.animation) matchedAnimation = rule.animation;
        if (rule.transition) matchedTransition = rule.transition;
      }
    }
    if (matchedAnimation && activeAnimations.length < MAX_ACTIVE_ANIMATIONS) {
      var animParts = matchedAnimation.split(',');
      var elAnimCount = 0;
      for (var a = 0; a < activeAnimations.length; a++) {
        if (activeAnimations[a].el === el) elAnimCount++;
      }
      for (var j = 0; j < animParts.length && elAnimCount < MAX_PER_ELEMENT_ANIMATIONS; j++) {
        registerAnimation(el, animParts[j].trim(), timestamp);
        elAnimCount++;
      }
    }
    if (matchedTransition) {
      el._cssTransition = matchedTransition;
    }
  }

  // Collect all <style> elements from head and body
  function collectStyleElements() {
    var results = [];
    var collect = function(el) {
      if (el.tagName && el.tagName.toLowerCase() === 'style') results.push(el);
    };
    walkElements(document.head, collect, 0);
    walkElements(document.body, collect, 0);
    return results;
  }

  // Scan <style> tags for @keyframes and animation/transition rules
  function scanStylesheets() {
    cssAnimationRules.length = 0; // Clear and re-scan
    var styles = collectStyleElements();
    for (var i = 0; i < styles.length; i++) {
      var text = styles[i].textContent || '';
      if (text.indexOf('@keyframes') >= 0) {
        parseKeyframes(text);
      }
      parseCSSRules(text);
    }
  }

  // Register an animation on an element
  function registerAnimation(el, animValue, timestamp) {
    if (activeAnimations.length >= MAX_ACTIVE_ANIMATIONS) return;
    var a = parseAnimationShorthand(animValue);
    if (!a.name || !keyframeRules[a.name]) return;
    // Don't re-register if already running same animation
    var elCount = 0;
    for (var i = 0; i < activeAnimations.length; i++) {
      if (activeAnimations[i].el === el) {
        if (activeAnimations[i].name === a.name) return;
        elCount++;
      }
    }
    if (elCount >= MAX_PER_ELEMENT_ANIMATIONS) return;
    activeAnimations.push({
      el: el, name: a.name, duration: a.duration, delay: a.delay,
      iterCount: a.iterCount, direction: a.direction,
      timingFn: resolveTimingFn(a.timingFn), fillMode: a.fillMode,
      startTime: timestamp
    });
  }

  // Register a transition on an element
  function registerTransition(el, prop, from, to, duration, delay, timingFn, timestamp) {
    // Remove existing transition for same el+prop
    for (var i = activeTransitions.length - 1; i >= 0; i--) {
      if (activeTransitions[i].el === el && activeTransitions[i].prop === prop) {
        activeTransitions.splice(i, 1);
      }
    }
    if (activeTransitions.length >= MAX_ACTIVE_TRANSITIONS) return;
    activeTransitions.push({
      el: el, prop: prop, from: from, to: to,
      duration: duration, delay: delay,
      timingFn: resolveTimingFn(timingFn),
      startTime: timestamp
    });
  }

  // Tick all active animations and transitions
  globalThis.__dz_animation_tick = function(timestamp) {
    _ticking = true;
    try {
      // Scan for @keyframes and CSS animation rules if first tick or if styles changed
      if (Object.keys(keyframeRules).length === 0) scanStylesheets();

      // Tick animations
      for (var i = activeAnimations.length - 1; i >= 0; i--) {
        var a = activeAnimations[i];
        var elapsed = timestamp - a.startTime - a.delay;
        if (elapsed < 0) continue; // still in delay

        var frames = keyframeRules[a.name];
        if (!frames || frames.length === 0) { activeAnimations.splice(i, 1); continue; }

        var iterProgress = elapsed / a.duration;
        var currentIter = Math.floor(iterProgress);

        if (a.iterCount !== Infinity && currentIter >= a.iterCount) {
          if (a.fillMode === 'forwards' || a.fillMode === 'both') {
            applyKeyframeAt(a.el, frames, 1.0, a.timingFn);
          }
          activeAnimations.splice(i, 1);
          continue;
        }

        var fracProgress = iterProgress - currentIter;
        if (a.direction === 'reverse') {
          fracProgress = 1 - fracProgress;
        } else if (a.direction === 'alternate') {
          if (currentIter % 2 === 1) fracProgress = 1 - fracProgress;
        } else if (a.direction === 'alternate-reverse') {
          if (currentIter % 2 === 0) fracProgress = 1 - fracProgress;
        }

        applyKeyframeAt(a.el, frames, fracProgress, a.timingFn);
      }

      // Tick transitions
      for (var j = activeTransitions.length - 1; j >= 0; j--) {
        var t = activeTransitions[j];
        var telapsed = timestamp - t.startTime - t.delay;
        if (telapsed < 0) continue;

        var progress = Math.min(telapsed / t.duration, 1.0);
        var eased = applyTiming(progress, t.timingFn);
        t.el.style[t.prop] = interpolate(t.from, t.to, eased);

        if (progress >= 1.0) {
          activeTransitions.splice(j, 1);
        }
      }
    } finally {
      _ticking = false;
    }
  };

  function applyKeyframeAt(el, frames, progress, timingFn) {
    var eased = applyTiming(progress, timingFn);
    // Find surrounding keyframes
    var before = frames[0], after = frames[frames.length - 1];
    for (var k = 0; k < frames.length - 1; k++) {
      if (frames[k].offset <= eased && frames[k + 1].offset >= eased) {
        before = frames[k];
        after = frames[k + 1];
        break;
      }
    }
    var range = after.offset - before.offset;
    var localT = range > 0 ? (eased - before.offset) / range : 1;

    for (var prop in after.props) {
      var fromVal = before.props[prop] !== undefined ? before.props[prop] : after.props[prop];
      var toVal = after.props[prop];
      el.style[prop] = interpolate(fromVal, toVal, localT);
    }
  }

  // Hook into mutation notifications to detect animation/transition triggers
  var origNotify = globalThis.__dz_notify_mutation;
  globalThis.__dz_notify_mutation = function(type, target, added, removed, attrName, oldVal) {
    var timestamp = globalThis.__dz_perf_now || 0;
    if (type === 'attributes') {
      // Inline style changed — check for animation property
      if (attrName === 'style' && target && target.style) {
        var s = target.style;
        if (s.animation) {
          var animParts = s.animation.split(',');
          for (var ai = 0; ai < animParts.length; ai++) {
            registerAnimation(target, animParts[ai].trim(), timestamp);
          }
        }
        if (s.animationName) {
          registerAnimation(target, s.animationName + ' ' +
            parseTime(s.animationDuration || '0s') + 'ms ' +
            (s.animationTimingFunction || 'ease') + ' ' +
            parseTime(s.animationDelay || '0s') + 'ms ' +
            (s.animationIterationCount === 'infinite' ? 'infinite' : (s.animationIterationCount || '1')) + ' ' +
            (s.animationDirection || 'normal') + ' ' +
            (s.animationFillMode || 'none'), timestamp);
        }
      }
      // Class changed — resolve stylesheet animation/transition rules
      if (attrName === 'class' && target) {
        applyCSSAnimationsToElement(target, timestamp);
      }
    }
    // New elements added — apply stylesheet rules and re-scan if <style> was added
    if (type === 'childList' && added) {
      var needRescan = false;
      for (var i = 0; i < added.length; i++) {
        var node = added[i];
        if (!node) continue;
        if (node.nodeType === 1) {
          applyCSSAnimationsToElement(node, timestamp);
          walkElements(node, function(child) { applyCSSAnimationsToElement(child, timestamp); }, 0);
        }
        if (node.tagName && node.tagName.toLowerCase() === 'style') needRescan = true;
      }
      if (needRescan) scanStylesheets();
    }
    origNotify(type, target, added, removed, attrName, oldVal);
  };

  // Intercept style changes to start CSS transitions
  globalThis.__dz_transition_check = function(el, prop, oldVal, newVal) {
    if (_ticking) return false;
    // Check inline style transition, then stylesheet-declared transition
    var transStr = (el.style && el.style.transition) || el._cssTransition;
    if (!transStr) return false;
    if (oldVal === newVal || oldVal === undefined) return false;
    var parts = transStr.split(',');
    for (var i = 0; i < parts.length; i++) {
      var tokens = parts[i].trim().split(/\s+/);
      var tProp = tokens[0];
      if (tProp === 'none') continue;
      tProp = tProp.replace(/-([a-z])/g, function(_, c) { return c.toUpperCase(); });
      if (tProp !== 'all' && tProp !== prop) continue;
      var dur = parseTime(tokens[1] || '0s');
      if (dur <= 0) continue;
      registerTransition(el, prop, oldVal, newVal, dur, parseTime(tokens[3] || '0s'), tokens[2] || 'ease', globalThis.__dz_perf_now || 0);
      return true;
    }
    return false;
  };

  // Initial scan and apply to existing DOM elements
  scanStylesheets();
  var root = document.documentElement || document.body || document;
  walkElements(root, function(el) { applyCSSAnimationsToElement(el, 0); }, 0);

  // Expose for testing
  globalThis.__dz_keyframeRules = keyframeRules;
  globalThis.__dz_activeAnimations = activeAnimations;
  globalThis.__dz_activeTransitions = activeTransitions;
  globalThis.__dz_cssAnimationRules = cssAnimationRules;
  globalThis.__dz_scanKeyframes = scanStylesheets; // Backwards-compatible alias
  globalThis.__dz_scanStylesheets = scanStylesheets;
  globalThis.__dz_applyCSSAnimationsToElement = applyCSSAnimationsToElement;
})();

// --- ResizeObserver (fires initial callback with element dimensions) ---
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = function ResizeObserver(callback) {
    this._callback = callback;
    this._targets = [];
  };
  ResizeObserver.prototype.observe = function(target) {
    this._targets.push(target);
    // Fire initial observation async (spec behavior — initial entry delivered async)
    var self = this;
    queueMicrotask(function() {
      var w = target.width || (target.getBoundingClientRect ? target.getBoundingClientRect().width : window.innerWidth) || window.innerWidth;
      var h = target.height || (target.getBoundingClientRect ? target.getBoundingClientRect().height : window.innerHeight) || window.innerHeight;
      var entry = {
        target: target,
        contentRect: { x: 0, y: 0, width: w, height: h, top: 0, left: 0, bottom: h, right: w },
        borderBoxSize: [{ blockSize: h, inlineSize: w }],
        contentBoxSize: [{ blockSize: h, inlineSize: w }],
        devicePixelContentBoxSize: [{ blockSize: h, inlineSize: w }],
      };
      try { self._callback([entry], self); } catch(e) { console.error('ResizeObserver callback error:', e); }
    });
  };
  ResizeObserver.prototype.unobserve = function(target) {
    this._targets = this._targets.filter(function(t) { return t !== target; });
  };
  ResizeObserver.prototype.disconnect = function() { this._targets = []; };
}

// --- IntersectionObserver (everything is visible in stage-runtime viewport) ---
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = function IntersectionObserver(callback, options) {
    this._callback = callback;
    this._targets = [];
  };
  IntersectionObserver.prototype.observe = function(target) {
    this._targets.push(target);
    // Everything is "intersecting" — full viewport is visible
    var self = this;
    queueMicrotask(function() {
      var rect = target.getBoundingClientRect ? target.getBoundingClientRect() : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth };
      var entry = {
        target: target,
        isIntersecting: true,
        intersectionRatio: 1.0,
        boundingClientRect: rect,
        intersectionRect: rect,
        rootBounds: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth },
        time: performance.now(),
      };
      try { self._callback([entry], self); } catch(e) { console.error('IntersectionObserver callback error:', e); }
    });
  };
  IntersectionObserver.prototype.unobserve = function(target) {
    this._targets = this._targets.filter(function(t) { return t !== target; });
  };
  IntersectionObserver.prototype.disconnect = function() { this._targets = []; };
  IntersectionObserver.prototype.takeRecords = function() { return []; };
}

// --- requestIdleCallback ---
if (typeof globalThis.requestIdleCallback === 'undefined') {
  globalThis.requestIdleCallback = function(cb) {
    return setTimeout(function() {
      cb({ didTimeout: false, timeRemaining: function() { return 50; } });
    }, 1);
  };
  globalThis.cancelIdleCallback = function(id) { clearTimeout(id); };
}

// --- WebSocket (functional — Rust handles connections via tungstenite) ---
(function() {
  var nextWsId = 1;
  // Pending requests for Rust: connect, send, close
  globalThis.__dz_ws_requests = [];
  // Registry of active WebSocket instances by id
  globalThis.__dz_ws_registry = {};

  globalThis.WebSocket = function WebSocket(url, protocols) {
    this._id = nextWsId++;
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.protocol = typeof protocols === 'string' ? protocols : (Array.isArray(protocols) && protocols.length > 0 ? protocols[0] : '');
    this.extensions = '';
    this.binaryType = 'blob';
    this.bufferedAmount = 0;
    this._listeners = {};
    __dz_ws_registry[this._id] = this;
    if (__dz_ws_requests.length < 200) { // MAX_PENDING_WS_REQUESTS
      __dz_ws_requests.push({ type: 'connect', id: this._id, url: url, protocols: protocols || [] });
    }
  };

  WebSocket.prototype.send = function(data) {
    if (this.readyState !== 1) {
      console.error('[stage-runtime] WebSocket.send() called when readyState=' + this.readyState);
      return;
    }
    if (__dz_ws_requests.length < 200) { // MAX_PENDING_WS_REQUESTS
      __dz_ws_requests.push({ type: 'send', id: this._id, data: typeof data === 'string' ? data : String(data) });
    }
  };

  WebSocket.prototype.close = function(code, reason) {
    if (this.readyState === 2 || this.readyState === 3) return;
    this.readyState = 2; // CLOSING
    __dz_ws_requests.push({ type: 'close', id: this._id, code: code || 1000, reason: reason || '' });
  };

  WebSocket.prototype.addEventListener = function(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  };
  WebSocket.prototype.removeEventListener = function(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(function(l) { return l !== fn; });
  };
  WebSocket.prototype._fireEvent = function(type, eventData) {
    if (this['on' + type]) {
      try { this['on' + type](eventData); } catch(e) { console.error('WebSocket on' + type + ' error:', e); }
    }
    var handlers = this._listeners[type];
    if (handlers) {
      for (var i = 0; i < handlers.length; i++) {
        try { handlers[i](eventData); } catch(e) { console.error('WebSocket listener error:', e); }
      }
    }
  };

  WebSocket.CONNECTING = 0;
  WebSocket.OPEN = 1;
  WebSocket.CLOSING = 2;
  WebSocket.CLOSED = 3;

  // Called by Rust when a WebSocket connection opens
  globalThis.__dz_ws_on_open = function(id) {
    var ws = __dz_ws_registry[id];
    if (!ws) return;
    ws.readyState = 1; // OPEN
    ws._fireEvent('open', new Event('open'));
  };

  // Called by Rust when a message is received
  globalThis.__dz_ws_on_message = function(id, data) {
    var ws = __dz_ws_registry[id];
    if (!ws) return;
    ws._fireEvent('message', { type: 'message', data: data, origin: ws.url, lastEventId: '', source: null, ports: [] });
  };

  // Called by Rust when the connection closes
  globalThis.__dz_ws_on_close = function(id, code, reason, wasClean) {
    var ws = __dz_ws_registry[id];
    if (!ws) return;
    ws.readyState = 3; // CLOSED
    ws._fireEvent('close', { type: 'close', code: code, reason: reason, wasClean: wasClean });
    delete __dz_ws_registry[id];
  };

  // Called by Rust on connection error
  globalThis.__dz_ws_on_error = function(id, message) {
    var ws = __dz_ws_registry[id];
    if (!ws) return;
    ws._fireEvent('error', new Event('error'));
  };

  // Reset hook: close all WebSocket connections and clear state on navigation
  __dz_reset_hooks.push(function() {
    for (var id in __dz_ws_registry) {
      var ws = __dz_ws_registry[id];
      if (ws && ws.readyState < 2) {
        __dz_ws_requests.push({ type: 'close', id: ws._id, code: 1001, reason: 'navigation' });
      }
    }
    for (var k in __dz_ws_registry) delete __dz_ws_registry[k];
    __dz_ws_requests.length = 0;
    nextWsId = 1;
  });
})();

// --- Worker (single-threaded — runs on main thread, message passing via microtasks) ---
if (typeof globalThis.Worker === 'undefined') {
  globalThis.Worker = function Worker(url) {
    var self = this;
    this.onmessage = null;
    this.onerror = null;
    this._listeners = { message: [], error: [] };
    this._terminated = false;

    // The worker's "self" scope
    var workerSelf = {
      onmessage: null,
      postMessage: function(data) {
        if (self._terminated) return;
        var event = { data: JSON.parse(JSON.stringify(data)) };
        setTimeout(function() {
          if (self._terminated) return;
          if (self.onmessage) self.onmessage(event);
          for (var i = 0; i < self._listeners.message.length; i++) {
            self._listeners.message[i](event);
          }
        }, 0);
      },
      addEventListener: function(type, fn) {
        if (!workerSelf._listeners) workerSelf._listeners = { message: [], error: [] };
        if (workerSelf._listeners[type]) workerSelf._listeners[type].push(fn);
      },
      removeEventListener: function(type, fn) {
        if (!workerSelf._listeners || !workerSelf._listeners[type]) return;
        var idx = workerSelf._listeners[type].indexOf(fn);
        if (idx >= 0) workerSelf._listeners[type].splice(idx, 1);
      },
      importScripts: function() {
        for (var i = 0; i < arguments.length; i++) {
          try {
            var src = __dz_load_worker_script(arguments[i]);
            if (src) {
              // Execute with dangerous globals shadowed via local var declarations
              var fn = new Function('self', 'postMessage', 'importScripts', 'addEventListener', 'removeEventListener', 'close',
                'var eval = undefined, Function = undefined;\n' + src);
              fn(workerSelf, workerSelf.postMessage, workerSelf.importScripts,
                 workerSelf.addEventListener, workerSelf.removeEventListener, workerSelf.close);
            }
          } catch(e) {
            console.error('importScripts failed for', arguments[i], e);
          }
        }
      },
      _listeners: { message: [], error: [] },
      close: function() { self.terminate(); },
      location: globalThis.location || {},
      navigator: globalThis.navigator || {},
      console: globalThis.console
    };

    // Load and execute worker script asynchronously (setTimeout so tick() processes it)
    setTimeout(function() {
      if (self._terminated) return;
      try {
        var src = (typeof __dz_load_worker_script === 'function') ? __dz_load_worker_script(url) : null;
        if (src) {
          // Execute with dangerous globals shadowed via local var declarations
          var fn = new Function('self', 'postMessage', 'importScripts', 'addEventListener', 'removeEventListener', 'close',
            'var eval = undefined, Function = undefined;\n' + src);
          fn(workerSelf, workerSelf.postMessage, workerSelf.importScripts,
             workerSelf.addEventListener, workerSelf.removeEventListener, workerSelf.close);
        } else {
          console.warn('Worker script not found: ' + url);
        }
      } catch(e) {
        console.error('Worker error:', e);
        var errEvt = { message: String(e), filename: url, lineno: 0, colno: 0, error: e };
        if (self.onerror) self.onerror(errEvt);
      }
    });

    // Store workerSelf so postMessage can deliver to it
    this._workerSelf = workerSelf;
  };
  Worker.prototype.postMessage = function(data) {
    if (this._terminated) return;
    var ws = this._workerSelf;
    var event = { data: JSON.parse(JSON.stringify(data)) };
    setTimeout(function() {
      if (ws.onmessage) ws.onmessage(event);
      if (ws._listeners && ws._listeners.message) {
        for (var i = 0; i < ws._listeners.message.length; i++) {
          ws._listeners.message[i](event);
        }
      }
    }, 0);
  };
  Worker.prototype.terminate = function() { this._terminated = true; };
  Worker.prototype.addEventListener = function(type, fn) {
    if (this._listeners[type]) this._listeners[type].push(fn);
  };
  Worker.prototype.removeEventListener = function(type, fn) {
    if (!this._listeners[type]) return;
    var idx = this._listeners[type].indexOf(fn);
    if (idx >= 0) this._listeners[type].splice(idx, 1);
  };
}

// --- Blob / File ---
if (typeof globalThis.Blob === 'undefined') {
  globalThis.Blob = function Blob(parts, options) {
    options = options || {};
    this.type = options.type || '';
    this._parts = parts || [];
    var size = 0;
    for (var i = 0; i < this._parts.length; i++) {
      var p = this._parts[i];
      if (typeof p === 'string') size += p.length;
      else if (p instanceof ArrayBuffer) size += p.byteLength;
      else if (p && p.byteLength) size += p.byteLength;
    }
    this.size = size;
  };
  Blob.prototype.text = function() {
    var result = '';
    for (var i = 0; i < this._parts.length; i++) {
      var p = this._parts[i];
      if (typeof p === 'string') result += p;
      else result += new TextDecoder().decode(p);
    }
    return Promise.resolve(result);
  };
  Blob.prototype.arrayBuffer = function() {
    return this.text().then(function(t) { return new TextEncoder().encode(t).buffer; });
  };
  Blob.prototype.slice = function(start, end, type) {
    return new Blob([], { type: type || this.type });
  };
  Blob.prototype.stream = function() { return null; };
}

if (typeof globalThis.File === 'undefined') {
  globalThis.File = function File(parts, name, options) {
    Blob.call(this, parts, options);
    this.name = name;
    this.lastModified = (options && options.lastModified) || Date.now();
  };
  File.prototype = Object.create(Blob.prototype);
}

// --- FormData ---
if (typeof globalThis.FormData === 'undefined') {
  globalThis.FormData = function FormData() { this._entries = []; };
  FormData.prototype.append = function(k, v) { this._entries.push([k, v]); };
  FormData.prototype.set = function(k, v) {
    this._entries = this._entries.filter(function(e) { return e[0] !== k; });
    this._entries.push([k, v]);
  };
  FormData.prototype.get = function(k) {
    for (var i = 0; i < this._entries.length; i++) if (this._entries[i][0] === k) return this._entries[i][1];
    return null;
  };
  FormData.prototype.getAll = function(k) {
    return this._entries.filter(function(e) { return e[0] === k; }).map(function(e) { return e[1]; });
  };
  FormData.prototype.has = function(k) {
    for (var i = 0; i < this._entries.length; i++) if (this._entries[i][0] === k) return true;
    return false;
  };
  FormData.prototype.delete = function(k) {
    this._entries = this._entries.filter(function(e) { return e[0] !== k; });
  };
  FormData.prototype.forEach = function(cb) {
    for (var i = 0; i < this._entries.length; i++) cb(this._entries[i][1], this._entries[i][0], this);
  };
  FormData.prototype.entries = function() { return this._entries[Symbol.iterator](); };
  FormData.prototype.keys = function() { return this._entries.map(function(e) { return e[0]; })[Symbol.iterator](); };
  FormData.prototype.values = function() { return this._entries.map(function(e) { return e[1]; })[Symbol.iterator](); };
}

// --- crypto (minimal — getRandomValues + randomUUID) ---
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = {
    getRandomValues: function(arr) {
      for (var i = 0; i < arr.length; i++) arr[i] = (Math.random() * 256) | 0;
      return arr;
    },
    randomUUID: function() {
      var d = new Uint8Array(16);
      crypto.getRandomValues(d);
      d[6] = (d[6] & 0x0f) | 0x40;
      d[8] = (d[8] & 0x3f) | 0x80;
      var hex = '';
      for (var i = 0; i < 16; i++) {
        hex += (d[i] < 16 ? '0' : '') + d[i].toString(16);
        if (i === 3 || i === 5 || i === 7 || i === 9) hex += '-';
      }
      return hex;
    },
    subtle: {
      digest: function() { __dz_warnOnce('crypto.subtle.digest() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      encrypt: function() { __dz_warnOnce('crypto.subtle.encrypt() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      decrypt: function() { __dz_warnOnce('crypto.subtle.decrypt() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      sign: function() { __dz_warnOnce('crypto.subtle.sign() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      verify: function() { __dz_warnOnce('crypto.subtle.verify() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      generateKey: function() { __dz_warnOnce('crypto.subtle.generateKey() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      importKey: function() { __dz_warnOnce('crypto.subtle.importKey() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
      exportKey: function() { __dz_warnOnce('crypto.subtle.exportKey() not implemented'); return Promise.reject(new Error('SubtleCrypto not available')); },
    },
  };
}

// --- Request (for fetch) ---
if (typeof globalThis.Request === 'undefined') {
  globalThis.Request = function Request(input, init) {
    init = init || {};
    this.url = typeof input === 'string' ? input : input.url;
    this.method = (init.method || 'GET').toUpperCase();
    this.headers = new Headers(init.headers || {});
    this.body = init.body || null;
    this.mode = init.mode || 'cors';
    this.credentials = init.credentials || 'same-origin';
    this.cache = init.cache || 'default';
    this.redirect = init.redirect || 'follow';
    this.referrer = init.referrer || '';
    this.signal = init.signal || new AbortSignal();
  };
  Request.prototype.clone = function() {
    return new Request(this.url, { method: this.method, headers: this.headers, body: this.body });
  };
  Request.prototype.text = function() { return Promise.resolve(this.body ? String(this.body) : ''); };
  Request.prototype.json = function() { return this.text().then(JSON.parse); };
}

// --- MessageChannel / MessagePort (React scheduler uses this) ---
if (typeof globalThis.MessageChannel === 'undefined') {
  function MessagePort() {
    this.onmessage = null;
    this._other = null;
  }
  MessagePort.prototype.postMessage = function(data) {
    var other = this._other;
    if (other && other.onmessage) {
      var handler = other.onmessage;
      setTimeout(function() { try { handler({ data: data }); } catch(e) {} }, 0);
    }
  };
  MessagePort.prototype.start = function() {};
  MessagePort.prototype.close = function() {};
  MessagePort.prototype.addEventListener = function(type, fn) {
    if (type === 'message') this.onmessage = fn;
  };
  MessagePort.prototype.removeEventListener = function() {};

  globalThis.MessageChannel = function MessageChannel() {
    this.port1 = new MessagePort();
    this.port2 = new MessagePort();
    this.port1._other = this.port2;
    this.port2._other = this.port1;
  };
  globalThis.MessagePort = MessagePort;
}

// --- Misc browser globals that libs feature-detect ---
if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = function HTMLElement() {};
  HTMLElement.prototype.addEventListener = function() {};
  HTMLElement.prototype.removeEventListener = function() {};
}
if (typeof globalThis.HTMLCanvasElement === 'undefined') {
  globalThis.HTMLCanvasElement = function HTMLCanvasElement() {};
}
if (typeof globalThis.HTMLImageElement === 'undefined') {
  globalThis.HTMLImageElement = globalThis.Image;
}
if (typeof globalThis.HTMLVideoElement === 'undefined') {
  globalThis.HTMLVideoElement = function HTMLVideoElement() {};
}
if (typeof globalThis.SVGElement === 'undefined') {
  globalThis.SVGElement = function SVGElement() {};
}
if (typeof globalThis.DocumentFragment === 'undefined') {
  globalThis.DocumentFragment = function DocumentFragment() {};
}
if (typeof globalThis.Node === 'undefined') {
  globalThis.Node = {
    ELEMENT_NODE: 1,
    ATTRIBUTE_NODE: 2,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
  };
}
if (typeof globalThis.Element === 'undefined') {
  globalThis.Element = function Element() {};
}
if (typeof globalThis.KeyboardEvent === 'undefined') {
  globalThis.KeyboardEvent = function KeyboardEvent(type, init) {
    Event.call(this, type, init);
    init = init || {};
    this.key = init.key || '';
    this.code = init.code || '';
    this.ctrlKey = !!init.ctrlKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.metaKey = !!init.metaKey;
    this.repeat = !!init.repeat;
  };
}
if (typeof globalThis.MouseEvent === 'undefined') {
  globalThis.MouseEvent = function MouseEvent(type, init) {
    Event.call(this, type, init);
    init = init || {};
    this.clientX = init.clientX || 0;
    this.clientY = init.clientY || 0;
    this.button = init.button || 0;
  };
}
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent = function PointerEvent(type, init) {
    MouseEvent.call(this, type, init);
    init = init || {};
    this.pointerId = init.pointerId || 0;
    this.pointerType = init.pointerType || 'mouse';
  };
}
if (typeof globalThis.TouchEvent === 'undefined') {
  globalThis.TouchEvent = function TouchEvent(type, init) {
    Event.call(this, type, init);
    this.touches = [];
    this.changedTouches = [];
    this.targetTouches = [];
  };
}
if (typeof globalThis.FocusEvent === 'undefined') {
  globalThis.FocusEvent = function FocusEvent(type, init) {
    Event.call(this, type, init);
  };
}
if (typeof globalThis.WheelEvent === 'undefined') {
  globalThis.WheelEvent = function WheelEvent(type, init) {
    MouseEvent.call(this, type, init);
    init = init || {};
    this.deltaX = init.deltaX || 0;
    this.deltaY = init.deltaY || 0;
    this.deltaZ = init.deltaZ || 0;
    this.deltaMode = init.deltaMode || 0;
  };
}

// --- window.history (stub) ---
window.history = {
  length: 1,
  state: null,
  pushState: function(state, title, url) { this.state = state; },
  replaceState: function(state, title, url) { this.state = state; },
  go: function() {},
  back: function() {},
  forward: function() {},
};

// --- window.location enhancements ---
window.location.assign = function() {};
window.location.replace = function() {};
window.location.reload = function() {};
window.location.search = '';
window.location.hash = '';

// --- window.scroll / scrollTo / scrollBy ---
window.scrollTo = function() {};
window.scroll = function() {};
window.scrollBy = function() {};
window.pageXOffset = 0;
window.pageYOffset = 0;
window.scrollX = 0;
window.scrollY = 0;

// --- window.getSelection ---
if (typeof window.getSelection === 'undefined') {
  window.getSelection = function() {
    return {
      anchorNode: null, focusNode: null, isCollapsed: true, rangeCount: 0,
      toString: function() { return ''; },
      getRangeAt: function() { return null; },
      addRange: function() {}, removeAllRanges: function() {}, collapse: function() {},
    };
  };
}

// --- navigator extensions ---
window.navigator.onLine = true;
window.navigator.cookieEnabled = true;
window.navigator.maxTouchPoints = 0;
window.navigator.vendor = '';
window.navigator.appVersion = '5.0';
window.navigator.appName = 'Netscape';
window.navigator.product = 'Gecko';
window.navigator.connection = { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false };
window.navigator.permissions = {
  query: function() { return Promise.resolve({ state: 'denied', onchange: null }); },
};
window.navigator.clipboard = {
  readText: function() {
    __dz_warnOnce('navigator.clipboard.readText() not available in stage-runtime');
    return Promise.reject(new DOMException('Clipboard not available', 'NotAllowedError'));
  },
  writeText: function() {
    __dz_warnOnce('navigator.clipboard.writeText() not available in stage-runtime');
    return Promise.reject(new DOMException('Clipboard not available', 'NotAllowedError'));
  },
  read: function() { return Promise.reject(new DOMException('Clipboard not available', 'NotAllowedError')); },
  write: function() { return Promise.reject(new DOMException('Clipboard not available', 'NotAllowedError')); },
};
window.navigator.mediaDevices = {
  getUserMedia: function() {
    __dz_warnOnce('navigator.mediaDevices.getUserMedia() not available in stage-runtime');
    return Promise.reject(new DOMException('Not supported', 'NotSupportedError'));
  },
  enumerateDevices: function() { return Promise.resolve([]); },
  getDisplayMedia: function() { return Promise.reject(new DOMException('Not supported', 'NotSupportedError')); },
};
window.navigator.sendBeacon = function() { return false; };
window.navigator.vibrate = function() { return false; };
window.navigator.getBattery = function() {
  return Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1.0, addEventListener: function() {} });
};

// --- PerformanceObserver ---
if (typeof globalThis.PerformanceObserver === 'undefined') {
  globalThis.PerformanceObserver = function PerformanceObserver(callback) {
    this._callback = callback;
  };
  PerformanceObserver.prototype.observe = function() {};
  PerformanceObserver.prototype.disconnect = function() {};
  PerformanceObserver.prototype.takeRecords = function() { return []; };
  PerformanceObserver.supportedEntryTypes = ['mark', 'measure', 'navigation', 'resource'];
}

// --- performance.mark / performance.measure ---
(function() {
  var marks = {};
  if (!window.performance.mark) {
    window.performance.mark = function(name) {
      marks[name] = performance.now();
      return { name: name, startTime: marks[name], entryType: 'mark', duration: 0 };
    };
  }
  if (!window.performance.measure) {
    window.performance.measure = function(name, startMark, endMark) {
      var start = startMark && marks[startMark] ? marks[startMark] : 0;
      var end = endMark && marks[endMark] ? marks[endMark] : performance.now();
      return { name: name, startTime: start, entryType: 'measure', duration: end - start };
    };
  }
  if (!window.performance.getEntriesByName) {
    window.performance.getEntriesByName = function() { return []; };
  }
  if (!window.performance.getEntriesByType) {
    window.performance.getEntriesByType = function() { return []; };
  }
  if (!window.performance.clearMarks) {
    window.performance.clearMarks = function(name) { if (name) delete marks[name]; else marks = {}; };
  }
  if (!window.performance.clearMeasures) {
    window.performance.clearMeasures = function() {};
  }
})();

// --- OffscreenCanvas ---
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = function OffscreenCanvas(width, height) {
    this.width = width;
    this.height = height;
    this._contexts = {};
  };
  OffscreenCanvas.prototype.getContext = function(type) {
    if (this._contexts[type]) return this._contexts[type];
    if (type === '2d' && globalThis.__dz_create_canvas2d) {
      this._contexts[type] = globalThis.__dz_create_canvas2d(this);
      return this._contexts[type];
    }
    if ((type === 'webgl2' || type === 'webgl') && globalThis.__dz_create_webgl2) {
      this._contexts[type] = globalThis.__dz_create_webgl2(this);
      return this._contexts[type];
    }
    __dz_warnOnce('OffscreenCanvas.getContext("' + type + '") not available');
    return null;
  };
  OffscreenCanvas.prototype.convertToBlob = function(options) {
    __dz_warnOnce('OffscreenCanvas.convertToBlob() not yet implemented');
    return Promise.resolve(new Blob([], { type: 'image/png' }));
  };
  OffscreenCanvas.prototype.transferToImageBitmap = function() {
    return { width: this.width, height: this.height, close: function() {} };
  };
}

// --- ImageBitmap / createImageBitmap ---
if (typeof globalThis.ImageBitmap === 'undefined') {
  globalThis.ImageBitmap = function ImageBitmap(w, h) {
    this.width = w || 0;
    this.height = h || 0;
  };
  ImageBitmap.prototype.close = function() {};
}
if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = function(source) {
    var w = source.width || 0;
    var h = source.height || 0;
    return Promise.resolve(new ImageBitmap(w, h));
  };
}

// --- Math polyfills (V8 has these, but ensure completeness) ---
// V8 provides Math natively, nothing needed.

// --- atob / btoa ---
if (typeof globalThis.atob === 'undefined') {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  globalThis.btoa = function(str) {
    let output = '';
    for (let i = 0; i < str.length; i += 3) {
      const a = str.charCodeAt(i);
      const b = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      const c = i + 2 < str.length ? str.charCodeAt(i + 2) : 0;
      output += chars[a >> 2] + chars[((a & 3) << 4) | (b >> 4)];
      output += i + 1 < str.length ? chars[((b & 15) << 2) | (c >> 6)] : '=';
      output += i + 2 < str.length ? chars[c & 63] : '=';
    }
    return output;
  };
  globalThis.atob = function(str) {
    let output = '';
    str = str.replace(/=+$/, '');
    for (let i = 0; i < str.length; i += 4) {
      const a = chars.indexOf(str[i]);
      const b = chars.indexOf(str[i + 1]);
      const c = chars.indexOf(str[i + 2]);
      const d = chars.indexOf(str[i + 3]);
      output += String.fromCharCode((a << 2) | (b >> 4));
      if (c !== -1) output += String.fromCharCode(((b & 15) << 4) | (c >> 2));
      if (d !== -1) output += String.fromCharCode(((c & 3) << 6) | d);
    }
    return output;
  };
}

// --- DOMParser ---
if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = function DOMParser() {};
  DOMParser.prototype.parseFromString = function(markup, type) {
    // Returns a minimal document-like object with parsed HTML
    var doc = {
      nodeType: 9, nodeName: '#document',
      documentElement: null, body: null, head: null,
      querySelector: function(sel) { return doc.body ? doc.body.querySelector(sel) : null; },
      querySelectorAll: function(sel) { return doc.body ? doc.body.querySelectorAll(sel) : []; },
      getElementById: function(id) { return null; },
      getElementsByTagName: function(tag) { return doc.body ? doc.body.getElementsByTagName(tag) : []; },
    };
    // Reuse the document.createElement infrastructure
    doc.body = document.createElement('body');
    doc.documentElement = doc.body;
    if (markup) doc.body.innerHTML = markup;
    return doc;
  };
}

// --- XMLSerializer ---
if (typeof globalThis.XMLSerializer === 'undefined') {
  globalThis.XMLSerializer = function XMLSerializer() {};
  XMLSerializer.prototype.serializeToString = function(node) {
    if (node.outerHTML) return node.outerHTML;
    if (node._innerHTML) return node._innerHTML;
    if (node.textContent) return node.textContent;
    return '';
  };
}

// --- SVG namespace support for createElementNS ---
// Elements created with SVG namespace get the correct namespaceURI
(function() {
  var origCreateElementNS = document.createElementNS;
  document.createElementNS = function(ns, tag) {
    var el = document.createElement(tag);
    if (ns === 'http://www.w3.org/2000/svg') {
      el.namespaceURI = ns;
    }
    return el;
  };
})();

// --- Fire initial resize event after polyfills are set up ---
// Content that listens for 'resize' on window gets the initial dimensions
(function() {
  // Defer so user scripts can register listeners first
  setTimeout(function() {
    window.dispatchEvent(new Event('resize'));
  }, 0);
  // Also fire 'load' and 'DOMContentLoaded'
  setTimeout(function() {
    window.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));
  }, 0);
})();

// --- Page navigation reset: called from Rust during Page.navigate to clear accumulated state ---
globalThis.__dz_reset_page_state = function() {
  // Clear global state
  globalThis.__dz_html_dirty = false;
  // Clear animation state (exposed on globalThis by the animation IIFE)
  if (typeof __dz_keyframeRules !== 'undefined') {
    for (var k in __dz_keyframeRules) delete __dz_keyframeRules[k];
  }
  if (typeof __dz_activeAnimations !== 'undefined') __dz_activeAnimations.length = 0;
  // Call all registered reset hooks (from closure-scoped IIFEs)
  for (var i = 0; i < __dz_reset_hooks.length; i++) {
    try { __dz_reset_hooks[i](); } catch(e) {}
  }
};

// NOTE: Freezing of __dz_* internals and browser globals is done from Rust
// (via __dz_freeze_internals) AFTER all polyfill scripts are loaded, so that
// canvas2d.js/webgl2.js/audio.js can still register reset hooks during init.
globalThis.__dz_freeze_internals = function() {
  // Bindings that Rust/JS must mutate at runtime — freeze the binding (can't reassign)
  // but do NOT deep-freeze the value (contents must remain mutable).
  // - Primitives: __dz_html_dirty, __dz_perf_now (reassigned by Rust each frame)
  // - Message queues: arrays that JS pushes to and Rust drains each tick
  // - Registries: objects that polyfill IIFEs mutate internally
  var mutableBindings = {
    '__dz_html_dirty': true, '__dz_perf_now': true,
    '__dz_audio_cmds': true, '__dz_fetch_requests': true,
    '__dz_ws_requests': true, '__dz_image_loads': true,
    '__dz_image_registry': true, '__dz_ws_registry': true,
    '__dz_localstorage_data': true, '__dz_webgl_errors': true,
    '__dz_keyframeRules': true, '__dz_activeAnimations': true,
    '__dz_activeTransitions': true, '__dz_cssAnimationRules': true,
    '__dz_dom_cmds': true,
    '__dz_layout_rects': true,
  };

  Object.keys(globalThis).forEach(function(k) {
    if (k.startsWith('__dz_')) {
      var v = globalThis[k];
      if (typeof v === 'function' || (typeof v === 'object' && v !== null)) {
        // Deep-freeze the object contents so user JS can't mutate internals
        // (e.g., __dz_raf.process = function(){} or __dz_reset_hooks.length = 0)
        if (!mutableBindings[k]) {
          try { Object.freeze(v); } catch (e) {}
        }
        try {
          Object.defineProperty(globalThis, k, { writable: false, configurable: false });
        } catch (e) { /* already non-configurable */ }
      }
    }
  });

  // Freeze browser globals that control the frame clock or polyfill dispatch.
  // user JS overriding performance.now would desync the entire timer system.
  try { Object.freeze(window.performance); } catch(e) {}
  try { Object.freeze(window.location); } catch(e) {}
  try { Object.freeze(window.navigator); } catch(e) {}
  try { Object.freeze(window.screen); } catch(e) {}
  try { Object.defineProperty(globalThis, 'console', { writable: false, configurable: false }); } catch(e) {}
};
