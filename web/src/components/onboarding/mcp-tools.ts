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
      "Deactivate your stage. Shuts down the browser and releases cloud resources. Call start to bring it back — stream destinations are preserved, but the scene spec will need to be re-set.",
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
    id: "sceneSet",
    name: "sceneSet",
    description:
      "Set the full scene spec. Replaces the entire scene. The spec is a declarative UI description with elements, layout, and state bindings. Requires an active stage (call start first).",
    params: [
      {
        name: "spec",
        type: "object",
        required: true,
        description:
          "Scene spec object with root, elements, and state",
      },
    ],
    example: JSON.stringify(
      {
        name: "sceneSet",
        arguments: {
          spec: {
            root: "main",
            elements: {
              main: {
                type: "Box",
                props: { style: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" } },
                children: ["title"],
              },
              title: {
                type: "Heading",
                props: { text: "Hello World", level: 1 },
              },
            },
            state: {},
          },
        },
      },
      null,
      2,
    ),
  },
  {
    id: "scenePatch",
    name: "scenePatch",
    description:
      "Apply JSON Patch operations (RFC 6902) to the current scene. Supports add, replace, remove. Requires an active stage (call start first).",
    params: [
      {
        name: "patches",
        type: "PatchOp[]",
        required: true,
        description:
          "Array of JSON Patch operations, each with op, path, and optional value",
      },
    ],
    example: JSON.stringify(
      {
        name: "scenePatch",
        arguments: {
          patches: [
            { op: "replace", path: "/elements/title/props/text", value: "Updated Title" },
          ],
        },
      },
      null,
      2,
    ),
  },
  {
    id: "stateSet",
    name: "stateSet",
    description:
      'Update a value in the scene state by JSON Pointer path. Use "/-" suffix to append to an array. Requires an active stage (call start first).',
    params: [
      {
        name: "path",
        type: "string",
        required: true,
        description:
          "JSON Pointer path within state, e.g. /events/- or /status/title",
      },
      {
        name: "value",
        type: "any (JSON)",
        required: true,
        description: "JSON-encoded value to set",
      },
    ],
    example: JSON.stringify(
      {
        name: "stateSet",
        arguments: { path: "/status/title", value: '"Live Now"' },
      },
      null,
      2,
    ),
  },
  {
    id: "sceneRead",
    name: "sceneRead",
    description:
      "Read the current scene spec. Returns the full spec (root, elements, state). Requires an active stage (call start first).",
    params: [],
    example: JSON.stringify({ name: "sceneRead", arguments: {} }, null, 2),
  },
  {
    id: "timelineAppend",
    name: "timelineAppend",
    description:
      "Add one or more entries to the elapsed timeline. Entries are inserted in sorted order by `at` (elapsed ms). Each entry specifies a scene mutation (snapshot, patch, or stateSet) to fire at that presentation time.",
    params: [
      {
        name: "entries",
        type: "TimelineEntry[]",
        required: true,
        description:
          "Array of timeline entries. Each has `at` (elapsed ms), `action` (snapshot/patch/stateSet), optional `transition` and `label`.",
      },
    ],
    example: JSON.stringify(
      {
        name: "timelineAppend",
        arguments: {
          entries: [
            {
              at: 0,
              action: { type: "snapshot", spec: { root: "main", elements: {}, state: {} } },
              label: "Opening scene",
            },
          ],
        },
      },
      null,
      2,
    ),
  },
  {
    id: "timelinePlay",
    name: "timelinePlay",
    description:
      "Start, pause, or stop timeline playback. Use seekTo to jump to a specific elapsed ms before playing.",
    params: [
      {
        name: "action",
        type: '"play" | "pause" | "stop"',
        required: true,
        description: "Playback action",
      },
      {
        name: "rate",
        type: "number",
        required: false,
        description: "Playback speed multiplier, default 1.0",
      },
      {
        name: "seekTo",
        type: "number",
        required: false,
        description: "Jump to this elapsed ms before playing",
      },
    ],
    example: JSON.stringify(
      { name: "timelinePlay", arguments: { action: "play", rate: 1.0 } },
      null,
      2,
    ),
  },
  {
    id: "timelineRead",
    name: "timelineRead",
    description:
      "Read the current timeline state: entries, playback status, and elapsed position.",
    params: [],
    example: JSON.stringify(
      { name: "timelineRead", arguments: {} },
      null,
      2,
    ),
  },
  {
    id: "timelineClear",
    name: "timelineClear",
    description: "Remove all timeline entries and reset playback.",
    params: [],
    example: JSON.stringify(
      { name: "timelineClear", arguments: {} },
      null,
      2,
    ),
  },
  {
    id: "getLogs",
    name: "getLogs",
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
      { name: "getLogs", arguments: { limit: 50 } },
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
