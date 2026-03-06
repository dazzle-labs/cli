# Content Specification Formats for AI Agent Video Streams

Research into declarative formats, protocols, and tools for composing visual streams from structured data -- specifically for a platform where AI agents broadcast their work as live video streams driven by tool calls rendered in a Chrome/React sandbox.

---

## Table of Contents

1. [Remotion](#1-remotion)
2. [JSON-Based Video Render Specifications](#2-json-based-video-render-specifications)
3. [React Video Timeline Tools and Declarative Protocols](#3-react-video-timeline-tools-and-declarative-protocols)
3b. [Theatre.js](#3b-theatrejs)
4. [Motion Canvas](#4-motion-canvas)
5. [CasparCG and Smelter](#5-casparcg-and-smelter)
6. [OBS WebSocket Protocol](#6-obs-websocket-protocol)
7. [Lottie and Rive](#7-lottie-and-rive)
8. [Prior Art on LLM-Driven Visual Composition](#8-prior-art-on-llm-driven-visual-composition)
9. [Synthesis: Recommended Architecture](#9-synthesis-recommended-architecture)

---

## 1. Remotion

### What It Is

Remotion is a framework for creating videos programmatically using React. It maps the video timeline onto React's component model: each frame of video is a React render, and the current frame number is passed as context. You write React components and Remotion renders each frame at 30/60fps into an image sequence that gets encoded to MP4/WebM.

### Declarative Model

Remotion's core abstraction is that **a video is a function of frame number**. The key primitives:

- **`<Composition>`**: Top-level declaration of a video. Defines `id`, `width`, `height`, `fps`, `durationInFrames`, and the root `component`. This is the closest thing to a "schema" -- it declares the video's metadata and entry point.

```tsx
<Composition
  id="MyVideo"
  component={MyVideoComponent}
  durationInFrames={300}
  fps={30}
  width={1920}
  height={1080}
  defaultProps={{ title: "Hello World" }}
/>
```

- **`<Sequence>`**: Places a child component at a specific point on the timeline. Has `from` (start frame), `durationInFrames`, and optional `name`/`layout` props. Sequences can nest.

```tsx
<Sequence from={0} durationInFrames={90}>
  <TitleCard text="Introduction" />
</Sequence>
<Sequence from={90} durationInFrames={120}>
  <ChartAnimation data={chartData} />
</Sequence>
```

- **`<AbsoluteFill>`**: A full-screen positioned container for layering. Equivalent to a z-indexed layer.

- **`useCurrentFrame()`**: Hook returning the current frame number (0-indexed). Components use this to compute their state at any point in time.

- **`useVideoConfig()`**: Hook returning fps, width, height, durationInFrames.

- **`interpolate(frame, inputRange, outputRange)`**: Utility for mapping frame numbers to animated values (opacity, position, scale, etc.).

- **`spring({ frame, fps, config })`**: Physics-based spring animation utility.

### Data Model / Serialization

Remotion compositions are React component trees. There is no first-class JSON serialization of a composition, but the structure is highly serializable in principle:

```json
{
  "id": "AgentStream",
  "width": 1920,
  "height": 1080,
  "fps": 30,
  "durationInFrames": 900,
  "sequences": [
    {
      "from": 0,
      "duration": 90,
      "component": "TitleCard",
      "props": { "title": "Agent is researching...", "subtitle": "Step 1 of 5" }
    },
    {
      "from": 90,
      "duration": 150,
      "component": "CodeBlock",
      "props": { "language": "python", "code": "def analyze():\n  ..." }
    },
    {
      "from": 240,
      "duration": 120,
      "component": "ChartReveal",
      "props": { "type": "bar", "data": [10, 20, 30, 40] }
    }
  ]
}
```

This pattern -- a JSON manifest that maps to a `<Composition>` with nested `<Sequence>` elements referencing registered components -- is already how many Remotion projects work with dynamic data. The `@remotion/player` package supports `inputProps` for passing data to compositions at runtime.

### Real-Time Capability

This is Remotion's biggest limitation for our use case:

- **Remotion is designed for offline rendering.** The canonical workflow is: define composition, render all frames, encode to video file. Rendering uses headless Chromium or Rust-based renderer.
- **`@remotion/player`** provides a React-embeddable player that renders compositions in real-time in the browser. It plays back compositions at the target fps, computing each frame on the fly. This IS real-time but designed for preview/playback, not broadcast.
- **`@remotion/lambda`** renders videos in parallel on AWS Lambda. Not real-time.
- There is no built-in concept of a "live" composition that grows over time or responds to external events during playback. The `durationInFrames` is fixed at declaration time.

**Workarounds for real-time use:**
- Use `@remotion/player` in a browser and capture the browser tab (via Chrome's `getDisplayMedia` or a headless Chrome approach) to a stream. The player re-renders on prop changes.
- Wrap Remotion's component model but drive it with a live frame counter and dynamically changing props/sequences. The player supports `inputProps` changes.
- Some community projects have built "live Remotion" by continuously appending sequences and re-rendering the player.

### Component Model

Remotion's component model is just React components. Any React component that reads `useCurrentFrame()` and renders accordingly is a valid Remotion component. This means:

- Full access to React ecosystem (framer-motion for some things, D3 for charts, Three.js for 3D, etc.)
- Components can fetch data, use state, use effects (though rendering expects deterministic output per frame)
- CSS, SVG, Canvas, WebGL all work
- The component catalog is whatever you build

### LLM Compatibility

Remotion's JSX/TSX composition format is extremely well-represented in LLM training data. LLMs can:
- Generate Remotion compositions from descriptions
- Understand and modify Sequence-based timelines
- Work with the interpolate/spring animation primitives
- Map structured data to component props

The JSON serialization pattern above would be very natural for LLM tool calls.

### Assessment for Our Use Case

| Aspect | Rating | Notes |
|--------|--------|-------|
| Declarative model | Excellent | React + Sequences + interpolate is very composable |
| Data-driven | Excellent | Props-driven, dynamic data via inputProps |
| Real-time | Poor-to-Fair | Designed for offline; Player can be abused for real-time |
| React compatibility | Perfect | It IS React |
| LLM-friendliness | Excellent | Well-known in training data, JSON-serializable pattern |
| Component ecosystem | Good | Anything React can render |

**Key insight**: We should adopt Remotion's *conceptual model* (Sequences, frame-based interpolation, component-as-function-of-time) but not necessarily Remotion itself, since we need true real-time streaming rather than offline rendering.

---

## 2. JSON-Based Video Render Specifications

### Shotstack Edit API

Shotstack is a cloud video editing API that accepts a JSON specification for video composition:

```json
{
  "timeline": {
    "tracks": [
      {
        "clips": [
          {
            "asset": {
              "type": "title",
              "text": "Agent Analysis",
              "style": "minimal"
            },
            "start": 0,
            "length": 3,
            "transition": { "in": "fade" }
          },
          {
            "asset": {
              "type": "html",
              "html": "<div>Custom HTML content</div>",
              "css": "div { color: white; }"
            },
            "start": 3,
            "length": 5
          }
        ]
      }
    ]
  },
  "output": {
    "format": "mp4",
    "resolution": "hd"
  }
}
```

**Data model**: Timeline contains tracks (layers). Each track has clips. Each clip has an asset (the content), start time, length, and optional transitions/effects. Assets can be video, image, title, HTML, audio, or Lottie.

**Relevance**: The track/clip/asset model is a clean, JSON-native way to describe layered temporal compositions. Very LLM-friendly. However, Shotstack is a proprietary cloud API for offline rendering.

### Creatomate

Similar to Shotstack. JSON-driven video generation API:

```json
{
  "width": 1920,
  "height": 1080,
  "elements": [
    {
      "type": "text",
      "text": "Hello World",
      "x": "50%",
      "y": "50%",
      "time": 0,
      "duration": 3,
      "animations": [
        { "type": "fade-in", "duration": 0.5 }
      ]
    },
    {
      "type": "shape",
      "shape": "rectangle",
      "fill_color": "#FF0000",
      "time": 1,
      "duration": 4
    }
  ]
}
```

**Data model**: Flat list of elements with temporal placement (time, duration) and spatial placement (x, y, width, height). Each element has a type and type-specific properties plus optional animations.

### JSON2Video

Open-source-ish project for generating videos from JSON. Similar structure: scenes containing elements with timing.

### editframe (now defunct) / FFCreator / Editly

Several other projects have attempted JSON-to-video pipelines:

- **Editly**: CLI for creating videos from JSON spec. Uses FFmpeg under the hood. Supports layers, transitions, custom HTML/React fragments.
- **FFCreator**: Node.js video processing library with a scene/element model.

### Assessment

**Common patterns across all JSON video specs:**

1. **Temporal axis**: `start`/`time` + `duration`/`length` or `from`/`to` frame numbers
2. **Spatial layering**: Tracks/layers with z-order, or explicit z-index
3. **Element types**: A finite catalog (text, image, shape, video, HTML, audio, Lottie)
4. **Animations**: Declared on elements with type + timing (easing, delay, duration)
5. **Transitions**: Between clips or at clip boundaries (fade, slide, wipe)
6. **Global metadata**: Canvas size, fps, total duration, background color

**LLM compatibility**: All of these JSON formats are natural for LLMs to generate. The schema is predictable, the field names are descriptive, and the nesting is shallow.

**Real-time**: None of these are designed for real-time. They are all offline render pipelines.

**Key insight**: The common JSON structure across these tools suggests a natural schema for our tool-call protocol. An agent could emit tool calls like:

```json
{
  "tool": "add_element",
  "params": {
    "type": "chart",
    "data": { "labels": ["A","B","C"], "values": [10,20,30] },
    "position": { "x": "50%", "y": "50%", "width": "80%", "height": "60%" },
    "enter_animation": "fade_up",
    "duration": 10,
    "layer": 2
  }
}
```

---

## 3. React Video Timeline Tools and Declarative Protocols

### Existing Declarative Protocols for Video Composition

There is **no widely-adopted open standard** for declaratively describing video compositions in the way that, say, SVG describes vector graphics or HTML describes documents. The closest things are:

1. **OpenTimelineIO (OTIO)** -- developed by Pixar, adopted by ASWF (Academy Software Foundation). It is a JSON-based interchange format for editorial timelines:

```json
{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "my_timeline",
  "tracks": {
    "OTIO_SCHEMA": "Stack.1",
    "children": [
      {
        "OTIO_SCHEMA": "Track.1",
        "kind": "Video",
        "children": [
          {
            "OTIO_SCHEMA": "Clip.1",
            "name": "shot_01",
            "source_range": {
              "start_time": { "value": 0, "rate": 24 },
              "duration": { "value": 48, "rate": 24 }
            },
            "media_reference": {
              "OTIO_SCHEMA": "ExternalReference.1",
              "target_url": "file:///shot_01.mov"
            }
          }
        ]
      }
    ]
  }
}
```

OTIO is focused on traditional video editing (cuts, transitions between media files). It doesn't model motion graphics, text overlays, or programmatic content generation. Not directly useful, but the temporal model (rational time with rate, Stack for layers, Track for sequences) is well-designed.

2. **MLT XML** -- the format used by Kdenlive, Shotcut, and the MLT multimedia framework. XML-based timeline description. Mature but very traditional-video-editing focused.

3. **AAF / EDL** -- legacy broadcast interchange formats. Not relevant.

4. **Apple Motion / After Effects project formats** -- proprietary, binary or quasi-XML. Not useful as protocols.

### React-Specific Timeline Libraries

- **react-timeline-editor**: A React component for building video editing UIs with timeline tracks. Not a composition format per se, but its internal data model is relevant:

```ts
interface TimelineRow {
  id: string;
  actions: TimelineAction[];
}
interface TimelineAction {
  id: string;
  start: number;
  end: number;
  effectId: string;
  // ... flexible data
}
```

- **FramerMotion / motion**: While not a video tool, its declarative animation model is very relevant. Variants, gestures, layout animations, and the `animate` prop are patterns LLMs know extremely well.

```tsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.5, ease: "easeOut" }}
>
  <ChartComponent data={data} />
</motion.div>
```

### What LLMs Understand Well

Based on training data prevalence, LLMs have strong familiarity with:

1. **CSS animations / keyframes** -- universally understood, can describe complex motion
2. **Framer Motion's declarative API** -- very common in React projects
3. **SVG animation (SMIL)** -- less common but understood
4. **Remotion's Sequence/interpolate** -- well-represented in tutorials and docs
5. **Lottie JSON** -- understood at the schema level but too complex to generate raw
6. **HTML/CSS for layout** -- obviously the most universal

**Key insight**: Rather than adopting an existing protocol, we should design a thin JSON protocol that maps to React concepts LLMs already know: components with props, positioned in a spatial layout with temporal sequencing. The protocol should feel like "JSON that describes a React component tree with timing."

---

## 3b. Theatre.js

### What It Is

Theatre.js is a JavaScript animation sequencer with a visual studio editor, designed for authoring complex, keyframed animations in code. It was built alongside React Three Fiber but works with any JavaScript. The core idea is that animatable properties on "objects" are tracked in a timeline, and the timeline state is serializable JSON.

### Core Model

Theatre.js has two layers:

- **`@theatre/core`**: The runtime. You define a "project," create "sheets" within it, and attach "objects" with animatable properties. The project state (all keyframes, current values) is plain JSON.
- **`@theatre/studio`**: A visual editor overlay that lets you scrub, keyframe, and modify the project state interactively in the browser.

```ts
import { getProject, types } from '@theatre/core';

const proj = getProject('Agent Stream', { state: savedStateJSON });
const sheet = proj.sheet('Scene 1');

// Declare an animatable object
const camera = sheet.object('Camera', {
  position: types.compound({
    x: types.number(0, { range: [-100, 100] }),
    y: types.number(0, { range: [-100, 100] }),
    z: types.number(10, { range: [0, 50] }),
  }),
  fov: types.number(50, { range: [20, 120] }),
});

// Subscribe to animated values
camera.onValuesChange((values) => {
  threeCamera.position.set(values.position.x, values.position.y, values.position.z);
  threeCamera.fov = values.fov;
});

// Play the sequence
sheet.sequence.play({ iterationCount: 1, range: [0, 10] });
```

### Serializable State Format

The project state -- everything Theatre.js needs to reconstruct and play the animation -- is a plain JSON document:

```json
{
  "sheetsById": {
    "Scene 1": {
      "staticOverrides": {
        "byObject": {
          "Camera": {
            "props": {
              "position": { "x": 0, "y": 2, "z": 10 },
              "fov": 50
            }
          }
        }
      },
      "sequence": {
        "subUnitsPerUnit": 600,
        "length": 10,
        "tracksByObject": {
          "Camera": {
            "trackIdByPropPath": {
              "position.z": "track_abc",
              "fov": "track_def"
            },
            "trackData": {
              "track_abc": {
                "type": "BasicKeyframedTrack",
                "keyframes": [
                  { "id": "kf_1", "position": 0, "connectedRight": true, "handles": [0.5, 1, 0.5, 0], "value": 10 },
                  { "id": "kf_2", "position": 300, "connectedRight": true, "handles": [0.5, 1, 0.5, 0], "value": 5 },
                  { "id": "kf_3", "position": 600, "connectedRight": false, "handles": [0.5, 1, 0.5, 0], "value": 8 }
                ]
              }
            }
          }
        }
      }
    }
  }
}
```

`subUnitsPerUnit` is the number of internal "ticks" per second (600 = 600 ticks/sec). `position` in keyframes is ticks. Handles are bezier control points in [0,1] normalized space. The format is complete: given this JSON plus the object declarations, Theatre.js can reconstruct and play the animation exactly.

### Live Editing

Theatre.js is unique among animation tools in that its state is live-editable. The studio overlay lets you modify keyframes while the animation plays. This is implemented by the studio writing to the project state JSON and the runtime subscribing to changes. The pattern is directly applicable: if an agent can write Theatre.js project state JSON, the renderer can pick up changes in real time.

```ts
// The studio emits state changes you can persist
studio.onStateChange((newState) => {
  // save to database or send to renderer
  saveState(newState);
});

// The runtime loads state and reacts to updates
const proj = getProject('Agent Stream', { state: currentState });
```

### React Three Fiber Integration

Theatre.js's primary ecosystem is R3F (React Three Fiber), through the `@theatre/r3f` package:

```tsx
import { editable as e, SheetProvider } from '@theatre/r3f';

function Scene() {
  return (
    <SheetProvider sheet={sheet}>
      <e.mesh theatreKey="Hero Mesh" position={[0, 0, 0]}>
        <boxGeometry />
        <meshStandardMaterial color="orange" />
      </e.mesh>
      <e.pointLight theatreKey="Key Light" intensity={1} />
    </SheetProvider>
  );
}
```

The `theatreKey` prop registers the 3D object's transform properties with Theatre.js's timeline. Every property (position, rotation, scale, material color) becomes animatable.

### Assessment for Our Use Case

**What Theatre.js gets right:**
- Its project state is fully serializable JSON -- this is the closest any animation tool comes to a "dual representation." The same JSON that drives the renderer is readable by another agent as a description of current visual state.
- Live state mutation works: the runtime subscribes to state changes, so updating the JSON updates the visual output in real time.
- The `onValuesChange` subscriber pattern maps cleanly to a React state store -- each Theatre.js object can drive a piece of React state.

**What Theatre.js gets wrong for this use case:**
- The state format is too low-level for LLM generation. Bezier handles, subunit-based timing, and numeric track IDs are implementation details an LLM should not need to express. An LLM would need to compute `position` in ticks: "5 seconds in = 5 × 600 = 3000 ticks."
- It is animation-centric, not content-centric. It describes how values change over time, not what the user is looking at. A Theatre.js project state doesn't tell you "there is a breaking news headline on screen" -- it tells you that an object's `opacity` property is at value `1.0` at tick `1200`.
- The catalog of animated objects is whatever you declare. There is no standard set of broadcast content components.
- Theatre.js requires the animated objects to be declared up-front in code. An agent cannot introduce a new object type at runtime without code changes.

**Verdict**: Theatre.js is compelling infrastructure for the renderer's internal animation system (driving property transitions, coordinating complex multi-element animations), but is not the right format for the agent-facing protocol layer. Agents should express intent ("show breaking news headline"), not animation state ("set opacity track to 1.0 at tick 600"). Theatre.js would live below the component catalog, not above it.

| Aspect | Rating | Notes |
|--------|--------|-------|
| Declarative model | Good | JSON state is clean and complete |
| Data-driven | Fair | Objects must be pre-declared; not content-semantic |
| Real-time | Excellent | Live state mutation propagates instantly |
| LLM-friendliness | Poor | Tick arithmetic, bezier handles, non-semantic format |
| Dual representation | Partial | State is serializable but not content-semantic |
| Streaming | N/A | Renderer agnostic; depends on what renders it |

---

## 4. Motion Canvas

### What It Is

Motion Canvas is an open-source library for creating animated videos using TypeScript/JavaScript. It uses a generator-function-based model for describing animations imperatively with precise timing control.

### Core Model

Unlike Remotion's "component as function of frame," Motion Canvas uses **scenes** containing **nodes** that are animated through **generator functions**:

```tsx
export default makeScene2D(function* (view) {
  const circle = createRef<Circle>();

  view.add(
    <Circle
      ref={circle}
      size={100}
      fill="#ff0000"
    />
  );

  // Animate the circle
  yield* circle().position.x(300, 1);  // move x to 300 over 1 second
  yield* circle().fill('#0000ff', 0.5); // change color over 0.5s
  yield* waitFor(1);
  yield* circle().size(200, 0.5);      // grow over 0.5s
});
```

Key concepts:

- **Scenes**: Top-level units of animation. A video is a sequence of scenes.
- **Nodes**: Visual elements (Circle, Rect, Text, Image, Line, Layout, etc.) in a scene graph.
- **Signals**: Reactive values that can be animated. Every property of a node is a signal.
- **Generator functions**: The `yield*` pattern provides sequential timing control. Animations are awaited via yield.
- **`all()`, `chain()`, `sequence()`**: Combinators for parallel, sequential, and staggered animation timing.

```tsx
// Parallel animations
yield* all(
  circle().position.x(300, 1),
  circle().opacity(0, 1),
);

// Staggered sequence
yield* sequence(0.1,
  ...items.map(item => item.opacity(1, 0.3))
);
```

### Data Model

Motion Canvas uses a scene graph of typed nodes. The node types form a catalog:

- **Layout nodes**: Layout, Node, View2D
- **Shape nodes**: Circle, Rect, Line, Polygon, Spline, Bezier
- **Content nodes**: Text, Code (with syntax highlighting), Image, Video
- **Utility**: Gradient, Pattern, Camera

Each node has strongly-typed properties (position, rotation, scale, opacity, fill, stroke, etc.) that are all animatable signals.

### Comparison to Remotion

| Aspect | Remotion | Motion Canvas |
|--------|----------|---------------|
| Language | React/TSX | TypeScript (custom JSX) |
| Mental model | Declarative (frame function) | Imperative (generator timeline) |
| Animation | interpolate(frame) -- you compute | yield* signal(value, duration) -- automatic tweening |
| Scene graph | DOM (HTML/CSS/SVG) | Custom 2D canvas renderer |
| Ecosystem | Full React ecosystem | Limited to built-in nodes |
| Real-time | Via Player in browser | Editor preview; offline render |
| Data-driven | Easy (props) | Possible but less natural |
| LLM friendliness | High (React patterns) | Medium (generator pattern less common) |

### Real-Time Capability

Motion Canvas is designed for offline rendering (renders to canvas, exports frames). Its editor provides real-time preview. Not designed for live streaming.

### Assessment for Our Use Case

Motion Canvas has excellent **animation primitives** (the signal-based tweening, combinators like `all()`/`sequence()`, the typed node catalog). However:

- Its imperative generator model is harder to serialize as JSON tool calls than Remotion's declarative model
- Its custom renderer means we lose access to the React/HTML ecosystem
- LLMs are less fluent with generator-based animation patterns

**Key insight**: Borrow Motion Canvas's animation combinators and node catalog concepts, but implement them in a React/declarative context. The idea of `sequence(0.1, ...items)` for staggered reveals is extremely useful for agent stream visuals.

---

## 5. CasparCG and Smelter

### CasparCG

CasparCG is an open-source broadcast graphics server, widely used in live TV production. It plays graphics templates, video clips, and image sequences on SDI/NDI outputs for broadcast mixing.

**Architecture:**
- Server process that manages "channels" (output pipelines)
- Each channel has multiple "layers" (z-ordered compositing slots)
- Graphics are rendered via a built-in Chromium (CEF) instance for HTML templates
- Controlled via AMCP (Advanced Media Control Protocol) over TCP

**AMCP Protocol:**

```
CG 1-1 ADD 0 "my_template" 1 "<templateData><componentData id='title'><data id='text' value='Breaking News'/></componentData></templateData>"
CG 1-1 UPDATE 0 "<templateData><componentData id='title'><data id='text' value='Updated Title'/></componentData></templateData>"
CG 1-1 NEXT 0
CG 1-1 REMOVE 0
PLAY 1-2 "video_clip" LOOP
MIXER 1-1 OPACITY 0.8 25 EASEINSINE
```

Commands address channel-layer pairs (e.g., `1-1` = channel 1, layer 1). The template data is XML by convention.

**Data model:**
- **Channels**: Output pipelines (think: one per stream destination)
- **Layers**: Numbered z-ordered slots within a channel (0-9999)
- **Templates**: HTML/CSS/JS bundles that accept data via an `update()` function
- **MIXER transforms**: Position, scale, rotation, opacity, brightness, etc. applied per-layer

**HTML Template API:**

```js
// CasparCG calls these functions on the template:
function update(data) {
  // data is parsed XML/JSON with template fields
  document.getElementById('title').textContent = data.title;
}
function play() { /* start entrance animation */ }
function stop() { /* start exit animation */ }
function next() { /* advance to next state */ }
```

### Smelter (formerly LiveCompositor / Video Compositor)

Smelter is a newer open-source project (by Software Mansion) for real-time video/audio composition. It is explicitly designed for programmatic live video mixing.

**Architecture:**
- Standalone server process or embedded library
- Receives video/audio inputs via RTP streams
- Composes outputs based on a **scene description** sent via HTTP/WebSocket API
- Outputs composed video via RTP, can feed into ffmpeg/OBS/etc.
- Uses GPU-accelerated rendering (wgpu)

**Scene Description Model:**

Smelter uses a **React-like component tree** to describe the scene, sent as JSON:

```json
{
  "type": "view",
  "children": [
    {
      "type": "rescaler",
      "child": {
        "type": "input_stream",
        "input_id": "camera_1"
      },
      "width": 960,
      "height": 540,
      "top": 0,
      "left": 0
    },
    {
      "type": "text",
      "content": "Agent is analyzing data...",
      "font_size": 32,
      "color_rgba": "#FFFFFFFF",
      "top": 500,
      "left": 50
    },
    {
      "type": "image",
      "image_id": "logo",
      "width": 100,
      "height": 100,
      "top": 20,
      "right": 20
    },
    {
      "type": "shader",
      "shader_id": "blur_shader",
      "children": [ ... ]
    }
  ]
}
```

Scenes are updated by POSTing new scene descriptions. The compositor diffs the old and new scenes and transitions between them.

**Component types:**
- `view`: Container with layout (similar to flexbox)
- `input_stream`: An incoming video feed
- `text`: Rendered text
- `image`: Static image
- `web_view`: Embedded Chromium instance (renders HTML)
- `shader`: Custom GPU shader effects
- `rescaler`: Resize/position child content
- `tiles`: Grid layout

**Transitions:**

```json
{
  "type": "view",
  "transition": {
    "duration_ms": 500,
    "easing_function": { "type": "cubic_bezier", "points": [0.4, 0, 0.2, 1] }
  },
  "children": [ ... ]
}
```

### Assessment

**CasparCG patterns worth borrowing:**
- Layer-based composition with numbered z-order
- Template lifecycle: `play()` / `update(data)` / `stop()` / `next()` is a clean state machine for graphic elements
- MIXER transforms applied externally to template layers (compositor-level vs template-level animation)

**Smelter patterns worth borrowing:**
- JSON scene description that looks like a React component tree
- Declarative updates: send the desired state, compositor handles transitions
- The `web_view` component type -- embedding a Chromium instance as a compositor node
- Transition specifications at the component level

**Smelter is highly relevant.** Its model of "send JSON scene descriptions to a compositor that handles rendering and transitions" is almost exactly what we want for the agent-to-renderer protocol.

| Aspect | CasparCG | Smelter |
|--------|----------|---------|
| Data model | Channels/layers/templates | React-like component tree |
| Protocol | AMCP (text over TCP) | HTTP/WebSocket JSON |
| Real-time | Yes (broadcast production) | Yes (designed for it) |
| HTML/React | CEF templates | web_view component |
| LLM-friendliness | Poor (XML template data, arcane AMCP) | Good (JSON component tree) |
| Maturity | Very mature (15+ years) | Young (2023-2024) |

**Key insight**: Smelter's scene description model -- a JSON component tree with layout, transitions, and input sources -- is the closest existing art to what we need. We could either use Smelter directly as our compositor or adopt its scene description pattern for our own React-based renderer.

---

## 6. OBS WebSocket Protocol

### What It Is

OBS Studio (Open Broadcaster Software) has a WebSocket-based remote control protocol (obs-websocket, built-in since OBS 28+). It allows external programs to control OBS: switch scenes, modify sources, change settings, etc.

### Scene Composition Model

OBS's internal model:

- **Scene Collection**: A set of scenes (like a project)
- **Scene**: A composited view containing sources. One scene is active (live) at a time.
- **Source**: A content provider (display capture, window capture, browser source, image, video, text, etc.)
- **Scene Item**: A source placed in a scene with transform properties (position, scale, rotation, crop, alignment, blend mode)
- **Filters**: Effects applied to sources or scenes (color correction, chroma key, blur, etc.)
- **Transitions**: Effects when switching between scenes (fade, cut, stinger, etc.)

### WebSocket Protocol (v5)

The protocol uses JSON over WebSocket with request/response and event patterns:

```json
// Get scene list
{ "op": 6, "d": { "requestType": "GetSceneList", "requestId": "1" } }

// Create a new source/scene item
{
  "op": 6,
  "d": {
    "requestType": "CreateInput",
    "requestId": "2",
    "requestData": {
      "sceneName": "Agent Stream",
      "inputName": "Code Display",
      "inputKind": "browser_source",
      "inputSettings": {
        "url": "http://localhost:3000/code-panel",
        "width": 800,
        "height": 600
      }
    }
  }
}

// Set transform of a scene item
{
  "op": 6,
  "d": {
    "requestType": "SetSceneItemTransform",
    "requestId": "3",
    "requestData": {
      "sceneName": "Agent Stream",
      "sceneItemId": 42,
      "sceneItemTransform": {
        "positionX": 100,
        "positionY": 50,
        "scaleX": 1.5,
        "scaleY": 1.5,
        "rotation": 0,
        "cropLeft": 0,
        "cropRight": 0,
        "cropTop": 0,
        "cropBottom": 0
      }
    }
  }
}

// Switch scenes (with transition)
{
  "op": 6,
  "d": {
    "requestType": "SetCurrentProgramScene",
    "requestId": "4",
    "requestData": {
      "sceneName": "Chart Display"
    }
  }
}
```

### Key Source Types (inputKind)

- `browser_source`: Renders a URL in embedded Chromium. **This is the most important one** -- it's how most OBS overlays work. The browser source can load any web page, including React apps.
- `text_gdiplus` / `text_ft2_source`: Text rendering
- `image_source`: Static images
- `ffmpeg_source`: Video/audio files
- `window_capture` / `display_capture`: Screen capture
- `color_source`: Solid color background

### Relevant Patterns

1. **Scene-as-preset**: OBS treats scenes as pre-composed layouts that you switch between. This is a "state machine" model rather than a continuous timeline model. Good for "modes" (e.g., coding mode, chart mode, discussion mode).

2. **Browser source as escape hatch**: The pattern of embedding a web page as a source means OBS users already compose complex graphics via HTML/React rendered in browser sources. Our entire React sandbox could be a single OBS browser source.

3. **Transform model**: The transform properties (position, scale, rotation, crop) applied to scene items are a simple, proven model for spatial composition.

4. **Batch requests**: OBS WebSocket supports `RequestBatch` for sending multiple requests atomically, which prevents flickering from partial scene updates.

```json
{
  "op": 8,
  "d": {
    "requestId": "batch1",
    "executionType": 0,  // SerialRealtime
    "requests": [
      { "requestType": "SetSceneItemTransform", ... },
      { "requestType": "SetInputSettings", ... }
    ]
  }
}
```

5. **Event subscription**: OBS emits events for scene changes, source state changes, etc. Useful for monitoring.

### Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| Data model | Simple | Scenes with positioned sources, transform properties |
| Protocol | Good | JSON WebSocket, well-documented |
| Real-time | Excellent | Designed for live broadcasting |
| React compatibility | Via browser source | OBS renders a URL in Chromium |
| LLM-friendliness | Fair | The protocol is procedural (commands), not declarative (scene descriptions) |
| Composition power | Limited | No animation primitives, no timeline, no transitions on individual elements |

**Key insight**: OBS's model is too coarse for our needs (scene-level switching rather than element-level composition), but two patterns are valuable:

1. The **browser source** pattern confirms our architecture: render everything in a web page and capture/stream it.
2. The **batch update** pattern for atomic scene changes is important to prevent visual glitches.

In practice, our system would likely run OBS (or a headless equivalent) with a single browser source pointing at our React sandbox. OBS handles the streaming; our React app handles the composition.

---

## 7. Lottie and Rive

### Lottie

**What it is**: Lottie is a JSON-based animation format originally designed to export After Effects animations for playback in web/mobile apps. The Bodymovin plugin for After Effects exports to Lottie JSON.

**Format structure** (simplified):

```json
{
  "v": "5.7.4",          // version
  "fr": 30,              // frame rate
  "ip": 0,               // in point (start frame)
  "op": 90,              // out point (end frame)
  "w": 1920,             // width
  "h": 1080,             // height
  "layers": [
    {
      "ty": 4,           // shape layer
      "nm": "Circle",
      "ip": 0,
      "op": 90,
      "ks": {            // transform
        "o": { "a": 1, "k": [   // opacity (animated)
          { "t": 0, "s": [0] },
          { "t": 30, "s": [100] }
        ]},
        "p": { "a": 0, "k": [960, 540] },  // position (static)
        "s": { "a": 0, "k": [100, 100] }   // scale (static)
      },
      "shapes": [ ... ]
    },
    {
      "ty": 5,           // text layer
      "nm": "Title",
      "t": {
        "d": {
          "k": [{ "s": { "s": 48, "f": "Arial", "t": "Hello World" } }]
        }
      }
    }
  ]
}
```

**Key characteristics:**
- Frame-based timing model
- Layer-based composition (types: shape, text, image, precomp, solid, null)
- Every property can be animated via keyframe arrays with bezier easing
- Shape model: groups of paths, fills, strokes, transforms
- Precompositions: nested compositions for reuse
- Expression support (limited in web player)

**Web players:**
- `lottie-web` (airbnb) -- renders to SVG, Canvas, or HTML
- `@lottiefiles/react-lottie-player` -- React wrapper
- `@dotlottie/react-player` -- for .lottie container format

**Dynamic text/data:**
- Lottie supports text layers that can be updated at runtime
- Some players support dynamic property overrides

**Limitations:**
- The raw JSON is far too complex for LLMs to generate directly (thousands of lines for simple animations)
- Designed for pre-authored animations, not programmatic generation
- No layout system (everything is absolute positioning with pixel values from After Effects)
- Not suitable for data-driven content (charts, code blocks, etc.)

### Rive

**What it is**: Rive is a newer animation tool and runtime. Animations are authored in the Rive editor and exported as `.riv` binary files. Rive has a custom renderer (C++/Rust based) with web, iOS, Android, Flutter runtimes.

**Key differentiator**: Rive supports **State Machines** -- animations respond to inputs (boolean, number, trigger) and transition between states. This makes Rive animations interactive.

```tsx
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';

function StatusIndicator({ isActive }) {
  const { rive, RiveComponent } = useRive({
    src: 'status.riv',
    stateMachines: 'main',
    autoplay: true,
  });

  const activeInput = useStateMachineInput(rive, 'main', 'isActive');

  useEffect(() => {
    if (activeInput) activeInput.value = isActive;
  }, [isActive]);

  return <RiveComponent />;
}
```

**State machine model:**

```
States: idle, loading, success, error
Inputs: progress (number), isComplete (boolean), trigger_error (trigger)
Transitions: idle -> loading (on progress > 0)
             loading -> success (on isComplete == true)
             loading -> error (on trigger_error)
```

**Advantages over Lottie:**
- State machines enable reactive, data-driven animations
- Smaller file sizes (binary format)
- Better performance (custom renderer vs DOM-based)
- Mix of procedural and authored animation

**Limitations:**
- Binary format -- not human-readable or LLM-generatable
- Requires Rive editor for authoring
- Smaller ecosystem than Lottie

### Assessment for Component Catalog

Both Lottie and Rive are excellent for **pre-built animation components** in our catalog:

| Use Case | Format | Rationale |
|----------|--------|-----------|
| Animated transitions (wipes, reveals) | Lottie | Large library of free animations (LottieFiles) |
| Animated icons/indicators | Rive | State machine support for reactive states |
| Loading spinners, progress bars | Rive | Data-bindable via state machine inputs |
| Decorative motion graphics (backgrounds, particles) | Lottie | Huge existing library |
| Interactive UI elements | Rive | State machines respond to data changes |

**They are NOT suitable as the primary composition format** -- they are pre-authored component types that slot into our composition system.

**Integration pattern:**

```json
{
  "type": "lottie",
  "src": "animations/chart-reveal.json",
  "position": { "x": 100, "y": 200 },
  "size": { "width": 800, "height": 400 },
  "playback": { "speed": 1, "direction": "forward" },
  "data_overrides": {
    "title_text": "Q4 Revenue"
  }
}
```

```json
{
  "type": "rive",
  "src": "components/status-indicator.riv",
  "state_machine": "main",
  "inputs": {
    "progress": 0.75,
    "status": "active",
    "label": "Processing..."
  }
}
```

**Key insight**: Lottie and Rive are component-level formats, not composition-level formats. They belong in our component catalog as pre-built animated elements that agents can reference and parameterize. An agent doesn't generate Lottie JSON; it says "play the chart-reveal animation with this data."

---

## 8. Prior Art on LLM-Driven Visual Composition

### Direct Prior Art

#### Vercel v0 / AI-Generated UI

Vercel's v0 generates React components from text descriptions. While not video-focused, it demonstrates LLMs generating visual compositions via React/JSX/Tailwind. The pattern of "LLM outputs structured code/markup that renders to visual output" is directly applicable.

**Relevant pattern**: The LLM generates React component trees (or JSON that maps to them). A rendering environment interprets and displays them.

#### GPT-4 + DALL-E / Midjourney for Thumbnails

Multiple projects use LLMs to generate image generation prompts, compose them into layouts, and add text overlays. The LLM acts as an art director, specifying composition through structured data.

#### Cursor / Windsurf IDE Streaming

AI coding assistants stream their work in real-time (code diffs, terminal output, file changes). While not video composition per se, the pattern of "stream structured tool calls that get rendered into a visual UI in real-time" is identical to our use case.

#### LiveKit Agents + Real-Time Video

LiveKit's agent framework allows AI agents to participate in real-time video sessions. Agents can send video frames and audio. Some implementations render agent output (text, visualizations) as video frames:

```python
# LiveKit agent pattern
async def agent_task(ctx: JobContext):
    # Agent generates visual content
    frame = render_visualization(agent_output)
    # Push frame to video track
    await video_source.capture_frame(frame)
```

#### StreamPot / Mux + AI

Some projects combine video APIs (Mux, Cloudflare Stream) with LLM-generated metadata for automated video creation. Typically offline (generate spec, render video, upload), not live.

#### HeyGen / Synthesia / D-ID (AI Avatars)

AI avatar platforms where a text/audio stream is rendered into a video of a virtual presenter. Real-time variants exist. Relevant as examples of "structured data in, video stream out."

#### Restream / StreamYard Overlays

Live streaming platforms that support HTML/CSS overlays and API-driven updates. Streamers already use bots (Nightbot, StreamElements) to trigger graphic overlays via chat commands -- a primitive version of our concept.

### Architectural Patterns in Prior Art

**Pattern 1: Scene Graph + Updates**
```
Agent -> JSON scene description -> Renderer -> Video stream
       (add/update/remove elements)
```
The agent maintains a logical scene and sends incremental updates. The renderer maintains the visual state and handles animations. This is the Smelter model.

**Pattern 2: Command Stream**
```
Agent -> Stream of tool calls -> Command interpreter -> React components -> Capture -> Stream
       (show_chart, add_text, animate_transition, etc.)
```
The agent sends a sequence of high-level commands. An interpreter maps them to React component operations. This is more like our envisioned architecture.

**Pattern 3: Template + Data**
```
Agent -> Template ID + data -> Template engine -> Rendered template -> Stream
       (e.g., "chart_template" + {data: [1,2,3]})
```
CasparCG's model. The agent picks from pre-built templates and fills in data. Simple but limited.

**Pattern 4: Code Generation**
```
Agent -> React/JSX code -> Sandboxed execution -> Rendered output -> Stream
```
The agent generates actual code (like v0). Most flexible but riskiest and hardest to control.

### What's Missing (Our Opportunity)

Nobody has built a complete system where:
1. An AI agent performs real work (coding, research, analysis)
2. Its structured tool calls are the source of truth
3. Those tool calls are rendered as motion graphics in real-time
4. The result is a live broadcast stream

The closest things are:
- Twitch "coding streams" where AI assistants are visible (but the composition is manual)
- AI avatar platforms (real-time but just talking heads, not work visualization)
- Automated video generation (composition from data but not real-time, not live)

**Key insight**: We are building something genuinely novel. The tool-call-to-motion-graphics pipeline does not have direct prior art. But we can assemble proven patterns: Smelter's scene description model, Remotion's component concepts, OBS's streaming infrastructure, and Lottie/Rive pre-built animations.

---

## 9. Synthesis: Recommended Architecture

### The Protocol: Agent Tool Calls -> Scene Description -> React Renderer -> Stream

Based on this research, here is the recommended content specification format:

### Layer 1: Agent Tool Call Protocol

Agents emit tool calls. Each tool call maps to a visual operation. The tool call schema should be the thinnest possible layer:

```typescript
// The complete set of visual tool calls an agent can make
type VisualToolCall =
  | { tool: "scene.set_layout", params: LayoutParams }
  | { tool: "scene.add", params: AddElementParams }
  | { tool: "scene.update", params: UpdateElementParams }
  | { tool: "scene.remove", params: RemoveElementParams }
  | { tool: "scene.transition", params: TransitionParams }
  | { tool: "scene.batch", params: { operations: VisualToolCall[] } }
```

Example tool calls from an agent:

```json
{ "tool": "scene.set_layout", "params": {
    "template": "split-panel",
    "config": { "left_ratio": 0.6 }
}}

{ "tool": "scene.add", "params": {
    "id": "code-editor",
    "component": "CodeBlock",
    "props": { "language": "python", "code": "def hello():\n  print('world')", "highlight_lines": [2] },
    "slot": "left",
    "enter": { "animation": "fade_up", "duration": 500, "easing": "ease-out" }
}}

{ "tool": "scene.add", "params": {
    "id": "status-bar",
    "component": "StatusBar",
    "props": { "agent_name": "Researcher", "step": "3/7", "status": "analyzing" },
    "slot": "bottom",
    "enter": { "animation": "slide_up", "duration": 300 }
}}

{ "tool": "scene.update", "params": {
    "id": "code-editor",
    "props": { "code": "def hello():\n  print('hello world')", "highlight_lines": [2] },
    "transition": { "type": "morph", "duration": 400 }
}}

{ "tool": "scene.remove", "params": {
    "id": "code-editor",
    "exit": { "animation": "fade_out", "duration": 300 }
}}
```

### Layer 2: Scene State (Intermediate Representation)

Tool calls are reduced into a scene state object -- the single source of truth for what is on screen:

```typescript
interface SceneState {
  layout: {
    template: string;          // "split-panel" | "full" | "grid" | "pip" | "stack"
    config: Record<string, any>;
  };
  elements: Map<string, SceneElement>;
  transitions: ActiveTransition[];
}

interface SceneElement {
  id: string;
  component: string;           // registered component name
  props: Record<string, any>;  // component-specific props
  slot: string;                // layout slot assignment
  layer: number;               // z-order within slot
  transform?: {                // optional overrides
    x?: number | string;
    y?: number | string;
    width?: number | string;
    height?: number | string;
    scale?: number;
    rotation?: number;
    opacity?: number;
  };
  state: "entering" | "visible" | "updating" | "exiting";
}
```

This is conceptually similar to Smelter's scene description, but specialized for our use case.

### Layer 3: React Component Catalog

Pre-registered components that the agent can reference by name:

```typescript
const COMPONENT_CATALOG = {
  // Content display
  "CodeBlock":      CodeBlockComponent,       // Syntax-highlighted code with line numbers
  "Terminal":       TerminalComponent,         // Terminal output with typing effect
  "Markdown":       MarkdownComponent,         // Rendered markdown
  "Browser":        BrowserComponent,          // Mini browser frame

  // Data visualization
  "BarChart":       BarChartComponent,         // Animated bar chart
  "LineChart":      LineChartComponent,        // Animated line chart
  "PieChart":       PieChartComponent,         // Animated pie chart
  "Table":          TableComponent,            // Data table with transitions
  "MetricCard":     MetricCardComponent,       // Big number with label

  // Media
  "Image":          ImageComponent,            // Image with pan/zoom
  "LottieAnimation": LottieComponent,         // Lottie JSON player
  "RiveAnimation":  RiveComponent,             // Rive state machine

  // Typography
  "Title":          TitleComponent,            // Large heading text
  "Subtitle":       SubtitleComponent,         // Secondary text
  "Caption":        CaptionComponent,          // Small text / attribution
  "Quote":          QuoteComponent,            // Stylized quote block

  // Agent status
  "StatusBar":      StatusBarComponent,        // Agent name, step, status
  "ProgressRing":   ProgressRingComponent,     // Circular progress indicator
  "ToolCallLog":    ToolCallLogComponent,      // Scrolling log of recent tool calls
  "ThinkingBubble": ThinkingBubbleComponent,   // Agent's current thinking

  // Layout / decorative
  "Divider":        DividerComponent,          // Animated divider line
  "Background":     BackgroundComponent,       // Gradient, pattern, or image background
  "Watermark":      WatermarkComponent,        // Corner watermark / branding
  "ParticleField":  ParticleFieldComponent,    // Decorative particle animation
};
```

Each component is a React component that:
1. Accepts typed `props` for data
2. Handles its own enter/update/exit animations (via framer-motion or CSS)
3. Renders responsively within its allocated slot dimensions
4. Optionally exposes animation timing for coordination

### Layer 4: Layout Templates

Pre-defined spatial arrangements (inspired by OBS scenes but more flexible):

```typescript
const LAYOUT_TEMPLATES = {
  "full":        { slots: ["main"] },
  "split-panel": { slots: ["left", "right"], config: { left_ratio: 0.5 } },
  "triple":      { slots: ["left", "center", "right"] },
  "main-sidebar":{ slots: ["main", "sidebar"], config: { sidebar_width: 350 } },
  "grid":        { slots: ["tl", "tr", "bl", "br"] },
  "pip":         { slots: ["main", "pip"], config: { pip_position: "top-right", pip_size: 0.25 } },
  "stack":       { slots: ["main", "bottom"], config: { bottom_height: 120 } },
  "presenter":   { slots: ["content", "avatar", "lower_third"] },
};
```

Layouts handle spatial arrangement; components handle content; the protocol connects them.

### Why This Architecture

| Requirement | How it's met |
|-------------|-------------|
| LLM-friendly tool calls | Shallow JSON, named components, simple operations (add/update/remove) |
| Real-time capable | Scene state is reactive; React handles rendering at 60fps |
| React-based | Components are React components; layout is React; runs in browser |
| Declarative | Agent describes desired state; renderer handles animations/transitions |
| Extensible | New components just register in the catalog |
| Streamable | Browser tab captured to RTMP via OBS/ffmpeg |
| Serializable | Scene state is plain JSON; can be logged, replayed, debugged |

### What We Borrow From Each Technology

| Technology | What we borrow |
|------------|---------------|
| **Remotion** | Component-as-function-of-props model, Sequence concept for temporal ordering, interpolate patterns |
| **JSON video APIs** (Shotstack, Creatomate) | Track/clip/element JSON schema patterns, animation declaration format |
| **Motion Canvas** | Animation combinators (all, sequence, chain), typed node catalog idea |
| **Theatre.js** | Serializable project state as a full scene snapshot; live state mutation propagating to renderer |
| **Smelter** | JSON scene description posted to renderer, declarative updates with diff-based transitions |
| **CasparCG** | Template lifecycle (play/update/stop/next), layer-based z-ordering |
| **OBS WebSocket** | Batch updates for atomic scene changes, browser source as rendering escape hatch |
| **Lottie** | Pre-built animation components in our catalog (transitions, decorative elements) |
| **Rive** | State-machine-driven animations that respond to data inputs |
| **OTIO** | Rational time representation (value + rate) for frame-accurate timing |

### Dual Representation Evaluation

"The most critical design problem" per the spec. Each surveyed system evaluated against whether the same data that drives the renderer is also machine-readable by another agent.

| Technology | Drives Renderer? | Machine-Readable by Agent? | Semantic Content? | Dual Rep? |
|------------|-----------------|---------------------------|-------------------|-----------|
| Remotion | Yes (JSX props) | Partially (props JSON) | Only if props are semantic | Partial |
| Shotstack/Creatomate JSON | Yes (offline) | Yes (the JSON is the spec) | At element level (type, text, data) | Yes, offline only |
| Motion Canvas | Yes (code) | No (generator functions) | No | No |
| Theatre.js | Yes (project state JSON) | Yes (structured JSON) | No (values not semantic) | Partial |
| Smelter | Yes (scene JSON) | Yes (scene JSON is readable) | Partially (component types help) | Yes |
| CasparCG AMCP | Yes (commands) | No (imperative, not queryable) | No | No |
| OBS WebSocket | Yes (scene items) | Partially (GetSceneItemList) | No (pixel geometry, not content) | No |
| Lottie | Yes (in browser) | Theoretically (slot values) | No (opaque JSON) | No |
| Rive | Yes (state machine) | Yes (input names/values) | Partially (input names are semantic) | Partial |
| **Proposed: Component Catalog** | **Yes (React props)** | **Yes (scene state JSON)** | **Yes (component type + typed props)** | **Yes** |

The proposed architecture achieves dual representation because:
1. The agent writes `{ component: "BreakingAlert", props: { headline: "...", urgency: "high" } }`
2. This drives the React renderer directly
3. Any other agent can read the scene state and understand semantically what is on screen from the component type and props alone, without needing to parse pixel coordinates or bezier curves

### Token Efficiency Analysis

Token cost of expressing "show a bar chart with three data points" in each format:

| Format | Approximate Tokens | Notes |
|--------|--------------------|-------|
| Raw Lottie JSON | 8,000-15,000 | Keyframe arrays, bezier handles, layer metadata |
| Theatre.js project state | 400-800 | Cleaner but still tick-arithmetic and bezier handles |
| OBS WebSocket command | 120-180 | JSON payload but pixel-position-centric |
| Shotstack JSON | 80-120 | Concise but offline-render semantics |
| Smelter scene node | 60-100 | Clean component tree, pixel positions required |
| CasparCG AMCP + XML | 50-80 | Text protocol is compact; XML payload adds back cost |
| **Proposed tool call (JSON)** | **40-70** | Shallow object: component name + typed props |
| **Proposed tool call (YAML)** | **25-45** | ~35% fewer tokens than equivalent JSON |

The proposed format achieves token efficiency through three choices:
1. Named component types replace verbose layout declarations ("BarChart" vs 200 lines of Lottie JSON)
2. Semantic slot names replace pixel coordinates ("left" vs `{"positionX": 960, "positionY": 540}`)
3. Props are data-level (the values an agent naturally has), not rendering-level (what the renderer needs to compute internally)

Plain text / YAML further saves ~30-35% over JSON for the same information. For short tool calls (the 10-tool sweet spot), the difference is minor. For scene state snapshots returned to agents, YAML would meaningfully reduce response token cost.

### Open Questions

1. **Granularity of tool calls**: Should the agent send high-level intents ("show my analysis results") or low-level scene operations ("add chart at position X")? Probably a mix -- high-level "director" tool calls that map to sequences of low-level scene operations.

2. **Animation timing coordination**: When an agent sends multiple tool calls rapidly, how do we queue/overlap animations? Need a scheduler that respects minimum display times and transition durations.

3. **Responsive vs fixed layout**: Should components adapt to available space (responsive) or work in absolute pixel coordinates? Responsive is better for layout templates; absolute is sometimes needed for precise positioning.

4. **State management**: Should the scene state live in the renderer only, or should the agent maintain its own model of what's on screen? If the agent maintains state, it can make smarter composition decisions but needs a feedback mechanism.

5. **Component prop schemas**: Each component needs a well-defined JSON schema for its props so LLMs can generate valid tool calls. These schemas should be provided in the agent's system prompt or tool definitions.

6. **Live data binding**: Some components (charts, metrics) might need to update continuously (e.g., real-time data feeds). Should there be a "data source" concept beyond explicit tool calls?

7. **Audio**: This research focused on visual composition. Audio (TTS for agent narration, sound effects for transitions, background music) needs its own specification layer.

8. **Multi-agent scenes**: When multiple agents collaborate, how are their visual elements composed? Separate slots? Shared canvas? Turn-taking?
