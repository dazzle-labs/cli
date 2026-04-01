//! Dazzle event system tests: external events drive WebGL2 rendering.
//!
//! Tests the documented API:
//!   Send:    dazzle s ev e <name> '<json>'
//!   Receive: window.addEventListener('<name>', e => e.detail)
//!
//! Run: cargo test --test webgl2_event_test
//! Video: DAZZLE_TEST_VIDEO_DIR=./test_videos cargo test --test webgl2_event_test

mod test_harness;
use test_harness::*;

#[test]
fn event_drives_color() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("event_drives_color", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
        `);
        gl.compileShader(vs);

        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, `#version 300 es
            precision mediump float;
            uniform vec3 uColor;
            out vec4 fragColor;
            void main() { fragColor = vec4(uColor, 1.0); }
        `);
        gl.compileShader(fs);

        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.useProgram(prog);

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1,  -1, 1,
            -1,  1,  1, -1,   1, 1,
        ]), gl.STATIC_DRAW);

        var loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        var colorLoc = gl.getUniformLocation(prog, 'uColor');
        var currentColor = [0.0, 0.0, 0.0];

        // Documented API: window.addEventListener('<name>', e => e.detail)
        window.addEventListener('color-change', function(e) {
            currentColor = [e.detail.r, e.detail.g, e.detail.b];
        });

        function draw() {
            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform3f(colorLoc, currentColor[0], currentColor[1], currentColor[2]);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Before any events — should be black
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] < 10 && px[1] < 10 && px[2] < 10,
        "should be black before event, got {:?}", px);

    // dazzle s ev e color-change '{"r":1,"g":0,"b":0}'
    rt.dispatch_event("color-change", r#"{"r": 1.0, "g": 0.0, "b": 0.0}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 200, "should be red after event, got {:?}", px);
    assert!(px[1] < 10 && px[2] < 10, "should be pure red, got {:?}", px);

    // dazzle s ev e color-change '{"r":0,"g":1,"b":1}'
    rt.dispatch_event("color-change", r#"{"r": 0.0, "g": 1.0, "b": 1.0}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[1] > 200 && px[2] > 200, "should be cyan after event, got {:?}", px);
    assert!(px[0] < 10, "should have no red, got {:?}", px);
    rec.finish();
}

#[test]
fn event_swaps_shader() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("event_swaps_shader", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
        `);
        gl.compileShader(vs);

        function makeProg(fragSrc) {
            var fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, fragSrc);
            gl.compileShader(fs);
            var prog = gl.createProgram();
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            return prog;
        }

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1,  -1, 1,
            -1,  1,  1, -1,   1, 1,
        ]), gl.STATIC_DRAW);

        var shaders = {
            solid_red: makeProg(`#version 300 es
                precision mediump float;
                out vec4 fragColor;
                void main() { fragColor = vec4(1.0, 0.0, 0.0, 1.0); }
            `),
            solid_green: makeProg(`#version 300 es
                precision mediump float;
                out vec4 fragColor;
                void main() { fragColor = vec4(0.0, 1.0, 0.0, 1.0); }
            `),
            checkerboard: makeProg(`#version 300 es
                precision mediump float;
                out vec4 fragColor;
                void main() {
                    vec2 uv = floor(gl_FragCoord.xy / 16.0);
                    float c = mod(uv.x + uv.y, 2.0);
                    fragColor = vec4(c, c, c, 1.0);
                }
            `),
        };

        var currentProg = shaders.solid_red;

        // dazzle s ev e shader-select '{"shader":"solid_green"}'
        window.addEventListener('shader-select', function(e) {
            if (shaders[e.detail.shader]) {
                currentProg = shaders[e.detail.shader];
            }
        });

        function draw() {
            gl.useProgram(currentProg);
            var loc = gl.getAttribLocation(currentProg, 'aPos');
            gl.enableVertexAttribArray(loc);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.viewport(0, 0, 64, 64);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Default: solid red
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 200, "should start red, got {:?}", px);

    // Switch to green
    rt.dispatch_event("shader-select", r#"{"shader": "solid_green"}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[1] > 200 && px[0] < 10, "should be green after event, got {:?}", px);

    // Switch to checkerboard
    rt.dispatch_event("shader-select", r#"{"shader": "checkerboard"}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let fb = rt.get_framebuffer();
    let px_a = pixel_at(fb, 64, 4, 4);
    let px_b = pixel_at(fb, 64, 20, 4);
    assert!(
        (px_a[0] as i32 - px_b[0] as i32).unsigned_abs() > 200,
        "checkerboard: adjacent cells should differ, got {:?} vs {:?}", px_a, px_b
    );
    rec.finish();
}

#[test]
fn event_multiple_listeners() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("event_multiple_listeners", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
        `);
        gl.compileShader(vs);

        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, `#version 300 es
            precision mediump float;
            uniform vec3 uColor;
            uniform float uBrightness;
            out vec4 fragColor;
            void main() { fragColor = vec4(uColor * uBrightness, 1.0); }
        `);
        gl.compileShader(fs);

        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.useProgram(prog);

        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1,  -1, 1,
            -1,  1,  1, -1,   1, 1,
        ]), gl.STATIC_DRAW);

        var loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        var colorLoc = gl.getUniformLocation(prog, 'uColor');
        var brightLoc = gl.getUniformLocation(prog, 'uBrightness');

        var color = [1.0, 1.0, 1.0];
        var brightness = 0.5;

        // Two different event types controlling different uniforms
        window.addEventListener('set-color', function(e) {
            color = [e.detail.r, e.detail.g, e.detail.b];
        });
        window.addEventListener('set-brightness', function(e) {
            brightness = e.detail.value;
        });

        function draw() {
            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.uniform3f(colorLoc, color[0], color[1], color[2]);
            gl.uniform1f(brightLoc, brightness);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Default: white at 50% brightness → grey
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 100 && px[0] < 180, "should be mid-grey, got {:?}", px);

    // Set color to red (brightness stays 0.5)
    rt.dispatch_event("set-color", r#"{"r": 1.0, "g": 0.0, "b": 0.0}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 100 && px[0] < 180, "should be dim red, R={}", px[0]);
    assert!(px[1] < 10, "G should be ~0, got {}", px[1]);

    // Crank brightness to 1.0 (color stays red)
    rt.dispatch_event("set-brightness", r#"{"value": 1.0}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 240, "should be bright red, R={}", px[0]);
    assert!(px[1] < 10, "G should still be ~0, got {}", px[1]);
    rec.finish();
}
