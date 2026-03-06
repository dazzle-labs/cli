/**
 * Video transcription using an LLM with video understanding.
 *
 * Supports two providers via Vercel AI SDK:
 *   1. OpenRouter (OPENROUTER_API_KEY) — routes to Gemini/GPT-4o/etc via unified API
 *   2. Google AI Studio (GEMINI_API_KEY) — direct Gemini API via OpenAI-compatible endpoint
 *
 * OpenRouter is preferred since it uses a single API key for many providers.
 * Falls back gracefully if no API key is set.
 */

import fs from "fs"
import path from "path"
import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const TRANSCRIPTION_PROMPT = `You are producing a reconstruction script from a video of a web page built by an AI agent. A skilled video editor must be able to recreate this video in exacting detail without ever seeing the original. Report only observable facts. Never assess quality, never use words like polished, clean, professional, amateur, elegant, or any other judgment.

RULES:

1. EVERY ELEMENT IS AN ACTOR. Each element on screen (background, text block, shape, icon, badge, line, gradient) is tracked individually. For each, state:
   - Position (x%, y% from top-left, or centered with offset)
   - Dimensions (width, height as % of viewport or px if determinable)
   - Color (hex values — e.g. #1A3B5C), opacity (0.0-1.0)
   - For text: the COMPLETE string verbatim, font weight, approximate size as % of viewport height (VH)
   - Border radius, border color/width, shadows if visible

   CRITICAL FOR LAYOUT ASSESSMENT: For the overall composition, estimate what percentage of the total frame (1920x1080) is occupied by content vs empty/background space. For example: "Content occupies roughly 40% of frame width (centered), with 30% empty space on each side" or "Full-bleed layout — content spans edge to edge." This helps downstream evaluation of space utilization.

2. VERBATIM TEXT. Every word visible on screen must appear in the transcript exactly as rendered, preserving capitalization, punctuation, and line breaks. If text is partially obscured or truncated, note what is visible and that it is cut off.

3. CONTINUOUS TIMELINE. Start a new timestamp section whenever ANY visual property changes. For static periods, describe the full scene composition once at the start of the period, then note "No changes through 0:XX." Do not collapse 40 seconds into one line — state what is on screen.

4. TRANSITIONS FRAME BY FRAME. Describe how each element changes individually:
   - "Background gradient fades from #0B1121/#1A3A6B to #0D1A0F/#1B4D24 over 0.5s"
   - "Text 'Hello World' opacity goes from 0.0 to 1.0 over 0.3s starting at 0:02.1"
   - Never write "element appears" — specify the transition mechanism (cut, fade, slide direction, scale).

5. ANOMALIES. Describe exactly what you see: overlapping elements, text extending beyond containers, single-frame flashes, empty regions where content might be expected, z-order stacking, misaligned edges. State the observable fact without calling it a bug, error, or artifact.

6. NO CATEGORIES OR HEADERS WITHIN SECTIONS. Write flowing prose per timestamp, not labeled buckets like "Background:" or "Text:" or "State:". Describe the scene as a composition.

7. IGNORE RECORDING UI. If a video player scrubber/progress bar from the recording tool is visible, ignore it entirely. It is not part of the content.

FORMAT:

## 0:00.0
[Full scene description in reconstruction-level prose]

## 0:02.3
[What changed, element by element, with transition details. Then full scene state.]

Continue for every visual change through the end of the video.`

// ─── OpenRouter Provider (via Vercel AI SDK) ───

async function transcribeViaOpenRouter(
  videoBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const modelName = process.env.VIDEO_TRANSCRIPTION_MODEL || "google/gemini-3-flash-preview"

  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
  })

  const { text } = await generateText({
    model: openrouter(modelName),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: TRANSCRIPTION_PROMPT },
          {
            type: "file",
            data: videoBase64,
            mediaType: mimeType,
          },
        ],
      },
    ],
    maxOutputTokens: 8192,
  })

  if (!text) {
    throw new Error("OpenRouter returned empty response")
  }

  return text
}

// ─── Google AI Studio (Gemini) Provider (via raw fetch — Gemini has native video support) ───

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3-flash-preview"]

async function geminiRequest(
  model: string,
  videoBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: TRANSCRIPTION_PROMPT },
            {
              inline_data: {
                mime_type: mimeType,
                data: videoBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 8192,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Gemini API error ${response.status}: ${body}`)
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    error?: { message?: string }
  }

  if (data.error) {
    throw new Error(`Gemini error: ${data.error.message}`)
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) {
    throw new Error("Gemini returned empty response")
  }

  return text
}

async function transcribeViaGemini(
  videoBase64: string,
  mimeType: string,
  apiKey: string
): Promise<{ text: string; model: string }> {
  const models = process.env.GEMINI_MODEL
    ? [process.env.GEMINI_MODEL]
    : GEMINI_MODELS

  const errors: string[] = []

  for (const model of models) {
    try {
      console.log(`  [video-transcribe] Trying ${model}...`)
      const text = await geminiRequest(model, videoBase64, mimeType, apiKey)
      return { text, model }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${model}: ${msg}`)
    }
  }

  throw new Error(`All Gemini models failed:\n${errors.join("\n")}`)
}

// ─── Public API ───

export interface TranscriptionResult {
  transcription: string
  provider: string
  model: string
  outputPath: string
}

/**
 * Transcribe a video file using an LLM with vision/video capabilities.
 *
 * @param videoPath  Path to the video file (WebM)
 * @param outputDir  Directory to save video-transcription.md
 * @returns The transcription result, or null if no API key / video unavailable
 */
export async function transcribeVideo(
  videoPath: string,
  outputDir: string
): Promise<TranscriptionResult | null> {
  // Check the video file exists and has content
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }

  const stats = fs.statSync(videoPath)
  if (stats.size === 0) {
    throw new Error(`Video file is empty: ${videoPath}`)
  }

  // Check file size — warn if very large (OpenRouter/Gemini have limits)
  const sizeMB = stats.size / (1024 * 1024)
  if (sizeMB > 100) {
    console.warn(`  [video-transcribe] Video is ${sizeMB.toFixed(1)}MB — may be too large for API upload`)
  }

  // Determine MIME type from extension
  const ext = path.extname(videoPath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".mov": "video/mov",
    ".mpeg": "video/mpeg",
  }
  const mimeType = mimeTypes[ext] || "video/webm"

  // Read and encode video
  const videoBuffer = fs.readFileSync(videoPath)
  const videoBase64 = videoBuffer.toString("base64")

  // Try providers in order of preference
  const openrouterKey = process.env.OPENROUTER_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY

  if (!openrouterKey && !geminiKey) {
    throw new Error("No API key found for video transcription (set OPENROUTER_API_KEY or GEMINI_API_KEY)")
  }

  let transcription: string
  let provider: string
  let model: string

  // Prefer Gemini for video — it has native video upload support and tries
  // multiple models with retry. OpenRouter rejects video/mp4 file parts.
  if (geminiKey) {
    provider = "gemini"
    console.log(`  [video-transcribe] Transcribing via Gemini (${sizeMB.toFixed(1)}MB)...`)

    try {
      const result = await transcribeViaGemini(videoBase64, mimeType, geminiKey)
      transcription = result.text
      model = result.model
    } catch (err) {
      console.error(`  [video-transcribe] Gemini error:`, err)
      throw new Error(`Gemini transcription failed: ${err instanceof Error ? err.message : err}`)
    }
  } else if (openrouterKey) {
    provider = "openrouter"
    model = process.env.VIDEO_TRANSCRIPTION_MODEL || "google/gemini-2.5-flash"
    console.log(`  [video-transcribe] Transcribing via OpenRouter (${model}, ${sizeMB.toFixed(1)}MB)...`)

    try {
      transcription = await transcribeViaOpenRouter(videoBase64, mimeType, openrouterKey)
    } catch (err) {
      console.error(`  [video-transcribe] OpenRouter error:`, err)
      throw new Error(`OpenRouter transcription failed: ${err instanceof Error ? err.message : err}`)
    }
  } else {
    throw new Error("No API key found for video transcription (set GEMINI_API_KEY or OPENROUTER_API_KEY)")
  }

  // Save transcription
  const outputPath = path.join(outputDir, "video-transcription.md")
  const header = `# Video Transcription\n\n**Provider:** ${provider} | **Model:** ${model} | **Video:** ${path.basename(videoPath)} (${sizeMB.toFixed(1)}MB)\n\n---\n\n`
  fs.writeFileSync(outputPath, header + transcription)
  console.log(`  [video-transcribe] Transcription saved to ${outputPath}`)

  return { transcription, provider, model, outputPath }
}
