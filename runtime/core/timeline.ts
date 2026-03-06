import type { Spec, PatchOp } from "./spec"

/** Transition applied when a timeline entry becomes active. */
export interface TransitionSpec {
  /** Duration of the transition in milliseconds. Default: 0 (instant cut). */
  duration?: number

  /** CSS easing function. Default: "ease-in-out". */
  easing?: string

  /**
   * Transition type:
   * - "cut"       -- instant swap (default when duration is 0)
   * - "crossfade" -- opacity crossfade between old and new scene
   * - "css"       -- applies CSS transition properties to changed elements
   */
  type?: "cut" | "crossfade" | "css"
}

/** A single keyframe on the elapsed timeline. */
export interface TimelineEntry {
  /** Elapsed presentation time in milliseconds. */
  at: number

  /** What to do at this time. Exactly one action type is set. */
  action:
    | { type: "snapshot"; spec: Spec }
    | { type: "patch"; patches: PatchOp[] }
    | { type: "stateSet"; path: string; value: unknown }

  /** Transition applied when this entry becomes active. */
  transition?: TransitionSpec

  /** Optional human-readable label for debugging/harness. */
  label?: string
}

/** Playback state for the timeline. */
export interface TimelinePlayback {
  state: "stopped" | "playing" | "paused"
  rate: number
  /** Wall-clock ms (Date.now()) when playback began. */
  startedAt?: number
  /** Elapsed offset in ms when paused (for resume). */
  offsetMs?: number
}

/** The full server-side timeline aggregate. */
export interface Timeline {
  /** Ordered list of entries, sorted by `at` ascending. */
  entries: TimelineEntry[]

  /** Total presentation duration in ms. Defaults to last entry's `at` + 1000. */
  duration?: number

  /** Playback state. */
  playback: TimelinePlayback
}
