/**
 * Renderer — browser-side engine for spec-driven rendering.
 *
 * Loaded once via set_script, then driven entirely through emit_event.
 * Imports core logic from ./core/ (applyPatches, resolveExpressions).
 * Uses globals from prelude.js: React, createElement, create, createRoot.
 */

import { applyPatches } from "./core/patch"
import { resolveExpressions } from "./core/expressions"
import type { Spec, PatchOp } from "./core/spec"
import type { TimelineEntry, TimelinePlayback, Timeline } from "./core/timeline"

// ─── Component catalog ───
import {
  Box, Stack, Grid, Split, Heading, Text, Code, Card, Image, Divider,
  LowerThird, Ticker, Banner, Badge, Shape, Line, Path, SvgContainer,
  Transition, FadeIn, Counter, Animate, Stagger, Presence, Gradient,
  Overlay, Stat, ProgressBar, Sparkline, Chart, Table,
  StatusBar, CodeView, DiffView, TerminalView, EventTimeline, ProgressPanel,
} from "./components"

// ─── Globals from prelude (set by shell.html → prelude.js) ───
declare const React: any
declare const createElement: any
declare const create: any
declare const createRoot: any

// ─── Zustand store: scene spec ───

interface SceneStore {
  spec: Spec
  setSpec: (spec: Spec) => void
}

const useSceneStore = create<SceneStore>((set: any) => ({
  spec: { root: "", elements: {}, state: {} },
  setSpec: (spec: Spec) => set({ spec }),
}))

// ─── Timeline state ───

interface TimelineState {
  entries: TimelineEntry[]
  playback: TimelinePlayback
  cursor: number // index of next entry to fire
  timerId: ReturnType<typeof setTimeout> | null
}

const timelineState: TimelineState = {
  entries: [],
  playback: { state: "stopped", rate: 1 },
  cursor: 0,
  timerId: null,
}

function getElapsed(): number {
  const pb = timelineState.playback
  if (pb.state === "stopped") return 0
  if (pb.state === "paused") return pb.offsetMs ?? 0
  // playing
  const now = Date.now()
  const wallElapsed = (now - (pb.startedAt ?? now)) * pb.rate
  return (pb.offsetMs ?? 0) + wallElapsed
}

function scheduleNext() {
  if (timelineState.timerId !== null) {
    clearTimeout(timelineState.timerId)
    timelineState.timerId = null
  }

  const pb = timelineState.playback
  if (pb.state !== "playing") return

  const entries = timelineState.entries
  if (timelineState.cursor >= entries.length) return

  const next = entries[timelineState.cursor]
  const elapsed = getElapsed()
  const delay = Math.max(0, (next.at - elapsed) / pb.rate)

  timelineState.timerId = setTimeout(() => {
    timelineState.timerId = null
    fireEntry(next)
    timelineState.cursor++
    scheduleNext()
  }, delay)
}

function fireEntry(entry: TimelineEntry) {
  const store = useSceneStore.getState()
  const action = entry.action

  switch (action.type) {
    case "snapshot":
      store.setSpec(action.spec)
      break
    case "patch":
      store.setSpec(applyPatches(store.spec, action.patches))
      break
    case "stateSet": {
      const patch: PatchOp = { op: "replace", path: `/state${action.path}`, value: action.value }
      store.setSpec(applyPatches(store.spec, [patch]))
      break
    }
  }
}

function firePastEntries() {
  const elapsed = getElapsed()
  const entries = timelineState.entries
  // Find cursor: first entry at or after elapsed
  let cursor = 0
  let lastSnapshot = -1
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].at <= elapsed) {
      if (entries[i].action.type === "snapshot") lastSnapshot = i
      cursor = i + 1
    }
  }
  // Replay from last snapshot up to cursor
  const start = lastSnapshot >= 0 ? lastSnapshot : 0
  for (let i = start; i < cursor; i++) {
    fireEntry(entries[i])
  }
  timelineState.cursor = cursor
}

// ─── Component registry ───

const COMPONENTS: Record<string, any> = {
  // Layout
  Box, Stack, Grid, Split, Gradient, Overlay,
  // Text
  Heading, Text, Code,
  // Content
  Card, Image, Divider,
  // Broadcast
  LowerThird, Ticker, Banner, Badge,
  // SVG
  Shape, Line, Path, SvgContainer,
  // Animation
  Transition, FadeIn, Counter, Animate, Stagger, Presence,
  // Data
  Stat, ProgressBar, Sparkline, Chart, Table,
  // Coding
  StatusBar, CodeView, DiffView, TerminalView, EventTimeline, ProgressPanel,
}

function Fallback({ props, children }: { props: Record<string, any>; children?: any }) {
  return <div style={{ ...props.style }}>{children}</div>
}

// ─── Recursive element renderer ───

function RenderElement({ elementKey, spec }: { elementKey: string; spec: Spec }) {
  const element = spec.elements[elementKey]
  if (!element) return null

  const Component = COMPONENTS[element.type] || Fallback
  const resolvedProps = resolveExpressions(element.props || {}, spec.state || {})

  let childElements = null
  if (element.children && element.children.length > 0) {
    childElements = element.children.map((childKey: string) =>
      <RenderElement key={childKey} elementKey={childKey} spec={spec} />
    )
  }

  return <Component props={resolvedProps}>{childElements}</Component>
}

// ─── SpecRenderer component ───

function SpecRenderer({ spec }: { spec: Spec }) {
  if (!spec || !spec.root || !spec.elements) {
    return <div style={{ color: "#666", padding: "20px" }}>No spec provided</div>
  }
  return <RenderElement elementKey={spec.root} spec={spec} />
}

// ─── Main App (reads from zustand store) ───

function App() {
  const spec = useSceneStore((s: SceneStore) => s.spec)
  return <SpecRenderer spec={spec} />
}

// ─── Event listeners ───

window.addEventListener("event", ((e: CustomEvent) => {
  const { event, data } = e.detail
  const store = useSceneStore.getState()

  switch (event) {
    case "scene:snapshot":
      store.setSpec(data.spec)
      break

    case "scene:patch":
      store.setSpec(applyPatches(store.spec, data.patches))
      break

    case "scene:stateSet": {
      const patch: PatchOp = { op: "replace", path: `/state${data.path}`, value: data.value }
      store.setSpec(applyPatches(store.spec, [patch]))
      break
    }

    case "timeline:append": {
      const newEntries = data.entries as TimelineEntry[]
      timelineState.entries = [...timelineState.entries, ...newEntries].sort((a, b) => a.at - b.at)
      // If playing, fire any past entries and reschedule
      if (timelineState.playback.state === "playing") {
        firePastEntries()
        scheduleNext()
      }
      break
    }

    case "timeline:play": {
      const { action, rate, seekTo } = data
      if (action === "play") {
        if (seekTo != null) {
          timelineState.playback.offsetMs = seekTo
          // Reset cursor for seek
          timelineState.cursor = 0
        }
        timelineState.playback.rate = rate ?? timelineState.playback.rate ?? 1
        timelineState.playback.state = "playing"
        timelineState.playback.startedAt = Date.now()
        firePastEntries()
        scheduleNext()
      } else if (action === "pause") {
        timelineState.playback.offsetMs = getElapsed()
        timelineState.playback.state = "paused"
        timelineState.playback.startedAt = undefined
        if (timelineState.timerId !== null) {
          clearTimeout(timelineState.timerId)
          timelineState.timerId = null
        }
      } else if (action === "stop") {
        timelineState.playback.state = "stopped"
        timelineState.playback.offsetMs = 0
        timelineState.playback.startedAt = undefined
        timelineState.cursor = 0
        if (timelineState.timerId !== null) {
          clearTimeout(timelineState.timerId)
          timelineState.timerId = null
        }
      }
      break
    }

    case "timeline:clear":
      if (timelineState.timerId !== null) {
        clearTimeout(timelineState.timerId)
        timelineState.timerId = null
      }
      timelineState.entries = []
      timelineState.cursor = 0
      timelineState.playback = { state: "stopped", rate: 1 }
      break
  }
}) as EventListener)

// ─── Expose globals for reads (sceneRead / timelineRead via CDP eval) ───

;(window as any).__sceneSpec = () => useSceneStore.getState().spec
;(window as any).__timelineState = () => ({
  entries: timelineState.entries,
  playback: { ...timelineState.playback },
  elapsed: getElapsed(),
  cursor: timelineState.cursor,
})

// ─── Mount React app ───

if (!((window as any).__reactRoot)) {
  ;(window as any).__reactRoot = createRoot(document.getElementById("root"))
}
;(window as any).__reactRoot.render(<App />)
