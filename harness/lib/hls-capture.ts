import fs from "fs"
import path from "path"
import { execSync } from "child_process"

export class HlsCapture {
  private hlsUrl: string
  private outputDir: string
  private authHeader: string
  private segmentsDir: string
  private polling = false
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private lastSequence = -1
  private downloadedSegments: string[] = []
  private gapCount = 0
  private pollInProgress = false
  private currentPoll: Promise<void> | null = null

  constructor(hlsUrl: string, outputDir: string, apiKey: string) {
    this.hlsUrl = hlsUrl
    this.outputDir = outputDir
    this.authHeader = `Bearer ${apiKey}`
    this.segmentsDir = path.join(outputDir, "segments")
  }

  start(): void {
    fs.mkdirSync(this.segmentsDir, { recursive: true })
    this.polling = true
    // Poll every 500ms
    this.pollInterval = setInterval(() => { this.currentPoll = this.poll() }, 500)
    console.log(`  [hls] Capturing from ${this.hlsUrl}`)
  }

  private async poll(): Promise<void> {
    if (!this.polling || this.pollInProgress) return
    this.pollInProgress = true
    try {
      const res = await fetch(this.hlsUrl, {
        headers: { Authorization: this.authHeader },
      })
      if (!res.ok) return

      const playlist = await res.text()
      const lines = playlist.split("\n")

      // Parse media sequence
      let mediaSequence = 0
      for (const line of lines) {
        const match = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)
        if (match) {
          mediaSequence = parseInt(match[1], 10)
          break
        }
      }

      // Find .ts segment filenames
      const segments = lines.filter(l => l.trim().endsWith(".ts"))

      for (let i = 0; i < segments.length; i++) {
        const seq = mediaSequence + i
        if (seq <= this.lastSequence) continue

        // Detect gaps
        if (this.lastSequence >= 0 && seq > this.lastSequence + 1) {
          const gap = seq - this.lastSequence - 1
          this.gapCount += gap
          console.warn(`  [hls] Gap detected: missed segments ${this.lastSequence + 1}-${seq - 1}`)
        }
        this.lastSequence = seq

        // Download segment
        const segUrl = new URL(segments[i], this.hlsUrl).href
        try {
          const segRes = await fetch(segUrl, {
            headers: { Authorization: this.authHeader },
          })
          if (!segRes.ok) continue
          const buffer = Buffer.from(await segRes.arrayBuffer())
          const filename = `segment-${String(seq).padStart(6, "0")}.ts`
          const segPath = path.join(this.segmentsDir, filename)
          fs.writeFileSync(segPath, buffer)
          this.downloadedSegments.push(filename)
        } catch (err) {
          console.warn(`  [hls] Failed to download segment ${seq}: ${err instanceof Error ? err.message : err}`)
        }
      }
    } catch {
      // Network error — will retry next poll
    } finally {
      this.pollInProgress = false
    }
  }

  async stop(): Promise<string | null> {
    this.polling = false
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }

    // Wait for any in-flight poll to complete
    if (this.currentPoll) await this.currentPoll

    if (this.downloadedSegments.length === 0) {
      console.log("  [hls] No segments captured")
      return null
    }

    console.log(`  [hls] Captured ${this.downloadedSegments.length} segments (${this.gapCount} gaps)`)

    // Write ffmpeg concat file
    const concatPath = path.join(this.segmentsDir, "segments.txt")
    const concatContent = this.downloadedSegments
      .map(f => `file '${f}'`)
      .join("\n")
    fs.writeFileSync(concatPath, concatContent)

    // Stitch to MP4
    const mp4Path = path.join(this.outputDir, "capture.mp4")
    try {
      execSync(
        `ffmpeg -f concat -safe 0 -i "${concatPath}" -c copy -movflags +faststart "${mp4Path}"`,
        { stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }
      )
      console.log(`  [hls] Video saved to ${mp4Path}`)
      return mp4Path
    } catch (err) {
      console.error(`  [hls] ffmpeg concat failed: ${err instanceof Error ? err.message : err}`)
      return null
    }
  }
}
