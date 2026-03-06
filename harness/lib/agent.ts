import { createMCPClient } from "@ai-sdk/mcp"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  streamText,
  generateText,
  tool,
  hasToolCall,
  stepCountIs,
  type ModelMessage,
} from "ai"
import {
  anthropic,
  type AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic"
import { z } from "zod"
import type { ToolCall } from "./types"
import { UserSimulator } from "./user-simulator"

// ─── Callbacks ───

export interface AgentCallbacks {
  onToolCall?: (toolName: string, args: Record<string, unknown>) => void
  onToolResult?: (
    toolName: string,
    result: unknown,
    durationMs: number,
  ) => void
  onThinking?: (text: string) => void
  onText?: (text: string) => void
  onStepFinish?: (
    stepNumber: number,
    toolCalls: number,
    usage: { inputTokens: number; outputTokens: number },
  ) => void
}

// ─── Options ───

export interface AgentOptions {
  stageId: string
  dazzleUrl: string
  apiKey: string
  model?: string
  thinkingBudget?: number
  maxSteps?: number
  systemPrompt?: string
  appendSystemPrompt?: string
  callbacks?: AgentCallbacks
}

// ─── Result ───

export interface AgentResult {
  toolCalls: ToolCall[]
  text: string
  steps: number
  finishReason: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
}

// ─── Interactive options ───

export interface InteractiveAgentOptions extends AgentOptions {
  /** User persona string — the interactive agent constructs the simulator internally */
  userPersona: string
  /** Callback to get the latest scene state for the simulator */
  getLatestScene: () => Record<string, unknown> | null
  maxTurns?: number
  /** Cooldown between simulator evaluations in ms (default: 5000) */
  simulatorCooldownMs?: number
}

// ─── Local tools ───

const waitTool = tool({
  description:
    "Pause for 1-3 seconds between visual changes. Longer pauses make the broadcast " +
    "feel dead. The viewer should never stare at a static screen for more than 5 seconds.",
  inputSchema: z.object({
    seconds: z
      .number()
      .min(0.5)
      .max(10)
      .describe("How long to wait in seconds (1-3 recommended)"),
    reason: z
      .string()
      .optional()
      .describe("Why we're waiting (for logging)"),
  }),
  execute: async ({ seconds, reason }) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    return `Waited ${seconds}s${reason ? `: ${reason}` : ""}`
  },
})

const doneTool = tool({
  description:
    "Call this when you have finished producing all scenes and the stream is complete.",
  inputSchema: z.object({
    summary: z.string().describe("Brief summary of what was produced"),
  }),
  // No execute — hasToolCall('done') stops the loop before execution
})

// ─── Helpers ───

async function createMCP(dazzleUrl: string, stageId: string, apiKey: string) {
  const mcpClient = await createMCPClient({
    transport: new StreamableHTTPClientTransport(
      new URL(`${dazzleUrl}/stage/${stageId}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
    ),
  })
  return mcpClient
}

function buildSystemPrompt(options: AgentOptions): string | undefined {
  const parts: string[] = []
  if (options.systemPrompt) parts.push(options.systemPrompt)
  if (options.appendSystemPrompt) parts.push(options.appendSystemPrompt)
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

function buildProviderOptions(thinkingBudget: number | undefined) {
  if (!thinkingBudget) return undefined
  return {
    anthropic: {
      thinking: {
        type: "enabled" as const,
        budgetTokens: thinkingBudget,
      },
    } satisfies AnthropicLanguageModelOptions,
  }
}

/**
 * Extract input from a tool call (works for both static and dynamic tool calls).
 */
function toolCallInput(tc: { input?: unknown }): Record<string, unknown> {
  if (tc.input && typeof tc.input === "object" && !Array.isArray(tc.input)) {
    return tc.input as Record<string, unknown>
  }
  return {}
}

/**
 * Collect ToolCall entries from AI SDK step results.
 */
function collectToolCalls(
  steps: Array<{
    toolCalls: Array<{ toolName: string; input?: unknown }>
  }>,
): ToolCall[] {
  const calls: ToolCall[] = []
  for (const step of steps) {
    for (const tc of step.toolCalls) {
      calls.push({
        tool: tc.toolName,
        args: toolCallInput(tc),
        timestamp: Date.now(),
      })
    }
  }
  return calls
}

// ─── Standard mode ───

export async function runAgent(
  prompt: string,
  options: AgentOptions,
): Promise<AgentResult> {
  const modelId = options.model ?? "claude-sonnet-4-20250514"
  const maxSteps = options.maxSteps ?? 100
  const system = buildSystemPrompt(options)
  const providerOptions = buildProviderOptions(options.thinkingBudget)
  const cb = options.callbacks

  console.log(`  [agent] Connecting MCP...`)
  const mcpClient = await createMCP(options.dazzleUrl, options.stageId, options.apiKey)
  console.log(`  [agent] MCP connected`)

  try {
    console.log(`  [agent] Fetching tools...`)
    const mcpTools = await mcpClient.tools()
    console.log(`  [agent] Got ${Object.keys(mcpTools).length} MCP tools: ${Object.keys(mcpTools).join(", ")}`)
    const allTools = { ...mcpTools, wait: waitTool, done: doneTool }

    // Track tool calls with timestamps as they happen
    const collectedToolCalls: ToolCall[] = []

    console.log(`  [agent] Calling ${modelId} (maxSteps=${maxSteps}, tools=${Object.keys(allTools).length})...`)
    const result = streamText({
      model: anthropic(modelId),
      tools: allTools,
      stopWhen: [hasToolCall("done"), stepCountIs(maxSteps)],
      system,
      prompt,
      providerOptions,

      onChunk({ chunk }) {
        if (chunk.type === "reasoning-delta" && cb?.onThinking) {
          cb.onThinking(chunk.text)
        }
        if (chunk.type === "text-delta" && cb?.onText && chunk.text) {
          cb.onText(chunk.text)
        }
      },

      onStepFinish(step) {
        if (cb?.onStepFinish) {
          cb.onStepFinish(step.stepNumber, step.toolCalls.length, {
            inputTokens: step.usage.inputTokens ?? 0,
            outputTokens: step.usage.outputTokens ?? 0,
          })
        }
      },

      experimental_onToolCallStart({ toolCall }) {
        const args = toolCallInput(toolCall)
        collectedToolCalls.push({
          tool: toolCall.toolName,
          args,
          timestamp: Date.now(),
        })
        cb?.onToolCall?.(toolCall.toolName, args)
      },

      experimental_onToolCallFinish(event) {
        if (event.success) {
          cb?.onToolResult?.(
            event.toolCall.toolName,
            event.output,
            event.durationMs,
          )
        } else {
          cb?.onToolResult?.(
            event.toolCall.toolName,
            { error: String(event.error) },
            event.durationMs,
          )
        }
      },
    })

    // Consume the stream to drive execution
    const text = await result.text
    const steps = await result.steps
    const totalUsage = await result.totalUsage
    const finishReason = await result.finishReason

    return {
      toolCalls:
        collectedToolCalls.length > 0
          ? collectedToolCalls
          : collectToolCalls(steps),
      text,
      steps: steps.length,
      finishReason,
      usage: {
        inputTokens: totalUsage.inputTokens ?? 0,
        outputTokens: totalUsage.outputTokens ?? 0,
        totalTokens: totalUsage.totalTokens ?? 0,
      },
    }
  } finally {
    await mcpClient.close()
  }
}

// ─── Interactive mode ───

export async function runInteractiveAgent(
  prompt: string,
  options: InteractiveAgentOptions,
): Promise<AgentResult> {
  const modelId = options.model ?? "claude-sonnet-4-20250514"
  const maxSteps = options.maxSteps ?? 50
  const maxTurns = options.maxTurns ?? 20
  const system = buildSystemPrompt(options)
  const providerOptions = buildProviderOptions(options.thinkingBudget)
  const cb = options.callbacks

  const mcpClient = await createMCP(options.dazzleUrl, options.stageId, options.apiKey)

  try {
    const mcpTools = await mcpClient.tools()
    const allTools = { ...mcpTools, wait: waitTool, done: doneTool }

    const messages: ModelMessage[] = [{ role: "user", content: prompt }]
    const collectedToolCalls: ToolCall[] = []
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalSteps = 0
    let lastFinishReason = "unknown"
    let lastText = ""
    let agentDone = false

    // Wire the simulator's sendMessage to push onto our messages array
    const simulator = new UserSimulator(
      options.userPersona,
      (text: string) => {
        messages.push({ role: "user", content: text })
      },
      options.getLatestScene,
      { cooldownMs: options.simulatorCooldownMs ?? 5000 },
    )

    for (let turn = 0; turn < maxTurns && !agentDone; turn++) {
      const messageCountBefore = messages.length

      const result = await generateText({
        model: anthropic(modelId),
        tools: allTools,
        stopWhen: [hasToolCall("done"), stepCountIs(maxSteps)],
        system,
        messages,
        providerOptions,

        onStepFinish(step) {
          // Collect tool calls from each step
          for (const tc of step.toolCalls) {
            const args = toolCallInput(tc)
            collectedToolCalls.push({
              tool: tc.toolName,
              args,
              timestamp: Date.now(),
            })
            cb?.onToolCall?.(tc.toolName, args)
            simulator.recordAssistantAction(`Used tool: ${tc.toolName}`)
          }

          if (step.reasoningText && cb?.onThinking) {
            cb.onThinking(step.reasoningText)
          }

          if (step.text && cb?.onText) {
            cb.onText(step.text)
          }

          if (cb?.onStepFinish) {
            cb.onStepFinish(step.stepNumber, step.toolCalls.length, {
              inputTokens: step.usage.inputTokens ?? 0,
              outputTokens: step.usage.outputTokens ?? 0,
            })
          }
        },
      })

      // Append response messages to conversation history
      messages.push(...result.response.messages)

      totalInputTokens += result.totalUsage.inputTokens ?? 0
      totalOutputTokens += result.totalUsage.outputTokens ?? 0
      totalSteps += result.steps.length
      lastFinishReason = result.finishReason
      lastText = result.text

      // Check if agent called done
      const calledDone = result.steps.some((step) =>
        step.toolCalls.some((tc) => tc.toolName === "done"),
      )
      if (calledDone) {
        agentDone = true
        break
      }

      // Check if agent finished naturally (text response, no tool calls)
      if (
        result.finishReason === "stop" &&
        result.toolCalls.length === 0
      ) {
        agentDone = true
        break
      }

      // Let user simulator evaluate and potentially inject a message.
      try {
        await simulator.evaluate()
      } catch (err) {
        console.warn(`  [user-sim] evaluate error: ${err}`)
      }

      // If the simulator didn't add a message, the agent gets another turn anyway
      if (messages.length === messageCountBefore + result.response.messages.length) {
        // No user message was injected — agent continues
      }
    }

    return {
      toolCalls: collectedToolCalls,
      text: lastText,
      steps: totalSteps,
      finishReason: lastFinishReason,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
      },
    }
  } finally {
    await mcpClient.close()
  }
}
