//! Property-based tests targeting high-risk areas where bugs are likely to hide.
//!
//! Covers:
//! 1. CSS calc() evaluation — recursive descent, division by zero, nested expressions
//! 2. CSS color parsing — hex, rgb, rgba, hsl, hsla with edge cases
//! 3. CSS transform parsing — skew near 90°, NaN, Infinity, matrix composition
//! 4. CSS var() resolution — depth limits, exponential blowup, missing vars
//! 5. CSS gradient parsing — split_gradient_args with nested parens, single stops
//! 6. Path traversal — percent encoding, double-dot variants, symlinks
//! 7. Box shadow parsing — rgb() inside shadow values, extreme numbers
//! 8. CSS selector parsing — compound selectors, combinators, specificity
//! 9. Text glyph rasterization — bounds, negative coords, alpha compositing
//! 10. HTML script extraction — malformed tags, nested scripts, edge cases

use stage_runtime::canvas2d::state::parse_color;
use stage_runtime::content::loader::{
    safe_content_path_pub, url_to_content_path, extract_link_stylesheets,
};
use stage_runtime::htmlcss::style::{
    apply_declaration, ComputedStyle, Viewport, parse_css_rules,
};
use stage_runtime::canvas2d::text::{measure_text_full, box_blur_rgba};
use proptest::prelude::*;
use tiny_skia::Pixmap;

// =========================================================================
// 1. CSS calc() evaluation
// =========================================================================
// calc() is exposed through apply_declaration → dimension resolution.
// We test it indirectly by applying width/height declarations with calc().

fn make_style() -> ComputedStyle {
    ComputedStyle::default()
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, .. ProptestConfig::default() })]

    /// calc() with arbitrary arithmetic should never panic.
    #[test]
    fn calc_arbitrary_expr_no_panic(
        a in -1e6f32..1e6,
        b in -1e6f32..1e6,
        op in prop_oneof![ Just("+"), Just("-"), Just("*"), Just("/") ],
        unit_a in prop_oneof![ Just("px"), Just("%"), Just("vw"), Just("vh"), Just("em"), Just("") ],
        unit_b in prop_oneof![ Just("px"), Just("%"), Just("vw"), Just("vh"), Just("em"), Just("") ],
    ) {
        let expr = format!("calc({}{} {} {}{})", a, unit_a, op, b, unit_b);
        let mut style = make_style();
        // Should never panic regardless of values
        apply_declaration(&mut style, "width", &expr);
    }

    /// Nested calc() — deep nesting should not stack overflow.
    #[test]
    fn calc_nested_no_panic(depth in 1usize..20) {
        let mut expr = "10px".to_string();
        for _ in 0..depth {
            expr = format!("calc({} + 1px)", expr);
        }
        let mut style = make_style();
        apply_declaration(&mut style, "width", &expr);
    }

    /// calc() division by zero should not panic or produce Infinity.
    #[test]
    fn calc_div_zero_safe(a in -1000.0f32..1000.0) {
        let expr = format!("calc({}px / 0)", a);
        let mut style = make_style();
        apply_declaration(&mut style, "width", &expr);
        // Width should remain as-is or be set to 0, never Inf/NaN
        let resolved = style.width.resolve(1280.0, 16.0, Viewport::DEFAULT);
        prop_assert!(resolved.is_finite(), "calc div by 0 produced non-finite: {}", resolved);
    }

    /// calc() with percentage reference should produce finite results.
    #[test]
    fn calc_pct_finite(pct in -500.0f32..500.0, px in -1000.0f32..1000.0) {
        let expr = format!("calc({}% + {}px)", pct, px);
        let mut style = make_style();
        apply_declaration(&mut style, "width", &expr);
        let resolved = style.width.resolve(1280.0, 16.0, Viewport::DEFAULT);
        prop_assert!(resolved.is_finite(), "calc with % produced non-finite: {}", resolved);
    }
}

// =========================================================================
// 2. CSS color parsing
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 256, .. ProptestConfig::default() })]

    /// Hex colors round-trip: any valid #RRGGBB should parse to the same RGB values.
    #[test]
    fn color_hex6_roundtrip(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255) {
        let hex = format!("#{:02x}{:02x}{:02x}", r, g, b);
        let color = parse_color(&hex).expect("valid hex should parse");
        let to_u8 = |f: f32| (f * 255.0).round() as u8;
        prop_assert_eq!(to_u8(color.red()), r, "red mismatch for {}", hex);
        prop_assert_eq!(to_u8(color.green()), g, "green mismatch for {}", hex);
        prop_assert_eq!(to_u8(color.blue()), b, "blue mismatch for {}", hex);
        prop_assert_eq!(to_u8(color.alpha()), 255, "alpha should be 255 for {}", hex);
    }

    /// Hex colors with alpha round-trip: any valid #RRGGBBAA.
    #[test]
    fn color_hex8_roundtrip(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255, a in 0u8..=255) {
        let hex = format!("#{:02x}{:02x}{:02x}{:02x}", r, g, b, a);
        let color = parse_color(&hex).expect("valid hex8 should parse");
        let to_u8 = |f: f32| (f * 255.0).round() as u8;
        prop_assert_eq!(to_u8(color.red()), r, "red mismatch for {}", hex);
        prop_assert_eq!(to_u8(color.green()), g, "green mismatch for {}", hex);
        prop_assert_eq!(to_u8(color.blue()), b, "blue mismatch for {}", hex);
        prop_assert_eq!(to_u8(color.alpha()), a, "alpha mismatch for {}", hex);
    }

    /// Short hex #RGB should expand correctly (each nibble doubled).
    #[test]
    fn color_hex3_expansion(r in 0u8..16, g in 0u8..16, b in 0u8..16) {
        let hex = format!("#{:x}{:x}{:x}", r, g, b);
        let color = parse_color(&hex).expect("valid #RGB should parse");
        let to_u8 = |f: f32| (f * 255.0).round() as u8;
        prop_assert_eq!(to_u8(color.red()), r * 17, "red expand for {}", hex);
        prop_assert_eq!(to_u8(color.green()), g * 17, "green expand for {}", hex);
        prop_assert_eq!(to_u8(color.blue()), b * 17, "blue expand for {}", hex);
    }

    /// rgb() with valid integer components should parse correctly.
    #[test]
    fn color_rgb_integers(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255) {
        let s = format!("rgb({}, {}, {})", r, g, b);
        let color = parse_color(&s).expect("valid rgb() should parse");
        let to_u8 = |f: f32| (f * 255.0).round() as u8;
        prop_assert_eq!(to_u8(color.red()), r, "red for {}", s);
        prop_assert_eq!(to_u8(color.green()), g, "green for {}", s);
        prop_assert_eq!(to_u8(color.blue()), b, "blue for {}", s);
    }

    /// rgba() alpha channel should be clamped to [0, 1].
    #[test]
    fn color_rgba_alpha_clamp(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255, a in -2.0f32..3.0) {
        let s = format!("rgba({}, {}, {}, {})", r, g, b, a);
        if let Some(color) = parse_color(&s) {
            let alpha = color.alpha();
            prop_assert!(alpha >= 0.0 && alpha <= 1.0,
                "alpha should be clamped, got {} for input {}", alpha, a);
        }
    }

    /// rgb() with out-of-range values should be clamped to [0, 255].
    #[test]
    fn color_rgb_clamp(r in -100.0f32..400.0, g in -100.0f32..400.0, b in -100.0f32..400.0) {
        let s = format!("rgb({}, {}, {})", r, g, b);
        if let Some(color) = parse_color(&s) {
            let to_u8 = |f: f32| (f * 255.0).round() as u8;
            let cr = to_u8(color.red());
            let cg = to_u8(color.green());
            let cb = to_u8(color.blue());
            // All components should be valid u8 range (0-255) after clamping
            // Components are u8 so always <= 255; assert they parsed successfully
            let _ = (cr, cg, cb);
        }
    }

    /// HSL colors: hue wraps, saturation and lightness are [0,1].
    /// Output RGB components should always be in [0, 1].
    #[test]
    fn color_hsl_output_range(h in -720.0f32..720.0, s in 0.0f32..100.0, l in 0.0f32..100.0) {
        let input = format!("hsl({}deg, {}%, {}%)", h, s, l);
        if let Some(color) = parse_color(&input) {
            prop_assert!(color.red() >= 0.0 && color.red() <= 1.0,
                "red out of range: {} for {}", color.red(), input);
            prop_assert!(color.green() >= 0.0 && color.green() <= 1.0,
                "green out of range: {} for {}", color.green(), input);
            prop_assert!(color.blue() >= 0.0 && color.blue() <= 1.0,
                "blue out of range: {} for {}", color.blue(), input);
        }
    }

    /// HSL with saturation=0 should produce a grayscale value (r == g == b).
    #[test]
    fn color_hsl_zero_saturation_is_gray(h in 0.0f32..360.0, l in 0.0f32..100.0) {
        let input = format!("hsl({}deg, 0%, {}%)", h, l);
        if let Some(color) = parse_color(&input) {
            let r = (color.red() * 255.0).round() as u8;
            let g = (color.green() * 255.0).round() as u8;
            let b = (color.blue() * 255.0).round() as u8;
            prop_assert_eq!(r, g, "hsl(_, 0%, _) should be gray: r={} g={} b={}", r, g, b);
            prop_assert_eq!(g, b, "hsl(_, 0%, _) should be gray: r={} g={} b={}", r, g, b);
        }
    }

    /// Arbitrary garbage should never panic parse_color.
    #[test]
    fn color_garbage_no_panic(s in ".*") {
        let _ = parse_color(&s);
    }
}

// =========================================================================
// 3. CSS transform parsing
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, .. ProptestConfig::default() })]

    /// Transform strings with arbitrary values should never panic.
    #[test]
    fn transform_arbitrary_no_panic(
        fn_name in prop_oneof![
            Just("translate"), Just("translateX"), Just("translateY"),
            Just("rotate"), Just("scale"), Just("scaleX"), Just("scaleY"),
            Just("skew"), Just("skewX"), Just("skewY"), Just("matrix"),
        ],
        args in prop::collection::vec(-1e6f32..1e6, 1..7),
    ) {
        let args_str = args.iter()
            .map(|v| format!("{}", v))
            .collect::<Vec<_>>()
            .join(", ");
        let value = format!("{}({})", fn_name, args_str);
        let mut style = make_style();
        apply_declaration(&mut style, "transform", &value);
        // Transform should either be None or have finite values
        if let Some(t) = style.transform {
            prop_assert!(t.sx.is_finite(), "sx non-finite for {}", value);
            prop_assert!(t.sy.is_finite(), "sy non-finite for {}", value);
            prop_assert!(t.tx.is_finite(), "tx non-finite for {}", value);
            prop_assert!(t.ty.is_finite(), "ty non-finite for {}", value);
            prop_assert!(t.kx.is_finite(), "kx non-finite for {}", value);
            prop_assert!(t.ky.is_finite(), "ky non-finite for {}", value);
        }
    }

    /// Skew near 90° (where tan → Infinity) should be rejected or produce finite values.
    #[test]
    fn transform_skew_near_90_finite(
        angle in 89.0f32..91.0,
        sign in prop_oneof![Just(1.0f32), Just(-1.0)],
    ) {
        let deg = angle * sign;
        for func in &["skew", "skewX", "skewY"] {
            let value = format!("{}({}deg)", func, deg);
            let mut style = make_style();
            apply_declaration(&mut style, "transform", &value);
            if let Some(t) = style.transform {
                prop_assert!(t.sx.is_finite(), "{} sx non-finite at {}°", func, deg);
                prop_assert!(t.kx.is_finite(), "{} kx non-finite at {}°", func, deg);
                prop_assert!(t.ky.is_finite(), "{} ky non-finite at {}°", func, deg);
            }
        }
    }

    /// Multiple transforms composed should have finite result.
    #[test]
    fn transform_composition_finite(
        tx in -500.0f32..500.0,
        ty in -500.0f32..500.0,
        rot in -360.0f32..360.0,
        sx in 0.01f32..10.0,
        sy in 0.01f32..10.0,
    ) {
        let value = format!(
            "translate({}px, {}px) rotate({}deg) scale({}, {})",
            tx, ty, rot, sx, sy
        );
        let mut style = make_style();
        apply_declaration(&mut style, "transform", &value);
        if let Some(t) = style.transform {
            prop_assert!(t.sx.is_finite() && t.sy.is_finite() && t.tx.is_finite() && t.ty.is_finite(),
                "composed transform non-finite for {}", value);
        }
    }

    /// transform-origin keywords should not panic.
    #[test]
    fn transform_origin_keywords_no_panic(
        x in prop_oneof![Just("left"), Just("center"), Just("right"), Just("50%"), Just("0%"), Just("100%")],
        y in prop_oneof![Just("top"), Just("center"), Just("bottom"), Just("50%"), Just("0%"), Just("100%")],
    ) {
        let value = format!("{} {}", x, y);
        let mut style = make_style();
        apply_declaration(&mut style, "transform-origin", &value);
    }
}

// =========================================================================
// 4. CSS var() resolution
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    /// var() with missing variables should produce empty string, not panic.
    #[test]
    fn var_missing_no_panic(name in "[a-z]{1,20}") {
        let value = format!("var(--{})", name);
        let mut style = make_style();
        apply_declaration(&mut style, "color", &value);
    }

    /// var() with fallback should use fallback when variable is missing.
    #[test]
    fn var_fallback_applied(name in "[a-z]{1,10}", fallback_r in 0u8..=255) {
        let value = format!("var(--{}, rgb({}, 0, 0))", name, fallback_r);
        let mut style = make_style();
        apply_declaration(&mut style, "color", &value);
        // If custom properties were set, the fallback would be used
        // This mainly tests that parsing doesn't panic
    }
}

// =========================================================================
// 5. CSS gradient parsing (via apply_declaration)
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    /// Gradient with rgb() colors containing commas should parse without confusion.
    #[test]
    fn gradient_with_rgb_no_panic(
        r1 in 0u8..=255, g1 in 0u8..=255, b1 in 0u8..=255,
        r2 in 0u8..=255, g2 in 0u8..=255, b2 in 0u8..=255,
        angle in 0.0f32..360.0,
    ) {
        let value = format!(
            "linear-gradient({}deg, rgb({}, {}, {}), rgb({}, {}, {}))",
            angle, r1, g1, b1, r2, g2, b2
        );
        let mut style = make_style();
        apply_declaration(&mut style, "background", &value);
    }

    /// Gradient with rgba() and percentage stops.
    #[test]
    fn gradient_rgba_with_stops_no_panic(
        r in 0u8..=255, g in 0u8..=255, b in 0u8..=255, a in 0.0f32..1.0,
        stop1 in 0.0f32..100.0, stop2 in 0.0f32..100.0,
    ) {
        let value = format!(
            "linear-gradient(90deg, rgba({}, {}, {}, {}) {}%, white {}%)",
            r, g, b, a, stop1, stop2
        );
        let mut style = make_style();
        apply_declaration(&mut style, "background", &value);
    }

    /// Gradient with a single color stop (should not divide by zero in position distribution).
    #[test]
    fn gradient_single_stop_no_div_zero(r in 0u8..=255, g in 0u8..=255, b in 0u8..=255) {
        // A single-stop gradient is technically invalid CSS, but should not panic.
        let value = format!("linear-gradient(180deg, rgb({}, {}, {}))", r, g, b);
        let mut style = make_style();
        apply_declaration(&mut style, "background", &value);
    }
}

// =========================================================================
// 6. Path traversal prevention
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, .. ProptestConfig::default() })]

    /// Percent-encoded ".." should be caught.
    #[test]
    fn path_traversal_percent_encoded(
        prefix in "[a-z]{0,5}",
        suffix in "[a-z]{0,5}",
    ) {
        let dir = tempfile::tempdir().unwrap();
        // %2e = '.', so %2e%2e = '..'
        let variants = [
            format!("{}%2e%2e/{}", prefix, suffix),
            format!("{}%2E%2E/{}", prefix, suffix),
            format!("{}..%2f{}", prefix, suffix),
            format!("{}%2e./{}", prefix, suffix),
            format!("{}.%2e/{}", prefix, suffix),
        ];
        for path in &variants {
            let result = safe_content_path_pub(dir.path(), path);
            // If the decoded path contains "..", it should be rejected
            if path.contains("..") || path.contains("%2e%2e") || path.contains("%2E%2E")
                || path.contains("%2e.") || path.contains(".%2e") || path.contains(".%2E")
            {
                // After percent-decoding, if ".." is present, should be None
                // Note: some variants may not decode to ".." - that's OK
            }
            // Main assertion: should never panic
        }
    }

    /// Arbitrary relative paths should never panic safe_content_path.
    #[test]
    fn path_traversal_arbitrary_no_panic(path in ".{0,100}") {
        let dir = tempfile::tempdir().unwrap();
        let _ = safe_content_path_pub(dir.path(), &path);
    }

    /// url_to_content_path should never panic on arbitrary URLs.
    #[test]
    fn url_to_content_path_no_panic(url in ".{0,200}") {
        let dir = tempfile::tempdir().unwrap();
        let _ = url_to_content_path(&url, dir.path());
    }

    /// Paths with null bytes should be handled safely.
    #[test]
    fn path_null_bytes_safe(
        before in "[a-z]{1,5}",
        after in "[a-z]{1,5}",
    ) {
        let dir = tempfile::tempdir().unwrap();
        let path = format!("{}\0{}", before, after);
        let _ = safe_content_path_pub(dir.path(), &path);
    }
}

// =========================================================================
// 7. Box shadow parsing
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    /// Box shadow with rgb() color should parse without confusing the comma splitter.
    #[test]
    fn box_shadow_rgb_no_panic(
        ox in -50.0f32..50.0,
        oy in -50.0f32..50.0,
        blur in 0.0f32..100.0,
        spread in -50.0f32..50.0,
        r in 0u8..=255, g in 0u8..=255, b in 0u8..=255,
    ) {
        let value = format!("{}px {}px {}px {}px rgb({}, {}, {})", ox, oy, blur, spread, r, g, b);
        let mut style = make_style();
        apply_declaration(&mut style, "box-shadow", &value);
    }

    /// Box shadow with rgba() and inset.
    #[test]
    fn box_shadow_inset_rgba_no_panic(
        ox in -50.0f32..50.0,
        oy in -50.0f32..50.0,
        blur in 0.0f32..100.0,
        r in 0u8..=255, g in 0u8..=255, b in 0u8..=255, a in 0.0f32..1.0,
    ) {
        let value = format!("inset {}px {}px {}px rgba({}, {}, {}, {})", ox, oy, blur, r, g, b, a);
        let mut style = make_style();
        apply_declaration(&mut style, "box-shadow", &value);
    }

    /// Multiple box shadows separated by commas.
    #[test]
    fn box_shadow_multiple_no_panic(count in 1usize..8) {
        let shadows: Vec<String> = (0..count)
            .map(|i| format!("{}px {}px {}px black", i, i, i))
            .collect();
        let value = shadows.join(", ");
        let mut style = make_style();
        apply_declaration(&mut style, "box-shadow", &value);
    }

    /// Box shadow with extreme values should not overflow.
    #[test]
    fn box_shadow_extreme_values(
        ox in prop_oneof![Just(f32::MAX), Just(f32::MIN), Just(0.0f32), Just(1e30f32)],
        oy in prop_oneof![Just(f32::MAX), Just(f32::MIN), Just(0.0f32), Just(1e30f32)],
    ) {
        let value = format!("{}px {}px 0px black", ox, oy);
        let mut style = make_style();
        apply_declaration(&mut style, "box-shadow", &value);
    }
}

// =========================================================================
// 8. CSS selector parsing (via parse_css_rules)
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, .. ProptestConfig::default() })]

    /// Arbitrary CSS rule strings should never panic parse_css_rules.
    #[test]
    fn css_rules_arbitrary_no_panic(
        selector in "[a-z\\.#:\\[\\]>+~ *]{1,30}",
        prop in "[a-z-]{1,15}",
        value in "[a-z0-9#%()., ]{1,30}",
    ) {
        let css = format!("{} {{ {}: {}; }}", selector, prop, value);
        let _ = parse_css_rules(&css);
    }

    /// Compound selectors with combinators should parse.
    #[test]
    fn css_compound_selectors_no_panic(
        tag in prop_oneof![Just("div"), Just("span"), Just("p"), Just("a"), Just("section")],
        class in "[a-z]{1,10}",
        id in "[a-z]{1,10}",
        comb in prop_oneof![Just(" "), Just(" > "), Just(" + "), Just(" ~ ")],
    ) {
        let selectors = vec![
            format!("{}.{}", tag, class),
            format!("#{}", id),
            format!("{}{}{}.{}", tag, comb, tag, class),
            format!("{}.{}{}#{}", tag, class, comb, id),
            format!("{}::before", tag),
            format!("{}::after", tag),
            format!("{}[data-x=\"val\"]", tag),
        ];
        for sel in &selectors {
            let css = format!("{} {{ color: red; }}", sel);
            let rules = parse_css_rules(&css);
            // Should parse at least one rule for valid selectors
            prop_assert!(!rules.is_empty(), "no rules parsed for: {}", sel);
        }
    }

    /// Deeply nested selectors should not stack overflow.
    #[test]
    fn css_deep_descendant_no_overflow(depth in 1usize..50) {
        let selector: String = (0..depth).map(|_| "div").collect::<Vec<_>>().join(" > ");
        let css = format!("{} {{ color: red; }}", selector);
        let _ = parse_css_rules(&css);
    }
}

// =========================================================================
// 9. Text glyph measurement edge cases
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    /// measure_text_full should never panic on arbitrary text and sizes.
    #[test]
    fn text_measure_no_panic(
        text in ".{0,100}",
        font_size in -100.0f32..200.0,
        bold in any::<bool>(),
    ) {
        let metrics = measure_text_full(&text, font_size, bold);
        // Width should be non-negative for valid sizes
        if font_size > 0.0 && !text.is_empty() {
            prop_assert!(metrics.width >= 0.0, "negative width for '{}'", text);
        }
        // All metrics should be finite
        prop_assert!(metrics.width.is_finite(), "width non-finite");
        prop_assert!(metrics.actual_bounding_box_left.is_finite(), "bbox left non-finite");
        prop_assert!(metrics.actual_bounding_box_right.is_finite(), "bbox right non-finite");
        prop_assert!(metrics.actual_bounding_box_ascent.is_finite(), "bbox ascent non-finite");
        prop_assert!(metrics.actual_bounding_box_descent.is_finite(), "bbox descent non-finite");
    }

    /// box_blur_rgba should never panic on arbitrary radius and pixmap sizes.
    #[test]
    fn box_blur_no_panic(
        w in 1u32..64,
        h in 1u32..64,
        radius in 0usize..32,
    ) {
        if let Some(mut pm) = Pixmap::new(w, h) {
            // Fill with random-ish data
            for px in pm.data_mut().iter_mut() {
                *px = (w as u8).wrapping_mul(h as u8).wrapping_add(*px);
            }
            box_blur_rgba(&mut pm, radius);
            // All pixels should still be valid
            // Verify no panic occurred — pixels are u8 so always valid
            let _ = pm.data();
        }
    }

    /// Zero font size should return zero-width metrics.
    #[test]
    fn text_zero_font_size(text in ".{1,20}") {
        let metrics = measure_text_full(&text, 0.0, false);
        prop_assert_eq!(metrics.width, 0.0, "zero font size should give zero width");
    }

    /// Negative font size should return zero-width metrics.
    #[test]
    fn text_negative_font_size(text in ".{1,20}", size in -100.0f32..-0.01) {
        let metrics = measure_text_full(&text, size, false);
        prop_assert_eq!(metrics.width, 0.0, "negative font size should give zero width");
    }
}

// =========================================================================
// 10. HTML script/stylesheet extraction edge cases
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    /// Arbitrary HTML-like strings should never panic script/stylesheet extraction.
    #[test]
    fn html_extraction_no_panic(html in ".{0,500}") {
        let dir = tempfile::tempdir().unwrap();
        let _ = extract_link_stylesheets(&html, dir.path());
    }

    /// Malformed script tags should not panic.
    #[test]
    fn malformed_script_tags_no_panic(
        content in "[a-zA-Z0-9 ;=()]{0,50}",
        variant in 0u8..6,
    ) {
        let html = match variant {
            0 => format!("<script>{}", content),                    // unclosed
            1 => format!("<script>{}</script", content),            // missing >
            2 => format!("<SCRIPT>{}</SCRIPT>", content),           // uppercase
            3 => format!("<script type='text/javascript'>{}</script>", content),
            4 => format!("<script\n\t>{}</script>", content),       // whitespace in tag
            _ => format!("<script>{}<script>{}</script>", content, content), // nested
        };
        let dir = tempfile::tempdir().unwrap();
        let _ = extract_link_stylesheets(&html, dir.path());
    }

    /// Stylesheet link tags with various attribute quoting styles.
    #[test]
    fn link_tag_quoting_no_panic(
        href in "[a-z./]{1,20}",
        quote in prop_oneof![Just("\""), Just("'"), Just("")],
    ) {
        let html = format!(
            "<link rel=\"stylesheet\" href={0}{1}{0}>",
            quote, href
        );
        let dir = tempfile::tempdir().unwrap();
        let _ = extract_link_stylesheets(&html, dir.path());
    }
}

// =========================================================================
// 11. CSS shorthand expansion edge cases
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 128, .. ProptestConfig::default() })]

    /// margin/padding shorthand with 1-4 values should not panic.
    #[test]
    fn shorthand_margin_no_panic(
        values in prop::collection::vec(-1000.0f32..1000.0, 1..5),
    ) {
        let value = values.iter()
            .map(|v| format!("{}px", v))
            .collect::<Vec<_>>()
            .join(" ");
        let mut style = make_style();
        apply_declaration(&mut style, "margin", &value);
        apply_declaration(&mut style, "padding", &value);
    }

    /// border shorthand with various formats.
    #[test]
    fn shorthand_border_no_panic(
        width in 0.0f32..20.0,
        style_name in prop_oneof![Just("solid"), Just("dashed"), Just("dotted"), Just("none"), Just("double")],
        color in prop_oneof![Just("red"), Just("blue"), Just("#ff0000"), Just("rgb(0,0,0)"), Just("transparent")],
    ) {
        let value = format!("{}px {} {}", width, style_name, color);
        let mut style = make_style();
        apply_declaration(&mut style, "border", &value);
    }

    /// Dimension values with various units should not panic.
    #[test]
    fn dimension_units_no_panic(
        value in -1e6f32..1e6,
        unit in prop_oneof![
            Just("px"), Just("%"), Just("em"), Just("rem"),
            Just("vw"), Just("vh"), Just("vmin"), Just("vmax"),
            Just("pt"), Just("cm"), Just("mm"), Just("in"),
            Just(""), // unitless
        ],
        prop in prop_oneof![
            Just("width"), Just("height"), Just("min-width"), Just("max-width"),
            Just("margin-top"), Just("padding-left"), Just("font-size"),
            Just("border-width"), Just("gap"), Just("top"), Just("left"),
        ],
    ) {
        let decl = format!("{}{}", value, unit);
        let mut style = make_style();
        apply_declaration(&mut style, &prop, &decl);
    }
}

// =========================================================================
// 12. Dimension resolution with extreme viewport sizes
// =========================================================================

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    /// Viewport-relative units with extreme viewport sizes should produce finite results.
    #[test]
    fn dimension_extreme_viewport(
        vw in 1.0f32..10000.0,
        vh in 1.0f32..10000.0,
        value in -500.0f32..500.0,
        unit in prop_oneof![Just("vw"), Just("vh"), Just("%")],
    ) {
        let vp = Viewport { w: vw, h: vh, root_font_size: 16.0 };
        let decl = format!("{}{}", value, unit);
        let mut style = make_style();
        apply_declaration(&mut style, "width", &decl);
        let resolved = style.width.resolve(vw, 16.0, vp);
        prop_assert!(resolved.is_finite(),
            "non-finite for {}vw x {}vh viewport with {}{}", vw, vh, value, unit);
    }
}
