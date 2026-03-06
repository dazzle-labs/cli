# json-render Research

Repo: https://github.com/vercel-labs/json-render
Tagline: "The Generative UI framework."

---

## 1. What Is It?

json-render is an open-source TypeScript/React framework for AI-driven UI generation. The core idea: developers define a **catalog** of allowed components and actions, an LLM generates a **JSON spec** constrained to that catalog, and the renderer turns that spec into live React components in real time. The LLM never outputs arbitrary code — only structured JSON that matches the schema the developer approved.

The framework is not just a JSON-to-React mapper. It has a complete streaming protocol, a dynamic expression system for state binding, a multi-platform renderer architecture, and tight integration with the Vercel AI SDK.

Created January 14, 2026. As of March 3, 2026:
- 11,808 stars, 628 forks, 53 open issues
- 155 commits total, 18 packages in a pnpm/Turborepo monorepo
- Primary author: ctate (Chris Tate, 130 of 155 commits). Notable contributors: Anthony Fu (Vue renderer), David Khourshid (XState integration).
- Active: multiple releases per week in February 2026, reached v0.11.0.
- License: Apache 2.0.

---

## 2. Architecture Overview

Three phases:

### Phase 1 — Catalog Definition (developer-time)

The developer defines what the AI can generate. `defineCatalog()` takes a map of component names to Zod schemas. Each entry declares the valid props for that component plus an optional description for the LLM. The catalog is the contract between the developer and the AI.

The catalog's `.prompt()` method auto-generates a system prompt from the schema. This prompt tells the LLM exactly what JSON format to output, what components exist, what props each accepts, and the streaming wire format to use.

### Phase 2 — AI Generation (runtime, LLM-side)

The LLM receives the generated system prompt. It outputs a stream of JSONL lines, each being an RFC 6902 JSON Patch operation. Each line looks like:

```
{"op":"add","path":"/root","value":"main-card"}
{"op":"add","path":"/elements/main-card","value":{"type":"Card","props":{"title":"Revenue Dashboard"},"children":["metric-1","metric-2"]}}
{"op":"add","path":"/elements/metric-1","value":{"type":"Metric","props":{"label":"Total Revenue","valuePath":"/metrics/revenue","format":"currency"}}}
```

The LLM is instructed to emit `/root` first, then interleave `/elements` and `/state` patches so the UI progressively fills in as tokens stream.

### Phase 3 — Rendering (runtime, React-side)

`createSpecStreamCompiler()` buffers incoming chunks line by line, applies each patch to an accumulating `Spec` object, and returns a new shallow-copy reference on every change so React re-renders incrementally. The `Renderer` component recursively resolves the flat element map into a React tree. Context providers inject state, actions, visibility, and validation capabilities.

---

## 3. The Spec Data Format

The canonical spec format (`Spec`) is a **flat key-value map** — not a nested tree. This is intentional: flat structures are easier for LLMs to patch incrementally.

```typescript
interface Spec {
  root: string;                          // key of the root element
  elements: Record<string, UIElement>;   // flat map, keyed by element key
  state?: Record<string, unknown>;       // optional initial state
}

interface UIElement {
  type: string;                          // catalog component name
  props: Record<string, unknown>;        // component props (may contain expressions)
  children?: string[];                   // ordered list of child element keys
  visible?: VisibilityCondition;         // conditional render
  on?: Record<string, ActionBinding | ActionBinding[]>; // event handlers
  repeat?: { statePath: string; key?: string }; // repeat over a state array
  watch?: Record<string, ActionBinding | ActionBinding[]>; // state watchers
}
```

A concrete example of the JSON a model produces:

```json
{
  "root": "dashboard",
  "elements": {
    "dashboard": {
      "type": "Card",
      "props": { "title": "Revenue Dashboard", "description": null },
      "children": ["metric-revenue", "metric-users"]
    },
    "metric-revenue": {
      "type": "Metric",
      "props": {
        "label": "Total Revenue",
        "valuePath": "/metrics/revenue",
        "format": "currency"
      }
    },
    "metric-users": {
      "type": "Metric",
      "props": {
        "label": "Active Users",
        "valuePath": "/metrics/users",
        "format": "number"
      }
    }
  },
  "state": {
    "metrics": { "revenue": 142500, "users": 3821 }
  }
}
```

The same structure expressed as streaming JSONL patches (what the LLM actually outputs):

```
{"op":"add","path":"/root","value":"dashboard"}
{"op":"add","path":"/elements/dashboard","value":{"type":"Card","props":{"title":"Revenue Dashboard","description":null},"children":["metric-revenue","metric-users"]}}
{"op":"add","path":"/state/metrics","value":{"revenue":142500,"users":3821}}
{"op":"add","path":"/elements/metric-revenue","value":{"type":"Metric","props":{"label":"Total Revenue","valuePath":"/metrics/revenue","format":"currency"}}}
{"op":"add","path":"/elements/metric-users","value":{"type":"Metric","props":{"label":"Active Users","valuePath":"/metrics/users","format":"number"}}}
```

There is also a nested format for human-authored specs. `nestedToFlat()` converts:

```typescript
{
  type: "Card",
  props: { title: "Hello" },
  children: [
    { type: "Text", props: { content: "World" } }
  ],
  state: { count: 0 }
}
// becomes:
{
  root: "el-0",
  elements: {
    "el-0": { type: "Card", props: { title: "Hello" }, children: ["el-1"] },
    "el-1": { type: "Text", props: { content: "World" }, children: [] }
  },
  state: { count: 0 }
}
```

---

## 4. Component Model — Catalog and Registry

Two distinct concepts:

**Catalog** — describes what exists, for the LLM. Pure Zod schemas + descriptions. No React imports. Can be used server-side for prompt generation and spec validation.

```typescript
const catalog = defineCatalog({
  components: {
    Card: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
      }),
      hasChildren: true,
      description: "A container card with a title",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        valuePath: z.string(),
        format: z.enum(["currency", "percent", "number"]),
      }),
    },
  },
  actions: {
    export: { params: z.object({ format: z.string() }) },
  },
});
```

**Registry** — maps catalog names to actual React implementations. Used at render time.

```typescript
const { registry, handlers } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <div className="card">
        <h2>{props.title}</h2>
        {children}
      </div>
    ),
    Metric: ({ props }) => (
      <div className="metric">
        <span>{props.label}</span>
        <span>{props.value}</span>
      </div>
    ),
  },
  actions: {
    export: async (params, setState, state) => {
      await exportData(params.format, state);
    },
  },
});
```

A newer higher-level API (`createRenderer`) collapses catalog + registry into one call and returns a standalone React component.

---

## 5. Dynamic Expression System

Props in a spec are not just literal values. They support a DSL of `$`-prefixed expressions resolved at render time:

| Expression | Meaning |
|---|---|
| `{ "$state": "/path" }` | Read-only bind to state at JSON Pointer path |
| `{ "$bindState": "/path" }` | Two-way bind — resolves to value AND exposes write path |
| `{ "$item": "field" }` | Read field from current repeat item |
| `{ "$bindItem": "field" }` | Two-way bind to field on current repeat item |
| `{ "$index": true }` | Current repeat index |
| `{ "$cond": condition, "$then": val, "$else": val }` | Conditional value |
| `{ "$computed": "fnName", "args": {...} }` | Call registered function |
| `{ "$template": "Hello ${/user/name}!" }` | String interpolation from state |

Visibility conditions (`visible` field) support their own DSL: `$state`, `$item`, `$index` conditions with comparison operators (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`) and logical combinators (`$and`, `$or`, `not`).

Repeat (`repeat` field) iterates over a state array, rendering children once per item with `$item`/`$index`/`$bindItem` in scope.

Watchers (`watch` field) fire action bindings when a state path changes. Enables cascading form dependencies (e.g., country selection triggers city options load).

---

## 6. Streaming Protocol — SpecStream

**Wire format**: JSONL (one RFC 6902 JSON Patch per line). Chosen because:
- Patches are small and complete — each line is self-contained
- The renderer can apply patches and re-render incrementally as tokens arrive
- LLMs emit tokens left-to-right, so line-by-line processing matches the generation order
- The model can be instructed to emit root first, enabling immediate skeleton rendering

**Key implementation**: `createSpecStreamCompiler<T>()` in `@json-render/core`.

```typescript
const compiler = createSpecStreamCompiler<Spec>();

// As HTTP/SSE chunks arrive:
const { result, newPatches } = compiler.push(chunk);
if (newPatches.length > 0) {
  setSpec({ ...result }); // shallow copy triggers React re-render
}
```

The compiler:
1. Maintains an internal string buffer for incomplete lines
2. On each `push()`, splits by `\n`, processes complete lines
3. Parses each line as a JSON Patch and applies it to the accumulating spec
4. Returns `{ result, newPatches }` — only triggers re-renders when patches land
5. Deduplicates lines to handle retransmission edge cases

**Mixed stream support**: `createMixedStreamParser()` handles responses that interleave prose and JSONL patches. The LLM can emit a ```spec``` fence, within which lines are parsed as patches; outside the fence, lines starting with `{` are tested heuristically.

**AI SDK integration**: `createJsonRenderTransform()` is a `TransformStream` that pipes into the Vercel AI SDK's `UIMessageStream`. It classifies AI token chunks as either prose text-deltas or `data-spec` parts, enabling chat responses that include both explanation text and live UI patches in the same stream.

```typescript
// Server route
const stream = createUIMessageStream({
  execute: async ({ writer }) => {
    writer.merge(pipeJsonRender(result.toUIMessageStream()));
  },
});
return createUIMessageStreamResponse({ stream });
```

**Refinement mode**: When a `currentSpec` is passed to `buildUserPrompt()`, the prompt includes the full existing spec and instructs the LLM to emit only the delta patches required for the requested change — not a full re-generation.

---

## 7. Rendering Pipeline

```
Spec (JSON)
  → Renderer component
    → resolves root key
    → ElementRenderer (memoized, recursive)
      → evaluateVisibility() — skip if hidden
      → resolveElementProps() — resolve all $-expressions against state
      → resolveBindings() — extract two-way bind paths
      → look up Component in registry
      → render children (either recursive ElementRenderers or RepeatChildren)
      → wrap in ElementErrorBoundary — catches errors per-element, not globally
      → Component({ element, props, children, emit, on, bindings, loading })
```

Context providers stack (outermost to innermost):
1. `StateProvider` — JSON Pointer state store (Redux/Zustand/Jotai/XState or built-in)
2. `VisibilityProvider` — visibility condition evaluation context
3. `ValidationProvider` — form field validation
4. `ActionProvider` — named action dispatch, confirmation dialogs
5. `FunctionsContext` — registered `$computed` functions

Each provider is swappable. The `StateStore` interface is framework-agnostic: `get(path)`, `set(path, value)`, `update(updates)`, `getSnapshot()`, `subscribe(listener)`. The built-in implementation uses `useSyncExternalStore`-compatible semantics.

Actions flow through `ActionProvider.execute()`. Built-in actions (`setState`, `pushState`, `removeState`, `validateForm`) are handled transparently. Custom actions route to the `handlers` map.

---

## 8. Nesting and Composition

The spec structure is flat but the rendered tree is arbitrarily deep. Nesting is expressed as an ordered array of string keys in `children`. A parent element's `children: ["a", "b", "c"]` causes the renderer to recursively render elements `a`, `b`, `c` as React children.

The `repeat` field handles list rendering: it reads a state array by path, then renders the children of that element once per item. Each iteration gets its own `RepeatScopeProvider` injecting `$item`, `$index`, and `$bindItem` context.

Composition works at the catalog level too: one catalog can import another, and the shadcn catalog ships 36 pre-built components that can be mixed with custom ones.

---

## 9. Multi-Platform Support

The spec format is universal. Packages:

| Package | Render target |
|---|---|
| `@json-render/react` | DOM (web) |
| `@json-render/shadcn` | shadcn/ui components on top of React |
| `@json-render/react-native` | iOS/Android via React Native (~25 components) |
| `@json-render/remotion` | MP4/WebM video via Remotion (timeline-based) |
| `@json-render/react-pdf` | PDF documents |
| `@json-render/react-email` | HTML email |
| `@json-render/vue` | Vue 3 (added Feb 25, 2026 by Anthony Fu) |
| `@json-render/image` | Static image rendering |
| `@json-render/codegen` | Export spec as standalone React code (no runtime dependency) |

State adapters: `@json-render/redux`, `@json-render/zustand`, `@json-render/jotai`, `@json-render/xstate`.

---

## 10. LLM Integration

Works with any model that can produce JSON. Vercel AI SDK is the primary integration path but not required.

The catalog's `.prompt()` method returns a system prompt containing:
- The component schema (names, props, descriptions)
- The SpecStream wire format explanation
- Streaming ordering instructions (root first, interleave elements and state)
- Optional developer-supplied custom rules

For refinement, `buildUserPrompt({ currentSpec, prompt })` wraps the current spec and the user's request with patch-only instructions.

No structured output/tool call mode is required — the model just outputs plain text that happens to be JSONL. This means any model works. However, models with strong instruction-following (GPT-4, Claude, Gemini) produce better-constrained output.

The `createJsonRenderTransform()` TransformStream enables the model to intersperse explanatory prose with spec patches in a single response — useful for chat-style UIs where the model narrates what it's building while building it.

---

## 11. Maturity Assessment

Strengths:
- Very recently created (January 2026) but already at v0.11.0 with rapid iteration
- Clean TypeScript-first API with Zod throughout
- Solid streaming architecture grounded in RFC standards (JSON Patch RFC 6902, JSON Pointer RFC 6901)
- Good test coverage (Vitest, per-package)
- Notable ecosystem contributors (Anthony Fu, David Khourshid)
- The flat spec + JSONL patch streaming design is genuinely well-suited to LLM generation

Weaknesses/gaps:
- Very young — API is still changing (v0.x), breaking changes likely
- Thin documentation (docs site exists but sparse)
- Single dominant author dependency (ctate at 84% of commits)
- No built-in animation or transition primitives
- No real-time collaborative spec editing (no CRDT/OT)
- Remotion integration (video) is nascent

---

## 12. Relevance to Dazzle

Dazzle's architecture — agents emit tool calls that describe visual content rendered as React components in a Chrome sandbox — maps almost exactly onto what json-render does. Key points of contact:

**What aligns directly**:
- The agent tool call payload IS the spec. Instead of agents calling generic tools, they would emit a `render_ui` tool whose argument is a json-render `Spec` (or JSONL SpecStream). The tool schema constrains what the agent can describe.
- The flat-map + JSONL streaming pattern is ideal for live video: frames can update incrementally as the agent streams without waiting for a complete render tree.
- The `$state` expression system maps well to live data feeds — agent-managed state (viewer count, score, market data) can be bound to display components without the agent re-generating the whole spec.
- The `repeat` field handles list-style content (leaderboards, feeds, queues) that agents commonly need to express.
- `ElementErrorBoundary` per-component isolation is critical for broadcast — one bad component must not crash the stream.
- `createRenderer` + `onAction` callback is a clean interface for the sandbox to forward agent-triggered interactions back to the platform.

**What needs adaptation or replacement**:
- json-render's catalog is defined at developer-time and is static. For Dazzle, agents need the catalog to be discoverable (what visual components are available?). This suggests the catalog prompt should be injected into the agent's system prompt, which json-render already supports via `catalog.prompt()`.
- json-render is designed around user-facing interactive UIs with forms, state bindings, and navigation. Dazzle needs broadcast display (mostly read, rarely write). The `on`/`watch`/`$bindState` machinery is useful but secondary.
- The Remotion package (`@json-render/remotion`) is interesting but targets offline video rendering. Dazzle needs live Chrome-rendered streams. The React web renderer is the right target.
- The shadcn component library is web-app-style (Buttons, Dialogs, Forms). Dazzle needs broadcast-style components (lower thirds, scoreboards, tickers, overlays). These would be custom catalog entries using the same `defineCatalog` pattern.

**Streaming wire format**:
The JSONL JSON Patch format is directly adoptable. Agents can stream patches to the sandbox via WebSocket or SSE. The `createSpecStreamCompiler` handles progressive assembly. A single WebSocket message per patch line gives sub-100ms update latency.

**What to borrow vs. build fresh**:
- Borrow: the `Spec` data model, the JSONL SpecStream protocol, `createSpecStreamCompiler`, `ElementErrorBoundary`, the `$state`/`$cond`/`$template` expression DSL, the `StateStore` interface.
- Borrow: the catalog/registry split (catalog = LLM-facing schema, registry = React implementation). This is the right abstraction.
- Build fresh: Dazzle-specific broadcast components (lower thirds, scoreboards, tickers). These are trivial to add with `defineCatalog`.
- Build fresh: Agent tooling layer that maps agent tool calls to spec patch emission. json-render assumes LLM text output; Dazzle agents use structured tool calls, which is a cleaner contract.
- Evaluate: Whether to depend on `@json-render/core` as a package or just port the small amount of core logic (the types, `createSpecStreamCompiler`, `applySpecPatch`, the expression resolvers). The package is MIT/Apache and small enough that vendoring is feasible if API stability is a concern.

**Concrete adoption path**:
1. Define a `DazzleCatalog` with `defineCatalog` — broadcast display components only (no forms, no navigation).
2. Give each agent its catalog system prompt via `catalog.prompt()`.
3. Agent tool call schema: `{ tool: "render", spec: Spec }` or `{ tool: "patch", patches: JsonPatch[] }`.
4. Chrome sandbox: wrap `createRenderer(catalog, components)` in a full-screen React root. WebSocket receives patches, applies via `applySpecPatch`, React re-renders incrementally.
5. State layer: agent controls state mutations via a `setState` action or direct patch to `/state/*` paths. Live data feeds (viewer counts, prices) update state; components bind via `$state`.

---

## Sources

- https://github.com/vercel-labs/json-render
- https://json-render.dev/
- https://json-render.dev/docs
- https://json-render.org/
- https://thenewstack.io/vercels-json-render-a-step-toward-generative-ui/
- https://deepwiki.com/vercel-labs/json-render
- Source: `packages/core/src/types.ts` (Spec, UIElement, SpecStream types, JSON Patch implementation)
- Source: `packages/core/src/props.ts` (PropExpression DSL)
- Source: `packages/core/src/actions.ts` (ActionBinding, ActionHandler)
- Source: `packages/core/src/prompt.ts` (buildUserPrompt, refinement mode)
- Source: `packages/react/src/renderer.tsx` (Renderer, ElementRenderer, defineRegistry, createRenderer)
- Source: `packages/react/src/hooks.ts` (useUIStream, streaming integration)
- Source: `packages/shadcn/README.md` (component library)
