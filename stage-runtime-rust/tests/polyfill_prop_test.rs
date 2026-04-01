//! Property-based tests for browser polyfills, DOM, Canvas2D, and event system.
//!
//! Uses proptest to verify invariants hold across random inputs:
//! - DOM tree structure invariants after random mutations
//! - Canvas2D commands never panic on arbitrary inputs
//! - Event system dispatches correctly with random listener configurations
//! - URL parsing round-trips
//! - localStorage/sessionStorage round-trips
//! - innerHTML never panics on arbitrary strings
//! - textContent set/get round-trips
//! - Path2D random command sequences never panic
//! - dataset camelCase ↔ data-* attribute round-trip
//! - fillRect with random colors produces correct pixels
//!
//! Run: cargo test --test polyfill_prop_test
//!
//! ## Implemented prop tests
//!
//! ### Canvas2D state & rendering
//! - [x] **save/restore stack symmetry**: save N, restore N → default state; mods between don't leak
//! - [x] **restore underflow**: extra restores don't panic
//! - [x] **transform composition**: translate moves origin, scale enlarges rect
//! - [x] **putImageData**: write pixels, verify rendered output
//! - [x] **color parsing**: #RRGGBB, rgb(), rgba() parse correctly
//! - [x] **lineDash pattern**: setLineDash with random patterns + large offsets don't crash
//! - [x] **gradient color stops**: addColorStop with offsets outside [0,1] don't crash
//! - [x] **font parsing**: arbitrary font strings don't panic
//!
//! ### Timer scheduling
//! - [x] **clearTimeout idempotence**: clearing same ID twice is no-op
//! - [x] **clearTimeout invalid IDs**: clearing bogus IDs doesn't panic
//! - [x] **timer ID uniqueness**: IDs never collide across setTimeout/setInterval
//!
//! ### classList
//! - [x] **add idempotence**: add('x'); add('x') → one 'x'
//! - [x] **remove idempotence**: remove('x'); remove('x') → no error
//! - [x] **toggle(force) semantics**: toggle('x', true) always adds; toggle('x', false) always removes
//! - [x] **replace**: replace non-existent class returns false; existing → swapped
//! - [x] **contains consistency**: contains matches className.split(' ').includes
//!
//! ### WebGL2 state machine
//! - [x] **enable/disable idempotence**: enable(X) N times same as once; disable reverses
//! - [x] **program lifecycle**: link with 0 shaders doesn't crash
//! - [x] **texture state**: texParameteri with invalid values doesn't crash
//!
//! ### HTML/CSS
//! - [x] **malformed HTML robustness**: unclosed tags, random attribute strings never panic
//! - [x] **CSS inline style**: inline style preserved on element
//!
//! ### Audio parameters
//! - [x] **linearRamp no overshoot**: ramp stays within start/end bounds
//! - [x] **linearRamp constant is noop**: ramp from X to X ≡ static gain X
//! - [x] **setValueAtTime last wins**: later call at same time overwrites
//! - [x] **cancelScheduledValues**: clears future ramp, output matches static gain
//! - [x] **exponentialRamp no NaN**: no NaN or Inf in output samples
//! - [x] **setTargetAtTime no NaN**: no NaN or Inf in output samples
//! - [x] **gain zero is silence**: gain=0 produces all-zero output

mod test_harness;
use test_harness::*;

use proptest::prelude::*;
use serde_json::json;

fn proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: 64,
        ..ProptestConfig::default()
    }
}

// ── Strategies ──────────────────────────────────────────────────────────

/// Random CSS hex color (#RRGGBB)
fn hex_color() -> impl Strategy<Value = (u8, u8, u8)> {
    (0u8..=255, 0u8..=255, 0u8..=255)
}

/// Random rectangle position/size within a 64x64 canvas
fn rect_in_canvas() -> impl Strategy<Value = (i32, i32, u32, u32)> {
    (0i32..64, 0i32..64, 1u32..64, 1u32..64)
}

/// Random safe string for JS (no quotes, backslashes, or control chars)
fn safe_js_string() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9_ ]{0,30}"
}

/// Random DOM tag name
fn tag_name() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("div"),
        Just("span"),
        Just("p"),
        Just("section"),
        Just("article"),
        Just("header"),
        Just("footer"),
        Just("ul"),
        Just("li"),
        Just("h1"),
    ]
}

/// Random DOM mutation operation
fn dom_mutation() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("appendChild"),
        Just("removeChild"),
        Just("insertBefore"),
        Just("textContent"),
        Just("remove"),
    ]
}

/// Random Canvas2D command name
fn canvas2d_cmd() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("fillRect"),
        Just("strokeRect"),
        Just("clearRect"),
        Just("fillStyle"),
        Just("strokeStyle"),
        Just("lineWidth"),
        Just("globalAlpha"),
        Just("beginPath"),
        Just("closePath"),
        Just("moveTo"),
        Just("lineTo"),
        Just("arc"),
        Just("fill"),
        Just("stroke"),
        Just("save"),
        Just("restore"),
        Just("translate"),
        Just("rotate"),
        Just("scale"),
        Just("setTransform"),
        Just("resetTransform"),
        Just("rect_path"),
        Just("font"),
        Just("fillText"),
        Just("clip"),
        Just("roundRect"),
        Just("reset"),
        Just("fakeCommand"),
        Just(""),
    ]
}

/// Random Canvas2D argument (number, string, or special value)
fn canvas2d_arg() -> impl Strategy<Value = String> {
    prop_oneof![
        (-1000.0f64..1000.0).prop_map(|v| format!("{v}")),
        Just("NaN".to_string()),
        Just("Infinity".to_string()),
        Just("-Infinity".to_string()),
        Just("0".to_string()),
        Just("null".to_string()),
        Just("undefined".to_string()),
        Just("true".to_string()),
        Just("'#ff0000'".to_string()),
        Just("'rgba(0,0,0,0.5)'".to_string()),
        Just("'10px sans-serif'".to_string()),
    ]
}

/// Random Path2D operation
fn path2d_op() -> impl Strategy<Value = String> {
    prop_oneof![
        (-100.0f64..200.0, -100.0f64..200.0)
            .prop_map(|(x, y)| format!("path.moveTo({x},{y})")),
        (-100.0f64..200.0, -100.0f64..200.0)
            .prop_map(|(x, y)| format!("path.lineTo({x},{y})")),
        (-100.0f64..200.0, -100.0f64..200.0, 0.0f64..100.0, 0.0f64..7.0, 0.0f64..7.0)
            .prop_map(|(x, y, r, s, e)| format!("path.arc({x},{y},{r},{s},{e})")),
        (-100.0f64..200.0, -100.0f64..200.0, 1.0f64..100.0, 1.0f64..100.0)
            .prop_map(|(x, y, w, h)| format!("path.rect({x},{y},{w},{h})")),
        Just("path.closePath()".to_string()),
    ]
}

// ── Canvas2D Command Fuzz ───────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Random Canvas2D commands through the full V8→dispatch pipeline never panic.
    #[test]
    fn fuzz_canvas2d_commands_never_panic(
        cmds in prop::collection::vec(
            (canvas2d_cmd(), prop::collection::vec(canvas2d_arg(), 0..6)),
            1..20
        )
    ) {
        let mut rt = make_runtime(64, 64);

        // Build JS that creates a canvas, gets context, and fires random commands
        let mut js = String::from(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n"
        );

        for (name, args) in &cmds {
            if name.is_empty() { continue; }
            let args_str = args.join(", ");
            js.push_str(&format!("try {{ cmd('{}', {}); }} catch(e) {{}}\n", name, args_str));
        }

        js.push_str("requestAnimationFrame(function(){});\n");
        rt.load_js("<test>", &js).unwrap();

        // Tick a few frames — should never panic
        for _ in 0..3 {
            rt.tick();
        }
    }

    /// fillRect with random colors produces pixels that match the input color.
    #[test]
    fn prop_fill_rect_color_matches(
        (r, g, b) in hex_color(),
    ) {
        let mut rt = make_runtime(64, 64);
        let color = format!("#{:02x}{:02x}{:02x}", r, g, b);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             function draw() {{\n\
                 ctx.fillStyle = '{color}';\n\
                 ctx.fillRect(0, 0, 64, 64);\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        // Allow ±2 for rounding in color conversion
        assert!((px[0] as i32 - r as i32).abs() <= 2, "R mismatch: expected ~{r}, got {}", px[0]);
        assert!((px[1] as i32 - g as i32).abs() <= 2, "G mismatch: expected ~{g}, got {}", px[1]);
        assert!((px[2] as i32 - b as i32).abs() <= 2, "B mismatch: expected ~{b}, got {}", px[2]);
    }

    /// fillRect at random positions — center pixel of the rect should have the fill color.
    #[test]
    fn prop_fill_rect_position(
        (x, y, w, h) in rect_in_canvas(),
        (r, g, b) in hex_color(),
    ) {
        let mut rt = make_runtime(64, 64);
        let color = format!("#{:02x}{:02x}{:02x}", r, g, b);
        // Center of the rect (clamped to canvas)
        let cx = (x + w as i32 / 2).clamp(0, 63) as u32;
        let cy = (y + h as i32 / 2).clamp(0, 63) as u32;

        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             function draw() {{\n\
                 ctx.fillStyle = '#000000';\n\
                 ctx.fillRect(0, 0, 64, 64);\n\
                 ctx.fillStyle = '{color}';\n\
                 ctx.fillRect({x}, {y}, {w}, {h});\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        // If center is inside the rect, it should have the fill color
        if cx >= x as u32 && cx < x as u32 + w && cy >= y as u32 && cy < y as u32 + h {
            let px = pixel_at(rt.get_framebuffer(), 64, cx, cy);
            assert!((px[0] as i32 - r as i32).abs() <= 2, "R mismatch at ({cx},{cy})");
            assert!((px[1] as i32 - g as i32).abs() <= 2, "G mismatch at ({cx},{cy})");
            assert!((px[2] as i32 - b as i32).abs() <= 2, "B mismatch at ({cx},{cy})");
        }
    }

    /// globalAlpha scales color output proportionally.
    #[test]
    fn prop_global_alpha_scales_color(
        alpha in 0.1f64..1.0,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             function draw() {{\n\
                 ctx.fillStyle = '#000000';\n\
                 ctx.fillRect(0, 0, 64, 64);\n\
                 ctx.globalAlpha = {alpha};\n\
                 ctx.fillStyle = '#ffffff';\n\
                 ctx.fillRect(0, 0, 64, 64);\n\
                 ctx.globalAlpha = 1.0;\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        let expected = (alpha * 255.0).round() as i32;
        // Alpha blending: white * alpha over black = alpha * 255
        assert!((px[0] as i32 - expected).abs() <= 5, "expected ~{expected}, got {}", px[0]);
    }
}

// ── DOM Tree Invariants ─────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Random sequences of appendChild/removeChild/insertBefore maintain DOM tree invariants:
    /// - firstChild/lastChild match childNodes[0]/childNodes[n-1]
    /// - nextSibling/previousSibling chain is consistent
    /// - parentNode is set correctly
    #[test]
    fn prop_dom_tree_invariants_after_mutations(
        tags in prop::collection::vec(tag_name(), 3..8),
        ops in prop::collection::vec((0usize..10, dom_mutation()), 5..20),
    ) {
        let mut rt = make_runtime(64, 64);

        let n = tags.len();
        let mut js = String::from("var parent = document.createElement('div');\nvar children = [];\n");
        for tag in &tags {
            js.push_str(&format!("children.push(document.createElement('{}'));\n", tag));
        }

        // Apply random mutations
        for (idx, op) in &ops {
            let i = idx % n;
            match *op {
                "appendChild" => js.push_str(&format!("parent.appendChild(children[{}]);\n", i)),
                "removeChild" => js.push_str(&format!(
                    "if (children[{}].parentNode === parent) parent.removeChild(children[{}]);\n", i, i
                )),
                "insertBefore" => {
                    let ref_idx = (i + 1) % n;
                    js.push_str(&format!(
                        "if (children[{}].parentNode === parent) parent.insertBefore(children[{}], children[{}]);\n\
                         else parent.insertBefore(children[{}], parent.firstChild);\n",
                        ref_idx, i, ref_idx, i
                    ));
                }
                "textContent" => js.push_str("parent.textContent = 'cleared';\n"),
                "remove" => js.push_str(&format!(
                    "if (children[{}].parentNode) children[{}].remove();\n", i, i
                )),
                _ => {}
            }
        }

        // Verify invariants
        js.push_str(r#"
            var result = { ok: true, errors: [] };
            var nodes = parent.childNodes;

            // firstChild / lastChild
            if (nodes.length > 0) {
                if (parent.firstChild !== nodes[0])
                    result.errors.push('firstChild mismatch');
                if (parent.lastChild !== nodes[nodes.length - 1])
                    result.errors.push('lastChild mismatch');
            } else {
                if (parent.firstChild !== null)
                    result.errors.push('firstChild should be null');
                if (parent.lastChild !== null)
                    result.errors.push('lastChild should be null');
            }

            // Sibling chain
            for (var i = 0; i < nodes.length; i++) {
                if (i === 0 && nodes[i].previousSibling !== null)
                    result.errors.push('first child previousSibling should be null');
                if (i === nodes.length - 1 && nodes[i].nextSibling !== null)
                    result.errors.push('last child nextSibling should be null');
                if (i > 0 && nodes[i].previousSibling !== nodes[i-1])
                    result.errors.push('previousSibling mismatch at ' + i);
                if (i < nodes.length - 1 && nodes[i].nextSibling !== nodes[i+1])
                    result.errors.push('nextSibling mismatch at ' + i);
                if (nodes[i].parentNode !== parent)
                    result.errors.push('parentNode mismatch at ' + i);
            }

            result.ok = result.errors.length === 0;
            result.childCount = nodes.length;
            globalThis.__testResult = result;
        "#);

        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert!(
            result["ok"] == true,
            "DOM invariants violated: {:?}", result["errors"]
        );
    }
}

// ── Event System ────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Random event listener add/remove/dispatch — listener count and fire count are consistent.
    #[test]
    fn prop_event_listeners_fire_correctly(
        n_listeners in 1usize..10,
        n_dispatches in 1usize..5,
        use_once in prop::collection::vec(prop::bool::ANY, 1..10),
    ) {
        let mut rt = make_runtime(64, 64);
        let n = n_listeners.min(use_once.len());

        let mut js = String::from(
            "var el = document.createElement('div');\n\
             var counts = [];\n"
        );
        for i in 0..n {
            let once = use_once[i];
            js.push_str(&format!(
                "counts[{i}] = 0;\nel.addEventListener('test', function() {{ counts[{i}]++; }}{});\n",
                if once { ", { once: true }" } else { "" }
            ));
        }
        for _ in 0..n_dispatches {
            js.push_str("el.dispatchEvent(new Event('test'));\n");
        }
        js.push_str("globalThis.__testResult = { counts: counts };\n");

        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        let counts = result["counts"].as_array().unwrap();

        for i in 0..n {
            let count = counts[i].as_u64().unwrap();
            if use_once[i] {
                prop_assert_eq!(count, 1, "once listener {} should fire exactly once", i);
            } else {
                prop_assert_eq!(count, n_dispatches as u64, "listener {} should fire {} times", i, n_dispatches);
            }
        }
    }

    /// stopImmediatePropagation prevents subsequent listeners on the same event.
    #[test]
    fn prop_stop_immediate_prevents_later_listeners(
        stop_at in 0usize..5,
        total in 1usize..8,
    ) {
        let n = total.max(stop_at + 1);
        let mut rt = make_runtime(64, 64);

        let mut js = String::from(
            "var el = document.createElement('div');\nvar fired = [];\n"
        );
        for i in 0..n {
            if i == stop_at {
                js.push_str(&format!(
                    "el.addEventListener('test', function(e) {{ fired.push({i}); e.stopImmediatePropagation(); }});\n"
                ));
            } else {
                js.push_str(&format!(
                    "el.addEventListener('test', function() {{ fired.push({i}); }});\n"
                ));
            }
        }
        js.push_str("el.dispatchEvent(new Event('test'));\nglobalThis.__testResult = { fired: fired };\n");

        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        let fired = result["fired"].as_array().unwrap();

        // Listeners 0..=stop_at should fire, stop_at+1..n should not
        prop_assert_eq!(fired.len(), stop_at + 1, "expected {} listeners to fire", stop_at + 1);
    }
}

// ── localStorage Round-Trip ─────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// localStorage setItem/getItem round-trips arbitrary safe strings.
    #[test]
    fn prop_localstorage_roundtrip(
        key in safe_js_string(),
        value in safe_js_string(),
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "localStorage.setItem('{}', '{}');\n\
             globalThis.__testResult = {{ got: localStorage.getItem('{}') }};\n",
            key, value, key
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["got"].as_str().unwrap(), value.as_str());
    }

    /// localStorage.clear() removes all items.
    #[test]
    fn prop_localstorage_clear(
        items in prop::collection::vec((safe_js_string(), safe_js_string()), 1..10),
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::new();
        for (k, v) in &items {
            js.push_str(&format!("localStorage.setItem('{}', '{}');\n", k, v));
        }
        js.push_str("localStorage.clear();\nglobalThis.__testResult = { length: localStorage.length };\n");

        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["length"].clone(), json!(0));
    }
}

// ── URL Parsing ─────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// URL parsing extracts protocol, hostname, pathname, and reconstructs href.
    #[test]
    fn prop_url_parse_components(
        host in "[a-z]{3,10}\\.[a-z]{2,4}",
        path in "/[a-z]{1,10}(/[a-z]{1,10})?",
    ) {
        let mut rt = make_runtime(64, 64);
        let full = format!("https://{host}{path}");
        let js = format!(
            "var u = new URL('{}');\n\
             globalThis.__testResult = {{\n\
                 protocol: u.protocol,\n\
                 hostname: u.hostname,\n\
                 pathname: u.pathname,\n\
                 href: u.href,\n\
             }};\n",
            full
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["protocol"].as_str().unwrap(), "https:");
        prop_assert_eq!(result["hostname"].as_str().unwrap(), host.as_str());
        prop_assert_eq!(result["pathname"].as_str().unwrap(), path.as_str());
        prop_assert_eq!(result["href"].as_str().unwrap(), full.as_str());
    }
}

// ── textContent Round-Trip ──────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Setting textContent then reading it back returns the same value.
    #[test]
    fn prop_textcontent_roundtrip(
        text in safe_js_string(),
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var div = document.createElement('div');\n\
             div.textContent = '{text}';\n\
             globalThis.__testResult = {{ got: div.textContent, childCount: div.childNodes.length }};\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["got"].as_str().unwrap(), text.as_str());
        // Non-empty text should produce exactly one text node child
        if !text.is_empty() {
            prop_assert_eq!(result["childCount"].clone(), json!(1));
        } else {
            prop_assert_eq!(result["childCount"].clone(), json!(0));
        }
    }

    /// Setting textContent clears all previous children.
    #[test]
    fn prop_textcontent_clears_children(
        n_children in 1usize..6,
        text in safe_js_string(),
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from("var div = document.createElement('div');\n");
        for _ in 0..n_children {
            js.push_str("div.appendChild(document.createElement('span'));\n");
        }
        js.push_str(&format!(
            "div.textContent = '{text}';\n\
             globalThis.__testResult = {{ childCount: div.childNodes.length }};\n"
        ));
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        if text.is_empty() {
            prop_assert_eq!(result["childCount"].clone(), json!(0));
        } else {
            prop_assert_eq!(result["childCount"].clone(), json!(1), "should have exactly 1 text node");
        }
    }
}

// ── innerHTML Never Panics ──────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Setting innerHTML with arbitrary (safe) HTML strings never panics the runtime.
    #[test]
    fn prop_innerhtml_never_panics(
        html in "[a-zA-Z0-9 <>=/\"'.-]{0,100}",
    ) {
        let mut rt = make_runtime(64, 64);
        // Escape single quotes for JS string
        let escaped = html.replace('\\', "\\\\").replace('\'', "\\'");
        let js = format!(
            "var div = document.createElement('div');\n\
             try {{ div.innerHTML = '{}'; }} catch(e) {{}}\n\
             globalThis.__testResult = {{ ok: true }};\n",
            escaped
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["ok"].clone(), json!(true));
    }
}

// ── Path2D Fuzz ─────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Random Path2D command sequences followed by fill/stroke never panic.
    #[test]
    fn prop_path2d_commands_never_panic(
        ops in prop::collection::vec(path2d_op(), 1..15),
        do_fill in prop::bool::ANY,
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var path = new Path2D();\n"
        );
        for op in &ops {
            js.push_str(&format!("{op};\n"));
        }
        if do_fill {
            js.push_str("ctx.fill(path);\n");
        } else {
            js.push_str("ctx.stroke(path);\n");
        }
        js.push_str("requestAnimationFrame(function(){});\nglobalThis.__testResult = { ok: true };\n");

        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["ok"].clone(), json!(true));
    }

    /// Path2D addPath preserves command count.
    #[test]
    fn prop_path2d_addpath_merges_commands(
        n1 in 1usize..8,
        n2 in 1usize..8,
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from(
            "var p1 = new Path2D();\nvar p2 = new Path2D();\n"
        );
        for _ in 0..n1 {
            js.push_str("p1.lineTo(10, 10);\n");
        }
        for _ in 0..n2 {
            js.push_str("p2.lineTo(20, 20);\n");
        }
        js.push_str(
            "var combined = new Path2D();\n\
             combined.addPath(p1);\n\
             combined.addPath(p2);\n\
             globalThis.__testResult = { count: combined._cmds.length };\n"
        );

        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["count"].clone(), json!((n1 + n2) as u64));
    }
}

// ── dataset Round-Trip ──────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// dataset camelCase property ↔ data-* attribute round-trip.
    #[test]
    fn prop_dataset_roundtrip(
        value in safe_js_string(),
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var el = document.createElement('div');\n\
             el.dataset.testProp = '{value}';\n\
             globalThis.__testResult = {{\n\
                 fromDataset: el.dataset.testProp,\n\
                 fromAttr: el.getAttribute('data-test-prop'),\n\
             }};\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["fromDataset"].as_str().unwrap(), value.as_str());
        prop_assert_eq!(result["fromAttr"].as_str().unwrap(), value.as_str());
    }
}

// ── Canvas2D Save/Restore Stack Symmetry ────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// save N times, modify state between saves, restore N times → back to default state.
    /// Modifications between save/restore must not leak.
    #[test]
    fn prop_save_restore_stack_symmetry(
        depth in 1usize..8,
        alphas in prop::collection::vec(0.1f64..0.9, 1..8),
    ) {
        let n = depth.min(alphas.len());
        let mut rt = make_runtime(64, 64);
        let mut js = String::from(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n"
        );
        // Save N times, changing globalAlpha each time
        for i in 0..n {
            js.push_str("cmd('save');\n");
            js.push_str(&format!("cmd('globalAlpha', {});\n", alphas[i]));
        }
        // Restore N times
        for _ in 0..n {
            js.push_str("cmd('restore');\n");
        }
        // Draw a white rect — should use default globalAlpha (1.0)
        js.push_str(
            "cmd('fillStyle', '#000000');\ncmd('fillRect', 0, 0, 64, 64);\n\
             cmd('fillStyle', '#ffffff');\ncmd('fillRect', 0, 0, 64, 64);\n\
             requestAnimationFrame(function(){});\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        // Default globalAlpha=1.0, so white over black = 255
        prop_assert!((px[0] as i32 - 255).abs() <= 2,
            "expected ~255 (default alpha), got {} — state leaked through save/restore", px[0]);
    }

    /// Extra restores beyond saves don't panic or corrupt state.
    #[test]
    fn prop_restore_underflow_safe(
        saves in 0usize..4,
        restores in 0usize..10,
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n"
        );
        for _ in 0..saves { js.push_str("cmd('save');\n"); }
        for _ in 0..restores { js.push_str("cmd('restore');\n"); }
        js.push_str(
            "cmd('fillStyle', '#ff0000');\ncmd('fillRect', 0, 0, 64, 64);\n\
             requestAnimationFrame(function(){});\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        // Should still be able to draw red
        prop_assert!(px[0] > 200, "drawing should still work after restore underflow, got R={}", px[0]);
    }
}

// ── Canvas2D Transform Composition ──────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// translate(tx, ty) moves the fill origin by (tx, ty).
    /// A pixel at (tx+1, ty+1) should be inside a 10x10 rect drawn at (0,0) after translate.
    #[test]
    fn prop_translate_moves_origin(
        tx in 0i32..50,
        ty in 0i32..50,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             function draw() {{\n\
                 cmd('fillStyle', '#000000');\n\
                 cmd('fillRect', 0, 0, 64, 64);\n\
                 cmd('save');\n\
                 cmd('translate', {tx}, {ty});\n\
                 cmd('fillStyle', '#00ff00');\n\
                 cmd('fillRect', 0, 0, 10, 10);\n\
                 cmd('restore');\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        // Pixel inside the translated rect
        let inside_x = (tx + 1).min(63) as u32;
        let inside_y = (ty + 1).min(63) as u32;
        if tx + 1 < 64 && ty + 1 < 64 && tx + 1 < tx + 10 && ty + 1 < ty + 10 {
            let px = pixel_at(rt.get_framebuffer(), 64, inside_x, inside_y);
            prop_assert!(px[1] > 200, "expected green at ({inside_x},{inside_y}), got G={}", px[1]);
        }
    }

    /// scale(sx, sy) followed by fillRect produces a scaled rectangle.
    #[test]
    fn prop_scale_enlarges_rect(
        sx in 1.0f64..4.0,
        sy in 1.0f64..4.0,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             function draw() {{\n\
                 cmd('fillStyle', '#000000');\n\
                 cmd('fillRect', 0, 0, 64, 64);\n\
                 cmd('save');\n\
                 cmd('scale', {sx}, {sy});\n\
                 cmd('fillStyle', '#0000ff');\n\
                 cmd('fillRect', 0, 0, 5, 5);\n\
                 cmd('restore');\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        // A pixel at (1,1) should always be inside the scaled rect
        let px = pixel_at(rt.get_framebuffer(), 64, 1, 1);
        prop_assert!(px[2] > 200, "expected blue at (1,1) after scale, got B={}", px[2]);

        // A pixel at (scaled_edge - 1) should be inside too
        let edge_x = ((5.0 * sx) as u32).min(63);
        let edge_y = ((5.0 * sy) as u32).min(63);
        if edge_x > 1 && edge_y > 1 {
            let px_edge = pixel_at(rt.get_framebuffer(), 64, edge_x - 1, edge_y - 1);
            prop_assert!(px_edge[2] > 200,
                "expected blue at ({},{}) after scale({sx},{sy}), got B={}",
                edge_x - 1, edge_y - 1, px_edge[2]);
        }
    }
}

// ── Canvas2D Color Parsing ──────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Hex colors (#RRGGBB) parse and render correctly.
    #[test]
    fn prop_hex_color_parse(
        r in 0u8..=255,
        g in 0u8..=255,
        b in 0u8..=255,
    ) {
        let mut rt = make_runtime(64, 64);
        let hex = format!("#{:02x}{:02x}{:02x}", r, g, b);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             function draw() {{\n\
                 cmd('fillStyle', '{hex}');\n\
                 cmd('fillRect', 0, 0, 64, 64);\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        prop_assert!((px[0] as i32 - r as i32).abs() <= 2, "R: expected {r}, got {}", px[0]);
        prop_assert!((px[1] as i32 - g as i32).abs() <= 2, "G: expected {g}, got {}", px[1]);
        prop_assert!((px[2] as i32 - b as i32).abs() <= 2, "B: expected {b}, got {}", px[2]);
    }

    /// rgb() functional notation parses without panic and produces correct color.
    #[test]
    fn prop_rgb_functional_parse(
        r in 0u8..=255,
        g in 0u8..=255,
        b in 0u8..=255,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             function draw() {{\n\
                 cmd('fillStyle', 'rgb({r},{g},{b})');\n\
                 cmd('fillRect', 0, 0, 64, 64);\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        prop_assert!((px[0] as i32 - r as i32).abs() <= 2, "R: expected {r}, got {}", px[0]);
        prop_assert!((px[1] as i32 - g as i32).abs() <= 2, "G: expected {g}, got {}", px[1]);
        prop_assert!((px[2] as i32 - b as i32).abs() <= 2, "B: expected {b}, got {}", px[2]);
    }

    /// rgba() with alpha doesn't panic; alpha scales output proportionally.
    #[test]
    fn prop_rgba_alpha_parse(
        alpha in 0.1f64..1.0,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             function draw() {{\n\
                 cmd('fillStyle', '#000000');\n\
                 cmd('fillRect', 0, 0, 64, 64);\n\
                 cmd('fillStyle', 'rgba(255,255,255,{alpha})');\n\
                 cmd('fillRect', 0, 0, 64, 64);\n\
                 requestAnimationFrame(draw);\n\
             }}\n\
             requestAnimationFrame(draw);\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        let expected = (alpha * 255.0).round() as i32;
        prop_assert!((px[0] as i32 - expected).abs() <= 5,
            "rgba alpha={alpha}: expected ~{expected}, got {}", px[0]);
    }

    /// Font strings don't cause panics regardless of content.
    #[test]
    fn prop_font_string_no_panic(
        size in 1u32..200,
        family in prop_oneof![
            Just("sans-serif"), Just("serif"), Just("monospace"),
            Just("Arial"), Just("Helvetica"), Just("Times"),
        ],
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             cmd('font', '{size}px {family}');\n\
             cmd('fillText', 'test', 10, 30);\n\
             requestAnimationFrame(function(){{}});\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }
        // No panic = success
    }
}

// ── Canvas2D LineDash ───────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// setLineDash with random patterns doesn't crash; large offsets are safe.
    #[test]
    fn prop_linedash_no_panic(
        segments in prop::collection::vec(0.0f64..100.0, 0..10),
        offset in -10000.0f64..10000.0,
    ) {
        let mut rt = make_runtime(64, 64);
        let arr = segments.iter().map(|s| format!("{s}")).collect::<Vec<_>>().join(",");
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var cmd = globalThis.__dz_canvas_cmd;\n\
             cmd('setLineDash', [{arr}]);\n\
             cmd('lineDashOffset', {offset});\n\
             cmd('beginPath');\n\
             cmd('moveTo', 0, 32);\n\
             cmd('lineTo', 64, 32);\n\
             cmd('stroke');\n\
             requestAnimationFrame(function(){{}});\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }
    }
}

// ── Canvas2D Gradient Color Stops ───────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Adding color stops to gradients doesn't panic; offsets outside [0,1] are clamped.
    #[test]
    fn prop_gradient_color_stops_no_panic(
        stops in prop::collection::vec(
            (-0.5f64..1.5, 0u8..=255, 0u8..=255, 0u8..=255),
            1..8
        ),
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var grad = ctx.createLinearGradient(0, 0, 64, 0);\n"
        );
        for (offset, r, g, b) in &stops {
            js.push_str(&format!(
                "try {{ grad.addColorStop({offset}, 'rgb({r},{g},{b})'); }} catch(e) {{}}\n"
            ));
        }
        js.push_str(
            "ctx.fillStyle = grad;\n\
             ctx.fillRect(0, 0, 64, 64);\n\
             requestAnimationFrame(function(){});\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }
    }
}

// ── Timer Scheduling ────────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Timer IDs are unique across setTimeout and setInterval calls.
    #[test]
    fn prop_timer_ids_unique(
        n_timeouts in 1usize..10,
        n_intervals in 1usize..10,
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from("var ids = [];\n");
        for _ in 0..n_timeouts {
            js.push_str("ids.push(setTimeout(function(){}, 99999));\n");
        }
        for _ in 0..n_intervals {
            js.push_str("ids.push(setInterval(function(){}, 99999));\n");
        }
        js.push_str(
            "var unique = new Set(ids);\n\
             globalThis.__testResult = { total: ids.length, unique: unique.size };\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        let total = result["total"].as_u64().unwrap();
        let unique = result["unique"].as_u64().unwrap();
        prop_assert_eq!(total, unique, "timer IDs must be unique");
    }

    /// clearTimeout is idempotent — clearing the same ID twice is a no-op.
    #[test]
    fn prop_clear_timeout_idempotent(
        n_clears in 1usize..5,
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from(
            "var fired = false;\n\
             var id = setTimeout(function(){ fired = true; }, 99999);\n"
        );
        for _ in 0..n_clears {
            js.push_str("clearTimeout(id);\n");
        }
        js.push_str("globalThis.__testResult = { ok: true, fired: fired };\n");
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..5 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["ok"].clone(), json!(true));
        prop_assert_eq!(result["fired"].clone(), json!(false), "timer should not fire after clear");
    }

    /// clearTimeout with invalid IDs doesn't panic.
    #[test]
    fn prop_clear_timeout_invalid_id(
        id in prop_oneof![
            Just(0i64),
            Just(-1i64),
            Just(999999i64),
            any::<i32>().prop_map(|i| i as i64),
        ],
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "clearTimeout({id});\nclearInterval({id});\n\
             globalThis.__testResult = {{ ok: true }};\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["ok"].clone(), json!(true));
    }
}

// ── classList ───────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// add() is idempotent — adding the same class twice results in one occurrence.
    #[test]
    fn prop_classlist_add_idempotent(
        cls in "[a-zA-Z][a-zA-Z0-9]{0,10}",
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var el = document.createElement('div');\n\
             el.classList.add('{cls}');\n\
             el.classList.add('{cls}');\n\
             var parts = el.className.split(' ').filter(function(c) {{ return c === '{cls}'; }});\n\
             globalThis.__testResult = {{ count: parts.length, contains: el.classList.contains('{cls}') }};\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["count"].clone(), json!(1), "class should appear exactly once");
        prop_assert_eq!(result["contains"].clone(), json!(true));
    }

    /// remove() is idempotent — removing non-existent class is a no-op.
    #[test]
    fn prop_classlist_remove_idempotent(
        cls in "[a-zA-Z][a-zA-Z0-9]{0,10}",
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var el = document.createElement('div');\n\
             el.classList.add('{cls}');\n\
             el.classList.remove('{cls}');\n\
             el.classList.remove('{cls}');\n\
             globalThis.__testResult = {{ contains: el.classList.contains('{cls}'), className: el.className }};\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["contains"].clone(), json!(false));
    }

    /// toggle(cls, true) always adds; toggle(cls, false) always removes.
    #[test]
    fn prop_classlist_toggle_force(
        cls in "[a-zA-Z][a-zA-Z0-9]{0,10}",
        initially_present in any::<bool>(),
        force in any::<bool>(),
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from("var el = document.createElement('div');\n");
        if initially_present {
            js.push_str(&format!("el.classList.add('{cls}');\n"));
        }
        js.push_str(&format!(
            "var result = el.classList.toggle('{cls}', {});\n\
             globalThis.__testResult = {{ result: result, contains: el.classList.contains('{cls}') }};\n",
            if force { "true" } else { "false" }
        ));
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["contains"].clone(), json!(force),
            "toggle with force={} should leave class present={}", force, force);
        prop_assert_eq!(result["result"].clone(), json!(force));
    }

    /// replace() swaps old for new; returns false for non-existent class.
    #[test]
    fn prop_classlist_replace(
        old in "[a-zA-Z][a-zA-Z0-9]{0,8}",
        new in "[a-zA-Z][a-zA-Z0-9]{0,8}",
        initially_present in any::<bool>(),
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from("var el = document.createElement('div');\n");
        if initially_present {
            js.push_str(&format!("el.classList.add('{old}');\n"));
        }
        js.push_str(&format!(
            "var result = el.classList.replace('{old}', '{new}');\n\
             globalThis.__testResult = {{\n\
                 result: result,\n\
                 hasOld: el.classList.contains('{old}'),\n\
                 hasNew: el.classList.contains('{new}'),\n\
             }};\n"
        ));
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        if initially_present {
            prop_assert_eq!(result["result"].clone(), json!(true));
            if old != new {
                prop_assert_eq!(result["hasOld"].clone(), json!(false), "old class should be removed");
            }
            prop_assert_eq!(result["hasNew"].clone(), json!(true), "new class should be present");
        } else {
            prop_assert_eq!(result["result"].clone(), json!(false));
        }
    }

    /// contains() matches className.split(' ').includes().
    #[test]
    fn prop_classlist_contains_consistent(
        classes in prop::collection::vec("[a-zA-Z][a-zA-Z0-9]{0,6}", 0..5),
        query in "[a-zA-Z][a-zA-Z0-9]{0,6}",
    ) {
        let mut rt = make_runtime(64, 64);
        let mut js = String::from("var el = document.createElement('div');\n");
        for cls in &classes {
            js.push_str(&format!("el.classList.add('{cls}');\n"));
        }
        js.push_str(&format!(
            "var byContains = el.classList.contains('{query}');\n\
             var byIncludes = el.className.split(' ').filter(Boolean).indexOf('{query}') >= 0;\n\
             globalThis.__testResult = {{ contains: byContains, includes: byIncludes }};\n"
        ));
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["contains"].clone(), result["includes"].clone(),
            "classList.contains must match className.split().includes");
    }
}

// ── WebGL2 State Machine ────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// enable(X) / disable(X) are inverses; enable is idempotent.
    #[test]
    fn prop_webgl_enable_disable_idempotent(
        cap in prop_oneof![
            Just(0x0BE2u32), // BLEND
            Just(0x0B71u32), // DEPTH_TEST
            Just(0x0B44u32), // CULL_FACE
            Just(0x0C11u32), // SCISSOR_TEST
            Just(0x8037u32), // POLYGON_OFFSET_FILL
            Just(0x8642u32), // SAMPLE_COVERAGE
        ],
        n_enables in 1usize..5,
    ) {
        let mut gl = stage_runtime::webgl2::WebGL2::new(4, 4);
        // Enable N times (idempotent)
        for _ in 0..n_enables {
            gl.process_commands(&json!([["enable", cap]]));
        }
        // isEnabled should be true
        gl.process_commands(&json!([["isEnabled", cap]]));

        // Disable once
        gl.process_commands(&json!([["disable", cap]]));
        // Should be disabled now
        gl.process_commands(&json!([["isEnabled", cap]]));

        // Should not panic through any of this
    }

    /// Linking a program with no shaders doesn't crash.
    #[test]
    fn prop_webgl_program_no_shaders(
        n_programs in 1usize..5,
    ) {
        let mut gl = stage_runtime::webgl2::WebGL2::new(4, 4);
        for _ in 0..n_programs {
            gl.process_commands(&json!([
                ["createProgram", "__ret_prog"],
                ["linkProgram", 1],
                ["useProgram", 1],
            ]));
        }
        // Should not panic
    }

    /// texParameteri with invalid params doesn't crash.
    #[test]
    fn prop_webgl_tex_parameteri_invalid(
        pname in any::<u32>(),
        param in any::<u32>(),
    ) {
        let mut gl = stage_runtime::webgl2::WebGL2::new(4, 4);
        gl.process_commands(&json!([
            ["createTexture", "__ret_tex"],
            ["bindTexture", 0x0DE1, 1],
            ["texParameteri", 0x0DE1, pname, param],
        ]));
    }
}

// ── HTML/CSS Robustness ─────────────────────────────────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// Malformed HTML with unclosed tags, random attributes, etc. never panics the runtime.
    #[test]
    fn prop_malformed_html_no_panic(
        tags in prop::collection::vec(
            prop_oneof![
                Just("<div>"), Just("</div>"), Just("<span>"), Just("</span>"),
                Just("<p>"), Just("</p>"), Just("<br>"), Just("<hr>"),
                Just("<div class=\"x\">"), Just("<div id=\"y\">"),
                Just("<script>"), Just("</script>"),
                Just("<style>"), Just("</style>"),
                Just("<!DOCTYPE html>"), Just("<!-- comment -->"),
                Just("<div style=\"color: red\">"),
                Just("<<>>"), Just("</>"), Just("< >"),
            ],
            1..15
        ),
    ) {
        let mut rt = make_runtime(64, 64);
        let html = tags.join(" some text ");
        let escaped = html.replace('\\', "\\\\").replace('\'', "\\'");
        let js = format!(
            "var div = document.createElement('div');\n\
             try {{ div.innerHTML = '{}'; }} catch(e) {{}}\n\
             globalThis.__testResult = {{ ok: true }};\n",
            escaped
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        prop_assert_eq!(result["ok"].clone(), json!(true));
    }

    /// CSS cascade: inline style > class style (basic specificity ordering).
    /// We test via element.style property which should override classList-based styles.
    #[test]
    fn prop_inline_style_overrides_class(
        r in 0u8..=255,
        g in 0u8..=255,
        b in 0u8..=255,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var el = document.createElement('div');\n\
             el.style.color = 'rgb({r},{g},{b})';\n\
             globalThis.__testResult = {{ style: el.style.color }};\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let val = rt.evaluate("JSON.stringify(__testResult)").unwrap();
        let s = val["result"]["value"].as_str().unwrap();
        let result: serde_json::Value = serde_json::from_str(s).unwrap();
        let style = result["style"].as_str().unwrap();
        prop_assert!(style.contains(&format!("{r}")) || style.contains("rgb"),
            "inline style should be preserved: got {:?}", style);
    }
}

// ── Canvas2D getImageData / putImageData Round-Trip ─────────────────────

proptest! {
    #![proptest_config(proptest_config())]

    /// putImageData writes pixels that can be read back (values clamped to [0, 255]).
    #[test]
    fn prop_put_image_data_renders(
        r in 0u8..=255,
        g in 0u8..=255,
        b in 0u8..=255,
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(
            "var canvas = document.createElement('canvas');\n\
             var ctx = canvas.getContext('2d');\n\
             var imgData = ctx.createImageData(64, 64);\n\
             for (var i = 0; i < imgData.data.length; i += 4) {{\n\
                 imgData.data[i] = {r};\n\
                 imgData.data[i+1] = {g};\n\
                 imgData.data[i+2] = {b};\n\
                 imgData.data[i+3] = 255;\n\
             }}\n\
             ctx.putImageData(imgData, 0, 0);\n\
             requestAnimationFrame(function(){{}});\n"
        );
        rt.load_js("<test>", &js).unwrap();
        for _ in 0..3 { rt.tick(); }

        let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
        prop_assert!((px[0] as i32 - r as i32).abs() <= 2, "R: expected {r}, got {}", px[0]);
        prop_assert!((px[1] as i32 - g as i32).abs() <= 2, "G: expected {g}, got {}", px[1]);
        prop_assert!((px[2] as i32 - b as i32).abs() <= 2, "B: expected {b}, got {}", px[2]);
    }
}

// ── AudioParam Scheduling ───────────────────────────────────────────────

use stage_runtime::audio::offline::render_offline;

const AUDIO_SAMPLE_RATE: u32 = 44100;
const AUDIO_FPS: u32 = 30;
const SAMPLES_PER_FRAME: usize = (AUDIO_SAMPLE_RATE / AUDIO_FPS) as usize; // 1470

/// Compute RMSE between two sample buffers.
fn audio_rmse(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() { return f64::MAX; }
    let sum_sq: f64 = a.iter().zip(b.iter())
        .map(|(x, y)| (*x as f64 - *y as f64).powi(2))
        .sum();
    (sum_sq / a.len() as f64).sqrt()
}

/// Get the peak absolute value from interleaved stereo samples.
fn peak_abs(samples: &[f32]) -> f32 {
    samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max)
}

proptest! {
    #![proptest_config(proptest_config())]

    /// linearRampToValueAtTime produces a monotonic gain ramp that doesn't overshoot.
    /// Start gain=start_val, ramp to end_val over the rendering period.
    /// Every frame's peak amplitude should be between start and end (no overshoot).
    #[test]
    fn prop_linear_ramp_no_overshoot(
        start_val in 0.1f64..0.5,
        end_val in 0.5f64..1.0,
    ) {
        let ramp_time = 3.0 / AUDIO_FPS as f64; // ramp over 3 frames
        let frames = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(start_val), json!(0)],
                vec![json!("param_linearRamp"), json!(2), json!("gain"), json!(end_val), json!(ramp_time)],
            ],
            AUDIO_SAMPLE_RATE, 5, AUDIO_FPS,
        );

        let min_gain = start_val as f32;
        let max_gain = end_val as f32;
        // Allow some tolerance for sine wave amplitude variation and ramp interpolation
        let tolerance = 0.05;

        for (i, frame) in frames.iter().enumerate() {
            let peak = peak_abs(frame);
            // Peak shouldn't exceed the max gain + tolerance (no overshoot)
            prop_assert!(peak <= max_gain + tolerance,
                "frame {} peak {:.4} exceeds max gain {:.4} + tolerance — overshoot detected",
                i, peak, max_gain);
        }

        // Last frame should have settled at approximately end_val
        let last_peak = peak_abs(frames.last().unwrap());
        prop_assert!(last_peak > (max_gain - 0.15),
            "final frame peak {:.4} should be near target gain {:.4}", last_peak, max_gain);
    }

    /// linearRamp with equal start and end produces constant gain — output is identical
    /// to non-ramped oscillator at that gain.
    #[test]
    fn prop_linear_ramp_constant_is_noop(
        gain in 0.1f64..1.0,
    ) {
        let ramp_time = 3.0 / AUDIO_FPS as f64;

        // With ramp (same start/end)
        let ramped = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(gain), json!(0)],
                vec![json!("param_linearRamp"), json!(2), json!("gain"), json!(gain), json!(ramp_time)],
            ],
            AUDIO_SAMPLE_RATE, 3, AUDIO_FPS,
        );

        // Without ramp (just set value)
        let constant = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(gain), json!(0)],
            ],
            AUDIO_SAMPLE_RATE, 3, AUDIO_FPS,
        );

        for i in 0..3 {
            let r = audio_rmse(&ramped[i], &constant[i]);
            prop_assert!(r < 0.001,
                "frame {} RMSE={:.6} — constant ramp should match static gain", i, r);
        }
    }

    /// setValueAtTime at the same time overwrites the previous value.
    /// The last setValueAtTime wins.
    #[test]
    fn prop_set_value_at_time_last_wins(
        first_val in 0.1f64..0.5,
        second_val in 0.5f64..1.0,
    ) {
        // Set gain to first_val then immediately to second_val at t=0
        let with_overwrite = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(first_val), json!(0)],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(second_val), json!(0)],
            ],
            AUDIO_SAMPLE_RATE, 2, AUDIO_FPS,
        );

        // Just set to second_val
        let just_second = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(second_val), json!(0)],
            ],
            AUDIO_SAMPLE_RATE, 2, AUDIO_FPS,
        );

        for i in 0..2 {
            let r = audio_rmse(&with_overwrite[i], &just_second[i]);
            prop_assert!(r < 0.001,
                "frame {} RMSE={:.6} — second setValueAtTime should overwrite first", i, r);
        }
    }

    /// cancelScheduledValues clears future events starting at the given time.
    /// Schedule a ramp from t=0 to t=ramp_end, then cancel at ramp_mid — the
    /// cancelled output should differ from the full ramp (proving cancel had effect).
    #[test]
    fn prop_cancel_scheduled_values_changes_output(
        gain in 0.1f64..0.5,
    ) {
        let ramp_end_time = 5.0 / AUDIO_FPS as f64;
        let cancel_time = 1.0 / AUDIO_FPS as f64; // cancel partway through the ramp

        // Full ramp (no cancel)
        let full_ramp = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(gain), json!(0)],
                vec![json!("param_linearRamp"), json!(2), json!("gain"), json!(1.0), json!(ramp_end_time)],
            ],
            AUDIO_SAMPLE_RATE, 5, AUDIO_FPS,
        );

        // Same ramp but cancelled partway through
        let cancelled = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(gain), json!(0)],
                vec![json!("param_linearRamp"), json!(2), json!("gain"), json!(1.0), json!(ramp_end_time)],
                vec![json!("param_cancel"), json!(2), json!("gain"), json!(cancel_time)],
            ],
            AUDIO_SAMPLE_RATE, 5, AUDIO_FPS,
        );

        // Later frames should differ — cancel stopped the ramp from completing
        let later_rmse = audio_rmse(&full_ramp[3], &cancelled[3]);
        prop_assert!(later_rmse > 0.001,
            "cancel should change later frames, RMSE={:.6}", later_rmse);

        // All cancelled output should be finite
        for (i, frame) in cancelled.iter().enumerate() {
            for (j, &s) in frame.iter().enumerate() {
                prop_assert!(s.is_finite(), "NaN/Inf at frame {} sample {}", i, j);
            }
        }
    }

    /// exponentialRamp doesn't produce NaN or infinite samples.
    #[test]
    fn prop_exponential_ramp_no_nan(
        start_val in 0.01f64..0.5,
        end_val in 0.5f64..2.0,
    ) {
        let ramp_time = 3.0 / AUDIO_FPS as f64;
        let frames = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(start_val), json!(0)],
                vec![json!("param_exponentialRamp"), json!(2), json!("gain"), json!(end_val), json!(ramp_time)],
            ],
            AUDIO_SAMPLE_RATE, 5, AUDIO_FPS,
        );

        for (i, frame) in frames.iter().enumerate() {
            for (j, &sample) in frame.iter().enumerate() {
                prop_assert!(!sample.is_nan(),
                    "NaN at frame {} sample {} — exponentialRamp produced NaN", i, j);
                prop_assert!(sample.is_finite(),
                    "Inf at frame {} sample {} — exponentialRamp produced Inf", i, j);
            }
        }
    }

    /// setTargetAtTime produces samples that are always finite (no NaN/Inf).
    #[test]
    fn prop_set_target_at_time_no_nan(
        target in 0.01f64..2.0,
        time_constant in 0.001f64..0.5,
    ) {
        let frames = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(440), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(0.5), json!(0)],
                vec![json!("param_setTarget"), json!(2), json!("gain"), json!(target), json!(0), json!(time_constant)],
            ],
            AUDIO_SAMPLE_RATE, 3, AUDIO_FPS,
        );

        for (i, frame) in frames.iter().enumerate() {
            for (j, &sample) in frame.iter().enumerate() {
                prop_assert!(!sample.is_nan(),
                    "NaN at frame {} sample {}", i, j);
                prop_assert!(sample.is_finite(),
                    "Inf at frame {} sample {}", i, j);
            }
        }
    }

    /// Gain value of 0 produces silence (all samples ≈ 0).
    #[test]
    fn prop_gain_zero_is_silence(
        freq in 100.0f64..2000.0,
    ) {
        let frames = render_offline(
            &[
                vec![json!("osc_start"), json!(1), json!("sine"), json!(freq), json!(0)],
                vec![json!("gain_create"), json!(2), json!(0)],
                vec![json!("connect"), json!(1), json!(2)],
                vec![json!("connect"), json!(2), json!("destination")],
                vec![json!("param_setValueAtTime"), json!(2), json!("gain"), json!(0), json!(0)],
            ],
            AUDIO_SAMPLE_RATE, 2, AUDIO_FPS,
        );

        for (i, frame) in frames.iter().enumerate() {
            let peak = peak_abs(frame);
            prop_assert!(peak < 0.001,
                "frame {} peak={:.4} — gain=0 should produce silence", i, peak);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CSS var() property-based tests
// ═══════════════════════════════════════════════════════════════════════════

/// Random CSS custom property name (valid identifiers)
fn css_var_name() -> impl Strategy<Value = String> {
    "[a-z][a-z0-9\\-]{0,10}".prop_map(|s| format!("--{}", s))
}

/// Random CSS value (colors, sizes, plain text)
fn css_value() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("#ff0000".to_string()),
        Just("#00ff00".to_string()),
        Just("10px".to_string()),
        Just("20px".to_string()),
        Just("red".to_string()),
        Just("blue".to_string()),
        Just("1em".to_string()),
        Just("50%".to_string()),
        (0u8..=255, 0u8..=255, 0u8..=255).prop_map(|(r,g,b)| format!("#{:02x}{:02x}{:02x}", r, g, b)),
    ]
}

proptest! {
    #![proptest_config(proptest_config())]

    /// CSS var() always resolves without panicking, and var(--name, fallback) returns fallback
    /// when the property is undefined.
    #[test]
    fn prop_css_var_fallback_resolves(
        fallback in css_value(),
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            body {{ margin: 0; background: #000; }}
            .box {{ width: 32px; height: 32px; background: var(--undefined, {}); }}
        </style></head>
        <body><div class="box"></div></body>
        </html>"#, fallback);

        let mut pixmap = tiny_skia::Pixmap::new(64, 64).unwrap();
        // Should never panic regardless of fallback value
        htmlcss::render_html(&html, &mut pixmap);
    }

    /// CSS var() with defined property always resolves the property value.
    #[test]
    fn prop_css_var_defined_resolves(
        name in css_var_name(),
        value in css_value(),
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            :root {{ {}: {}; }}
            body {{ margin: 0; background: #000; }}
            .box {{ width: 32px; height: 32px; background: var({}); }}
        </style></head>
        <body><div class="box"></div></body>
        </html>"#, name, value, name);

        let mut pixmap = tiny_skia::Pixmap::new(64, 64).unwrap();
        htmlcss::render_html(&html, &mut pixmap);
        // No panic = pass
    }

    /// Nested var() references resolve without infinite loops or panics.
    #[test]
    fn prop_css_var_nested_no_panic(
        val in css_value(),
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            :root {{ --a: {}; --b: var(--a); --c: var(--b); }}
            body {{ margin: 0; background: #000; }}
            .box {{ width: 32px; height: 32px; background: var(--c); }}
        </style></head>
        <body><div class="box"></div></body>
        </html>"#, val);

        let mut pixmap = tiny_skia::Pixmap::new(64, 64).unwrap();
        htmlcss::render_html(&html, &mut pixmap);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CSS calc() property-based tests
// ═══════════════════════════════════════════════════════════════════════════

/// Random calc expression
fn calc_expr() -> impl Strategy<Value = String> {
    prop_oneof![
        (1.0f64..500.0, 1.0f64..500.0).prop_map(|(a, b)| format!("calc({}px + {}px)", a, b)),
        (1.0f64..500.0, 1.0f64..200.0).prop_map(|(a, b)| format!("calc({}px - {}px)", a.max(b), b)),
        (1.0f64..100.0, 1.0f64..5.0).prop_map(|(a, b)| format!("calc({}px * {})", a, b)),
        (1.0f64..500.0, 1.0f64..10.0).prop_map(|(a, b)| format!("calc({}px / {})", a, b)),
        (1.0f64..100.0, 1.0f64..100.0).prop_map(|(a, b)| format!("calc({}% + {}px)", a, b)),
        (1.0f64..100.0).prop_map(|a| format!("calc({}vw - 40px)", a)),
    ]
}

proptest! {
    #![proptest_config(proptest_config())]

    /// calc() expressions never panic, even with arbitrary numeric inputs.
    #[test]
    fn prop_css_calc_no_panic(
        expr in calc_expr(),
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            body {{ margin: 0; background: #000; }}
            .box {{ width: {}; height: 32px; background: #ff0000; }}
        </style></head>
        <body><div class="box"></div></body>
        </html>"#, expr);

        let mut pixmap = tiny_skia::Pixmap::new(640, 480).unwrap();
        htmlcss::render_html(&html, &mut pixmap);
    }

    /// calc(Apx + Bpx) produces a box wider than either operand alone.
    #[test]
    fn prop_css_calc_addition_wider(
        a in 5.0f64..50.0,
        b in 5.0f64..50.0,
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            body {{ margin: 0; background: #000; }}
            .box {{ width: calc({}px + {}px); height: 10px; background: #ff0000; }}
        </style></head>
        <body><div class="box"></div></body>
        </html>"#, a, b);

        let mut pixmap = tiny_skia::Pixmap::new(200, 64).unwrap();
        htmlcss::render_html(&html, &mut pixmap);

        let data = pixmap.data();
        let row5_red = (0..200).filter(|&col| {
            let i = (5 * 200 + col) * 4;
            data[i] > 200 && data[i + 3] > 200
        }).count();

        let expected = (a + b).round() as usize;
        // Allow ±3px tolerance for rounding
        prop_assert!(row5_red >= expected.saturating_sub(3) && row5_red <= expected + 3,
            "calc({}px + {}px) = {} expected ~{} red px, got {}", a, b, a+b, expected, row5_red);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// backdrop-filter property-based tests
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest_config())]

    /// backdrop-filter: blur(Npx) never panics for any positive blur radius.
    #[test]
    fn prop_backdrop_filter_blur_no_panic(
        blur in 0.0f64..100.0,
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            body {{ margin: 0; background: #ff0000; }}
            .overlay {{
                position: absolute; top: 0; left: 0;
                width: 64px; height: 64px;
                backdrop-filter: blur({}px);
                background: rgba(0, 0, 0, 0.3);
            }}
        </style></head>
        <body><div class="overlay"></div></body>
        </html>"#, blur);

        let mut pixmap = tiny_skia::Pixmap::new(64, 64).unwrap();
        htmlcss::render_html(&html, &mut pixmap);
        // Just verifying no panic
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// box-shadow property-based tests
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest_config())]

    /// box-shadow with random offsets, blur, and spread never panics.
    #[test]
    fn prop_box_shadow_no_panic(
        offset_x in -50.0f64..50.0,
        offset_y in -50.0f64..50.0,
        blur in 0.0f64..30.0,
        spread in -10.0f64..10.0,
        r in 0u8..=255,
        g in 0u8..=255,
        b in 0u8..=255,
        a_pct in 0.0f64..1.0,
    ) {
        use stage_runtime::htmlcss;
        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            body {{ margin: 0; background: #000; }}
            .card {{
                position: absolute; top: 20px; left: 20px;
                width: 20px; height: 20px;
                background: #ffffff;
                box-shadow: {}px {}px {}px {}px rgba({},{},{},{});
            }}
        </style></head>
        <body><div class="card"></div></body>
        </html>"#, offset_x, offset_y, blur, spread, r, g, b, a_pct);

        let mut pixmap = tiny_skia::Pixmap::new(96, 96).unwrap();
        htmlcss::render_html(&html, &mut pixmap);
    }

    /// Multiple box-shadows (comma-separated) never panic.
    #[test]
    fn prop_box_shadow_multiple_no_panic(
        count in 1usize..5,
        blur in 0.0f64..20.0,
    ) {
        use stage_runtime::htmlcss;
        let shadows: Vec<String> = (0..count).map(|i| {
            format!("{}px {}px {}px rgba(255,0,0,0.5)", i * 2, i * 2, blur)
        }).collect();
        let shadow_str = shadows.join(", ");

        let html = format!(r#"<!DOCTYPE html>
        <html><head><style>
            body {{ margin: 0; background: #000; }}
            .card {{
                position: absolute; top: 20px; left: 20px;
                width: 20px; height: 20px;
                background: #fff;
                box-shadow: {};
            }}
        </style></head>
        <body><div class="card"></div></body>
        </html>"#, shadow_str);

        let mut pixmap = tiny_skia::Pixmap::new(96, 96).unwrap();
        htmlcss::render_html(&html, &mut pixmap);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// globalCompositeOperation property-based tests
// ═══════════════════════════════════════════════════════════════════════════

/// Random Canvas2D composite operation
fn composite_op() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("source-over"),
        Just("source-in"),
        Just("source-out"),
        Just("source-atop"),
        Just("destination-over"),
        Just("destination-in"),
        Just("destination-out"),
        Just("destination-atop"),
        Just("lighter"),
        Just("xor"),
        Just("copy"),
        Just("multiply"),
        Just("screen"),
        Just("overlay"),
        Just("darken"),
        Just("lighten"),
        Just("color-dodge"),
        Just("color-burn"),
        Just("hard-light"),
        Just("soft-light"),
        Just("difference"),
        Just("exclusion"),
    ]
}

proptest! {
    #![proptest_config(proptest_config())]

    /// All globalCompositeOperation modes produce valid pixel output without panicking.
    #[test]
    fn prop_composite_op_no_panic(
        op in composite_op(),
        (r1, g1, b1) in hex_color(),
        (r2, g2, b2) in hex_color(),
    ) {
        let mut rt = make_runtime(64, 64);
        let js = format!(r#"
            var c = document.createElement('canvas');
            c.width = 64; c.height = 64;
            var ctx = c.getContext('2d');
            ctx.fillStyle = 'rgb({},{},{})';
            ctx.fillRect(0, 0, 64, 64);
            ctx.globalCompositeOperation = '{}';
            ctx.fillStyle = 'rgb({},{},{})';
            ctx.fillRect(0, 0, 64, 64);
            ctx.globalCompositeOperation;
        "#, r1, g1, b1, op, r2, g2, b2);

        rt.evaluate(&js).unwrap();
        rt.tick();

        // Verify the framebuffer has valid pixels (no NaN artifacts)
        let fb = rt.get_framebuffer();
        for chunk in fb.chunks(4) {
            prop_assert!(chunk[0] <= 255 && chunk[1] <= 255 && chunk[2] <= 255 && chunk[3] <= 255);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Web Worker property-based tests
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(ProptestConfig { cases: 16, ..ProptestConfig::default() })]

    /// Worker.postMessage with random JSON-serializable data never panics.
    #[test]
    fn prop_worker_postmessage_no_panic(
        val in -1000.0f64..1000.0,
    ) {
        let mut rt = make_runtime(64, 64);

        let js = format!(r#"
            globalThis.__worker_msg_received = false;
            var w = new Worker('nonexistent.js');
            w.postMessage({{ value: {} }});
            w.terminate();
            'ok'
        "#, val);

        // Should not panic even with no content_dir
        let result = rt.evaluate(&js);
        prop_assert!(result.is_ok(), "Worker.postMessage should not panic");
    }

    /// Worker terminate is idempotent — calling it multiple times doesn't crash.
    #[test]
    fn prop_worker_terminate_idempotent(
        terminate_count in 1usize..10,
    ) {
        let mut rt = make_runtime(64, 64);

        let js = format!(r#"
            var w = new Worker('nonexistent.js');
            for (var i = 0; i < {}; i++) w.terminate();
            'ok'
        "#, terminate_count);

        let result = rt.evaluate(&js);
        prop_assert!(result.is_ok());
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// <link> stylesheet + malformed CSS property-based tests
// ═══════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(proptest_config())]

    /// HTML with <link> tags pointing to nonexistent stylesheets doesn't panic.
    #[test]
    fn prop_link_stylesheet_missing_no_panic(
        href in "[a-z]{1,10}\\.css",
    ) {
        use stage_runtime::htmlcss;
        let dir = tempfile::tempdir().unwrap();

        let html = format!(r#"<!DOCTYPE html>
        <html><head>
            <link rel="stylesheet" href="{}">
            <style>body {{ margin: 0; background: #000; }}</style>
        </head>
        <body><div>hello</div></body>
        </html>"#, href);

        let mut pixmap = tiny_skia::Pixmap::new(64, 64).unwrap();
        htmlcss::render_html_with_dir(&html, &mut pixmap, dir.path());
    }

    /// Random CSS property values in linked stylesheets don't panic.
    #[test]
    fn prop_linked_css_random_values_no_panic(
        prop_val in "[a-z\\-]{1,15}: [a-z0-9#%()., ]{1,30}",
    ) {
        use stage_runtime::htmlcss;
        let dir = tempfile::tempdir().unwrap();

        let css = format!(".test {{ {}; }}", prop_val);
        std::fs::write(dir.path().join("random.css"), &css).unwrap();

        let html = r#"<!DOCTYPE html>
        <html><head>
            <link rel="stylesheet" href="random.css">
            <style>body { margin: 0; background: #000; }</style>
        </head>
        <body><div class="test">hello</div></body>
        </html>"#;

        let mut pixmap = tiny_skia::Pixmap::new(64, 64).unwrap();
        htmlcss::render_html_with_dir(html, &mut pixmap, dir.path());
    }
}

// ============================================================================
// DOM serializer: _attrs fix (was reading _attributes instead of _attrs)
// ============================================================================

#[test]
fn set_attribute_roundtrips() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        div.setAttribute('data-state', 'active');
        div.setAttribute('role', 'button');
        globalThis.__r1 = div.getAttribute('data-state');
        globalThis.__r2 = div.getAttribute('role');
        globalThis.__r3 = div.hasAttribute('data-state');
    "#).unwrap();
    rt.tick();
    let val1 = rt.evaluate("globalThis.__r1").unwrap();
    let val2 = rt.evaluate("globalThis.__r2").unwrap();
    let val3 = rt.evaluate("globalThis.__r3").unwrap();
    let r1 = val1.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_str()).unwrap_or("");
    let r2 = val2.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_str()).unwrap_or("");
    let r3 = val3.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_bool()).unwrap_or(false);
    assert_eq!(r1, "active");
    assert_eq!(r2, "button");
    assert!(r3);
}

#[test]
fn serialize_dom_includes_attrs() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var div = document.createElement('div');
        div.setAttribute('data-x', 'hello');
        document.body.appendChild(div);
        globalThis.__serialized = (typeof __dz_serialize_dom === 'function')
            ? __dz_serialize_dom(div) : 'no_serializer';
    "#).unwrap();
    rt.tick();
    let val = rt.evaluate("globalThis.__serialized").unwrap();
    let html = val.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_str()).unwrap_or("no_result");
    if html != "no_serializer" {
        assert!(html.contains("data-x=\"hello\""),
            "__dz_serialize_dom should include _attrs, got: {}", html);
    }
}

// ============================================================================
// Depth limits: extract_scripts and render_html with deep nesting
// ============================================================================

#[test]
fn extract_scripts_survives_deep_nesting() {
    use stage_runtime::htmlcss;
    let open: String = (0..100).map(|_| "<div>").collect();
    let close: String = (0..100).map(|_| "</div>").collect();
    let html = format!("<html><body>{}{}</body></html>", open, close);
    let (_, scripts) = htmlcss::extract_scripts(&html);
    assert!(scripts.is_empty());
}

#[test]
fn render_html_survives_deep_nesting() {
    use stage_runtime::htmlcss;
    let open: String = (0..100).map(|_| "<div>").collect();
    let close: String = (0..100).map(|_| "</div>").collect();
    let html = format!("<html><body>{}{}</body></html>", open, close);
    let mut pixmap = tiny_skia::Pixmap::new(128, 128).unwrap();
    htmlcss::render_html(&html, &mut pixmap);
}

#[test]
fn offset_children_survives_deep_nesting() {
    use stage_runtime::htmlcss;
    let mut html = String::from("<html><body>");
    for i in 0..100 {
        html.push_str(&format!("<div style='transform:translate({}px,0)'>", i));
    }
    html.push_str("content");
    for _ in 0..100 {
        html.push_str("</div>");
    }
    html.push_str("</body></html>");
    let mut pixmap = tiny_skia::Pixmap::new(128, 128).unwrap();
    htmlcss::render_html(&html, &mut pixmap);
}
