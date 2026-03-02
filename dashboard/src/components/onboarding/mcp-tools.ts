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
      "Create and start the agent's browser streaming session. The session includes Chrome, OBS Studio, and a Node.js server. Returns status when ready.",
    params: [],
    example: JSON.stringify({ name: "start", arguments: {} }, null, 2),
  },
  {
    id: "stop",
    name: "stop",
    description: "Stop and destroy the agent's streaming session.",
    params: [],
    example: JSON.stringify({ name: "stop", arguments: {} }, null, 2),
  },
  {
    id: "status",
    name: "status",
    description:
      "Get the current status of the agent's session (running/stopped/starting).",
    params: [],
    example: JSON.stringify({ name: "status", arguments: {} }, null, 2),
  },
  {
    id: "set_html",
    name: "set_html",
    description:
      "Set HTML content to render in the session's Chrome browser. Stores the HTML and navigates Chrome to display it. Requires a running session (call start first).",
    params: [
      {
        name: "html",
        type: "string",
        required: true,
        description: "HTML content to render",
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
      "Get the current HTML content being rendered in the session's Chrome browser. Requires a running session.",
    params: [],
    example: JSON.stringify({ name: "get_html", arguments: {} }, null, 2),
  },
  {
    id: "edit_html",
    name: "edit_html",
    description:
      "Edit the current HTML content by finding and replacing a string. The old_string must exist exactly once in the current HTML. Requires a running session.",
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
    id: "screenshot",
    name: "screenshot",
    description:
      "Capture a screenshot of the OBS stream output as a PNG image. Requires a running session.",
    params: [],
    example: JSON.stringify({ name: "screenshot", arguments: {} }, null, 2),
  },
  {
    id: "gobs",
    name: "gobs",
    description:
      'Run OBS command via gobs-cli. Args passed directly (no shell). Requires a running session. Use shorthands to save tokens — e.g. "sc ls" to list scenes, "st s" to start streaming.',
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
