//! Canvas 2D + dazzle event system tests: external events drive 2D rendering.
//!
//! Run: cargo test --test canvas2d_event_test
//! Video: DAZZLE_TEST_VIDEO_DIR=./test_videos cargo test --test canvas2d_event_test

mod test_harness;
use test_harness::*;

#[test]
fn event_changes_fill_color() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("event_fill_color", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var color = '#000000';

        window.addEventListener('set-color', function(e) {
            color = e.detail.color;
        });

        function draw() {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 64, 64);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Default: black
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] < 10 && px[1] < 10 && px[2] < 10,
        "should be black before event, got {:?}", px);

    // dazzle s ev e set-color '{"color":"#ff0000"}'
    rt.dispatch_event("set-color", r##"{"color": "#ff0000"}"##).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[0] > 240, "should be red after event, got {:?}", px);

    // dazzle s ev e set-color '{"color":"#00ff00"}'
    rt.dispatch_event("set-color", r##"{"color": "#00ff00"}"##).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let px = pixel_at(rt.get_framebuffer(), 64, 32, 32);
    assert!(px[1] > 240, "should be green after second event, got {:?}", px);
    rec.finish();
}

#[test]
fn event_moves_rectangle() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("event_moves_rect", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var pos = { x: 0, y: 0 };

        window.addEventListener('move', function(e) {
            pos.x = e.detail.x;
            pos.y = e.detail.y;
        });

        function draw() {
            ctx.clearRect(0, 0, 64, 64);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(pos.x, pos.y, 16, 16);
            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Default position (0,0) — red at top-left
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let fb = rt.get_framebuffer();
    assert!(pixel_at(fb, 64, 8, 8)[0] > 240, "should have red at (8,8), got {:?}", pixel_at(fb, 64, 8, 8));
    assert!(pixel_at(fb, 64, 48, 48)[0] < 10, "should be clear at (48,48)");

    // Move to bottom-right
    rt.dispatch_event("move", r#"{"x": 40, "y": 40}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let fb = rt.get_framebuffer();
    assert!(pixel_at(fb, 64, 48, 48)[0] > 240, "should have red at (48,48) after move, got {:?}", pixel_at(fb, 64, 48, 48));
    assert!(pixel_at(fb, 64, 8, 8)[0] < 10, "old position should be clear");
    rec.finish();
}

#[test]
fn event_builds_bar_chart() {
    let mut rt = make_runtime(128, 64);
    let mut rec = FrameRecorder::new("event_bar_chart", 128, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var values = [0, 0, 0, 0];
        var colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];

        window.addEventListener('data', function(e) {
            values = e.detail.values;
        });

        function draw() {
            ctx.clearRect(0, 0, 128, 64);

            var barWidth = 128 / values.length;
            for (var i = 0; i < values.length; i++) {
                var height = values[i] * 64;
                ctx.fillStyle = colors[i];
                ctx.fillRect(i * barWidth, 64 - height, barWidth, height);
            }

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // No data yet — should be empty
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let px = pixel_at(rt.get_framebuffer(), 128, 64, 32);
    assert!(px[3] < 10, "should be empty before data, got {:?}", px);

    // Send data: first bar tall, others short
    rt.dispatch_event("data", r#"{"values": [1.0, 0.25, 0.5, 0.75]}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());

    let fb = rt.get_framebuffer();
    // First bar (red) should fill full height — check near bottom
    let px_bar0 = pixel_at(fb, 128, 16, 60);
    assert!(px_bar0[0] > 240, "bar 0 bottom should be red, got {:?}", px_bar0);

    // Second bar (green) is 25% height — check near bottom (should be green)
    let px_bar1_bottom = pixel_at(fb, 128, 48, 60);
    assert!(px_bar1_bottom[1] > 240, "bar 1 bottom should be green, got {:?}", px_bar1_bottom);
    // ... but top should be clear (only 25% tall)
    let px_bar1_top = pixel_at(fb, 128, 48, 10);
    assert!(px_bar1_top[3] < 10, "bar 1 top should be clear, got {:?}", px_bar1_top);

    // Third bar (blue) is 50% tall
    let px_bar2 = pixel_at(fb, 128, 80, 40);
    assert!(px_bar2[2] > 240, "bar 2 mid should be blue, got {:?}", px_bar2);

    // Update data — bars change
    rt.dispatch_event("data", r#"{"values": [0.0, 1.0, 0.0, 1.0]}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());

    let fb = rt.get_framebuffer();
    // First bar gone
    let px_bar0 = pixel_at(fb, 128, 16, 32);
    assert!(px_bar0[0] < 10, "bar 0 should be gone, got {:?}", px_bar0);
    // Second bar full
    let px_bar1 = pixel_at(fb, 128, 48, 4);
    assert!(px_bar1[1] > 240, "bar 1 should be full green, got {:?}", px_bar1);
    rec.finish();
}

#[test]
fn event_animated_path() {
    let mut rt = make_runtime(64, 64);
    let mut rec = FrameRecorder::new("event_animated_path", 64, 64);

    rt.load_js("<test>", r#"
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');

        var radius = 10;

        window.addEventListener('set-radius', function(e) {
            radius = e.detail.r;
        });

        function draw() {
            ctx.clearRect(0, 0, 64, 64);

            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.arc(32, 32, radius, 0, Math.PI * 2);
            ctx.fill();

            requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
    "#).unwrap();

    // Small circle (radius=10)
    for _ in 0..3 {
        rt.tick();
        rec.capture(rt.get_framebuffer());
    }
    let fb = rt.get_framebuffer();
    // Center should be magenta
    let px_center = pixel_at(fb, 64, 32, 32);
    assert!(px_center[0] > 200 && px_center[2] > 200, "center should be magenta, got {:?}", px_center);
    // Far corner should be clear (radius=10, center at 32,32)
    let px_far = pixel_at(fb, 64, 2, 2);
    assert!(px_far[3] < 10, "corner should be clear with small radius, got {:?}", px_far);

    // Grow the circle
    rt.dispatch_event("set-radius", r#"{"r": 30}"#).unwrap();
    rt.tick(); rec.capture(rt.get_framebuffer());
    rt.tick(); rec.capture(rt.get_framebuffer());
    let fb = rt.get_framebuffer();
    // Now the corner (2,2) is within radius 30 of center (32,32) — distance ~42, so still outside
    // But (10,32) is within radius 30 of (32,32) — distance 22 < 30
    let px_edge = pixel_at(fb, 64, 10, 32);
    assert!(px_edge[0] > 200, "edge should now be magenta with large radius, got {:?}", px_edge);
    rec.finish();
}
