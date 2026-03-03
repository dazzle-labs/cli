# Source Tree Analysis

## Directory Structure

```
browser-streamer/
├── CLAUDE.md                    # Project instructions for AI assistants
├── Makefile                     # Build/deploy automation (remote SSH + buildkit)
├── provision.sh                 # Full infrastructure provisioning script
├── viewer.html                  # Legacy HLS viewer (vanilla JS + HLS.js)
├── example.html                 # Example HTML page for testing
├── package.json                 # Root: Playwright dependency for testing
├── .sops.yaml                   # SOPS encryption config (Age recipients)
├── .dockerignore                # Docker build exclusions
├── .gitignore                   # Git exclusions
│
├── control-plane/             # ★ CONTROL PLANE (Go)
│   ├── main.go                  # ★ Entry point: HTTP server, routing, pod lifecycle, proxies
│   ├── auth.go                  # Clerk JWT verification, API key validation
│   ├── db.go                    # DB migrations, CRUD, AES encryption
│   ├── mcp.go                   # MCP server (8 tools for AI agents)
│   ├── connect_session.go       # ConnectRPC SessionService
│   ├── connect_apikey.go        # ConnectRPC ApiKeyService
│   ├── connect_stream.go        # ConnectRPC StreamService
│   ├── connect_user.go          # ConnectRPC UserService
│   ├── go.mod / go.sum          # Go dependencies
│   ├── gen/                     # Protobuf-generated Go code
│   │   └── api/v1/              # Generated service stubs
│   ├── proto/                   # Protobuf source definitions
│   │   ├── session.proto
│   │   ├── apikey.proto
│   │   ├── stream.proto
│   │   └── user.proto
│   └── migrations/              # SQL migration files
│       ├── 001_initial.up.sql
│       └── 002_nullable_direct_port.up.sql
│
├── streamer/                    # ★ STREAMER POD SERVER (Node.js)
│   ├── index.js                 # ★ Express API: template engine, CDP proxy, navigation
│   ├── package.json             # Express + http-proxy dependencies
│   └── docker/                  # Container image and startup
│       ├── Dockerfile           # Streamer image (Ubuntu + Chrome + OBS + Node.js)
│       ├── entrypoint.sh        # Streamer startup: Xvfb → PulseAudio → Chrome → OBS → Node.js
│       └── pulse-default.pa     # PulseAudio configuration
│
├── control-plane/               # ★ CONTROL PLANE CONTAINER IMAGE
│   └── docker/
│       └── Dockerfile           # Multi-stage: Web build + Go build + Alpine runtime
│
├── web/                         # ★ WEB DASHBOARD (React + TypeScript)
│   ├── index.html               # SPA root (dark mode)
│   ├── package.json             # React 19, Vite, Tailwind CSS, Clerk, ConnectRPC
│   ├── vite.config.ts           # Vite config with API proxy
│   ├── tsconfig.json            # Strict TypeScript config
│   ├── .env                     # Clerk publishable key
│   ├── .nvmrc                   # Node 24
│   ├── src/
│       ├── main.tsx             # App bootstrap (ClerkProvider + Router)
│       ├── App.tsx              # Auth routing + AuthSetup
│       ├── client.ts            # ConnectRPC transport with auth interceptor
│       ├── lib/utils.ts         # cn() utility (clsx + tailwind-merge)
│       ├── components/
│       │   ├── Layout.tsx       # Sidebar layout shell
│       │   ├── ui/              # Reusable components (Button, Input, Badge, Card, etc.)
│       │   └── onboarding/      # Wizard steps (12 components)
│       ├── pages/
│       │   ├── LandingPage.tsx  # Marketing page + Clerk SignIn
│       │   ├── Dashboard.tsx    # Session grid + stream destinations
│       │   ├── GetStarted.tsx   # Two-path onboarding wizard
│       │   ├── ApiKeys.tsx      # API key management
│       │   ├── Docs.tsx         # Integration docs + code snippets
│       │   └── StreamConfig.tsx # RTMP destination management
│       └── gen/                 # Protobuf-generated TypeScript
│           ├── session_pb.ts
│           ├── apikey_pb.ts
│           ├── stream_pb.ts
│           └── user_pb.ts
│
├── k8s/                         # ★ KUBERNETES MANIFESTS
│   ├── namespace.yaml           # browser-streamer namespace
│   ├── control-plane-deployment.yaml  # Session manager pod spec
│   ├── control-plane-service.yaml     # ClusterIP service
│   ├── control-plane-rbac.yaml        # ServiceAccount + Role + RoleBinding
│   ├── browserless-deployment.yaml      # Chromium pool deployment
│   ├── browserless-service.yaml         # NodePort 30000
│   ├── browserless-secret.yaml          # Auth token (plaintext)
│   ├── browserless-hpa.yaml             # Autoscaler (1-6 replicas, 50% CPU)
│   ├── postgres.yaml                    # StatefulSet + PVC + Service
│   ├── ingress.yaml                     # Traefik ingress (stream.dazzle.fm)
│   ├── traefik-config.yaml              # HTTP→HTTPS redirect
│   ├── cluster-issuer.yaml              # Let's Encrypt cert-manager
│   ├── clerk-auth.secrets.yaml          # SOPS-encrypted Clerk keys
│   ├── clerk-oauth.secrets.yaml         # SOPS-encrypted OAuth secret
│   ├── encryption-key.secrets.yaml      # SOPS-encrypted AES key
│   └── postgres-auth.secrets.yaml       # SOPS-encrypted DB password
│
└── agent/                       # Agent workspace (mostly empty)
    └── .claude/                 # Claude Code agent config
```

## Critical Paths

| Path | Importance | Description |
|------|-----------|-------------|
| `control-plane/main.go` | Highest | Core control plane — all routing, pod lifecycle, proxy logic |
| `control-plane/mcp.go` | High | MCP server — AI agent integration point |
| `control-plane/auth.go` | High | Dual auth system (Clerk JWT + API key) |
| `control-plane/db.go` | High | Database schema, migrations, encryption |
| `streamer/index.js` | High | Streamer pod API — template engine, CDP proxy |
| `streamer/docker/entrypoint.sh` | High | Pod startup sequence (6 processes) |
| `streamer/docker/Dockerfile` | Medium | Streamer image (Chrome + OBS + Node.js) |
| `control-plane/docker/Dockerfile` | Medium | Multi-stage build (web + Go + runtime) |
| `web/src/App.tsx` | Medium | Dashboard auth routing |
| `web/src/client.ts` | Medium | ConnectRPC client setup |
| `k8s/control-plane-deployment.yaml` | Medium | Production configuration |
| `k8s/ingress.yaml` | Medium | External access (TLS) |
| `Makefile` | Medium | Build/deploy workflow |

## Entry Points

| Component | Entry Point | How It Starts |
|-----------|------------|---------------|
| Session Manager | `control-plane/main.go` | Go binary in Alpine container |
| Streamer | `streamer/docker/entrypoint.sh` → `streamer/index.js` | Bash entrypoint starts 6 processes |
| Dashboard | `web/src/main.tsx` | Vite build → static files served by Go binary |

## Integration Points

```
Dashboard ──ConnectRPC──→ Session Manager ──k8s API──→ Streamer Pods
    │                          │                           │
    └── Clerk JWT ────────────→├── Pod Create/Delete       ├── CDP WebSocket
                               ├── HTTP Reverse Proxy      ├── Template API
                               ├── WS Proxy                ├── OBS WebSocket
                               ├── MCP Server              └── Health Check
                               └── PostgreSQL
```
