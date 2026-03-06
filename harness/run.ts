import "dotenv/config"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execFileSync } from "child_process"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { loadScenario, createStage, destroyStage, connectMCP } from "./lib/scenario"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
import { SceneObserver } from "./lib/scene-observer"
import { runAgent, runInteractiveAgent } from "./lib/agent"
import type { AgentCallbacks, AgentResult } from "./lib/agent"
import { evaluate } from "./lib/evaluator"
import { Logger } from "./lib/logger"
import { generateReplay } from "./lib/replay"
import { HlsCapture } from "./lib/hls-capture"
import { transcribeVideo } from "./lib/video-transcriber"
import { SessionResult, SessionMeta, UserMessage, StreamEvent, ToolCall, ScenarioConfig, SceneSnapshot } from "./lib/types"

const SCENARIOS_DIR = path.resolve(__dirname, "scenarios")
const SESSIONS_DIR = path.resolve(__dirname, "sessions")

// Environment
const DAZZLE_URL = process.env.DAZZLE_URL
const DAZZLE_API_KEY = process.env.DAZZLE_API_KEY

/**
 * Get the duration of an MP4 video in seconds using ffprobe.
 */
function getVideoDuration(mp4Path: string): number {
  try {
    const output = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      mp4Path,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    })
    return parseFloat(output.toString().trim()) || 0
  } catch {
    return 0
  }
}

/**
 * Extract keyframes from an MP4 video using ffmpeg scene detection.
 */
function extractKeyframes(mp4Path: string, outputDir: string): string[] {
  try {
    const existing = fs.readdirSync(outputDir).filter((f) => f.match(/^screenshot-\d+/))
    for (const f of existing) {
      fs.unlinkSync(path.join(outputDir, f))
    }
  } catch { /* ignore */ }

  const MAX_FRAMES = 8
  const thresholds = [0.1, 0.05, 0.03]

  for (const threshold of thresholds) {
    try {
      const pattern = path.join(outputDir, "screenshot-%02d.jpg")
      execFileSync("ffmpeg", [
        "-y", "-i", mp4Path,
        "-vf", `select='gt(scene,${threshold})',scale=480:270`,
        "-vsync", "vfr", "-q:v", "8", pattern,
      ], { stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 })

      const frames = fs.readdirSync(outputDir)
        .filter((f) => f.match(/^screenshot-\d+\.jpg$/))
        .sort()

      if (frames.length >= 3 && frames.length <= MAX_FRAMES) {
        console.log(`  [keyframes] Extracted ${frames.length} keyframes (threshold=${threshold})`)
        return frames.map((f) => path.join(outputDir, f))
      }

      if (frames.length > MAX_FRAMES) {
        const sampled: string[] = []
        for (let i = 0; i < MAX_FRAMES; i++) {
          const idx = Math.round((i * (frames.length - 1)) / (MAX_FRAMES - 1))
          sampled.push(frames[idx])
        }
        for (const f of frames) {
          if (!sampled.includes(f)) {
            try { fs.unlinkSync(path.join(outputDir, f)) } catch { /* */ }
          }
        }
        console.log(`  [keyframes] Extracted ${sampled.length} keyframes (sampled from ${frames.length})`)
        return sampled.map((f) => path.join(outputDir, f))
      }

      for (const f of frames) {
        try { fs.unlinkSync(path.join(outputDir, f)) } catch { /* */ }
      }
    } catch { /* try next threshold */ }
  }

  // Fallback: first, middle, last
  const duration = getVideoDuration(mp4Path)
  if (duration <= 0) return []

  const positions = [1, duration / 2, Math.max(1, duration - 1)]
  const extractedPaths: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const filename = `screenshot-${String(i + 1).padStart(2, "0")}.jpg`
    const outputPath = path.join(outputDir, filename)
    try {
      execFileSync("ffmpeg", [
        "-y", "-ss", positions[i].toFixed(3),
        "-i", mp4Path, "-vframes", "1",
        "-q:v", "8", "-vf", "scale=480:270", outputPath,
      ], { stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 })
      if (fs.existsSync(outputPath)) extractedPaths.push(outputPath)
    } catch { /* */ }
  }
  return extractedPaths
}

function listAvailableScenarios(): string[] {
  if (!fs.existsSync(SCENARIOS_DIR)) return []
  return fs
    .readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m > 0 ? `${m}m ${rem}s` : `${s}s`
}

function buildMeta(result: SessionResult): SessionMeta {
  const durationMs = result.endTime - result.startTime

  const toolCallSummary: Record<string, number> = {}
  for (const tc of result.toolCalls) {
    toolCallSummary[tc.tool] = (toolCallSummary[tc.tool] || 0) + 1
  }

  let snapshotTypeCount = 0
  let scriptTypeCount = 0
  for (const s of result.sceneSnapshots) {
    const scene = s.scene as Record<string, unknown>
    if (scene.type === "snapshot") snapshotTypeCount++
    else if (scene.type === "script") scriptTypeCount++
  }

  const firstScene = result.sceneSnapshots.length > 0 ? result.sceneSnapshots[0].scene : null
  const lastScene = result.sceneSnapshots.length > 0
    ? result.sceneSnapshots[result.sceneSnapshots.length - 1].scene
    : null

  return {
    scenario: result.scenario,
    sessionId: result.sessionId,
    stageId: result.stageId,
    startTime: result.startTime,
    endTime: result.endTime,
    durationMs,
    durationFormatted: formatDuration(durationMs),
    toolCallCount: result.toolCalls.length,
    snapshotCount: result.sceneSnapshots.length,
    exitCode: result.exitCode,
    evaluationPath: result.evaluationPath,
    videoPath: result.videoPath,
    videoTranscriptionPath: result.videoTranscription ? "video-transcription.md" : undefined,
    toolCallSummary,
    snapshotsByType: { snapshot: snapshotTypeCount, script: scriptTypeCount },
    firstScene,
    lastScene,
  }
}

function saveSession(result: SessionResult, outputDir: string, streamEvents?: StreamEvent[]): void {
  fs.mkdirSync(outputDir, { recursive: true })

  if (streamEvents && streamEvents.length > 0) {
    const eventLines = streamEvents.map((ev) => JSON.stringify(ev))
    fs.writeFileSync(path.join(outputDir, "stream.jsonl"), eventLines.join("\n") + "\n")
  } else {
    const toolLines = result.toolCalls.map((tc) => JSON.stringify(tc))
    fs.writeFileSync(path.join(outputDir, "stream.jsonl"), toolLines.join("\n") + (toolLines.length > 0 ? "\n" : ""))
  }

  const sceneLines = result.sceneSnapshots.map((s) => JSON.stringify(s))
  fs.writeFileSync(path.join(outputDir, "scenes.jsonl"), sceneLines.join("\n") + (sceneLines.length > 0 ? "\n" : ""))

  const meta = buildMeta(result)
  fs.writeFileSync(path.join(outputDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n")

  if (result.userMessages && result.userMessages.length > 0) {
    const msgLines = result.userMessages.map((m) => JSON.stringify(m))
    fs.writeFileSync(path.join(outputDir, "user-messages.jsonl"), msgLines.join("\n") + "\n")
  }

  generateReplay(result, outputDir)
}

function createStreamCollector(startTime: number) {
  const events: StreamEvent[] = []
  const pendingToolCalls: Map<number, { tool: string; startTime: number }> = new Map()
  let toolCallIndex = 0
  const elapsed = () => parseFloat(((Date.now() - startTime) / 1000).toFixed(1))

  return {
    events,
    onThinking(charCount: number) {
      events.push({ type: "thinking", timestamp: Date.now(), elapsed: elapsed(), char_count: charCount })
    },
    onToolCall(call: ToolCall) {
      const idx = toolCallIndex++
      pendingToolCalls.set(idx, { tool: call.tool, startTime: Date.now() })
      events.push({ type: "tool_call", timestamp: Date.now(), elapsed: elapsed(), tool: call.tool, input: call.args })
    },
    onToolResult(toolName: string, result: unknown, durationMs: number) {
      let truncatedResult = result
      const resultStr = typeof result === "string" ? result : JSON.stringify(result)
      if (resultStr && resultStr.length > 500) {
        truncatedResult = resultStr.slice(0, 500) + `... (${resultStr.length} chars)`
      }
      events.push({ type: "tool_result", timestamp: Date.now(), elapsed: elapsed(), tool: toolName, result: truncatedResult, duration_ms: durationMs })
    },
    onText(text: string) {
      if (!text) return
      events.push({ type: "text", timestamp: Date.now(), elapsed: elapsed(), text: text.length > 500 ? text.slice(0, 500) + "..." : text })
    },
    onSystem(subtype: string, data: Record<string, unknown>) {
      events.push({ type: "system", timestamp: Date.now(), elapsed: elapsed(), subtype, data })
    },
  }
}

function effortToThinkingBudget(effort?: "low" | "medium" | "high"): number | undefined {
  switch (effort) {
    case "high": return 10000
    case "medium": return 5000
    default: return undefined
  }
}

async function runScenario(
  scenarioName: string,
  dazzleUrl: string,
  apiKey: string,
): Promise<SessionResult> {
  const config = loadScenario(scenarioName)
  const prompt = fs.readFileSync(config.promptPath, "utf-8")
  const useInteractive = config.interactive && config.userPersona

  const platformPrompt = `CRITICAL DELIVERY RULES — BROADCAST PACING:

You are producing broadcast motion graphics, not a slideshow. The viewer is watching a live 1920x1080 canvas.

DELIVERY PATTERN:
- Use sceneSet for the FIRST scene and for MAJOR segment transitions.
- Use scenePatch to BUILD within a scene — add elements, reveal stats, update data.
- Use stateSet to update state values (e.g. counters, text) without changing structure.
- Keep wait times SHORT: 1-3 seconds. Never wait longer than 5 seconds.
- Aim for a visual change every 3-8 seconds.

RULES:
1. Call sceneSet IMMEDIATELY. Do NOT plan all scenes first.
2. Think like a narrator: each tool call = one beat. Build the story incrementally.
3. scenePatch modifies the current scene without replacing it. Use it to layer content.
4. A blank screen for more than 15 seconds is a failure.
5. This is motion graphics, not a website.`

  const finalAppendPrompt = config.appendSystemPrompt
    ? `${platformPrompt}\n\n${config.appendSystemPrompt}`
    : platformPrompt

  const modeLabel = useInteractive ? "interactive" : "standard"
  console.log(`\n--- Running scenario: ${scenarioName} (${modeLabel}) ---`)

  const { stageId } = await createStage(config, dazzleUrl, apiKey)
  console.log(`  Stage ID: ${stageId}`)

  const startTime = Date.now()
  const isoTime = new Date(startTime).toISOString().replace(/[:.]/g, "-").slice(0, 19)
  const sessionId = `${isoTime}-${scenarioName}`
  const logger = new Logger(startTime)
  const collector = createStreamCollector(startTime)

  const outputDir = path.join(SESSIONS_DIR, sessionId)
  fs.mkdirSync(outputDir, { recursive: true })

  // HLS video capture
  const hlsUrl = `${dazzleUrl}/stage/${stageId}/hls/stream.m3u8`
  const hlsCapture = new HlsCapture(hlsUrl, outputDir, apiKey)

  // Scene observer via MCP get_script polling
  const observerMcp = new Client({ name: "harness-observer", version: "0.1.0" })
  const observerTransport = new StreamableHTTPClientTransport(
    new URL(`${dazzleUrl}/stage/${stageId}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
  )
  await observerMcp.connect(observerTransport)
  const sceneObserverClient = {
    async callTool(name: string, args: Record<string, unknown>) {
      return observerMcp.callTool({ name, arguments: args })
    },
  }
  const sceneObserver = new SceneObserver(sceneObserverClient)

  // Delay capture start
  const captureStartPromise = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    try { hlsCapture.start() } catch (err) {
      console.warn(`  [hls] capture start error: ${err instanceof Error ? err.message : err}`)
    }
    sceneObserver.start()
  })()

  let lastSnapshotCount = 0
  const snapshotCheckInterval = setInterval(() => {
    const snaps = sceneObserver.getSnapshots()
    for (let i = lastSnapshotCount; i < snaps.length; i++) {
      logger.sceneMutation(snaps[i])
    }
    lastSnapshotCount = snaps.length
  }, 500)

  let toolCalls: ToolCall[] = []
  let exitCode: number | null = null
  let userMessages: UserMessage[] | undefined

  const agentCallbacks: AgentCallbacks = {
    onToolCall: (toolName, args) => {
      const call: ToolCall = { tool: toolName, args, timestamp: Date.now() }
      logger.toolCall(call)
      collector.onToolCall(call)
    },
    onToolResult: (toolName, result, durationMs) => {
      collector.onToolResult(toolName, result, durationMs)
    },
    onThinking: (text) => {
      collector.onThinking(text.length)
    },
    onText: (text) => {
      collector.onText(text)
    },
    onStepFinish: (stepNumber, stepToolCalls, usage) => {
      collector.onSystem("step_finish", { stepNumber, toolCalls: stepToolCalls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
    },
  }

  const thinkingBudget = effortToThinkingBudget(config.effort)

  try {
    if (useInteractive) {
      console.log(`  User persona: ${config.userPersona!.slice(0, 80)}...`)

      const getLatestScene = (): Record<string, unknown> | null => {
        const snaps = sceneObserver.getSnapshots()
        return snaps.length > 0 ? snaps[snaps.length - 1].scene as Record<string, unknown> : null
      }

      let agentResult: AgentResult
      try {
        agentResult = await runInteractiveAgent(prompt, {
          stageId, dazzleUrl, apiKey,
          model: config.model,
          thinkingBudget,
          appendSystemPrompt: finalAppendPrompt,
          callbacks: agentCallbacks,
          userPersona: config.userPersona!,
          getLatestScene,
          simulatorCooldownMs: 5000,
        })
        exitCode = 0
      } catch (err) {
        console.error(`  Agent error: ${err instanceof Error ? err.message : err}`)
        agentResult = { toolCalls: [], text: "", steps: 0, finishReason: "error", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
        exitCode = 1
      }

      toolCalls = agentResult.toolCalls
      userMessages = undefined
      console.log(`  Interactive session complete (${agentResult.steps} steps, ${agentResult.finishReason})`)
    } else {
      let agentResult: AgentResult
      try {
        agentResult = await runAgent(prompt, {
          stageId, dazzleUrl, apiKey,
          model: config.model,
          thinkingBudget,
          appendSystemPrompt: finalAppendPrompt,
          callbacks: agentCallbacks,
        })
        exitCode = 0
      } catch (err) {
        console.error(`  Agent error: ${err instanceof Error ? err.message : err}`)
        agentResult = { toolCalls: [], text: "", steps: 0, finishReason: "error", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
        exitCode = 1
      }

      toolCalls = agentResult.toolCalls
    }
  } finally {
    await captureStartPromise
    clearInterval(snapshotCheckInterval)
  }

  const endTime = Date.now()
  const snapshots = sceneObserver.getSnapshots()
  sceneObserver.stop()
  await observerMcp.close().catch(() => {})

  const videoPath = await hlsCapture.stop()

  let screenshotPaths: string[] = []
  if (videoPath && fs.existsSync(videoPath) && videoPath.endsWith(".mp4")) {
    screenshotPaths = extractKeyframes(videoPath, outputDir)
  }

  for (let i = lastSnapshotCount; i < snapshots.length; i++) {
    logger.sceneMutation(snapshots[i])
  }

  logger.summary(toolCalls, snapshots, exitCode, endTime - startTime)

  const sessionResult: SessionResult = {
    scenario: scenarioName,
    sessionId,
    stageId,
    startTime,
    endTime,
    toolCalls,
    sceneSnapshots: snapshots,
    exitCode,
    scenarioDir: path.join(SCENARIOS_DIR, scenarioName),
    scenarioPrompt: prompt,
    userMessages,
    videoPath: videoPath ?? undefined,
    screenshotPaths: screenshotPaths.length > 0 ? screenshotPaths : undefined,
  }

  saveSession(sessionResult, outputDir, collector.events)
  console.log(`  Session saved to ${outputDir}`)

  // Video transcription
  let transcriptionFailed = false
  if (videoPath && fs.existsSync(videoPath)) {
    try {
      const transcriptionResult = await transcribeVideo(videoPath, outputDir)
      if (transcriptionResult) {
        sessionResult.videoTranscription = transcriptionResult.transcription
      }
    } catch (err) {
      transcriptionFailed = true
      console.error(`\n  FAILED: Video transcription error: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Evaluation
  if (transcriptionFailed) {
    console.error(`\n  Evaluation skipped: video transcription failed.`)
  } else {
    console.log(`  Running evaluation...`)
    await evaluate(sessionResult, outputDir)
    sessionResult.evaluationPath = path.join(outputDir, "evaluation.md")
    saveSession(sessionResult, outputDir, collector.events)
    console.log(`  Evaluation written to evaluation.md`)
  }

  // Destroy the stage
  await destroyStage(stageId, dazzleUrl, apiKey)

  return sessionResult
}

function findLatestSessions(): Map<string, { scenario: string; sessionDir: string; outputDir: string }> {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.error("No sessions directory found")
    process.exit(1)
  }

  const sessions = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()

  const latestByScenario = new Map<string, { scenario: string; sessionDir: string; outputDir: string }>()
  for (const session of sessions) {
    const scenarioName = session.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, "")
    latestByScenario.set(scenarioName, { scenario: scenarioName, sessionDir: session, outputDir: path.join(SESSIONS_DIR, session) })
  }
  return latestByScenario
}

function loadSessionResult(scenario: string, outputDir: string): SessionResult | null {
  const metaPath = path.join(outputDir, "meta.json")
  const streamPath = path.join(outputDir, "stream.jsonl")
  const scenesPath = path.join(outputDir, "scenes.jsonl")

  if (!fs.existsSync(metaPath)) return null

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))

  const toolCalls: ToolCall[] = fs.existsSync(streamPath)
    ? fs.readFileSync(streamPath, "utf-8").split("\n").filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((ev: Record<string, unknown>) => ev.type === "tool_call")
        .map((ev: Record<string, unknown>) => ({ tool: ev.tool as string, args: (ev.input || ev.args || {}) as Record<string, unknown>, timestamp: ev.timestamp as number }))
    : []

  const sceneSnapshots = fs.existsSync(scenesPath)
    ? fs.readFileSync(scenesPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : []

  const scenarioDir = path.join(SCENARIOS_DIR, scenario)
  const promptPath = path.join(scenarioDir, "prompt.md")
  const scenarioPrompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, "utf-8") : undefined

  const videoTranscriptionPath = path.join(outputDir, "video-transcription.md")
  const videoTranscription = fs.existsSync(videoTranscriptionPath) ? fs.readFileSync(videoTranscriptionPath, "utf-8") : undefined

  const userMessagesPath = path.join(outputDir, "user-messages.jsonl")
  const userMessages = fs.existsSync(userMessagesPath)
    ? fs.readFileSync(userMessagesPath, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : undefined

  const screenshotPaths: string[] = []
  try {
    const files = fs.readdirSync(outputDir).filter((f) => f.match(/^screenshot-\d+/)).sort()
    for (const f of files) screenshotPaths.push(path.join(outputDir, f))
  } catch { /* */ }

  return {
    scenario,
    sessionId: meta.sessionId,
    stageId: meta.stageId ?? "",
    startTime: meta.startTime,
    endTime: meta.endTime,
    toolCalls,
    sceneSnapshots,
    exitCode: meta.exitCode,
    scenarioDir: fs.existsSync(scenarioDir) ? scenarioDir : undefined,
    scenarioPrompt,
    userMessages,
    videoPath: meta.videoPath,
    videoTranscription,
    screenshotPaths: screenshotPaths.length > 0 ? screenshotPaths : undefined,
  }
}

async function runTranscribeOnly(): Promise<void> {
  const latestByScenario = findLatestSessions()
  let transcribed = 0, skipped = 0, failed = 0

  for (const [scenario, { outputDir }] of latestByScenario) {
    const result = loadSessionResult(scenario, outputDir)
    if (!result) continue

    if (!result.videoPath || !fs.existsSync(result.videoPath)) { skipped++; continue }
    if (fs.existsSync(path.join(outputDir, "video-transcription.md"))) { skipped++; continue }

    console.log(`Transcribing: ${scenario}`)
    try {
      const tr = await transcribeVideo(result.videoPath, outputDir)
      if (tr) { transcribed++; console.log(`  Saved to ${tr.outputPath}`) }
    } catch (err) {
      console.error(`  FAILED: ${err instanceof Error ? err.message : err}`)
      failed++
    }
  }

  console.log(`\nTranscription: ${transcribed} done, ${skipped} skipped, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

/**
 * Replay scene snapshots onto a live stage and capture screenshots after each scene set.
 * Returns paths to the captured screenshot files.
 */
async function replayAndScreenshot(
  sceneSnapshots: SceneSnapshot[],
  stageId: string,
  dazzleUrl: string,
  apiKey: string,
  outputDir: string,
): Promise<string[]> {
  const client = await connectMCP(dazzleUrl, stageId, apiKey)
  const screenshotPaths: string[] = []

  try {
    // Ensure the stage is started (idempotent)
    await client.callTool({ name: "start", arguments: {} })

    let screenshotIndex = 0
    for (const snap of sceneSnapshots) {
      const scene = snap.scene as Record<string, unknown>

      if (scene.type === "snapshot" && scene.spec) {
        await client.callTool({ name: "sceneSet", arguments: { spec: scene.spec as Record<string, unknown> } })
      } else if (scene.type === "patch" && scene.patches) {
        await client.callTool({ name: "scenePatch", arguments: { patches: scene.patches as unknown[] } })
      } else {
        continue
      }

      // Brief pause for the renderer to paint
      await new Promise((r) => setTimeout(r, 500))

      // Take screenshot
      try {
        const ssResult = await client.callTool({ name: "screenshot", arguments: {} })
        const imageContent = (ssResult.content as Array<{ type: string; data?: string; mimeType?: string }>)
          ?.find(c => c.type === "image")
        if (imageContent?.data) {
          screenshotIndex++
          const filename = `screenshot-${String(screenshotIndex).padStart(2, "0")}.jpg`
          const filepath = path.join(outputDir, filename)
          fs.writeFileSync(filepath, Buffer.from(imageContent.data, "base64"))
          screenshotPaths.push(filepath)
        }
      } catch (err) {
        console.warn(`    [replay] Screenshot failed: ${err instanceof Error ? err.message : err}`)
      }
    }
  } finally {
    await client.close().catch(() => {})
  }

  return screenshotPaths
}

async function runEvalOnly(): Promise<void> {
  if (!DAZZLE_URL) { console.error("Error: DAZZLE_URL required for --eval (need a live stage for screenshots)"); process.exit(1) }
  if (!DAZZLE_API_KEY) { console.error("Error: DAZZLE_API_KEY required for --eval"); process.exit(1) }

  const latestByScenario = findLatestSessions()
  let evaluated = 0, failed = 0

  // Find or create a stage to use for replay
  const { stageId } = await createStage(
    { name: "eval", promptPath: "", seedPath: null } as ScenarioConfig,
    DAZZLE_URL,
    DAZZLE_API_KEY,
  )
  console.log(`Eval stage: ${stageId}`)

  try {
    for (const [scenario, { outputDir }] of latestByScenario) {
      const result = loadSessionResult(scenario, outputDir)
      if (!result) continue

      console.log(`Re-evaluating: ${scenario}`)

      // Replay scenes onto live stage and capture screenshots
      if (result.sceneSnapshots.length > 0) {
        console.log(`  Replaying ${result.sceneSnapshots.length} scene(s) for live screenshots...`)
        try {
          const screenshots = await replayAndScreenshot(
            result.sceneSnapshots, stageId, DAZZLE_URL!, DAZZLE_API_KEY!, outputDir,
          )
          if (screenshots.length > 0) {
            result.screenshotPaths = screenshots
            console.log(`  Captured ${screenshots.length} screenshot(s)`)
          }
        } catch (err) {
          console.error(`  Replay failed: ${err instanceof Error ? err.message : err}`)
        }
      }

      // Fall back to video transcription if no screenshots from replay
      if (!result.screenshotPaths || result.screenshotPaths.length === 0) {
        const hasVideo = result.videoPath && fs.existsSync(result.videoPath)
        const vtPath = path.join(outputDir, "video-transcription.md")

        if (hasVideo && !fs.existsSync(vtPath)) {
          try {
            const tr = await transcribeVideo(result.videoPath!, outputDir)
            if (tr) result.videoTranscription = tr.transcription
          } catch (err) {
            console.error(`  Transcription failed: ${err instanceof Error ? err.message : err}`)
          }
        } else if (fs.existsSync(vtPath) && !result.videoTranscription) {
          result.videoTranscription = fs.readFileSync(vtPath, "utf-8")
        }
      }

      try {
        await evaluate(result, outputDir)
      } catch (err) { console.error(`  FAILED: ${err instanceof Error ? err.message : err}`); failed++; continue }

      try { generateReplay(result, outputDir) } catch { /* */ }
      const newMeta = buildMeta(result)
      newMeta.evaluationPath = path.join(outputDir, "evaluation.md")
      fs.writeFileSync(path.join(outputDir, "meta.json"), JSON.stringify(newMeta, null, 2) + "\n")
      evaluated++
    }
  } finally {
    // Tear down the stage
    await destroyStage(stageId, DAZZLE_URL!, DAZZLE_API_KEY!)
  }

  console.log(`\nEvaluation: ${evaluated} done, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const isParallel = args.includes("--parallel")
  const isEvalOnly = args.includes("--eval")
  const isTranscribeOnly = args.includes("--transcribe")

  if (isTranscribeOnly) { await runTranscribeOnly(); return }
  if (isEvalOnly) { await runEvalOnly(); return }

  if (!DAZZLE_URL) { console.error("Error: DAZZLE_URL environment variable is required"); process.exit(1) }
  if (!DAZZLE_API_KEY) { console.error("Error: DAZZLE_API_KEY environment variable is required"); process.exit(1) }

  const scenarios: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) continue
    scenarios.push(args[i])
  }

  if (scenarios.length === 0) {
    const available = listAvailableScenarios()
    console.error("Error: no scenarios specified.\n")
    if (available.length > 0) {
      console.error("Available scenarios:")
      for (const name of available) console.error(`  ${name}`)
      console.error(`\nUsage: npx tsx run.ts <scenario> [scenario ...] [--parallel]`)
    }
    process.exit(1)
  }

  console.log(`Running ${scenarios.length} scenario(s)${isParallel ? " in parallel" : " sequentially"} against ${DAZZLE_URL}`)

  if (isParallel) {
    await Promise.all(scenarios.map((name) => runScenario(name, DAZZLE_URL!, DAZZLE_API_KEY!)))
  } else {
    for (const name of scenarios) {
      await runScenario(name, DAZZLE_URL!, DAZZLE_API_KEY!)
    }
  }

  console.log("\nAll scenarios complete.")
}

main().catch((err) => { console.error("Harness failed:", err); process.exit(1) })
