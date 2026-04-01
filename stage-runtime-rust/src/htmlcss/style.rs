//! CSS parsing and cascade resolution.
//!
//! Parses a subset of CSS sufficient for common layouts:
//! selectors (tag, .class, #id, *), properties (display, margin, padding,
//! background, color, font, border, width/height, grid, gap, etc.).

use std::collections::HashMap;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use tiny_skia::Color;

use super::dom;
use crate::canvas2d::state::parse_color;

/// Default root font size (px) for resolving `rem` units.
pub const ROOT_FONT_SIZE: f32 = 16.0;

/// Maximum length of a single CSS custom property value (bytes).
const MAX_CUSTOM_PROPERTY_LEN: usize = 4096;
/// Maximum number of distinct CSS custom properties per element.
const MAX_CUSTOM_PROPERTIES: usize = 1000;
/// Maximum aggregate size of all custom property values per element (bytes).
const MAX_CUSTOM_PROPERTIES_TOTAL_BYTES: usize = 4 * 1024 * 1024;

/// Viewport dimensions for resolving `vw`/`vh`/`%` units.
#[derive(Clone, Copy, Debug)]
pub struct Viewport {
    pub w: f32,
    pub h: f32,
    /// Root font size for resolving `rem` units (default: 16px).
    pub root_font_size: f32,
}

impl Viewport {
    pub const DEFAULT: Self = Self { w: 1280.0, h: 720.0, root_font_size: ROOT_FONT_SIZE };
}

/// A resolved pixel value (always in device pixels).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Px(pub f32);

impl Px {
    pub fn val(self) -> f32 { self.0 }
}

/// A CSS angle in degrees.
#[derive(Clone, Copy, Debug)]
pub struct Angle {
    pub degrees: f32,
}

impl Angle {
    pub fn deg(d: f32) -> Self { Self { degrees: d } }
    pub fn rad(r: f32) -> Self { Self { degrees: r.to_degrees() } }
    pub fn to_radians(&self) -> f32 { self.degrees.to_radians() }
}

/// A normalized fraction clamped to 0.0–1.0 (for gradient stops, etc.).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fraction(f32);

impl Fraction {
    pub fn new(v: f32) -> Self { Self(v.clamp(0.0, 1.0)) }
    pub fn unclamped(v: f32) -> Self { Self(v) } // for gradient positions that may need >1.0
    pub fn value(&self) -> f32 { self.0 }
}

/// A positioned rectangle in resolved pixels.
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

// ---------------------------------------------------------------------------
// Computed style
// ---------------------------------------------------------------------------

/// A resolved set of CSS properties for a single element.
#[derive(Clone, Debug)]
pub struct ComputedStyle {
    pub display: Display,
    pub position: Position,
    pub box_sizing: BoxSizing,
    pub width: Dimension,
    pub height: Dimension,
    pub min_width: Dimension,
    pub min_height: Dimension,
    pub max_width: Dimension,
    pub max_height: Dimension,

    pub margin_top: Dimension,
    pub margin_right: Dimension,
    pub margin_bottom: Dimension,
    pub margin_left: Dimension,

    pub padding_top: Dimension,
    pub padding_right: Dimension,
    pub padding_bottom: Dimension,
    pub padding_left: Dimension,

    pub border_top_width: Dimension,
    pub border_right_width: Dimension,
    pub border_bottom_width: Dimension,
    pub border_left_width: Dimension,
    pub border_top_color: Color,
    pub border_right_color: Color,
    pub border_bottom_color: Color,
    pub border_left_color: Color,
    pub border_top_style: BorderStyle,
    pub border_right_style: BorderStyle,
    pub border_bottom_style: BorderStyle,
    pub border_left_style: BorderStyle,
    /// Per-corner border-radius: (top-left, top-right, bottom-right, bottom-left).
    pub border_radius: [Dimension; 4],

    pub background_color: Color,
    pub background_gradient: Option<LinearGradient>,
    pub background_radial_gradient: Option<RadialGradient>,

    pub color: Color,
    pub font_size: f32,
    pub font_weight: FontWeight,
    pub font_family: Option<String>,
    /// Line height as a unitless ratio of font-size (e.g., 1.2 = 120%).
    /// CSS `line-height: 24px` is converted to ratio at parse time.
    pub line_height: f32,
    pub opacity: Opacity,
    pub overflow_hidden: bool,

    // Position offsets (for absolute/fixed positioning)
    pub top: Dimension,
    pub right: Dimension,
    pub bottom: Dimension,
    pub left: Dimension,

    // Flexbox
    pub flex_direction: FlexDirection,
    pub flex_wrap: FlexWrap,
    pub flex_grow: f32,
    pub flex_shrink: f32,
    /// flex-basis: the initial main size of the flex item (Auto = content-based).
    pub flex_basis: Dimension,
    pub align_items: AlignItems,
    pub align_content: AlignContent,
    pub justify_content: JustifyContent,

    // Grid
    pub grid_template_columns: Vec<GridTrackEntry>,
    pub grid_template_rows: Vec<GridTrackEntry>,
    pub gap_row: Dimension,
    pub gap_column: Dimension,
    /// Grid placement (None = auto placement).
    pub grid_column_start: Option<i16>,
    pub grid_column_end: Option<i16>,
    pub grid_row_start: Option<i16>,
    pub grid_row_end: Option<i16>,

    // Text
    pub text_align: TextAlign,
    pub text_transform: TextTransform,
    pub text_decoration: TextDecoration,
    pub text_decoration_color: Option<Color>,
    pub font_style: FontStyle,
    pub letter_spacing: f32,
    pub text_overflow_ellipsis: bool,
    pub white_space: WhiteSpace,
    pub vertical_align: VerticalAlign,
    pub line_clamp: Option<u32>,

    // Transform
    pub transform: Option<tiny_skia::Transform>,
    pub transform_origin_x: f32, // fraction 0.0–1.0 (default 0.5 = 50%)
    pub transform_origin_y: f32,
    /// Deferred percentage-based translate (fraction of element's own size).
    /// Applied on top of `transform` at paint time when element dimensions are known.
    pub transform_translate_pct: Option<(f32, f32)>,

    // CSS custom properties (inherited)
    pub custom_properties: HashMap<String, String>,

    /// Root font-size for rem resolution (inherited from html element, default 16px).
    pub root_font_size: f32,

    // Clip path
    pub clip_path: ClipPath,

    // Effects
    pub backdrop_filter_blur: Option<f32>,
    pub box_shadows: Vec<BoxShadow>,
    pub filters: Vec<CssFilter>,
    pub blend_mode: BlendMode,
    pub text_shadows: Vec<TextShadow>,

    // Stacking
    pub z_index: i32,

    // Content property (for ::before / ::after pseudo-elements)
    pub content: Option<String>,
}

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

/// CSS font-weight: 100–900 clamped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FontWeight(u16);

impl FontWeight {
    pub const NORMAL: Self = Self(400);
    pub const BOLD: Self = Self(700);

    pub fn new(w: u16) -> Self { Self(w.clamp(100, 900)) }
    pub fn value(&self) -> u16 { self.0 }
    pub fn is_bold(&self) -> bool { self.0 >= 600 }

    pub fn parse(s: &str) -> Self {
        match s {
            "bold" | "bolder" => Self::BOLD,
            "normal" => Self::NORMAL,
            "lighter" => Self(300),
            _ => Self::new(s.parse().unwrap_or(400)),
        }
    }
}

/// Clamped 0.0–1.0 opacity / alpha value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Opacity(f32);

impl Opacity {
    pub const FULL: Self = Self(1.0);
    pub const ZERO: Self = Self(0.0);

    pub fn new(v: f32) -> Self { Self(v.clamp(0.0, 1.0)) }
    pub fn value(&self) -> f32 { self.0 }
    pub fn is_visible(&self) -> bool { self.0 > 0.0 }
}

impl Default for Opacity {
    fn default() -> Self { Self::FULL }
}

/// Canvas globalCompositeOperation as a proper enum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CompositeOp {
    SourceOver, SourceIn, SourceOut, SourceAtop,
    DestinationOver, DestinationIn, DestinationOut, DestinationAtop,
    Lighter, Xor, Copy,
    Multiply, Screen, Overlay, Darken, Lighten,
    ColorDodge, ColorBurn, HardLight, SoftLight,
    Difference, Exclusion,
    Hue, Saturation, ColorOp, Luminosity,
}

impl CompositeOp {
    pub fn parse(s: &str) -> Self {
        match s {
            "source-over" => Self::SourceOver,
            "source-in" => Self::SourceIn,
            "source-out" => Self::SourceOut,
            "source-atop" => Self::SourceAtop,
            "destination-over" => Self::DestinationOver,
            "destination-in" => Self::DestinationIn,
            "destination-out" => Self::DestinationOut,
            "destination-atop" => Self::DestinationAtop,
            "lighter" => Self::Lighter,
            "xor" => Self::Xor,
            "copy" => Self::Copy,
            "multiply" => Self::Multiply,
            "screen" => Self::Screen,
            "overlay" => Self::Overlay,
            "darken" => Self::Darken,
            "lighten" => Self::Lighten,
            "color-dodge" => Self::ColorDodge,
            "color-burn" => Self::ColorBurn,
            "hard-light" => Self::HardLight,
            "soft-light" => Self::SoftLight,
            "difference" => Self::Difference,
            "exclusion" => Self::Exclusion,
            "hue" => Self::Hue,
            "saturation" => Self::Saturation,
            "color" => Self::ColorOp,
            "luminosity" => Self::Luminosity,
            _ => Self::SourceOver,
        }
    }

    pub fn to_blend_mode(&self) -> tiny_skia::BlendMode {
        use tiny_skia::BlendMode;
        match self {
            Self::SourceOver => BlendMode::SourceOver,
            Self::SourceIn => BlendMode::SourceIn,
            Self::SourceOut => BlendMode::SourceOut,
            Self::SourceAtop => BlendMode::SourceAtop,
            Self::DestinationOver => BlendMode::DestinationOver,
            Self::DestinationIn => BlendMode::DestinationIn,
            Self::DestinationOut => BlendMode::DestinationOut,
            Self::DestinationAtop => BlendMode::DestinationAtop,
            Self::Lighter => BlendMode::Plus,
            Self::Xor => BlendMode::Xor,
            Self::Copy => BlendMode::Source,
            Self::Multiply => BlendMode::Multiply,
            Self::Screen => BlendMode::Screen,
            Self::Overlay => BlendMode::Overlay,
            Self::Darken => BlendMode::Darken,
            Self::Lighten => BlendMode::Lighten,
            Self::ColorDodge => BlendMode::ColorDodge,
            Self::ColorBurn => BlendMode::ColorBurn,
            Self::HardLight => BlendMode::HardLight,
            Self::SoftLight => BlendMode::SoftLight,
            Self::Difference => BlendMode::Difference,
            Self::Exclusion => BlendMode::Exclusion,
            Self::Hue => BlendMode::Hue,
            Self::Saturation => BlendMode::Saturation,
            Self::ColorOp => BlendMode::Color,
            Self::Luminosity => BlendMode::Luminosity,
        }
    }

    /// Returns true for Porter-Duff composite ops that require destination masking.
    /// These ops must erase destination pixels outside the intersection, which
    /// fill_rect/fill_path can't do (they only touch pixels within the shape bounds).
    /// The fix is to render to a temp pixmap first, then composite with draw_pixmap.
    pub fn needs_masking(&self) -> bool {
        matches!(self,
            Self::SourceIn | Self::SourceOut |
            Self::DestinationIn | Self::DestinationOut |
            Self::SourceAtop | Self::DestinationAtop
        )
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SourceOver => "source-over",
            Self::SourceIn => "source-in",
            Self::SourceOut => "source-out",
            Self::SourceAtop => "source-atop",
            Self::DestinationOver => "destination-over",
            Self::DestinationIn => "destination-in",
            Self::DestinationOut => "destination-out",
            Self::DestinationAtop => "destination-atop",
            Self::Lighter => "lighter",
            Self::Xor => "xor",
            Self::Copy => "copy",
            Self::Multiply => "multiply",
            Self::Screen => "screen",
            Self::Overlay => "overlay",
            Self::Darken => "darken",
            Self::Lighten => "lighten",
            Self::ColorDodge => "color-dodge",
            Self::ColorBurn => "color-burn",
            Self::HardLight => "hard-light",
            Self::SoftLight => "soft-light",
            Self::Difference => "difference",
            Self::Exclusion => "exclusion",
            Self::Hue => "hue",
            Self::Saturation => "saturation",
            Self::ColorOp => "color",
            Self::Luminosity => "luminosity",
        }
    }
}

impl Default for CompositeOp {
    fn default() -> Self { Self::SourceOver }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum TextTransform {
    #[default]
    None,
    Uppercase,
    Lowercase,
    Capitalize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum TextDecoration {
    #[default]
    None,
    Underline,
    LineThrough,
    Overline,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum FontStyle {
    #[default]
    Normal,
    Italic,
}

// ---------------------------------------------------------------------------
// HTML tag names as constants (prevents typos in string matching)
// ---------------------------------------------------------------------------

pub mod tag {
    pub const HTML: &str = "html";
    pub const BODY: &str = "body";
    pub const HEAD: &str = "head";
    pub const STYLE: &str = "style";
    pub const SCRIPT: &str = "script";
    pub const LINK: &str = "link";
    pub const META: &str = "meta";
    pub const TITLE: &str = "title";
    pub const DIV: &str = "div";
    pub const SPAN: &str = "span";
    pub const P: &str = "p";
    pub const A: &str = "a";
    pub const H1: &str = "h1";
    pub const H2: &str = "h2";
    pub const H3: &str = "h3";
    pub const EM: &str = "em";
    pub const STRONG: &str = "strong";
    pub const B: &str = "b";
    pub const I: &str = "i";
    pub const UL: &str = "ul";
    pub const LI: &str = "li";
    pub const HEADER: &str = "header";
    pub const FOOTER: &str = "footer";
    pub const SECTION: &str = "section";
    pub const ARTICLE: &str = "article";
    pub const SVG: &str = "svg";
    pub const BR: &str = "br";
    pub const IMG: &str = "img";

    /// Tags that are non-visual and should be skipped during styling.
    pub const NON_VISUAL: &[&str] = &[SCRIPT, STYLE, HEAD, META, LINK, TITLE];

    /// Tags that default to inline display.
    pub const INLINE: &[&str] = &[SPAN, A, EM, STRONG, B, I];
}

// ---------------------------------------------------------------------------
// CSS enum types
// ---------------------------------------------------------------------------

/// CSS clip-path property value.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum ClipPath {
    #[default]
    None,
    /// `circle(r)` — radius is a fraction of the element's reference box.
    /// `circle(50%)` → radius = 0.5 (50% of min(width, height) / 2, i.e., 25% of min dim).
    Circle { radius: f32 },
    /// `polygon(x1 y1, x2 y2, ...)` — points as fractions of element (width, height).
    Polygon { points: Vec<(f32, f32)> },
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Display { Block, Flex, Grid, Inline, InlineBlock, None }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Position { Static, Relative, Absolute, Fixed }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BoxSizing { ContentBox, BorderBox }

/// CSS border-style values.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BorderStyle {
    #[default]
    Solid,
    Dashed,
    Dotted,
    Double,
    None,
}

impl BorderStyle {
    pub fn parse(s: &str) -> Self {
        match s {
            "solid"  => Self::Solid,
            "dashed" => Self::Dashed,
            "dotted" => Self::Dotted,
            "double" => Self::Double,
            "none" | "hidden" => Self::None,
            _ => Self::Solid,
        }
    }
}

/// A CSS length value preserving its original unit for correct resolution
/// at layout/paint time.
#[derive(Clone, Copy, Debug)]
pub enum Dimension {
    Auto,
    Px(f32),
    Percent(f32), // 0.0–1.0 fraction
    Em(f32),      // relative to element's font-size
    Rem(f32),     // relative to root font-size (16px)
    Vw(f32),      // percentage of viewport width (raw 0–100)
    Vh(f32),      // percentage of viewport height (raw 0–100)
    Fr(f32),      // flex fraction (grid tracks only)
    /// calc() result as linear combination: `percent_frac * reference + px_offset`.
    /// E.g. `calc(100% - 40px)` → `Calc(1.0, -40.0)`.
    Calc(f32, f32),
}

impl Dimension {
    /// Resolve to px. `reference` is the % base (parent width for horizontal, height for vertical).
    pub fn resolve(&self, reference: f32, font_size: f32, vp: Viewport) -> f32 {
        match self {
            Dimension::Auto => 0.0,
            Dimension::Px(v) => *v,
            Dimension::Percent(frac) => frac * reference,
            Dimension::Em(v) => v * font_size,
            Dimension::Rem(v) => v * vp.root_font_size,
            Dimension::Vw(v) => v / 100.0 * vp.w,
            Dimension::Vh(v) => v / 100.0 * vp.h,
            Dimension::Fr(_) => 0.0, // only meaningful in grid track context
            Dimension::Calc(frac, px) => frac * reference + px,
        }
    }

    pub fn is_auto(&self) -> bool { matches!(self, Dimension::Auto) }
    pub fn zero() -> Self { Dimension::Px(0.0) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FlexDirection { Row, Column, RowReverse, ColumnReverse }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum FlexWrap { NoWrap, Wrap }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AlignItems { Stretch, FlexStart, FlexEnd, Center, Baseline }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AlignContent { Normal, Stretch, FlexStart, FlexEnd, Center, SpaceBetween, SpaceAround, SpaceEvenly }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum JustifyContent { FlexStart, FlexEnd, Center, SpaceBetween, SpaceAround, SpaceEvenly }

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TextAlign { Left, Center, Right }

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub enum WhiteSpace {
    #[default]
    Normal,
    Nowrap,
    Pre,
    PreWrap,
    PreLine,
}

#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub enum VerticalAlign {
    #[default]
    Baseline,
    Middle,
    Top,
    Bottom,
}

/// A single grid track sizing value with separate min and max (for minmax()).
#[derive(Clone, Copy, Debug)]
pub struct GridTrackDef {
    pub min: Dimension,
    pub max: Dimension,
}

impl GridTrackDef {
    pub fn single(d: Dimension) -> Self {
        Self { min: d, max: d }
    }
}

/// How a `repeat()` should be expanded.
#[derive(Clone, Copy, Debug)]
pub enum GridRepeatKind {
    /// Fixed count: `repeat(3, ...)`
    Count(u16),
    /// `repeat(auto-fill, ...)`
    AutoFill,
    /// `repeat(auto-fit, ...)`
    AutoFit,
}

/// An entry in a grid-template-columns / grid-template-rows list.
#[derive(Clone, Debug)]
pub enum GridTrackEntry {
    /// A single track sizing function (possibly minmax).
    Single(GridTrackDef),
    /// A repeat(...) with a kind and one or more track defs.
    Repeat(GridRepeatKind, Vec<GridTrackDef>),
}

#[derive(Clone, Debug)]
pub struct BoxShadow {
    pub offset_x: f32,
    pub offset_y: f32,
    pub blur: f32,
    pub spread: f32,
    pub color: Color,
    pub inset: bool,
}

/// A single CSS `filter` function.
#[derive(Clone, Debug)]
pub enum CssFilter {
    /// `blur(Npx)` — Gaussian blur with sigma=N.
    Blur(f32),
    /// `grayscale(N)` — 0.0 = no effect, 1.0 = fully grayscale.
    Grayscale(f32),
    /// `brightness(N)` — 1.0 = no change, >1 brightens, <1 darkens.
    Brightness(f32),
    /// `contrast(N)` — 1.0 = no change.
    Contrast(f32),
    /// `drop-shadow(offset_x offset_y blur color)`
    DropShadow { offset_x: f32, offset_y: f32, blur: f32, color: Color },
}

/// CSS `mix-blend-mode` property.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum BlendMode {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
}

impl BlendMode {
    pub fn parse(s: &str) -> Self {
        match s {
            "multiply"    => Self::Multiply,
            "screen"      => Self::Screen,
            "overlay"     => Self::Overlay,
            "darken"      => Self::Darken,
            "lighten"     => Self::Lighten,
            "color-dodge" => Self::ColorDodge,
            "color-burn"  => Self::ColorBurn,
            "hard-light"  => Self::HardLight,
            "soft-light"  => Self::SoftLight,
            "difference"  => Self::Difference,
            "exclusion"   => Self::Exclusion,
            _             => Self::Normal,
        }
    }

    pub fn to_tiny_skia(&self) -> tiny_skia::BlendMode {
        match self {
            Self::Normal     => tiny_skia::BlendMode::SourceOver,
            Self::Multiply   => tiny_skia::BlendMode::Multiply,
            Self::Screen     => tiny_skia::BlendMode::Screen,
            Self::Overlay    => tiny_skia::BlendMode::Overlay,
            Self::Darken     => tiny_skia::BlendMode::Darken,
            Self::Lighten    => tiny_skia::BlendMode::Lighten,
            Self::ColorDodge => tiny_skia::BlendMode::ColorDodge,
            Self::ColorBurn  => tiny_skia::BlendMode::ColorBurn,
            Self::HardLight  => tiny_skia::BlendMode::HardLight,
            Self::SoftLight  => tiny_skia::BlendMode::SoftLight,
            Self::Difference => tiny_skia::BlendMode::Difference,
            Self::Exclusion  => tiny_skia::BlendMode::Exclusion,
        }
    }
}

/// A single CSS `text-shadow` entry.
#[derive(Clone, Debug)]
pub struct TextShadow {
    pub offset_x: f32,
    pub offset_y: f32,
    pub blur_radius: f32,
    pub color: Color,
}

#[derive(Clone, Debug)]
pub struct LinearGradient {
    pub angle: Angle,
    pub stops: Vec<GradientStop>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum RadialShape {
    Circle,
    Ellipse,
}

#[derive(Clone, Debug)]
pub struct RadialGradient {
    pub shape: RadialShape,
    /// Center position as fractions (0.0–1.0), default (0.5, 0.5).
    pub position: (f32, f32),
    pub stops: Vec<GradientStop>,
}

#[derive(Clone, Debug)]
pub struct GradientStop {
    pub color: Color,
    pub position: Option<Fraction>,
}

impl Default for ComputedStyle {
    fn default() -> Self {
        ComputedStyle {
            display: Display::Block,
            position: Position::Static,
            box_sizing: BoxSizing::ContentBox,
            width: Dimension::Auto,
            height: Dimension::Auto,
            min_width: Dimension::Auto,
            min_height: Dimension::Auto,
            max_width: Dimension::Auto,
            max_height: Dimension::Auto,
            margin_top: Dimension::Px(0.0),
            margin_right: Dimension::Px(0.0),
            margin_bottom: Dimension::Px(0.0),
            margin_left: Dimension::Px(0.0),
            padding_top: Dimension::Px(0.0),
            padding_right: Dimension::Px(0.0),
            padding_bottom: Dimension::Px(0.0),
            padding_left: Dimension::Px(0.0),
            border_top_width: Dimension::Px(0.0),
            border_right_width: Dimension::Px(0.0),
            border_bottom_width: Dimension::Px(0.0),
            border_left_width: Dimension::Px(0.0),
            border_top_color: Color::from_rgba8(0, 0, 0, 255),
            border_right_color: Color::from_rgba8(0, 0, 0, 255),
            border_bottom_color: Color::from_rgba8(0, 0, 0, 255),
            border_left_color: Color::from_rgba8(0, 0, 0, 255),
            border_top_style: BorderStyle::Solid,
            border_right_style: BorderStyle::Solid,
            border_bottom_style: BorderStyle::Solid,
            border_left_style: BorderStyle::Solid,
            border_radius: [Dimension::Px(0.0); 4],
            background_color: Color::from_rgba8(0, 0, 0, 0),
            background_gradient: None,
            background_radial_gradient: None,
            color: Color::from_rgba8(0, 0, 0, 255),
            font_size: ROOT_FONT_SIZE,
            font_weight: FontWeight::NORMAL,
            font_family: None,
            line_height: 1.2,
            opacity: Opacity::FULL,
            overflow_hidden: false,
            top: Dimension::Auto,
            right: Dimension::Auto,
            bottom: Dimension::Auto,
            left: Dimension::Auto,
            flex_direction: FlexDirection::Row,
            flex_wrap: FlexWrap::NoWrap,
            flex_grow: 0.0,
            flex_shrink: 1.0,
            flex_basis: Dimension::Auto,
            align_items: AlignItems::Stretch,
            align_content: AlignContent::Normal,
            justify_content: JustifyContent::FlexStart,
            grid_template_columns: Vec::new(),
            grid_template_rows: Vec::new(),
            gap_row: Dimension::Px(0.0),
            gap_column: Dimension::Px(0.0),
            grid_column_start: None,
            grid_column_end: None,
            grid_row_start: None,
            grid_row_end: None,
            text_align: TextAlign::Left,
            text_transform: TextTransform::None,
            text_decoration: TextDecoration::None,
            text_decoration_color: None,
            font_style: FontStyle::Normal,
            letter_spacing: 0.0,
            text_overflow_ellipsis: false,
            white_space: WhiteSpace::Normal,
            vertical_align: VerticalAlign::Baseline,
            line_clamp: None,
            transform: None,
            transform_origin_x: 0.5,
            transform_origin_y: 0.5,
            transform_translate_pct: None,
            custom_properties: HashMap::new(),
            root_font_size: ROOT_FONT_SIZE,
            clip_path: ClipPath::None,
            backdrop_filter_blur: None,
            box_shadows: Vec::new(),
            filters: Vec::new(),
            blend_mode: BlendMode::Normal,
            text_shadows: Vec::new(),
            z_index: 0,
            content: None,
        }
    }
}

// ---------------------------------------------------------------------------
// CSS rule / selector types
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct CssRule {
    pub selector: Selector,
    pub declarations: Vec<Declaration>,
    pub specificity: u32,
}

#[derive(Debug, Clone)]
pub enum Selector {
    Universal,                        // *
    Tag(String),                      // div
    Class(String),                    // .foo
    Id(String),                       // #bar
    TagClass(String, String),         // div.foo
    Descendant(Box<Selector>, Box<Selector>), // .parent .child
    Child(Box<Selector>, Box<Selector>),      // .parent > .child
    AdjacentSibling(Box<Selector>, Box<Selector>), // .a + .b
    GeneralSibling(Box<Selector>, Box<Selector>),  // .a ~ .b
    Compound(Vec<SimpleSelector>),    // .a.b
    /// Pseudo-element selector: base::before or base::after
    WithPseudo(Box<Selector>, PseudoElement),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PseudoElement {
    Before,
    After,
}

#[derive(Debug, Clone)]
pub enum AttrMatch {
    Exists,                    // [attr]
    Exact(String),             // [attr="val"]
    Prefix(String),            // [attr^="val"]
    Suffix(String),            // [attr$="val"]
    Contains(String),          // [attr*="val"]
}

#[derive(Debug, Clone)]
pub enum SimpleSelector {
    Tag(String),
    Class(String),
    Id(String),
    Attr(String, AttrMatch),  // [attr], [attr="val"], [attr^="val"], etc.
}

#[derive(Debug, Clone)]
pub struct Declaration {
    pub property: String,
    pub value: String,
}

// ---------------------------------------------------------------------------
// CSS extraction + parsing
// ---------------------------------------------------------------------------

/// Walk the DOM, collect <style> block contents, parse into CSS rules.
pub fn extract_and_parse_styles(dom: &RcDom) -> Vec<CssRule> {
    let css_text = extract_style_text(dom);
    parse_css(&css_text)
}

/// Walk the DOM and collect raw <style> block text (for @font-face parsing etc.).
pub fn extract_style_text(dom: &RcDom) -> String {
    let mut css_text = String::new();
    collect_style_blocks(&dom.document, &mut css_text);
    css_text
}

fn collect_style_blocks(node: &Handle, css: &mut String) {
    collect_style_blocks_inner(node, css, 0);
}

fn collect_style_blocks_inner(node: &Handle, css: &mut String, depth: usize) {
    if depth > 512 { return; } // prevent stack overflow on deeply nested HTML
    if let NodeData::Element { ref name, .. } = node.data {
        if name.local.as_ref() == tag::STYLE {
            for child in node.children.borrow().iter() {
                if let NodeData::Text { ref contents } = child.data {
                    css.push_str(&contents.borrow());
                    css.push('\n');
                }
            }
        }
    }
    for child in node.children.borrow().iter() {
        collect_style_blocks_inner(child, css, depth + 1);
    }
}

/// Parse a CSS stylesheet string into a list of rules (public for linked stylesheets).
pub fn parse_css_rules(css: &str) -> Vec<CssRule> {
    parse_css(css)
}

/// Parse a CSS stylesheet string into a list of rules using cssparser.
fn parse_css(css: &str) -> Vec<CssRule> {
    let mut input = cssparser::ParserInput::new(css);
    let mut parser = cssparser::Parser::new(&mut input);
    let mut rule_parser = CssRuleParser;
    let iter = cssparser::StyleSheetParser::new(&mut parser, &mut rule_parser);
    let mut rules = Vec::new();
    for result in iter {
        match result {
            Ok(parsed) => rules.extend(parsed),
            Err(_) => {} // skip invalid rules
        }
    }
    rules
}

/// cssparser-based rule parser that produces Vec<CssRule>.
struct CssRuleParser;

impl<'i> cssparser::QualifiedRuleParser<'i> for CssRuleParser {
    type Prelude = String; // raw selector text
    type QualifiedRule = Vec<CssRule>;
    type Error = ();

    fn parse_prelude<'t>(
        &mut self,
        input: &mut cssparser::Parser<'i, 't>,
    ) -> Result<Self::Prelude, cssparser::ParseError<'i, ()>> {
        // Consume all tokens as the selector string
        let start = input.position();
        while input.next().is_ok() {}
        Ok(input.slice_from(start).trim().to_string())
    }

    fn parse_block<'t>(
        &mut self,
        prelude: Self::Prelude,
        _start: &cssparser::ParserState,
        input: &mut cssparser::Parser<'i, 't>,
    ) -> Result<Self::QualifiedRule, cssparser::ParseError<'i, ()>> {
        let declarations = parse_declarations_cssparser(input);
        let mut rules = Vec::new();
        for sel_str in prelude.split(',') {
            let sel_str = sel_str.trim();
            if sel_str.is_empty() { continue; }
            if let Some(selector) = parse_selector(sel_str) {
                let specificity = calc_specificity(&selector);
                rules.push(CssRule { selector, declarations: declarations.clone(), specificity });
            }
        }
        Ok(rules)
    }
}

impl<'i> cssparser::AtRuleParser<'i> for CssRuleParser {
    type Prelude = AtRulePrelude;
    type AtRule = Vec<CssRule>;
    type Error = ();

    fn parse_prelude<'t>(
        &mut self,
        name: cssparser::CowRcStr<'i>,
        input: &mut cssparser::Parser<'i, 't>,
    ) -> Result<Self::Prelude, cssparser::ParseError<'i, ()>> {
        if name.eq_ignore_ascii_case("media") {
            let start = input.position();
            while input.next().is_ok() {}
            let condition = input.slice_from(start).trim().to_string();
            Ok(AtRulePrelude::Media(condition))
        } else {
            // Skip all other @-rules (@keyframes, @supports, @font-face)
            Ok(AtRulePrelude::Other)
        }
    }

    fn parse_block<'t>(
        &mut self,
        prelude: Self::Prelude,
        _start: &cssparser::ParserState,
        input: &mut cssparser::Parser<'i, 't>,
    ) -> Result<Self::AtRule, cssparser::ParseError<'i, ()>> {
        match prelude {
            AtRulePrelude::Media(condition) => {
                if evaluate_media_query(&condition) {
                    // Re-parse inner content as a stylesheet
                    let start = input.position();
                    while input.next().is_ok() {}
                    let inner_css = input.slice_from(start);
                    Ok(parse_css(inner_css))
                } else {
                    Ok(Vec::new())
                }
            }
            AtRulePrelude::Other => Ok(Vec::new()),
        }
    }

    fn rule_without_block(
        &mut self,
        _prelude: Self::Prelude,
        _start: &cssparser::ParserState,
    ) -> Result<Self::AtRule, ()> {
        Ok(Vec::new())
    }
}

enum AtRulePrelude {
    Media(String),
    Other,
}

/// Parse CSS declarations using cssparser's `DeclarationParser` trait for proper handling
/// of strings, comments, and nested parentheses.
fn parse_declarations_cssparser(input: &mut cssparser::Parser) -> Vec<Declaration> {
    let mut decl_parser = CssDeclParser;
    let mut decls = Vec::new();
    let iter = cssparser::RuleBodyParser::new(input, &mut decl_parser);
    for result in iter {
        match result {
            Ok(decl) => decls.push(decl),
            Err(_) => {} // skip invalid declarations
        }
    }
    decls
}

struct CssDeclParser;

impl<'i> cssparser::DeclarationParser<'i> for CssDeclParser {
    type Declaration = Declaration;
    type Error = ();

    fn parse_value<'t>(
        &mut self,
        name: cssparser::CowRcStr<'i>,
        input: &mut cssparser::Parser<'i, 't>,
        _start: &cssparser::ParserState,
    ) -> Result<Declaration, cssparser::ParseError<'i, ()>> {
        let start_pos = input.position();
        // Consume all tokens in the value
        while input.next().is_ok() {}
        let value = input.slice_from(start_pos).trim().to_string();
        // Strip !important suffix if present
        let value = value.trim_end_matches("!important").trim_end_matches("! important").trim().to_string();
        Ok(Declaration {
            property: name.to_string().to_lowercase(),
            value,
        })
    }
}

impl<'i> cssparser::AtRuleParser<'i> for CssDeclParser {
    type Prelude = ();
    type AtRule = Declaration;
    type Error = ();
}

impl<'i> cssparser::QualifiedRuleParser<'i> for CssDeclParser {
    type Prelude = ();
    type QualifiedRule = Declaration;
    type Error = ();
}

impl<'i> cssparser::RuleBodyItemParser<'i, Declaration, ()> for CssDeclParser {
    fn parse_declarations(&self) -> bool { true }
    fn parse_qualified(&self) -> bool { false }
}

/// Evaluate a CSS media query condition against the known viewport (1280x720).
///
/// Supports: `screen`, `all`, `print`, `not print`,
/// `(min-width: Xpx)`, `(max-width: Xpx)`, `(min-height: Xpx)`, `(max-height: Xpx)`,
/// `(prefers-color-scheme: dark|light)`, `(prefers-reduced-motion: reduce)`,
/// compound conditions with `and`.
fn evaluate_media_query(condition: &str) -> bool {
    let vp = Viewport::DEFAULT;
    let condition = condition.trim();

    // Empty condition means unconditional (e.g., `@media { ... }`)
    if condition.is_empty() {
        return true;
    }

    // Handle comma-separated queries (OR logic): any match → true
    if condition.contains(',') {
        return condition.split(',').any(|q| evaluate_media_query(q.trim()));
    }

    // Handle `not` prefix
    if let Some(rest) = condition.strip_prefix("not ") {
        return !evaluate_media_query(rest.trim());
    }

    // Split on `and` — all parts must match
    let parts: Vec<&str> = condition.split(" and ").map(|s| s.trim()).collect();

    for part in parts {
        if !evaluate_media_part(part, vp) {
            return false;
        }
    }
    true
}

/// Evaluate a single media query part (a media type or feature).
fn evaluate_media_part(part: &str, vp: Viewport) -> bool {
    let part = part.trim();

    // Media types
    match part {
        "screen" | "all" | "" => return true,
        "print" | "tty" | "tv" | "projection" | "handheld" | "braille" | "embossed" | "aural" => return false,
        _ => {}
    }

    // Parenthesized feature: (feature: value)
    let inner = if part.starts_with('(') && part.ends_with(')') {
        &part[1..part.len() - 1]
    } else {
        // Unknown token — be permissive, skip it
        return true;
    };

    if let Some((feature, value)) = inner.split_once(':') {
        let feature = feature.trim();
        let value = value.trim();
        match feature {
            "min-width" => parse_media_px(value).map_or(false, |v| vp.w >= v),
            "max-width" => parse_media_px(value).map_or(false, |v| vp.w <= v),
            "min-height" => parse_media_px(value).map_or(false, |v| vp.h >= v),
            "max-height" => parse_media_px(value).map_or(false, |v| vp.h <= v),
            "prefers-color-scheme" => value == "light",  // default to light
            "prefers-reduced-motion" => value == "no-preference",
            "orientation" => {
                if value == "landscape" { vp.w >= vp.h }
                else if value == "portrait" { vp.h > vp.w }
                else { false }
            }
            "color" | "color-index" | "monochrome" | "resolution" |
            "aspect-ratio" | "device-aspect-ratio" | "device-width" | "device-height" => {
                true // permissive: assume match for uncommon features
            }
            _ => true, // unknown feature — permissive
        }
    } else {
        // Feature without value, e.g. (color), (hover)
        let feature = inner.trim();
        match feature {
            "color" | "hover" | "pointer" => true,
            "prefers-reduced-motion" => false,
            _ => true, // permissive
        }
    }
}

/// Parse a CSS pixel value like "800px" → Some(800.0), "50em" → Some(800.0).
fn parse_media_px(s: &str) -> Option<f32> {
    let s = s.trim();
    if let Some(v) = s.strip_suffix("px") {
        v.trim().parse::<f32>().ok()
    } else if let Some(v) = s.strip_suffix("em") {
        v.trim().parse::<f32>().ok().map(|v| v * ROOT_FONT_SIZE)
    } else if let Some(v) = s.strip_suffix("rem") {
        v.trim().parse::<f32>().ok().map(|v| v * ROOT_FONT_SIZE)
    } else {
        // Try bare number
        s.parse::<f32>().ok()
    }
}

/// Parse declarations from a raw CSS body string (convenience wrapper for non-cssparser contexts).
fn parse_declarations(body: &str) -> Vec<Declaration> {
    let mut input = cssparser::ParserInput::new(body);
    let mut parser = cssparser::Parser::new(&mut input);
    parse_declarations_cssparser(&mut parser)
}

fn parse_selector(s: &str) -> Option<Selector> {
    // Detect and strip pseudo-element suffix (::before, ::after, :before, :after)
    let (base_str, pseudo) = strip_pseudo_element(s);

    // Tokenize into simple selectors and combinators (>, +, ~, or whitespace).
    // We split on whitespace first, then detect combinator tokens.
    let tokens: Vec<&str> = base_str.split_whitespace().collect();
    if tokens.is_empty() { return None; }

    // Build a list of (combinator, selector) pairs.
    // Combinators: ' ' (descendant), '>' (child), '+' (adjacent), '~' (general sibling)
    let mut selectors: Vec<Selector> = Vec::new();
    let mut combinators: Vec<char> = Vec::new();

    for &tok in &tokens {
        match tok {
            ">" => combinators.push('>'),
            "+" => combinators.push('+'),
            "~" => combinators.push('~'),
            _ => {
                // If no explicit combinator before this selector, it's a descendant
                if !selectors.is_empty() && combinators.len() < selectors.len() {
                    combinators.push(' ');
                }
                selectors.push(parse_simple_selector_group(tok));
            }
        }
    }

    if selectors.is_empty() { return None; }

    // Fold left: first selector, then combine with each subsequent via combinator
    let mut current = selectors.remove(0);
    for (i, sel) in selectors.into_iter().enumerate() {
        let comb = combinators.get(i).copied().unwrap_or(' ');
        current = match comb {
            '>' => Selector::Child(Box::new(current), Box::new(sel)),
            '+' => Selector::AdjacentSibling(Box::new(current), Box::new(sel)),
            '~' => Selector::GeneralSibling(Box::new(current), Box::new(sel)),
            _   => Selector::Descendant(Box::new(current), Box::new(sel)),
        };
    }

    if let Some(pe) = pseudo {
        Some(Selector::WithPseudo(Box::new(current), pe))
    } else {
        Some(current)
    }
}

/// Strip ::before / ::after (or :before / :after) pseudo-element suffix from a selector string.
fn strip_pseudo_element(s: &str) -> (&str, Option<PseudoElement>) {
    // Check for ::before / ::after first (double colon)
    if let Some(idx) = s.rfind("::before") {
        return (&s[..idx], Some(PseudoElement::Before));
    }
    if let Some(idx) = s.rfind("::after") {
        return (&s[..idx], Some(PseudoElement::After));
    }
    // Legacy single-colon syntax
    if let Some(idx) = s.rfind(":before") {
        // Make sure it's not part of a longer pseudo-class (e.g., ":before-something")
        let after = &s[idx + 7..];
        if after.is_empty() || after.starts_with(' ') {
            return (&s[..idx], Some(PseudoElement::Before));
        }
    }
    if let Some(idx) = s.rfind(":after") {
        let after = &s[idx + 6..];
        if after.is_empty() || after.starts_with(' ') {
            return (&s[..idx], Some(PseudoElement::After));
        }
    }
    (s, None)
}

fn parse_simple_selector_group(s: &str) -> Selector {
    if s == "*" { return Selector::Universal; }
    // :root matches the <html> element; treat as tag selector
    if s == ":root" { return Selector::Tag(tag::HTML.to_string()); }

    // Tokenize into parts split on '.', '#', and '[' boundaries.
    let mut parts: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut chars = s.chars().peekable();
    while let Some(&ch) = chars.peek() {
        if ch == '[' {
            // Flush current token
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
            // Collect entire [...] block
            let mut bracket = String::new();
            bracket.push(chars.next().unwrap()); // '['
            while let Some(&c) = chars.peek() {
                bracket.push(chars.next().unwrap());
                if c == ']' { break; }
            }
            parts.push(bracket);
        } else if ch == '.' || ch == '#' {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
            current.push(chars.next().unwrap());
        } else {
            current.push(chars.next().unwrap());
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }

    if parts.len() == 1 {
        let p = &parts[0];
        if p.starts_with('.') {
            return Selector::Class(p[1..].to_string());
        } else if p.starts_with('#') {
            return Selector::Id(p[1..].to_string());
        } else if p.starts_with('[') {
            if let Some(attr) = parse_attr_selector(p) {
                return Selector::Compound(vec![attr]);
            }
            return Selector::Universal;
        } else {
            return Selector::Tag(p.to_lowercase());
        }
    }

    // Compound selector (e.g., div.foo, .a.b, div[data-x="y"])
    let mut simple = Vec::new();
    for p in &parts {
        if p.starts_with('.') {
            simple.push(SimpleSelector::Class(p[1..].to_string()));
        } else if p.starts_with('#') {
            simple.push(SimpleSelector::Id(p[1..].to_string()));
        } else if p.starts_with('[') {
            if let Some(attr) = parse_attr_selector(p) {
                simple.push(attr);
            }
        } else {
            simple.push(SimpleSelector::Tag(p.to_lowercase()));
        }
    }

    // Special case: tag + single class → TagClass
    if simple.len() == 2 {
        if let (SimpleSelector::Tag(ref t), SimpleSelector::Class(ref c)) = (&simple[0], &simple[1]) {
            return Selector::TagClass(t.clone(), c.clone());
        }
    }

    Selector::Compound(simple)
}

/// Parse an attribute selector like `[attr]`, `[attr="val"]`, `[attr^="val"]`, etc.
fn parse_attr_selector(s: &str) -> Option<SimpleSelector> {
    // Strip surrounding brackets
    let inner = s.strip_prefix('[')?.strip_suffix(']')?;
    if inner.is_empty() { return None; }

    // Check for operator: =, ^=, $=, *=, ~=, |=
    if let Some(eq_pos) = inner.find('=') {
        let before = &inner[..eq_pos];
        let after_eq = &inner[eq_pos + 1..]; // everything after '='

        let (attr_name, op) = if before.ends_with('^') {
            (&before[..before.len()-1], "^=")
        } else if before.ends_with('$') {
            (&before[..before.len()-1], "$=")
        } else if before.ends_with('*') {
            (&before[..before.len()-1], "*=")
        } else if before.ends_with('~') {
            (&before[..before.len()-1], "~=")
        } else if before.ends_with('|') {
            (&before[..before.len()-1], "|=")
        } else {
            (before, "=")
        };

        // Strip quotes from value
        let val = after_eq.trim().trim_matches(|c: char| c == '\'' || c == '"');

        let matcher = match op {
            "^=" => AttrMatch::Prefix(val.to_string()),
            "$=" => AttrMatch::Suffix(val.to_string()),
            "*=" => AttrMatch::Contains(val.to_string()),
            _ => AttrMatch::Exact(val.to_string()),
        };
        Some(SimpleSelector::Attr(attr_name.trim().to_string(), matcher))
    } else {
        // Just [attr] — existence check
        Some(SimpleSelector::Attr(inner.trim().to_string(), AttrMatch::Exists))
    }
}

fn calc_specificity(sel: &Selector) -> u32 {
    match sel {
        Selector::Universal => 0,
        Selector::Tag(_) => 1,
        Selector::Class(_) => 10,
        Selector::Id(_) => 100,
        Selector::TagClass(_, _) => 11,
        Selector::Descendant(a, b)
        | Selector::Child(a, b)
        | Selector::AdjacentSibling(a, b)
        | Selector::GeneralSibling(a, b) => calc_specificity(a) + calc_specificity(b),
        // Pseudo-elements have specificity of 1 (like a tag) + base selector
        Selector::WithPseudo(base, _) => calc_specificity(base) + 1,
        Selector::Compound(parts) => parts.iter().map(|p| match p {
            SimpleSelector::Tag(_) => 1,
            SimpleSelector::Class(_) => 10,
            SimpleSelector::Id(_) => 100,
            SimpleSelector::Attr(_, _) => 10, // attribute selectors have class-level specificity
        }).sum(),
    }
}

// ---------------------------------------------------------------------------
// Selector matching
// ---------------------------------------------------------------------------

fn matches_selector(node: &Handle, selector: &Selector) -> bool {
    match selector {
        Selector::Universal => matches!(node.data, NodeData::Element { .. }),
        Selector::Tag(tag) => dom::tag_name(node).map_or(false, |t| t.eq_ignore_ascii_case(tag)),
        Selector::Class(cls) => dom::get_classes(node).iter().any(|c| c == cls),
        Selector::Id(id) => dom::get_id(node).as_deref() == Some(id.as_str()),
        Selector::TagClass(tag, cls) => {
            dom::tag_name(node).map_or(false, |t| t.eq_ignore_ascii_case(tag))
                && dom::get_classes(node).iter().any(|c| c == cls)
        }
        Selector::Compound(parts) => parts.iter().all(|p| match p {
            SimpleSelector::Tag(t) => dom::tag_name(node).map_or(false, |n| n.eq_ignore_ascii_case(t)),
            SimpleSelector::Class(c) => dom::get_classes(node).iter().any(|x| x == c),
            SimpleSelector::Id(i) => dom::get_id(node).as_deref() == Some(i.as_str()),
            SimpleSelector::Attr(name, matcher) => match_attr(node, name, matcher),
        }),
        // Pseudo-element rules never match during normal cascade;
        // they are applied separately in build_styled_tree_impl.
        Selector::WithPseudo(_, _) => false,
        Selector::Descendant(ancestor_sel, child_sel) => {
            if !matches_selector(node, child_sel) {
                return false;
            }
            // Walk up ancestors (bounded to MAX_DOM_DEPTH to prevent O(N²) DoS)
            let mut current = node.parent.take();
            node.parent.set(current.clone());
            let mut depth = 0;
            while let Some(weak) = current {
                if depth >= MAX_DOM_DEPTH { break; }
                depth += 1;
                if let Some(parent) = weak.upgrade() {
                    if matches_selector(&parent, ancestor_sel) {
                        return true;
                    }
                    let next = parent.parent.take();
                    parent.parent.set(next.clone());
                    current = next;
                } else {
                    break;
                }
            }
            false
        }
        Selector::Child(parent_sel, child_sel) => {
            if !matches_selector(node, child_sel) {
                return false;
            }
            // Check immediate parent only
            let weak = node.parent.take();
            node.parent.set(weak.clone());
            if let Some(w) = weak {
                if let Some(parent) = w.upgrade() {
                    return matches_selector(&parent, parent_sel);
                }
            }
            false
        }
        Selector::AdjacentSibling(prev_sel, this_sel) => {
            if !matches_selector(node, this_sel) {
                return false;
            }
            // Find the immediately preceding element sibling
            if let Some(prev) = prev_element_sibling(node) {
                return matches_selector(&prev, prev_sel);
            }
            false
        }
        Selector::GeneralSibling(prev_sel, this_sel) => {
            if !matches_selector(node, this_sel) {
                return false;
            }
            // Any preceding element sibling that matches
            let mut count = 0;
            let mut current = prev_element_sibling(node);
            while let Some(sib) = current {
                if count >= MAX_DOM_DEPTH { break; }
                count += 1;
                if matches_selector(&sib, prev_sel) {
                    return true;
                }
                current = prev_element_sibling(&sib);
            }
            false
        }
    }
}

/// Match an attribute selector against a node.
fn match_attr(node: &Handle, name: &str, matcher: &AttrMatch) -> bool {
    let val = dom::get_attr(node, name);
    match matcher {
        AttrMatch::Exists => val.is_some(),
        AttrMatch::Exact(expected) => val.as_deref() == Some(expected.as_str()),
        AttrMatch::Prefix(prefix) => val.map_or(false, |v| v.starts_with(prefix.as_str())),
        AttrMatch::Suffix(suffix) => val.map_or(false, |v| v.ends_with(suffix.as_str())),
        AttrMatch::Contains(substr) => val.map_or(false, |v| v.contains(substr.as_str())),
    }
}

/// Find the immediately preceding element sibling of a node.
fn prev_element_sibling(node: &Handle) -> Option<Handle> {
    let weak = node.parent.take();
    node.parent.set(weak.clone());
    let parent = weak?.upgrade()?;
    let children = parent.children.borrow();
    let mut prev_element: Option<Handle> = None;
    for child in children.iter() {
        if std::ptr::eq(
            &**child as *const _ as *const u8,
            &**node as *const _ as *const u8,
        ) {
            return prev_element;
        }
        if matches!(child.data, NodeData::Element { .. }) {
            prev_element = Some(child.clone());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Style computation (cascade + inheritance)
// ---------------------------------------------------------------------------

/// A node in the styled tree: DOM node + computed style + children.
#[derive(Debug)]
pub struct StyledNode {
    pub node: Handle,
    pub style: ComputedStyle,
    pub text: Option<String>,
    pub children: Vec<StyledNode>,
}

/// Compute styles for the entire DOM tree.
pub fn compute_styles(dom: &RcDom, rules: &[CssRule]) -> StyledNode {
    let mut root_style = ComputedStyle::default();

    // Apply :root / html rules to the root style so custom properties cascade to body
    if let Some(html_node) = find_html(&dom.document) {
        let mut matching: Vec<(&CssRule, u32)> = rules.iter()
            .filter(|r| matches_selector(&html_node, &r.selector))
            .map(|r| (r, r.specificity))
            .collect();
        matching.sort_by_key(|(_, s)| *s);
        for (rule, _) in &matching {
            for decl in &rule.declarations {
                apply_declaration(&mut root_style, &decl.property, &decl.value);
            }
        }
    }

    // The html element's computed font-size becomes the root font-size for rem resolution
    root_style.root_font_size = root_style.font_size;

    let body = find_body(&dom.document).unwrap_or_else(|| dom.document.clone());
    build_styled_tree(&body, rules, &root_style)
}

fn find_html(node: &Handle) -> Option<Handle> {
    find_html_inner(node, 0)
}

fn find_html_inner(node: &Handle, depth: usize) -> Option<Handle> {
    if depth > 512 { return None; }
    if dom::tag_name(node) == Some(tag::HTML) {
        return Some(node.clone());
    }
    for child in node.children.borrow().iter() {
        if let Some(found) = find_html_inner(child, depth + 1) {
            return Some(found);
        }
    }
    None
}

fn find_body(node: &Handle) -> Option<Handle> {
    find_body_inner(node, 0)
}

fn find_body_inner(node: &Handle, depth: usize) -> Option<Handle> {
    if depth > MAX_DOM_DEPTH { return None; }
    if dom::tag_name(node) == Some(tag::BODY) {
        return Some(node.clone());
    }
    for child in node.children.borrow().iter() {
        if let Some(found) = find_body_inner(child, depth + 1) {
            return Some(found);
        }
    }
    None
}

const MAX_DOM_DEPTH: usize = crate::limits::MAX_DOM_DEPTH;

fn build_styled_tree(node: &Handle, rules: &[CssRule], parent_style: &ComputedStyle) -> StyledNode {
    build_styled_tree_inner(node, rules, parent_style, 0)
}

fn build_styled_tree_inner(node: &Handle, rules: &[CssRule], parent_style: &ComputedStyle, depth: usize) -> StyledNode {
    if depth > MAX_DOM_DEPTH {
        return StyledNode {
            node: node.clone(),
            style: ComputedStyle { display: Display::None, ..Default::default() },
            text: None,
            children: Vec::new(),
        };
    }
    build_styled_tree_impl(node, rules, parent_style, depth)
}

fn build_styled_tree_impl(node: &Handle, rules: &[CssRule], parent_style: &ComputedStyle, depth: usize) -> StyledNode {
    match &node.data {
        NodeData::Text { ref contents } => {
            let text = contents.borrow().to_string();
            let trimmed = text.trim();
            // Text nodes are anonymous inline boxes: they inherit inherited
            // properties (color, font-size, line-height, etc.) but NOT
            // non-inherited properties like margin, padding, border, background.
            let text_style = inherit_from(parent_style);
            if trimmed.is_empty() {
                return StyledNode {
                    node: node.clone(),
                    style: text_style,
                    text: None,
                    children: Vec::new(),
                };
            }
            StyledNode {
                node: node.clone(),
                style: text_style,
                text: Some(trimmed.to_string()),
                children: Vec::new(),
            }
        }
        NodeData::Element { ref name, .. } => {
            let tag = name.local.as_ref();
            // Skip non-visual elements
            if tag::NON_VISUAL.contains(&tag) {
                return StyledNode {
                    node: node.clone(),
                    style: ComputedStyle { display: Display::None, ..Default::default() },
                    text: None,
                    children: Vec::new(),
                };
            }

            // Start with inherited properties from parent
            let mut style = inherit_from(parent_style);

            // Apply default styles for certain tags
            apply_tag_defaults(tag, &mut style);

            // Collect matching rules, sorted by specificity
            let mut matching: Vec<(&CssRule, u32)> = rules.iter()
                .filter(|r| matches_selector(node, &r.selector))
                .map(|r| (r, r.specificity))
                .collect();
            matching.sort_by_key(|(_, s)| *s);

            // Apply rules in specificity order
            for (rule, _) in &matching {
                for decl in &rule.declarations {
                    apply_declaration(&mut style, &decl.property, &decl.value);
                }
            }

            // Apply inline style attribute (highest specificity)
            if let Some(inline) = dom::get_attr(node, tag::STYLE) {
                let decls = parse_declarations(&inline);
                for decl in &decls {
                    apply_declaration(&mut style, &decl.property, &decl.value);
                }
            }

            // Build children
            let mut children: Vec<StyledNode> = node.children.borrow().iter()
                .map(|child| build_styled_tree_inner(child, rules, &style, depth + 1))
                .filter(|sn| sn.style.display != Display::None && (sn.text.is_some() || !sn.children.is_empty() || matches!(sn.node.data, NodeData::Element { .. })))
                .collect();

            // Generate ::before and ::after pseudo-elements
            // Inline pseudo-elements: merge text into adjacent text nodes for proper inline flow.
            // Block pseudo-elements: insert as separate child nodes.
            if let Some(before_node) = make_pseudo_element(node, rules, &style, PseudoElement::Before) {
                if before_node.style.display == Display::Inline && before_node.text.is_some() {
                    let prefix = before_node.text.as_deref().unwrap_or("");
                    // Prepend to first text child, or insert as text node
                    if let Some(first) = children.first_mut() {
                        if let Some(ref mut t) = first.text {
                            *t = format!("{}{}", prefix, t);
                        } else {
                            children.insert(0, before_node);
                        }
                    } else {
                        children.insert(0, before_node);
                    }
                } else {
                    children.insert(0, before_node);
                }
            }
            if let Some(after_node) = make_pseudo_element(node, rules, &style, PseudoElement::After) {
                if after_node.style.display == Display::Inline && after_node.text.is_some() {
                    let suffix = after_node.text.as_deref().unwrap_or("");
                    // Append to last text child, or push as text node
                    if let Some(last) = children.last_mut() {
                        if let Some(ref mut t) = last.text {
                            t.push_str(suffix);
                        } else {
                            children.push(after_node);
                        }
                    } else {
                        children.push(after_node);
                    }
                } else {
                    children.push(after_node);
                }
            }

            StyledNode {
                node: node.clone(),
                style,
                text: None,
                children,
            }
        }
        _ => {
            // Document node — recurse into children
            let children: Vec<StyledNode> = node.children.borrow().iter()
                .map(|child| build_styled_tree_inner(child, rules, parent_style, depth + 1))
                .filter(|sn| sn.style.display != Display::None && (sn.text.is_some() || !sn.children.is_empty() || matches!(sn.node.data, NodeData::Element { .. })))
                .collect();
            StyledNode {
                node: node.clone(),
                style: parent_style.clone(),
                text: None,
                children,
            }
        }
    }
}

/// Inherit inheritable properties from parent.
fn inherit_from(parent: &ComputedStyle) -> ComputedStyle {
    let mut s = ComputedStyle::default();
    // Inherited properties
    s.color = parent.color;
    s.font_size = parent.font_size;
    s.font_weight = parent.font_weight;
    s.font_family = parent.font_family.clone();
    s.line_height = parent.line_height;
    s.text_align = parent.text_align;
    s.text_transform = parent.text_transform;
    s.font_style = parent.font_style;
    s.letter_spacing = parent.letter_spacing;
    s.white_space = parent.white_space;
    s.line_clamp = parent.line_clamp;
    // text_decoration does NOT inherit (per CSS spec)
    // CSS custom properties inherit by default
    s.custom_properties = parent.custom_properties.clone();
    // Root font-size for rem resolution inherits through the tree
    s.root_font_size = parent.root_font_size;
    s
}

/// Apply browser-default styles for tags.
fn apply_tag_defaults(t: &str, style: &mut ComputedStyle) {
    match t {
        tag::H1 => { style.font_size = 32.0; style.font_weight = FontWeight::BOLD; style.display = Display::Block; style.margin_top = Dimension::Px(21.0); style.margin_bottom = Dimension::Px(21.0); }
        tag::H2 => { style.font_size = 24.0; style.font_weight = FontWeight::BOLD; style.display = Display::Block; style.margin_top = Dimension::Px(19.0); style.margin_bottom = Dimension::Px(19.0); }
        tag::H3 => { style.font_size = 18.7; style.font_weight = FontWeight::BOLD; style.display = Display::Block; style.margin_top = Dimension::Px(18.0); style.margin_bottom = Dimension::Px(18.0); }
        tag::P => { style.display = Display::Block; style.margin_top = Dimension::Px(ROOT_FONT_SIZE); style.margin_bottom = Dimension::Px(ROOT_FONT_SIZE); }
        tag::DIV => { style.display = Display::Block; }
        // <br> is handled implicitly — text nodes around <br> are already
        // separate block children, so the <br> itself should not take space.
        tag::BR => { style.display = Display::None; }
        tag::IMG => { style.display = Display::InlineBlock; }
        _ if tag::INLINE.contains(&t) => { style.display = Display::Inline; }
        tag::BODY | tag::HTML => { style.display = Display::Block; }
        _ => { style.display = Display::Block; }
    }
}

// ---------------------------------------------------------------------------
// Declaration application
// ---------------------------------------------------------------------------

pub fn apply_declaration(style: &mut ComputedStyle, property: &str, value: &str) {
    let value = value.trim();

    // CSS custom property declaration: --name: value
    if property.starts_with("--") {
        if value.len() > MAX_CUSTOM_PROPERTY_LEN { return; }
        if !style.custom_properties.contains_key(property) && style.custom_properties.len() >= MAX_CUSTOM_PROPERTIES {
            return;
        }
        let total_bytes: usize = style.custom_properties.values().map(|v| v.len()).sum();
        if total_bytes + value.len() > MAX_CUSTOM_PROPERTIES_TOTAL_BYTES { return; }
        style.custom_properties.insert(property.to_string(), value.to_string());
        return;
    }

    // Resolve var() references in the value
    let value = &resolve_var(value, &style.custom_properties);
    let value = value.trim();

    match property {
        "display" => style.display = match value {
            "flex" => Display::Flex,
            "grid" => Display::Grid,
            "inline" => Display::Inline,
            "inline-block" => Display::InlineBlock,
            "none" => Display::None,
            "-webkit-box" => Display::Block, // treat as block for line-clamp support
            _ => Display::Block,
        },
        "position" => style.position = match value {
            "relative" => Position::Relative,
            "absolute" => Position::Absolute,
            "fixed" => Position::Fixed,
            _ => Position::Static,
        },
        "box-sizing" => style.box_sizing = match value {
            "border-box" => BoxSizing::BorderBox,
            _ => BoxSizing::ContentBox,
        },
        // Position offsets
        "top" => style.top = parse_length(value),
        "right" => style.right = parse_length(value),
        "bottom" => style.bottom = parse_length(value),
        "left" => style.left = parse_length(value),
        "width" => style.width = parse_dimension(value),
        "height" => style.height = parse_dimension(value),
        "min-width" => style.min_width = parse_dimension(value),
        "min-height" => style.min_height = parse_dimension(value),
        "max-width" => style.max_width = parse_dimension(value),
        "max-height" => style.max_height = parse_dimension(value),

        // Margin shorthand and individual
        "margin" => {
            let sides = parse_shorthand_4(value);
            style.margin_top = parse_length(&sides[0]);
            style.margin_right = parse_length(&sides[1]);
            style.margin_bottom = parse_length(&sides[2]);
            style.margin_left = parse_length(&sides[3]);
        }
        "margin-top" => style.margin_top = parse_length(value),
        "margin-right" => style.margin_right = parse_length(value),
        "margin-bottom" => style.margin_bottom = parse_length(value),
        "margin-left" => style.margin_left = parse_length(value),

        // Padding shorthand and individual
        "padding" => {
            let sides = parse_shorthand_4(value);
            style.padding_top = parse_length(&sides[0]);
            style.padding_right = parse_length(&sides[1]);
            style.padding_bottom = parse_length(&sides[2]);
            style.padding_left = parse_length(&sides[3]);
        }
        "padding-top" => style.padding_top = parse_length(value),
        "padding-right" => style.padding_right = parse_length(value),
        "padding-bottom" => style.padding_bottom = parse_length(value),
        "padding-left" => style.padding_left = parse_length(value),

        // Border
        "border" => {
            // "1px solid rgba(255,255,255,0.1)"  or  "4px dotted #00ff88"
            if let Some((width, bstyle, color)) = parse_border_shorthand(value) {
                style.border_top_width = width;
                style.border_right_width = width;
                style.border_bottom_width = width;
                style.border_left_width = width;
                style.border_top_color = color;
                style.border_right_color = color;
                style.border_bottom_color = color;
                style.border_left_color = color;
                style.border_top_style = bstyle;
                style.border_right_style = bstyle;
                style.border_bottom_style = bstyle;
                style.border_left_style = bstyle;
            }
        }
        "border-top" => {
            if let Some((width, bstyle, color)) = parse_border_shorthand(value) {
                style.border_top_width = width;
                style.border_top_color = color;
                style.border_top_style = bstyle;
            }
        }
        "border-right" => {
            if let Some((width, bstyle, color)) = parse_border_shorthand(value) {
                style.border_right_width = width;
                style.border_right_color = color;
                style.border_right_style = bstyle;
            }
        }
        "border-bottom" => {
            if let Some((width, bstyle, color)) = parse_border_shorthand(value) {
                style.border_bottom_width = width;
                style.border_bottom_color = color;
                style.border_bottom_style = bstyle;
            }
        }
        "border-left" => {
            if let Some((width, bstyle, color)) = parse_border_shorthand(value) {
                style.border_left_width = width;
                style.border_left_color = color;
                style.border_left_style = bstyle;
            }
        }
        "border-top-width" => style.border_top_width = parse_length(value),
        "border-right-width" => style.border_right_width = parse_length(value),
        "border-bottom-width" => style.border_bottom_width = parse_length(value),
        "border-left-width" => style.border_left_width = parse_length(value),
        "border-top-color" => { if let Some(c) = parse_color(value) { style.border_top_color = c; } }
        "border-right-color" => { if let Some(c) = parse_color(value) { style.border_right_color = c; } }
        "border-bottom-color" => { if let Some(c) = parse_color(value) { style.border_bottom_color = c; } }
        "border-left-color" => { if let Some(c) = parse_color(value) { style.border_left_color = c; } }
        "border-radius" => {
            // CSS shorthand: 1-4 values → TL TR BR BL
            let parts: Vec<&str> = value.split_whitespace().collect();
            let dims: Vec<Dimension> = parts.iter().map(|p| parse_dimension(p)).collect();
            style.border_radius = match dims.len() {
                1 => [dims[0]; 4],
                2 => [dims[0], dims[1], dims[0], dims[1]], // TL/BR, TR/BL
                3 => [dims[0], dims[1], dims[2], dims[1]], // TL, TR/BL, BR
                4 => [dims[0], dims[1], dims[2], dims[3]],
                _ => [Dimension::Px(0.0); 4],
            };
        }
        "border-color" => {
            if let Some(c) = parse_color(value) {
                style.border_top_color = c;
                style.border_right_color = c;
                style.border_bottom_color = c;
                style.border_left_color = c;
            }
        }
        "border-width" => {
            let w = parse_length(value);
            style.border_top_width = w;
            style.border_right_width = w;
            style.border_bottom_width = w;
            style.border_left_width = w;
        }

        // Background
        "background-color" => {
            if let Some(c) = parse_color(value) {
                style.background_color = c;
            }
        }
        "background" => {
            if value.contains("linear-gradient") {
                style.background_gradient = parse_linear_gradient(value);
            } else if value.contains("radial-gradient") {
                style.background_radial_gradient = parse_radial_gradient(value);
            } else if let Some(c) = parse_color(value) {
                style.background_color = c;
            }
        }

        // Typography
        "color" => {
            if let Some(c) = parse_color(value) {
                style.color = c;
            }
        }
        "font-size" => {
            let dim = parse_length(value);
            style.font_size = match dim {
                Dimension::Px(v) => v,
                Dimension::Em(v) => v * style.font_size, // relative to inherited font-size
                Dimension::Rem(v) => v * style.root_font_size,
                Dimension::Percent(frac) => frac * style.font_size,
                Dimension::Vw(v) => v / 100.0 * Viewport::DEFAULT.w,
                Dimension::Vh(v) => v / 100.0 * Viewport::DEFAULT.h,
                Dimension::Fr(_) | Dimension::Auto => style.font_size,
                Dimension::Calc(frac, px) => frac * style.font_size + px,
            };
        }
        "font-weight" => style.font_weight = FontWeight::parse(value),
        "font-family" => {
            // Parse first family name from comma-separated list, strip quotes
            let first = value.split(',').next().unwrap_or(value).trim();
            let name = first.trim_matches(|c: char| c == '\'' || c == '"').trim();
            if name == "sans-serif" || name == "serif" || name == "monospace" || name == "cursive" || name == "fantasy" {
                style.font_family = None; // generic family → use default
            } else if !name.is_empty() {
                style.font_family = Some(name.to_string());
            }
        }
        "line-height" => {
            style.line_height = if value.ends_with("px") {
                parse_px(value) / style.font_size.max(1.0)
            } else {
                value.parse().unwrap_or(1.2)
            };
        }
        "text-align" => style.text_align = match value {
            "center" => TextAlign::Center,
            "right" => TextAlign::Right,
            _ => TextAlign::Left,
        },
        "text-transform" => style.text_transform = match value {
            "uppercase" => TextTransform::Uppercase,
            "lowercase" => TextTransform::Lowercase,
            "capitalize" => TextTransform::Capitalize,
            _ => TextTransform::None,
        },
        "text-decoration" | "text-decoration-line" => {
            if value.contains("underline") {
                style.text_decoration = TextDecoration::Underline;
            } else if value.contains("line-through") {
                style.text_decoration = TextDecoration::LineThrough;
            } else if value.contains("overline") {
                style.text_decoration = TextDecoration::Overline;
            } else {
                style.text_decoration = TextDecoration::None;
            }
        }
        "text-decoration-color" => {
            style.text_decoration_color = parse_color(value);
        }
        "font-style" => style.font_style = match value {
            "italic" | "oblique" => FontStyle::Italic,
            _ => FontStyle::Normal,
        },
        "letter-spacing" => {
            if value != "normal" {
                style.letter_spacing = parse_px(value);
            }
        }
        "text-overflow" => {
            style.text_overflow_ellipsis = value == "ellipsis";
        }
        "-webkit-line-clamp" => {
            style.line_clamp = value.parse::<u32>().ok().filter(|&n| n > 0);
        }
        "-webkit-box-orient" => {
            // no-op: only vertical orientation is relevant, assumed when line_clamp is set
        }
        "white-space" => {
            style.white_space = match value {
                "nowrap" => WhiteSpace::Nowrap,
                "pre" => WhiteSpace::Pre,
                "pre-wrap" => WhiteSpace::PreWrap,
                "pre-line" => WhiteSpace::PreLine,
                _ => WhiteSpace::Normal,
            };
        }
        "vertical-align" => {
            style.vertical_align = match value {
                "middle" => VerticalAlign::Middle,
                "top" => VerticalAlign::Top,
                "bottom" => VerticalAlign::Bottom,
                _ => VerticalAlign::Baseline,
            };
        }
        "opacity" => style.opacity = Opacity::new(value.parse().unwrap_or(1.0)),

        // Overflow
        "overflow" => style.overflow_hidden = value == "hidden",
        "overflow-x" | "overflow-y" => {
            if value == "hidden" { style.overflow_hidden = true; }
        }

        // Flexbox
        "flex-direction" => style.flex_direction = match value {
            "column" => FlexDirection::Column,
            "row-reverse" => FlexDirection::RowReverse,
            "column-reverse" => FlexDirection::ColumnReverse,
            _ => FlexDirection::Row,
        },
        "flex-wrap" => style.flex_wrap = match value {
            "wrap" => FlexWrap::Wrap,
            _ => FlexWrap::NoWrap,
        },
        "flex-grow" => style.flex_grow = value.parse().unwrap_or(0.0),
        "flex-shrink" => style.flex_shrink = value.parse().unwrap_or(1.0),
        "flex-basis" => style.flex_basis = parse_length(value),
        "flex" => {
            // flex: none | [ <grow> <shrink>? || <basis> ]
            if value == "none" {
                style.flex_grow = 0.0;
                style.flex_shrink = 0.0;
                style.flex_basis = Dimension::Auto;
            } else if value == "auto" {
                style.flex_grow = 1.0;
                style.flex_shrink = 1.0;
                style.flex_basis = Dimension::Auto;
            } else {
                let parts: Vec<&str> = value.split_whitespace().collect();
                match parts.as_slice() {
                    [basis] => {
                        // Single value: could be a number (grow) or a length (basis)
                        if let Ok(grow) = basis.parse::<f32>() {
                            style.flex_grow = grow;
                            style.flex_shrink = 1.0;
                            style.flex_basis = Dimension::Px(0.0);
                        } else {
                            style.flex_basis = parse_length(basis);
                        }
                    }
                    [grow, basis_or_shrink] => {
                        if let Ok(g) = grow.parse::<f32>() {
                            style.flex_grow = g;
                            // Second value: shrink number or basis length
                            if let Ok(s) = basis_or_shrink.parse::<f32>() {
                                style.flex_shrink = s;
                                style.flex_basis = Dimension::Px(0.0);
                            } else {
                                style.flex_shrink = 1.0;
                                style.flex_basis = parse_length(basis_or_shrink);
                            }
                        }
                    }
                    [grow, shrink, basis] => {
                        if let (Ok(g), Ok(s)) = (grow.parse::<f32>(), shrink.parse::<f32>()) {
                            style.flex_grow = g;
                            style.flex_shrink = s;
                            style.flex_basis = parse_length(basis);
                        }
                    }
                    _ => {}
                }
            }
        }
        "align-items" => style.align_items = match value {
            "flex-start" | "start" => AlignItems::FlexStart,
            "flex-end" | "end" => AlignItems::FlexEnd,
            "center" => AlignItems::Center,
            "baseline" => AlignItems::Baseline,
            _ => AlignItems::Stretch,
        },
        "align-content" => style.align_content = match value {
            "flex-start" | "start" => AlignContent::FlexStart,
            "flex-end" | "end" => AlignContent::FlexEnd,
            "center" => AlignContent::Center,
            "space-between" => AlignContent::SpaceBetween,
            "space-around" => AlignContent::SpaceAround,
            "space-evenly" => AlignContent::SpaceEvenly,
            "stretch" => AlignContent::Stretch,
            _ => AlignContent::Normal,
        },
        "justify-content" => style.justify_content = match value {
            "flex-end" | "end" => JustifyContent::FlexEnd,
            "center" => JustifyContent::Center,
            "space-between" => JustifyContent::SpaceBetween,
            "space-around" => JustifyContent::SpaceAround,
            "space-evenly" => JustifyContent::SpaceEvenly,
            _ => JustifyContent::FlexStart,
        },

        // Grid
        "grid-template-columns" => style.grid_template_columns = parse_track_list(value),
        "grid-template-rows" => style.grid_template_rows = parse_track_list(value),
        "gap" => {
            let parts: Vec<&str> = value.split_whitespace().collect();
            style.gap_row = parse_length(parts[0]);
            style.gap_column = if parts.len() > 1 { parse_length(parts[1]) } else { style.gap_row };
        }
        "row-gap" => style.gap_row = parse_length(value),
        "column-gap" => style.gap_column = parse_length(value),
        "grid-column" => {
            // grid-column: start / end  or  grid-column: start
            let parts: Vec<&str> = value.splitn(2, '/').map(str::trim).collect();
            style.grid_column_start = parse_grid_line(parts[0]);
            style.grid_column_end = parts.get(1).and_then(|s| parse_grid_line(s));
        }
        "grid-row" => {
            // grid-row: start / end  or  grid-row: start
            let parts: Vec<&str> = value.splitn(2, '/').map(str::trim).collect();
            style.grid_row_start = parse_grid_line(parts[0]);
            style.grid_row_end = parts.get(1).and_then(|s| parse_grid_line(s));
        }
        "grid-column-start" => style.grid_column_start = parse_grid_line(value),
        "grid-column-end" => style.grid_column_end = parse_grid_line(value),
        "grid-row-start" => style.grid_row_start = parse_grid_line(value),
        "grid-row-end" => style.grid_row_end = parse_grid_line(value),

        // Clip path
        "clip-path" => {
            style.clip_path = parse_clip_path(value);
        }

        // Effects
        "backdrop-filter" | "-webkit-backdrop-filter" => {
            style.backdrop_filter_blur = parse_backdrop_filter_blur(value);
        }
        "filter" => {
            style.filters = parse_css_filters(value);
        }
        "box-shadow" => {
            style.box_shadows = parse_box_shadow(value);
        }
        "mix-blend-mode" => {
            style.blend_mode = BlendMode::parse(value);
        }
        "text-shadow" => {
            style.text_shadows = parse_text_shadow(value);
        }

        "z-index" => {
            if value == "auto" {
                style.z_index = 0;
            } else {
                style.z_index = value.parse::<i32>().unwrap_or(0);
            }
        }

        "transform" => {
            let (t, pct) = parse_transform_with_pct(value);
            style.transform = t;
            style.transform_translate_pct = pct;
        }
        "transform-origin" => {
            let parts: Vec<&str> = value.split_whitespace().collect();
            if let Some(x) = parts.first() {
                style.transform_origin_x = parse_origin_component(x);
            }
            if let Some(y) = parts.get(1) {
                style.transform_origin_y = parse_origin_component(y);
            } else {
                style.transform_origin_y = style.transform_origin_x;
            }
        }

        // Content (for ::before / ::after)
        "content" => {
            if value == "none" || value == "normal" {
                style.content = None;
            } else {
                // Parse string literal: content: "text" or content: 'text'
                let trimmed = value.trim();
                if (trimmed.starts_with('"') && trimmed.ends_with('"'))
                    || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
                {
                    style.content = Some(trimmed[1..trimmed.len()-1].to_string());
                } else if trimmed.starts_with('"') || trimmed.starts_with('\'') {
                    // Unmatched quote — take everything after the first quote
                    style.content = Some(trimmed[1..].to_string());
                } else {
                    // Non-string content (counter(), attr(), etc.) — not supported
                    style.content = None;
                }
            }
        }

        _ => {} // Ignore unknown properties
    }
}

// ---------------------------------------------------------------------------
// Pseudo-element generation
// ---------------------------------------------------------------------------

/// Create a synthetic StyledNode for ::before or ::after pseudo-element.
/// Returns None if no matching rule with `content` property exists.
fn make_pseudo_element(
    node: &Handle,
    rules: &[CssRule],
    parent_style: &ComputedStyle,
    pseudo: PseudoElement,
) -> Option<StyledNode> {
    // Collect rules that target this node with the given pseudo-element
    let matching: Vec<&CssRule> = rules.iter()
        .filter(|r| match &r.selector {
            Selector::WithPseudo(base, pe) => *pe == pseudo && matches_selector(node, base),
            _ => false,
        })
        .collect();

    if matching.is_empty() { return None; }

    // Build computed style from matching rules
    let mut style = inherit_from(parent_style);
    // Default pseudo-elements to inline display
    style.display = Display::Inline;

    for rule in &matching {
        for decl in &rule.declarations {
            apply_declaration(&mut style, &decl.property, &decl.value);
        }
    }

    // Must have a content property to generate the pseudo-element
    let content = style.content.take()?;
    if content.is_empty() {
        // content: "" generates the element (for styling) but with no text
        // Still create the node for background/border rendering
    }

    Some(StyledNode {
        node: node.clone(), // Reuse parent node handle (pseudo-element is synthetic)
        style,
        text: if content.is_empty() { None } else { Some(content) },
        children: Vec::new(),
    })
}

// ---------------------------------------------------------------------------
// Transform parsing
// ---------------------------------------------------------------------------

/// Parse a CSS transform value into a tiny_skia::Transform.
/// Supports: translate, translateX, translateY, rotate, scale, scaleX, scaleY,
/// skew, skewX, skewY, matrix, none.
fn parse_transform(value: &str) -> Option<tiny_skia::Transform> {
    let value = value.trim();
    if value == "none" || value.is_empty() {
        return None;
    }

    let mut result = tiny_skia::Transform::identity();
    let mut pos = 0;
    let bytes = value.as_bytes();

    while pos < bytes.len() {
        // Skip whitespace
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() { pos += 1; }
        if pos >= bytes.len() { break; }

        // Find function name (everything before '(')
        let fn_start = pos;
        while pos < bytes.len() && bytes[pos] != b'(' { pos += 1; }
        if pos >= bytes.len() { break; }
        let fn_name = value[fn_start..pos].trim();
        pos += 1; // skip '('

        // Find closing ')'
        let args_start = pos;
        while pos < bytes.len() && bytes[pos] != b')' { pos += 1; }
        if pos >= bytes.len() { break; }
        let args_str = &value[args_start..pos];
        pos += 1; // skip ')'

        let args: Vec<f32> = args_str.split(',')
            .filter_map(|a| parse_transform_arg(a.trim()))
            .collect();

        let t = match fn_name {
            "translate" => {
                let tx = args.first().copied().unwrap_or(0.0);
                let ty = args.get(1).copied().unwrap_or(0.0);
                tiny_skia::Transform::from_translate(tx, ty)
            }
            "translateX" => {
                tiny_skia::Transform::from_translate(args.first().copied().unwrap_or(0.0), 0.0)
            }
            "translateY" => {
                tiny_skia::Transform::from_translate(0.0, args.first().copied().unwrap_or(0.0))
            }
            "rotate" => {
                let deg = args.first().copied().unwrap_or(0.0);
                tiny_skia::Transform::from_rotate(deg)
            }
            "scale" => {
                let sx = args.first().copied().unwrap_or(1.0);
                let sy = args.get(1).copied().unwrap_or(sx);
                tiny_skia::Transform::from_scale(sx, sy)
            }
            "scaleX" => {
                tiny_skia::Transform::from_scale(args.first().copied().unwrap_or(1.0), 1.0)
            }
            "scaleY" => {
                tiny_skia::Transform::from_scale(1.0, args.first().copied().unwrap_or(1.0))
            }
            "skew" => {
                let sx = args.first().copied().unwrap_or(0.0).to_radians().tan();
                let sy = args.get(1).copied().unwrap_or(0.0).to_radians().tan();
                tiny_skia::Transform::from_row(1.0, sy, sx, 1.0, 0.0, 0.0)
            }
            "skewX" => {
                let sx = args.first().copied().unwrap_or(0.0).to_radians().tan();
                tiny_skia::Transform::from_row(1.0, 0.0, sx, 1.0, 0.0, 0.0)
            }
            "skewY" => {
                let sy = args.first().copied().unwrap_or(0.0).to_radians().tan();
                tiny_skia::Transform::from_row(1.0, sy, 0.0, 1.0, 0.0, 0.0)
            }
            "matrix" if args.len() >= 6 => {
                tiny_skia::Transform::from_row(args[0], args[1], args[2], args[3], args[4], args[5])
            }
            _ => continue,
        };

        // CSS transforms apply right-to-left: "rotate scale translate" means
        // translate first, then scale, then rotate. pre_concat achieves this.
        result = result.pre_concat(t);
    }

    if result == tiny_skia::Transform::identity() {
        None
    } else {
        Some(result)
    }
}

/// Parse a CSS transform, extracting percentage-based translate separately.
/// Returns (transform_matrix, optional_translate_pct_fractions).
fn parse_transform_with_pct(value: &str) -> (Option<tiny_skia::Transform>, Option<(f32, f32)>) {
    let value = value.trim();
    if value == "none" || value.is_empty() {
        return (None, None);
    }

    let mut pct_tx: f32 = 0.0;
    let mut pct_ty: f32 = 0.0;
    let mut has_pct = false;

    // Pre-scan for translate with % args — extract them before normal parsing
    let mut cleaned = value.to_string();
    let mut pos = 0;
    let bytes = value.as_bytes();
    while pos < bytes.len() {
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() { pos += 1; }
        if pos >= bytes.len() { break; }
        let fn_start = pos;
        while pos < bytes.len() && bytes[pos] != b'(' { pos += 1; }
        if pos >= bytes.len() { break; }
        let fn_name = value[fn_start..pos].trim();
        pos += 1;
        let args_start = pos;
        while pos < bytes.len() && bytes[pos] != b')' { pos += 1; }
        if pos >= bytes.len() { break; }
        let args_str = &value[args_start..pos];
        pos += 1;

        let is_translate_fn = matches!(fn_name, "translate" | "translateX" | "translateY");
        if is_translate_fn && args_str.contains('%') {
            let parts: Vec<&str> = args_str.split(',').collect();
            match fn_name {
                "translate" => {
                    if let Some(x) = parse_pct_value(parts.first().unwrap_or(&"0")) {
                        pct_tx += x; has_pct = true;
                    }
                    if let Some(y) = parse_pct_value(parts.get(1).unwrap_or(&"0")) {
                        pct_ty += y; has_pct = true;
                    }
                }
                "translateX" => {
                    if let Some(x) = parse_pct_value(parts.first().unwrap_or(&"0")) {
                        pct_tx += x; has_pct = true;
                    }
                }
                "translateY" => {
                    if let Some(y) = parse_pct_value(parts.first().unwrap_or(&"0")) {
                        pct_ty += y; has_pct = true;
                    }
                }
                _ => {}
            }
            // Remove this function from the string so parse_transform doesn't see it
            let full_fn = &value[fn_start..pos];
            cleaned = cleaned.replace(full_fn, "");
        }
    }

    let transform = parse_transform(&cleaned);
    let pct = if has_pct { Some((pct_tx, pct_ty)) } else { None };
    (transform, pct)
}

/// Parse a percentage value like "-50%" → -0.5
fn parse_pct_value(s: &str) -> Option<f32> {
    let s = s.trim();
    if s.ends_with('%') {
        s.trim_end_matches('%').parse::<f32>().ok().map(|v| v / 100.0)
    } else {
        None
    }
}

/// Parse a single transform argument value.
/// Handles: plain numbers, px values, deg values, turn values, rad values.
fn parse_transform_arg(s: &str) -> Option<f32> {
    let s = s.trim();
    if s.is_empty() { return None; }
    let val = if let Some(v) = s.strip_suffix("deg") {
        v.trim().parse().ok()
    } else if let Some(v) = s.strip_suffix("rad") {
        v.trim().parse::<f32>().ok().map(|r| r.to_degrees())
    } else if let Some(v) = s.strip_suffix("turn") {
        v.trim().parse::<f32>().ok().map(|t| t * 360.0)
    } else if let Some(v) = s.strip_suffix("px") {
        v.trim().parse().ok()
    } else {
        s.parse().ok()
    };
    // Reject NaN/Infinity — per CSS spec, non-finite values invalidate the transform
    val.filter(|v| v.is_finite())
}

/// Parse a transform-origin component (e.g., "50%", "center", "left", "10px").
fn parse_origin_component(s: &str) -> f32 {
    match s.trim() {
        "left" | "top" => 0.0,
        "center" => 0.5,
        "right" | "bottom" => 1.0,
        v if v.ends_with('%') => v.trim_end_matches('%').parse::<f32>().unwrap_or(50.0) / 100.0,
        _ => 0.5,
    }
}

// ---------------------------------------------------------------------------
// Value parsers
// ---------------------------------------------------------------------------

/// Parse a CSS length value into a `Dimension`, preserving the original unit.
/// Parse a CSS grid line value (integer or "auto") into an Option<i16>.
/// Returns None for "auto" or invalid values (e.g. "span N").
fn parse_grid_line(s: &str) -> Option<i16> {
    let s = s.trim();
    if s == "auto" || s.is_empty() { return None; }
    // "span N" is not supported as a placement line — skip
    if s.starts_with("span") { return None; }
    s.parse::<i16>().ok()
}

fn parse_length(s: &str) -> Dimension {
    let s = s.trim();
    if s == "0" { return Dimension::Px(0.0); }
    if s == "auto" { return Dimension::Auto; }
    if s.starts_with("calc(") {
        // Parse calc() into a linear combination of percentage + px offset.
        // This preserves the percentage component for correct resolution at layout time.
        if let Some((frac, px)) = resolve_calc_linear(s) {
            // Pure px result (no percentage component) → collapse to Px
            if frac == 0.0 {
                return Dimension::Px(px);
            }
            return Dimension::Calc(frac, px);
        }
        return Dimension::Px(0.0);
    }
    if let Some(v) = s.strip_suffix('%') {
        return Dimension::Percent(v.trim().parse::<f32>().unwrap_or(0.0) / 100.0);
    }
    // Order matters: check "rem" before "em" since "rem" ends with "em"
    if let Some(v) = s.strip_suffix("rem") {
        return Dimension::Rem(v.trim().parse().unwrap_or(0.0));
    }
    if let Some(v) = s.strip_suffix("em") {
        return Dimension::Em(v.trim().parse().unwrap_or(0.0));
    }
    if let Some(v) = s.strip_suffix("vw") {
        return Dimension::Vw(v.trim().parse().unwrap_or(0.0));
    }
    if let Some(v) = s.strip_suffix("vh") {
        return Dimension::Vh(v.trim().parse().unwrap_or(0.0));
    }
    if let Some(v) = s.strip_suffix("px") {
        return Dimension::Px(v.trim().parse().unwrap_or(0.0));
    }
    // Plain number → px
    Dimension::Px(s.parse().unwrap_or(0.0))
}

/// Convenience: parse a CSS length and immediately resolve to px (no % context).
/// Used for values that are always resolved eagerly (font-size, etc.).
fn parse_px(s: &str) -> f32 {
    parse_length(s).resolve(0.0, ROOT_FONT_SIZE, Viewport::DEFAULT)
}

fn parse_dimension(s: &str) -> Dimension {
    parse_length(s)
}

/// Parse CSS shorthand with 1-4 values (margin, padding, etc.)
/// Handles calc() expressions that contain spaces without splitting them.
fn parse_shorthand_4(s: &str) -> [String; 4] {
    let parts = split_css_values(s);
    match parts.len() {
        1 => [parts[0].clone(), parts[0].clone(), parts[0].clone(), parts[0].clone()],
        2 => [parts[0].clone(), parts[1].clone(), parts[0].clone(), parts[1].clone()],
        3 => [parts[0].clone(), parts[1].clone(), parts[2].clone(), parts[1].clone()],
        _ => [
            parts.first().cloned().unwrap_or_else(|| "0".to_string()),
            parts.get(1).cloned().unwrap_or_else(|| "0".to_string()),
            parts.get(2).cloned().unwrap_or_else(|| "0".to_string()),
            parts.get(3).cloned().unwrap_or_else(|| "0".to_string()),
        ],
    }
}

/// Split CSS value list on whitespace, but don't split inside parentheses (e.g. calc()).
fn split_css_values(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    for ch in s.chars() {
        match ch {
            '(' => { depth += 1; current.push(ch); }
            ')' => { depth -= 1; current.push(ch); }
            c if c.is_whitespace() && depth == 0 => {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    parts.push(trimmed);
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        parts.push(trimmed);
    }
    parts
}

fn parse_border_shorthand(s: &str) -> Option<(Dimension, BorderStyle, Color)> {
    // "1px solid rgba(255,255,255,0.1)"  or  "4px dotted #00ff88"
    let s = s.trim();

    let mut width = Dimension::Px(1.0);
    let mut border_style = BorderStyle::Solid;
    let mut rest = s;

    // Try to parse "Npx" at the start
    if let Some(px_end) = s.find("px") {
        if let Ok(w) = s[..px_end].trim().parse::<f32>() {
            width = Dimension::Px(w);
            rest = s[px_end + 2..].trim();
        }
    }

    // Parse border style keyword
    for style_kw in &["solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset", "none"] {
        if rest.starts_with(style_kw) {
            border_style = BorderStyle::parse(style_kw);
            rest = rest[style_kw.len()..].trim();
            break;
        }
    }

    let color = parse_color(rest).unwrap_or(Color::from_rgba8(0, 0, 0, 255));
    Some((width, border_style, color))
}

fn parse_track_list(s: &str) -> Vec<GridTrackEntry> {
    let mut tracks = Vec::new();

    // Handle repeat(count_or_auto, value)
    if s.starts_with("repeat(") {
        if let Some(inner) = s.strip_prefix("repeat(").and_then(|s| s.strip_suffix(')')) {
            let parts: Vec<&str> = inner.splitn(2, ',').collect();
            if parts.len() == 2 {
                let kind_str = parts[0].trim();
                let repeat_kind = match kind_str {
                    "auto-fill" => GridRepeatKind::AutoFill,
                    "auto-fit" => GridRepeatKind::AutoFit,
                    _ => {
                        let count: u16 = kind_str.parse().unwrap_or(1).min(100);
                        GridRepeatKind::Count(count)
                    }
                };
                let track_def = parse_single_track_def(parts[1].trim());
                match repeat_kind {
                    GridRepeatKind::Count(n) => {
                        for _ in 0..n {
                            tracks.push(GridTrackEntry::Single(track_def));
                        }
                    }
                    _ => {
                        tracks.push(GridTrackEntry::Repeat(repeat_kind, vec![track_def]));
                    }
                }
                return tracks;
            }
        }
    }

    // Split tokens respecting parentheses (e.g. "minmax(40px, 1fr) 2fr")
    for token in split_track_tokens(s) {
        tracks.push(GridTrackEntry::Single(parse_single_track_def(token)));
    }
    tracks
}

/// Split a track list string into tokens, respecting parentheses.
/// "minmax(40px, 1fr) 2fr minmax(40px, 1fr)" → ["minmax(40px, 1fr)", "2fr", "minmax(40px, 1fr)"]
fn split_track_tokens(s: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut depth = 0usize;
    let mut start = 0;
    let mut in_token = false;

    for (i, c) in s.char_indices() {
        match c {
            '(' => { depth += 1; in_token = true; }
            ')' => { depth = depth.saturating_sub(1); }
            c if c.is_whitespace() && depth == 0 => {
                if in_token {
                    tokens.push(s[start..i].trim());
                    in_token = false;
                }
                start = i + 1;
            }
            _ => {
                if !in_token {
                    start = i;
                    in_token = true;
                }
            }
        }
    }
    if in_token && start < s.len() {
        tokens.push(s[start..].trim());
    }
    tokens
}

fn parse_single_track_def(s: &str) -> GridTrackDef {
    let s = s.trim();
    // Handle minmax(min, max) — preserve both values for Taffy
    if let Some(inner) = s.strip_prefix("minmax(").and_then(|s| s.strip_suffix(')')) {
        let parts: Vec<&str> = inner.splitn(2, ',').collect();
        if parts.len() == 2 {
            let min = parse_track_dimension(parts[0].trim());
            let max = parse_track_dimension(parts[1].trim());
            return GridTrackDef { min, max };
        }
    }
    GridTrackDef::single(parse_track_dimension(s))
}

fn parse_track_dimension(s: &str) -> Dimension {
    if s.ends_with("fr") {
        return Dimension::Fr(s.trim_end_matches("fr").parse().unwrap_or(1.0));
    }
    if s == "auto" {
        return Dimension::Auto;
    }
    if s == "min-content" || s == "max-content" {
        return Dimension::Auto; // approximate as auto
    }
    parse_length(s)
}

fn parse_linear_gradient(s: &str) -> Option<LinearGradient> {
    // "linear-gradient(135deg, #16213e, #0f3460)"
    let inner = s.trim()
        .strip_prefix("linear-gradient(")?
        .strip_suffix(')')?;

    let mut angle = Angle::deg(180.0); // default: top to bottom
    let mut stops = Vec::new();

    // Split on commas, but be careful with rgb()/rgba() which contain commas
    let parts = split_gradient_args(inner);

    let mut start_idx = 0;
    if let Some(first) = parts.first() {
        let first = first.trim();
        if first.ends_with("deg") {
            angle = Angle::deg(first.trim_end_matches("deg").parse().unwrap_or(180.0));
            start_idx = 1;
        } else if first == "to right" {
            angle = Angle::deg(90.0);
            start_idx = 1;
        } else if first == "to left" {
            angle = Angle::deg(270.0);
            start_idx = 1;
        } else if first == "to bottom" {
            angle = Angle::deg(180.0);
            start_idx = 1;
        } else if first == "to top" {
            angle = Angle::deg(0.0);
            start_idx = 1;
        }
    }

    for part in &parts[start_idx..] {
        let part = part.trim();
        if let Some(c) = parse_color(part) {
            stops.push(GradientStop { color: c, position: None });
        } else {
            // "color position" format — try to split
            // Find the last space that separates color from position
            let trimmed = part.trim();
            if let Some(last_space) = trimmed.rfind(' ') {
                let pos_str = &trimmed[last_space + 1..];
                let color_str = &trimmed[..last_space];
                if let Some(c) = parse_color(color_str) {
                    let pos = if pos_str.ends_with('%') {
                        pos_str.trim_end_matches('%').parse::<f32>().ok().map(|p| Fraction::unclamped(p / 100.0))
                    } else {
                        None
                    };
                    stops.push(GradientStop { color: c, position: pos });
                }
            }
        }
    }

    // Auto-distribute positions for stops without explicit positions
    if !stops.is_empty() {
        let total = stops.len();
        for (i, stop) in stops.iter_mut().enumerate() {
            if stop.position.is_none() {
                stop.position = Some(Fraction::unclamped(if total == 1 { 0.5 } else { i as f32 / (total - 1) as f32 }));
            }
        }
    }

    if stops.len() >= 2 {
        Some(LinearGradient { angle, stops })
    } else {
        None
    }
}


fn parse_radial_gradient(s: &str) -> Option<RadialGradient> {
    // Handles:
    //   radial-gradient(circle, #e94560, #0f3460)
    //   radial-gradient(ellipse at 30% 70%, #ff0, #00f, #000)
    let inner = s.trim()
        .strip_prefix("radial-gradient(")?
        .strip_suffix(')')?;

    let parts = split_gradient_args(inner);
    if parts.is_empty() { return None; }

    let mut shape = RadialShape::Ellipse; // CSS default
    let mut position = (0.5f32, 0.5f32);
    let mut start_idx = 0;

    let first = parts[0].trim();
    // Detect the shape/position descriptor: starts with "circle", "ellipse", or "at"
    let is_descriptor = first.starts_with("circle")
        || first.starts_with("ellipse")
        || first.starts_with("at ");

    if is_descriptor {
        start_idx = 1;
        if first.starts_with("circle") {
            shape = RadialShape::Circle;
        } else {
            shape = RadialShape::Ellipse;
        }
        // Parse optional "at X% Y%"
        if let Some(at_pos) = first.find(" at ") {
            let pos_str = &first[at_pos + 4..];
            let coords: Vec<&str> = pos_str.split_whitespace().collect();
            if coords.len() >= 2 {
                let parse_pct = |s: &str| -> f32 {
                    s.trim_end_matches('%').parse::<f32>().unwrap_or(50.0) / 100.0
                };
                position.0 = parse_pct(coords[0]);
                position.1 = parse_pct(coords[1]);
            }
        }
    }

    let mut stops: Vec<GradientStop> = Vec::new();
    for part in &parts[start_idx..] {
        let part = part.trim();
        if let Some(c) = parse_color(part) {
            stops.push(GradientStop { color: c, position: None });
        } else {
            let trimmed = part.trim();
            if let Some(last_space) = trimmed.rfind(' ') {
                let pos_str = &trimmed[last_space + 1..];
                let color_str = &trimmed[..last_space];
                if let Some(c) = parse_color(color_str) {
                    let pos = if pos_str.ends_with('%') {
                        pos_str.trim_end_matches('%').parse::<f32>().ok().map(|p| Fraction::unclamped(p / 100.0))
                    } else {
                        None
                    };
                    stops.push(GradientStop { color: c, position: pos });
                }
            }
        }
    }

    // Auto-distribute positions for stops without explicit positions
    if !stops.is_empty() {
        let total = stops.len();
        for (i, stop) in stops.iter_mut().enumerate() {
            if stop.position.is_none() {
                stop.position = Some(Fraction::unclamped(if total == 1 { 0.5 } else { i as f32 / (total - 1) as f32 }));
            }
        }
    }

    if stops.len() >= 2 {
        Some(RadialGradient { shape, position, stops })
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// CSS var() resolution
// ---------------------------------------------------------------------------

/// Resolve all `var(--name)` and `var(--name, fallback)` references in a CSS value.
fn resolve_var(value: &str, props: &HashMap<String, String>) -> String {
    resolve_var_inner(value, props, 0)
}

fn resolve_var_inner(value: &str, props: &HashMap<String, String>, depth: u32) -> String {
    const MAX_VAR_DEPTH: u32 = crate::limits::MAX_VAR_DEPTH;
    const MAX_VAR_OUTPUT_LEN: usize = crate::limits::MAX_VAR_OUTPUT_LEN;
    if depth > MAX_VAR_DEPTH || !value.contains("var(") || value.len() > MAX_VAR_OUTPUT_LEN {
        return value.to_string();
    }

    let mut result = String::with_capacity(value.len());
    let mut chars = value.char_indices().peekable();

    while let Some(&(pos, _)) = chars.peek() {
        if result.len() > MAX_VAR_OUTPUT_LEN {
            return result; // bail — output growing too large
        }
        if value[pos..].starts_with("var(") {
            // Skip past "var("
            for _ in 0..4 { chars.next(); }
            // Find matching closing paren (respecting nested parens)
            let start = pos + 4;
            let mut paren_depth: i32 = 1;
            let mut end = start;
            while let Some(&(i, c)) = chars.peek() {
                chars.next();
                if c == '(' { paren_depth += 1; }
                if c == ')' { paren_depth -= 1; }
                if paren_depth == 0 { end = i; break; }
            }

            let inner = &value[start..end];
            // Split on first comma for fallback: var(--name, fallback)
            let (var_name, fallback) = if let Some(comma) = inner.find(',') {
                (inner[..comma].trim(), Some(inner[comma + 1..].trim()))
            } else {
                (inner.trim(), None)
            };

            if let Some(val) = props.get(var_name) {
                result.push_str(&resolve_var_inner(val, props, depth + 1));
            } else if let Some(fb) = fallback {
                result.push_str(&resolve_var_inner(fb, props, depth + 1));
            }
            // else: undefined var with no fallback → empty string (spec behavior)
        } else if let Some((_, c)) = chars.next() {
            result.push(c);
        } else {
            break;
        }
    }

    result
}

// ---------------------------------------------------------------------------
// CSS calc() resolution
// ---------------------------------------------------------------------------

/// Resolve `calc()` into a linear combination (percent_fraction, px_offset).
/// E.g. `calc(100% - 40px)` → `Some((1.0, -40.0))`.
fn resolve_calc_linear(expr: &str) -> Option<(f32, f32)> {
    let inner = expr.trim()
        .strip_prefix("calc(")?
        .strip_suffix(')')?
        .trim();
    eval_calc_linear(inner)
}

/// Recursive descent calc evaluator returning (percent_frac, px_offset).
/// Handles: +, -, *, / with correct precedence, px, %, em, vw, vh units.
fn eval_calc_linear(expr: &str) -> Option<(f32, f32)> {
    let expr = expr.trim();
    // Handle nested calc/parens
    if expr.starts_with('(') {
        if let Some(inner) = strip_outer_parens(expr) {
            return eval_calc_linear(inner);
        }
    }

    // Split on + and - at top level (not inside parens), right to left
    let mut depth = 0i32;
    let bytes = expr.as_bytes();
    let mut split_pos = None;
    let mut split_op = b'+';
    for i in (0..bytes.len()).rev() {
        match bytes[i] {
            b')' => depth += 1,
            b'(' => depth -= 1,
            b'+' | b'-' if depth == 0 && i > 0 => {
                let prev = bytes[i - 1];
                if prev.is_ascii_whitespace() || prev.is_ascii_digit() || prev == b'%' || prev == b')' || prev == b'x' {
                    split_pos = Some(i);
                    split_op = bytes[i];
                    break;
                }
            }
            _ => {}
        }
    }

    if let Some(pos) = split_pos {
        let (lf, lp) = eval_calc_linear(&expr[..pos])?;
        let (rf, rp) = eval_calc_linear(&expr[pos + 1..])?;
        return Some(if split_op == b'+' {
            (lf + rf, lp + rp)
        } else {
            (lf - rf, lp - rp)
        });
    }

    // Split on * and / at top level
    depth = 0;
    let mut mul_pos = None;
    let mut mul_op = b'*';
    for i in (0..bytes.len()).rev() {
        match bytes[i] {
            b')' => depth += 1,
            b'(' => depth -= 1,
            b'*' | b'/' if depth == 0 => {
                mul_pos = Some(i);
                mul_op = bytes[i];
                break;
            }
            _ => {}
        }
    }

    if let Some(pos) = mul_pos {
        let (lf, lp) = eval_calc_linear(&expr[..pos])?;
        let (rf, rp) = eval_calc_linear(&expr[pos + 1..])?;
        // Multiplication/division: only valid when one side is a pure number (no units).
        // E.g. calc(256px / 2) — right side is (0.0, 2.0) but it's a scalar.
        // We treat a value with no percentage as a potential scalar.
        if mul_op == b'*' {
            if lf == 0.0 && rf == 0.0 {
                // Both pure px: scalar multiply
                return Some((0.0, lp * rp));
            } else if rf == 0.0 {
                // Right is scalar
                return Some((lf * rp, lp * rp));
            } else if lf == 0.0 {
                // Left is scalar
                return Some((rf * lp, rp * lp));
            }
            // Both have %: can't represent as linear — approximate
            return Some((0.0, (lf + lp) * (rf + rp)));
        } else {
            // Division: only right-side scalar is valid
            if rp != 0.0 {
                return Some((lf / rp, lp / rp));
            }
            return Some((0.0, 0.0));
        }
    }

    // Base case: a single value with unit
    parse_calc_value_linear(expr.trim())
}

fn strip_outer_parens(s: &str) -> Option<&str> {
    let s = s.trim();
    if !s.starts_with('(') || !s.ends_with(')') { return None; }
    let inner = &s[1..s.len() - 1];
    // Verify parens are balanced
    let mut depth = 0;
    for b in inner.bytes() {
        match b {
            b'(' => depth += 1,
            b')' => { depth -= 1; if depth < 0 { return None; } }
            _ => {}
        }
    }
    if depth == 0 { Some(inner) } else { None }
}

/// Parse a single calc value into (percent_frac, px_offset).
/// Percentage values go into the frac component; all other units resolve to px_offset.
fn parse_calc_value_linear(s: &str) -> Option<(f32, f32)> {
    let s = s.trim();
    if let Some(v) = s.strip_suffix("px") {
        return v.trim().parse::<f32>().ok().map(|px| (0.0, px));
    }
    if let Some(v) = s.strip_suffix('%') {
        return v.trim().parse::<f32>().ok().map(|p| (p / 100.0, 0.0));
    }
    if let Some(v) = s.strip_suffix("vw") {
        return v.trim().parse::<f32>().ok().map(|p| (0.0, p / 100.0 * 1280.0));
    }
    if let Some(v) = s.strip_suffix("vh") {
        return v.trim().parse::<f32>().ok().map(|p| (0.0, p / 100.0 * 720.0));
    }
    if let Some(v) = s.strip_suffix("em") {
        return v.trim().parse::<f32>().ok().map(|p| (0.0, p * 16.0));
    }
    // Plain number (unitless scalar)
    s.parse::<f32>().ok().map(|v| (0.0, v))
}

// ---------------------------------------------------------------------------
// clip-path parsing
// ---------------------------------------------------------------------------

/// Parse a CSS `clip-path` value into a `ClipPath`.
///
/// Supported forms:
/// - `none` → `ClipPath::None`
/// - `circle(50%)` → `ClipPath::Circle { radius: 0.5 }`
/// - `polygon(50% 0%, 0% 100%, 100% 100%)` → `ClipPath::Polygon { ... }`
fn parse_clip_path(value: &str) -> ClipPath {
    let value = value.trim();
    if value == "none" { return ClipPath::None; }

    if let Some(inner) = value.strip_prefix("circle(").and_then(|s| s.strip_suffix(')')) {
        // circle(<length-percentage> [at <position>]?) — we only support simple percentage
        let radius_str = inner.split_whitespace().next().unwrap_or("").trim_end_matches('%');
        if let Ok(pct) = radius_str.parse::<f32>() {
            return ClipPath::Circle { radius: pct / 100.0 };
        }
    }

    if let Some(inner) = value.strip_prefix("polygon(").and_then(|s| s.strip_suffix(')')) {
        let mut points = Vec::new();
        for pair in inner.split(',') {
            let parts: Vec<&str> = pair.split_whitespace().collect();
            if parts.len() >= 2 {
                let px = parts[0].trim_end_matches('%').parse::<f32>().unwrap_or(0.0) / 100.0;
                let py = parts[1].trim_end_matches('%').parse::<f32>().unwrap_or(0.0) / 100.0;
                points.push((px, py));
            }
        }
        if !points.is_empty() {
            return ClipPath::Polygon { points };
        }
    }

    ClipPath::None
}

// ---------------------------------------------------------------------------
// backdrop-filter parsing
// ---------------------------------------------------------------------------

fn parse_backdrop_filter_blur(value: &str) -> Option<f32> {
    let value = value.trim();
    if value == "none" { return None; }
    // Extract blur(Npx) from value like "blur(10px)"
    if let Some(rest) = value.strip_prefix("blur(") {
        if let Some(inner) = rest.strip_suffix(')') {
            return Some(parse_px(inner.trim()));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// filter parsing
// ---------------------------------------------------------------------------

/// Parse a CSS `filter` property value into a list of filter functions.
fn parse_css_filters(value: &str) -> Vec<CssFilter> {
    let value = value.trim();
    if value == "none" { return Vec::new(); }
    const MAX_FILTERS: usize = 16;
    let mut filters = Vec::new();
    let mut tokens: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut start = 0usize;
    for (i, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                if depth > 0 { depth -= 1; }
                if depth == 0 {
                    let token = value[start..i+1].trim();
                    if !token.is_empty() { tokens.push(token.to_string()); }
                    start = i + 1;
                }
            }
            _ => {}
        }
    }
    for token in &tokens {
        if filters.len() >= MAX_FILTERS { break; }
        let token = token.trim();
        if let Some(inner) = token.strip_prefix("blur(").and_then(|s| s.strip_suffix(')')) {
            filters.push(CssFilter::Blur(parse_px(inner.trim())));
        } else if let Some(inner) = token.strip_prefix("grayscale(").and_then(|s| s.strip_suffix(')')) {
            filters.push(CssFilter::Grayscale(parse_filter_amount(inner.trim()).clamp(0.0, 1.0)));
        } else if let Some(inner) = token.strip_prefix("brightness(").and_then(|s| s.strip_suffix(')')) {
            filters.push(CssFilter::Brightness(parse_filter_amount(inner.trim()).max(0.0)));
        } else if let Some(inner) = token.strip_prefix("contrast(").and_then(|s| s.strip_suffix(')')) {
            filters.push(CssFilter::Contrast(parse_filter_amount(inner.trim()).max(0.0)));
        } else if let Some(inner) = token.strip_prefix("drop-shadow(").and_then(|s| s.strip_suffix(')')) {
            if let Some(ds) = parse_drop_shadow_filter(inner.trim()) {
                filters.push(ds);
            }
        }
    }
    filters
}

fn parse_filter_amount(s: &str) -> f32 {
    if let Some(pct) = s.strip_suffix('%') {
        pct.trim().parse::<f32>().unwrap_or(0.0) / 100.0
    } else {
        s.parse::<f32>().unwrap_or(0.0)
    }
}

/// Parse drop-shadow filter arguments using cssparser tokenization.
fn parse_drop_shadow_filter(s: &str) -> Option<CssFilter> {
    let tokens = tokenize_css_value(s);
    let mut color = Color::from_rgba8(0, 0, 0, 128);
    let mut nums: Vec<f32> = Vec::new();

    for token in &tokens {
        let t = token.trim();
        if t.is_empty() { continue; }
        if t.ends_with("px") || t == "0" || t.parse::<f32>().is_ok() {
            nums.push(parse_px(t));
        } else if let Some(c) = parse_color(t) {
            color = c;
        }
    }

    if nums.len() < 2 { return None; }
    let offset_x = nums[0];
    let offset_y = nums[1];
    let blur = if nums.len() >= 3 { nums[2] } else { 0.0 };
    Some(CssFilter::DropShadow { offset_x, offset_y, blur, color })
}

// ---------------------------------------------------------------------------
// box-shadow parsing
// ---------------------------------------------------------------------------

fn parse_box_shadow(value: &str) -> Vec<BoxShadow> {
    let value = value.trim();
    if value == "none" { return Vec::new(); }

    // Split on commas (respecting parens for rgb/rgba)
    let parts = split_gradient_args(value);
    let mut shadows = Vec::new();
    const MAX_BOX_SHADOWS: usize = crate::limits::MAX_BOX_SHADOWS;

    for part in &parts {
        if shadows.len() >= MAX_BOX_SHADOWS { break; }
        if let Some(shadow) = parse_single_box_shadow(part.trim()) {
            shadows.push(shadow);
        }
    }
    shadows
}

/// Parse a single box-shadow value using cssparser tokenization.
/// Properly handles `inset` as a keyword token (not a blind string replace)
/// and functional color notation like `rgb()`, `rgba()`, `hsl()`.
fn parse_single_box_shadow(s: &str) -> Option<BoxShadow> {
    let s = s.trim();
    // Tokenize with cssparser to properly separate values
    let tokens = tokenize_css_value(s);
    let mut inset = false;
    let mut nums: Vec<f32> = Vec::new();
    let mut color: Option<Color> = None;

    for token in &tokens {
        let t = token.trim();
        if t.is_empty() { continue; }
        // Check for "inset" as a standalone keyword token
        if t.eq_ignore_ascii_case("inset") {
            inset = true;
            continue;
        }
        // Try as a number/length
        if t.ends_with("px") || t == "0" || t.parse::<f32>().is_ok() {
            nums.push(parse_px(t));
            continue;
        }
        // Try as a color (handles hex, named colors, rgb(), rgba(), hsl(), hsla())
        if color.is_none() {
            if let Some(c) = parse_color(t) {
                color = Some(c);
            }
        }
    }

    let color = color.unwrap_or(Color::from_rgba8(0, 0, 0, 128));
    let offset_x = nums.first().copied().unwrap_or(0.0);
    let offset_y = nums.get(1).copied().unwrap_or(0.0);
    let blur = nums.get(2).copied().unwrap_or(0.0);
    let spread = nums.get(3).copied().unwrap_or(0.0);

    Some(BoxShadow { offset_x, offset_y, blur, spread, color, inset })
}

/// Tokenize a CSS value into logical tokens using cssparser.
/// Groups function calls like `rgb(255, 0, 0)` into single tokens.
fn tokenize_css_value(s: &str) -> Vec<String> {
    let mut input = cssparser::ParserInput::new(s);
    let mut parser = cssparser::Parser::new(&mut input);
    let mut tokens = Vec::new();

    loop {
        let start = parser.position();
        match parser.next_including_whitespace() {
            Ok(token) => {
                match token {
                    cssparser::Token::WhiteSpace(_) => continue,
                    cssparser::Token::Function(_) => {
                        // Consume the entire function call including arguments
                        let func_start = start;
                        let _ = parser.parse_nested_block(|i| -> Result<(), cssparser::ParseError<()>> {
                            while i.next().is_ok() {}
                            Ok(())
                        });
                        tokens.push(parser.slice_from(func_start).to_string());
                    }
                    _ => {
                        tokens.push(parser.slice_from(start).trim().to_string());
                    }
                }
            }
            Err(_) => break,
        }
    }
    tokens
}

/// Parse the CSS `text-shadow` property.
/// Format: `<offset-x> <offset-y> [blur-radius] [color]`, comma-separated list.
/// Both `color first` and `color last` syntax are supported.
fn parse_text_shadow(value: &str) -> Vec<TextShadow> {
    let value = value.trim();
    if value == "none" { return Vec::new(); }

    let parts = split_gradient_args(value);
    let mut shadows = Vec::new();
    const MAX_TEXT_SHADOWS: usize = 16;

    for part in &parts {
        if shadows.len() >= MAX_TEXT_SHADOWS { break; }
        if let Some(shadow) = parse_single_text_shadow(part.trim()) {
            shadows.push(shadow);
        }
    }
    shadows
}

/// Parse a single text-shadow value using cssparser tokenization.
fn parse_single_text_shadow(s: &str) -> Option<TextShadow> {
    let s = s.trim();
    let tokens = tokenize_css_value(s);
    let mut nums: Vec<f32> = Vec::new();
    let mut color: Option<Color> = None;

    for token in &tokens {
        let t = token.trim();
        if t.is_empty() { continue; }
        if t.ends_with("px") || t == "0" || t.parse::<f32>().is_ok() {
            nums.push(parse_px(t));
        } else if color.is_none() {
            color = parse_color(t);
        }
    }

    if nums.len() < 2 { return None; }

    let offset_x    = nums[0];
    let offset_y    = nums[1];
    let blur_radius = nums.get(2).copied().unwrap_or(0.0);
    let shadow_color = color.unwrap_or(Color::from_rgba8(0, 0, 0, 255));

    Some(TextShadow { offset_x, offset_y, blur_radius, color: shadow_color })
}

/// Split gradient arguments respecting nested parentheses (for rgb/rgba).
fn split_gradient_args(s: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0;

    for ch in s.chars() {
        match ch {
            '(' => { depth += 1; current.push(ch); }
            ')' => { depth -= 1; current.push(ch); }
            ',' if depth == 0 => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

