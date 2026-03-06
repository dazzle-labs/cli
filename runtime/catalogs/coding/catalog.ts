import { z } from "zod"
import { defineCatalog } from "../../core/catalog"

export const codingCatalog = defineCatalog({
  StatusBar: {
    description: "Top bar showing current activity and session statistics.",
    props: z.object({
      title: z.string().describe("What the agent is currently doing"),
      detail: z.string().optional().describe("Additional context"),
      stats: z
        .object({
          events: z.number().optional(),
          filesRead: z.number().optional(),
          filesWritten: z.number().optional(),
          commands: z.number().optional(),
        })
        .optional()
        .describe("Session statistics"),
    }),
  },

  CodeView: {
    description: "Syntax-highlighted code display with file path header and line numbers.",
    props: z.object({
      path: z.string().describe("File path being displayed"),
      code: z.string().describe("The code content"),
      language: z.string().optional().describe("Language for syntax hints (ts, py, rs, etc.)"),
      highlights: z.array(z.number()).optional().describe("Line numbers to highlight"),
    }),
  },

  DiffView: {
    description: "Side-by-side or inline diff showing old and new text with red/green highlighting.",
    props: z.object({
      path: z.string().describe("File path being diffed"),
      oldText: z.string().describe("Original text"),
      newText: z.string().describe("New text"),
      language: z.string().optional().describe("Language for syntax hints"),
    }),
  },

  TerminalView: {
    description: "Terminal output display showing a command and its results.",
    props: z.object({
      command: z.string().describe("The command that was run"),
      output: z.string().describe("Command output"),
      exitCode: z.number().optional().describe("Exit code (0 = success)"),
    }),
  },

  EventTimeline: {
    description:
      'Scrolling timeline of session events. Reads events from state at "/events". Each event: { type, summary, detail?, timestamp }.',
    props: z.object({
      maxVisible: z.number().optional().describe("Max events to show (default 50)"),
    }),
  },

  ProgressPanel: {
    description: "Task checklist with status indicators.",
    props: z.object({
      tasks: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["planned", "active", "done"]),
        }),
      ),
    }),
  },
})
