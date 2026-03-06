import fs from "fs"
import path from "path"
import { generateText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import {
  SessionResult,
  EvaluationResult,
  ToolCall,
  SceneSnapshot,
} from "./types"
import { applyPatches } from "../../runtime/core/patch"
import type { PatchOp } from "../../runtime/core/spec"

const EVAL_MODEL = "claude-opus-4-6"

interface SceneSpec {
  root: string
  elements: Record<string, unknown>
  state: Record<string, unknown>
}

function resolveAllSpecs(
  sceneSnapshots: SceneSnapshot[]
): { index: number; spec: SceneSpec; timestamp: number }[] {
  const resolved: { index: number; spec: SceneSpec; timestamp: number }[] = []
  let currentSpec: SceneSpec = { root: "", elements: {}, state: {} }

  for (let i = 0; i < sceneSnapshots.length; i++) {
    const snap = sceneSnapshots[i]
    const scene = snap.scene as Record<string, unknown>

    if (scene.type === "snapshot" && scene.spec) {
      currentSpec = JSON.parse(JSON.stringify(scene.spec)) as SceneSpec
    } else if (scene.type === "patch" && scene.patches) {
      currentSpec = applyPatches(currentSpec, scene.patches as PatchOp[])
    }

    resolved.push({
      index: i,
      spec: JSON.parse(JSON.stringify(currentSpec)),
      timestamp: snap.timestamp,
    })
  }

  return resolved
}

// ─── Formatters ───

/**
 * Extract a compact summary of a scene spec: root, element keys with types and key visual props.
 * Omits layout details (padding, margin, gap, position) to save tokens.
 */
function compactSpec(spec: SceneSpec): string {
  const lines: string[] = []
  lines.push('root: "' + (spec.root || "(empty)") + '"')
  const elementKeys = Object.keys(spec.elements)
  lines.push("elements (" + elementKeys.length + "):")
  for (const key of elementKeys) {
    const el = spec.elements[key] as Record<string, unknown>
    const elType = (el.type as string) || "unknown"
    const props = el.props as Record<string, unknown> | undefined
    const keyProps: string[] = []
    if (props) {
      // Extract only visually meaningful props
      const interestingKeys = ["text", "fontSize", "color", "background", "src", "preset", "children", "fontWeight", "opacity", "gradient", "items"]
      for (const k of interestingKeys) {
        if (props[k] !== undefined) {
          const val = typeof props[k] === "string" ? props[k] : JSON.stringify(props[k])
          const valStr = String(val)
          keyProps.push(k + ": " + (valStr.length > 80 ? valStr.slice(0, 80) + "..." : valStr))
        }
      }
    }
    const children = el.children as string[] | undefined
    if (Array.isArray(children) && children.length > 0) {
      keyProps.push("children: [" + children.join(", ") + "]")
    }
    lines.push("  " + key + " (" + elType + ")" + (keyProps.length > 0 ? ": " + keyProps.join(", ") : ""))
  }
  if (spec.state && Object.keys(spec.state).length > 0) {
    lines.push("state: " + JSON.stringify(spec.state))
  }
  return lines.join("\n")
}

function formatSpecTimeline(
  resolvedSpecs: { index: number; spec: SceneSpec; timestamp: number }[]
): string {
  if (resolvedSpecs.length === 0) return "(no scene states captured)"
  const baseTimestamp = resolvedSpecs[0].timestamp

  // For large sessions (>10 states), summarize earlier ones and only include compact specs for the last 5
  if (resolvedSpecs.length > 10) {
    const summarized = resolvedSpecs.slice(0, resolvedSpecs.length - 5)
    const fullSpecs = resolvedSpecs.slice(resolvedSpecs.length - 5)

    const summaryLines = summarized.map((s, i) => {
      const elapsed = ((s.timestamp - baseTimestamp) / 1000).toFixed(1)
      const elementCount = Object.keys(s.spec.elements).length
      const root = s.spec.root || "(empty)"
      return `- State ${i + 1} (t=${elapsed}s): root="${root}", ${elementCount} elements`
    })

    const fullLines = fullSpecs.map((s) => {
      const originalIndex = resolvedSpecs.indexOf(s)
      const elapsed = ((s.timestamp - baseTimestamp) / 1000).toFixed(1)
      return `### Scene State ${originalIndex + 1} (t=${elapsed}s)\n${compactSpec(s.spec)}`
    })

    return `### Earlier States (summarized — ${summarized.length} states)\n${summaryLines.join("\n")}\n\n${fullLines.join("\n\n")}`
  }

  // For smaller sessions, use compact spec for all states
  return resolvedSpecs
    .map((s, i) => {
      const elapsed = ((s.timestamp - baseTimestamp) / 1000).toFixed(1)
      return `### Scene State ${i + 1} (t=${elapsed}s)\n${compactSpec(s.spec)}`
    })
    .join("\n\n")
}

function extractComponentTypesUsed(
  resolvedSpecs: { spec: SceneSpec }[]
): string[] {
  const types = new Set<string>()
  for (const { spec } of resolvedSpecs) {
    if (spec.elements) {
      for (const el of Object.values(spec.elements)) {
        const element = el as Record<string, unknown>
        if (element.type && typeof element.type === "string") {
          types.add(element.type)
        }
      }
    }
  }
  return [...types].sort()
}

function formatToolCallDetails(toolCalls: ToolCall[], sessionStart: number): string {
  return toolCalls
    .map((tc, i) => {
      const name = tc.tool.replace("mcp__stream__", "")
      const tSec = ((tc.timestamp - sessionStart) / 1000).toFixed(1)
      // Truncate args to 300 chars — the evaluator has the spec timeline for full scene data
      const argsRaw = JSON.stringify(tc.args)
      const argsStr = argsRaw.length > 300
        ? argsRaw.slice(0, 300) + `... (${argsRaw.length} chars)`
        : argsRaw
      let resultSummary = "(no result captured)"
      if (tc.result) {
        const raw =
          typeof tc.result === "string"
            ? tc.result
            : JSON.stringify(tc.result)
        resultSummary = raw
          .replace(
            /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g,
            "[base64-image-stripped]"
          )
          .slice(0, 300)
      }
      return `${i + 1}. **${name}** (t=${tSec}s) — args: ${argsStr}${resultSummary !== "(no result captured)" ? ` → ${resultSummary}` : ""}`
    })
    .join("\n")
}

function summarizeToolCalls(toolCalls: ToolCall[]): string {
  const counts = new Map<string, number>()
  for (const call of toolCalls) {
    counts.set(call.tool, (counts.get(call.tool) || 0) + 1)
  }
  const lines: string[] = []
  for (const [tool, count] of counts) {
    lines.push(`- ${tool}: ${count} call(s)`)
  }
  return lines.length > 0 ? lines.join("\n") : "(no tool calls)"
}

function extractErrors(toolCalls: ToolCall[]): ToolCall[] {
  return toolCalls.filter((tc) => {
    if (!tc.result) return false
    const resultStr =
      typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)
    return (
      resultStr.toLowerCase().includes("error") ||
      resultStr.toLowerCase().includes("failed") ||
      resultStr.toLowerCase().includes("not found") ||
      resultStr.toLowerCase().includes("invalid")
    )
  })
}

// ─── Timing & workflow analysis ───

interface TimingBreakdown {
  totalDurationSec: number
  timeToFirstSceneSec: number | null
  sceneMutationIntervals: { from: number; to: number; deltaSec: number }[]
  catalogReadTimeSec: number
  sceneWriteTimeSec: number
  otherToolTimeSec: number
  toolTimeline: { tSec: number; tool: string; gapFromPrevSec: number | null }[]
  catalogReadCount: number
  sceneWriteCount: number
  thinkingGaps: { afterTool: string; gapSec: number }[]
}

interface WorkflowAnalysis {
  usedScreenshots: boolean
  screenshotCount: number
  usedPatches: boolean
  patchCount: number
  usedSceneRead: boolean
  sceneReadCount: number
  usedTimeline: boolean
  timelineEntryCount: number
  usedValidate: boolean
  validateCount: number
  sceneSetCount: number
  uniqueComponentTypes: string[]
  maxElementCount: number
  elementCountProgression: { stateIndex: number; count: number; tSec: number }[]
  containerChildrenUsed: boolean
  stateBindingsUsed: boolean
}

function computeTimingBreakdown(
  result: SessionResult,
  resolvedSpecs: { index: number; spec: SceneSpec; timestamp: number }[]
): TimingBreakdown {
  const sessionStart = result.startTime
  const totalDurationSec = (result.endTime - sessionStart) / 1000

  let timeToFirstSceneSec: number | null = null
  for (const s of resolvedSpecs) {
    const hasContent =
      (s.spec.root && s.spec.root.length > 0) ||
      Object.keys(s.spec.elements).length > 0
    if (hasContent) {
      timeToFirstSceneSec = (s.timestamp - sessionStart) / 1000
      break
    }
  }

  const sceneMutationIntervals: { from: number; to: number; deltaSec: number }[] = []
  for (let i = 1; i < resolvedSpecs.length; i++) {
    sceneMutationIntervals.push({
      from: i,
      to: i + 1,
      deltaSec: (resolvedSpecs[i].timestamp - resolvedSpecs[i - 1].timestamp) / 1000,
    })
  }

  const toolTimeline: { tSec: number; tool: string; gapFromPrevSec: number | null }[] = []
  const thinkingGaps: { afterTool: string; gapSec: number }[] = []
  let catalogReadTimeSec = 0
  let sceneWriteTimeSec = 0
  let otherToolTimeSec = 0
  let catalogReadCount = 0
  let sceneWriteCount = 0

  const sorted = [...result.toolCalls].sort((a, b) => a.timestamp - b.timestamp)

  for (let i = 0; i < sorted.length; i++) {
    const tc = sorted[i]
    const shortName = tc.tool.replace("mcp__stream__", "")
    const tSec = (tc.timestamp - sessionStart) / 1000
    const gapFromPrevSec = i > 0 ? (tc.timestamp - sorted[i - 1].timestamp) / 1000 : null

    toolTimeline.push({ tSec, tool: shortName, gapFromPrevSec })

    // Detect long thinking gaps (>10s between tool calls = agent was thinking)
    if (gapFromPrevSec !== null && gapFromPrevSec > 10) {
      thinkingGaps.push({
        afterTool: sorted[i - 1].tool.replace("mcp__stream__", ""),
        gapSec: Math.round(gapFromPrevSec * 10) / 10,
      })
    }

    const nextTs = i + 1 < sorted.length ? sorted[i + 1].timestamp : tc.timestamp + 1000
    const durSec = Math.max(0, (nextTs - tc.timestamp) / 1000)

    if (shortName === "catalogRead") {
      catalogReadTimeSec += durSec
      catalogReadCount++
    } else if (["sceneSet", "scenePatch", "sceneRead"].includes(shortName)) {
      sceneWriteTimeSec += durSec
      sceneWriteCount++
    } else {
      otherToolTimeSec += durSec
    }
  }

  return {
    totalDurationSec,
    timeToFirstSceneSec,
    sceneMutationIntervals,
    catalogReadTimeSec: Math.round(catalogReadTimeSec * 10) / 10,
    sceneWriteTimeSec: Math.round(sceneWriteTimeSec * 10) / 10,
    otherToolTimeSec: Math.round(otherToolTimeSec * 10) / 10,
    toolTimeline,
    catalogReadCount,
    sceneWriteCount,
    thinkingGaps,
  }
}

function analyzeWorkflow(
  result: SessionResult,
  resolvedSpecs: { index: number; spec: SceneSpec; timestamp: number }[]
): WorkflowAnalysis {
  const tools = result.toolCalls.map((tc) => tc.tool.replace("mcp__stream__", ""))

  const screenshotCount = tools.filter((t) => t === "screenshotTake").length
  const patchCount = tools.filter((t) => t === "scenePatch").length
  const sceneReadCount = tools.filter((t) => t === "sceneRead").length
  const sceneSetCount = tools.filter((t) => t === "sceneSet").length
  const validateCount = tools.filter((t) => t === "validateSpec").length

  const timelineTools = ["timelineAppend", "timelinePlay", "timelineClear", "timelineRead"]
  const usedTimeline = tools.some((t) => timelineTools.includes(t))
  const timelineEntryCount = result.sceneSnapshots.filter((s) => {
    const scene = s.scene as Record<string, unknown>
    return scene.type === "timeline-entry"
  }).length

  // Element count progression
  const sessionStart = result.startTime
  const elementCountProgression: { stateIndex: number; count: number; tSec: number }[] = []
  let maxElementCount = 0
  for (let i = 0; i < resolvedSpecs.length; i++) {
    const count = Object.keys(resolvedSpecs[i].spec.elements).length
    if (count > maxElementCount) maxElementCount = count
    elementCountProgression.push({
      stateIndex: i + 1,
      count,
      tSec: Math.round(((resolvedSpecs[i].timestamp - sessionStart) / 1000) * 10) / 10,
    })
  }

  // Check for container children usage and state bindings
  let containerChildrenUsed = false
  let stateBindingsUsed = false
  for (const { spec } of resolvedSpecs) {
    for (const el of Object.values(spec.elements)) {
      const element = el as Record<string, unknown>
      if (Array.isArray(element.children) && element.children.length > 0) {
        containerChildrenUsed = true
      }
      const props = element.props as Record<string, unknown> | undefined
      if (props) {
        for (const v of Object.values(props)) {
          if (typeof v === "object" && v !== null && "$state" in v) {
            stateBindingsUsed = true
          }
        }
      }
    }
    if (spec.state && Object.keys(spec.state).length > 0) {
      stateBindingsUsed = true
    }
  }

  const uniqueComponentTypes = extractComponentTypesUsed(resolvedSpecs)

  return {
    usedScreenshots: screenshotCount > 0,
    screenshotCount,
    usedPatches: patchCount > 0,
    patchCount,
    usedSceneRead: sceneReadCount > 0,
    sceneReadCount,
    usedTimeline,
    timelineEntryCount,
    usedValidate: validateCount > 0,
    validateCount,
    sceneSetCount,
    uniqueComponentTypes,
    maxElementCount,
    elementCountProgression,
    containerChildrenUsed,
    stateBindingsUsed,
  }
}



function formatTimingBreakdown(timing: TimingBreakdown): string {
  const lines: string[] = []
  lines.push(`Total session duration: ${timing.totalDurationSec.toFixed(1)}s`)
  lines.push(
    `Time to first visible scene: ${timing.timeToFirstSceneSec !== null ? timing.timeToFirstSceneSec.toFixed(1) + "s" : "never (no scene produced)"}`
  )
  lines.push(
    `Catalog reads: ${timing.catalogReadCount} calls, ~${timing.catalogReadTimeSec.toFixed(1)}s`
  )
  lines.push(
    `Scene operations: ${timing.sceneWriteCount} calls, ~${timing.sceneWriteTimeSec.toFixed(1)}s`
  )
  lines.push(`Other tools: ~${timing.otherToolTimeSec.toFixed(1)}s`)

  if (timing.thinkingGaps.length > 0) {
    lines.push("")
    lines.push("Long thinking gaps (>10s between tool calls):")
    for (const gap of timing.thinkingGaps) {
      lines.push(`  After ${gap.afterTool}: ${gap.gapSec}s of thinking`)
    }
  }

  if (timing.sceneMutationIntervals.length > 0) {
    lines.push("")
    lines.push("Scene mutation intervals:")
    for (const interval of timing.sceneMutationIntervals) {
      lines.push(`  State ${interval.from} -> ${interval.to}: ${interval.deltaSec.toFixed(1)}s`)
    }
  }

  return lines.join("\n")
}

function formatToolTimeline(timeline: { tSec: number; tool: string; gapFromPrevSec: number | null }[]): string {
  if (timeline.length === 0) return "(no tool calls)"
  return timeline
    .map((t) => {
      const gap = t.gapFromPrevSec !== null ? ` (+${t.gapFromPrevSec.toFixed(1)}s)` : ""
      return `t=${t.tSec.toFixed(1)}s: ${t.tool}${gap}`
    })
    .join("\n")
}

function formatWorkflowAnalysis(wf: WorkflowAnalysis): string {
  const lines: string[] = []

  lines.push("Agent workflow characteristics:")
  lines.push(`  Scene construction: ${wf.sceneSetCount} full sets, ${wf.patchCount} patches`)
  lines.push(`  Screenshots taken: ${wf.screenshotCount}`)
  lines.push(`  Scene reads: ${wf.sceneReadCount}`)
  lines.push(`  Spec validations: ${wf.validateCount}`)
  lines.push(`  Timeline: ${wf.usedTimeline ? `yes (${wf.timelineEntryCount} timeline entries)` : "not used"}`)
  lines.push(`  Component diversity: ${wf.uniqueComponentTypes.length} types used: ${wf.uniqueComponentTypes.join(", ") || "none"}`)
  lines.push(`  Max element count: ${wf.maxElementCount}`)
  lines.push(`  Container children wired: ${wf.containerChildrenUsed ? "yes" : "no"}`)
  lines.push(`  State bindings ($state): ${wf.stateBindingsUsed ? "yes" : "no"}`)

  if (wf.elementCountProgression.length > 0) {
    lines.push("")
    lines.push("  Element count over time:")
    for (const p of wf.elementCountProgression) {
      lines.push(`    State ${p.stateIndex} (t=${p.tSec}s): ${p.count} elements`)
    }
  }

  return lines.join("\n")
}

// ─── AI SDK runner ───

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; image: Buffer; mimeType: "image/png" | "image/jpeg" }

async function runEval(systemPrompt: string, userPrompt: string, images?: { path: string; label: string }[]): Promise<string> {
  // Build multipart content: text prompt + optional screenshot images
  const content: ContentPart[] = [{ type: "text", text: userPrompt }]

  if (images && images.length > 0) {
    content.push({
      type: "text",
      text: "\n\n## Screenshots (browser renders — ground truth)\n",
    })
    for (const img of images) {
      try {
        const imageBuffer = fs.readFileSync(img.path)
        const mimeType = img.path.endsWith(".jpg") || img.path.endsWith(".jpeg")
          ? "image/jpeg" as const
          : "image/png" as const
        content.push({ type: "text", text: `\n### ${img.label}\n` })
        content.push({ type: "image", image: imageBuffer, mimeType })
      } catch {
        // Skip missing screenshots
      }
    }
  }

  const { text } = await generateText({
    model: anthropic(EVAL_MODEL),
    system: systemPrompt,
    messages: [{ role: "user", content }],
  })
  return text.trim()
}

// ─── Helpers ───

/**
 * Parse a screenshot filename to extract scene number and timestamp.
 * Supports both new format (screenshot-01-t14.7s.jpg) and legacy (screenshot-01.jpg).
 */
function parseScreenshotLabel(filename: string): string {
  const basename = path.basename(filename, path.extname(filename))
  // New format: screenshot-NN-tXX.Xs
  const tsMatch = basename.match(/screenshot-(\d+)-t([\d.]+)s/)
  if (tsMatch) {
    return `Scene at t=${tsMatch[2]}s`
  }
  // Legacy format: screenshot-NN
  const legacyMatch = basename.match(/screenshot-(\d+)/)
  if (legacyMatch) {
    return `Scene ${legacyMatch[1]} screenshot`
  }
  return basename
}

function collectScreenshots(
  result: SessionResult,
  outputDir: string
): { path: string; label: string }[] {
  const images: { path: string; label: string }[] = []
  if (result.screenshotPaths && result.screenshotPaths.length > 0) {
    for (const sp of result.screenshotPaths) {
      if (fs.existsSync(sp)) {
        images.push({ path: sp, label: parseScreenshotLabel(sp) })
      }
    }
  } else {
    // Fall back to scanning the output directory for screenshot files
    try {
      const files = fs.readdirSync(outputDir)
        .filter((f) => f.match(/^screenshot-\d+/))
        .sort()
      for (const f of files) {
        images.push({ path: path.join(outputDir, f), label: parseScreenshotLabel(f) })
      }
    } catch {
      // No screenshots available
    }
  }
  return images
}

// ─── Public API ───

export async function evaluate(
  result: SessionResult,
  outputDir: string
): Promise<EvaluationResult> {
  const resolvedSpecs = resolveAllSpecs(result.sceneSnapshots)
  const duration = result.endTime - result.startTime
  const toolSummary = summarizeToolCalls(result.toolCalls)
  const toolCallDetails = formatToolCallDetails(result.toolCalls, result.startTime)
  const componentTypesUsed = extractComponentTypesUsed(resolvedSpecs)
  const errors = extractErrors(result.toolCalls)
  const specTimeline = formatSpecTimeline(resolvedSpecs)
  const timing = computeTimingBreakdown(result, resolvedSpecs)
  const workflow = analyzeWorkflow(result, resolvedSpecs)

  let scenarioPrompt = result.scenarioPrompt || ""
  if (!scenarioPrompt && result.scenarioDir) {
    const promptPath = path.join(result.scenarioDir, "prompt.md")
    if (fs.existsSync(promptPath)) {
      scenarioPrompt = fs.readFileSync(promptPath, "utf-8")
    }
  }
  if (!scenarioPrompt) {
    scenarioPrompt = `(Scenario: ${result.scenario} -- original prompt not available)`
  }

  // Handle no-scene edge case
  if (resolvedSpecs.length === 0) {
    const noScenesMarkdown = `# Evaluation: ${result.scenario}

**Session:** ${result.sessionId}
**Duration:** ${((duration) / 1000).toFixed(1)}s | **Tool Calls:** ${result.toolCalls.length} | **Exit Code:** ${result.exitCode}
**Time to first scene:** never | **Components used:** none | **Timeline used:** ${workflow.usedTimeline ? "yes" : "no"}

---

No scene snapshots were captured during this session. There is nothing to evaluate visually.
`
    fs.writeFileSync(path.join(outputDir, "evaluation.md"), noScenesMarkdown)
    return { rawOutput: "No scene snapshots captured. Cannot evaluate visual output." }
  }

  // Collect screenshots early — needed to decide whether to include video transcription
  let screenshotImages: { path: string; label: string }[] = collectScreenshots(result, outputDir)

  // Cap screenshots at 4 to stay within token limits.
  const MAX_SCREENSHOTS = 4
  if (screenshotImages.length > MAX_SCREENSHOTS) {
    const total = screenshotImages.length
    const sampled: { path: string; label: string }[] = []
    for (let i = 0; i < MAX_SCREENSHOTS; i++) {
      const idx = Math.round((i * (total - 1)) / (MAX_SCREENSHOTS - 1))
      sampled.push(screenshotImages[idx])
    }
    console.log(`    [eval] Sampled ${MAX_SCREENSHOTS} of ${total} screenshots to stay within token limits`)
    screenshotImages = sampled
  }

  if (screenshotImages.length > 0) {
    console.log(`    [eval] Including ${screenshotImages.length} screenshot(s) as images`)
  }

  // When screenshots are available, they are higher-fidelity than video transcription.
  // Include transcription only when no screenshots exist to save tokens.
  const hasScreenshots = screenshotImages.length > 0
  const videoSection = (() => {
    if (!result.videoTranscription) {
      return "(No video transcription available — visual quality assessment will be limited to spec analysis and screenshots)"
    }
    if (hasScreenshots) {
      return "(Video transcription available but omitted — screenshots provide higher-fidelity ground truth for visual assessment.)"
    }
    return `## Video Transcription (PRIMARY VISUAL EVIDENCE)\n\n${result.videoTranscription}\n`
  })()

  // Console errors section — capped at 20 unique errors to prevent token blowout
  const consoleErrorsSection = (() => {
    let errors = result.consoleErrors
    if (!errors || errors.length === 0) {
      const logPath = path.join(outputDir, "console-errors.log")
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean)
        if (lines.length > 0) {
          errors = lines.map((line) => {
            const match = line.match(/^\[([^\]]+)\]\s*(.*)$/)
            return {
              timestamp: match ? new Date(match[1]).getTime() : 0,
              text: match ? match[2] : line,
            }
          })
        }
      }
    }
    if (!errors || errors.length === 0) return ""
    const totalCount = errors.length
    // Deduplicate by error text (truncated to 200 chars) and keep first occurrence
    const seen = new Map<string, { timestamp: number; text: string; count: number }>()
    for (const e of errors) {
      const key = e.text.slice(0, 200)
      if (seen.has(key)) {
        seen.get(key)!.count++
      } else {
        seen.set(key, { timestamp: e.timestamp, text: e.text.slice(0, 300), count: 1 })
      }
    }
    // Take at most 20 unique errors
    const unique = [...seen.values()].slice(0, 20)
    const errorLines = unique.map((e) => {
      const tSec = result.startTime ? ((e.timestamp - result.startTime) / 1000).toFixed(1) : "?"
      return `- t=${tSec}s (${e.count}x): ${e.text}`
    })
    const truncNote = seen.size > 20 ? `\n(${seen.size} unique errors total, showing first 20)` : ""
    return `## Browser Console Errors (${totalCount} total, ${seen.size} unique)\n\n${errorLines.join("\n")}${truncNote}\n`
  })()

  // Format user messages (interactive mode)
  const userMessagesSection = (() => {
    if (!result.userMessages || result.userMessages.length === 0) return ""
    const lines = result.userMessages.map((m) => {
      const tSec = ((m.timestamp - result.startTime) / 1000).toFixed(1)
      return `- t=${tSec}s: "${m.content}"`
    })
    return `## User Messages (Interactive Mode)\n\nThis was an interactive session. A simulated user sent ${result.userMessages.length} messages to the agent during execution:\n\n${lines.join("\n")}\n`
  })()

  const errorDetails =
    errors.length > 0
      ? errors
          .map(
            (e, i) =>
              `${i + 1}. Tool: ${e.tool}\n   Args: ${JSON.stringify(e.args).slice(0, 200)}\n   Error: ${JSON.stringify(e.result).slice(0, 500)}`
          )
          .join("\n\n")
      : "(no errors detected)"

  const systemPrompt = `You are a ruthlessly exacting creative director evaluating broadcast motion graphics output. Score what the viewer saw, not what was intended.

## RULES

1. **Screenshots/video transcription = ground truth.** Specs show intent; screenshots show reality. If specs specify animations not visible in video, penalize. Screenshots are highest-fidelity evidence.
2. **Valid Animate presets:** fade-in, slide-in-left, slide-in-right, slide-in-up, slide-in-down, scale-up, scale-down, bounce-in, pulse. Aliases: bounce→bounce-in, slide-up→slide-in-up, slide-down→slide-in-down, slide-left→slide-in-left, slide-right→slide-in-right, scale→scale-up. Valid Stagger presets: fade-in, slide-in-left, slide-in-right, slide-in-up, slide-in-down, scale-up. Invalid presets silently fall back to fade-in — flag and penalize.
3. **Score = delivered result only.** Note design intent vs. viewer experience separately. If video transcription is absent, cap motion scores — don't assume specs rendered.

Benchmark: Apple Keynote, CNN/Bloomberg lower thirds, HBO title sequences. Canvas is 1920x1080 broadcast. Standard: "would this look good on a 60-inch screen at a conference?"

## OUTPUT FORMAT

Use markdown headers. Embed **Score: X/10** inline in each section. Cite specific evidence (element keys, hex colors, font sizes, timing).

### Timing & Efficiency
Time to first visible content (15-30s good, 60+s poor). Incremental delivery vs batch. Visible content % of session time.

### Agent Strategy & Workflow
Catalog read efficiency. scenePatch vs sceneSet usage. Incremental delivery quality.

### Scene-by-Scene Walkthrough
Chronological changes: element keys, component types, prop values. Did each change advance the goal?

### Visual Design Quality
MOST IMPORTANT. Use screenshots/video transcription as primary evidence. Evaluate: space utilization (dead space = amateur), scale/presence (hero text 8-15% VH), typography, color, composition, hierarchy, component selection.

### Interactive Session (if applicable)
User message responsiveness and conversational loop quality.

### Runtime Errors
Classify each: agent-caused, platform bug, or benign. 10/10 if none.

### Scenario Compliance
Each requirement: met/partially/missed with evidence.

### Overall Verdict
Summary + **Overall Score: X/10**. Be harsh and specific.`

  const userPrompt = `## Scenario: ${result.scenario}

## Original Prompt Given to Agent
\`\`\`
${scenarioPrompt}
\`\`\`

## Session Facts
- Duration: ${(duration / 1000).toFixed(1)}s
- Tool calls: ${result.toolCalls.length}
- Scene mutations: ${resolvedSpecs.length}
- Exit code: ${result.exitCode}
- Component types used: ${componentTypesUsed.length > 0 ? componentTypesUsed.join(", ") : "(none)"}

## Timing Breakdown
${formatTimingBreakdown(timing)}

## Tool Call Timeline (relative to session start)
${formatToolTimeline(timing.toolTimeline)}

## Agent Workflow Analysis
${formatWorkflowAnalysis(workflow)}

## Tool Call Summary (counts)
${toolSummary}

## Errors Encountered
${errorDetails}

${userMessagesSection}
## ${videoSection}

${consoleErrorsSection}
${screenshotImages.length > 0 ? `## Screenshots\n\n${screenshotImages.length} screenshot(s) attached as images below. These are actual browser renders — use as ground truth.\n` : ""}
## Full Scene Spec Timeline (${resolvedSpecs.length} states)

${specTimeline}

## Full Tool Call Log (${result.toolCalls.length} calls)

${toolCallDetails}

---

Write your evaluation now. Cite specific evidence throughout. Embed scores in each section.`

  let rawOutput = ""
  try {
    // Debug: find what's eating tokens
    if (userPrompt.length > 50000) {
      const sections = [
        ["scenarioPrompt", scenarioPrompt.length],
        ["specTimeline", specTimeline.length],
        ["toolCallDetails", toolCallDetails.length],
        ["videoSection", videoSection.length],
        ["consoleErrorsSection", consoleErrorsSection.length],
        ["userMessagesSection", userMessagesSection.length],
        ["errorDetails", errorDetails.length],
        ["toolSummary", toolSummary.length],
        ["formatTimingBreakdown", formatTimingBreakdown(timing).length],
        ["formatToolTimeline", formatToolTimeline(timing.toolTimeline).length],
        ["formatWorkflowAnalysis", formatWorkflowAnalysis(workflow).length],
      ] as const
      console.log(`    [eval] LARGE PROMPT DEBUG (${userPrompt.length} chars):`)
      for (const [name, len] of sections) {
        console.log(`      ${name}: ${len} chars`)
      }
    }
    console.log(`    [eval] Text: ~${Math.round((systemPrompt.length + userPrompt.length) / 4)} tokens, images: ${screenshotImages.length}`)
    console.log("    [eval] Running evaluation (single pass)")
    rawOutput = await runEval(systemPrompt, userPrompt, screenshotImages)
  } catch (err) {
    rawOutput = `Evaluation failed: ${err instanceof Error ? err.message : String(err)}`
  }

  const markdown = `# Evaluation: ${result.scenario}

**Session:** ${result.sessionId}
**Duration:** ${(duration / 1000).toFixed(1)}s | **Tool Calls:** ${result.toolCalls.length} | **Scene Mutations:** ${result.sceneSnapshots.length} | **Exit Code:** ${result.exitCode}
**Time to first scene:** ${timing.timeToFirstSceneSec !== null ? timing.timeToFirstSceneSec.toFixed(1) + "s" : "never"} | **Components:** ${componentTypesUsed.length > 0 ? componentTypesUsed.join(", ") : "none"} | **Timeline:** ${workflow.usedTimeline ? "yes" : "no"}
**Catalog reads:** ${timing.catalogReadCount} (~${timing.catalogReadTimeSec.toFixed(1)}s) | **Scene ops:** ${workflow.sceneSetCount} sets, ${workflow.patchCount} patches | **Screenshots:** ${workflow.screenshotCount} | **Validates:** ${workflow.validateCount}
**Max elements:** ${workflow.maxElementCount} | **Children wired:** ${workflow.containerChildrenUsed ? "yes" : "no"} | **State bindings:** ${workflow.stateBindingsUsed ? "yes" : "no"}

---

${rawOutput}
`
  fs.writeFileSync(path.join(outputDir, "evaluation.md"), markdown)

  return { rawOutput }
}
