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
      "Deactivate your stage. Shuts down the browser and releases cloud resources. Call start to bring it back — stream destinations are preserved, but the panel script will need to be re-set.",
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
    id: "set_script",
    name: "set_script",
    description:
      "Set JavaScript or JSX content to render in your stage's browser. Write vanilla JS (append to document.body) or React JSX (define const App and it auto-mounts). React hooks, Zustand, and Tailwind CSS are available as globals — no imports needed. Changes are hot-swapped with no page reload. Requires an active stage (call start first).",
    params: [
      {
        name: "script",
        type: "string",
        required: true,
        description: "JavaScript or JSX code to render",
      },
    ],
    example: JSON.stringify(
      {
        name: "set_script",
        arguments: { script: 'const App = () => <div className="text-4xl font-bold text-white flex items-center justify-center h-screen">Hello World</div>' },
      },
      null,
      2,
    ),
  },
  {
    id: "get_script",
    name: "get_script",
    description:
      "Get the current JavaScript content being rendered in your stage's browser. Requires an active stage (call start first).",
    params: [],
    example: JSON.stringify({ name: "get_script", arguments: {} }, null, 2),
  },
  {
    id: "edit_script",
    name: "edit_script",
    description:
      "Edit the current JavaScript content by finding and replacing a string. The old_string must exist exactly once in the current code. Changes are hot-swapped with no page reload. Requires an active stage (call start first).",
    params: [
      {
        name: "old_string",
        type: "string",
        required: true,
        description: "The exact string to find in the current code",
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
        name: "edit_script",
        arguments: {
          old_string: "Hello",
          new_string: "Goodbye",
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
      "Capture a screenshot of your stage's current output as a PNG image. Requires an active stage (call start first).",
    params: [],
    example: JSON.stringify({ name: "screenshot", arguments: {} }, null, 2),
  },
  {
    id: "obs",
    name: "obs",
    description:
      'Control OBS — manage scenes, inputs, streaming, recording, and audio. Requires an active stage (call start first). e.g. "sc ls" to list scenes, "st s" to start streaming.',
    params: [
      {
        name: "args",
        type: "string[]",
        required: true,
        description:
          'OBS command arguments, e.g. ["st", "s"] to start streaming, ["sc", "ls"] to list scenes.',
      },
    ],
    example: JSON.stringify(
      { name: "obs", arguments: { args: ["st", "s"] } },
      null,
      2,
    ),
  },
];
