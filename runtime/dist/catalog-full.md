# Available Stream Components

## Design Principles — 1920×1080 Broadcast Canvas

**Canvas & Scale:**
The canvas is 1920×1080 (16:9 broadcast). Design for a large screen, not a phone.
- Hero headings: 64–120px (6–11% of viewport height). These should command the frame.
- Subheadings: 36–56px. Body text: 24–36px. Captions/badges: 16–24px.
- Never use font sizes below 16px — they are invisible on broadcast displays.

**Space Utilization:**
- Fill the frame. Use full-bleed backgrounds (Gradient/Image with width: 100%, height: 100%).
- Avoid maxWidth constraints that box content into a narrow column. The canvas is 1920px wide — use it.
- If content is centered, it should still span at least 60–80% of the frame width.
- Edge-to-edge layouts (Grid, Split) are preferred over centered stacks for multi-element scenes.

**Composition:**
- Think broadcast/keynote, not web page. Reference: Apple Keynote, ESPN graphics, Bloomberg terminals.
- Every element should feel intentional at scale. If it would not be visible from 10 feet away, make it bigger.
- Use padding (48–80px) instead of maxWidth for breathing room.

**Color:**
- Each scene should use ONE primary color family with at most 2 accent colors. Do not mix 4–5 different hues in one scene.
- Broadcast color: backgrounds are deep and saturated (not grey). Text is white or near-white. Accent colors are bold and limited. Think CNN red, Bloomberg blue, ESPN yellow — one dominant brand color per segment.
- Avoid web-UI grey palettes (#161b22, #0d1117, #30363d). These read as GitHub dark mode, not broadcast. Use rich darks: deep navy (#0a1628), broadcast black (#101820), or warm dark (#1a1412).
- When in doubt, fewer colors is better. A scene with one bold color and white text always looks more professional than a rainbow.

**Visual Sizing Rules:**
- Emoji as visual icons: When using emoji as a decorative/hero element (not inline text), set fontSize to at least 80px (standalone hero) or 48px (inside cards/badges). Emoji render at the font-size of their container.
- Minimum element size: No informational element should be smaller than 40px in its smallest dimension on the 1920x1080 canvas.
- Decorative opacity: Never go below 0.5 opacity — it becomes invisible noise on broadcast. Either commit (0.7+) or remove the element.

**Animation:**
- Use Animate/Stagger for entrance animations. Static scenes feel cheap.
- Keep durations 400–1000ms. Faster = snappy, slower = cinematic.

---

## Workflow — Broadcast Delivery

- After reading this catalog, call sceneSet for your first scene IMMEDIATELY. Do not plan everything upfront.
- Build scenes incrementally with scenePatch. Don't front-load all elements into sceneSet — establish the background and hero element, then patch in supporting elements (lower thirds, data, tickers) one at a time.
- Pacing: aim for a new visual element every 3-5 seconds. Think about what a narrator would say for each beat.
- Use sceneSet only for the first scene and major segment transitions. Use scenePatch for everything else.

**Broadcast aesthetic — NOT web design:**
- Full-bleed, edge-to-edge. Broadcast fills the frame aggressively. No centered cards with padding and border-radius.
- Use the entire 1920x1080 canvas. Content should span 80%+ of the frame width.
- No visible containers, no card borders, no box shadows. Content floats directly on rich backgrounds.
- This is motion graphics, not a website. Think CNN/ESPN/Apple Keynote, not a dashboard.

You can compose scenes using sceneSet and scenePatch MCP tools.
A scene is a flat map of elements, each referencing a component by type name.

## Spec Format
```
{
  "root": "element-key",
  "elements": {
    "element-key": {
      "type": "ComponentName",
      "props": { ... },
      "children": ["child-key-1", "child-key-2"],
      "slot": "main" | "sidebar" | "status" | "lower_third"
    }
  },
  "state": { ... }
}
```

## Components

### Box
General-purpose container. The fundamental building block.
Supports children.
Props:
- style (optional): CSS style overrides

### Stack
Vertical or horizontal stack with gap.
Supports children.
Props:
- direction (optional): Stack direction (default: "vertical")
- gap (optional): Gap in px (default: 8)
- align (optional): Cross-axis alignment
- justify (optional): Main-axis justification
- style (optional): CSS style overrides

### Grid
CSS Grid layout.
Supports children.
Props:
- columns (optional): Column count or grid-template-columns (default: 1)
- rows (optional): grid-template-rows
- gap (optional): Gap in px (default: 8)
- style (optional): CSS style overrides

### Split
Two-panel split layout. First child = primary, second = secondary.
Supports children.
Props:
- ratio (optional): Ratio as "primary/secondary" (default: "2/1")
- direction (optional): Split direction (default: "horizontal")
- gap (optional): Gap in px
- style (optional): CSS style overrides

### Heading
Display heading. For broadcast: level 1 should be 64–120px (hero), level 2 should be 36–56px (section). Use style.fontSize to override.
Props:
- text: Heading text
- level (optional): Heading level 1-6 (default: 2)
- style (optional): CSS style overrides

### Text
Body text with variant styling. For broadcast: use 24–36px for readable body text on 1920×1080. Captions/labels: 16–24px.
Props:
- text: Text content
- variant (optional): Text variant (default: "body")
- style (optional): CSS style overrides

### Code
Code block with monospace font and dark background.
Props:
- code: Code content
- language (optional): Language hint
- title (optional): Optional title header
- style (optional): CSS style overrides

### Card
Contained card with optional header. Children render in the content area.
Supports children.
Props:
- title (optional): Card title
- subtitle (optional): Card subtitle
- style (optional): CSS style overrides
- headerStyle (optional): Header style overrides

### Image
Display an image from URL.
Props:
- src: Image URL
- alt (optional): Alt text
- fit (optional): Object-fit (default: "cover")
- style (optional): CSS style overrides

### Divider
Horizontal or vertical divider line.
Props:
- direction (optional): Direction (default: "horizontal")
- style (optional): CSS style overrides

### LowerThird
Broadcast lower-third overlay with name and title.
Props:
- name: Primary name/label
- title (optional): Title line
- subtitle (optional): Subtitle line
- accentColor (optional): Accent color (default: "#58a6ff")
- style (optional): CSS style overrides

### Ticker
Scrolling horizontal text ticker.
Props:
- items: Ticker items
- speed (optional): Scroll speed in px/s (default: 60)
- style (optional): CSS style overrides

### Banner
Full-width announcement bar.
Props:
- text: Banner text
- severity (optional): Severity (default: "info")
- style (optional): CSS style overrides

### Badge
Small status tag/pill. For broadcast: use 14–20px font size with generous padding (8–16px horizontal) so it reads on screen.
Props:
- text: Badge text
- variant (optional): Variant (default: "default")
- style (optional): CSS style overrides

### Shape
SVG shape primitive: rect, circle, ellipse, or polygon.
Props:
- shape (optional): Shape type (default: "rect")
- width (optional): Width in px (default: 100)
- height (optional): Height in px (default: 100)
- fill (optional): Fill color (default: "none")
- stroke (optional): Stroke color (default: "#e6edf3")
- strokeWidth (optional): Stroke width (default: 1)
- points (optional): Points for polygon (e.g. "50,0 100,100 0,100")
- style (optional): CSS style overrides

### Line
SVG line between two points.
Props:
- x1 (optional): Start X (default: 0)
- y1 (optional): Start Y (default: 0)
- x2 (optional): End X (default: 100)
- y2 (optional): End Y (default: 0)
- stroke (optional): Stroke color (default: "#e6edf3")
- strokeWidth (optional): Stroke width (default: 1)
- strokeDasharray (optional): Dash pattern (e.g. "5,5")
- style (optional): CSS style overrides

### Path
SVG path from a path data string.
Props:
- d: SVG path data string
- fill (optional): Fill color (default: "none")
- stroke (optional): Stroke color (default: "#e6edf3")
- strokeWidth (optional): Stroke width (default: 1)
- style (optional): CSS style overrides

### SvgContainer
SVG wrapper element with viewBox. Children render inside the SVG.
Supports children.
Props:
- viewBox (optional): SVG viewBox (default: "0 0 100 100")
- width (optional): Width
- height (optional): Height
- style (optional): CSS style overrides

### Transition
Wrapper that applies CSS transitions to children on prop changes.
Supports children.
Props:
- property (optional): CSS property to transition (default: "all")
- duration (optional): Duration in ms (default: 300)
- easing (optional): Easing function (default: "ease")
- delay (optional): Delay in ms (default: 0)
- style (optional): CSS style overrides

### FadeIn
Wrapper that fades children in on mount using CSS animation.
Supports children.
Props:
- duration (optional): Duration in ms (default: 500)
- delay (optional): Delay in ms (default: 0)
- style (optional): CSS style overrides

### Counter
Animated number counter display. The value should be a hero element — use 72–120px font size to command attention on broadcast.
Props:
- value: Target number value
- prefix (optional): Text before the number
- suffix (optional): Text after the number
- duration (optional): Animation duration in ms
- style (optional): CSS style overrides

### Animate
Wrapper that applies enter/exit/loop animations to children. Valid presets: fade-in, slide-in-left, slide-in-right, slide-in-up, slide-in-down, scale-up, scale-down, bounce-in, pulse. Shorthand aliases (bounce, slide-up, slide-down, slide-left, slide-right, scale) also work.
Supports children.
Props:
- preset (optional): Animation preset (default: "fade-in")
- duration (optional): Duration in ms (default: 500)
- delay (optional): Delay in ms (default: 0)
- easing (optional): Easing function (default: "ease")
- loop (optional): Loop animation infinitely (default: false)
- style (optional): CSS style overrides

### Stagger
Sequences animation of child elements with configurable delay between each child.
Supports children.
Props:
- preset (optional): Animation preset applied to each child (default: "fade-in")
- interval (optional): Delay between each child in ms (default: 100)
- duration (optional): Duration per child in ms (default: 400)
- easing (optional): Easing function (default: "ease")
- style (optional): CSS style overrides

### Presence
Conditionally shows/hides content with enter/exit transitions. Bind visible to state to toggle.
Supports children.
Props:
- visible: Whether content is visible (bind to state for toggle)
- enter (optional): Enter animation preset (default: "fade-in")
- exit (optional): Exit animation preset (default: "fade-out")
- duration (optional): Animation duration in ms (default: 500)
- style (optional): CSS style overrides

### Gradient
Container with a CSS gradient background. Add child elements (Text, Image, etc.) to the children array to layer content on top of the gradient.
Supports children.
Props:
- type (optional): Gradient type (default: "linear")
- colors (optional): Color stops (default: ["#58a6ff", "#3fb950"])
- stops (optional): Alias for colors — color stop values
- angle (optional): Angle in degrees for linear gradient (default: 180)
- direction (optional): CSS direction string e.g. "135deg", "to right" (overrides angle)
- style (optional): CSS style overrides

### Overlay
Absolutely positioned overlay container.
Supports children.
Props:
- position (optional): Position (default: "full")
- padding (optional): Padding
- style (optional): CSS style overrides

### Stat
Large statistic display with label.
Props:
- value: Stat value
- label: Stat label
- unit (optional): Unit suffix
- trend (optional): Trend indicator
- style (optional): CSS style overrides

### ProgressBar
Horizontal progress bar.
Props:
- value: Progress 0-100
- label (optional): Progress label
- color (optional): Bar color (default: "#58a6ff")
- showValue (optional): Show percentage (default: true)
- style (optional): CSS style overrides

### Sparkline
Tiny inline SVG chart.
Props:
- values: Data points
- color (optional): Line color (default: "#58a6ff")
- height (optional): Height in px (default: 32)
- fill (optional): Fill area under line (default: false)
- style (optional): CSS style overrides

### Chart
Declarative data visualization. Renders bar, line, area, pie, or donut charts from data arrays using inline SVG.
Props:
- mark (optional): Chart type (default: "bar")
- data: Array of data objects
- xField (optional): Field name for X axis / labels (default: "x")
- yField (optional): Field name for Y axis / values (default: "y")
- color (optional): Primary color (default: "#58a6ff")
- colors (optional): Color palette for multiple series/slices
- height (optional): Chart height in px (default: 300)
- title (optional): Chart title
- showLabels (optional): Show axis labels (default: true)
- showLegend (optional): Show legend (default: false, pie/donut only)
- style (optional): CSS style overrides

### Table
Structured data table with headers, rows, and optional styling.
Props:
- columns: Column definitions
- rows: Row data objects keyed by column key
- striped (optional): Alternate row backgrounds (default: false)
- compact (optional): Reduce cell padding (default: false)
- sortBy (optional): Column key to show sort indicator on
- sortDir (optional): Sort direction indicator (default: "asc")
- title (optional): Table title
- style (optional): CSS style overrides

## State Expressions
Use { "$state": "/path/to/value" } in props to bind to live state.
Update state with stateSet tool using JSON Pointer paths.


# Available Stream Components

## Design Principles — 1920×1080 Broadcast Canvas

**Canvas & Scale:**
The canvas is 1920×1080 (16:9 broadcast). Design for a large screen, not a phone.
- Hero headings: 64–120px (6–11% of viewport height). These should command the frame.
- Subheadings: 36–56px. Body text: 24–36px. Captions/badges: 16–24px.
- Never use font sizes below 16px — they are invisible on broadcast displays.

**Space Utilization:**
- Fill the frame. Use full-bleed backgrounds (Gradient/Image with width: 100%, height: 100%).
- Avoid maxWidth constraints that box content into a narrow column. The canvas is 1920px wide — use it.
- If content is centered, it should still span at least 60–80% of the frame width.
- Edge-to-edge layouts (Grid, Split) are preferred over centered stacks for multi-element scenes.

**Composition:**
- Think broadcast/keynote, not web page. Reference: Apple Keynote, ESPN graphics, Bloomberg terminals.
- Every element should feel intentional at scale. If it would not be visible from 10 feet away, make it bigger.
- Use padding (48–80px) instead of maxWidth for breathing room.

**Color:**
- Each scene should use ONE primary color family with at most 2 accent colors. Do not mix 4–5 different hues in one scene.
- Broadcast color: backgrounds are deep and saturated (not grey). Text is white or near-white. Accent colors are bold and limited. Think CNN red, Bloomberg blue, ESPN yellow — one dominant brand color per segment.
- Avoid web-UI grey palettes (#161b22, #0d1117, #30363d). These read as GitHub dark mode, not broadcast. Use rich darks: deep navy (#0a1628), broadcast black (#101820), or warm dark (#1a1412).
- When in doubt, fewer colors is better. A scene with one bold color and white text always looks more professional than a rainbow.

**Visual Sizing Rules:**
- Emoji as visual icons: When using emoji as a decorative/hero element (not inline text), set fontSize to at least 80px (standalone hero) or 48px (inside cards/badges). Emoji render at the font-size of their container.
- Minimum element size: No informational element should be smaller than 40px in its smallest dimension on the 1920x1080 canvas.
- Decorative opacity: Never go below 0.5 opacity — it becomes invisible noise on broadcast. Either commit (0.7+) or remove the element.

**Animation:**
- Use Animate/Stagger for entrance animations. Static scenes feel cheap.
- Keep durations 400–1000ms. Faster = snappy, slower = cinematic.

---

## Workflow — Broadcast Delivery

- After reading this catalog, call sceneSet for your first scene IMMEDIATELY. Do not plan everything upfront.
- Build scenes incrementally with scenePatch. Don't front-load all elements into sceneSet — establish the background and hero element, then patch in supporting elements (lower thirds, data, tickers) one at a time.
- Pacing: aim for a new visual element every 3-5 seconds. Think about what a narrator would say for each beat.
- Use sceneSet only for the first scene and major segment transitions. Use scenePatch for everything else.

**Broadcast aesthetic — NOT web design:**
- Full-bleed, edge-to-edge. Broadcast fills the frame aggressively. No centered cards with padding and border-radius.
- Use the entire 1920x1080 canvas. Content should span 80%+ of the frame width.
- No visible containers, no card borders, no box shadows. Content floats directly on rich backgrounds.
- This is motion graphics, not a website. Think CNN/ESPN/Apple Keynote, not a dashboard.

You can compose scenes using sceneSet and scenePatch MCP tools.
A scene is a flat map of elements, each referencing a component by type name.

## Spec Format
```
{
  "root": "element-key",
  "elements": {
    "element-key": {
      "type": "ComponentName",
      "props": { ... },
      "children": ["child-key-1", "child-key-2"],
      "slot": "main" | "sidebar" | "status" | "lower_third"
    }
  },
  "state": { ... }
}
```

## Components

### StatusBar
Top bar showing current activity and session statistics.
Props:
- title: What the agent is currently doing
- detail (optional): Additional context
- stats (optional): Session statistics

### CodeView
Syntax-highlighted code display with file path header and line numbers.
Props:
- path: File path being displayed
- code: The code content
- language (optional): Language for syntax hints (ts, py, rs, etc.)
- highlights (optional): Line numbers to highlight

### DiffView
Side-by-side or inline diff showing old and new text with red/green highlighting.
Props:
- path: File path being diffed
- oldText: Original text
- newText: New text
- language (optional): Language for syntax hints

### TerminalView
Terminal output display showing a command and its results.
Props:
- command: The command that was run
- output: Command output
- exitCode (optional): Exit code (0 = success)

### EventTimeline
Scrolling timeline of session events. Reads events from state at "/events". Each event: { type, summary, detail?, timestamp }.
Props:
- maxVisible (optional): Max events to show (default 50)

### ProgressPanel
Task checklist with status indicators.
Props:
- tasks: 

## State Expressions
Use { "$state": "/path/to/value" } in props to bind to live state.
Update state with stateSet tool using JSON Pointer paths.
