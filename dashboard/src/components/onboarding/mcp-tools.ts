export interface McpToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface McpTool {
  id: string;
  name: string;
  description: string;
  params: McpToolParam[];
  example: string;
}

export const MCP_TOOLS: McpTool[] = [
  {
    id: "start",
    name: "start",
    description:
      "Activate your stage. Call this before using any other tools. Returns status when ready. Your stage gives you a browser you can render content in, capture screenshots, and stream live.",
    params: [],
    example: JSON.stringify({ name: "start", arguments: {} }, null, 2),
  },
  {
    id: "stop",
    name: "stop",
    description:
      "Deactivate your stage. It can be reactivated later with start.",
    params: [],
    example: JSON.stringify({ name: "stop", arguments: {} }, null, 2),
  },
  {
    id: "status",
    name: "status",
    description:
      "Get the current status of your stage (active/inactive/starting).",
    params: [],
    example: JSON.stringify({ name: "status", arguments: {} }, null, 2),
  },
  {
    id: "set_html",
    name: "set_html",
    description:
      "Set JavaScript content to render in your stage's browser. Write vanilla JS that creates DOM elements and appends them to document.body. Changes are hot-swapped with no page reload. Requires an active stage (call start first).",
    params: [
      {
        name: "html",
        type: "string",
        required: true,
        description: "HTML content to render",
      },
      {
        name: "panel",
        type: "string",
        required: false,
        description:
          "Panel name (default: main). Use with layout tool to target specific panels in multi-panel layouts.",
      },
    ],
    example: JSON.stringify(
      {
        name: "set_html",
        arguments: { html: "<h1>Hello World</h1>" },
      },
      null,
      2,
    ),
  },
  {
    id: "get_html",
    name: "get_html",
    description:
      "Get the current JavaScript content being rendered in your stage's browser. Requires an active stage (call start first).",
    params: [
      {
        name: "panel",
        type: "string",
        required: false,
        description:
          "Panel name (default: main). Use with layout tool to target specific panels in multi-panel layouts.",
      },
    ],
    example: JSON.stringify({ name: "get_html", arguments: {} }, null, 2),
  },
  {
    id: "edit_html",
    name: "edit_html",
    description:
      "Edit the current JavaScript content by finding and replacing a string. The old_string must exist exactly once in the current code. Changes are hot-swapped with no page reload. Requires an active stage (call start first).",
    params: [
      {
        name: "old_string",
        type: "string",
        required: true,
        description: "The exact string to find in the current HTML",
      },
      {
        name: "new_string",
        type: "string",
        required: true,
        description: "The replacement string",
      },
      {
        name: "panel",
        type: "string",
        required: false,
        description:
          "Panel name (default: main). Use with layout tool to target specific panels in multi-panel layouts.",
      },
    ],
    example: JSON.stringify(
      {
        name: "edit_html",
        arguments: {
          old_string: "<h1>Hello</h1>",
          new_string: "<h1>Goodbye</h1>",
        },
      },
      null,
      2,
    ),
  },
  {
    id: "layout",
    name: "layout",
    description:
      'Get or set the multi-panel layout. Presets: "single" (main), "split" (left/right), "grid-2x2" (top-left/top-right/bottom-left/bottom-right), "pip" (main/pip). Use specs for custom positioning. Call with no params to read current layout.',
    params: [
      {
        name: "preset",
        type: "string",
        required: false,
        description:
          "Layout preset: single, split, grid-2x2, or pip",
      },
      {
        name: "names",
        type: "string[]",
        required: false,
        description:
          "Custom panel names for the preset slots",
      },
      {
        name: "specs",
        type: "string",
        required: false,
        description:
          'JSON array of {name, x, y, width, height} for custom layouts (percentage-based positioning)',
      },
    ],
    example: JSON.stringify(
      {
        name: "layout",
        arguments: { preset: "split" },
      },
      null,
      2,
    ),
  },
  {
    id: "screenshot",
    name: "screenshot",
    description:
      "Capture a screenshot of your stage's current output as a PNG image. Requires an active stage (call start first).",
    params: [],
    example: JSON.stringify({ name: "screenshot", arguments: {} }, null, 2),
  },
  {
    id: "gobs",
    name: "gobs",
    description:
      'Run OBS command via gobs-cli. Requires an active stage (call start first). Use shorthands to save tokens — e.g. "sc ls" to list scenes, "st s" to start streaming.',
    params: [
      {
        name: "args",
        type: "string[]",
        required: true,
        description:
          'gobs-cli args, e.g. ["st", "s"] to start streaming, ["sc", "ls"] to list scenes.',
      },
    ],
    example: JSON.stringify(
      { name: "gobs", arguments: { args: ["st", "s"] } },
      null,
      2,
    ),
  },
];
