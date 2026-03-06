import { z } from "zod"
import type { CatalogEntry } from "../../core/catalog"

const styleZ = z.record(z.unknown()).optional().describe("CSS style overrides")

const components: Record<string, CatalogEntry & { category: string }> = {
  // ── Layout ──────────────────────────────────────────────
  Box: {
    category: "Layout",
    description: "General-purpose container. The fundamental building block.",
    hasChildren: true,
    props: z.object({
      style: styleZ,
    }),
  },

  Stack: {
    category: "Layout",
    description: "Vertical or horizontal stack with gap.",
    hasChildren: true,
    props: z.object({
      direction: z.enum(["vertical", "horizontal"]).optional().describe('Stack direction (default: "vertical")'),
      gap: z.number().optional().describe("Gap in px (default: 8)"),
      align: z.enum(["start", "center", "end", "stretch"]).optional().describe("Cross-axis alignment"),
      justify: z.enum(["start", "center", "end", "between", "around"]).optional().describe("Main-axis justification"),
      style: styleZ,
    }),
  },

  Grid: {
    category: "Layout",
    description: "CSS Grid layout.",
    hasChildren: true,
    props: z.object({
      columns: z.union([z.number(), z.string()]).optional().describe("Column count or grid-template-columns (default: 1)"),
      rows: z.string().optional().describe("grid-template-rows"),
      gap: z.number().optional().describe("Gap in px (default: 8)"),
      style: styleZ,
    }),
  },

  Split: {
    category: "Layout",
    description: 'Two-panel split layout. First child = primary, second = secondary.',
    hasChildren: true,
    props: z.object({
      ratio: z.string().optional().describe('Ratio as "primary/secondary" (default: "2/1")'),
      direction: z.enum(["horizontal", "vertical"]).optional().describe('Split direction (default: "horizontal")'),
      gap: z.number().optional().describe("Gap in px"),
      style: styleZ,
    }),
  },

  // ── Text ────────────────────────────────────────────────
  Heading: {
    category: "Text",
    description: "Display heading. For broadcast: level 1 should be 64–120px (hero), level 2 should be 36–56px (section). Use style.fontSize to override.",
    props: z.object({
      text: z.string().describe("Heading text"),
      level: z.number().min(1).max(6).optional().describe("Heading level 1-6 (default: 2)"),
      style: styleZ,
    }),
  },

  Text: {
    category: "Text",
    description: "Body text with variant styling. For broadcast: use 24–36px for readable body text on 1920×1080. Captions/labels: 16–24px.",
    props: z.object({
      text: z.string().describe("Text content"),
      variant: z.enum(["body", "caption", "label", "mono"]).optional().describe('Text variant (default: "body")'),
      style: styleZ,
    }),
  },

  Code: {
    category: "Text",
    description: "Code block with monospace font and dark background.",
    props: z.object({
      code: z.string().describe("Code content"),
      language: z.string().optional().describe("Language hint"),
      title: z.string().optional().describe("Optional title header"),
      style: styleZ,
    }),
  },

  // ── Content ─────────────────────────────────────────────
  Card: {
    category: "Content",
    description: "Contained card with optional header. Children render in the content area.",
    hasChildren: true,
    props: z.object({
      title: z.string().optional().describe("Card title"),
      subtitle: z.string().optional().describe("Card subtitle"),
      style: styleZ,
      headerStyle: z.record(z.unknown()).optional().describe("Header style overrides"),
    }),
  },

  Image: {
    category: "Content",
    description: "Display an image from URL.",
    props: z.object({
      src: z.string().describe("Image URL"),
      alt: z.string().optional().describe("Alt text"),
      fit: z.enum(["cover", "contain", "fill", "none"]).optional().describe('Object-fit (default: "cover")'),
      style: styleZ,
    }),
  },

  Divider: {
    category: "Content",
    description: "Horizontal or vertical divider line.",
    props: z.object({
      direction: z.enum(["horizontal", "vertical"]).optional().describe('Direction (default: "horizontal")'),
      style: styleZ,
    }),
  },

  // ── Broadcast ───────────────────────────────────────────
  LowerThird: {
    category: "Broadcast",
    description: "Broadcast lower-third overlay with name and title.",
    props: z.object({
      name: z.string().describe("Primary name/label"),
      title: z.string().optional().describe("Title line"),
      subtitle: z.string().optional().describe("Subtitle line"),
      accentColor: z.string().optional().describe('Accent color (default: "#58a6ff")'),
      style: styleZ,
    }),
  },

  Ticker: {
    category: "Broadcast",
    description: "Scrolling horizontal text ticker.",
    props: z.object({
      items: z.array(z.object({
        text: z.string(),
        category: z.string().optional(),
        urgent: z.boolean().optional(),
      })).describe("Ticker items"),
      speed: z.number().optional().describe("Scroll speed in px/s (default: 60)"),
      style: styleZ,
    }),
  },

  Banner: {
    category: "Broadcast",
    description: "Full-width announcement bar.",
    props: z.object({
      text: z.string().describe("Banner text"),
      severity: z.enum(["info", "warning", "error", "success"]).optional().describe('Severity (default: "info")'),
      style: styleZ,
    }),
  },

  Badge: {
    category: "Broadcast",
    description: "Small status tag/pill. For broadcast: use 14–20px font size with generous padding (8–16px horizontal) so it reads on screen.",
    props: z.object({
      text: z.string().describe("Badge text"),
      variant: z.enum(["default", "success", "warning", "error", "info"]).optional().describe('Variant (default: "default")'),
      style: styleZ,
    }),
  },

  // ── SVG ───────────────────────────────────────────────
  Shape: {
    category: "SVG",
    description: "SVG shape primitive: rect, circle, ellipse, or polygon.",
    props: z.object({
      shape: z.enum(["rect", "circle", "ellipse", "polygon"]).optional().describe('Shape type (default: "rect")'),
      width: z.number().optional().describe("Width in px (default: 100)"),
      height: z.number().optional().describe("Height in px (default: 100)"),
      fill: z.string().optional().describe('Fill color (default: "none")'),
      stroke: z.string().optional().describe('Stroke color (default: "#e6edf3")'),
      strokeWidth: z.number().optional().describe("Stroke width (default: 1)"),
      points: z.string().optional().describe("Points for polygon (e.g. \"50,0 100,100 0,100\")"),
      style: styleZ,
    }),
  },

  Line: {
    category: "SVG",
    description: "SVG line between two points.",
    props: z.object({
      x1: z.number().optional().describe("Start X (default: 0)"),
      y1: z.number().optional().describe("Start Y (default: 0)"),
      x2: z.number().optional().describe("End X (default: 100)"),
      y2: z.number().optional().describe("End Y (default: 0)"),
      stroke: z.string().optional().describe('Stroke color (default: "#e6edf3")'),
      strokeWidth: z.number().optional().describe("Stroke width (default: 1)"),
      strokeDasharray: z.string().optional().describe("Dash pattern (e.g. \"5,5\")"),
      style: styleZ,
    }),
  },

  Path: {
    category: "SVG",
    description: "SVG path from a path data string.",
    props: z.object({
      d: z.string().describe("SVG path data string"),
      fill: z.string().optional().describe('Fill color (default: "none")'),
      stroke: z.string().optional().describe('Stroke color (default: "#e6edf3")'),
      strokeWidth: z.number().optional().describe("Stroke width (default: 1)"),
      style: styleZ,
    }),
  },

  SvgContainer: {
    category: "SVG",
    description: "SVG wrapper element with viewBox. Children render inside the SVG.",
    hasChildren: true,
    props: z.object({
      viewBox: z.string().optional().describe('SVG viewBox (default: "0 0 100 100")'),
      width: z.union([z.number(), z.string()]).optional().describe("Width"),
      height: z.union([z.number(), z.string()]).optional().describe("Height"),
      style: styleZ,
    }),
  },

  // ── Animation ────────────────────────────────────────────
  Transition: {
    category: "Animation",
    description: "Wrapper that applies CSS transitions to children on prop changes.",
    hasChildren: true,
    props: z.object({
      property: z.string().optional().describe('CSS property to transition (default: "all")'),
      duration: z.number().optional().describe("Duration in ms (default: 300)"),
      easing: z.enum(["ease", "ease-in", "ease-out", "ease-in-out", "linear"]).optional().describe('Easing function (default: "ease")'),
      delay: z.number().optional().describe("Delay in ms (default: 0)"),
      style: styleZ,
    }),
  },

  FadeIn: {
    category: "Animation",
    description: "Wrapper that fades children in on mount using CSS animation.",
    hasChildren: true,
    props: z.object({
      duration: z.number().optional().describe("Duration in ms (default: 500)"),
      delay: z.number().optional().describe("Delay in ms (default: 0)"),
      style: styleZ,
    }),
  },

  Counter: {
    category: "Animation",
    description: "Animated number counter display. The value should be a hero element — use 72–120px font size to command attention on broadcast.",
    props: z.object({
      value: z.number().describe("Target number value"),
      prefix: z.string().optional().describe("Text before the number"),
      suffix: z.string().optional().describe("Text after the number"),
      duration: z.number().optional().describe("Animation duration in ms"),
      style: styleZ,
    }),
  },

  Animate: {
    category: "Animation",
    description: "Wrapper that applies enter/exit/loop animations to children. Valid presets: fade-in, slide-in-left, slide-in-right, slide-in-up, slide-in-down, scale-up, scale-down, bounce-in, pulse. Shorthand aliases (bounce, slide-up, slide-down, slide-left, slide-right, scale) also work.",
    hasChildren: true,
    props: z.object({
      preset: z.enum(["fade-in", "slide-in-left", "slide-in-right", "slide-in-up", "slide-in-down", "scale-up", "scale-down", "bounce-in", "pulse"]).optional().describe('Animation preset (default: "fade-in")'),
      duration: z.number().optional().describe("Duration in ms (default: 500)"),
      delay: z.number().optional().describe("Delay in ms (default: 0)"),
      easing: z.enum(["ease", "ease-in", "ease-out", "ease-in-out", "linear"]).optional().describe('Easing function (default: "ease")'),
      loop: z.boolean().optional().describe("Loop animation infinitely (default: false)"),
      style: styleZ,
    }),
  },

  Stagger: {
    category: "Animation",
    description: "Sequences animation of child elements with configurable delay between each child.",
    hasChildren: true,
    props: z.object({
      preset: z.enum(["fade-in", "slide-in-left", "slide-in-right", "slide-in-up", "slide-in-down", "scale-up"]).optional().describe('Animation preset applied to each child (default: "fade-in")'),
      interval: z.number().optional().describe("Delay between each child in ms (default: 100)"),
      duration: z.number().optional().describe("Duration per child in ms (default: 400)"),
      easing: z.enum(["ease", "ease-in", "ease-out", "ease-in-out", "linear"]).optional().describe('Easing function (default: "ease")'),
      style: styleZ,
    }),
  },

  Presence: {
    category: "Animation",
    description: "Conditionally shows/hides content with enter/exit transitions. Bind visible to state to toggle.",
    hasChildren: true,
    props: z.object({
      visible: z.boolean().describe("Whether content is visible (bind to state for toggle)"),
      enter: z.enum(["fade-in", "slide-in-left", "slide-in-right", "slide-in-up", "slide-in-down", "scale-up"]).optional().describe('Enter animation preset (default: "fade-in")'),
      exit: z.enum(["fade-out", "slide-out-left", "slide-out-right", "slide-out-up", "slide-out-down", "scale-down"]).optional().describe('Exit animation preset (default: "fade-out")'),
      duration: z.number().optional().describe("Animation duration in ms (default: 500)"),
      style: styleZ,
    }),
  },

  // ── Media ────────────────────────────────────────────────
  Gradient: {
    category: "Layout",
    hasChildren: true,
    description: "Container with a CSS gradient background. Add child elements (Text, Image, etc.) to the children array to layer content on top of the gradient.",
    props: z.object({
      type: z.enum(["linear", "radial", "conic"]).optional().describe('Gradient type (default: "linear")'),
      colors: z.array(z.string()).optional().describe('Color stops (default: ["#58a6ff", "#3fb950"])'),
      stops: z.array(z.string()).optional().describe('Alias for colors — color stop values'),
      angle: z.number().optional().describe("Angle in degrees for linear gradient (default: 180)"),
      direction: z.string().optional().describe('CSS direction string e.g. "135deg", "to right" (overrides angle)'),
      style: styleZ,
    }),
  },

  Overlay: {
    category: "Media",
    description: "Absolutely positioned overlay container.",
    hasChildren: true,
    props: z.object({
      position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right", "center", "full"]).optional().describe('Position (default: "full")'),
      padding: z.union([z.number(), z.string()]).optional().describe("Padding"),
      style: styleZ,
    }),
  },

  // ── Data ────────────────────────────────────────────────
  Stat: {
    category: "Data",
    description: "Large statistic display with label.",
    props: z.object({
      value: z.union([z.string(), z.number()]).describe("Stat value"),
      label: z.string().describe("Stat label"),
      unit: z.string().optional().describe("Unit suffix"),
      trend: z.enum(["up", "down", "flat"]).optional().describe("Trend indicator"),
      style: styleZ,
    }),
  },

  ProgressBar: {
    category: "Data",
    description: "Horizontal progress bar.",
    props: z.object({
      value: z.number().min(0).max(100).describe("Progress 0-100"),
      label: z.string().optional().describe("Progress label"),
      color: z.string().optional().describe('Bar color (default: "#58a6ff")'),
      showValue: z.boolean().optional().describe("Show percentage (default: true)"),
      style: styleZ,
    }),
  },

  Sparkline: {
    category: "Data",
    description: "Tiny inline SVG chart.",
    props: z.object({
      values: z.array(z.number()).describe("Data points"),
      color: z.string().optional().describe('Line color (default: "#58a6ff")'),
      height: z.number().optional().describe("Height in px (default: 32)"),
      fill: z.boolean().optional().describe("Fill area under line (default: false)"),
      style: styleZ,
    }),
  },

  Chart: {
    category: "Data",
    description: "Declarative data visualization. Renders bar, line, area, pie, or donut charts from data arrays using inline SVG.",
    props: z.object({
      mark: z.enum(["bar", "line", "area", "pie", "donut"]).optional().describe('Chart type (default: "bar")'),
      data: z.array(z.record(z.unknown())).describe("Array of data objects"),
      xField: z.string().optional().describe('Field name for X axis / labels (default: "x")'),
      yField: z.string().optional().describe('Field name for Y axis / values (default: "y")'),
      color: z.string().optional().describe('Primary color (default: "#58a6ff")'),
      colors: z.array(z.string()).optional().describe("Color palette for multiple series/slices"),
      height: z.number().optional().describe("Chart height in px (default: 300)"),
      title: z.string().optional().describe("Chart title"),
      showLabels: z.boolean().optional().describe("Show axis labels (default: true)"),
      showLegend: z.boolean().optional().describe("Show legend (default: false, pie/donut only)"),
      style: styleZ,
    }),
  },

  Table: {
    category: "Data",
    description: "Structured data table with headers, rows, and optional styling.",
    props: z.object({
      columns: z.array(z.object({
        key: z.string().describe("Data field key"),
        label: z.string().optional().describe("Column header label (defaults to key)"),
        align: z.enum(["left", "center", "right"]).optional().describe('Text alignment (default: "left")'),
        width: z.string().optional().describe("Column width (CSS value)"),
      })).describe("Column definitions"),
      rows: z.array(z.record(z.unknown())).describe("Row data objects keyed by column key"),
      striped: z.boolean().optional().describe("Alternate row backgrounds (default: false)"),
      compact: z.boolean().optional().describe("Reduce cell padding (default: false)"),
      sortBy: z.string().optional().describe("Column key to show sort indicator on"),
      sortDir: z.enum(["asc", "desc"]).optional().describe('Sort direction indicator (default: "asc")'),
      title: z.string().optional().describe("Table title"),
      style: styleZ,
    }),
  },
}

import { defineCatalog } from "../../core/catalog"

// ── Build catalog using defineCatalog for full interface support ──
export const generalCatalog = defineCatalog(components)
