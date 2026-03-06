import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

let _openrouter: ReturnType<typeof createOpenAI> | null = null
function getOpenRouter() {
  if (!_openrouter) {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for interactive mode (UserSimulator)")
    _openrouter = createOpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey })
  }
  return _openrouter
}

const isTTY = process.stdout.isTTY === true
const RESET = isTTY ? "\x1b[0m" : ""
const DIM = isTTY ? "\x1b[2m" : ""
const BLUE = isTTY ? "\x1b[34m" : ""
const BOLD = isTTY ? "\x1b[1m" : ""

interface ConversationEntry {
  role: "user" | "assistant"
  content: string
  timestamp: number
}

export class UserSimulator {
  private persona: string
  private sendMessage: (text: string) => void
  private getLatestScene: () => Record<string, unknown> | null
  private history: ConversationEntry[] = []
  private lastMessageTime = 0
  private cooldownMs: number
  private startTime: number

  constructor(
    persona: string,
    sendMessage: (text: string) => void,
    getLatestScene: () => Record<string, unknown> | null,
    options?: { cooldownMs?: number }
  ) {
    this.persona = persona
    this.sendMessage = sendMessage
    this.getLatestScene = getLatestScene
    this.cooldownMs = options?.cooldownMs ?? 5000
    this.startTime = Date.now()
  }

  private elapsed(): string {
    const s = ((Date.now() - this.startTime) / 1000).toFixed(1)
    return `${DIM}[${s.padStart(6)}s]${RESET}`
  }

  /**
   * Called periodically to decide if the simulated user should respond.
   * Uses a separate `claude -p` call to generate the user's response.
   */
  async evaluate(): Promise<void> {
    // Enforce cooldown
    const now = Date.now()
    if (now - this.lastMessageTime < this.cooldownMs) {
      return
    }

    const scene = this.getLatestScene()
    if (!scene) {
      // No scene yet, nothing to react to
      return
    }

    const prompt = this.buildPrompt(scene)

    try {
      const response = await this.runClaude(prompt)
      if (!response || response.trim().length === 0) {
        return
      }

      // Parse the response — look for a message to send
      const parsed = this.parseResponse(response)
      if (parsed) {
        this.lastMessageTime = Date.now()
        console.log(
          `  ${this.elapsed()} ${BLUE}${BOLD}user-sim${RESET} ${DIM}→${RESET} ${parsed}`
        )
        this.history.push({
          role: "user",
          content: parsed,
          timestamp: Date.now(),
        })
        this.sendMessage(parsed)
      }
    } catch (err) {
      console.warn(
        `  ${this.elapsed()} ${BLUE}user-sim${RESET} ${DIM}error: ${err}${RESET}`
      )
    }
  }

  /**
   * Record an observation about what the assistant is doing (from stream events).
   */
  recordAssistantAction(description: string): void {
    this.history.push({
      role: "assistant",
      content: description,
      timestamp: Date.now(),
    })
  }

  private buildPrompt(scene: Record<string, unknown>): string {
    const sceneStr = JSON.stringify(scene, null, 2)

    const historyStr =
      this.history.length > 0
        ? this.history
            .slice(-10) // keep last 10 entries for context
            .map(
              (e) =>
                `[${e.role}] ${e.content}`
            )
            .join("\n")
        : "(no conversation yet)"

    return `You are simulating a user interacting with an AI agent that is building a visual scene.

## Your Persona
${this.persona}

## Current Scene State
\`\`\`json
${sceneStr}
\`\`\`

## Conversation History
${historyStr}

## Instructions
Based on the current scene and your persona, decide whether the user would want to say something right now.

If the scene presents choices, options, or interactive elements that the user should respond to, generate the user's response.
If the scene is still loading or the agent is clearly in the middle of building something, respond with WAIT (the user would not interrupt).

Rules:
- If you decide the user SHOULD respond, output ONLY the user's message text on a single line, prefixed with "SAY: "
- If you decide the user should NOT respond yet, output only "WAIT"
- Stay in character as the persona described above
- Keep responses concise (1-3 sentences max)
- Do not use any other format — just "SAY: <message>" or "WAIT"`
  }

  private parseResponse(response: string): string | null {
    const trimmed = response.trim()

    // Check for SAY: prefix
    const sayMatch = trimmed.match(/^SAY:\s*(.+)$/s)
    if (sayMatch) {
      return sayMatch[1].trim()
    }

    // If the response is just "WAIT", the user doesn't want to speak
    if (trimmed === "WAIT") {
      return null
    }

    // If neither format, try to be lenient — if it starts with SAY on any line
    const lines = trimmed.split("\n")
    for (const line of lines) {
      const lineMatch = line.match(/^SAY:\s*(.+)$/)
      if (lineMatch) {
        return lineMatch[1].trim()
      }
    }

    return null
  }

  private async runClaude(prompt: string): Promise<string> {
    const { text } = await generateText({
      model: getOpenRouter()("anthropic/claude-sonnet-4.6"),
      prompt,
    })
    return text.trim()
  }
}
