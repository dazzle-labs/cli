use tiny_skia::{Color, LineCap, LineJoin, Transform};
use crate::htmlcss::style::{FontWeight, Opacity, CompositeOp};

/// A color stop for a gradient (offset 0..1, color).
#[derive(Clone, Debug)]
pub struct ColorStop {
    pub offset: f32,
    pub color: Color,
}

/// A stored gradient definition (linear or radial).
#[derive(Clone, Debug)]
pub enum GradientDef {
    Linear {
        x0: f32,
        y0: f32,
        x1: f32,
        y1: f32,
        stops: Vec<ColorStop>,
    },
    Radial {
        x0: f32,
        y0: f32,
        r0: f32,
        x1: f32,
        y1: f32,
        r1: f32,
        stops: Vec<ColorStop>,
    },
}

/// What the fill or stroke style is set to.
#[derive(Clone, Debug)]
pub enum PaintStyle {
    Color(Color),
    Gradient(String), // gradient ID
    Pattern(String),  // pattern ID
}

impl Default for PaintStyle {
    fn default() -> Self {
        PaintStyle::Color(Color::BLACK)
    }
}

/// Canvas 2D drawing state (pushed/popped by save/restore).
#[derive(Clone)]
pub struct DrawState {
    pub transform: Transform,
    pub fill_color: Color,
    pub stroke_color: Color,
    pub fill_style: PaintStyle,
    pub stroke_style: PaintStyle,
    pub line_width: f32,
    pub line_cap: LineCap,
    pub line_join: LineJoin,
    pub miter_limit: f32,
    pub global_alpha: Opacity,
    pub font_size: f32,
    pub font_family: String,
    pub font_weight: FontWeight,
    pub text_align: TextAlign,
    pub text_baseline: TextBaseline,
    pub shadow_blur: f32,
    pub shadow_color: Color,
    pub shadow_offset_x: f32,
    pub shadow_offset_y: f32,
    pub image_smoothing: bool,
    pub line_dash: Vec<f32>,
    pub line_dash_offset: f32,
    pub composite_op: CompositeOp,
    pub letter_spacing: f32,
}

impl Default for DrawState {
    fn default() -> Self {
        DrawState {
            transform: Transform::identity(),
            fill_color: Color::BLACK,
            stroke_color: Color::BLACK,
            fill_style: PaintStyle::default(),
            stroke_style: PaintStyle::default(),
            line_width: 1.0,
            line_cap: LineCap::Butt,
            line_join: LineJoin::Miter,
            miter_limit: 10.0,
            global_alpha: Opacity::FULL,
            font_size: 10.0,
            font_family: "sans-serif".to_string(),
            font_weight: FontWeight::NORMAL,
            text_align: TextAlign::Start,
            text_baseline: TextBaseline::Alphabetic,
            shadow_blur: 0.0,
            shadow_color: Color::from_rgba8(0, 0, 0, 0),
            shadow_offset_x: 0.0,
            shadow_offset_y: 0.0,
            image_smoothing: true,
            line_dash: Vec::new(),
            line_dash_offset: 0.0,
            composite_op: CompositeOp::default(),
            letter_spacing: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TextAlign {
    Start,
    End,
    Left,
    Right,
    Center,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TextBaseline {
    Top,
    Hanging,
    Middle,
    Alphabetic,
    Ideographic,
    Bottom,
}

/// Parse a CSS color string to tiny-skia Color.
pub fn parse_color(s: &str) -> Option<Color> {
    let s = s.trim();

    // All 148 CSS named colors
    if let Some(c) = parse_named_color(s) {
        return Some(c);
    }

    // #RGB, #RGBA, #RRGGBB, #RRGGBBAA
    if s.starts_with('#') {
        let hex = &s[1..];
        return match hex.len() {
            3 => {
                let r = u8::from_str_radix(&hex[0..1], 16).ok()? * 17;
                let g = u8::from_str_radix(&hex[1..2], 16).ok()? * 17;
                let b = u8::from_str_radix(&hex[2..3], 16).ok()? * 17;
                Some(Color::from_rgba8(r, g, b, 255))
            }
            4 => {
                let r = u8::from_str_radix(&hex[0..1], 16).ok()? * 17;
                let g = u8::from_str_radix(&hex[1..2], 16).ok()? * 17;
                let b = u8::from_str_radix(&hex[2..3], 16).ok()? * 17;
                let a = u8::from_str_radix(&hex[3..4], 16).ok()? * 17;
                Some(Color::from_rgba8(r, g, b, a))
            }
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
                Some(Color::from_rgba8(r, g, b, 255))
            }
            8 => {
                let r = u8::from_str_radix(&hex[0..2], 16).ok()?;
                let g = u8::from_str_radix(&hex[2..4], 16).ok()?;
                let b = u8::from_str_radix(&hex[4..6], 16).ok()?;
                let a = u8::from_str_radix(&hex[6..8], 16).ok()?;
                Some(Color::from_rgba8(r, g, b, a))
            }
            _ => None,
        };
    }

    // rgb(r, g, b) and rgba(r, g, b, a)
    if s.starts_with("rgb") {
        let inner = s.trim_start_matches("rgba(")
            .trim_start_matches("rgb(")
            .trim_end_matches(')');
        let parts: Vec<&str> = inner.split(|c| c == ',' || c == ' ' || c == '/')
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() >= 3 {
            let r = parts[0].trim().parse::<f32>().ok()?.min(255.0).max(0.0) as u8;
            let g = parts[1].trim().parse::<f32>().ok()?.min(255.0).max(0.0) as u8;
            let b = parts[2].trim().parse::<f32>().ok()?.min(255.0).max(0.0) as u8;
            let a = if parts.len() >= 4 {
                let av = parts[3].trim().parse::<f32>().ok()?.min(1.0).max(0.0);
                (av * 255.0).round() as u8
            } else {
                255
            };
            return Some(Color::from_rgba8(r, g, b, a));
        }
    }

    // hsl(h, s%, l%) — simplified conversion
    if s.starts_with("hsl") {
        let inner = s.trim_start_matches("hsla(")
            .trim_start_matches("hsl(")
            .trim_end_matches(')');
        let parts: Vec<&str> = inner.split(|c| c == ',' || c == ' ' || c == '/')
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() >= 3 {
            let h = parts[0].trim().trim_end_matches("deg").parse::<f32>().ok()? / 360.0;
            let s_val = parts[1].trim().trim_end_matches('%').parse::<f32>().ok()? / 100.0;
            let l = parts[2].trim().trim_end_matches('%').parse::<f32>().ok()? / 100.0;
            let a = if parts.len() >= 4 {
                parts[3].trim().parse::<f32>().ok()?.min(1.0).max(0.0)
            } else {
                1.0
            };
            let (r, g, b) = hsl_to_rgb(h, s_val, l);
            return Some(Color::from_rgba8(
                (r * 255.0).round() as u8, (g * 255.0).round() as u8, (b * 255.0).round() as u8, (a * 255.0).round() as u8,
            ));
        }
    }

    None
}


fn parse_named_color(s: &str) -> Option<Color> {
    let c = |r: u8, g: u8, b: u8| Some(Color::from_rgba8(r, g, b, 255));
    match s {
        "transparent" => Some(Color::from_rgba8(0, 0, 0, 0)),
        "black" => c(0, 0, 0),
        "white" => c(255, 255, 255),
        "red" => c(255, 0, 0),
        "green" => c(0, 128, 0),
        "blue" => c(0, 0, 255),
        "yellow" => c(255, 255, 0),
        "cyan" | "aqua" => c(0, 255, 255),
        "magenta" | "fuchsia" => c(255, 0, 255),
        "orange" => c(255, 165, 0),
        "purple" => c(128, 0, 128),
        "gray" | "grey" => c(128, 128, 128),
        "aliceblue" => c(240, 248, 255),
        "antiquewhite" => c(250, 235, 215),
        "aquamarine" => c(127, 255, 212),
        "azure" => c(240, 255, 255),
        "beige" => c(245, 245, 220),
        "bisque" => c(255, 228, 196),
        "blanchedalmond" => c(255, 235, 205),
        "blueviolet" => c(138, 43, 226),
        "brown" => c(165, 42, 42),
        "burlywood" => c(222, 184, 135),
        "cadetblue" => c(95, 158, 160),
        "chartreuse" => c(127, 255, 0),
        "chocolate" => c(210, 105, 30),
        "coral" => c(255, 127, 80),
        "cornflowerblue" => c(100, 149, 237),
        "cornsilk" => c(255, 248, 220),
        "crimson" => c(220, 20, 60),
        "darkblue" => c(0, 0, 139),
        "darkcyan" => c(0, 139, 139),
        "darkgoldenrod" => c(184, 134, 11),
        "darkgray" | "darkgrey" => c(169, 169, 169),
        "darkgreen" => c(0, 100, 0),
        "darkkhaki" => c(189, 183, 107),
        "darkmagenta" => c(139, 0, 139),
        "darkolivegreen" => c(85, 107, 47),
        "darkorange" => c(255, 140, 0),
        "darkorchid" => c(153, 50, 204),
        "darkred" => c(139, 0, 0),
        "darksalmon" => c(233, 150, 122),
        "darkseagreen" => c(143, 188, 143),
        "darkslateblue" => c(72, 61, 139),
        "darkslategray" | "darkslategrey" => c(47, 79, 79),
        "darkturquoise" => c(0, 206, 209),
        "darkviolet" => c(148, 0, 211),
        "deeppink" => c(255, 20, 147),
        "deepskyblue" => c(0, 191, 255),
        "dimgray" | "dimgrey" => c(105, 105, 105),
        "dodgerblue" => c(30, 144, 255),
        "firebrick" => c(178, 34, 34),
        "floralwhite" => c(255, 250, 240),
        "forestgreen" => c(34, 139, 34),
        "gainsboro" => c(220, 220, 220),
        "ghostwhite" => c(248, 248, 255),
        "gold" => c(255, 215, 0),
        "goldenrod" => c(218, 165, 32),
        "greenyellow" => c(173, 255, 47),
        "honeydew" => c(240, 255, 240),
        "hotpink" => c(255, 105, 180),
        "indianred" => c(205, 92, 92),
        "indigo" => c(75, 0, 130),
        "ivory" => c(255, 255, 240),
        "khaki" => c(240, 230, 140),
        "lavender" => c(230, 230, 250),
        "lavenderblush" => c(255, 240, 245),
        "lawngreen" => c(124, 252, 0),
        "lemonchiffon" => c(255, 250, 205),
        "lightblue" => c(173, 216, 230),
        "lightcoral" => c(240, 128, 128),
        "lightcyan" => c(224, 255, 255),
        "lightgoldenrodyellow" => c(250, 250, 210),
        "lightgray" | "lightgrey" => c(211, 211, 211),
        "lightgreen" => c(144, 238, 144),
        "lightpink" => c(255, 182, 193),
        "lightsalmon" => c(255, 160, 122),
        "lightseagreen" => c(32, 178, 170),
        "lightskyblue" => c(135, 206, 250),
        "lightslategray" | "lightslategrey" => c(119, 136, 153),
        "lightsteelblue" => c(176, 196, 222),
        "lightyellow" => c(255, 255, 224),
        "lime" => c(0, 255, 0),
        "limegreen" => c(50, 205, 50),
        "linen" => c(250, 240, 230),
        "maroon" => c(128, 0, 0),
        "mediumaquamarine" => c(102, 205, 170),
        "mediumblue" => c(0, 0, 205),
        "mediumorchid" => c(186, 85, 211),
        "mediumpurple" => c(147, 112, 219),
        "mediumseagreen" => c(60, 179, 113),
        "mediumslateblue" => c(123, 104, 238),
        "mediumspringgreen" => c(0, 250, 154),
        "mediumturquoise" => c(72, 209, 204),
        "mediumvioletred" => c(199, 21, 133),
        "midnightblue" => c(25, 25, 112),
        "mintcream" => c(245, 255, 250),
        "mistyrose" => c(255, 228, 225),
        "moccasin" => c(255, 228, 181),
        "navajowhite" => c(255, 222, 173),
        "navy" => c(0, 0, 128),
        "oldlace" => c(253, 245, 230),
        "olive" => c(128, 128, 0),
        "olivedrab" => c(107, 142, 35),
        "orangered" => c(255, 69, 0),
        "orchid" => c(218, 112, 214),
        "palegoldenrod" => c(238, 232, 170),
        "palegreen" => c(152, 251, 152),
        "paleturquoise" => c(175, 238, 238),
        "palevioletred" => c(219, 112, 147),
        "papayawhip" => c(255, 239, 213),
        "peachpuff" => c(255, 218, 185),
        "peru" => c(205, 133, 63),
        "pink" => c(255, 192, 203),
        "plum" => c(221, 160, 221),
        "powderblue" => c(176, 224, 230),
        "rebeccapurple" => c(102, 51, 153),
        "rosybrown" => c(188, 143, 143),
        "royalblue" => c(65, 105, 225),
        "saddlebrown" => c(139, 69, 19),
        "salmon" => c(250, 128, 114),
        "sandybrown" => c(244, 164, 96),
        "seagreen" => c(46, 139, 87),
        "seashell" => c(255, 245, 238),
        "sienna" => c(160, 82, 45),
        "silver" => c(192, 192, 192),
        "skyblue" => c(135, 206, 235),
        "slateblue" => c(106, 90, 205),
        "slategray" | "slategrey" => c(112, 128, 144),
        "snow" => c(255, 250, 250),
        "springgreen" => c(0, 255, 127),
        "steelblue" => c(70, 130, 180),
        "tan" => c(210, 180, 140),
        "teal" => c(0, 128, 128),
        "thistle" => c(216, 191, 216),
        "tomato" => c(255, 99, 71),
        "turquoise" => c(64, 224, 208),
        "violet" => c(238, 130, 238),
        "wheat" => c(245, 222, 179),
        "whitesmoke" => c(245, 245, 245),
        "yellowgreen" => c(154, 205, 50),
        _ => None,
    }
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s == 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    (
        hue_to_rgb(p, q, h + 1.0 / 3.0),
        hue_to_rgb(p, q, h),
        hue_to_rgb(p, q, h - 1.0 / 3.0),
    )
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 { t += 1.0; }
    if t > 1.0 { t -= 1.0; }
    if t < 1.0 / 6.0 { return p + (q - p) * 6.0 * t; }
    if t < 1.0 / 2.0 { return q; }
    if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_color(c: Option<Color>, r: u8, g: u8, b: u8, a: u8) {
        let c = c.expect("expected Some(Color)");
        // tiny-skia stores as premultiplied floats, compare with tolerance
        let to_u8 = |f: f32| (f * 255.0).round() as u8;
        assert_eq!(to_u8(c.red()), r, "red mismatch");
        assert_eq!(to_u8(c.green()), g, "green mismatch");
        assert_eq!(to_u8(c.blue()), b, "blue mismatch");
        assert_eq!(to_u8(c.alpha()), a, "alpha mismatch");
    }

    // --- Named colors ---
    #[test]
    fn parse_named_black() { assert_color(parse_color("black"), 0, 0, 0, 255); }
    #[test]
    fn parse_named_white() { assert_color(parse_color("white"), 255, 255, 255, 255); }
    #[test]
    fn parse_named_red() { assert_color(parse_color("red"), 255, 0, 0, 255); }
    #[test]
    fn parse_named_transparent() { assert_color(parse_color("transparent"), 0, 0, 0, 0); }

    // --- Hex ---
    #[test]
    fn parse_hex_3() { assert_color(parse_color("#f00"), 255, 0, 0, 255); }
    #[test]
    fn parse_hex_4() { assert_color(parse_color("#f008"), 255, 0, 0, 136); }
    #[test]
    fn parse_hex_6() { assert_color(parse_color("#ff8000"), 255, 128, 0, 255); }
    #[test]
    fn parse_hex_8() { assert_color(parse_color("#ff800080"), 255, 128, 0, 128); }
    #[test]
    fn parse_hex_case_insensitive() { assert_color(parse_color("#FF0000"), 255, 0, 0, 255); }

    // --- rgb/rgba ---
    #[test]
    fn parse_rgb() { assert_color(parse_color("rgb(128, 64, 32)"), 128, 64, 32, 255); }
    #[test]
    fn parse_rgba() {
        let c = parse_color("rgba(255, 0, 0, 0.5)").unwrap();
        let to_u8 = |f: f32| (f * 255.0).round() as u8;
        assert_eq!(to_u8(c.red()), 255);
        assert_eq!(to_u8(c.green()), 0);
        assert_eq!(to_u8(c.blue()), 0);
        // Alpha: 0.5 * 255 = 127.5, rounding may give 127 or 128
        assert!((to_u8(c.alpha()) as i32 - 127).abs() <= 1, "alpha ~127-128");
    }
    #[test]
    fn parse_rgb_no_spaces() { assert_color(parse_color("rgb(10,20,30)"), 10, 20, 30, 255); }

    // --- hsl ---
    #[test]
    fn parse_hsl_red() {
        let c = parse_color("hsl(0, 100%, 50%)").unwrap();
        // Red = hsl(0, 100%, 50%)
        assert!((c.red() - 1.0).abs() < 0.02, "expected red ~1.0, got {}", c.red());
        assert!(c.green() < 0.02, "expected green ~0, got {}", c.green());
        assert!(c.blue() < 0.02, "expected blue ~0, got {}", c.blue());
    }
    #[test]
    fn parse_hsl_gray() {
        let c = parse_color("hsl(0, 0%, 50%)").unwrap();
        assert!((c.red() - 0.5).abs() < 0.02);
        assert!((c.green() - 0.5).abs() < 0.02);
        assert!((c.blue() - 0.5).abs() < 0.02);
    }

    // --- Edge cases ---
    #[test]
    fn parse_empty() { assert!(parse_color("").is_none()); }
    #[test]
    fn parse_invalid() { assert!(parse_color("notacolor").is_none()); }
    #[test]
    fn parse_whitespace() { assert_color(parse_color("  black  "), 0, 0, 0, 255); }
    #[test]
    fn parse_bad_hex() { assert!(parse_color("#xyz").is_none()); }
    #[test]
    fn parse_hex_wrong_length() { assert!(parse_color("#12345").is_none()); }

    // --- DrawState defaults ---
    #[test]
    fn default_state() {
        let s = DrawState::default();
        assert_eq!(s.line_width, 1.0);
        assert_eq!(s.global_alpha, Opacity::FULL);
        assert_eq!(s.font_size, 10.0);
        assert_eq!(s.text_align, TextAlign::Start);
        assert_eq!(s.text_baseline, TextBaseline::Alphabetic);
        assert_eq!(s.shadow_blur, 0.0);
        assert!(s.image_smoothing);
        assert!(s.line_dash.is_empty());
    }
}
