# Architecture: Dashboard (React Web App)

## Overview

The Dazzle dashboard is a React 19 single-page application that provides session management, onboarding wizards, API key management, stream destination configuration, and documentation. It communicates with the session manager via ConnectRPC (Protobuf) and uses Clerk for authentication.

## Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Framework | React | 19 |
| Language | TypeScript | 5.6 |
| Build Tool | Vite | 6.0 |
| CSS | Tailwind CSS | 4.2 |
| Router | React Router DOM | 7.0 |
| Auth | Clerk React | 5.0 |
| API Protocol | ConnectRPC (connect-web) | 2.0 |
| Protobuf | @bufbuild/protobuf | 2.0 |
| Icons | Lucide React | 0.575 |
| Component Variants | Class Variance Authority | 0.7.1 |
| Class Utils | clsx + tailwind-merge | - |
| Node.js | 24 | (per .nvmrc) |

## Project Structure

```
web/
├── index.html              # Dark mode root, title "Dazzle"
├── package.json            # Dependencies and scripts
├── vite.config.ts          # Vite + React + Tailwind, proxy config
├── tsconfig.json           # Strict mode, path alias @/*
├── .env                    # VITE_CLERK_PUBLISHABLE_KEY
├── .nvmrc                  # Node 24
├── public/                 # Static assets
└── src/
    ├── main.tsx            # ClerkProvider + BrowserRouter + App
    ├── App.tsx             # Auth routing (SignedIn/SignedOut), AuthSetup
    ├── client.ts           # ConnectRPC transport with Clerk token interceptor
    ├── lib/
    │   └── utils.ts        # cn() helper (clsx + tailwind-merge)
    ├── components/
    │   ├── ui/             # Button, Input, Badge, Card, Overlay, Alert, Table
    │   └── onboarding/     # Wizard steps (PathSelector, StepIndicator, etc.)
    ├── pages/
    │   ├── LandingPage.tsx # Marketing page with Clerk SignIn
    │   ├── Dashboard.tsx   # Stage grid + stream destinations
    │   ├── GetStarted.tsx  # Two-path onboarding wizard
    │   ├── ApiKeys.tsx     # API key CRUD
    │   ├── Docs.tsx        # Integration documentation + code snippets
    │   └── StreamConfig.tsx # RTMP destination management
    └── gen/                # Protobuf-generated TypeScript
        ├── session_pb.ts
        ├── apikey_pb.ts
        ├── stream_pb.ts
        └── user_pb.ts
```

## Routing

| Path | Component | Auth Required |
|------|-----------|---------------|
| `/` (signed out) | LandingPage | No |
| `/` (signed in) | Dashboard | Yes |
| `/get-started` | GetStarted | Yes |
| `/api-keys` | ApiKeys | Yes |
| `/docs` | Docs | Yes |
| `*` (catch-all) | Redirect to `/` | - |

**Layout:** Sidebar navigation with brand "Dazzle", nav items (Get Started, Endpoints, API Keys, Docs), and Clerk UserButton.

## API Client

ConnectRPC transport with Clerk token interceptor:

```typescript
const transport = createConnectTransport({
  baseUrl: "/",
  interceptors: [authInterceptor],
});
```

**Service Clients:**
- `sessionClient` → SessionService (CRUD sessions)
- `apiKeyClient` → ApiKeyService (CRUD API keys)
- `streamClient` → StreamService (CRUD stream destinations)
- `userClient` → UserService (get profile)

**Token Flow:** `AuthSetup` component calls `setTokenGetter()` with Clerk's `getToken()`. All requests auto-include `Authorization: Bearer <token>`.

## Protobuf Services

**SessionService:** CreateSession, ListSessions, GetSession, DeleteSession
- Session: id, pod_name, pod_ip, direct_port, created_at, last_activity, status, owner_user_id

**ApiKeyService:** CreateApiKey, ListApiKeys, DeleteApiKey
- ApiKey: id, name, prefix, created_at, last_used_at

**StreamService:** CreateStreamDestination, ListStreamDestinations, UpdateStreamDestination, DeleteStreamDestination
- StreamDestination: id, name, platform, rtmp_url, stream_key, enabled, created_at, updated_at

**UserService:** GetProfile
- GetProfileResponse: user_id, email, name, session_count, api_key_count

## Authentication

- **Provider:** Clerk React (`@clerk/clerk-react`)
- **Theme:** Dark mode (`@clerk/themes`)
- **Flow:** ClerkProvider wraps app → SignedIn/SignedOut conditional rendering → AuthSetup syncs token before routes
- **Components:** SignIn (on landing page), UserButton (in sidebar)

## Design System

- **Theme:** Dark (zinc-900/950 base, emerald-500 accent, white text)
- **Typography:** DM Serif Display (headings), Outfit (body), monospace (code)
- **Component Library:** CVA-based variants (Button: default/destructive/outline/ghost, Badge: default/success/warning)
- **Utilities:** `cn()` function combines clsx + tailwind-merge
- **Modals:** Portal-based Overlay with backdrop blur, Escape key close
- **Animations:** Entry transitions (1200ms), staggered delays, smooth hovers

## State Management

**Pattern:** React hooks + prop drilling (no global state library)
- `useState` for component-level state
- `useEffect` for data fetching and polling
- `useRef` for initialization guards (prevents double-creation in React 19 StrictMode)
- `useCallback` for memoized handlers
- `useNavigate` for programmatic navigation
- Direct async ConnectRPC calls, `Promise.all()` for parallel requests

## Key Workflows

### Two-Path Onboarding

**Experienced Path** (4 steps): Framework → Stream Destination → Session Creator → Connection Details

**Guided Path** (5 steps): Explainer → Stream Destination → Framework → Session Creator → Connection Details

### Session Creation & Polling
- Creates session via ConnectRPC
- Polls GetSession every 2s (max 30 attempts) until status "running"
- Shows endpoint ID and connection details when ready

### Framework Integration Snippets
Generates connection code for: Claude Code, OpenAI Agents, OpenClaw, CrewAI, LangGraph, AutoGen

### Stream Destination Management
- Platforms: Twitch, YouTube, Kick, Restream, Custom
- Pre-fills RTMP URL based on platform selection
- Stream keys stored as password fields

## Vite Configuration

```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "./src" } },
  server: {
    proxy: {
      "/api.v1": "http://localhost:8080",
      "/cdp": "http://localhost:8080",
      "/session": "http://localhost:8080",
      "/health": "http://localhost:8080",
    },
  },
});
```

## Build

- **Dev:** `vite` (with proxy to local control-plane)
- **Production:** `tsc -b && vite build` → static files served by control-plane Go binary
- **Clerk Key:** Injected as build arg `VITE_CLERK_PUBLISHABLE_KEY` during Docker build (in `control-plane/docker/Dockerfile`)
