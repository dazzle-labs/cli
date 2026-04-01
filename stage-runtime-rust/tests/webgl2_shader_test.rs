//! Shader variant tests: JS dynamically compiles, swaps, and parameterizes shaders.
//!
//! Run: cargo test --test webgl2_shader_test
//! Video: DAZZLE_TEST_VIDEO_DIR=./test_videos cargo test --test webgl2_shader_test

mod test_harness;
use test_harness::*;

#[test]
fn animated_uniform() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("animated_uniform", 64, 64);

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
        var frame = 0;

        function draw() {
            frame++;
            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            if (frame <= 1) {
                gl.uniform3f(colorLoc, 0.0, 1.0, 0.0);
            } else {
                gl.uniform3f(colorLoc, 0.0, 0.0, 1.0);
            }
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Double-buffered GPU readback returns frame N-1, so we need an extra tick.
    rt.tick(); // frame 1: green
    rec.capture(rt.get_framebuffer());
    rt.tick(); // frame 2: blue — readback returns frame 1 (green)
    rec.capture(rt.get_framebuffer());
    let px1 = pixel_at(rt.get_framebuffer(), 64, 32, 32);

    rt.tick(); // frame 3: blue — readback returns frame 2 (blue)
    rec.capture(rt.get_framebuffer());
    let px2 = pixel_at(rt.get_framebuffer(), 64, 32, 32);

    assert!(px1[1] > 200, "frame 2 readback should be green, got {:?}", px1);
    assert!(px2[2] > 200, "frame 3 readback should be blue, got {:?}", px2);
    assert!(px1[2] < 50 && px2[1] < 50, "colors should differ between frames");
    rec.finish();
}

#[test]
fn procedural_fragment_shader() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("procedural_fragment", 64, 64);

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
            out vec4 fragColor;
            void main() {
                vec2 uv = floor(gl_FragCoord.xy / 8.0);
                float check = mod(uv.x + uv.y, 2.0);
                fragColor = vec4(check, check, check, 1.0);
            }
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

        function draw() {
            gl.viewport(0, 0, 64, 64);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    let px_a = pixel_at(fb, 64, 4, 4);
    let px_b = pixel_at(fb, 64, 12, 4);

    assert!(
        (px_a[0] as i32 - px_b[0] as i32).unsigned_abs() > 200,
        "checkerboard: adjacent squares should differ, got {:?} vs {:?}", px_a, px_b
    );
    rec.finish();
}

#[test]
fn shader_swap() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("shader_swap", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
        `);
        gl.compileShader(vs);

        function makeFragShader(r, g, b) {
            var fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, `#version 300 es
                precision mediump float;
                out vec4 fragColor;
                void main() { fragColor = vec4(` + r + `, ` + g + `, ` + b + `, 1.0); }
            `);
            gl.compileShader(fs);
            return fs;
        }

        function makeProgram(fs) {
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

        var currentProg = makeProgram(makeFragShader('1.0', '0.0', '0.0'));
        var frame = 0;

        function draw() {
            frame++;
            if (frame == 2) {
                currentProg = makeProgram(makeFragShader('0.0', '1.0', '0.0'));
            }
            if (frame == 3) {
                currentProg = makeProgram(makeFragShader('0.0', '0.0', '1.0'));
            }

            gl.useProgram(currentProg);
            var loc = gl.getAttribLocation(currentProg, 'aPos');
            gl.enableVertexAttribArray(loc);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Account for double-buffered readback (1-frame latency)
    rt.tick(); // frame 1: red
    rec.capture(rt.get_framebuffer());
    rt.tick(); // frame 2: green — readback returns frame 1 (red)
    rec.capture(rt.get_framebuffer());
    let px_red = pixel_at(rt.get_framebuffer(), 64, 32, 32);

    rt.tick(); // frame 3: blue — readback returns frame 2 (green)
    rec.capture(rt.get_framebuffer());
    let px_green = pixel_at(rt.get_framebuffer(), 64, 32, 32);

    rt.tick(); // frame 4 — readback returns frame 3 (blue)
    rec.capture(rt.get_framebuffer());
    let px_blue = pixel_at(rt.get_framebuffer(), 64, 32, 32);

    assert!(px_red[0] > 200, "frame 1 should be red, got {:?}", px_red);
    assert!(px_green[1] > 200, "frame 2 should be green, got {:?}", px_green);
    assert!(px_blue[2] > 200, "frame 3 should be blue, got {:?}", px_blue);
    rec.finish();
}

#[test]
fn multi_program_draw() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("multi_program_draw", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
        `);
        gl.compileShader(vs);

        function makeProg(r, g, b) {
            var fs = gl.createShader(gl.FRAGMENT_SHADER);
            gl.shaderSource(fs, `#version 300 es
                precision mediump float;
                out vec4 fragColor;
                void main() { fragColor = vec4(` + r + `, ` + g + `, ` + b + `, 1.0); }
            `);
            gl.compileShader(fs);
            var prog = gl.createProgram();
            gl.attachShader(prog, vs);
            gl.attachShader(prog, fs);
            gl.linkProgram(prog);
            return prog;
        }

        var redProg = makeProg('1.0', '0.0', '0.0');
        var blueProg = makeProg('0.0', '0.0', '1.0');

        var leftBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, leftBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  0, -1,  -1, 1,
            -1,  1,  0, -1,   0, 1,
        ]), gl.STATIC_DRAW);

        var rightBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, rightBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, -1,  1, -1,  0, 1,
            0,  1,  1, -1,  1, 1,
        ]), gl.STATIC_DRAW);

        function draw() {
            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            gl.useProgram(redProg);
            var loc = gl.getAttribLocation(redProg, 'aPos');
            gl.enableVertexAttribArray(loc);
            gl.bindBuffer(gl.ARRAY_BUFFER, leftBuf);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            gl.useProgram(blueProg);
            loc = gl.getAttribLocation(blueProg, 'aPos');
            gl.enableVertexAttribArray(loc);
            gl.bindBuffer(gl.ARRAY_BUFFER, rightBuf);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let fb = rt.get_framebuffer();
    let px_left = pixel_at(fb, 64, 16, 32);
    let px_right = pixel_at(fb, 64, 48, 32);

    assert!(px_left[0] > 200, "left should be red, got {:?}", px_left);
    assert!(px_left[2] < 50, "left should NOT be blue, got {:?}", px_left);
    assert!(px_right[2] > 200, "right should be blue, got {:?}", px_right);
    assert!(px_right[0] < 50, "right should NOT be red, got {:?}", px_right);
    rec.finish();
}

#[test]
fn time_varying_gradient() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("time_varying_gradient", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            out vec2 vUV;
            void main() {
                gl_Position = vec4(aPos, 0.0, 1.0);
                vUV = aPos * 0.5 + 0.5;
            }
        `);
        gl.compileShader(vs);

        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, `#version 300 es
            precision mediump float;
            in vec2 vUV;
            uniform float uMix;
            out vec4 fragColor;
            void main() {
                fragColor = vec4(vUV.x * uMix, (1.0 - vUV.x) * uMix, 0.0, 1.0);
            }
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

        var mixLoc = gl.getUniformLocation(prog, 'uMix');
        var frame = 0;

        function draw() {
            frame++;
            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);

            var mix = frame * 0.25;
            if (mix > 1.0) mix = 1.0;
            gl.uniform1f(mixLoc, mix);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    rt.tick(); // frame 1: mix=0.25
    rec.capture(rt.get_framebuffer());
    rt.tick(); // frame 2: mix=0.5 — readback returns frame 1
    rec.capture(rt.get_framebuffer());
    let fb_dim = rt.get_framebuffer().to_vec();

    rt.tick(); // frame 3: mix=0.75 — readback returns frame 2
    rec.capture(rt.get_framebuffer());
    rt.tick(); // frame 4: mix=1.0 — readback returns frame 3
    rec.capture(rt.get_framebuffer());
    let fb_bright = rt.get_framebuffer().to_vec();

    let px_dim = pixel_at(&fb_dim, 64, 48, 32);
    let px_bright = pixel_at(&fb_bright, 64, 48, 32);

    assert!(
        px_bright[0] > px_dim[0] + 30,
        "brightness should increase: dim R={} vs bright R={}",
        px_dim[0], px_bright[0]
    );
    rec.finish();
}
