# Browser Streamer (Dazzle) — Project Overview

## Executive Summary

Browser Streamer (branded as **Dazzle**) is a session-based browser streaming platform that runs on Kubernetes (k3s). It provides ephemeral, isolated browser environments that can be controlled programmatically via Chrome DevTools Protocol (CDP) and managed through an MCP (Model Context Protocol) interface — designed primarily for AI agent integration.

Each session runs Chrome, OBS Studio, and a Node.js server inside an isolated Kubernetes pod. The platform supports live RTMP streaming to destinations like Twitch, YouTube, and Kick.

## Project Type

- **Repository Type:** Multi-part (3 distinct components in one repo)
- **Primary Languages:** Go (control plane), TypeScript/React (dashboard), JavaScript/Node.js (streamer)
- **Architecture:** Microservices on Kubernetes with ephemeral pod orchestration

## Parts

| Part | Path | Language | Framework | Purpose |
|------|------|----------|-----------|---------|
| **Session Manager** | `session-manager/` | Go 1.24 | ConnectRPC, k8s client-go | Control plane: pod lifecycle, auth, API, MCP server, reverse proxy |
| **Streamer** | `server/` + `docker/` | Node.js 20, Bash | Express, http-proxy | Ephemeral pod: Chrome + OBS + ffmpeg, CDP proxy, HTML rendering |
| **Dashboard** | `dashboard/` | TypeScript | React 19, Vite, Tailwind CSS 4 | Web UI: session management, onboarding, API key management |

## Technology Stack Summary

| Category | Technology | Version |
|----------|-----------|---------|
| **Orchestration** | k3s (Kubernetes) | v1.29+ |
| **Control Plane** | Go | 1.24 |
| **API Protocol** | ConnectRPC (Protobuf) | v2 |
| **Auth** | Clerk (JWT + OAuth) | SDK v2 |
| **Database** | PostgreSQL | 16 (Alpine) |
| **Secret Management** | SOPS + Age encryption | - |
| **Frontend** | React + TypeScript | 19 / 5.6 |
| **Build Tool** | Vite | 6.0 |
| **CSS** | Tailwind CSS | 4.2 |
| **Container Runtime** | containerd (k3s) | - |
| **Build System** | BuildKit (remote SSH) | - |
| **Ingress** | Traefik + cert-manager | - |
| **TLS** | Let's Encrypt (ACME) | - |
| **MCP** | mcp-go | v0.44 |

## Architecture Pattern

**Control Plane + Ephemeral Workers:**

```
Client → Traefik Ingress (TLS) → Session Manager (Go)
  ├── ConnectRPC API (session/apikey/stream/user services)
  ├── MCP Server (/mcp/<agent-uuid>/)
  ├── CDP Auto-Provisioning (/cdp/<uuid>)
  ├── HTTP/WS Reverse Proxy (/session/:id/*)
  └── Dashboard SPA (React)
       ↓
  Creates/manages ephemeral pods:
  Streamer Pod (Chrome + OBS + Node.js)
  ├── CDP Proxy (port 9222 via 8080)
  ├── HTML Template Engine
  ├── OBS WebSocket (port 4455)
  └── Health endpoint (/health)
```

## Key Features

1. **MCP Integration** — AI agents connect via Model Context Protocol to control browser sessions (start, stop, set_html, edit_html, screenshot, OBS control)
2. **Two-Path Onboarding** — Experienced (4-step) or Guided (5-step) wizard for new users
3. **Multi-Framework Support** — Integration snippets for Claude Code, OpenAI Agents, OpenClaw, CrewAI, LangGraph, AutoGen
4. **RTMP Streaming** — Configure destinations (Twitch, YouTube, Kick, Restream, Custom) with encrypted stream keys
5. **API Key Management** — `bstr_*` format keys with SHA256 hashing, prefix display, last-used tracking
6. **Auto-Provisioning** — `/cdp/<uuid>` endpoint automatically creates sessions on first connection
7. **Session Recovery** — On restart, recovers running pods from Kubernetes state + database

## Domain & Hosting

- **Production URL:** `https://stream.dazzle.fm`
- **Infrastructure:** Single Hetzner VPS with k3s
- **TLS:** Automatic via cert-manager + Let's Encrypt
