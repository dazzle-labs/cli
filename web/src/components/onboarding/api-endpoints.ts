export interface EndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  description: string;
  auth: string;
  params?: EndpointParam[];
  responseExample?: string;
  notes?: string;
}

export interface EndpointGroup {
  id: string;
  name: string;
  description: string;
  endpoints: ApiEndpoint[];
}

export const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    id: "stage",
    name: "StageService",
    description:
      "Manage stages. Accepts Clerk JWT or API key authentication.",
    endpoints: [
      {
        id: "create-stage",
        method: "POST",
        path: "/dazzle.v1.StageService/CreateStage",
        description:
          "Create a stage record. Returns immediately with status 'inactive' — no pod is provisioned yet. Use the CLI to activate it.",
        auth: "Clerk JWT or API Key",
        params: [
          { name: "name", type: "string", required: false, description: "Display name for the stage" },
        ],
        responseExample: JSON.stringify(
          {
            stage: {
              name: "my-stage",
              status: "inactive",
            },
          },
          null,
          2,
        ),
        notes:
          "Stage is inactive until activated via the CLI with 'dazzle stage activate'.",
      },
      {
        id: "list-stages",
        method: "POST",
        path: "/dazzle.v1.StageService/ListStages",
        description: "List all stages owned by the authenticated user. Includes inactive stages.",
        auth: "Clerk JWT or API Key",
        params: [],
        responseExample: JSON.stringify(
          { stages: [{ name: "my-stage", status: "inactive" }] },
          null,
          2,
        ),
      },
      {
        id: "get-stage",
        method: "POST",
        path: "/dazzle.v1.StageService/GetStage",
        description: "Get details of a specific stage by name or ID.",
        auth: "Clerk JWT or API Key",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "Stage name or ID",
          },
        ],
        responseExample: JSON.stringify(
          {
            stage: {
              name: "my-stage",
              status: "running",
            },
          },
          null,
          2,
        ),
      },
      {
        id: "delete-stage",
        method: "POST",
        path: "/dazzle.v1.StageService/DeleteStage",
        description: "Delete a stage. If the stage is active, the pod is stopped first.",
        auth: "Clerk JWT or API Key",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "Stage name or ID",
          },
        ],
        responseExample: "{}",
      },
    ],
  },
  {
    id: "apikey",
    name: "ApiKeyService",
    description: "Manage API keys. Requires Clerk JWT authentication.",
    endpoints: [
      {
        id: "create-apikey",
        method: "POST",
        path: "/dazzle.v1.ApiKeyService/CreateApiKey",
        description:
          "Create a new API key. The full key is returned only once — store it securely.",
        auth: "Clerk JWT only",
        params: [
          {
            name: "name",
            type: "string",
            required: true,
            description: "Display name for the key",
          },
        ],
        responseExample: JSON.stringify(
          {
            key: {
              id: "key_abc123",
              name: "production",
              prefix: "dzl_a1b2c3d4e...",
            },
            secret: "dzl_a1b2c3d4e5f67890...",
          },
          null,
          2,
        ),
        notes: "The secret field contains the full key and is only shown on creation.",
      },
      {
        id: "list-apikeys",
        method: "POST",
        path: "/dazzle.v1.ApiKeyService/ListApiKeys",
        description: "List all API keys for the authenticated user.",
        auth: "Clerk JWT only",
        params: [],
        responseExample: JSON.stringify(
          { keys: [{ id: "key_abc123", name: "production", prefix: "dzl_a1b2c3d4e..." }] },
          null,
          2,
        ),
      },
      {
        id: "delete-apikey",
        method: "POST",
        path: "/dazzle.v1.ApiKeyService/DeleteApiKey",
        description: "Delete an API key by ID.",
        auth: "Clerk JWT only",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "API key ID",
          },
        ],
        responseExample: "{}",
      },
    ],
  },
  {
    id: "stream",
    name: "RtmpDestinationService",
    description:
      "Manage stream destinations (Twitch, YouTube, Kick, etc). Requires Clerk JWT authentication.",
    endpoints: [
      {
        id: "create-stream-dest",
        method: "POST",
        path: "/dazzle.v1.RtmpDestinationService/CreateStreamDestination",
        description:
          "Create a new stream destination. Stream keys are encrypted with AES-256-GCM before storage.",
        auth: "Clerk JWT only",
        params: [
          { name: "name", type: "string", required: true, description: "Display name" },
          {
            name: "platform",
            type: "string",
            required: true,
            description: '"twitch" | "youtube" | "kick" | "restream" | "custom"',
          },
          { name: "rtmp_url", type: "string", required: true, description: "RTMP ingest URL" },
          { name: "stream_key", type: "string", required: true, description: "Stream key (encrypted at rest)" },
          { name: "enabled", type: "bool", required: true, description: "Whether this destination is active" },
        ],
        responseExample: JSON.stringify(
          {
            destination: {
              id: "dest_abc123",
              name: "My Twitch",
              platform: "twitch",
              enabled: true,
            },
          },
          null,
          2,
        ),
      },
      {
        id: "list-stream-dests",
        method: "POST",
        path: "/dazzle.v1.RtmpDestinationService/ListStreamDestinations",
        description:
          "List stream destinations. Stream keys are masked (first 4 chars + ***).",
        auth: "Clerk JWT only",
        params: [
          { name: "stage_id", type: "string", required: true, description: "Stage UUID" },
        ],
        responseExample: JSON.stringify(
          {
            destinations: [
              { id: "dest_abc123", name: "My Twitch", platform: "twitch", streamKey: "live***", enabled: true },
            ],
          },
          null,
          2,
        ),
      },
      {
        id: "update-stream-dest",
        method: "POST",
        path: "/dazzle.v1.RtmpDestinationService/UpdateStreamDestination",
        description: "Update a stream destination's settings.",
        auth: "Clerk JWT only",
        params: [
          { name: "id", type: "string", required: true, description: "Destination ID" },
          { name: "name", type: "string", required: false, description: "Display name" },
          { name: "platform", type: "string", required: false, description: "Platform identifier" },
          { name: "rtmp_url", type: "string", required: false, description: "RTMP ingest URL" },
          { name: "stream_key", type: "string", required: false, description: "Stream key" },
          { name: "enabled", type: "bool", required: false, description: "Whether active" },
        ],
        responseExample: JSON.stringify({ destination: { id: "dest_abc123", name: "My Twitch", enabled: true } }, null, 2),
      },
      {
        id: "delete-stream-dest",
        method: "POST",
        path: "/dazzle.v1.RtmpDestinationService/DeleteStreamDestination",
        description: "Delete a stream destination.",
        auth: "Clerk JWT only",
        params: [
          { name: "id", type: "string", required: true, description: "Destination ID" },
        ],
        responseExample: "{}",
      },
    ],
  },
  {
    id: "user",
    name: "UserService",
    description: "User profile information. Requires Clerk JWT authentication.",
    endpoints: [
      {
        id: "get-profile",
        method: "POST",
        path: "/dazzle.v1.UserService/GetProfile",
        description:
          "Get the authenticated user's profile including stage and API key counts.",
        auth: "Clerk JWT only",
        params: [],
        responseExample: JSON.stringify(
          {
            userId: "user_abc123",
            email: "dev@example.com",
            name: "Jane Dev",
            stageCount: 2,
            apiKeyCount: 1,
          },
          null,
          2,
        ),
      },
    ],
  },
  {
    id: "http",
    name: "HTTP Endpoints",
    description: "Standard HTTP endpoints for health checks, CDP access, and stage proxying.",
    endpoints: [
      {
        id: "health",
        method: "GET",
        path: "/health",
        description:
          'Returns server health status. Authenticated requests also get stage counts.',
        auth: "Optional",
        params: [],
        responseExample: JSON.stringify({ status: "ok", stages: 2, maxStages: 10 }, null, 2),
        notes: "Unauthenticated requests only return { status: \"ok\" }.",
      },
      {
        id: "cdp-discovery",
        method: "GET",
        path: "/stage/<uuid>/cdp",
        description:
          "CDP endpoint. Returns Chrome DevTools Protocol discovery info with rewritten WebSocket URLs. Requires the stage to be active. Returns 503 if stage is not active.",
        auth: "Clerk JWT or API Key",
        params: [],
        responseExample: JSON.stringify(
          {
            webSocketDebuggerUrl: "wss://your-host/stage/a1b2c3d4-.../cdp/devtools/browser/...",
            "Browser": "Chrome/131.0.6778.204",
          },
          null,
          2,
        ),
        notes:
          "Also supports /stage/<uuid>/cdp/json/version and /stage/<uuid>/cdp/json for Chrome target listing. WebSocket connections to /stage/<uuid>/cdp are proxied directly to Chrome port 9222.",
      },
      {
        id: "stage-proxy",
        method: "ANY",
        path: "/stage/<id>/*",
        description:
          "Reverse proxy to an active stage. Strips the /stage/<id> prefix and forwards requests. Supports both HTTP and WebSocket.",
        auth: "Clerk JWT or API Key",
        params: [],
        notes:
          "Returns 404 if stage not found, 503 if stage is not ready yet. All headers and query parameters are forwarded.",
      },
    ],
  },
];
