//! Basic WebGL2 rendering tests: JS in V8 → WebGL2 polyfill → GPU → framebuffer.
//!
//! Run: cargo test --test webgl2_basic_test
//! Video: DAZZLE_TEST_VIDEO_DIR=./test_videos cargo test --test webgl2_basic_test

mod test_harness;
use test_harness::*;

#[test]
fn debug_commands() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        console.log('vs type:', typeof vs, 'value:', vs);

        gl.shaderSource(vs, '#version 300 es\nin vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }');
        gl.compileShader(vs);

        var prog = gl.createProgram();
        console.log('prog type:', typeof prog, 'value:', prog);

        var buf = gl.createBuffer();
        console.log('buf type:', typeof buf, 'value:', buf);

        gl.bindBuffer(gl.ARRAY_BUFFER, buf);

        // Native callbacks dispatch inline — no command array to inspect.
        // Verify create* returned real IDs (numbers, not $-ref strings).
        console.log('vs is number:', typeof vs === 'number');
        console.log('prog is number:', typeof prog === 'number');
        console.log('buf is number:', typeof buf === 'number');
    "#).unwrap();

    let logs = rt.drain_console_logs();
    for log in &logs {
        println!("JS: {}", log.text);
    }
}

#[test]
fn clear_color() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("clear_color", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function draw() {
            gl.clearColor(0.0, 0.0, 1.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[2] > 240, "should be blue, got {:?}", px);
    assert!(px[0] < 10, "R should be ~0, got {}", px[0]);
    assert!(px[3] > 240, "alpha should be ~255, got {}", px[3]);
    rec.finish();
}

#[test]
fn shader_triangle() {
    let mut rt = make_runtime(128, 128);
    let mut rec = FrameRecorder::new("shader_triangle", 128, 128);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec2 aPos;
            void main() {
                gl_Position = vec4(aPos, 0.0, 1.0);
            }
        `);
        gl.compileShader(vs);

        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, `#version 300 es
            precision mediump float;
            out vec4 fragColor;
            void main() {
                fragColor = vec4(1.0, 0.0, 0.0, 1.0);
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
            -1, -1,   1, -1,   -1, 1,
            -1,  1,   1, -1,    1, 1,
        ]), gl.STATIC_DRAW);

        var loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        function draw() {
            gl.viewport(0, 0, 128, 128);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let px = pixel_at(rt.get_framebuffer(), 128, 64, 64);
    assert!(px[0] > 240, "R should be ~255, got {}", px[0]);
    assert!(px[1] < 10, "G should be ~0, got {}", px[1]);
    assert!(px[2] < 10, "B should be ~0, got {}", px[2]);
    rec.finish();
}

#[test]
fn depth_test() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("depth_test", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, `#version 300 es
            in vec3 aPos;
            uniform vec3 uColor;
            out vec3 vColor;
            void main() {
                gl_Position = vec4(aPos, 1.0);
                vColor = uColor;
            }
        `);
        gl.compileShader(vs);

        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, `#version 300 es
            precision mediump float;
            in vec3 vColor;
            out vec4 fragColor;
            void main() { fragColor = vec4(vColor, 1.0); }
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
            -1, -1, 0.5,   1, -1, 0.5,   -1, 1, 0.5,
            -1,  1, 0.5,   1, -1, 0.5,    1, 1, 0.5,
        ]), gl.STATIC_DRAW);

        var loc = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);

        var colorLoc = gl.getUniformLocation(prog, 'uColor');

        var buf2 = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf2);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, -0.5,   1, -1, -0.5,   -1, 1, -0.5,
            -1,  1, -0.5,   1, -1, -0.5,    1, 1, -0.5,
        ]), gl.STATIC_DRAW);

        function draw() {
            gl.viewport(0, 0, 64, 64);
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);

            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
            gl.uniform3f(colorLoc, 1.0, 0.0, 0.0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            gl.bindBuffer(gl.ARRAY_BUFFER, buf2);
            gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
            gl.uniform3f(colorLoc, 0.0, 1.0, 0.0);
            gl.drawArrays(gl.TRIANGLES, 0, 6);

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }

    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[1] > 200, "should be green (closer), got {:?}", px);
    assert!(px[0] < 50, "should NOT be red (further), got {:?}", px);
    rec.finish();
}

#[test]
fn get_error_reports_invalid_enum() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // enable() with an invalid capability should record INVALID_ENUM
            gl.enable(0xDEAD);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            // getError() should return INVALID_ENUM (0x0500) from previous batch
            var err = gl.getError();
            console.log('error:' + err);
            // Second call should return NO_ERROR
            var err2 = gl.getError();
            console.log('error2:' + err2);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    // Frame 1: enable(invalid) queued and processed → error recorded → written to JS
    rt.tick();
    // Frame 2: getError() reads from __dz_webgl_errors
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"error:1280"), "expected INVALID_ENUM (1280), got {:?}", texts);
    assert!(texts.contains(&"error2:0"), "expected NO_ERROR (0) on second call, got {:?}", texts);
}

#[test]
fn get_error_no_error_when_valid() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // Valid operations — no errors
            gl.clearColor(1.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.enable(gl.BLEND);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var err = gl.getError();
            console.log('error:' + err);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"error:0"), "expected NO_ERROR, got {:?}", texts);
}

#[test]
fn get_error_draw_without_program() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // drawArrays without a bound program should record INVALID_OPERATION
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var err = gl.getError();
            console.log('error:' + err);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"error:1282"), "expected INVALID_OPERATION (1282), got {:?}", texts);
}

#[test]
fn get_error_comprehensive_coverage() {
    // Tests multiple error conditions across different WebGL commands
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var errors = [];

        function frame1() {
            // INVALID_ENUM: createShader with bad type
            gl.createShader(0xBEEF);
            // INVALID_ENUM: invalid blend factor
            gl.blendFunc(0xDEAD, gl.ONE);
            // INVALID_ENUM: invalid cullFace mode
            gl.cullFace(0x1234);
            // INVALID_ENUM: invalid frontFace
            gl.frontFace(0x5678);
            // INVALID_ENUM: invalid depthFunc
            gl.depthFunc(0xAAAA);
            // INVALID_ENUM: invalid draw mode
            gl.drawArrays(0xFF, 0, 3);
            // INVALID_VALUE: negative viewport size
            gl.viewport(0, 0, -1, 100);
            // INVALID_VALUE: negative scissor size
            gl.scissor(0, 0, 100, -1);
            // INVALID_VALUE: negative drawArrays count
            gl.drawArrays(gl.TRIANGLES, -1, 3);
            // INVALID_OPERATION: uniform without program
            gl.uniform1f(0, 1.0);
            // INVALID_OPERATION: drawElements without program
            gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            // Drain all errors
            var err;
            while ((err = gl.getError()) !== gl.NO_ERROR) {
                errors.push(err);
            }
            console.log('count:' + errors.length);
            // Check we got all three error types
            var hasInvalidEnum = errors.indexOf(1280) !== -1;
            var hasInvalidValue = errors.indexOf(1281) !== -1;
            var hasInvalidOp = errors.indexOf(1282) !== -1;
            console.log('enum:' + hasInvalidEnum);
            console.log('value:' + hasInvalidValue);
            console.log('op:' + hasInvalidOp);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    // Per spec, record_error deduplicates — we should have exactly 3 unique errors
    assert!(texts.contains(&"count:3"), "expected 3 unique errors, got {:?}", texts);
    assert!(texts.contains(&"enum:true"), "expected INVALID_ENUM, got {:?}", texts);
    assert!(texts.contains(&"value:true"), "expected INVALID_VALUE, got {:?}", texts);
    assert!(texts.contains(&"op:true"), "expected INVALID_OPERATION, got {:?}", texts);
}

#[test]
fn get_error_invalid_blend_func_separate() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // Valid blendFuncSeparate should not error
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ZERO);
            // Invalid src alpha factor
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, 0xBEEF, gl.ZERO);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var err = gl.getError();
            console.log('error:' + err);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"error:1280"), "expected INVALID_ENUM for bad blendFuncSeparate, got {:?}", texts);
}

#[test]
fn get_error_invalid_texture_ops() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // INVALID_ENUM: bad texture target
            gl.bindTexture(0xFFFF, null);
            // INVALID_ENUM: bad texParameteri pname
            var tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texParameteri(gl.TEXTURE_2D, 0xDEAD, 0);
            // INVALID_ENUM: bad activeTexture unit (0x84C0+32 = beyond max 16)
            gl.activeTexture(0x84C0 + 32);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var errors = [];
            var err;
            while ((err = gl.getError()) !== gl.NO_ERROR) {
                errors.push(err);
            }
            console.log('count:' + errors.length);
            console.log('allEnum:' + errors.every(function(e) { return e === 1280; }));
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    // Deduplication means only 1 INVALID_ENUM
    assert!(texts.contains(&"count:1"), "expected 1 unique error (deduped), got {:?}", texts);
    assert!(texts.contains(&"allEnum:true"), "all errors should be INVALID_ENUM, got {:?}", texts);
}

#[test]
fn get_error_shader_program_invalid_value() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // INVALID_VALUE: shaderSource on non-existent shader
            gl.shaderSource(99999, 'void main(){}');
            // INVALID_VALUE: compileShader on non-existent shader
            gl.compileShader(99999);
            // INVALID_VALUE: linkProgram on non-existent program
            gl.linkProgram(99999);
            // INVALID_VALUE: useProgram on non-existent program
            gl.useProgram(99999);
            // INVALID_VALUE: attachShader with bad program
            var vs = gl.createShader(gl.VERTEX_SHADER);
            gl.attachShader(99999, vs);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var errors = [];
            var err;
            while ((err = gl.getError()) !== gl.NO_ERROR) {
                errors.push(err);
            }
            console.log('count:' + errors.length);
            console.log('allValue:' + errors.every(function(e) { return e === 1281; }));
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    // Deduplication: only 1 INVALID_VALUE
    assert!(texts.contains(&"count:1"), "expected 1 unique error (deduped), got {:?}", texts);
    assert!(texts.contains(&"allValue:true"), "all errors should be INVALID_VALUE, got {:?}", texts);
}

#[test]
fn get_error_vertex_attrib_bounds() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // INVALID_VALUE: enableVertexAttribArray beyond MAX_VERTEX_ATTRIBS (16)
            gl.enableVertexAttribArray(99);
            // INVALID_VALUE: vertexAttribPointer with negative stride
            gl.vertexAttribPointer(0, 3, gl.FLOAT, false, -4, 0);
            // INVALID_VALUE: vertexAttribPointer with size out of range (must be 1-4)
            gl.vertexAttribPointer(0, 5, gl.FLOAT, false, 0, 0);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var errors = [];
            var err;
            while ((err = gl.getError()) !== gl.NO_ERROR) {
                errors.push(err);
            }
            console.log('count:' + errors.length);
            console.log('allValue:' + errors.every(function(e) { return e === 1281; }));
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"count:1"), "expected 1 unique INVALID_VALUE (deduped), got {:?}", texts);
    assert!(texts.contains(&"allValue:true"), "expected INVALID_VALUE, got {:?}", texts);
}

#[test]
fn get_error_clear_invalid_bits() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        function frame1() {
            // Valid clear — no error
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            // Invalid bits in clear mask
            gl.clear(0x80000000);
            requestAnimationFrame(frame2);
        }
        function frame2() {
            var err = gl.getError();
            console.log('error:' + err);
            var err2 = gl.getError();
            console.log('error2:' + err2);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"error:1281"), "expected INVALID_VALUE for bad clear mask, got {:?}", texts);
    assert!(texts.contains(&"error2:0"), "expected NO_ERROR after drain, got {:?}", texts);
}

#[test]
fn buffer_sub_data() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1.0, 2.0, 3.0, 4.0]), gl.STATIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([9.0, 8.0]));
        console.log('bufferSubData ok');
    "#).unwrap();

    rt.tick();
    let logs = rt.drain_console_logs();
    assert!(logs.iter().any(|l| l.text.contains("bufferSubData ok")));
}

#[test]
fn draw_elements_instanced() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, '#version 300 es\nin vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }');
        gl.compileShader(vs);
        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, '#version 300 es\nprecision mediump float;\nout vec4 color;\nvoid main() { color = vec4(1.0, 0.0, 0.0, 1.0); }');
        gl.compileShader(fs);
        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.useProgram(prog);

        var vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, 0,1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(0, 0);

        var ib = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2]), gl.STATIC_DRAW);

        function frame() {
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawElementsInstanced(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0, 1);
        }
        requestAnimationFrame(frame);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let fb = rt.get_framebuffer();
    // Center pixel should be red from the instanced draw
    let center = pixel_at(fb, 64, 32, 32);
    assert!(center[0] > 200, "expected red from drawElementsInstanced, got {:?}", center);
}

#[test]
fn integer_uniforms() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, '#version 300 es\nin vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }');
        gl.compileShader(vs);
        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, '#version 300 es\nprecision mediump float;\nuniform int uMode;\nout vec4 color;\nvoid main() { color = uMode == 1 ? vec4(0,1,0,1) : vec4(1,0,0,1); }');
        gl.compileShader(fs);
        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        gl.useProgram(prog);
        var loc = gl.getUniformLocation(prog, 'uMode');
        gl.uniform1i(loc, 1);
        gl.uniform2i(loc, 1, 2);
        gl.uniform3i(loc, 1, 2, 3);
        gl.uniform4i(loc, 1, 2, 3, 4);
        gl.uniform1iv(loc, [1]);
        gl.uniform2iv(loc, [1, 2]);
        gl.uniform3iv(loc, [1, 2, 3]);
        gl.uniform4iv(loc, [1, 2, 3, 4]);
        gl.uniform1ui(loc, 1);
        gl.uniform2ui(loc, 1, 2);
        gl.uniform3ui(loc, 1, 2, 3);
        gl.uniform4ui(loc, 1, 2, 3, 4);
        console.log('integer uniforms ok');
    "#).unwrap();

    rt.tick();
    let logs = rt.drain_console_logs();
    assert!(logs.iter().any(|l| l.text.contains("integer uniforms ok")));
}

#[test]
fn blend_equation_and_color() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_SUBTRACT);
        gl.blendColor(1.0, 0.5, 0.25, 1.0);
        gl.clearStencil(0);
        gl.depthRange(0.0, 1.0);

        function frame() {
            var err = gl.getError();
            console.log('err:' + err);
        }
        requestAnimationFrame(frame);
    "#).unwrap();

    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"err:0"), "expected NO_ERROR for valid blend ops, got {:?}", texts);
}

#[test]
fn blend_equation_invalid() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        gl.blendEquation(0xDEAD);

        // Errors are written after command processing, so check in the next frame
        function frame1() { requestAnimationFrame(frame2); }
        function frame2() {
            var err = gl.getError();
            console.log('err:' + err);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"err:1280"), "expected INVALID_ENUM for bad blend equation, got {:?}", texts);
}

#[test]
fn get_active_uniform_and_attrib() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        // getActiveAttrib/getActiveUniform return stub objects with name, size, type
        var attrib = gl.getActiveAttrib(null, 0);
        console.log('attrib_has_name:' + (attrib && 'name' in attrib));
        console.log('attrib_has_size:' + (attrib && 'size' in attrib));
        console.log('attrib_has_type:' + (attrib && 'type' in attrib));

        var uniform = gl.getActiveUniform(null, 0);
        console.log('uniform_has_name:' + (uniform && 'name' in uniform));
        console.log('uniform_has_size:' + (uniform && 'size' in uniform));
        console.log('uniform_has_type:' + (uniform && 'type' in uniform));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"attrib_has_name:true"), "attrib should have name, got {:?}", texts);
    assert!(texts.contains(&"attrib_has_size:true"), "attrib should have size, got {:?}", texts);
    assert!(texts.contains(&"attrib_has_type:true"), "attrib should have type, got {:?}", texts);
    assert!(texts.contains(&"uniform_has_name:true"), "uniform should have name, got {:?}", texts);
    assert!(texts.contains(&"uniform_has_size:true"), "uniform should have size, got {:?}", texts);
    assert!(texts.contains(&"uniform_has_type:true"), "uniform should have type, got {:?}", texts);
}

#[test]
fn webgl2_missing_constants_exist() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        // Test a sampling of the new constants
        var constants = [
            'FUNC_ADD', 'FUNC_SUBTRACT', 'FUNC_REVERSE_SUBTRACT', 'MIN', 'MAX',
            'BYTE', 'SHORT', 'INT', 'HALF_FLOAT',
            'TEXTURE_CUBE_MAP', 'TEXTURE_3D', 'TEXTURE_2D_ARRAY',
            'TEXTURE_WRAP_R', 'MIRRORED_REPEAT',
            'UNIFORM_BUFFER', 'TRANSFORM_FEEDBACK_BUFFER',
            'R8', 'RG8', 'RGB8', 'RGBA8', 'R16F', 'RGBA16F', 'RGBA32F',
            'DEPTH_COMPONENT16', 'DEPTH24_STENCIL8',
            'RED', 'RG', 'DEPTH_STENCIL',
            'STREAM_DRAW', 'DYNAMIC_READ',
            'ACTIVE_UNIFORMS', 'ACTIVE_ATTRIBUTES',
            'FLOAT_VEC2', 'FLOAT_MAT4', 'SAMPLER_2D',
            'INTERLEAVED_ATTRIBS', 'SEPARATE_ATTRIBS',
            'SYNC_GPU_COMMANDS_COMPLETE', 'CONDITION_SATISFIED',
            'LINE_LOOP', 'DITHER', 'RASTERIZER_DISCARD',
        ];
        var missing = [];
        for (var i = 0; i < constants.length; i++) {
            if (gl[constants[i]] === undefined) missing.push(constants[i]);
        }
        console.log('missing:' + (missing.length === 0 ? 'none' : missing.join(',')));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"missing:none"), "missing constants: {:?}", texts);
}

#[test]
fn webgl2_all_methods_exist() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var methods = [
            'bufferSubData', 'copyBufferSubData', 'getBufferParameter',
            'texSubImage2D', 'texImage3D', 'texSubImage3D', 'copyTexImage2D', 'copyTexSubImage2D',
            'texParameterf', 'texStorage2D', 'texStorage3D', 'compressedTexImage2D',
            'uniform1iv', 'uniform2i', 'uniform3i', 'uniform4i',
            'uniform2iv', 'uniform3iv', 'uniform4iv',
            'uniform1ui', 'uniform2ui', 'uniform3ui', 'uniform4ui',
            'uniform1uiv', 'uniform2uiv', 'uniform3uiv', 'uniform4uiv',
            'uniform1fv', 'uniformMatrix2fv',
            'uniformMatrix2x3fv', 'uniformMatrix3x2fv',
            'uniformMatrix2x4fv', 'uniformMatrix4x2fv',
            'uniformMatrix3x4fv', 'uniformMatrix4x3fv',
            'vertexAttribDivisor', 'vertexAttribI4i', 'vertexAttribI4ui',
            'vertexAttribIPointer', 'getVertexAttrib', 'getVertexAttribOffset',
            'drawElementsInstanced', 'drawRangeElements', 'drawBuffers',
            'blendEquation', 'blendEquationSeparate', 'blendColor',
            'clearStencil', 'stencilFunc', 'stencilFuncSeparate',
            'stencilOp', 'stencilOpSeparate', 'stencilMask', 'stencilMaskSeparate',
            'depthRange', 'lineWidth', 'polygonOffset', 'sampleCoverage', 'hint',
            'deleteFramebuffer', 'deleteRenderbuffer',
            'renderbufferStorageMultisample', 'getRenderbufferParameter',
            'getFramebufferAttachmentParameter', 'readPixels',
            'invalidateFramebuffer', 'blitFramebuffer',
            'getActiveUniform', 'getActiveAttrib',
            'getUniformBlockIndex', 'uniformBlockBinding',
            'getFragDataLocation', 'getUniform',
            'isBuffer', 'isShader', 'isProgram', 'isTexture',
            'isFramebuffer', 'isRenderbuffer', 'isVertexArray', 'isEnabled',
            'bindBufferRange', 'bindBufferBase',
            'createTransformFeedback', 'bindTransformFeedback',
            'beginTransformFeedback', 'endTransformFeedback',
            'transformFeedbackVaryings', 'getTransformFeedbackVarying',
            'deleteTransformFeedback', 'isTransformFeedback',
            'createQuery', 'deleteQuery', 'beginQuery', 'endQuery',
            'getQuery', 'getQueryParameter', 'isQuery',
            'fenceSync', 'clientWaitSync', 'waitSync', 'deleteSync',
            'isSync', 'getSyncParameter',
            'createSampler', 'deleteSampler', 'bindSampler',
            'samplerParameteri', 'samplerParameterf', 'getSamplerParameter', 'isSampler',
            // New: framework-critical methods
            'getShaderPrecisionFormat', 'getShaderSource', 'detachShader',
            'validateProgram', 'getAttachedShaders',
            'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi',
            'readBuffer', 'framebufferTextureLayer', 'getInternalformatParameter',
            'getUniformIndices', 'getActiveUniforms', 'getIndexedParameter',
            'vertexAttrib1f', 'vertexAttrib2f', 'vertexAttrib3f', 'vertexAttrib4f',
            'vertexAttrib1fv', 'vertexAttrib2fv', 'vertexAttrib3fv', 'vertexAttrib4fv',
            'vertexAttribI4iv', 'vertexAttribI4uiv',
            'compressedTexImage3D', 'compressedTexSubImage3D', 'copyTexSubImage3D',
            'bindAttribLocation', 'getBufferSubData', 'getContextAttributes',
        ];
        var missing = [];
        for (var i = 0; i < methods.length; i++) {
            if (typeof gl[methods[i]] !== 'function') missing.push(methods[i]);
        }
        console.log('missing_methods:' + (missing.length === 0 ? 'none' : missing.join(',')));
        console.log('total_checked:' + methods.length);
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.iter().any(|t| t.contains("missing_methods:none")),
        "missing WebGL2 methods: {:?}", texts);
}

#[test]
fn transform_feedback_and_query_stubs() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var tf = gl.createTransformFeedback();
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
        gl.deleteTransformFeedback(tf);

        var q = gl.createQuery();
        gl.deleteQuery(q);

        var sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        var status = gl.clientWaitSync(sync, 0, 0);
        gl.deleteSync(sync);

        console.log('tf:' + (tf !== null));
        console.log('q:' + (q !== null));
        console.log('sync:' + (sync !== null));
        console.log('status:' + status);
    "#).unwrap();

    rt.tick();
    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"tf:true"));
    assert!(texts.contains(&"q:true"));
    assert!(texts.contains(&"sync:true"));
}

#[test]
fn vertex_attrib_divisor() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        gl.vertexAttribDivisor(0, 1);
        gl.vertexAttribDivisor(15, 0);
        // Invalid index >= 16
        gl.vertexAttribDivisor(16, 1);

        function frame1() { requestAnimationFrame(frame2); }
        function frame2() {
            var err = gl.getError();
            console.log('err:' + err);
        }
        requestAnimationFrame(frame1);
    "#).unwrap();

    rt.tick();
    rt.tick();
    rt.tick();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"err:1281"), "expected INVALID_VALUE for divisor index 16, got {:?}", texts);
}

#[test]
fn get_shader_precision_format() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var fmt = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        console.log('rangeMin:' + fmt.rangeMin);
        console.log('rangeMax:' + fmt.rangeMax);
        console.log('precision:' + fmt.precision);
        console.log('has_all:' + (fmt.rangeMin > 0 && fmt.rangeMax > 0 && fmt.precision > 0));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"has_all:true"), "getShaderPrecisionFormat should return valid values, got {:?}", texts);
}

#[test]
fn get_internal_format_parameter() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var samples = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA8, gl.SAMPLES);
        console.log('type:' + (samples instanceof Int32Array));
        console.log('length:' + samples.length);
        console.log('has_samples:' + (samples.length > 0));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"type:true"), "getInternalformatParameter should return Int32Array, got {:?}", texts);
    assert!(texts.contains(&"has_samples:true"), "should return sample counts, got {:?}", texts);
}

// ============================================================================
// VAO binding tests
// ============================================================================

#[test]
fn vao_binding_saves_restores_attrib_state() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var prog = gl.createProgram();
        gl.useProgram(prog);

        // Create two VAOs with different attrib configurations
        var vao1 = gl.createVertexArray();
        var vao2 = gl.createVertexArray();
        var buf1 = gl.createBuffer();
        var buf2 = gl.createBuffer();

        // Configure VAO1: attrib 0 enabled with buf1
        gl.bindVertexArray(vao1);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf1);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        // Configure VAO2: attrib 0 enabled with buf2, different size
        gl.bindVertexArray(vao2);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf2);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        // Switch back to VAO1 — should restore VAO1's attrib state
        gl.bindVertexArray(vao1);

        // Delete VAO
        gl.deleteVertexArray(vao2);

        // isVertexArray checks
        console.log('vao1_is:' + gl.isVertexArray(vao1));
        console.log('vao2_deleted:' + !gl.isVertexArray(vao2));
        console.log('create_ok:true');
        console.log('bind_ok:true');
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"create_ok:true"), "VAO creation should succeed, got {:?}", texts);
    assert!(texts.contains(&"bind_ok:true"), "VAO binding should succeed, got {:?}", texts);
}

#[test]
fn blend_equation_modes() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        // Test all valid blend equations
        var equations = [
            gl.FUNC_ADD,
            gl.FUNC_SUBTRACT,
            gl.FUNC_REVERSE_SUBTRACT,
            gl.MIN,
            gl.MAX
        ];

        var errors = [];
        for (var i = 0; i < equations.length; i++) {
            gl.blendEquation(equations[i]);
            var e = gl.getError();
            if (e !== gl.NO_ERROR) errors.push(equations[i] + ':' + e);
        }

        // Test separate blend equation
        gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_SUBTRACT);
        var sepErr = gl.getError();
        if (sepErr !== gl.NO_ERROR) errors.push('separate:' + sepErr);

        console.log('errors:' + errors.length);
        console.log('all_valid:' + (errors.length === 0));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"all_valid:true"), "all blend equations should be valid, got {:?}", texts);
}

#[test]
fn get_attrib_location_returns_negative_one() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var prog = gl.createProgram();

        var vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, '#version 300 es\nin vec4 a_position;\nvoid main() { gl_Position = a_position; }');
        gl.compileShader(vs);
        gl.attachShader(prog, vs);

        var fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, '#version 300 es\nprecision mediump float;\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }');
        gl.compileShader(fs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        var posLoc = gl.getAttribLocation(prog, 'a_position');
        var missingLoc = gl.getAttribLocation(prog, 'a_nonexistent');

        console.log('pos_loc_valid:' + (posLoc >= 0));
        console.log('missing_is_neg1:' + (missingLoc === -1));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"pos_loc_valid:true"), "existing attrib should have non-negative location, got {:?}", texts);
    assert!(texts.contains(&"missing_is_neg1:true"), "missing attrib should return -1, got {:?}", texts);
}

#[test]
fn element_buffer_unsigned_int_and_unsigned_byte() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');

        // Test Uint32Array element buffer
        var buf32 = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf32);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array([0, 1, 2, 70000]), gl.STATIC_DRAW);
        var err32 = gl.getError();

        // Test Uint8Array element buffer
        var buf8 = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf8);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 255]), gl.STATIC_DRAW);
        var err8 = gl.getError();

        console.log('u32_no_error:' + (err32 === gl.NO_ERROR));
        console.log('u8_no_error:' + (err8 === gl.NO_ERROR));
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"u32_no_error:true"), "Uint32 element buffer should not error, got {:?}", texts);
    assert!(texts.contains(&"u8_no_error:true"), "Uint8 element buffer should not error, got {:?}", texts);
}

#[test]
fn uniform1fv_sets_array_values() {
    let mut rt = make_runtime(64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var prog = gl.createProgram();

        // uniform1fv should accept an array and not throw
        var loc = gl.getUniformLocation(prog, 'u_values');
        var threw = false;
        try {
            gl.uniform1fv(loc, [1.0, 2.0, 3.0]);
            gl.uniform1iv(loc, [1, 2, 3]);
            gl.uniform1uiv(loc, [1, 2, 3]);
        } catch(e) {
            threw = true;
        }
        console.log('no_throw:' + !threw);
    "#).unwrap();

    let logs = rt.drain_console_logs();
    let texts: Vec<&str> = logs.iter().map(|l| l.text.as_str()).collect();
    assert!(texts.contains(&"no_throw:true"), "uniform1fv/iv/uiv with arrays should not throw, got {:?}", texts);
}

// ============================================================================
// WebGL2 bool coercion: colorMask / depthMask / vertexAttribPointer
// Fix: JS polyfill now sends actual booleans (!!val) instead of integers (? 1 : 0)
// ============================================================================

#[test]
fn color_mask_true_allows_clear_color() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        gl.colorMask(true, true, true, true);
        gl.clearColor(0.0, 1.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    "#).unwrap();
    rt.tick();
    let fb = rt.get_framebuffer();
    let px = pixel_at(fb, 64, 32, 32);
    assert!(px[1] > 200, "green channel should be ~255 with colorMask(true,...), got {}", px[1]);
}

#[test]
fn color_mask_accepts_boolean_without_error() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        gl.colorMask(false, true, false, true);
        gl.depthMask(false);
        gl.depthMask(true);
        globalThis.__err = gl.getError();
    "#).unwrap();
    rt.tick();
    let val = rt.evaluate("globalThis.__err").unwrap();
    let err = val.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_f64()).unwrap_or(-1.0);
    assert_eq!(err, 0.0, "colorMask/depthMask with booleans should not generate errors");
}

#[test]
fn vertex_attrib_pointer_normalized_accepted() {
    let mut rt = make_runtime(64, 64);
    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var gl = canvas.getContext('webgl2');
        var buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 64, gl.STATIC_DRAW);
        gl.vertexAttribPointer(0, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        globalThis.__err = gl.getError();
    "#).unwrap();
    rt.tick();
    let val = rt.evaluate("globalThis.__err").unwrap();
    let err = val.get("result").and_then(|r| r.get("value")).and_then(|v| v.as_f64()).unwrap_or(-1.0);
    assert_eq!(err, 0.0, "vertexAttribPointer with boolean normalized should not error");
}
