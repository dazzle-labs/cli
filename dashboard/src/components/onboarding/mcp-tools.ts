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
    id: "create_stage",
    name: "create_stage",
    description:
      "Create and start the agent's stage — a browser streaming environment with Chrome, OBS Studio, and a Node.js server. You must create a stage before using any other tools. Returns status when ready.",
    params: [],
    example: JSON.stringify({ name: "create_stage", arguments: {} }, null, 2),
  },
  {
    id: "destroy_stage",
    name: "destroy_stage",
    description:
      "Tear down the agent's stage and all its processes. The stage cannot be used after this.",
    params: [],
    example: JSON.stringify({ name: "destroy_stage", arguments: {} }, null, 2),
  },
  {
    id: "stage_status",
    name: "stage_status",
    description:
      "Get the current status of the agent's stage (running/stopped/starting).",
    params: [],
    example: JSON.stringify({ name: "stage_status", arguments: {} }, null, 2),
  },
  {
    id: "set_html",
    name: "set_html",
    description:
      "Set HTML content to render in the session's Chrome browser. Stores the HTML and navigates Chrome to display it. Requires an active stage (call create_stage first).",
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
      "Get the current HTML content being rendered in the session's Chrome browser. Requires an active stage (call create_stage first).",
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
      "Edit the current HTML content by finding and replacing a string. The old_string must exist exactly once in the current HTML. Requires an active stage (call create_stage first).",
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
      "Capture a screenshot of the OBS stream output as a PNG image. Requires an active stage (call create_stage first).",
    params: [],
    example: JSON.stringify({ name: "screenshot", arguments: {} }, null, 2),
  },
  {
    id: "gobs",
    name: "gobs",
    description:
      'Run OBS command via gobs-cli. Args passed directly (no shell). Requires an active stage (call create_stage first). Use shorthands to save tokens — e.g. "sc ls" to list scenes, "st s" to start streaming.',
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
