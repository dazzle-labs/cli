# Declarative Rendering Architecture: Research & Migration Plan

**Date:** 2026-03-05
**Scope:** Moving from imperative scene-mutation to declarative rendering with Remotion

---

## Table of Contents

1. [Current Architecture Analysis](#1-current-architecture-analysis)
2. [Remotion Deep Dive](#2-remotion-deep-dive)
3. [Motion Graphics Libraries Comparison](#3-motion-graphics-libraries-comparison)
4. [Template/Composition Patterns](#4-templatecomposition-patterns)
5. [Declarative Scene Description Approaches](#5-declarative-scene-description-approaches)
6. [Comparison Table](#6-comparison-table)
7. [Proposed Architecture](#7-proposed-architecture)
8. [Template Definitions](#8-template-definitions)
9. [Migration Plan](#9-migration-plan)

---

## 1. Current Architecture Analysis

### What We Have

```
Agent (LLM)
  |-- MCP tools: sceneSet, scenePatch, stateSet, timelineAppend
  |-- Generates ~1000 tokens of JSON per scene
  v
Server (Express + WebSocket)
  |-- SceneState: canonical Spec object
  |-- Broadcasts patches/snapshots to clients
  v
React Renderer (iframe @ 1920x1080)
  |-- ElementRenderer: walks Spec tree, resolves state expressions
  |-- Registry: maps type names -> React components
  |-- CSS-only animations (Animate, FadeIn, Stagger, Presence)
  v
Puppeteer capture -> video
```

### Core Data Model

```typescript
interface Spec {
  root: string
  elements: Record<string, UIElement>
  state: Record<string, unknown>
}

interface UIElement {
  type: string          // "Heading", "Chart", "LowerThird", etc.
  props: Record<string, unknown>
  children?: string[]   // keys into elements
  slot?: string
}
```

### Pain Points (Confirmed by Code Review)

1. **Imperative mutation is fragile**: The `applyPatches` code in `/src/core/patch.ts` has a guard comment: "agents frequently write { path: '/elements/x/children', value: 'childId' } intending to append, but this replaces the array with a string."

2. **CSS-only animations**: Components like `Animate.tsx` use CSS keyframes (`@keyframes`) and `animation` properties. No physics-based springs, no interpolation curves, no frame-accurate timing.

3. **Web-like defaults**: The `Renderer.tsx` base styles use `background: #0d1117` (GitHub dark), `font-family: system-ui`, `color: #e6edf3`. The catalog tries to fix this with prose instructions ("Avoid web-UI grey palettes (#161b22, #0d1117, #30363d)") but the CSS defaults fight the guidance.

4. **No native transitions**: The `TransitionSpec` in `timeline.ts` offers "cut", "crossfade", and "css" types, but the actual implementation is just CSS `transition` property toggling -- not frame-accurate compositing.

5. **Dead air**: Agent generates JSON, waits for response, generates more JSON. No pre-computed timeline with smooth playback.

6. **Token waste**: Each `sceneSet` sends the entire flat element map. A typical scene with a gradient background, heading, subheading, stats grid, and lower third is 50-80 lines of JSON.

---

## 2. Remotion Deep Dive

### 2.1 Remotion Player (`@remotion/player`)

**What it is:** A React component (`<Player>`) that embeds a Remotion video directly in any React app. This is the real-time preview component -- NOT just for rendering to file.

**Key facts:**
- Current version: 4.0.432 (latest as of March 2026)
- Embeds in any React app: Vite, Next.js, CRA
- Same component code used for both live preview AND final video render
- Player accepts `inputProps` that trigger re-renders when changed
- Full programmatic control via `PlayerRef`

**Installation (brownfield into our Vite app):**
```bash
npm i --save-exact remotion@4.0.432 @remotion/player@4.0.432
```

**Player API -- what matters for us:**

```tsx
import { Player, PlayerRef } from '@remotion/player';

<Player
  ref={playerRef}
  component={BroadcastComposition}    // Our Remotion component
  inputProps={currentSceneData}       // Data from MCP tools
  durationInFrames={totalFrames}      // Computed from timeline
  compositionWidth={1920}
  compositionHeight={1080}
  fps={30}
  controls={false}                    // We provide our own
  autoPlay={true}
  loop={false}
/>
```

**PlayerRef methods we'd use:**
- `play()`, `pause()`, `seekTo(frame)` -- replaces our `usePlayback` hook
- `getCurrentFrame()` -- for status reporting
- `addEventListener('frameupdate', cb)` -- for sync

**Critical insight:** The Player re-renders the React component tree on every frame, calling `useCurrentFrame()` which returns the current frame number. Components use this to compute their visual state declaratively. This means: **no mutation, no patching, no state management bugs**. The entire visual state is a pure function of (frame, inputProps).

Sources:
- [Remotion Player API](https://remotion.dev/docs/player/api)
- [@remotion/player overview](https://www.remotion.dev/docs/player/)
- [Brownfield installation](https://www.remotion.dev/docs/brownfield)
- [Player installation](https://www.remotion.dev/docs/player/installation)

### 2.2 Composition Model

Remotion compositions are defined with `<Composition>`:

```tsx
<Composition
  id="broadcast"
  component={BroadcastVideo}
  durationInFrames={300}
  width={1920}
  height={1080}
  fps={30}
  defaultProps={{ scenes: [] }}
/>
```

**Sequences** control timing:
```tsx
<Sequence from={0} durationInFrames={90}>
  <TitleScene title="Welcome" subtitle="Episode 1" />
</Sequence>
<Sequence from={90} durationInFrames={120}>
  <DataScene stats={[...]} />
</Sequence>
```

**Series** for sequential playback (no manual frame math):
```tsx
<Series>
  <Series.Sequence durationInFrames={90}>
    <TitleScene />
  </Series.Sequence>
  <Series.Sequence durationInFrames={120}>
    <DataScene />
  </Series.Sequence>
</Series>
```

Sources:
- [Sequence API](https://www.remotion.dev/docs/sequence)
- [Series API](https://www.remotion.dev/docs/series)

### 2.3 TransitionSeries (`@remotion/transitions`)

This is the key package for broadcast-quality scene transitions.

```bash
npm i --save-exact @remotion/transitions@4.0.432
```

**Built-in transition presentations:**

| Presentation | Effect |
|---|---|
| `fade()` | Opacity crossfade |
| `slide()` | Slide in, push out previous |
| `wipe()` | Slide over previous scene |
| `flip()` | 3D rotation of previous scene |
| `clockWipe()` | Circular reveal (clock hand) |
| `iris()` | Circular mask from center |
| `cube()` | 3D cube rotation between scenes |

**Timing functions:**
- `springTiming({ config: { damping: 200 }, durationInFrames: 30 })`
- `linearTiming({ durationInFrames: 30, easing: Easing.inOut(Easing.ease) })`

**Usage:**
```tsx
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={90}>
    <TitleScene />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={linearTiming({ durationInFrames: 15 })}
  />
  <TransitionSeries.Sequence durationInFrames={120}>
    <DataScene />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

**Duration math:** A + B - transition = total. So 90 + 120 - 15 = 195 frames total.

Sources:
- [TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries)
- [@remotion/transitions overview](https://www.remotion.dev/docs/transitions/)
- [Transitions guide](https://www.remotion.dev/docs/transitioning)

### 2.4 Animation Primitives

**`spring()`** -- Physics-based animation (from Reanimated 2):
```tsx
const frame = useCurrentFrame();
const { fps } = useVideoConfig();

const scale = spring({
  frame,
  fps,
  config: {
    mass: 1,        // Higher = slower
    stiffness: 100, // Higher = bouncier
    damping: 10,    // Higher = less bounce
    overshootClamping: false,
  },
  durationInFrames: 30,  // Stretch to exact length
  delay: 10,              // Delay in frames
});
```

**`interpolate()`** -- Map any value to any range:
```tsx
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateRight: 'clamp',
});

const translateY = interpolate(frame, [0, 20], [50, 0], {
  extrapolateRight: 'clamp',
  easing: Easing.bezier(0.25, 0.1, 0.25, 1),
});
```

**Why this beats CSS animations:**
- Frame-accurate: every frame is a pure function of time
- Composable: combine spring + interpolate for complex motion
- Deterministic: renders identically every time (video rendering requires this)
- Physics-based: spring() creates natural overshoot/bounce that CSS `ease` cannot
- No timing drift: CSS animations can desync with video frame capture

Sources:
- [spring() API](https://www.remotion.dev/docs/spring)
- [interpolate() API](https://www.remotion.dev/docs/interpolate)
- [Animating properties guide](https://www.remotion.dev/docs/animating-properties)

### 2.5 Parameterized / Data-Driven Videos

Remotion's `inputProps` system is exactly what we need for agent-driven content.

**Data flow:**
1. **Default props** defined on `<Composition defaultProps={...}>` -- design-time data
2. **Input props** override defaults at runtime (via Player or renderMedia)
3. **`calculateMetadata()`** post-processes props (fetch URLs, compute duration, etc.)
4. **Component receives** final merged props as standard React props

```tsx
// Define the schema
const SceneSchema = z.object({
  scenes: z.array(z.object({
    type: z.enum(['title', 'stats', 'chart', 'comparison']),
    data: z.record(z.unknown()),
    duration: z.number().optional(),
  })),
  theme: z.object({
    primary: z.string(),
    background: z.string(),
  }).optional(),
});

// Use in composition
<Composition
  id="broadcast"
  component={BroadcastVideo}
  schema={SceneSchema}
  defaultProps={{ scenes: [], theme: { primary: '#3b82f6', background: '#0a1628' } }}
  calculateMetadata={({ props }) => ({
    durationInFrames: props.scenes.reduce((sum, s) => sum + (s.duration || 90), 0),
  })}
/>
```

**In the Player:**
```tsx
<Player
  component={BroadcastVideo}
  inputProps={agentData}  // Updated via MCP tool calls
  // ... Player re-renders automatically when inputProps change
/>
```

Sources:
- [Parameterized rendering](https://www.remotion.dev/docs/parameterized-rendering)
- [calculateMetadata()](https://www.remotion.dev/docs/calculate-metadata)
- [Data fetching](https://www.remotion.dev/docs/data-fetching)

### 2.6 Remotion + AI

Remotion has official AI integration guidance as of 2025-2026:

**Remotion Skills** (released Jan 2026): Users describe videos in natural language, AI writes React/TypeScript code, Remotion renders it. This is the "agent writes code" approach.

**AI SaaS Template**: A Next.js starter that:
1. Streams LLM-generated code to the browser
2. JIT-compiles it
3. Renders in Remotion Player instantly
4. Supports iterative refinement via chat

**System Prompt** (`remotion.dev/llms.txt`): Remotion provides a prompt teaching LLMs:
- Project structure (entry file, Root, compositions)
- Core hooks (`useCurrentFrame`, `useVideoConfig`)
- Animation APIs (`interpolate`, `spring`)
- Media components (`<Video>`, `<Audio>`, `<Img>`)
- Layout (`<AbsoluteFill>`, `<Sequence>`, `<Series>`, `<TransitionSeries>`)
- Rendering (`renderMedia`, Lambda)
- Determinism requirement (no Math.random, use `random('seed')`)

**Key insight for our system:** We should NOT have the agent write Remotion code (the "Skills" approach). Instead, we should define **parameterized compositions** (templates) that the agent fills with data. This is lower-token, more reliable, and produces consistent quality.

Sources:
- [Building with Remotion and AI](https://www.remotion.dev/docs/ai/)
- [Remotion System Prompt](https://www.remotion.dev/docs/ai/system-prompt)
- [AI SaaS Template](https://www.remotion.dev/docs/ai/ai-saas-template)
- [Claude Code + Remotion](https://www.remotion.dev/docs/ai/claude-code)
- [Remotion Skills article](https://medium.com/@302.AI/test-of-the-viral-remotion-skill-turning-video-production-from-a-pro-skill-into-an-everyday-tool-74aef027f879)

### 2.7 Server-Side Rendering

Same code renders both preview and final video:

```typescript
import { renderMedia, selectComposition } from '@remotion/renderer';

const composition = await selectComposition({
  serveUrl: bundleLocation,
  id: 'broadcast',
  inputProps: agentData,
});

await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: 'h264',
  outputLocation: 'output.mp4',
  inputProps: agentData,
});
```

This replaces our Puppeteer capture entirely. Same React components, same data, pixel-perfect output.

Sources:
- [@remotion/renderer](https://www.remotion.dev/docs/renderer)
- [renderMedia()](https://www.remotion.dev/docs/renderer/render-media)
- [SSR guide](https://www.remotion.dev/docs/ssr-node)

---

## 3. Motion Graphics Libraries Comparison

### 3.1 Motion Canvas

**What:** TypeScript library for animated videos using Canvas API.
**Architecture:** Single `<canvas>` element, imperative/procedural programming style.
**Strengths:** Intuitive API for vector animations, built-in editor, truly open source (MIT).
**Weaknesses:** Canvas-only (no DOM content), imperative (not declarative), no React integration, smaller ecosystem.
**Verdict:** Wrong paradigm. We want declarative React components, not imperative canvas drawing.

Source: [Motion Canvas](https://motioncanvas.io/)

### 3.2 Revideo

**What:** Fork of Motion Canvas by YC-backed company, aimed at video generation API.
**Key additions:** Headless rendering, parallelized rendering, audio support, React player component.
**Architecture:** Still canvas-based and imperative under the hood.
**Verdict:** Interesting for pure programmatic video, but still canvas-based. Remotion's DOM approach is better for our use case (text, charts, data viz).

Source: [Revideo](https://re.video/blog/fork)

### 3.3 Theatre.js

**What:** Animation toolbox with a visual keyframe editor (Studio).
**Architecture:** Keyframe-based sequences, deep R3F integration.
**Strengths:** Visual editor for crafting animations, 3D animation support.
**Weaknesses:** Designed for interactive web, not video output. No rendering pipeline. Requires manual keyframe authoring.
**Verdict:** Great for hand-crafted 3D animations, wrong tool for AI-driven broadcast graphics.

Source: [Theatre.js](https://www.theatrejs.com)

### 3.4 Motion (formerly Framer Motion)

**What:** React animation library, now standalone as `motion.dev`.
**Architecture:** Declarative `<motion.div>` components with `animate`, `whileHover`, spring physics.
**Strengths:** Beautiful API, spring-first animations, layout animations, `AnimatePresence` for exit animations.
**Weaknesses:** Designed for UI interactions, not video production. No frame-accurate rendering. No video output pipeline. CSS-based timing (not frame-based).
**Verdict:** Could enhance our current CSS animations significantly, but doesn't solve the video rendering or timeline problems. Could be used INSIDE Remotion compositions for interactive elements.

Source: [Motion](https://motion.dev)

### 3.5 GSAP (GreenSock Animation Platform)

**What:** Professional JavaScript animation library, used on 12M+ sites.
**Architecture:** Imperative timeline-based: `gsap.to()`, `gsap.timeline()`.
**Strengths:** Battle-tested, precise control, ScrollTrigger, MorphSVG, SplitText. Now 100% free (thanks to Webflow acquisition).
**Weaknesses:** Imperative API doesn't fit declarative React model well. Not designed for video frame capture.
**Verdict:** Powerful but wrong paradigm. GSAP's imperative style fights React's declarative model. However, GSAP animations CAN be used inside Remotion components via `useCurrentFrame()` driving GSAP timelines.

Source: [GSAP](https://gsap.com/)

### 3.6 Lottie / Bodymovin

**What:** After Effects animations exported as JSON, rendered natively on web/mobile.
**Architecture:** JSON animation format + player library (`lottie-web`).
**Strengths:** Professional motion designers create in After Effects, export as lightweight JSON. Scales perfectly. Tiny file sizes. Cross-platform.
**Weaknesses:** One-way pipeline (AE -> JSON -> playback). Cannot be parameterized with data. Static animations, not data-driven.
**Verdict:** Excellent for pre-built decorative elements (logo animations, transitions, ornaments). Use Lottie INSIDE Remotion compositions for pre-authored motion graphics. Remotion has a `<Lottie>` component.

Source: [Lottie](https://lottie.airbnb.tech/)

---

## 4. Template/Composition Patterns

### 4.1 CasparCG (Broadcast Industry Standard)

CasparCG is the open-source broadcast playout server used in live TV. Its HTML template system is directly relevant:

**Architecture:**
- Server renders HTML pages using Chromium Embedded Framework (CEF)
- Templates are standard HTML/CSS/JS websites
- Control via AMCP protocol (think MCP but for broadcast)
- WebSocket for real-time data updates
- Templates have `play()`, `stop()`, `update(data)`, `next()` lifecycle methods

**What we can learn:**
- Templates accept structured data, not raw DOM mutations
- Visual design is baked into the template -- operators only change data fields
- Layer system: each template runs on a separate video layer, composited by the server
- The "Essential Graphics" paradigm: designer controls the visuals, operator controls the data

Source: [CasparCG HTML Template Guide](https://chrisryanouellette.gitbook.io/casparcg-html-template-guide)

### 4.2 MOGRT (Motion Graphics Templates)

After Effects' MOGRT format exemplifies the template paradigm we want:

**How it works:**
1. Motion designer builds animation in After Effects
2. Exposes specific properties via "Essential Graphics" panel (text, colors, media, position, duration)
3. Exports as .mogrt file (self-contained package with all assets)
4. Editor opens in Premiere Pro, sees ONLY the exposed controls
5. Editor changes text/colors/images -- animation structure is locked

**Key insight:** MOGRT's creator-to-editor model maps directly to our needs:
- **Creator** = Us (system developers) building Remotion compositions
- **Editor** = AI agent filling in data via MCP tools
- **Exposed controls** = inputProps schema (title, subtitle, stats, colors, etc.)
- **Locked structure** = Remotion component code (transitions, animations, layout)

Source: [MOGRT Guide](https://blog.frame.io/2024/08/12/mogrt-guide-after-effects-2024-motion-graphics-workflow/)

### 4.3 Canva's Autofill API

Canva implements a similar pattern via their Brand Templates:

- Templates have named **data fields** (CITY, TEMPERATURE, BACKGROUND)
- API: `GET /brand-templates/{id}/dataset` returns field schema
- API: `POST /autofill` creates design with data
- Fields are typed (text vs image) and constrained

**Our analogy:** The agent would call `GET catalogRead` to see available templates and their parameter schemas, then `POST sceneSet` with template ID + parameters.

Source: [Canva Autofill Guide](https://www.canva.dev/docs/connect/autofill-guide/)

### 4.4 JSON-to-Video APIs

Commercial platforms (JSON2Video, Shotstack, Creatomate) all converge on the same pattern:

```json
{
  "template": "news-lower-third",
  "data": {
    "name": "Dr. Jane Smith",
    "title": "Climate Scientist",
    "organization": "MIT"
  },
  "settings": {
    "duration": 5,
    "transition": "slide-in"
  }
}
```

All of them: template ID + data object + optional settings. This is the abstraction level we want for our MCP tools.

Sources:
- [JSON2Video](https://json2video.com/)
- [Shotstack](https://shotstack.io/)
- [Creatomate](https://creatomate.com/)

### 4.5 Remotion Community Templates

The [reactvideoeditor/remotion-templates](https://github.com/reactvideoeditor/remotion-templates) repository provides free templates as React components that accept props. Each template is a `<Composition>` that can be parameterized.

---

## 5. Declarative Scene Description Approaches

### 5.1 React Three Fiber

R3F transforms Three.js's imperative API into declarative React:

```tsx
// Imperative Three.js
const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 'orange' });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Declarative R3F
<mesh>
  <boxGeometry args={[1, 1, 1]} />
  <meshBasicMaterial color="orange" />
</mesh>
```

**Lesson:** The same transformation we want. Instead of `scenePatch({ op: "add", path: "/elements/title", value: {...} })`, the agent declares `{ template: "title-card", title: "Hello" }`.

### 5.2 Remotion's Composition Model

Remotion's model is the closest to what we need:

```
Composition
  +-- Sequence (from=0, dur=90)
  |     +-- TitleScene (props: {title, subtitle})
  +-- TransitionSeries.Transition (fade, 15 frames)
  +-- Sequence (from=90, dur=120)
        +-- DataScene (props: {stats, chart})
```

Each component is a pure function of `(frame, props)`. No mutation. No patches.

### 5.3 SwiftUI's Animation Philosophy

SwiftUI's "state changes first, animation as consequence" principle:

```swift
withAnimation(.spring(duration: 0.5, bounce: 0.3)) {
    showDetails = true  // State change
}
// SwiftUI automatically animates ALL views that depend on showDetails
```

**Lesson:** We should think about animations the same way. The agent changes DATA (props), and the system automatically animates the transition. The agent never describes HOW to animate -- only WHAT changed.

### 5.4 Vega-Lite

Vega-Lite's grammar of graphics is already an influence on our Chart component:

```json
{
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal"},
    "y": {"field": "value", "type": "quantitative"}
  },
  "data": {"values": [...]}
}
```

**Lesson:** This level of abstraction works. The user specifies WHAT to show (data + encoding), not HOW to render it. We should extend this pattern beyond charts to entire scenes.

---

## 6. Comparison Table

| Criteria | Current System | Remotion | Motion Canvas | Revideo | Motion (Framer) | GSAP |
|---|---|---|---|---|---|---|
| **Rendering** | DOM + CSS in iframe | DOM + React in Player | Canvas API | Canvas API | DOM + CSS | DOM + CSS |
| **Animation** | CSS keyframes | spring() + interpolate() | Imperative tweens | Imperative tweens | Spring physics | Timeline tweens |
| **Frame accuracy** | No (CSS timing) | Yes (pure function of frame) | Yes | Yes | No | Approximate |
| **Transitions** | CSS transition property | TransitionSeries (7+ types) | Manual | Manual | AnimatePresence | Timeline |
| **Video output** | Puppeteer capture | renderMedia() (native) | Built-in | Built-in | None | None |
| **React integration** | Native | Native | None | React Player | Native | Wrapper needed |
| **Data-driven** | JSON Spec + patches | inputProps + schema | Code-driven | Code-driven | Props | Code-driven |
| **AI integration** | Our MCP tools | Official AI docs + Skills | None | None | None | None |
| **Deterministic** | No (CSS timing varies) | Yes (required by design) | Yes | Yes | No | No |
| **License** | Proprietary | Source-available (paid for companies) | MIT | MIT | MIT | Free (Webflow) |
| **Ecosystem** | Custom | Large (4.0.432, active dev) | Small | Small | Large | Very large |

**Clear winner: Remotion.** It's the only option that provides:
1. Real-time preview (Player) AND video output (renderMedia) from the same code
2. Frame-accurate, deterministic animations
3. React-native with declarative composition model
4. Official AI integration guidance
5. Professional transition library
6. Active development and large ecosystem

---

## 7. Proposed Architecture

### 7.1 Architecture Diagram

```
                          MCP Tools (simplified)
                          ======================
Agent (LLM)  ------>  sceneSet({ template, data, transition? })
                      timelineSet({ scenes: [...] })
                      catalogRead()
                          |
                          v
                    Stream Server
                    =============
                    - Validates data against template schema (Zod)
                    - Computes total duration from scenes
                    - Broadcasts to Player via WebSocket
                          |
                          v
                    Remotion Player
                    ===============
                    <Player
                      component={BroadcastVideo}
                      inputProps={{ scenes, theme }}
                      durationInFrames={computed}
                      compositionWidth={1920}
                      compositionHeight={1080}
                      fps={30}
                    />
                          |
                          v
                    BroadcastVideo Component
                    ========================
                    <TransitionSeries>
                      {scenes.map(scene => (
                        <>
                          <TransitionSeries.Sequence>
                            <SceneRouter scene={scene} />
                          </TransitionSeries.Sequence>
                          <TransitionSeries.Transition ... />
                        </>
                      ))}
                    </TransitionSeries>
                          |
                          v
                    Scene Components (Templates)
                    ============================
                    TitleScene, StatsScene, ChartScene,
                    ComparisonScene, ImageScene, CodeScene,
                    LowerThirdOverlay, TickerOverlay, etc.
                    (each uses spring(), interpolate(), useCurrentFrame())
                          |
                          v
                    Output Options
                    ==============
                    Live: Player in browser (real-time)
                    Video: renderMedia() (MP4/WebM)
                    Still: renderStill() (PNG for thumbnails)
```

### 7.2 New MCP Tool Surface

**Radically simplified from 11 tools to 4:**

```typescript
// 1. catalogRead -- unchanged in purpose, different content
//    Returns available templates, their schemas, and theme options
server.tool("catalogRead", {}, async () => {
  return templateCatalog.describe();
});

// 2. sceneSet -- now takes template + data, not raw elements
//    This is the primary tool. One call = one complete scene.
server.tool("sceneSet", {
  scenes: z.array(z.object({
    template: z.string(),           // "title", "stats", "chart", "comparison", etc.
    data: z.record(z.unknown()),    // Template-specific data
    duration: z.number().optional(), // Seconds (default per template)
    transition: z.enum(["fade", "slide", "wipe", "flip", "iris", "cube", "none"]).optional(),
  })),
  theme: z.object({
    primary: z.string().optional(),
    background: z.string().optional(),
    accent: z.string().optional(),
    font: z.string().optional(),
  }).optional(),
}, async ({ scenes, theme }) => {
  // Validate each scene's data against its template schema
  // Compute total frames
  // Update Player inputProps
});

// 3. sceneAppend -- add scenes to the current presentation
server.tool("sceneAppend", {
  scenes: z.array(/* same as above */),
}, async ({ scenes }) => {
  // Append to existing scenes array
  // Recalculate duration
  // Player updates automatically
});

// 4. screenshotTake -- unchanged
```

**Token comparison:**

Current approach (~800 tokens for a title scene):
```json
{
  "spec": {
    "root": "bg",
    "elements": {
      "bg": {
        "type": "Gradient",
        "props": { "colors": ["#0a1628", "#1a365d"], "angle": 135, "style": { "width": "100%", "height": "100%" } },
        "children": ["content"]
      },
      "content": {
        "type": "Stack",
        "props": { "direction": "vertical", "align": "center", "justify": "center", "gap": 24, "style": { "width": "100%", "height": "100%", "padding": 80 } },
        "children": ["title", "subtitle"]
      },
      "title": {
        "type": "Heading",
        "props": { "text": "Welcome to the Show", "level": 1, "style": { "fontSize": 96, "color": "#ffffff", "textAlign": "center" } }
      },
      "subtitle": {
        "type": "Text",
        "props": { "text": "Season 3, Episode 1", "style": { "fontSize": 36, "color": "#94a3b8", "textAlign": "center" } }
      }
    },
    "state": {}
  }
}
```

New approach (~100 tokens):
```json
{
  "scenes": [{
    "template": "title",
    "data": {
      "title": "Welcome to the Show",
      "subtitle": "Season 3, Episode 1"
    }
  }]
}
```

**That is an 8x reduction in tokens per scene.**

### 7.3 Theme System

Instead of per-element color specifications, a global theme:

```typescript
interface BroadcastTheme {
  // Colors
  primary: string;       // e.g., "#3b82f6" (brand blue)
  background: string;    // e.g., "#0a1628" (deep navy)
  surface: string;       // e.g., "#1e293b" (card/panel bg)
  accent: string;        // e.g., "#f59e0b" (highlight yellow)
  text: string;          // e.g., "#f8fafc" (near-white)
  textMuted: string;     // e.g., "#94a3b8" (subdued)

  // Typography
  fontFamily: string;    // e.g., "'Inter', 'SF Pro Display', system-ui"
  heroSize: number;      // e.g., 96
  headingSize: number;   // e.g., 48
  bodySize: number;      // e.g., 28

  // Motion
  transitionFrames: number;  // e.g., 15 (0.5s at 30fps)
  springConfig: {
    mass: number;
    stiffness: number;
    damping: number;
  };
}
```

Pre-built theme palettes the agent can reference by name:
- `"news"` -- CNN-style red/white/navy
- `"tech"` -- Apple keynote dark/blue/white
- `"finance"` -- Bloomberg blue/green/dark
- `"nature"` -- Earth tones, warm greens
- `"energy"` -- Vibrant gradients, neon accents

### 7.4 How the Player Gets Driven

```
WebSocket message: { type: "scenes-update", scenes: [...], theme: {...} }
                          |
                          v
                    App.tsx
                    =======
                    const [scenes, setScenes] = useState([]);
                    const [theme, setTheme] = useState(defaultTheme);

                    // On WS message:
                    setScenes(msg.scenes);
                    setTheme(msg.theme);

                    // Compute duration:
                    const fps = 30;
                    const totalFrames = scenes.reduce((sum, s) =>
                      sum + (s.duration || defaultDuration(s.template)) * fps, 0
                    ) + (scenes.length - 1) * transitionFrames;

                    <Player
                      component={BroadcastVideo}
                      inputProps={{ scenes, theme }}
                      durationInFrames={totalFrames}
                      fps={fps}
                      compositionWidth={1920}
                      compositionHeight={1080}
                      autoPlay
                    />
```

When the agent calls `sceneAppend`, new scenes are added to the array, `totalFrames` recalculates, and the Player continues from where it was -- new content seamlessly follows.

---

## 8. Template Definitions

### 8.1 Core Templates to Build

Each template is a Remotion component that uses `useCurrentFrame()`, `spring()`, and `interpolate()` for broadcast-quality motion.

#### TitleScene
```typescript
interface TitleSceneProps {
  title: string;
  subtitle?: string;
  badge?: string;         // Small label above title (e.g., "BREAKING NEWS")
  backgroundImage?: string;
  gradient?: [string, string]; // Override theme gradient
}
```
**Animation:** Title springs in from below (spring, 20 frames), subtitle fades in with delay (interpolate opacity, 15 frames after title), badge slides in from left.

#### StatsScene
```typescript
interface StatsSceneProps {
  title?: string;
  stats: Array<{
    value: number | string;
    label: string;
    unit?: string;
    trend?: "up" | "down" | "flat";
    prefix?: string;
  }>;
  layout?: "grid" | "row" | "featured";  // "featured" = first stat large, rest small
}
```
**Animation:** Stats stagger in (spring scale from 0.8 to 1, 100ms between each). Values count up using interpolate(). Trend arrows spring in with overshoot.

#### ChartScene
```typescript
interface ChartSceneProps {
  title?: string;
  mark: "bar" | "line" | "area" | "pie" | "donut";
  data: Array<Record<string, unknown>>;
  xField?: string;
  yField?: string;
  colors?: string[];
  annotation?: string;  // Callout text for key data point
}
```
**Animation:** Bars grow from bottom (spring height), lines draw with interpolated path length, pie slices rotate in.

#### ComparisonScene
```typescript
interface ComparisonSceneProps {
  title?: string;
  items: Array<{
    label: string;
    value: number | string;
    description?: string;
    image?: string;
    highlight?: boolean;
  }>;
  layout?: "side-by-side" | "versus" | "table";
}
```
**Animation:** Items slide in from opposite sides (left/right spring), "VS" badge bounces in center.

#### ImageScene
```typescript
interface ImageSceneProps {
  src: string;
  title?: string;
  caption?: string;
  fit?: "cover" | "contain";
  kenBurns?: boolean;     // Slow zoom effect
  overlay?: "gradient" | "vignette" | "none";
}
```
**Animation:** Image fades in, Ken Burns zoom via interpolated scale (1 -> 1.1 over scene duration), text overlays spring in from bottom.

#### CodeScene
```typescript
interface CodeSceneProps {
  code: string;
  language?: string;
  title?: string;
  highlights?: number[];  // Line numbers to highlight
  typewriter?: boolean;   // Reveal code character by character
}
```
**Animation:** Code block fades in, highlighted lines pulse glow, typewriter effect via interpolated string slice.

#### QuoteScene
```typescript
interface QuoteSceneProps {
  quote: string;
  attribution?: string;
  image?: string;         // Author photo
}
```
**Animation:** Large quotation mark springs in, text fades in word by word.

#### TimelineScene
```typescript
interface TimelineSceneProps {
  title?: string;
  events: Array<{
    date: string;
    label: string;
    description?: string;
    active?: boolean;
  }>;
}
```
**Animation:** Timeline line draws left to right (interpolated width), events stagger-spring in at their positions.

### 8.2 Overlay Templates (Composited on Top)

#### LowerThirdOverlay
```typescript
interface LowerThirdProps {
  name: string;
  title?: string;
  subtitle?: string;
}
```
**Animation:** Accent bar slides in from left (spring), name/title fade in with stagger.

#### TickerOverlay
```typescript
interface TickerProps {
  items: Array<{ text: string; category?: string; urgent?: boolean }>;
  speed?: number;
}
```
**Animation:** Continuous scroll via interpolated translateX.

#### BannerOverlay
```typescript
interface BannerProps {
  text: string;
  severity?: "info" | "warning" | "breaking";
}
```
**Animation:** Drops from top with spring bounce.

---

## 9. Migration Plan

### Phase 0: Proof of Concept (1-2 days)

**Goal:** Validate that Remotion Player works inside our Vite app and can be driven by WebSocket data.

**Steps:**
1. Install packages:
   ```bash
   npm i --save-exact remotion@4.0.432 @remotion/player@4.0.432 @remotion/transitions@4.0.432
   ```

2. Create `src/remotion/TitleScene.tsx`:
   ```tsx
   import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';

   export const TitleScene: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => {
     const frame = useCurrentFrame();
     const { fps } = useVideoConfig();

     const titleY = interpolate(
       spring({ frame, fps, config: { damping: 15 } }),
       [0, 1], [60, 0]
     );
     const titleOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
     const subtitleOpacity = interpolate(frame, [10, 25], [0, 1], { extrapolateRight: 'clamp' });

     return (
       <div style={{
         width: '100%', height: '100%',
         background: 'linear-gradient(135deg, #0a1628, #1a365d)',
         display: 'flex', flexDirection: 'column',
         alignItems: 'center', justifyContent: 'center',
         fontFamily: "'Inter', system-ui",
       }}>
         <h1 style={{
           fontSize: 96, color: '#fff', fontWeight: 700,
           opacity: titleOpacity,
           transform: `translateY(${titleY}px)`,
         }}>
           {title}
         </h1>
         {subtitle && (
           <p style={{
             fontSize: 36, color: '#94a3b8', marginTop: 24,
             opacity: subtitleOpacity,
           }}>
             {subtitle}
           </p>
         )}
       </div>
     );
   };
   ```

3. Create `src/remotion/BroadcastVideo.tsx` with a basic TransitionSeries:
   ```tsx
   import { TransitionSeries, linearTiming } from '@remotion/transitions';
   import { fade } from '@remotion/transitions/fade';
   import { TitleScene } from './TitleScene';

   export const BroadcastVideo: React.FC<{ scenes: any[] }> = ({ scenes }) => {
     const fps = 30;
     return (
       <TransitionSeries>
         {scenes.map((scene, i) => (
           <React.Fragment key={i}>
             {i > 0 && (
               <TransitionSeries.Transition
                 presentation={fade()}
                 timing={linearTiming({ durationInFrames: 15 })}
               />
             )}
             <TransitionSeries.Sequence durationInFrames={(scene.duration || 3) * fps}>
               {scene.template === 'title' && <TitleScene {...scene.data} />}
             </TransitionSeries.Sequence>
           </React.Fragment>
         ))}
       </TransitionSeries>
     );
   };
   ```

4. Add a `<Player>` in `App.tsx` alongside the current `<Renderer>`, behind a feature flag.

5. Wire the WebSocket to update `inputProps` on the Player.

**Success criteria:** Agent calls `sceneSet` with template data, Player shows animated title card with spring animation and transition to next scene.

### Phase 1: Template Library (3-5 days)

**Goal:** Build the 8 core scene templates + 3 overlay templates.

**Steps:**
1. Create each template component in `src/remotion/templates/`
2. Build the `SceneRouter` that maps template names to components
3. Implement the theme system with 5 named palettes
4. Add overlay compositing (overlays render in `<AbsoluteFill>` on top of scenes)
5. Build the new `catalogRead` output describing templates and their schemas
6. Test with the harness -- validate each template renders correctly

**What to keep from current system:**
- `Chart` component logic (the Vega-Lite-inspired data viz)
- `Table` component logic
- `Sparkline` SVG rendering
- The MCP server infrastructure (Express + WebSocket + MCP SDK)
- The harness evaluation framework
- The Zod schema validation pattern

**What to replace:**
- `Renderer.tsx` -> Remotion `<Player>`
- `ElementRenderer.tsx` -> Remotion component tree
- `StateProvider.tsx` -> Remotion `inputProps`
- `usePlayback.ts` -> Remotion Player's built-in playback
- `patch.ts` -> No more patches. Full scene replacement via inputProps.
- CSS animations (Animate, FadeIn, Stagger, etc.) -> spring() + interpolate()
- The iframe viewport scaling -> Player handles its own scaling

### Phase 2: New MCP Tools (2-3 days)

**Goal:** Replace the current 11-tool MCP surface with the simplified 4-tool surface.

**Steps:**
1. Implement new `sceneSet` that accepts `{ scenes, theme }`
2. Implement `sceneAppend` for incremental scene building
3. Update `catalogRead` to describe templates instead of components
4. Remove `scenePatch`, `stateSet`, `validateSpec` (no longer needed)
5. Keep `screenshotTake` and timeline tools for backward compatibility during transition
6. Update the catalog prompt to teach the agent about templates

### Phase 3: Video Output (2-3 days)

**Goal:** Replace Puppeteer capture with Remotion's native rendering.

**Steps:**
1. Install `@remotion/renderer` and `@remotion/bundler`
2. Create a render endpoint on the server
3. Bundle the Remotion project with `bundle()`
4. Use `renderMedia()` with the same inputProps used by the Player
5. Remove Puppeteer dependency
6. Validate harness video output matches Player preview

### Phase 4: Polish & Production (ongoing)

**Steps:**
1. Add Google Fonts loading (Inter, JetBrains Mono)
2. Build Lottie integration for decorative elements
3. Add audio support (background music, transition sounds via `@remotion/sfx`)
4. Create a template gallery/preview tool
5. Performance optimize: memoize inputProps, lazy-load heavy templates
6. Add `renderStill()` for thumbnail generation
7. Explore Lambda rendering for cloud-based video generation

### What We Explicitly Throw Away

| Component | Reason |
|---|---|
| `patch.ts` | No more imperative mutations |
| `ElementRenderer.tsx` | Replaced by Remotion's own React rendering |
| `StateProvider.tsx` | State expressions replaced by direct props |
| `expressions.ts` | No need for `{ "$state": "/path" }` -- data is in props |
| `Layout.tsx` (slot system) | Replaced by Remotion composition structure |
| `IframeViewport` in Renderer | Player handles viewport scaling |
| All CSS animation components (Animate, FadeIn, Stagger, Presence, Transition) | Replaced by spring/interpolate |
| `usePlayback.ts` | Player has built-in playback controls |
| Puppeteer dependency | Replaced by @remotion/renderer |

### What We Keep

| Component | Why |
|---|---|
| MCP server infrastructure | Still the agent communication layer |
| Express + WebSocket server | Still delivers data to the Player |
| Catalog/schema system | Templates still need schemas (Zod) |
| Harness evaluation framework | Still validates output quality |
| Chart/Table/Sparkline SVG logic | Port into Remotion template components |

### Licensing Note

Remotion is source-available but requires a company license for commercial use. The `acknowledgeRemotionLicense` prop on Player suppresses the console message. Evaluate cost against the development time saved.

---

## Summary of Recommendations

1. **Use Remotion.** It is the clear winner across every dimension: real-time preview, video output, declarative React model, frame-accurate animations, professional transitions, and AI integration support.

2. **Template-first, not code-generation.** Do NOT have the agent write Remotion code (the "Skills" approach). Instead, define parameterized compositions that the agent fills with data. This gives 8x token reduction and consistent quality.

3. **Replace the entire renderer.** The iframe + ElementRenderer + CSS animations stack should be replaced wholesale with Remotion Player + spring/interpolate animations. This is not a gradual migration -- the approaches are fundamentally different.

4. **Adopt the MOGRT/CasparCG paradigm.** Designers (us) control visual structure and animation. The agent (operator) controls data. The agent should never specify font sizes, colors, or animation timings -- those are baked into templates and themes.

5. **Start with the POC.** Install @remotion/player today, build one TitleScene with spring animations, and wire it to the WebSocket. The difference in visual quality will be immediately apparent and will validate the entire approach.

---

## Key Package Versions

```json
{
  "remotion": "4.0.432",
  "@remotion/player": "4.0.432",
  "@remotion/transitions": "4.0.432",
  "@remotion/renderer": "4.0.432",
  "@remotion/bundler": "4.0.432",
  "@remotion/cli": "4.0.432"
}
```

All packages must be pinned to the exact same version (no `^` prefix).

---

## Sources

### Remotion Core
- [Remotion Player](https://www.remotion.dev/player) -- @remotion/player overview
- [Player API Reference](https://remotion.dev/docs/player/api) -- Full props, methods, events
- [Brownfield Installation](https://www.remotion.dev/docs/brownfield) -- Adding to existing projects
- [Player Installation](https://www.remotion.dev/docs/player/installation) -- Package setup
- [Sequence API](https://www.remotion.dev/docs/sequence) -- Temporal composition
- [Series API](https://www.remotion.dev/docs/series) -- Sequential playback
- [TransitionSeries](https://www.remotion.dev/docs/transitions/transitionseries) -- Scene transitions
- [@remotion/transitions](https://www.remotion.dev/docs/transitions/) -- Transition overview
- [Transitions Guide](https://www.remotion.dev/docs/transitioning) -- How transitions work

### Remotion Animation
- [spring() API](https://www.remotion.dev/docs/spring) -- Physics-based animation
- [interpolate() API](https://www.remotion.dev/docs/interpolate) -- Value mapping
- [Animating Properties](https://www.remotion.dev/docs/animating-properties) -- Animation guide

### Remotion Data & AI
- [Parameterized Rendering](https://www.remotion.dev/docs/parameterized-rendering) -- Data-driven videos
- [calculateMetadata()](https://www.remotion.dev/docs/calculate-metadata) -- Dynamic metadata
- [Building with Remotion and AI](https://www.remotion.dev/docs/ai/) -- AI integration overview
- [Remotion System Prompt](https://www.remotion.dev/docs/ai/system-prompt) -- LLM teaching prompt
- [AI SaaS Template](https://www.remotion.dev/docs/ai/ai-saas-template) -- Starter kit
- [Claude Code + Remotion](https://www.remotion.dev/docs/ai/claude-code) -- Claude workflow

### Remotion Rendering
- [@remotion/renderer](https://www.remotion.dev/docs/renderer) -- Server-side rendering
- [renderMedia()](https://www.remotion.dev/docs/renderer/render-media) -- Video output API
- [SSR Guide](https://www.remotion.dev/docs/ssr-node) -- Node.js rendering

### Alternative Libraries
- [Motion Canvas](https://motioncanvas.io/) -- Canvas-based animation
- [Revideo](https://re.video/blog/fork) -- Motion Canvas fork for video generation
- [Theatre.js](https://www.theatrejs.com) -- Keyframe animation toolbox
- [Motion (Framer Motion)](https://motion.dev) -- React animation library
- [GSAP](https://gsap.com/) -- Professional JavaScript animation
- [Lottie](https://lottie.airbnb.tech/) -- After Effects animation format

### Template Patterns
- [CasparCG HTML Template Guide](https://chrisryanouellette.gitbook.io/casparcg-html-template-guide) -- Broadcast graphics templates
- [MOGRT Guide](https://blog.frame.io/2024/08/12/mogrt-guide-after-effects-2024-motion-graphics-workflow/) -- Motion Graphics Templates
- [Canva Autofill Guide](https://www.canva.dev/docs/connect/autofill-guide/) -- Parameterized design templates
- [Remotion Templates (Community)](https://github.com/reactvideoeditor/remotion-templates) -- Free template collection
- [Remotion Starter Templates](https://www.remotion.dev/templates/) -- Official templates
- [JSON2Video](https://json2video.com/) -- JSON-to-video API
- [Shotstack](https://shotstack.io/) -- Video editing API
- [Creatomate](https://creatomate.com/) -- Video generation API

### Declarative Approaches
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber) -- Declarative 3D
- [Vega-Lite](https://vega.github.io/vega-lite/) -- Declarative visualization grammar
- [Vidstack + Remotion](https://vidstack.io/docs/player/api/providers/remotion/) -- Player integration
