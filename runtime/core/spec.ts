import type { TimelineEntry, TimelinePlayback, Timeline } from "./timeline"

/** The dual representation: visual for rendering, agentic for other agents to consume. */
export interface Spec {
  root: string
  elements: Record<string, UIElement>
  state: Record<string, unknown>
}

export interface UIElement {
  type: string
  props: Record<string, unknown>
  children?: string[]
  slot?: string
}

/** RFC 6902 JSON Patch operation */
export type PatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string }

/** WebSocket wire messages */
export type WSMessage =
  | { type: "snapshot"; spec: Spec }
  | { type: "patch"; patches: PatchOp[] }
  | { type: "timeline-entry"; entry: TimelineEntry }
  | { type: "timeline-play"; playback: TimelinePlayback }
  | { type: "timeline-clear" }
  | { type: "timeline-snapshot"; timeline: Timeline }
  | { type: "agent-status"; status: string; detail?: string; elapsed?: number }

export function emptySpec(): Spec {
  return { root: "", elements: {}, state: {} }
}
