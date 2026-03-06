# Component Catalog Index

Use `catalogRead` with `detail: "full"` and `category` or `component` to see full schemas.

## Layout
- **Box** [container] -- General-purpose container. The fundamental building block.
- **Stack** [container] -- Vertical or horizontal stack with gap.
- **Grid** [container] -- CSS Grid layout.
- **Split** [container] -- Two-panel split layout. First child = primary, second = secondary.
- **Gradient** [container] -- Container with a CSS gradient background. Add child elements (Text, Image, etc.) to the children array to layer content on top of the gradient.

## Text
- **Heading** -- Display heading. For broadcast: level 1 should be 64–120px (hero), level 2 should be 36–56px (section). Use style.fontSize to override.
- **Text** -- Body text with variant styling. For broadcast: use 24–36px for readable body text on 1920×1080. Captions/labels: 16–24px.
- **Code** -- Code block with monospace font and dark background.

## Content
- **Card** [container] -- Contained card with optional header. Children render in the content area.
- **Image** -- Display an image from URL.
- **Divider** -- Horizontal or vertical divider line.

## Broadcast
- **LowerThird** -- Broadcast lower-third overlay with name and title.
- **Ticker** -- Scrolling horizontal text ticker.
- **Banner** -- Full-width announcement bar.
- **Badge** -- Small status tag/pill. For broadcast: use 14–20px font size with generous padding (8–16px horizontal) so it reads on screen.

## SVG
- **Shape** -- SVG shape primitive: rect, circle, ellipse, or polygon.
- **Line** -- SVG line between two points.
- **Path** -- SVG path from a path data string.
- **SvgContainer** [container] -- SVG wrapper element with viewBox. Children render inside the SVG.

## Animation
- **Transition** [container] -- Wrapper that applies CSS transitions to children on prop changes.
- **FadeIn** [container] -- Wrapper that fades children in on mount using CSS animation.
- **Counter** -- Animated number counter display. The value should be a hero element — use 72–120px font size to command attention on broadcast.
- **Animate** [container] -- Wrapper that applies enter/exit/loop animations to children. Valid presets: fade-in, slide-in-left, slide-in-right, slide-in-up, slide-in-down, scale-up, scale-down, bounce-in, pulse. Shorthand aliases (bounce, slide-up, slide-down, slide-left, slide-right, scale) also work.
- **Stagger** [container] -- Sequences animation of child elements with configurable delay between each child.
- **Presence** [container] -- Conditionally shows/hides content with enter/exit transitions. Bind visible to state to toggle.

## Media
- **Overlay** [container] -- Absolutely positioned overlay container.

## Data
- **Stat** -- Large statistic display with label.
- **ProgressBar** -- Horizontal progress bar.
- **Sparkline** -- Tiny inline SVG chart.
- **Chart** -- Declarative data visualization. Renders bar, line, area, pie, or donut charts from data arrays using inline SVG.
- **Table** -- Structured data table with headers, rows, and optional styling.

All components accept an optional `style` prop (CSS overrides).
Use `{ "$state": "/path" }` in any prop to bind to live state.