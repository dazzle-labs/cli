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
    id: "session",
    name: "SessionService",
    description:
      "Manage browser sessions. Accepts Clerk JWT or API key authentication.",
    endpoints: [
      {
        id: "create-session",
        method: "POST",
        path: "/api.v1.SessionService/CreateSession",
        description:
          "Create a new browser session. Spins up an isolated pod with Chrome, OBS Studio, and a Node.js server.",
        auth: "Clerk JWT or API Key",
        params: [],
        responseExample: JSON.stringify(
          {
            session: {
              id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              podName: "streamer-a1b2c3d4",
              podIp: "",
              directPort: 31042,
              status: "starting",
              ownerUserId: "user_abc123",
            },
          },
          null,
          2,
        ),
        notes:
          "Returns ResourceExhausted if max sessions reached. Pod IP is empty until status becomes 'running'.",
      },
      {
        id: "list-sessions",
        method: "POST",
        path: "/api.v1.SessionService/ListSessions",
        description: "List all sessions owned by the authenticated user.",
        auth: "Clerk JWT or API Key",
        params: [],
        responseExample: JSON.stringify(
          { sessions: [{ id: "a1b2c3d4-...", status: "running" }] },
          null,
          2,
        ),
      },
      {
        id: "get-session",
        method: "POST",
        path: "/api.v1.SessionService/GetSession",
        description: "Get details of a specific session by ID.",
        auth: "Clerk JWT or API Key",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "Session UUID",
          },
        ],
        responseExample: JSON.stringify(
          {
            session: {
              id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
              status: "running",
              podIp: "10.42.0.15",
            },
          },
          null,
          2,
        ),
      },
      {
        id: "delete-session",
        method: "POST",
        path: "/api.v1.SessionService/DeleteSession",
        description: "Delete and stop a session by ID.",
        auth: "Clerk JWT or API Key",
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "Session UUID",
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
        path: "/api.v1.ApiKeyService/CreateApiKey",
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
              prefix: "bstr_a1b2c3d4e...",
            },
            secret: "bstr_a1b2c3d4e5f67890...",
          },
          null,
          2,
        ),
        notes: "The secret field contains the full key and is only shown on creation.",
      },
      {
        id: "list-apikeys",
        method: "POST",
        path: "/api.v1.ApiKeyService/ListApiKeys",
        description: "List all API keys for the authenticated user.",
        auth: "Clerk JWT only",
        params: [],
        responseExample: JSON.stringify(
          { keys: [{ id: "key_abc123", name: "production", prefix: "bstr_a1b2c3d4e..." }] },
          null,
          2,
        ),
      },
      {
        id: "delete-apikey",
        method: "POST",
        path: "/api.v1.ApiKeyService/DeleteApiKey",
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
    name: "StreamService",
    description:
      "Manage stream destinations (Twitch, YouTube, Kick, etc). Requires Clerk JWT authentication.",
    endpoints: [
      {
        id: "create-stream-dest",
        method: "POST",
        path: "/api.v1.StreamService/CreateStreamDestination",
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
        path: "/api.v1.StreamService/ListStreamDestinations",
        description:
          "List stream destinations. Stream keys are masked (first 4 chars + ***).",
        auth: "Clerk JWT only",
        params: [
          { name: "session_id", type: "string", required: true, description: "Session UUID" },
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
        path: "/api.v1.StreamService/UpdateStreamDestination",
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
        path: "/api.v1.StreamService/DeleteStreamDestination",
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
        path: "/api.v1.UserService/GetProfile",
        description:
          "Get the authenticated user's profile including session and API key counts.",
        auth: "Clerk JWT only",
        params: [],
        responseExample: JSON.stringify(
          {
            userId: "user_abc123",
            email: "dev@example.com",
            name: "Jane Dev",
            sessionCount: 2,
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
    description: "Standard HTTP endpoints for health checks, CDP access, and session proxying.",
    endpoints: [
      {
        id: "health",
        method: "GET",
        path: "/health",
        description:
          'Returns server health status. Authenticated requests also get session counts.',
        auth: "Optional",
        params: [],
        responseExample: JSON.stringify({ status: "ok", sessions: 2, maxSessions: 10 }, null, 2),
        notes: "Unauthenticated requests only return { status: \"ok\" }.",
      },
      {
        id: "cdp-discovery",
        method: "GET",
        path: "/cdp/<uuid>",
        description:
          "CDP auto-provisioning endpoint. Creates a session if one doesn't exist for the UUID, waits up to 60s for it to be ready, and returns Chrome DevTools Protocol discovery info with rewritten WebSocket URLs.",
        auth: "Clerk JWT or API Key",
        params: [],
        responseExample: JSON.stringify(
          {
            webSocketDebuggerUrl: "wss://your-host/cdp/a1b2c3d4-.../devtools/browser/...",
            "Browser": "Chrome/131.0.6778.204",
          },
          null,
          2,
        ),
        notes:
          "Also supports /cdp/<uuid>/json/version and /cdp/<uuid>/json for Chrome target listing. WebSocket connections to /cdp/<uuid> are proxied directly to Chrome port 9222.",
      },
      {
        id: "session-proxy",
        method: "ANY",
        path: "/session/<id>/*",
        description:
          "Reverse proxy to a running session's pod. Strips the /session/<id> prefix and forwards to http://<podIP>:8080. Supports both HTTP and WebSocket.",
        auth: "Clerk JWT or API Key",
        params: [],
        notes:
          "Returns 404 if session not found, 503 if session is not ready yet. All headers and query parameters are forwarded.",
      },
    ],
  },
];
