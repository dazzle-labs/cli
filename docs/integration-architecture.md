# Integration Architecture

## Overview

Browser Streamer (Dazzle) is a multi-part system where the session manager acts as the central hub. All external traffic flows through the session manager, which proxies to ephemeral streamer pods. The dashboard communicates with the session manager via ConnectRPC.

## Part Communication Map

```
┌─────────────────────────────────────────────────────────────┐
│                     External Clients                         │
│  (Browser, AI Agents, Playwright, CDP Tools)                 │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS (stream.dazzle.fm)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Traefik Ingress (TLS Termination)               │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP :8080
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  Session Manager (Go)                         │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │Dashboard │  │ConnectRPC│  │   MCP    │  │CDP Proxy │    │
│  │SPA Files │  │   API    │  │  Server  │  │& Auto-   │    │
│  │  (GET /) │  │(/api.v1) │  │(/mcp/*)  │  │Provision │    │
│  └──────────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│                      │             │              │           │
│  ┌───────────────────┴─────────────┴──────────────┘          │
│  │         Pod Lifecycle Manager                              │
│  │  (Create/Delete/Watch k8s Pods)                           │
│  └───────────┬──────────────────────────┬────────────────┐   │
│              │                          │                │   │
│  ┌───────────▼──────────┐  ┌───────────▼──┐  ┌──────────▼─┐│
│  │  HTTP Reverse Proxy  │  │  WS Proxy    │  │ PostgreSQL ││
│  │  (/session/:id/*)    │  │  (/cdp/:id)  │  │ (users,    ││
│  │                      │  │  (WS tunnel) │  │  keys,     ││
│  └───────────┬──────────┘  └──────┬───────┘  │  sessions, ││
│              │                     │          │  streams)  ││
└──────────────┼─────────────────────┼──────────┴────────────┘│
               │                     │                         │
               ▼                     ▼                         │
┌──────────────────────────────────────────────┐               │
│           Streamer Pod (Ephemeral)            │               │
│                                               │               │
│  ┌────────┐  ┌─────────┐  ┌───────────────┐ │               │
│  │ Chrome │  │   OBS   │  │  Node.js API  │ │               │
│  │  :9222 │  │  :4455  │  │    :8080      │ │               │
│  │  (CDP) │  │  (WS)   │  │ (Express)     │ │               │
│  └────────┘  └─────────┘  └───────────────┘ │               │
│  ┌────────┐  ┌─────────┐                     │               │
│  │  Xvfb  │  │ Pulse   │                     │               │
│  │  :99   │  │ Audio   │                     │               │
│  └────────┘  └─────────┘                     │               │
└──────────────────────────────────────────────┘               │
```

## Integration Points

### 1. Dashboard → Session Manager (ConnectRPC)

| Protocol | Path | Direction | Description |
|----------|------|-----------|-------------|
| ConnectRPC | `/api.v1.SessionService/*` | Dashboard → SM | Session CRUD |
| ConnectRPC | `/api.v1.ApiKeyService/*` | Dashboard → SM | API key CRUD |
| ConnectRPC | `/api.v1.StreamService/*` | Dashboard → SM | Stream destination CRUD |
| ConnectRPC | `/api.v1.UserService/*` | Dashboard → SM | User profile |

**Auth:** Clerk JWT token (injected via interceptor from `@clerk/clerk-react`)

### 2. Session Manager → Kubernetes API

| Action | k8s API | Description |
|--------|---------|-------------|
| Create Pod | `POST /api/v1/namespaces/{ns}/pods` | Launch streamer pod |
| Delete Pod | `DELETE /api/v1/namespaces/{ns}/pods/{name}` | Kill session |
| List Pods | `GET /api/v1/namespaces/{ns}/pods?labelSelector=app=streamer-session` | Status refresh |
| Get Pod | `GET /api/v1/namespaces/{ns}/pods/{name}` | Individual status |

**Auth:** In-cluster ServiceAccount with namespaced RBAC (pods: create, delete, get, list, watch)

### 3. Session Manager → Streamer Pod (HTTP Proxy)

| Protocol | Path Pattern | Purpose |
|----------|-------------|---------|
| HTTP | `/session/:id/*` → `http://<podIP>:8080/*` | General API proxy |
| WebSocket | `/session/:id/*` → `ws://<podIP>:8080/*` | WebSocket proxy |
| HTTP | `/cdp/:id/json/*` → `http://<podIP>:9222/json/*` | CDP discovery |
| WebSocket | `/cdp/:id` → `ws://<podIP>:9222/devtools/*` | CDP WebSocket tunnel |

**Auth:** Internal `POD_TOKEN` passed as query parameter to streamer

### 4. Session Manager → PostgreSQL

| Operation | Tables | Description |
|-----------|--------|-------------|
| User upsert | `users` | On first Clerk JWT auth |
| Session logging | `session_log` | On create/delete |
| API key CRUD | `api_keys` | Key management |
| Stream dest CRUD | `stream_destinations` | RTMP config |
| Schema migrations | `schema_migrations` | Version tracking |

**Connection:** `postgres://browser_streamer:<password>@postgres:5432/browser_streamer`

### 5. MCP Client → Session Manager (MCP Protocol)

| Protocol | Path | Description |
|----------|------|-------------|
| StreamableHTTP | `/mcp/<agent-uuid>/` | MCP tool invocation |

**Auth:** Clerk JWT or API key. Agent UUID extracted from path and used as session identifier.

### 6. Session Manager → Streamer Pod (MCP Tool Execution)

| MCP Tool | Pod Endpoint | Description |
|----------|-------------|-------------|
| `set_html` | `POST /api/template` | Send HTML to render |
| `get_html` | `GET /api/template` | Retrieve current HTML |
| `edit_html` | `POST /api/template/edit` | Find-replace in HTML |
| `screenshot` | `WS :4455` (OBS) | Capture via OBS WebSocket v5 |
| `gobs` | `exec gobs-cli --host <podIP>` | OBS CLI commands |

## Data Flow: Session Lifecycle

```
1. Client authenticates (Clerk JWT or API key)
2. Client calls CreateSession (ConnectRPC) or /cdp/<uuid> (auto-provision)
3. Session Manager creates k8s Pod with browser-streamer:latest image
4. Pod starts: Xvfb → PulseAudio → Chrome → OBS → Node.js
5. Session Manager polls pod status until Running + PodIP available
6. Client receives session ID and connection details
7. Client interacts via:
   - ConnectRPC API (manage session)
   - HTTP proxy (/session/:id/*) for template/navigate API
   - WebSocket (/cdp/:id) for direct Chrome DevTools Protocol
   - MCP (/mcp/:uuid/) for AI agent tools
8. Client deletes session or GC removes idle sessions (3 min stuck timeout)
9. Session Manager deletes pod and logs to session_log table
```

## Shared Dependencies

| Dependency | Used By | Purpose |
|------------|---------|---------|
| Protobuf schemas | Session Manager + Dashboard | Service contracts |
| `browserless-auth` secret | Session Manager + Streamer Pods | Internal auth token |
| PostgreSQL | Session Manager | Persistent storage |
| Clerk | Session Manager + Dashboard | User authentication |
| k8s namespace `browser-streamer` | All components | Resource isolation |
