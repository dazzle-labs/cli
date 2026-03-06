# Frontend Research: AI Agent-Driven Visual Presentation

**Date**: 2026-03-04
**Purpose**: Audit and improve the Stream component catalog -- a system where AI agents build visual presentations via MCP tools using a flat JSON spec format.

---

## Table of Contents

1. [Agent-Driven Frontend/UI Generation](#1-agent-driven-frontendui-generation)
2. [Motion Graphics & Animation for the Web](#2-motion-graphics--animation-for-the-web)
3. [Real-Time Data Visualization](#3-real-time-data-visualization)
4. [Broadcast/Streaming Visual Design](#4-broadcaststreaming-visual-design)
5. [Design Token Systems](#5-design-token-systems)
6. [SVG & Generative Art](#6-svg--generative-art)
7. [Component Catalog Design](#7-component-catalog-design)
8. [Gap Analysis: Current Catalog vs. State of the Art](#8-gap-analysis-current-catalog-vs-state-of-the-art)
9. [Prioritized Recommendations](#9-prioritized-recommendations)

---

## 1. Agent-Driven Frontend/UI Generation

### Landscape (2025-2026)

The AI frontend generation space has consolidated around a few dominant patterns:

**Major tools:**
- [v0.dev](https://v0.app/) (Vercel) -- generates React/Tailwind/shadcn/ui code from natural language
- Claude Artifacts -- generates self-contained HTML/CSS/JS/React in a sandbox
- [Bolt.new](https://bolt.new) -- full-stack app generation using WebContainers
- [Lovable](https://lovable.dev) -- production-ready React/TypeScript/Tailwind apps
- Replit Agent -- full-stack with built-in databases
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) -- official MCP extension for agent-rendered UIs in chat

**Google's A2UI Protocol** (v0.9, December 2025) is the most directly relevant development. It is a JSON-based streaming UI protocol where agents generate flat component lists with ID references -- architecturally identical to Stream's spec format. Key design decisions from A2UI that validate Stream's approach:

- [A2UI Specification](https://a2ui.org/specification/v0.9-a2ui/)
- [What is A2UI](https://a2ui.org/introduction/what-is-a2ui/)

### High-Level Semantic vs. Low-Level Primitives

This is the central design tension for agent-driven UIs. Research and practice converge on a clear answer:

**Agents produce better results with high-level semantic components**, but need escape hatches to low-level primitives.

Evidence:
- v0.dev is trained specifically on shadcn/ui default implementations and struggles with customizations. It works best with semantic patterns: `Card`, `DataTable`, `Sidebar`, not raw `div` + `flexbox`.
- A2UI uses a typed catalog of semantic components (`Card`, `Row`, `Column`, `TextField`) with ID references rather than arbitrary nesting.
- Remotion's AI system uses "Skills" -- modular knowledge units for specific domains (charts, typography, transitions) rather than raw CSS/React primitives.
- Research on [LLM UI generation](https://arxiv.org/html/2412.20071v3) shows a divide-and-conquer approach where natural language maps to a DSL of component-level specifications produces the best results.

**Recommendation for Stream**: The current catalog strikes a reasonable balance. `Card`, `LowerThird`, `Stat` are the right level of semantic abstraction. `Box`, `Stack`, `Grid` provide necessary primitive escape hatches. But there are key semantic components missing (see Section 8).

### Flat List Architecture

A2UI explicitly chose flat component lists over nested trees because:

> "Requiring an LLM to generate a perfectly nested JSON tree in a single pass is difficult and error-prone. A flat list of components where relationships are defined by simple string IDs is much easier to generate piece by piece."

Stream already uses this pattern. The A2UI specification validates that this is the correct architectural choice for agent-driven UIs.

**A2UI component structure** (for comparison with Stream's):
```json
{
  "id": "greeting",
  "component": "Text",
  "text": "Hello"
}
```

**Stream component structure:**
```json
{
  "greeting": {
    "type": "Text",
    "props": { "text": "Hello" }
  }
}
```

Both use flat maps with string IDs. Stream's `props` bag is slightly more explicit. A2UI flattens props into the component object directly. Either approach works well for LLMs.

### Data Binding Patterns

A2UI uses JSON Pointer paths for data binding: `{"path": "/data/users/0/name"}`. Stream uses `{"$state": "/path"}`. Both approaches are equivalent and well-suited to LLM generation. Stream's `$state` prefix makes bindings visually distinct, which is arguably better for agents to reason about.

---

## 2. Motion Graphics & Animation for the Web

### Remotion: Programmatic Video with React

[Remotion](https://www.remotion.dev/) is the most mature framework for programmatic motion graphics. Its AI integration patterns are directly relevant:

- [Prompt to Motion Graphics template](https://www.remotion.dev/templates/prompt-to-motion-graphics)
- [Generate Remotion code using LLMs](https://www.remotion.dev/docs/ai/generate)
- [Remotion System Prompt](https://www.remotion.dev/docs/ai/system-prompt)
- [Prompting videos with Claude Code](https://www.remotion.dev/docs/ai/claude-code)

**Key Remotion patterns for agent-driven motion graphics:**

1. **Constants-first design**: Text, colors, and timing declared as editable constants at the top of files
2. **Spring physics for natural motion**: `spring({ fps, frame, config: { damping: 200 } })`
3. **Interpolation**: `interpolate(frame, [0, 30], [0, 1], { extrapolateRight: 'clamp' })`
4. **Sequencing**: `<Sequence from={30} durationInFrames={60}>` for timeline-based composition
5. **Skills architecture**: Modular knowledge units injected based on user request, preventing "context rot" from expanding prompts

**Remotion animation primitives that matter:**
- Frame-based timing via `useCurrentFrame()`
- Spring physics via `spring()`
- Value interpolation via `interpolate()`
- Absolute positioning via `<AbsoluteFill>`
- Sequential composition via `<Series>` and `<TransitionSeries>`

### Motion (formerly Framer Motion)

[Motion](https://motion.dev) is the dominant React animation library. Key developments:

- v11 released in 2025 with improved layout animations and performance
- ~32KB gzipped (vs Motion One at ~6KB with React bindings)
- [Motion Primitives](https://motion-primitives.com/) -- open-source animated component kit built on Motion

**Motion Primitives components relevant to Stream:**
- `TextEffect` -- per-character/word/line animation with presets: `blur-sm`, `fade-in-blur`, `scale`, `fade`, `slide`
- `TextMorph` -- morphs shared letters between words
- `AnimatedNumber` -- rolling digit transitions
- [NumberFlow](https://number-flow.barvian.me/) -- dependency-free animated number component

**Animation API patterns that work for declarative agent-driven systems:**
```typescript
// Motion's declarative approach
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: "spring", damping: 20 }}
/>

// Stagger children
<motion.div transition={{ staggerChildren: 0.1 }}>
  {children}
</motion.div>
```

### CSS Animation (Native Platform)

The web platform now has powerful native animation capabilities:

- **Entry/exit animations** (Chrome 116+): `display` and `content-visibility` in keyframes
- **`@starting-style`** (Chrome 117+): animate from `display: none`
- **Scroll-driven animations**: `animation-timeline: scroll()` and `view()` -- Chrome stable, Firefox behind flag, Safari not yet
- **View Transitions API**: cross-document transitions between pages
- **`animation-composition: add`**: layer multiple animations on the same property

**Keyframe Tokens** ([Smashing Magazine, 2025](https://www.smashingmagazine.com/2025/11/keyframes-tokens-standardizing-animation-across-projects/)): A standardized approach to reusable animation definitions:

```css
@keyframes kf-slide-in {
  from { translate: var(--kf-slide-from, -100% 0); }
  to { translate: 0 0; }
}

@keyframes kf-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

These are parameterized via CSS custom properties, enabling agents to use a fixed set of animation tokens with runtime customization.

### GSAP

[GSAP](https://gsap.com/) remains the industry standard for complex sequenced animations. Key patterns:

- **Timeline**: Container for sequenced tweens with labels and stagger
- **ScrollTrigger**: Bind animations to scroll position
- **MotionPath**: Animate along SVG paths

GSAP's timeline abstraction is the gold standard for animation sequencing, but its imperative API is harder for agents to drive than declarative approaches.

### Recommendation for Stream

Stream's current animation components (`Transition`, `FadeIn`, `Counter`) are minimal. The biggest gaps are:

1. **No animation sequencing/staggering** -- children animate independently, no choreography
2. **No spring physics** -- only CSS easing functions
3. **No text animation** -- no per-character/word reveals
4. **No exit animations** -- elements appear but have no animated removal
5. **No keyframe animations** -- only transitions and fade-in

---

## 3. Real-Time Data Visualization

### Declarative Chart Specifications

Three declarative chart systems are relevant for agent-driven visualization:

**[Vega-Lite](https://vega.github.io/vega-lite/)** -- the most agent-friendly option:
- Pure JSON specification: agents generate a JSON object describing the chart
- Automatic axes, legends, scales from data
- Supports bar, line, area, point, tick, rect, arc, and composite views
- Grammar of graphics: composable marks + encodings

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": { "values": [{"x": "A", "y": 28}, {"x": "B", "y": 55}] },
  "mark": "bar",
  "encoding": {
    "x": {"field": "x", "type": "nominal"},
    "y": {"field": "y", "type": "quantitative"}
  }
}
```

**[Observable Plot](https://observablehq.com/plot/)** -- concise JavaScript API:
- Mark-based: `Plot.barY(data, {x: "name", y: "value"})`
- Very concise -- one line can replace 50 lines of D3
- Mark types: dot, bar, rect, cell, text, tick, rule, line, area, arrow
- Not JSON-native but could be wrapped in a JSON schema

**[shadcn/ui Charts](https://ui.shadcn.com/charts/area)** (Recharts-based):
- Production dashboard patterns extracted from real apps
- Composition-based: `AreaChart`, `BarChart`, `LineChart`, `PieChart`
- Integrated with shadcn theming (dark mode automatic)
- TypeScript types for all chart configs

### Dashboard Design Patterns

From [Grafana's panel types](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/):
- **Time series** (default) -- line/area over time
- **Stat** -- single large number with optional sparkline
- **Gauge** -- radial or bar gauge
- **Bar chart** -- categorical comparisons
- **Table** -- tabular data with sorting/filtering
- **Heatmap** -- 2D density
- **State timeline** -- state changes over time
- **Logs** -- log output display

### Recommendation for Stream

The current catalog has `Sparkline`, `Stat`, `ProgressBar` -- good starts but insufficient for real data visualization. The highest-impact additions would be:

1. **Chart** -- a Vega-Lite-style declarative chart component that accepts a JSON spec
2. **Table** -- data table with columns, rows, optional sorting
3. **BarChart** -- simple bar chart from array data
4. **LineChart** -- time series / line chart from array data
5. **Gauge** -- radial or linear gauge for single-value metrics
6. **Timeline** -- horizontal timeline of events/states

---

## 4. Broadcast/Streaming Visual Design

### Standard Broadcast Graphics Components

Professional broadcast packages (After Effects templates, Vizrt, NewBlue Captivate, H2R Graphics) use a consistent vocabulary of component types:

| Component | Description | Stream Has? |
|-----------|-------------|-------------|
| Lower Third | Name/title overlay at bottom | Yes |
| Ticker/Crawl | Scrolling text bar | Yes |
| Bug | Small persistent logo/icon in corner | No |
| Scoreboard | Sports score display | No |
| Full-screen Graphic | Title card, transition slate | Partial (Overlay) |
| Stinger/Transition | Full-screen animated wipe | No |
| Banner/Strap | Full-width announcement | Yes |
| Clock/Timer | Live time or countdown | No |
| Social Media Card | Tweet/post display | No |
| Picture-in-Picture | Video within video frame | No |
| Split Screen | Multiple video feeds side-by-side | Yes (Split) |
| Sponsor Bug | Small sponsor logo placement | No |
| Poll/Results | Live poll visualization | No |

**Key insight from broadcast**: These components always animate in and out. A LowerThird does not just appear -- it slides/wipes in with a defined enter animation and exits with a matching reverse animation. This is the biggest gap in Stream's broadcast components.

### OBS/Web Overlay Patterns

Modern broadcast overlay tools like [VinciFlow](https://obsproject.com/forum/resources/vinciflow-stream-graphics-controller.2275/) and [H2R Graphics](https://h2r.graphics/) use:
- Browser source overlays (HTML/CSS/JS rendered in OBS)
- BroadcastChannel API for control panel communication
- JSON-driven template systems where content is data, not code
- Hotkey-triggered show/hide with enter/exit animations

### Animation Patterns for Broadcast

Professional lower thirds typically use multi-stage animations:

```
Stage 1 (0-300ms): Accent bar slides in from left
Stage 2 (100-500ms): Background panel wipes in
Stage 3 (300-700ms): Text fades in / slides in
```

Exit animation is the reverse. This requires **sequenced, timed animation** which Stream currently cannot express.

### Recommendation for Stream

Add broadcast-specific components:
1. **Bug** -- corner-positioned persistent element (logo, watermark)
2. **Scoreboard** -- configurable sports score display
3. **Clock** -- live clock or countdown timer
4. **PollResult** -- live poll with animated bars
5. **SocialCard** -- formatted social media post display

More critically, add **enter/exit animation support** to all broadcast components. Every broadcast element needs `show`/`hide` state with animated transitions.

---

## 5. Design Token Systems

### Current State of the Art

**[Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4)** (released January 2025):
- CSS-first configuration via `@theme` directive
- All design tokens exposed as native CSS variables
- No JavaScript config file needed
- [OKLCH colors](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) for perceptually uniform scales

```css
@theme {
  --color-primary-50: oklch(0.97 0.01 240);
  --color-primary-500: oklch(0.55 0.15 240);
  --color-primary-900: oklch(0.20 0.05 240);
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --font-sans: 'Geist Sans', system-ui, sans-serif;
  --font-mono: 'Geist Mono', monospace;
}
```

**[shadcn/ui](https://ui.shadcn.com/) + Radix**:
- CSS variables for semantic color tokens: `--primary`, `--background`, `--foreground`
- Components describe purpose, not appearance: any component automatically matches theme
- [Radix](https://www.radix-ui.com/) handles accessibility/behavior, Tailwind handles styling

### Color Systems for Agent-Generated Content

**OKLCH is the recommended color space** for agent-driven systems because:
- Perceptually uniform: adjusting lightness maintains consistent perceived brightness across hues
- Predictable contrast: palettes built in OKLCH have reliable WCAG compliance
- Formula-driven: agents can generate entire palettes from a few parameters (hue, base lightness, chroma)
- 93%+ browser adoption as of 2025

**Practical approach for agent-friendly color:**
- Provide named semantic tokens: `accent`, `surface`, `text`, `muted`, `success`, `warning`, `error`
- Each token has light/dark variants auto-derived from OKLCH formula
- Agent picks from tokens rather than raw hex values
- Override escape hatch: `accentColor` prop on individual components

### Typography

Best practices for agent-generated text:
- **System font stack** for reliability: `system-ui, -apple-system, sans-serif`
- **Modular scale** for sizes: use a ratio (1.25 or 1.333) to generate size steps
- **Tabular numbers** (`font-variant-numeric: tabular-nums`) for any data display
- **Limited font weights**: 400 (regular), 500 (medium), 700 (bold) -- agents produce better output with fewer choices

### Spacing

An 8px base grid with named scale:
```
xs: 4px, sm: 8px, md: 16px, lg: 24px, xl: 32px, 2xl: 48px, 3xl: 64px
```

### Recommendation for Stream

Stream currently uses inline styles with hardcoded colors (`#e6edf3`, `#58a6ff`, `#0d1117`). This works but:

1. **Add a theme system** with CSS variables for semantic tokens
2. **Expose named color tokens** in the catalog prompt so agents pick from a curated palette
3. **Add a `theme` prop to the root** or expose theme via `stateSet` for dynamic theming
4. **Document the spacing scale** in the catalog so agents use consistent spacing

---

## 6. SVG & Generative Art

### SVG Primitives That Matter

Stream already has `Shape`, `Line`, `Path`, `SvgContainer` -- a solid foundation. Key additions from the generative art space:

**SVG Filters** ([feTurbulence](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feTurbulence), [feGaussianBlur](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/)):
- `feTurbulence` generates Perlin noise textures -- clouds, marble, organic patterns
- `feGaussianBlur` for depth-of-field and glow effects
- Can be animated via `<animate>` targeting `baseFrequency`
- Composable via `feComposite`, `feBlend`, `feColorMatrix`

**SVG Text**:
- `<text>` with `textPath` for text along curves
- Essential for generative typography, labels on charts, creative text layout

**SVG Gradient definitions**:
- `<linearGradient>`, `<radialGradient>` defined in `<defs>`
- Referenced by ID in fill/stroke
- Mesh gradients via layered `feTurbulence` + blur

### Creative Coding Patterns

From [p5.js](https://p5js.org/) and creative coding practice:

- **Noise functions** (Perlin, Simplex): organic, natural-feeling variation
- **Particle systems**: collections of points with velocity, lifetime, behavior
- **L-systems**: recursive growth patterns (trees, fractals)
- **Grid distortion**: regular grid with noise-based displacement
- **Color cycling**: hue rotation over time

### Generative Background Patterns

Tools like [fffuel](https://www.fffuel.co/) demonstrate agent-friendly SVG generators:
- Noise textures via `feTurbulence` (`nnnoise`)
- Fluid mesh gradients via `feTurbulence` + `feGaussianBlur` + `feBlend` (`ffflux`)
- Grainy gradients via noise overlay on color blends (`gggrain`)
- Wavy mesh patterns via distortion maps (`uuunion`)

These are all expressible as SVG filter chains and could be parameterized for agent use.

### Recommendation for Stream

1. **SvgText** -- text element within SVG containers
2. **SvgGradient** -- gradient definition (linear/radial) for use in fills
3. **NoiseBackground** -- parameterized generative noise/texture background using SVG filters
4. **Pattern** -- repeating SVG pattern (dots, lines, grid, waves)
5. **Group** -- `<g>` element for transforms on groups of SVG children

---

## 7. Component Catalog Design

### What Makes a Catalog Agent-Friendly

Based on A2UI, Remotion, v0, and Stream's own design:

**1. Flat, typed component list with string IDs (Stream already does this)**

**2. Semantic naming**: Component names should describe their visual purpose. `LowerThird` is better than `BottomBar`. `Stat` is better than `BigNumber`.

**3. Constrained choice sets**: Enums over open strings wherever possible. `variant: "success" | "warning" | "error"` is easier for agents than `color: string`. The agent needs to make fewer decisions with constrained choices.

**4. Sensible defaults**: Every optional prop should have a documented, visually acceptable default. An agent should be able to use `{ type: "Card" }` with zero props and get something reasonable.

**5. Self-describing schema**: Stream's `defineCatalog` with Zod schemas and `.describe()` annotations is excellent. The auto-generated prompt gives agents everything they need.

**6. Layered detail**: Stream's `index()` / `categoryDetail()` / `componentDetail()` approach lets agents start broad and drill down. This matches how v0 and Remotion structure prompts -- compact index up front, full detail on demand.

**7. Validation with auto-fix**: Stream's `validate()` with `autoFix` is a strong pattern. A2UI does not have this. It means agents get corrective feedback rather than silent failures.

### Schema Structure Patterns

**A2UI schema organization** (good model to follow):
- `common_types.json` -- reusable primitives (Dynamic values, ChildList, ComponentId)
- `basic_catalog.json` -- component definitions with typed props
- `server_to_client.json` -- message envelope format

**Remotion's Skills** approach:
- Base system prompt teaches framework mechanics
- Modular "skills" are injected for specific domains (charts, typography, transitions)
- Skills include complete working examples
- A classifier selects which skills to inject based on user request

This skills approach could translate to Stream: rather than one massive catalog prompt, provide a compact index and let the agent request category details on demand (which Stream already supports via `categoryDetail()`).

### Abstraction Level Guidelines

From cross-referencing v0, A2UI, Remotion, and academic research:

| Level | Example | Agent Quality | Customization |
|-------|---------|--------------|---------------|
| Too low | `Box` with inline CSS | Poor -- agents produce ugly, inconsistent output | Total |
| Right level | `LowerThird`, `Stat`, `Card`, `Chart` | Good -- constrained to good-looking output | Moderate via props |
| Too high | `NewsDashboard`, `SportsBroadcast` | Great for exact use case, useless otherwise | None |

**The sweet spot** is components that are:
- Visually opinionated (good defaults for colors, spacing, typography)
- Semantically specific (one clear purpose)
- Customizable via typed props (not arbitrary CSS)
- Composable (can be children of layout components)

### State Binding Design

Stream's `{ "$state": "/path" }` pattern is simple and effective. A2UI's equivalent uses `{ "path": "/data/value" }`. Both are good for agents because:

- JSON Pointer paths are simple for LLMs to generate
- Binding is explicit and visible in the spec
- State updates are separate from spec changes (Stream's `stateSet` tool)

---

## 8. Gap Analysis: Current Catalog vs. State of the Art

### What Stream Has (35 components)

**Layout (4):** Box, Stack, Grid, Split
**Text (3):** Heading, Text, Code
**Content (3):** Card, Image, Divider
**Broadcast (4):** LowerThird, Ticker, Banner, Badge
**SVG (4):** Shape, Line, Path, SvgContainer
**Animation (3):** Transition, FadeIn, Counter
**Media (2):** Gradient, Overlay
**Data (3):** Stat, ProgressBar, Sparkline
**Coding (6):** TerminalView, DiffView, ProgressPanel, StatusBar, EventTimeline, CodeView

### Critical Gaps

**Animation & Motion:**
- No enter/exit animation system (components appear/disappear instantly)
- No stagger/sequence animation (children can't animate in sequence)
- No spring physics (only CSS easing)
- No text animation (no per-character/word reveals)
- No keyframe animation presets (slide-in, scale-up, bounce, etc.)

**Data Visualization:**
- No proper chart component (bar, line, area, pie)
- No table/data grid
- No gauge/meter
- No horizontal timeline of events

**Broadcast:**
- No enter/exit show/hide state for broadcast elements
- No bug (corner watermark)
- No scoreboard
- No clock/countdown timer
- No social media card display
- No poll/results display
- No picture-in-picture frame

**Interaction & State:**
- No conditional rendering (show/hide based on state)
- No list/repeat component (render N items from state array)
- No timer/interval for auto-updating state

**Typography & Text:**
- No rich text / markdown rendering
- No text truncation/overflow handling
- No animated text effects

**Layout:**
- No absolute/relative positioning component (beyond Overlay)
- No responsive breakpoints
- No aspect ratio container
- No scrollable container

---

## 9. Prioritized Recommendations

### Tier 1: Highest Impact (add these first)

These fill the most critical gaps and enable the most new use cases:

#### 1. Animation Presets System (replaces FadeIn, enhances all components)
Add an `animate` prop to all components or a wrapper `Animate` component:

```json
{
  "type": "Animate",
  "props": {
    "preset": "slide-in-left",
    "duration": 500,
    "delay": 0,
    "easing": "spring"
  },
  "children": ["content"]
}
```

Presets: `fade-in`, `slide-in-left`, `slide-in-right`, `slide-in-up`, `slide-in-down`, `scale-up`, `scale-down`, `blur-in`

Implemented via CSS keyframe tokens with custom properties, not JavaScript animation libraries.

#### 2. Stagger Component (animation sequencing)
Enables children to animate in sequence:

```json
{
  "type": "Stagger",
  "props": {
    "preset": "fade-in",
    "interval": 100,
    "duration": 400
  },
  "children": ["item-1", "item-2", "item-3"]
}
```

This is the single most impactful component for presentations. Every list, grid, and data display looks dramatically better with staggered entrance animation.

#### 3. Chart Component (declarative data visualization)
A Vega-Lite-inspired chart that takes a JSON spec:

```json
{
  "type": "Chart",
  "props": {
    "mark": "bar",
    "data": [{"x": "A", "y": 28}, {"x": "B", "y": 55}],
    "xField": "x",
    "yField": "y",
    "color": "#58a6ff"
  }
}
```

Support mark types: `bar`, `line`, `area`, `point`, `pie`, `donut`. Implement with inline SVG (no external dependencies). Data can be bound via `$state` for live updates.

#### 4. Table Component
Simple data table for structured data display:

```json
{
  "type": "Table",
  "props": {
    "columns": [
      { "key": "name", "label": "Name" },
      { "key": "value", "label": "Value", "align": "right" }
    ],
    "rows": [
      { "name": "Users", "value": "1,234" },
      { "name": "Revenue", "value": "$45.6K" }
    ],
    "striped": true
  }
}
```

#### 5. Show/Hide with Enter/Exit Animations
A mechanism for controlling visibility with animation:

```json
{
  "type": "Presence",
  "props": {
    "visible": { "$state": "/show-lower-third" },
    "enter": "slide-in-left",
    "exit": "slide-out-left",
    "duration": 500
  },
  "children": ["lower-third"]
}
```

This is essential for broadcast use cases where elements need to animate in and out.

### Tier 2: High Impact

#### 6. TextReveal Component
Animated text display with per-character/word effects:

```json
{
  "type": "TextReveal",
  "props": {
    "text": "Breaking News: Market Reaches All-Time High",
    "per": "word",
    "preset": "fade-in-blur",
    "speed": 1.5
  }
}
```

Based on [Motion Primitives TextEffect](https://motion-primitives.com/docs/text-effect) patterns.

#### 7. AnimatedCounter Component (upgrade existing Counter)
Upgrade Counter with rolling digit animation:

```json
{
  "type": "AnimatedCounter",
  "props": {
    "value": { "$state": "/users/count" },
    "prefix": "$",
    "format": "compact",
    "duration": 800
  }
}
```

Based on [NumberFlow](https://number-flow.barvian.me/) patterns.

#### 8. Clock Component
Live clock or countdown timer:

```json
{
  "type": "Clock",
  "props": {
    "mode": "countdown",
    "target": "2026-03-04T20:00:00Z",
    "format": "HH:mm:ss",
    "onComplete": "show"
  }
}
```

Modes: `live` (current time), `countdown` (to target), `stopwatch` (elapsed from start).

#### 9. List/Repeat Component
Render children for each item in a state array:

```json
{
  "type": "List",
  "props": {
    "items": { "$state": "/events" },
    "template": "event-card",
    "gap": 8,
    "direction": "vertical"
  }
}
```

A2UI has this as `ChildList` with template references. Essential for dynamic data-driven displays.

#### 10. Gauge Component
Radial or linear gauge for single-value metrics:

```json
{
  "type": "Gauge",
  "props": {
    "value": 73,
    "max": 100,
    "label": "CPU Usage",
    "variant": "radial",
    "color": "#3fb950"
  }
}
```

### Tier 3: Valuable Additions

#### 11. Bug Component (corner watermark)
```json
{
  "type": "Bug",
  "props": {
    "position": "top-right",
    "content": "LIVE",
    "pulse": true,
    "style": { "color": "#f85149" }
  }
}
```

#### 12. Scoreboard Component
```json
{
  "type": "Scoreboard",
  "props": {
    "home": { "name": "Team A", "score": 3 },
    "away": { "name": "Team B", "score": 1 },
    "clock": "72:30",
    "sport": "soccer"
  }
}
```

#### 13. SocialCard Component
```json
{
  "type": "SocialCard",
  "props": {
    "platform": "twitter",
    "author": "John Doe",
    "handle": "@johndoe",
    "text": "This is amazing!",
    "avatar": "https://...",
    "timestamp": "2m ago"
  }
}
```

#### 14. PollResult Component
```json
{
  "type": "PollResult",
  "props": {
    "question": "Favorite language?",
    "options": [
      { "label": "TypeScript", "value": 65, "color": "#3178c6" },
      { "label": "Python", "value": 45, "color": "#3572A5" },
      { "label": "Rust", "value": 30, "color": "#dea584" }
    ],
    "showPercentage": true,
    "animated": true
  }
}
```

#### 15. Markdown Component
Render markdown text with proper styling:

```json
{
  "type": "Markdown",
  "props": {
    "content": "## Hello\n\nThis is **bold** and *italic*."
  }
}
```

#### 16. NoiseBackground Component
Generative SVG noise texture background:

```json
{
  "type": "NoiseBackground",
  "props": {
    "type": "turbulence",
    "baseFrequency": 0.02,
    "octaves": 3,
    "seed": 42,
    "color": "#58a6ff",
    "opacity": 0.15
  }
}
```

#### 17. AspectRatio Container
```json
{
  "type": "AspectRatio",
  "props": {
    "ratio": "16/9"
  },
  "children": ["content"]
}
```

#### 18. Icon Component
Use Lucide icon names for inline SVG icons:

```json
{
  "type": "Icon",
  "props": {
    "name": "trending-up",
    "size": 24,
    "color": "#3fb950"
  }
}
```

[Lucide](https://lucide.dev/) is the dominant icon set in AI-generated UIs (1000+ icons, stroke-based, MIT license).

### Tier 4: Future Considerations

- **3D Scene** -- React Three Fiber declarative scene graph (complex but powerful)
- **Map** -- geographic data visualization
- **Video** -- embedded video player with controls
- **Audio** -- audio player/visualizer
- **Canvas** -- raw canvas drawing surface
- **Conditional** -- show/hide children based on state expression
- **QRCode** -- QR code generator from text/URL

---

## Architecture Recommendations

### 1. Universal Animation Props

Rather than separate animation wrapper components, consider adding optional animation props to all components:

```typescript
interface AnimationProps {
  enter?: AnimationPreset    // fade-in, slide-in-left, scale-up, etc.
  exit?: AnimationPreset     // fade-out, slide-out-left, scale-down, etc.
  duration?: number          // ms
  delay?: number            // ms
  easing?: "ease" | "spring" | "linear" | "ease-in" | "ease-out"
}
```

This is implemented via CSS keyframe tokens and `@starting-style` for enter animations, with `display: none` transitions for exit animations.

### 2. Theme System

Add a theme layer using CSS custom properties:

```json
{
  "state": {
    "theme": {
      "accent": "#58a6ff",
      "surface": "#0d1117",
      "surfaceRaised": "#161b22",
      "text": "#e6edf3",
      "textMuted": "#8b949e",
      "border": "#30363d",
      "success": "#3fb950",
      "warning": "#d29922",
      "error": "#f85149"
    }
  }
}
```

Components reference these via `var(--stream-accent)` etc., and agents can customize the entire look by updating theme state.

### 3. Animation Keyframe Token Library

Pre-define a library of CSS keyframe animations that agents reference by name:

```
Entrances: fade-in, slide-in-{left,right,up,down}, scale-up, blur-in, bounce-in
Exits: fade-out, slide-out-{left,right,up,down}, scale-down, blur-out
Attention: pulse, bounce, shake, flash
Continuous: spin, float, breathe
```

Each token is parameterized via CSS custom properties for direction, distance, and intensity.

### 4. Presence/Visibility System

Add a global mechanism for show/hide with animation:

```json
// Set visibility via state
{ "path": "/visible/lower-third", "value": true }
{ "path": "/visible/lower-third", "value": false }
```

Components with a `visible` prop bound to state animate in/out using their enter/exit presets.

---

## Sources

### Agent-Driven UI
- [v0.dev - AI App Builder](https://v0.app/)
- [A2UI Protocol v0.9 Specification](https://a2ui.org/specification/v0.9-a2ui/)
- [What is A2UI](https://a2ui.org/introduction/what-is-a2ui/)
- [A2UI on Google Developers Blog](https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/)
- [AI Frontend Generator Comparison 2025](https://www.hansreinl.de/blog/ai-code-generators-frontend-comparison)
- [MCP Apps - Bringing UI Capabilities to MCP Clients](http://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [Towards Human-AI Synergy in UI Design](https://arxiv.org/html/2412.20071v3)
- [Addy Osmani: AI Coding Workflow 2026](https://addyosmani.com/blog/ai-coding-workflow/)

### Motion Graphics & Animation
- [Remotion](https://www.remotion.dev/)
- [Remotion AI Generation Guide](https://www.remotion.dev/docs/ai/generate)
- [Remotion System Prompt for LLMs](https://www.remotion.dev/docs/ai/system-prompt)
- [Motion (Framer Motion)](https://motion.dev)
- [Motion Primitives](https://motion-primitives.com/)
- [Motion Primitives TextEffect](https://motion-primitives.com/docs/text-effect)
- [NumberFlow - Animated Number Component](https://number-flow.barvian.me/)
- [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)
- [Keyframes Tokens - Smashing Magazine](https://www.smashingmagazine.com/2025/11/keyframes-tokens-standardizing-animation-across-projects/)
- [CSS Entry/Exit Animations - Chrome](https://developer.chrome.com/blog/entry-exit-animations)
- [Animista - CSS Animation Library](https://animista.net/)

### Data Visualization
- [Vega-Lite](https://vega.github.io/vega-lite/)
- [Observable Plot](https://github.com/observablehq/plot)
- [shadcn/ui Charts](https://ui.shadcn.com/charts/area)
- [Grafana Panel Types](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/)
- [D3.js](https://d3js.org/)

### Broadcast Graphics
- [VinciFlow - OBS Graphics Controller](https://obsproject.com/forum/resources/vinciflow-stream-graphics-controller.2275/)
- [H2R Graphics](https://h2r.graphics/)
- [NewBlue Captivate](https://newbluefx.com/broadcast/)
- [WASP3D Live Sports Graphics](https://wasp3d.com/live-sports-graphics-and-overlays)

### Design Systems
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4)
- [Tailwind v4 Theme Variables](https://tailwindcss.com/docs/theme)
- [OKLCH in CSS - Evil Martians](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [shadcn/ui](https://ui.shadcn.com/)
- [Design Tokens That Scale in 2026](https://www.maviklabs.com/blog/design-tokens-tailwind-v4-2026)

### SVG & Generative Art
- [fffuel - SVG Generators](https://www.fffuel.co/)
- [SVG feTurbulence - Codrops](https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/)
- [Generative Art with JavaScript and SVG (Springer)](https://link.springer.com/book/10.1007/979-8-8688-0086-3)
- [p5.js](https://p5js.org/)

### Icons
- [Lucide Icons](https://lucide.dev/)
- [Heroicons](https://heroicons.com/)

### 3D
- [React Three Fiber](https://r3f.docs.pmnd.rs/)
