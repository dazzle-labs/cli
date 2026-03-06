import type { ToolCall, SceneSnapshot } from "./types"

const isTTY = process.stdout.isTTY === true

const RESET = isTTY ? "\x1b[0m" : ""
const DIM = isTTY ? "\x1b[2m" : ""
const CYAN = isTTY ? "\x1b[36m" : ""
const GREEN = isTTY ? "\x1b[32m" : ""
const YELLOW = isTTY ? "\x1b[33m" : ""
const MAGENTA = isTTY ? "\x1b[35m" : ""
const BOLD = isTTY ? "\x1b[1m" : ""

export class Logger {
  private startTime: number

  constructor(startTime: number) {
    this.startTime = startTime
  }

  private elapsed(): string {
    const s = ((Date.now() - this.startTime) / 1000).toFixed(1)
    return `${DIM}[${s.padStart(6)}s]${RESET}`
  }

  agentText(text: string): void {
    // Show first line truncated to 120 chars
    const firstLine = text.split("\n")[0].trim()
    if (!firstLine) return
    const truncated = firstLine.length > 120 ? firstLine.slice(0, 117) + "..." : firstLine
    console.log(`  ${this.elapsed()} ${DIM}${truncated}${RESET}`)
  }

  toolCall(call: ToolCall): void {
    const shortName = call.tool.replace("mcp__stream__", "")
    let detail = ""

    if (call.tool === "mcp__stream__sceneSet") {
      const spec = call.args.spec
      if (spec != null && typeof spec === "object" && !Array.isArray(spec)) {
        const specObj = spec as { root?: unknown; elements?: unknown }
        const elements = specObj.elements
        const elCount = elements != null && typeof elements === "object" && !Array.isArray(elements)
          ? Object.keys(elements).length
          : 0
        const root = specObj.root ?? "?"
        detail = ` ${DIM}(root: "${root}", ${elCount} elements)${RESET}`
      }
    } else if (call.tool === "mcp__stream__scenePatch") {
      const patches = call.args.patches
      const count = Array.isArray(patches) ? patches.length : 0
      detail = ` ${DIM}(${count} patches)${RESET}`
    } else if (call.tool === "mcp__stream__stateSet") {
      const p = call.args.path
      detail = typeof p === "string" ? ` ${DIM}(${p})${RESET}` : ""
    }

    console.log(`  ${this.elapsed()} ${CYAN}${shortName}${RESET}${detail}`)
  }

  sceneMutation(snapshot: SceneSnapshot): void {
    const scene = snapshot.scene
    const type = scene.type
    let detail = ""

    if (type === "snapshot" && scene.spec) {
      const elements = scene.spec.elements
      const elCount = elements != null && typeof elements === "object" && !Array.isArray(elements)
        ? Object.keys(elements).length
        : 0
      const root = scene.spec.root ?? "?"
      detail = ` ${DIM}(root: "${root}", ${elCount} elements)${RESET}`
    } else if (type === "patch" && scene.patches) {
      const count = scene.patches.length
      detail = ` ${DIM}(${count} ops)${RESET}`
    }

    console.log(
      `  ${this.elapsed()} ${MAGENTA}scene:${type}${RESET} #${snapshot.mutationIndex}${detail}`
    )
  }

  summary(
    toolCalls: ToolCall[],
    snapshots: SceneSnapshot[],
    exitCode: number | null,
    durationMs: number
  ): void {
    const dur = (durationMs / 1000).toFixed(1)
    console.log("")
    console.log(
      `  ${BOLD}Summary${RESET}  ${dur}s  exit=${exitCode ?? "null"}`
    )

    // Tool call breakdown
    const toolCounts = new Map<string, number>()
    for (const tc of toolCalls) {
      const short = tc.tool.replace("mcp__stream__", "")
      toolCounts.set(short, (toolCounts.get(short) || 0) + 1)
    }
    if (toolCounts.size > 0) {
      const parts = [...toolCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${GREEN}${name}${RESET}:${count}`)
      console.log(`  ${DIM}Tools${RESET}    ${parts.join("  ")}`)
    } else {
      console.log(`  ${DIM}Tools${RESET}    ${YELLOW}(none captured)${RESET}`)
    }

    // Snapshot breakdown
    let snapshotCount = 0
    let patchCount = 0
    for (const s of snapshots) {
      if (s.scene.type === "snapshot") snapshotCount++
      else if (s.scene.type === "patch") patchCount++
    }
    console.log(
      `  ${DIM}Scenes${RESET}   ${snapshots.length} total (${snapshotCount} snapshots, ${patchCount} patches)`
    )
    console.log("")
  }
}
