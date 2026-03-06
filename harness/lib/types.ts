export interface ToolCall {
  tool: string
  args: Record<string, unknown>
  result?: unknown
  timestamp: number
}

/** A wire-format scene message captured from WebSocket. */
export interface SceneMessage {
  type: string
  spec?: Record<string, unknown>
  patches?: Array<{ op: string; path: string; value?: unknown }>
  [key: string]: unknown
}

export interface SceneSnapshot {
  scene: SceneMessage
  timestamp: number
  mutationIndex: number
}

export interface UserMessage {
  content: string
  timestamp: number
}

export interface SessionResult {
  scenario: string
  sessionId: string
  stageId: string
  startTime: number
  endTime: number
  toolCalls: ToolCall[]
  sceneSnapshots: SceneSnapshot[]
  exitCode: number | null
  evaluationPath?: string
  scenarioDir?: string
  scenarioPrompt?: string
  userMessages?: UserMessage[]
  videoPath?: string
  videoTranscription?: string
  screenshotPaths?: string[]
  consoleErrors?: { timestamp: number; text: string }[]
}

export interface ScenarioConfig {
  name: string
  promptPath: string
  seedPath: string | null
  interactive?: boolean
  userPersona?: string
  allowedTools?: string[]
  model?: string
  effort?: "low" | "medium" | "high"
  appendSystemPrompt?: string
}

export interface SessionMeta {
  scenario: string
  sessionId: string
  stageId: string
  startTime: number
  endTime: number
  durationMs: number
  durationFormatted: string
  toolCallCount: number
  snapshotCount: number
  exitCode: number | null
  evaluationPath?: string
  videoPath?: string
  videoTranscriptionPath?: string
  toolCallSummary: Record<string, number>
  snapshotsByType: Record<string, number>
  firstScene: SceneMessage | null
  lastScene: SceneMessage | null
}

export interface EvaluationResult {
  rawOutput: string
}

// ─── Stream events for session observability ───

export interface StreamEventBase {
  timestamp: number
  elapsed: number // seconds since session start, as a float
}

export interface ThinkingEvent extends StreamEventBase {
  type: "thinking"
  char_count: number
}

export interface ToolCallEvent extends StreamEventBase {
  type: "tool_call"
  tool: string
  input: Record<string, unknown>
}

export interface ToolResultEvent extends StreamEventBase {
  type: "tool_result"
  tool: string
  result: unknown
  duration_ms: number
}

export interface TextEvent extends StreamEventBase {
  type: "text"
  text: string
}

export interface SystemEvent extends StreamEventBase {
  type: "system"
  subtype: string
  data?: Record<string, unknown>
}

export type StreamEvent =
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent
  | TextEvent
  | SystemEvent
