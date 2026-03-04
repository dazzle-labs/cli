# Architecture: Web Frontend

**Part:** `web/`
**Language:** TypeScript / React 19
**Last updated:** 2026-03-03

> **Note:** This file replaces the old `architecture-dashboard.md`.

---

## Overview

The web frontend is a React 19 SPA (Single Page Application) served by the control plane at `/`. It provides the user-facing dashboard for managing stages, API keys, stream destinations, and viewing documentation. Auth is handled entirely by Clerk.

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | React | 19 |
| Language | TypeScript | 5.6 |
| Build | Vite | 6 |
| Routing | React Router | v7 |
| Auth | @clerk/clerk-react | v5 |
| API Client | ConnectRPC (connect-web + @bufbuild/protobuf) | v2 |
| Video | HLS.js | v1.6 |
| Styling | Tailwind CSS | v4 |
| Component variants | class-variance-authority + clsx + tailwind-merge | — |
| Icons | lucide-react | v0.575 |

---

## Directory Structure

```
web/
├── src/
│   ├── main.tsx              # React app entry point, ClerkProvider
│   ├── App.tsx               # Router setup (React Router v7)
│   ├── client.ts             # ConnectRPC clients for all 4 services
│   ├── index.css             # Global Tailwind base styles
│   ├── vite-env.d.ts         # Vite type declarations
│   ├── gen/                  # Generated protobuf TypeScript (from buf)
│   │   └── api/v1/
│   │       ├── stage_pb.ts
│   │       ├── apikey_pb.ts
│   │       ├── stream_pb.ts
│   │       └── user_pb.ts
│   ├── pages/
│   │   ├── LandingPage.tsx   # Public landing / marketing page
│   │   ├── Dashboard.tsx     # Main stage management (create, list, activate)
│   │   ├── ApiKeys.tsx       # API key CRUD
│   │   ├── StreamConfig.tsx  # RTMP stream destination management
│   │   └── Docs.tsx          # Documentation viewer
│   ├── components/
│   │   ├── Layout.tsx        # Shared layout (nav, sidebar)
│   │   ├── StreamPreview.tsx # HLS.js-based live stream preview
│   │   ├── onboarding/       # Onboarding wizard components
│   │   └── ui/               # Design system primitives
│   │       ├── alert.tsx
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── input.tsx
│   │       ├── overlay.tsx
│   │       └── table.tsx
│   └── lib/                  # Shared utilities
├── public/                   # Static assets
├── index.html                # HTML shell
├── vite.config.ts            # Vite config (proxy, aliases)
├── tsconfig.json             # TypeScript config
└── Makefile                  # build / dev targets
```

---

## Architecture Pattern

**SPA with ConnectRPC transport.** All API calls use a shared `connect-web` transport configured with a Clerk JWT interceptor. The SPA is a fallback catch-all route in the control plane.

---

## Routing

| Route | Page | Auth |
|-------|------|------|
| `/` | LandingPage | Public |
| `/dashboard` | Dashboard | Clerk required |
| `/api-keys` | ApiKeys | Clerk required |
| `/stream-config` | StreamConfig | Clerk required |
| `/docs` | Docs | Clerk required |

---

## API Client Setup (`client.ts`)

```
ConnectTransport (baseUrl: "/")
  └── AuthInterceptor (injects Clerk JWT as Bearer token)
       ├── stageClient → StageService
       ├── apiKeyClient → ApiKeyService
       ├── streamClient → RtmpDestinationService
       └── userClient → UserService
```

Auth token is obtained lazily via `setTokenGetter()` — registered at app startup with a Clerk `getToken()` function.

---

## Key Pages

### Dashboard
- Lists all stages with status badges
- Create stage button (ConnectRPC `CreateStage`)
- Activate / deactivate / delete actions per stage
- Shows CDP endpoint URL for active stages
- `StreamPreview` component renders HLS video preview when stream is active

### ApiKeys
- Lists API keys (prefix + created/last-used dates)
- Create new key (shows secret once on creation)
- Delete key

### StreamConfig
- RTMP destination management (name, platform, URL, stream key)
- Platform presets: Twitch, YouTube, Kick, Restream, Custom
- Enable/disable per destination

---

## Vite Dev Proxy

In development, Vite proxies these paths to `http://localhost:8080` (control plane):
- `/api.v1` — ConnectRPC
- `/cdp` — CDP proxy
- `/session` — Stage proxy
- `/health` — Health endpoint

---

## Build & Output

`npm run build` (`tsc -b && vite build`) outputs to `web/dist/`. The control plane serves `web/dist/` as its static file root (SPA fallback on `/*`). Asset files under `/assets/` are served with `Cache-Control: public, max-age=31536000, immutable`; `index.html` is served with `no-cache`.
