# Vercel AI SDK Migration Research

> Replacing Claude Code CLI as the agent execution engine with the Vercel AI SDK,
> while keeping our MCP server (`src/server/index.ts`) as the sole tool provider.

**Date:** 2026-03-05

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The MCP Bridge: `@ai-sdk/mcp`](#2-the-mcp-bridge-ai-sdkmcp)
3. [MCP Client Fallback: `@modelcontextprotocol/sdk`](#3-mcp-client-fallback-modelcontextprotocolsdk)
4. [Multi-Step Tool Loop: `generateText` with `stopWhen`](#4-multi-step-tool-loop-generatetext-with-stopwhen)
5. [Interactive Mode: Maintaining Conversation History](#5-interactive-mode-maintaining-conversation-history)
6. [A `wait` Tool for Pacing](#6-a-wait-tool-for-pacing)
7. [Thinking/Reasoning Control with `@ai-sdk/anthropic`](#7-thinkingreasoning-control-with-ai-sdkanthropic)
8. [Streaming Observability](#8-streaming-observability)
9. [Architecture: Before and After](#9-architecture-before-and-after)
10. [Migration Plan](#10-migration-plan)
11. [Open Questions](#11-open-questions)

---

## 1. Executive Summary

The Vercel AI SDK (v6, package `ai@^6.0`) has first-class MCP client support via `@ai-sdk/mcp`. We can point it at our existing stdio MCP server subprocess, discover all tools automatically, and use them with `generateText`/`streamText` in a multi-step agent loop. This eliminates the Claude Code CLI dependency entirely.

**Key finding:** `@ai-sdk/mcp` has a `createMCPClient` function that accepts an `Experimental_StdioMCPTransport`. Calling `client.tools()` returns a tool set that plugs directly into `generateText({ tools })`. The MCP server code stays untouched.

**Already installed:** Our `package.json` already has `ai@^6.0.113`, `@ai-sdk/anthropic@^3.0.55`, and `@modelcontextprotocol/sdk@^1.27.1`. We only need to add `@ai-sdk/mcp`.

---

## 2. The MCP Bridge: `@ai-sdk/mcp`

This is the critical piece. The `@ai-sdk/mcp` package provides `createMCPClient`, which connects to any MCP server and exposes its tools in a format `generateText`/`streamText` can consume directly.

### Installation

```bash
npm install @ai-sdk/mcp
```

### Connecting to Our Stdio MCP Server

```typescript
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

const mcpClient = await createMCPClient({
  transport: new Experimental_StdioMCPTransport({
    command: "npx",
    args: ["tsx", "src/server/index.ts"],
    env: {
      ...process.env,
      STREAM_PORT: String(port),
      STREAM_WIDTH: String(width),
      STREAM_HEIGHT: String(height),
    },
    cwd: workspacePath,
    stderr: "pipe", // capture stderr for diagnostics
  }),
});
```

### Discovering Tools

```typescript
// Returns a ToolSet object — same shape as manually-defined tools
const mcpTools = await mcpClient.tools();

// mcpTools is { sceneSet: Tool, scenePatch: Tool, catalogRead: Tool, ... }
// Tool names match MCP server tool names (no mcp__stream__ prefix)
```

### Using with `generateText`

```typescript
import { generateText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: mcpTools,
  stopWhen: stepCountIs(50),
  system: systemPrompt,
  prompt: scenarioPrompt,
});
```

### Cleanup

```typescript
await mcpClient.close(); // kills the subprocess, cleans up
```

### `Experimental_StdioMCPTransport` API

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | `string` | Yes | Executable to launch (`npx`, `node`, etc.) |
| `args` | `string[]` | No | Arguments to the command |
| `env` | `Record<string, string>` | No | Environment variables for the subprocess |
| `cwd` | `string` | No | Working directory for the subprocess |
| `stderr` | `IOType \| Stream \| number` | No | Where to send stderr |

### `createMCPClient` API

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transport` | `MCPTransport \| MCPTransportConfig` | Yes | Transport instance or config |
| `name` | `string` | No | Client name (default: `"ai-sdk-mcp-client"`) |
| `version` | `string` | No | Client version (default: `"1.0.0"`) |
| `onUncaughtError` | `(error) => void` | No | Error handler |
| `capabilities` | `object` | No | Client capabilities |

### Tool Name Mapping

When Claude Code CLI connects to our MCP server named `"stream"`, tools are exposed as `mcp__stream__sceneSet`, `mcp__stream__scenePatch`, etc. With `@ai-sdk/mcp`, the tools are exposed using their native MCP names: `sceneSet`, `scenePatch`, `catalogRead`, etc. This is cleaner, but our harness code that checks for `mcp__stream__` prefixes will need updating.

---

## 3. MCP Client Fallback: `@modelcontextprotocol/sdk`

If we ever needed to bypass `@ai-sdk/mcp` (e.g., for custom transport logic), we can use the low-level `@modelcontextprotocol/sdk` Client directly. This is already in our dependencies.

### Low-Level Client Pattern

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tool } from "ai";
import { jsonSchema } from "@ai-sdk/ui-utils";

// 1. Connect
const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/server/index.ts"],
});
const client = new Client({ name: "stream-harness", version: "1.0.0" });
await client.connect(transport);

// 2. Discover tools
const { tools: mcpToolDefs } = await client.listTools();

// 3. Bridge to AI SDK tool format
const tools: Record<string, any> = {};
for (const def of mcpToolDefs) {
  tools[def.name] = tool({
    description: def.description ?? "",
    inputSchema: jsonSchema(def.inputSchema),
    execute: async (args) => {
      const result = await client.callTool({ name: def.name, arguments: args });
      // MCP returns { content: [{ type: "text", text: "..." }, ...] }
      const textParts = result.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text);
      return textParts.join("\n");
    },
  });
}

// 4. Use with generateText
const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools,
  stopWhen: stepCountIs(50),
  prompt: "...",
});

// 5. Cleanup
await client.close();
```

**Verdict:** Use `@ai-sdk/mcp` (section 2) unless we need custom execute wrappers. The `createMCPClient` approach handles the bridging automatically.

---

## 4. Multi-Step Tool Loop: `generateText` with `stopWhen`

### How It Works

`generateText` is an agent loop. When the model returns a tool call:

1. The SDK executes the tool's `execute` function
2. Appends the tool result to the conversation
3. Calls the model again with the updated history
4. Repeats until a stop condition is met

### Stop Conditions

```typescript
import { generateText, stepCountIs } from "ai";

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: mcpTools,
  stopWhen: stepCountIs(50), // max 50 LLM calls
  prompt: "...",
});
```

Stop conditions are evaluated after each step that contains tool results. The loop ends when:
- A `stopWhen` condition is satisfied
- The model returns text without tool calls (natural completion)
- A tool lacks an `execute` function
- An abort signal fires

Default is `stepCountIs(1)` — meaning a single step unless you override.

### `prepareStep` — Dynamic Per-Step Control

```typescript
const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: mcpTools,
  stopWhen: stepCountIs(50),
  prepareStep: ({ stepNumber, steps }) => {
    // Switch to a stronger model after step 5
    if (stepNumber > 5) {
      return { model: anthropic("claude-opus-4-20250514") };
    }
    // Trim message history if getting long
    if (steps.length > 20) {
      return {
        messages: trimOldMessages(steps),
      };
    }
    return {};
  },
  prompt: "...",
});
```

### Accessing Results

```typescript
// Final text output
console.log(result.text);

// All steps (each is a complete LLM turn)
for (const step of result.steps) {
  console.log(`Step ${step.stepType}:`, step.toolCalls.length, "tool calls");
  console.log("Usage:", step.usage);
}

// Aggregated usage across all steps
console.log("Total tokens:", result.totalUsage);

// All tool calls from the final step
console.log("Final tool calls:", result.toolCalls);

// Response messages (for conversation history)
console.log("Messages:", result.response.messages);
```

---

## 5. Interactive Mode: Maintaining Conversation History

Our current interactive mode sends user messages mid-conversation via stdin stream-json. With the AI SDK, we manage conversation history ourselves.

### Pattern: Repeated `generateText` Calls

```typescript
import { generateText, stepCountIs, ModelMessage } from "ai";

const messages: ModelMessage[] = [];

// Initial prompt
messages.push({ role: "user", content: scenarioPrompt });

// Agent turn 1
const result1 = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: mcpTools,
  stopWhen: stepCountIs(30),
  system: systemPrompt,
  messages,
  onStepFinish: ({ toolCalls, toolResults }) => {
    // Real-time observability per step
  },
});

// Append assistant response to history
messages.push(...result1.response.messages);

// User simulator injects a message
messages.push({
  role: "user",
  content: "The background color needs to be darker",
});

// Agent turn 2 — sees full history including user feedback
const result2 = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: mcpTools,
  stopWhen: stepCountIs(30),
  system: systemPrompt,
  messages,
  onStepFinish: ({ toolCalls, toolResults }) => { /* ... */ },
});

messages.push(...result2.response.messages);
```

### Key Difference from Current Approach

- **Current (Claude CLI):** Single long-running process with stream-json stdin. User messages are injected into the running conversation via `child.stdin.write()`.
- **AI SDK approach:** Each "turn" is a separate `generateText` call. Between turns, we can modify the message array (add user messages, trim history, etc.). The agent loop within each turn handles multi-step tool calling.

### Implementing the Interactive Loop

```typescript
async function runInteractive(
  prompt: string,
  systemPrompt: string,
  mcpTools: ToolSet,
  simulator: UserSimulator,
) {
  const messages: ModelMessage[] = [
    { role: "user", content: prompt },
  ];

  let turnCount = 0;
  const maxTurns = 20;

  while (turnCount < maxTurns) {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      tools: mcpTools,
      stopWhen: stepCountIs(30),
      system: systemPrompt,
      messages,
      onStepFinish: (step) => {
        collector.onStepFinish(step);
      },
    });

    messages.push(...result.response.messages);
    turnCount++;

    // Check if agent is "done" (no tool calls, just text)
    if (result.finishReason === "stop") break;

    // Let user simulator evaluate and possibly inject feedback
    const userMessage = await simulator.evaluate();
    if (userMessage) {
      messages.push({ role: "user", content: userMessage });
    } else {
      break; // Simulator has nothing more to say
    }
  }

  return { messages, turnCount };
}
```

---

## 6. A `wait` Tool for Pacing

We want the agent to be able to pause between scene mutations to let transitions breathe. This is a local tool (not on the MCP server) mixed in with the MCP tools.

### Definition

```typescript
import { tool } from "ai";
import { z } from "zod";

const waitTool = tool({
  description:
    "Pause for a specified duration. Use this between scene changes to let " +
    "transitions complete and give the viewer time to absorb the visual.",
  inputSchema: z.object({
    seconds: z
      .number()
      .min(0.5)
      .max(30)
      .describe("How long to wait in seconds"),
    reason: z
      .string()
      .optional()
      .describe("Why we're waiting (for logging)"),
  }),
  execute: async ({ seconds, reason }) => {
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return `Waited ${seconds}s${reason ? `: ${reason}` : ""}`;
  },
});
```

### Mixing with MCP Tools

```typescript
const mcpTools = await mcpClient.tools();

const allTools = {
  ...mcpTools,    // sceneSet, scenePatch, catalogRead, etc.
  wait: waitTool, // local tool, no MCP round-trip
};

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: allTools,
  stopWhen: stepCountIs(50),
  prompt: "...",
});
```

### How It Fits in the Loop

The `wait` tool works seamlessly in the agent loop:

1. Model decides to call `wait({ seconds: 3, reason: "let crossfade complete" })`
2. AI SDK invokes the `execute` function
3. `execute` sleeps for 3 seconds, returns `"Waited 3s: let crossfade complete"`
4. SDK passes result back to the model
5. Model continues with next action

No special handling needed. The `execute` function's `Promise` naturally blocks that step of the loop. The agent loop is fully async and just `await`s each tool execution.

---

## 7. Thinking/Reasoning Control with `@ai-sdk/anthropic`

### Enabling Extended Thinking

```typescript
import { anthropic, AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";

const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: allTools,
  stopWhen: stepCountIs(50),
  maxOutputTokens: 16000,
  prompt: "...",
  providerOptions: {
    anthropic: {
      thinking: {
        type: "enabled",
        budgetTokens: 10000, // min 1024, must be < maxOutputTokens
      },
    } satisfies AnthropicLanguageModelOptions,
  },
  // Required header for interleaved thinking with tools
  headers: {
    "anthropic-beta": "interleaved-thinking-2025-05-14",
  },
});

// Access reasoning
console.log(result.reasoningText);    // string summary
console.log(result.reasoning);         // structured reasoning array
```

### Key Parameters

| Parameter | Location | Description |
|-----------|----------|-------------|
| `model` | top-level | Model ID: `claude-sonnet-4-20250514`, `claude-opus-4-20250514` |
| `maxOutputTokens` | top-level | Max output tokens (thinking budget must be less than this) |
| `temperature` | top-level | 0-1 randomness control |
| `thinking.budgetTokens` | `providerOptions.anthropic` | Max tokens for reasoning (min 1024) |
| `thinking.type` | `providerOptions.anthropic` | `"enabled"` or `"disabled"` |

### Additional Anthropic Provider Options

| Option | Type | Description |
|--------|------|-------------|
| `effort` | `"high" \| "medium" \| "low"` | Token optimization level |
| `speed` | `"fast" \| "standard"` | Faster inference mode |
| `disableParallelToolUse` | `boolean` | Force single tool calls per step |
| `toolStreaming` | `boolean` | Stream tool call deltas (default: `true`) |

### Thinking with Tools

Both Opus 4 and Sonnet 4 support tool calling during extended thinking. When using interleaved thinking with tools, the budget_tokens limit can be exceeded — the effective limit becomes the full context window (200k tokens). This is important for our use case where the agent reasons about scene composition while calling tools.

---

## 8. Streaming Observability

We need the same observability we currently get from parsing Claude CLI stream-json output. The AI SDK provides multiple callback hooks.

### Using `generateText` Callbacks

```typescript
const result = await generateText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: allTools,
  stopWhen: stepCountIs(50),
  prompt: "...",

  onStepFinish({ stepNumber, stepType, text, toolCalls, toolResults, usage, finishReason }) {
    // Called after each LLM step completes
    for (const tc of toolCalls) {
      collector.onToolCall({
        tool: tc.toolName,
        args: tc.args,
        timestamp: Date.now(),
      });
    }
    for (const tr of toolResults) {
      collector.onToolResult(tr.toolCallId, tr.result);
    }
    if (text) {
      collector.onText(text);
    }
    console.log(
      `Step ${stepNumber} (${stepType}): ${toolCalls.length} tool calls, ` +
      `${usage.inputTokens}/${usage.outputTokens} tokens`
    );
  },
});
```

### Using `streamText` for Real-Time Streaming

For maximum observability (streaming text chunks, thinking blocks in real-time):

```typescript
import { streamText, stepCountIs } from "ai";

const result = streamText({
  model: anthropic("claude-sonnet-4-20250514"),
  tools: allTools,
  stopWhen: stepCountIs(50),
  prompt: "...",

  // Called for each chunk as it arrives
  onChunk({ chunk }) {
    switch (chunk.type) {
      case "text":
        // Partial text as it streams
        process.stdout.write(chunk.text);
        break;
      case "reasoning":
        // Thinking text as it streams
        collector.onThinking(chunk.text.length);
        break;
      case "tool-call":
        // Tool call detected
        collector.onToolCall({
          tool: chunk.toolName,
          args: chunk.args,
          timestamp: Date.now(),
        });
        break;
      case "tool-result":
        // Tool result received
        collector.onToolResult(chunk.toolCallId, chunk.result);
        break;
    }
  },

  // Called when each step completes
  onStepFinish({ stepNumber, toolCalls, toolResults, usage }) {
    recorder.sendStatus(
      `Step ${stepNumber}`,
      `${toolCalls.length} calls`,
      Date.now() - startTime
    );
  },

  // Called when everything is done
  onFinish({ text, steps, totalUsage }) {
    console.log(`Done: ${steps.length} steps, ${totalUsage.totalTokens} tokens`);
  },

  // Experimental: real-time tool execution callbacks
  experimental_onToolCallStart({ toolName, args }) {
    console.log(`  > Starting: ${toolName}`);
    recorder.sendStatus(toolName, undefined, Date.now() - startTime);
  },

  experimental_onToolCallFinish({ toolName, durationMs, success, output, error }) {
    if (success) {
      console.log(`  < Finished: ${toolName} (${durationMs}ms)`);
    } else {
      console.error(`  ! Failed: ${toolName}: ${error}`);
    }
  },
});

// Consume the stream (required to trigger execution)
for await (const chunk of result.textStream) {
  // streaming text output
}

// Or just await the final result
const finalText = await result.text;
const allSteps = await result.steps;
```

### Mapping Current Callbacks to AI SDK

| Current `SpawnCallbacks` | AI SDK Equivalent |
|--------------------------|-------------------|
| `onToolCall(call)` | `onChunk` (type: `"tool-call"`), or `onStepFinish.toolCalls` |
| `onToolResult(id, result)` | `onChunk` (type: `"tool-result"`), or `onStepFinish.toolResults` |
| `onThinking(charCount)` | `onChunk` (type: `"reasoning"`) |
| `onText(text)` | `onChunk` (type: `"text"`), or `onStepFinish.text` |
| `onSystem("init", data)` | No direct equivalent — we know init state from `createMCPClient` success |

### `generateText` vs `streamText`

| Feature | `generateText` | `streamText` |
|---------|----------------|--------------|
| Returns | Resolved result | Stream + promises |
| `onStepFinish` | Yes | Yes |
| `onChunk` | No | Yes (real-time) |
| `onFinish` | Yes | Yes |
| `experimental_onToolCallStart` | No | Yes |
| `experimental_onToolCallFinish` | No | Yes |
| Thinking streaming | No (batch) | Yes (real-time) |

**Recommendation:** Use `streamText` for the harness. It gives us real-time observability that matches (and exceeds) what we currently get from parsing CLI stream-json.

---

## 9. Architecture: Before and After

### Before (Current: Claude Code CLI)

```
harness/run.ts
  └─ spawner.ts
       └─ spawn("claude", [...args])         # Claude Code CLI process
            ├─ --mcp-config .mcp.json        # Tells CLI about our MCP server
            ├─ --output-format stream-json    # JSON lines on stdout
            └─ --input-format stream-json     # JSON on stdin (interactive)
                 │
                 └─ Claude Code internally:
                      ├─ Spawns MCP server subprocess (from .mcp.json)
                      ├─ Manages conversation state
                      ├─ Calls Anthropic API
                      └─ Emits stream-json events
                           │
                           └─ spawner.ts parses stdout line-by-line
                                ├─ extractToolUseBlocks()
                                ├─ extractToolResultBlocks()
                                └─ deepScanForToolUse()
```

### After (Vercel AI SDK)

```
harness/run.ts
  └─ agent.ts (new)
       ├─ createMCPClient({ transport: StdioMCPTransport(...) })
       │    └─ Spawns MCP server subprocess directly
       │
       ├─ mcpClient.tools()  →  toolSet
       │
       ├─ wait tool (local)  →  toolSet
       │
       └─ streamText({
            model: anthropic("claude-sonnet-4-..."),
            tools: { ...mcpTools, wait: waitTool },
            stopWhen: stepCountIs(50),
            system: systemPrompt,
            messages: conversationHistory,
            onChunk: ...,
            onStepFinish: ...,
            experimental_onToolCallStart: ...,
            experimental_onToolCallFinish: ...,
          })
```

### What Changes

| Component | Before | After |
|-----------|--------|-------|
| Agent execution | Claude Code CLI subprocess | `streamText()` / `generateText()` direct API call |
| MCP connection | CLI manages it via `.mcp.json` | `createMCPClient` + `StdioMCPTransport` |
| Tool discovery | CLI discovers tools, exposes as `mcp__stream__*` | `mcpClient.tools()` discovers, exposes as native names |
| Conversation state | CLI internal state | Our `messages: ModelMessage[]` array |
| Event parsing | Parse stream-json stdout (400+ lines in spawner.ts) | SDK callbacks (`onChunk`, `onStepFinish`) |
| User message injection | `stdin.write(JSON.stringify({type:"user",...}))` | `messages.push({role:"user",...})` + new `generateText` call |
| Local tools (wait) | Not possible with CLI | `tool()` mixed into tool set |
| Process lifecycle | Spawn/kill child process | `createMCPClient` / `mcpClient.close()` |

### What Stays the Same

- **MCP server code** (`src/server/tools.ts`, `src/server/index.ts`) — completely untouched
- **Recorder** — still connects to WebSocket, collects scene snapshots
- **Evaluator** — still receives `SessionResult`, unchanged
- **Video capture** — unchanged
- **Stream event collector** — callbacks change names but same data flows through

---

## 10. Migration Plan

### Phase 1: Add `@ai-sdk/mcp` and create `agent.ts`

```bash
npm install @ai-sdk/mcp
```

Create `harness/lib/agent.ts` — the AI SDK agent runner that replaces `spawner.ts`:

```typescript
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { streamText, stepCountIs, tool, ModelMessage } from "ai";
import { anthropic, AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { z } from "zod";

export interface AgentOptions {
  workspacePath: string;
  port: number;
  width?: number;
  height?: number;
  model?: string;
  thinkingBudget?: number;
  maxSteps?: number;
  systemPrompt?: string;
  onChunk?: (chunk: any) => void;
  onStepFinish?: (step: any) => void;
  onToolCallStart?: (info: { toolName: string; args: any }) => void;
  onToolCallFinish?: (info: { toolName: string; durationMs: number }) => void;
  onFinish?: (result: any) => void;
}

const waitTool = tool({
  description:
    "Pause for a specified duration to let transitions complete " +
    "and give the viewer time to absorb the visual.",
  inputSchema: z.object({
    seconds: z.number().min(0.5).max(30),
    reason: z.string().optional(),
  }),
  execute: async ({ seconds, reason }) => {
    await new Promise((r) => setTimeout(r, seconds * 1000));
    return `Waited ${seconds}s${reason ? `: ${reason}` : ""}`;
  },
});

export async function runAgent(prompt: string, options: AgentOptions) {
  const mcpClient = await createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: "npx",
      args: ["tsx", "src/server/index.ts"],
      env: {
        ...process.env,
        STREAM_PORT: String(options.port),
        STREAM_WIDTH: String(options.width ?? 1920),
        STREAM_HEIGHT: String(options.height ?? 1080),
      },
      cwd: options.workspacePath,
    }),
  });

  try {
    const mcpTools = await mcpClient.tools();
    const allTools = { ...mcpTools, wait: waitTool };

    const modelId = options.model ?? "claude-sonnet-4-20250514";

    const result = streamText({
      model: anthropic(modelId),
      tools: allTools,
      stopWhen: stepCountIs(options.maxSteps ?? 50),
      system: options.systemPrompt,
      prompt,
      providerOptions: options.thinkingBudget
        ? {
            anthropic: {
              thinking: {
                type: "enabled",
                budgetTokens: options.thinkingBudget,
              },
            } satisfies AnthropicLanguageModelOptions,
          }
        : undefined,
      onChunk: options.onChunk
        ? ({ chunk }) => options.onChunk!(chunk)
        : undefined,
      onStepFinish: options.onStepFinish,
      onFinish: options.onFinish,
      experimental_onToolCallStart: options.onToolCallStart,
      experimental_onToolCallFinish: options.onToolCallFinish,
    });

    // Consume the stream
    const text = await result.text;
    const steps = await result.steps;
    const totalUsage = await result.totalUsage;

    return { text, steps, totalUsage };
  } finally {
    await mcpClient.close();
  }
}
```

### Phase 2: Interactive Agent Runner

```typescript
export async function runInteractiveAgent(
  prompt: string,
  options: AgentOptions & {
    onTurnComplete?: (turnNumber: number, messages: ModelMessage[]) => void;
    getUserMessage?: () => Promise<string | null>;
    maxTurns?: number;
  },
) {
  const mcpClient = await createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: "npx",
      args: ["tsx", "src/server/index.ts"],
      env: {
        ...process.env,
        STREAM_PORT: String(options.port),
        STREAM_WIDTH: String(options.width ?? 1920),
        STREAM_HEIGHT: String(options.height ?? 1080),
      },
      cwd: options.workspacePath,
    }),
  });

  try {
    const mcpTools = await mcpClient.tools();
    const allTools = { ...mcpTools, wait: waitTool };
    const messages: ModelMessage[] = [{ role: "user", content: prompt }];
    const modelId = options.model ?? "claude-sonnet-4-20250514";
    let turnCount = 0;
    const maxTurns = options.maxTurns ?? 20;

    while (turnCount < maxTurns) {
      const result = await generateText({
        model: anthropic(modelId),
        tools: allTools,
        stopWhen: stepCountIs(options.maxSteps ?? 30),
        system: options.systemPrompt,
        messages,
        onStepFinish: options.onStepFinish,
      });

      messages.push(...result.response.messages);
      turnCount++;

      options.onTurnComplete?.(turnCount, messages);

      // Check if agent naturally finished
      if (result.finishReason === "stop" && result.toolCalls.length === 0) {
        break;
      }

      // Get user feedback
      const userMessage = await options.getUserMessage?.();
      if (!userMessage) break;

      messages.push({ role: "user", content: userMessage });
    }

    return { messages, turnCount };
  } finally {
    await mcpClient.close();
  }
}
```

### Phase 3: Update `harness/run.ts`

Replace `spawnAgent()` calls with `runAgent()` / `runInteractiveAgent()`. Update the stream collector to use AI SDK callback shapes. Remove `spawner.ts` and related stream-json parsing code.

### Phase 4: Remove Claude Code CLI Dependency

- Delete `spawner.ts` (624 lines of stream-json parsing, no longer needed)
- Remove `.mcp.json` workspace file generation from `createWorkspace()`
- Update `harness/lib/types.ts` — tool names no longer have `mcp__stream__` prefix
- Update tool call logging to use native names

---

## 11. Open Questions

1. **`Experimental_StdioMCPTransport` stability** — It's marked experimental. If it breaks in a future release, we can fall back to the `@modelcontextprotocol/sdk` Client approach (section 3), which uses the stable `StdioClientTransport`.

2. **Tool name format** — MCP tools come through as `sceneSet` not `mcp__stream__sceneSet`. Do we update all harness code, or add a prefix adapter? Updating is cleaner.

3. **Error recovery** — With CLI, a crash kills the process and we get an exit code. With `streamText`, tool execution errors appear as `tool-error` content parts and the model can self-recover. Do we want this (probably yes)?

4. **Abort signal** — We currently use `child.kill("SIGTERM")` for timeout. With AI SDK, we can pass an `AbortSignal` to `streamText` for clean cancellation.

5. **Token usage tracking** — The AI SDK gives us detailed `usage` per step and `totalUsage` across all steps. This is better than what we have now (none). We should capture this in `stream.jsonl`.

6. **Parallel tool calls** — By default, models may request multiple tool calls per step. The `disableParallelToolUse` Anthropic option can force sequential. For our use case (scene mutations), parallel might cause ordering issues. Worth testing.

7. **`streamText` vs `generateText`** — `streamText` gives better real-time observability but returns promises instead of direct values. For interactive mode where we need `response.messages` synchronously between turns, `generateText` might be simpler. We could use `streamText` for standard mode and `generateText` for interactive mode.

---

## Sources

- [AI SDK Core: MCP Tools](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
- [AI SDK Cookbook: MCP Tools (Node.js)](https://ai-sdk.dev/cookbook/node/mcp-tools)
- [AI SDK Reference: createMCPClient](https://ai-sdk.dev/docs/reference/ai-sdk-core/create-mcp-client)
- [AI SDK Reference: Experimental_StdioMCPTransport](https://ai-sdk.dev/docs/reference/ai-sdk-core/mcp-stdio-transport)
- [AI SDK Reference: streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)
- [AI SDK Reference: generateText](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text)
- [AI SDK Core: Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [AI SDK: Loop Control](https://ai-sdk.dev/docs/agents/loop-control)
- [AI SDK Providers: Anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
- [AI SDK Cookbook: Claude 4 Guide](https://ai-sdk.dev/cookbook/guides/claude-4)
- [AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
