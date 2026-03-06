import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ScenarioConfig } from "./types"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCENARIOS_DIR = path.resolve(__dirname, "../scenarios")

export function loadScenario(scenarioName: string): ScenarioConfig {
  const scenarioDir = path.join(SCENARIOS_DIR, scenarioName)
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenarioDir}`)
  }

  const promptPath = path.join(scenarioDir, "prompt.md")
  if (!fs.existsSync(promptPath)) {
    throw new Error(`Scenario missing prompt.md: ${promptPath}`)
  }

  const seedPath = path.join(scenarioDir, "seed")
  const hasSeed = fs.existsSync(seedPath)

  // Check for optional persona.md — enables interactive mode
  const personaPath = path.join(scenarioDir, "persona.md")
  const hasPersona = fs.existsSync(personaPath)
  const userPersona = hasPersona
    ? fs.readFileSync(personaPath, "utf-8").trim()
    : undefined

  // Check for optional config.json — per-scenario tool permissions and agent settings
  const configPath = path.join(scenarioDir, "config.json")
  let allowedTools: string[] | undefined
  let model: string | undefined
  let effort: "low" | "medium" | "high" | undefined
  let appendSystemPrompt: string | undefined
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    allowedTools = config.allowedTools
    model = config.model
    effort = config.effort ?? "low"
    appendSystemPrompt = config.appendSystemPrompt
  }

  return {
    name: scenarioName,
    promptPath,
    seedPath: hasSeed ? seedPath : null,
    interactive: hasPersona,
    userPersona,
    allowedTools,
    model,
    effort,
    appendSystemPrompt,
  }
}

export async function connectMCP(dazzleUrl: string, stageId: string, apiKey: string): Promise<Client> {
  const client = new Client({ name: "harness", version: "0.1.0" })
  const transport = new StreamableHTTPClientTransport(
    new URL(`${dazzleUrl}/stage/${stageId}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } },
  )
  await client.connect(transport)
  return client
}

async function findOrCreateStageId(dazzleUrl: string, apiKey: string): Promise<string> {
  // List existing stages and reuse one if available
  const listRes = await fetch(`${dazzleUrl}/api.v1.StageService/ListStages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({}),
  })
  if (listRes.ok) {
    const { stages } = await listRes.json() as { stages?: Array<{ id: string; status: string }> }
    if (stages && stages.length > 0) {
      const stage = stages[0]
      console.log(`  Reusing existing stage: ${stage.id} (${stage.status})`)
      return stage.id
    }
  }

  // No existing stages — create a new one
  const createRes = await fetch(`${dazzleUrl}/api.v1.StageService/CreateStage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({}),
  })
  if (!createRes.ok) {
    const body = await createRes.text()
    throw new Error(`CreateStage failed (${createRes.status}): ${body}`)
  }
  const { stage } = await createRes.json() as { stage: { id: string } }
  console.log(`  Stage created: ${stage.id}`)
  return stage.id
}

export async function createStage(
  config: ScenarioConfig,
  dazzleUrl: string,
  apiKey: string,
): Promise<{ stageId: string }> {
  const stageId = await findOrCreateStageId(dazzleUrl, apiKey)

  // Ensure stage is running via MCP start (idempotent if already active)
  const client = await connectMCP(dazzleUrl, stageId, apiKey)
  try {
    const startResult = await client.callTool({ name: "start", arguments: {} })
    const startContent = startResult.content as Array<{ type: string; text?: string }>
    const isError = startResult.isError || startContent?.some(c => c.text?.includes("error") || c.text?.includes("failed"))
    if (isError) {
      const msg = startContent?.map(c => c.text).join(" ") ?? "unknown error"
      throw new Error(`Stage start failed: ${msg}`)
    }
    console.log(`  Stage started`)

    // Upload seed data if scenario has seedPath
    if (config.seedPath) {
      const seedFiles = fs.readdirSync(config.seedPath)
      for (const file of seedFiles) {
        const content = fs.readFileSync(path.join(config.seedPath, file), "utf-8")
        await client.callTool({ name: "set_script", arguments: { script: content } })
      }
      console.log(`  Seed data uploaded`)
    }
  } finally {
    await client.close()
  }

  return { stageId }
}

export async function destroyStage(
  stageId: string,
  dazzleUrl: string,
  apiKey: string,
): Promise<void> {
  try {
    // Stop the stage via MCP (deactivates pod but keeps DB record for reuse)
    const client = await connectMCP(dazzleUrl, stageId, apiKey)
    try {
      await client.callTool({ name: "stop", arguments: {} })
    } catch {
      // Stage may already be stopped
    } finally {
      await client.close()
    }
    console.log(`  Stage ${stageId} deactivated (kept for reuse)`)
  } catch (err) {
    console.error(`  Failed to deactivate stage ${stageId}: ${err instanceof Error ? err.message : err}`)
  }
}
