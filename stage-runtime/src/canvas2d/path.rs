use tiny_skia::PathBuilder;

/// Path operation enum — avoids String allocation per path command.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathOp {
    MoveTo,
    LineTo,
    BezierCurveTo,
    QuadraticCurveTo,
    Arc,
    ArcTo,
    Ellipse,
    Rect,
    ClosePath,
}

impl PathOp {
    /// Parse a string op name to enum. Returns None for unknown ops.
    pub fn from_str(s: &str) -> Option<PathOp> {
        match s {
            "moveTo" => Some(PathOp::MoveTo),
            "lineTo" => Some(PathOp::LineTo),
            "bezierCurveTo" => Some(PathOp::BezierCurveTo),
            "quadraticCurveTo" => Some(PathOp::QuadraticCurveTo),
            "arc" => Some(PathOp::Arc),
            "arcTo" => Some(PathOp::ArcTo),
            "ellipse" => Some(PathOp::Ellipse),
            "rect" | "rect_path" => Some(PathOp::Rect),
            "closePath" => Some(PathOp::ClosePath),
            _ => None,
        }
    }
}

/// Fixed-capacity argument buffer for path commands (max 8 args: ellipse has 8).
/// Avoids Vec heap allocation for every path command.
#[derive(Debug, Clone, Copy)]
pub struct PathArgs {
    data: [f64; 8],
    len: u8,
}

impl PathArgs {
    pub fn new() -> Self {
        PathArgs { data: [0.0; 8], len: 0 }
    }

    pub fn from_slice(s: &[f64]) -> Self {
        let mut args = PathArgs { data: [0.0; 8], len: s.len().min(8) as u8 };
        args.data[..args.len as usize].copy_from_slice(&s[..args.len as usize]);
        args
    }

    #[allow(dead_code)]
    pub fn as_slice(&self) -> &[f64] {
        &self.data[..self.len as usize]
    }

    pub fn len(&self) -> usize {
        self.len as usize
    }

    pub fn get(&self, i: usize) -> Option<&f64> {
        if i < self.len as usize { Some(&self.data[i]) } else { None }
    }
}

impl std::ops::Index<usize> for PathArgs {
    type Output = f64;
    fn index(&self, i: usize) -> &f64 {
        &self.data[i]
    }
}

/// Builds a tiny-skia path from a sequence of path commands.
pub fn build_path(commands: &[(PathOp, PathArgs)]) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    let mut has_subpath = false;
    let mut last_x: f32 = 0.0;
    let mut last_y: f32 = 0.0;

    for (cmd, args) in commands {
        match cmd {
            PathOp::MoveTo if args.len() >= 2 => {
                pb.move_to(args[0] as f32, args[1] as f32);
                has_subpath = true;
            }
            PathOp::LineTo if args.len() >= 2 => {
                pb.line_to(args[0] as f32, args[1] as f32);
                has_subpath = true;
            }
            PathOp::BezierCurveTo if args.len() >= 6 => {
                pb.cubic_to(
                    args[0] as f32, args[1] as f32,
                    args[2] as f32, args[3] as f32,
                    args[4] as f32, args[5] as f32,
                );
                has_subpath = true;
            }
            PathOp::QuadraticCurveTo if args.len() >= 4 => {
                pb.quad_to(
                    args[0] as f32, args[1] as f32,
                    args[2] as f32, args[3] as f32,
                );
                has_subpath = true;
            }
            PathOp::Arc if args.len() >= 5 => {
                let cx = args[0] as f32;
                let cy = args[1] as f32;
                let r = args[2] as f32;
                let start = args[3] as f32;
                let end = args[4] as f32;
                let ccw = args.get(5).map(|&v| v != 0.0).unwrap_or(false);
                add_arc(&mut pb, cx, cy, r, r, 0.0, start, end, ccw, has_subpath);
                has_subpath = true;
            }
            PathOp::Ellipse if args.len() >= 7 => {
                let cx = args[0] as f32;
                let cy = args[1] as f32;
                let rx = args[2] as f32;
                let ry = args[3] as f32;
                let rotation = args[4] as f32;
                let start = args[5] as f32;
                let end = args[6] as f32;
                let ccw = args.get(7).map(|&v| v != 0.0).unwrap_or(false);
                add_arc(&mut pb, cx, cy, rx, ry, rotation, start, end, ccw, has_subpath);
                has_subpath = true;
            }
            PathOp::Rect if args.len() >= 4 => {
                let x = args[0] as f32;
                let y = args[1] as f32;
                let w = args[2] as f32;
                let h = args[3] as f32;
                pb.move_to(x, y);
                pb.line_to(x + w, y);
                pb.line_to(x + w, y + h);
                pb.line_to(x, y + h);
                pb.close();
                has_subpath = true;
            }
            PathOp::ArcTo if args.len() >= 5 => {
                let x1 = args[0] as f32;
                let y1 = args[1] as f32;
                let x2 = args[2] as f32;
                let y2 = args[3] as f32;
                let radius = args[4] as f32;
                add_arc_to(&mut pb, x1, y1, x2, y2, radius, &mut last_x, &mut last_y);
                has_subpath = true;
            }
            PathOp::ClosePath => {
                pb.close();
            }
            _ => {}
        }
        // Track current point for arcTo
        update_last_point(*cmd, args, &mut last_x, &mut last_y);
    }

    pb.finish()
}

/// Track the last point in the path for arcTo computation.
fn update_last_point(cmd: PathOp, args: &PathArgs, last_x: &mut f32, last_y: &mut f32) {
    match cmd {
        PathOp::MoveTo | PathOp::LineTo if args.len() >= 2 => {
            *last_x = args[0] as f32;
            *last_y = args[1] as f32;
        }
        PathOp::BezierCurveTo if args.len() >= 6 => {
            *last_x = args[4] as f32;
            *last_y = args[5] as f32;
        }
        PathOp::QuadraticCurveTo if args.len() >= 4 => {
            *last_x = args[2] as f32;
            *last_y = args[3] as f32;
        }
        PathOp::Rect if args.len() >= 4 => {
            *last_x = args[0] as f32;
            *last_y = args[1] as f32;
        }
        _ => {}
    }
}

/// Implement arcTo(x1, y1, x2, y2, radius) per HTML Canvas spec.
///
/// Draws a straight line from the current point to the start of an arc tangent
/// to lines (x0,y0)→(x1,y1) and (x1,y1)→(x2,y2), then the arc itself.
fn add_arc_to(
    pb: &mut PathBuilder,
    x1: f32, y1: f32, x2: f32, y2: f32, radius: f32,
    last_x: &mut f32, last_y: &mut f32,
) {
    let x0 = *last_x;
    let y0 = *last_y;

    if radius < 1e-6 {
        pb.line_to(x1, y1);
        *last_x = x1;
        *last_y = y1;
        return;
    }

    // Vectors from the corner point (x1,y1)
    let v0x = x0 - x1;
    let v0y = y0 - y1;
    let v1x = x2 - x1;
    let v1y = y2 - y1;

    let len0 = (v0x * v0x + v0y * v0y).sqrt();
    let len1 = (v1x * v1x + v1y * v1y).sqrt();
    if len0 < 1e-6 || len1 < 1e-6 {
        pb.line_to(x1, y1);
        *last_x = x1;
        *last_y = y1;
        return;
    }

    // Unit vectors
    let n0x = v0x / len0;
    let n0y = v0y / len0;
    let n1x = v1x / len1;
    let n1y = v1y / len1;

    // Cross product determines which side the center is on
    let cross = n0x * n1y - n0y * n1x;
    if cross.abs() < 1e-6 {
        pb.line_to(x1, y1);
        *last_x = x1;
        *last_y = y1;
        return;
    }

    // The angle between the two vectors at the corner
    // Using atan2 of cross and dot for a signed angle
    let dot = n0x * n1x + n0y * n1y;
    let half = (cross).atan2(1.0 + dot); // half-angle via identity: atan2(sin, 1+cos) = half-angle

    // Distance from corner to tangent point
    let d = radius / half.tan().abs();

    // Tangent points
    let tp0x = x1 + n0x * d;
    let tp0y = y1 + n0y * d;
    let tp1x = x1 + n1x * d;
    let tp1y = y1 + n1y * d;

    // Center of the arc circle
    // Offset from the corner along the angle bisector
    let bisect_len = (radius * radius + d * d).sqrt();
    let bx = n0x + n1x;
    let by = n0y + n1y;
    let blen = (bx * bx + by * by).sqrt();
    if blen < 1e-6 {
        pb.line_to(x1, y1);
        *last_x = x1;
        *last_y = y1;
        return;
    }
    let cx = x1 + bx / blen * bisect_len;
    let cy = y1 + by / blen * bisect_len;

    // Start and end angles
    let start_angle = (tp0y - cy).atan2(tp0x - cx);
    let end_angle = (tp1y - cy).atan2(tp1x - cx);

    // Line to the first tangent point
    pb.line_to(tp0x, tp0y);

    // Determine arc direction: if cross > 0, the path turns left (CCW arc in screen coords)
    let ccw = cross > 0.0;
    add_arc(pb, cx, cy, radius, radius, 0.0, start_angle, end_angle, ccw, true);

    *last_x = tp1x;
    *last_y = tp1y;
}

/// Add an arc to the path builder using the same algorithm as Skia/Chrome.
///
/// For full circles (sweep ~= TAU) without rotation, uses tiny-skia's native
/// push_circle/push_oval for exact match with Chrome's Skia output.
///
/// For partial arcs, rotated ellipses, or CCW full circles, approximates using
/// quadratic bezier segments derived from conic sections.
///
/// `has_subpath`: when true, uses line_to (not move_to) to connect from the
/// current point to the arc start — matching Canvas 2D spec behavior where
/// arc() implicitly draws a line from the current point.
fn add_arc(
    pb: &mut PathBuilder,
    cx: f32, cy: f32, rx: f32, ry: f32,
    rotation: f32, start: f32, end: f32, ccw: bool,
    has_subpath: bool,
) {
    use std::f32::consts::{FRAC_PI_2, TAU};

    let mut sweep = end - start;
    if ccw {
        if sweep > 0.0 { sweep -= TAU; }
        // When sweep lands on exactly 0 but start != end, it's a full CCW circle
        if sweep.abs() < 0.001 && (end - start).abs() > 0.001 { sweep = -TAU; }
        if sweep < -TAU { sweep = -TAU; }
    } else {
        if sweep < 0.0 { sweep += TAU; }
        // When sweep lands on exactly 0 but start != end, it's a full CW circle
        if sweep.abs() < 0.001 && (end - start).abs() > 0.001 { sweep = TAU; }
        if sweep > TAU { sweep = TAU; }
    }

    // Always use segment decomposition to correctly handle:
    // - winding direction (CW vs CCW) for composite paths (e.g. donut shapes)
    // - rotation for full ellipses
    // - line_to connection from existing subpath to arc start
    //
    // Note: we previously used push_circle/push_oval for full CW circles
    // but it doesn't maintain proper path state for multi-arc paths.
    let segments = ((sweep.abs() / FRAC_PI_2).ceil() as i32).max(1);
    let seg_sweep = sweep / segments as f32;

    // Compute start point (applying rotation transform for ellipses)
    let (start_x, start_y) = arc_point(cx, cy, rx, ry, rotation, start);

    // Connect to start point.
    // For full circles (sweep ~= TAU), always start a new subpath with move_to.
    // This ensures winding-rule composites (e.g. donut shapes) work correctly,
    // as each full circle becomes its own subpath with distinct winding direction.
    // For partial arcs, use line_to to connect from the current point per Canvas 2D spec.
    let is_full = sweep.abs() >= TAU - 0.001;
    if has_subpath && !is_full {
        pb.line_to(start_x, start_y);
    } else {
        pb.move_to(start_x, start_y);
    }

    let mut angle = start;
    for _ in 0..segments {
        let end_angle = angle + seg_sweep;
        let half = seg_sweep / 2.0;

        // Conic weight for this arc segment
        let w = half.cos();

        let (p2x, p2y) = arc_point(cx, cy, rx, ry, rotation, end_angle);

        // Conic control point: intersection of tangent lines
        let mid_angle = angle + half;
        let raw_cpx = rx * mid_angle.cos() / w;
        let raw_cpy = ry * mid_angle.sin() / w;
        let (cpx, cpy) = if rotation.abs() > 0.001 {
            let cos_r = rotation.cos();
            let sin_r = rotation.sin();
            (cx + raw_cpx * cos_r - raw_cpy * sin_r,
             cy + raw_cpx * sin_r + raw_cpy * cos_r)
        } else {
            (cx + raw_cpx, cy + raw_cpy)
        };

        if w > 0.9 {
            let (p0x, p0y) = arc_point(cx, cy, rx, ry, rotation, angle);
            let qx = p0x + (cpx - p0x) * w;
            let qy = p0y + (cpy - p0y) * w;
            pb.quad_to(qx, qy, p2x, p2y);
        } else {
            let (p0x, p0y) = arc_point(cx, cy, rx, ry, rotation, angle);
            let mid_x = (p0x + 2.0 * w * cpx + p2x) / (2.0 * (1.0 + w));
            let mid_y = (p0y + 2.0 * w * cpy + p2y) / (2.0 * (1.0 + w));

            let q1x = (p0x + w * cpx) / (1.0 + w);
            let q1y = (p0y + w * cpy) / (1.0 + w);
            pb.quad_to(q1x, q1y, mid_x, mid_y);

            let q2x = (w * cpx + p2x) / (1.0 + w);
            let q2y = (w * cpy + p2y) / (1.0 + w);
            pb.quad_to(q2x, q2y, p2x, p2y);
        }

        angle = end_angle;
    }
}

/// Compute a point on an (optionally rotated) ellipse at the given angle.
fn arc_point(cx: f32, cy: f32, rx: f32, ry: f32, rotation: f32, angle: f32) -> (f32, f32) {
    let px = rx * angle.cos();
    let py = ry * angle.sin();
    if rotation.abs() > 0.001 {
        let cos_r = rotation.cos();
        let sin_r = rotation.sin();
        (cx + px * cos_r - py * sin_r, cy + px * sin_r + py * cos_r)
    } else {
        (cx + px, cy + py)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd(op: PathOp, args: &[f64]) -> (PathOp, PathArgs) {
        (op, PathArgs::from_slice(args))
    }

    #[test]
    fn empty_path() {
        let result = build_path(&[]);
        assert!(result.is_none(), "empty commands should return None");
    }

    #[test]
    fn simple_line() {
        let cmds = vec![
            cmd(PathOp::MoveTo, &[0.0, 0.0]),
            cmd(PathOp::LineTo, &[100.0, 100.0]),
        ];
        let path = build_path(&cmds).unwrap();
        let bounds = path.bounds();
        assert_eq!(bounds.left(), 0.0);
        assert_eq!(bounds.top(), 0.0);
        assert_eq!(bounds.right(), 100.0);
        assert_eq!(bounds.bottom(), 100.0);
    }

    #[test]
    fn rect_path() {
        let cmds = vec![
            cmd(PathOp::Rect, &[10.0, 20.0, 30.0, 40.0]),
        ];
        let path = build_path(&cmds).unwrap();
        let bounds = path.bounds();
        assert_eq!(bounds.left(), 10.0);
        assert_eq!(bounds.top(), 20.0);
        assert_eq!(bounds.width(), 30.0);
        assert_eq!(bounds.height(), 40.0);
    }

    #[test]
    fn bezier_curve() {
        let cmds = vec![
            cmd(PathOp::MoveTo, &[0.0, 0.0]),
            cmd(PathOp::BezierCurveTo, &[25.0, 50.0, 75.0, 50.0, 100.0, 0.0]),
        ];
        assert!(build_path(&cmds).is_some());
    }

    #[test]
    fn quad_curve() {
        let cmds = vec![
            cmd(PathOp::MoveTo, &[0.0, 0.0]),
            cmd(PathOp::QuadraticCurveTo, &[50.0, 100.0, 100.0, 0.0]),
        ];
        assert!(build_path(&cmds).is_some());
    }

    #[test]
    fn full_circle_uses_native() {
        let cmds = vec![
            cmd(PathOp::Arc, &[50.0, 50.0, 25.0, 0.0, std::f64::consts::PI * 2.0, 0.0]),
        ];
        let path = build_path(&cmds).unwrap();
        let b = path.bounds();
        assert!((b.left() - 25.0).abs() < 0.1);
        assert!((b.top() - 25.0).abs() < 0.1);
        assert!((b.width() - 50.0).abs() < 0.1);
        assert!((b.height() - 50.0).abs() < 0.1);
    }

    #[test]
    fn partial_arc() {
        let cmds = vec![
            cmd(PathOp::Arc, &[50.0, 50.0, 25.0, 0.0, std::f64::consts::PI, 0.0]),
        ];
        assert!(build_path(&cmds).is_some());
    }

    #[test]
    fn close_path() {
        let cmds = vec![
            cmd(PathOp::MoveTo, &[0.0, 0.0]),
            cmd(PathOp::LineTo, &[50.0, 0.0]),
            cmd(PathOp::LineTo, &[50.0, 50.0]),
            cmd(PathOp::ClosePath, &[]),
        ];
        assert!(build_path(&cmds).is_some());
    }

    #[test]
    fn insufficient_args_ignored() {
        let cmds = vec![
            cmd(PathOp::MoveTo, &[0.0]),
            cmd(PathOp::LineTo, &[10.0, 10.0]),
        ];
        assert!(build_path(&cmds).is_some());
    }
}
