import type { SceneSnapshot } from "./types"

export interface SceneObserverClient {
  callTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text?: string }> }>
}

export class SceneObserver {
  private client: SceneObserverClient
  private polling = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private snapshots: SceneSnapshot[] = []
  private lastContent: string | null = null
  private mutationIndex = 0
  private pollInProgress = false

  constructor(client: SceneObserverClient) {
    this.client = client
  }

  start(): void {
    this.polling = true
    this.pollInterval = setInterval(() => this.poll(), 500)
  }

  private async poll(): Promise<void> {
    if (!this.polling || this.pollInProgress) return
    this.pollInProgress = true
    try {
      const result = await this.client.callTool("sceneRead", {})
      const text = result.content?.find(c => c.type === "text")?.text ?? ""

      if (text !== this.lastContent) {
        this.lastContent = text
        this.mutationIndex++
        this.snapshots.push({
          scene: { type: "script", content: text },
          timestamp: Date.now(),
          mutationIndex: this.mutationIndex,
        })
      }
    } catch {
      // Tool call failed — will retry next poll
    } finally {
      this.pollInProgress = false
    }
  }

  stop(): void {
    this.polling = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
  }

  getSnapshots(): SceneSnapshot[] {
    return this.snapshots
  }
}
