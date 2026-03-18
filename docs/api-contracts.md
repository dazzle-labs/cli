# API Contracts

**Last updated:** 2026-03-09

All control plane RPC services use **ConnectRPC** (protobuf over HTTP/2, also compatible with HTTP/1.1 JSON). Base URL: `https://stream.dazzle.fm`

---

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer <token>
```

Where `<token>` is either:
- **Clerk JWT** — obtained from `clerk.session.getToken()` in the frontend, or via OAuth device flow (`dazzle login`)
- **API Key** — `dzl_<secret>` format, for programmatic/headless use; accepted by all services except ApiKeyService

---

## StageService

Accepts Clerk JWT **or** API key.

### CreateStage
```
POST /api.v1.StageService/CreateStage

Request:  { "name": string }
Response: { "stage": Stage }
```
Creates a persistent stage record (status: `inactive`). Does not provision a pod.

### ListStages
```
POST /api.v1.StageService/ListStages

Request:  {}
Response: { "stages": Stage[] }
```

### GetStage
```
POST /api.v1.StageService/GetStage

Request:  { "id": string }
Response: { "stage": Stage }
```

### ActivateStage
```
POST /api.v1.StageService/ActivateStage

Request:  { "id": string }
Response: { "stage": Stage }
```
Creates pod, waits for readiness, restores content from R2 and configures stream destination. Returns stage with status `running`.

### DeactivateStage
```
POST /api.v1.StageService/DeactivateStage

Request:  { "id": string }
Response: { "stage": Stage }
```
Deletes pod but keeps DB record (status: `inactive`).

### DeleteStage
```
POST /api.v1.StageService/DeleteStage

Request:  { "id": string }
Response: {}
```
Deletes pod (waits for termination + sidecar final sync), cleans up R2 storage, removes DB record.

### UpdateStage
```
POST /api.v1.StageService/UpdateStage

Request:  { "stage": { "id": string, "name": string }, "update_mask": { "paths": ["name"] } }
Response: { "stage": Stage }
```

### SetStageDestination
```
POST /api.v1.StageService/SetStageDestination

Request:  { "stage_id": string, "destination_id": string }
Response: { "stage": Stage }
```

### RegeneratePreviewToken
```
POST /api.v1.StageService/RegeneratePreviewToken

Request:  { "id": string }
Response: { "stage": Stage }
```
Generates a new `dpt_*` preview token for the stage. Invalidates the previous token.

### Stage Object

```typescript
interface Stage {
  id: string;
  pod_name: string;
  pod_ip: string;
  direct_port: number;
  created_at: Timestamp;
  status: "inactive" | "starting" | "running" | "stopping";
  owner_user_id: string;
  name: string;
  destination_id: string;
  destination: StreamDestination | null;  // populated if destination_id is set
  preview: {
    watch_url: string;
    hls_url: string;
  } | null;  // populated if preview token exists
}
```

---

## ApiKeyService

Accepts Clerk JWT **only**.

### CreateApiKey
```
POST /api.v1.ApiKeyService/CreateApiKey

Request:  { "name": string }
Response: { "key": ApiKey, "secret": string }
```
The `secret` is returned **once only** and never stored in plaintext.

### ListApiKeys
```
POST /api.v1.ApiKeyService/ListApiKeys

Request:  {}
Response: { "keys": ApiKey[] }
```

### DeleteApiKey
```
POST /api.v1.ApiKeyService/DeleteApiKey

Request:  { "id": string }
Response: {}
```

### ApiKey Object

```typescript
interface ApiKey {
  id: string;
  name: string;
  prefix: string;         // e.g., "dzl_AbC1"
  created_at: Timestamp;
  last_used_at: Timestamp | null;
}
```

---

## RtmpDestinationService

Accepts Clerk JWT **or** API key.

### CreateStreamDestination
```
POST /api.v1.RtmpDestinationService/CreateStreamDestination

Request:
{
  "name": string,
  "platform": string,    // "twitch" | "youtube" | "kick" | "restream" | "custom"
  "rtmp_url": string,
  "stream_key": string,  // stored AES-256-GCM encrypted
  "enabled": boolean
}
Response: { "destination": StreamDestination }
```

### ListStreamDestinations
```
POST /api.v1.RtmpDestinationService/ListStreamDestinations

Request:  { "stage_id": string }
Response: { "destinations": StreamDestination[] }
```

### UpdateStreamDestination
```
POST /api.v1.RtmpDestinationService/UpdateStreamDestination

Request:
{
  "id": string,
  "name": string,
  "platform": string,
  "rtmp_url": string,
  "stream_key": string,
  "enabled": boolean
}
Response: { "destination": StreamDestination }
```

### DeleteStreamDestination
```
POST /api.v1.RtmpDestinationService/DeleteStreamDestination

Request:  { "id": string }
Response: {}
```

### StreamDestination Object

```typescript
interface StreamDestination {
  id: string;
  name: string;
  platform: string;
  rtmp_url: string;
  stream_key: string;    // decrypted on read
  enabled: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

---

## UserService

Accepts Clerk JWT **or** API key.

### GetProfile
```
POST /api.v1.UserService/GetProfile

Request:  {}
Response:
{
  "user_id": string,
  "email": string,
  "name": string,
  "stage_count": number,
  "api_key_count": number
}
```

---

## Non-RPC HTTP Endpoints (Control Plane)

### Health
```
GET /health
Response: { "status": "ok" }
         or (if authenticated): { "status": "ok", "stages": N, "maxStages": N }
```

### CDP Proxy
```
GET  /stage/<stage-id>/cdp                Chrome version info (webSocketDebuggerUrl rewritten)
GET  /stage/<stage-id>/cdp/json/version   Chrome version info (webSocketDebuggerUrl rewritten)
GET  /stage/<stage-id>/cdp/json           Tab list (WS URLs rewritten)
WS   /stage/<stage-id>/cdp               Full CDP WebSocket proxy to Chrome
```
Auth: Clerk JWT or API key. The `webSocketDebuggerUrl` is rewritten to `wss://<host>/stage/<stage-id>/cdp`.

### Stage Proxy
```
*    /stage/<id>/<path>     HTTP proxy to streamer pod (auth required)
WS   /stage/<id>/*          WebSocket proxy to streamer pod
POST /stage/<id>/mcp/*      MCP server for this stage
```

---

## Sidecar Pod API

The Go sidecar in each streamer pod serves ConnectRPC APIs behind the `/_dz_9f7a3b1c/` path prefix on port 8080. Services: **SyncService**, **RuntimeService**, **ObsService**. These are consumed by the control-plane's `pod_client` and are not intended for direct external access.

**Service-Level Restrictions:**
- StageService: Accepts both Clerk JWT and API key
- ApiKeyService, RtmpDestinationService, UserService: Clerk JWT only
- MCP endpoints: Accepts both Clerk JWT and API key
- HTTP proxy/CDP endpoints: Accepts both
