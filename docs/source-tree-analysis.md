# Source Tree Analysis

**Last updated:** 2026-03-03

---

## Full Directory Structure

```
browser-streamer/                    # Monorepo root
├── Makefile                         # All build/deploy targets
├── provision.sh                     # Full VPS provisioning script
├── package.json                     # Root-level Playwright (integration testing)
│
├── control-plane/                   # [PART 1] Go backend
│   ├── main.go                      # ★ Entry point: Manager, HTTP routing, shutdown
│   ├── auth.go                      # Clerk JWT + API key authentication
│   ├── db.go                        # DB connection, migrations runner, CRUD helpers
│   ├── connect_stage.go             # StageService RPC handler
│   ├── connect_apikey.go            # ApiKeyService RPC handler
│   ├── connect_stream.go            # RtmpDestinationService RPC handler
│   ├── connect_user.go              # UserService RPC handler
│   ├── mcp.go                       # MCP server + tool definitions
│   ├── go.mod / go.sum              # Go module definition
│   ├── Makefile                     # Component build targets
│   ├── proto/api/v1/                # ★ Protobuf service definitions
│   │   ├── stage.proto              # StageService (create/list/get/delete)
│   │   ├── apikey.proto             # ApiKeyService (CRUD)
│   │   ├── stream.proto             # RtmpDestinationService (RTMP destinations)
│   │   └── user.proto               # UserService (profile)
│   ├── gen/api/v1/                  # Generated Go + connect stubs (committed)
│   ├── migrations/                  # PostgreSQL migration files (.up.sql)
│   │   ├── 001_initial.up.sql       # users, api_keys, stream_destinations
│   │   ├── 002_nullable_direct_port.up.sql
│   │   ├── 003_endpoints.up.sql
│   │   ├── 004_rename_session_log_to_stage_log.up.sql
│   │   └── 005_consolidate_stages.up.sql  # Renames endpoints→stages, adds status/pod fields
│   └── docker/
│       └── Dockerfile               # Multi-stage build: Go binary + web SPA embed
│
├── web/                             # [PART 2] React/TypeScript SPA
│   ├── index.html                   # HTML shell (Vite entry)
│   ├── vite.config.ts               # ★ Vite config + dev proxy to :8080
│   ├── tsconfig.json                # TypeScript config
│   ├── package.json                 # React 19, Clerk, ConnectRPC, HLS.js, Tailwind v4
│   ├── Makefile                     # build/dev targets
│   ├── public/                      # Static assets
│   └── src/
│       ├── main.tsx                 # ★ App entry: ClerkProvider, Router mount
│       ├── App.tsx                  # Route definitions (React Router v7)
│       ├── client.ts                # ★ ConnectRPC transport + all service clients
│       ├── index.css                # Tailwind base styles
│       ├── gen/api/v1/              # Generated TypeScript protobuf (committed)
│       │   ├── stage_pb.ts
│       │   ├── apikey_pb.ts
│       │   ├── stream_pb.ts
│       │   └── user_pb.ts
│       ├── pages/
│       │   ├── LandingPage.tsx      # Public landing page
│       │   ├── Dashboard.tsx        # ★ Stage management (create, list, activate)
│       │   ├── ApiKeys.tsx          # API key CRUD
│       │   ├── StreamConfig.tsx     # RTMP destination management
│       │   └── Docs.tsx             # Documentation viewer
│       ├── components/
│       │   ├── Layout.tsx           # App shell (nav, sidebar)
│       │   ├── StreamPreview.tsx    # HLS.js video preview component
│       │   ├── onboarding/          # Onboarding wizard components
│       │   └── ui/                  # Design system primitives
│       │       ├── alert.tsx
│       │       ├── badge.tsx
│       │       ├── button.tsx       # CVA-based button variants
│       │       ├── card.tsx
│       │       ├── input.tsx
│       │       ├── overlay.tsx
│       │       └── table.tsx
│       └── lib/                     # Shared utilities
│
├── streamer/                        # [PART 3] Node.js browser pod service
│   ├── index.js                     # ★ Entry: Express server, panel system, OBS client
│   ├── shell.html                   # Base HTML shell served to Chrome per panel
│   ├── prelude.js                   # React/Zustand globals injected into panel pages
│   ├── vite-init.mjs                # Vite dev server initialization for panel HMR
│   ├── package.json                 # Express, ws, Vite, React, Zustand
│   ├── Makefile                     # build target
│   └── docker/                      # Container image
│       └── Dockerfile               # Ubuntu + Chrome + OBS + Node.js + entrypoint
│
├── k8s/                             # [PART 4] Kubernetes manifests
│   ├── control-plane/
│   │   ├── deployment.yaml          # ★ Control-plane Deployment + env vars
│   │   ├── rbac.yaml                # ServiceAccount + Role + RoleBinding (pods CRUD)
│   │   └── service.yaml             # ClusterIP service :8080
│   ├── infrastructure/
│   │   ├── postgres.yaml            # PostgreSQL StatefulSet + PVC + service
│   │   ├── postgres-auth.secrets.yaml     # SOPS-encrypted DB password
│   │   ├── encryption-key.secrets.yaml    # SOPS-encrypted AES key
│   │   └── browserless-secret.yaml        # SOPS-encrypted pod auth token
│   ├── networking/
│   │   ├── traefik-config.yaml      # Traefik HTTP→HTTPS redirect middleware
│   │   ├── cluster-issuer.yaml      # Let's Encrypt ClusterIssuer
│   │   └── ingress.yaml             # ★ Traefik Ingress → control-plane:8080
│   └── clerk/
│       └── clerk-auth.secrets.yaml  # SOPS-encrypted Clerk keys
│
├── docs/                            # Project documentation (this folder)
│   ├── index.md                     # ★ Master documentation index
│   ├── project-overview.md          # Project summary
│   ├── architecture-control-plane.md
│   ├── architecture-web.md
│   ├── architecture-streamer.md
│   ├── api-contracts.md
│   ├── data-models.md
│   ├── integration-architecture.md
│   ├── source-tree-analysis.md      # (this file)
│   ├── development-guide.md
│   ├── deployment-guide.md
│   └── project-scan-report.json    # BMAD scan state
│
├── agent/                           # Placeholder (currently empty)
├── _bmad/                           # BMAD workflow tooling
├── _bmad-output/                    # BMAD generated artifacts
└── .sops.yaml                       # SOPS Age encryption recipients
```

---

## Critical Folders by Part

### control-plane
| Folder | Importance | Description |
|--------|------------|-------------|
| `control-plane/` root | ★★★ | All Go source — single-package binary |
| `proto/api/v1/` | ★★★ | Service contracts — source of truth for API |
| `gen/api/v1/` | ★★ | Generated code — regenerate with `make proto` |
| `migrations/` | ★★★ | DB schema history — apply-once, ordered |

### web
| Folder | Importance | Description |
|--------|------------|-------------|
| `src/` | ★★★ | All app code |
| `src/client.ts` | ★★★ | Service client setup and auth interceptor |
| `src/gen/` | ★★ | Generated from protos — do not hand-edit |
| `src/pages/` | ★★★ | All route-level components |

### streamer
| Folder | Importance | Description |
|--------|------------|-------------|
| `index.js` | ★★★ | Entire streamer service (Express + panel system + OBS) |
| `shell.html` | ★★★ | Panel HTML template served to Chrome |
| `prelude.js` | ★★★ | React globals injected into panel pages |
| `docker/` | ★★ | Container image with Chrome + OBS + Node.js |

### k8s
| File | Importance | Description |
|------|------------|-------------|
| `control-plane/deployment.yaml` | ★★★ | Production env config, resource limits |
| `networking/ingress.yaml` | ★★★ | External routing via Traefik |
| `infrastructure/postgres.yaml` | ★★ | Database deployment |
| `*secrets.yaml` | ★★★ | SOPS-encrypted secrets (do not commit decrypted) |

---

## Integration Points in Code

| Location | Integration |
|----------|------------|
| `control-plane/main.go: main()` | HTTP mux wiring — all routes registered here |
| `control-plane/main.go: Manager.createStage()` | Kubernetes pod creation spec |
| `control-plane/main.go: handleCDP()` | CDP proxy + URL rewriting |
| `control-plane/auth.go: authenticate()` | Unified Clerk JWT + API key validation |
| `control-plane/mcp.go: setupMCP()` | All MCP tool definitions |
| `web/src/client.ts` | All ConnectRPC client instances + Clerk auth interceptor |
| `streamer/index.js: /api/panels/*` | Panel system API routes |
| `streamer/index.js: OBSConnection` | OBS WebSocket v5 client |
