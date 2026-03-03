---
project_name: 'browser-streamer'
user_name: 'John'
date: '2026-03-02'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 42
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

| Layer | Technology | Version |
|-------|-----------|---------|
| Session Manager | Go | 1.24 (toolchain 1.24.5) |
| K8s Client | k8s.io/client-go | v0.29.3 |
| API Protocol | ConnectRPC + Protobuf | Go connect v1.19.1 / TS v2.0.0, protobuf v1.36.9 |
| Auth | Clerk | Go v2.5.1 / React v5.0.0 |
| Database | PostgreSQL (lib/pq) | v1.11.2 |
| MCP Server | mcp-go | v0.44.1 |
| WebSocket | gorilla/websocket | v1.5.3 |
| Dashboard | React + TypeScript | React 19 / TS 5.6 / Vite 6 |
| Styling | Tailwind CSS + CVA + tailwind-merge | Tailwind 4.2 |
| Streamer Pod | Node.js + Express | Node 20 / Express 4.18 |
| Container Runtime | Chrome + Xvfb + PulseAudio + ffmpeg + OBS | Ubuntu 22.04 base |
| Infrastructure | k3s, Traefik, cert-manager, SOPS | Hetzner VPS |
| Build | Remote SSH + buildkit | No local Docker |

## Critical Implementation Rules

### Language-Specific Rules

**Go (Control Plane — `control-plane/`):**
- Sub-directories/packages are acceptable for organizing Go code (e.g., `internal/`, `pkg/`, feature-specific packages)
- `_ "github.com/lib/pq"` is a blank side-effect import for the Postgres driver — do not remove it
- Raw SQL with `lib/pq` (no ORM) — migrations live in `session-manager/migrations/`
- K8s pods are managed imperatively via `client-go` — do not generate YAML manifests or use Helm
- Generated protobuf code lives in `session-manager/gen/` — never hand-edit
- Builds are `CGO_ENABLED=0` static binaries
- `go vet ./...` is the only lint check — no golangci-lint configured

**TypeScript (Dashboard — `dashboard/`):**
- `.js` extensions on imports are mandatory even for `.ts` files (e.g., `import { Foo } from "./bar.js"`) — required by Vite + `moduleResolution: bundler`
- Strict mode: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- Path alias `@/*` maps to `./src/*` — use for cross-cutting imports only (e.g., `@/lib/utils`, `@/gen/...`); use relative imports for same-directory and nearby files
- Generated ConnectRPC code lives in `dashboard/src/gen/` — never hand-edit; regenerate with `buf generate`
- No ESLint or Prettier config — match existing formatting by reading neighboring code

**JavaScript (Streamer Server — `server/index.js`):**
- Plain CommonJS Node.js (`require()`) — not ESM despite root `package.json` having `"type": "module"`
- Single file, no TypeScript, no build step — keep it that way
- Minimal dependencies: Express + http-proxy only

### Framework-Specific Rules

**ConnectRPC / Protobuf Pipeline:**
- Proto definitions in `session-manager/proto/` — `buf generate` outputs to both `session-manager/gen/` (Go) and `dashboard/src/gen/` (TS)
- API changes require: update proto → `buf generate` → update Go handler → update TS client usage
- Never manually create service stubs or type definitions — always generate from proto
- Read `main.go` to understand the actual ConnectRPC HTTP mux setup before adding new endpoints

**React Dashboard (`dashboard/`):**
- Clerk `<SignedIn>`/`<SignedOut>` at top level in `App.tsx` splits auth vs public views
- Auth token injected via ConnectRPC transport interceptor in `client.ts` — not per-call
- No global state library — component-local state with `useState`/`useEffect`
- New pages: create file in `src/pages/` with named export → add route in `App.tsx` inside `<SignedIn>`
- Multi-component features go in a subfolder under `src/components/` with an orchestrator component (see `onboarding/` pattern)
- UI components are hand-written shadcn-style — do NOT use `npx shadcn-ui` CLI
- UI primitives in `src/components/ui/` use CVA for variants + `cn()` helper from `@/lib/utils.ts`
- Icons: `lucide-react` only — do not introduce other icon libraries
- Tailwind 4 CSS-first configuration — no `tailwind.config.js` file exists or should be created

**Single-Origin Architecture:**
- Dashboard is served as static files from the Go binary in production (`Dockerfile.session-manager` copies built dashboard into Go image)
- Vite dev proxy forwards `/api.v1`, `/cdp`, `/session`, `/health` to `localhost:8080`
- Do not introduce CORS headers or separate origins

### Testing Rules

- No test suites exist — do NOT proactively add test files, test frameworks, or test configuration unless explicitly asked
- Do not add testing dependencies to `package.json` or `go.mod` unless explicitly asked
- Pre-deploy validation: `go vet ./...` (Go) and `cd dashboard && npm run build` (TypeScript type check)
- When asked to add tests: use `go test` conventions for Go; ask user for preferred framework for dashboard

### Code Quality & Style Rules

**Naming Conventions:**
- Go: standard conventions (camelCase locals, PascalCase exports, `gofmt` formatting)
- Dashboard files: PascalCase for components/pages (`Dashboard.tsx`, `ApiKeys.tsx`), camelCase for utilities (`client.ts`, `utils.ts`)
- K8s manifests: kebab-case (`session-manager-deployment.yaml`)

**Formatting:**
- No linter/formatter enforced — match existing style by reading neighboring code
- Dashboard: 2-space indentation, double quotes for JSX strings
- Go: `gofmt` default formatting

**Documentation:**
- Minimal comments throughout — code is self-documenting
- No JSDoc in dashboard code
- Go comments only on exported functions when non-obvious
- Do not add README files per-directory

### Development Workflow Rules

**Build & Deploy:**
- All builds happen remotely via SSH + buildkit — no local Docker required or available
- Typical change cycle: `make build deploy`
- `make build-session-manager` builds both Go binary + dashboard (multi-stage Dockerfile)
- `make build-streamer` builds the streamer pod image separately
- Images imported into k3s via `ctr images import` — `imagePullPolicy: Never`
- Dashboard build requires generated TS code from `buf generate` to exist first

**Proto Code Generation:**
- `cd session-manager/proto && buf generate` after any proto changes
- Outputs to both `session-manager/gen/` and `dashboard/src/gen/`

**Secrets:**
- SOPS-encrypted secrets in `k8s/*.secrets.yaml` — applied via `make secrets`
- Never commit plaintext secrets

**Git:**
- Single `main` branch workflow
- No CI/CD pipeline — manual `make build deploy`

### Critical Don't-Miss Rules

**Anti-Patterns to Avoid:**
- Do NOT run `docker build` locally — builds only work via remote SSH + buildkit
- Do NOT add `tailwind.config.js` — Tailwind 4 uses CSS-first configuration
- Do NOT use `npx shadcn-ui` — UI components are hand-written
- Do NOT hand-edit generated proto files in `*/gen/` directories
- Do NOT hand-edit files in `*/gen/` directories — always regenerate from proto
- Do NOT add CORS middleware — single-origin architecture
- Do NOT add test frameworks or linter configs unless explicitly asked

**Security Rules:**
- Auth is Clerk JWT on both sides — Go validates via `clerk-sdk-go`, dashboard uses `@clerk/clerk-react`
- API keys managed in Postgres via the existing `apikey` service — do not roll custom auth
- Secrets are SOPS-encrypted in `k8s/*.secrets.yaml` — never write plaintext credentials into k8s YAML

**Infrastructure Gotchas:**
- Streamer pods use `restartPolicy: Never` — a crash kills the session permanently
- HostPort range 31000-31099 is finite — max 100 concurrent sessions at infrastructure level
- Streamer pods have `imagePullPolicy: Never` — image must be pre-loaded on the node via `ctr images import`
- ffmpeg is started on-demand via `/api/stream/start`, not at pod boot

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review periodically for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-02
