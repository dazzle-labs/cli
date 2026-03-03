# Browser Streamer (Dazzle) — Documentation Index

> Generated: 2026-03-02 | Scan Level: Deep | Mode: Initial Scan

## Project Overview

- **Type:** Multi-part (3 components in one repository)
- **Primary Languages:** Go, TypeScript, JavaScript
- **Architecture:** Control plane + ephemeral workers on Kubernetes (k3s)
- **Domain:** stream.dazzle.fm

### Quick Reference

#### Session Manager (Go Control Plane)
- **Type:** Backend API
- **Tech Stack:** Go 1.24, ConnectRPC, k8s client-go, Clerk, PostgreSQL, mcp-go
- **Root:** `control-plane/`
- **Entry Point:** `control-plane/main.go`

#### Streamer (Ephemeral Pod)
- **Type:** Backend Service
- **Tech Stack:** Node.js 20, Express, Chrome, OBS Studio, Xvfb
- **Root:** `streamer/` + `streamer/docker/`
- **Entry Point:** `streamer/docker/entrypoint.sh` → `streamer/index.js`

#### Dashboard (React Web App)
- **Type:** Web Frontend
- **Tech Stack:** React 19, TypeScript, Vite 6, Tailwind CSS 4, Clerk React, ConnectRPC
- **Root:** `web/`
- **Entry Point:** `web/src/main.tsx`

---

## Generated Documentation

### Architecture
- [Project Overview](./project-overview.md) — Executive summary, tech stack, key features
- [Architecture — Session Manager](./architecture-control-plane.md) — Go control plane, API surface, auth, k8s pod management
- [Architecture — Streamer](./architecture-streamer.md) — Ephemeral pod internals, Chrome + OBS + Node.js
- [Architecture — Dashboard](./architecture-dashboard.md) — React app, components, routing, design system
- [Integration Architecture](./integration-architecture.md) — Part communication, data flow, shared dependencies

### Data & API
- [API Contracts](./api-contracts.md) — ConnectRPC services, HTTP endpoints, MCP tools, streamer pod API
- [Data Models](./data-models.md) — PostgreSQL schema, Go structs, entity relationships

### Code & Structure
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory tree, critical paths, entry points

### Operations
- [Development Guide](./development-guide.md) — Local setup, build commands, secret management, protobuf generation
- [Deployment Guide](./deployment-guide.md) — k8s architecture, resource allocation, TLS, provisioning

---

## Existing Documentation

- [CLAUDE.md](../CLAUDE.md) — Project instructions for AI assistants (architecture overview, build/deploy, API reference)
- [Makefile](../Makefile) — Build and deploy automation targets
- [viewer.html](../viewer.html) — Legacy HLS viewer (vanilla JS)

---

## Getting Started

### For New Developers
1. Read the [Project Overview](./project-overview.md) for architecture context
2. Review [Development Guide](./development-guide.md) for local setup
3. Check [Source Tree Analysis](./source-tree-analysis.md) to understand code layout

### For Feature Development
1. Identify which part(s) the feature touches
2. Read the relevant architecture doc (control-plane, streamer, or dashboard)
3. Check [API Contracts](./api-contracts.md) for existing endpoints
4. Check [Data Models](./data-models.md) for schema considerations
5. Review [Integration Architecture](./integration-architecture.md) for cross-part changes

### For AI-Assisted Development
1. Point the PRD workflow to this index: `docs/index.md`
2. For session management features: Reference [Architecture — Session Manager](./architecture-control-plane.md)
3. For UI features: Reference [Architecture — Dashboard](./architecture-dashboard.md)
4. For streaming features: Reference [Architecture — Streamer](./architecture-streamer.md)
5. For cross-cutting features: Reference [Integration Architecture](./integration-architecture.md)

### For Deployment
1. Read [Deployment Guide](./deployment-guide.md) for infrastructure details
2. Use `make build deploy` for standard deployments
3. Use `make provision` for fresh infrastructure setup
