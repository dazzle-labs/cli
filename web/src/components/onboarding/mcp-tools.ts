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
  comingSoon?: boolean;
}

export const MCP_TOOLS: McpTool[] = [
  {
    id: "start",
    name: "start",
    description:
      'Activate your stage. Call this before using any other tools. Returns status when ready. Your stage gives you a browser you can render content in, capture screenshots, and stream to platforms like Twitch and YouTube. Starting the stage does NOT begin streaming — use the obs tool with ["st", "s"] to go live when you\'re ready.',
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
      "Set JavaScript content to render in your stage's browser. Write vanilla JS or JSX. The page is full-viewport with a black background. Changes are hot-swapped with zero page reloads. Requires an active stage (call start first).",
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
        arguments: {
          script:
            'const App = () => <div style={{color: "white", fontSize: 48}}>Hello World</div>;',
        },
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
          old_string: "Hello World",
          new_string: "Hello Dazzle",
        },
      },
      null,
      2,
    ),
  },
  {
    id: "emit_event",
    name: "emit_event",
    description:
      "Push live data to your running panel without rewriting or reloading the script. Use with set_script: write your event listeners once, then drive updates with emit_event.",
    params: [
      {
        name: "event",
        type: "string",
        required: true,
        description:
          "Event name that your set_script code listens for (e.g. 'update', 'alert', 'theme-change')",
      },
      {
        name: "data",
        type: "string (JSON)",
        required: true,
        description:
          "JSON object with event payload — merged into window.__state and delivered as e.detail.data",
      },
    ],
    example: JSON.stringify(
      {
        name: "emit_event",
        arguments: {
          event: "score",
          data: '{"points": 42}',
        },
      },
      null,
      2,
    ),
  },
  {
    id: "get_logs",
    name: "get_logs",
    description:
      "Retrieve recent browser console logs (errors, warnings, info, debug). Returns the last N entries like tail. Requires an active stage (call start first).",
    params: [
      {
        name: "limit",
        type: "number",
        required: false,
        description: "Number of most recent log entries to return (default 100, max 1000)",
      },
    ],
    example: JSON.stringify(
      { name: "get_logs", arguments: { limit: 50 } },
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
      'Control OBS — manage scenes, inputs, streaming, recording, and audio. Requires an active stage (call start first). Note: starting a stage does NOT go live automatically — use "st s" to start streaming when ready, and "st st" to stop. e.g. "sc ls" to list scenes.',
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
