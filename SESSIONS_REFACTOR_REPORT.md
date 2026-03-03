# Sessions-to-Endpoints/Stages Refactoring Report

## Executive Summary

This report identifies all references to "sessions" in the browser-streamer codebase that are either stale (should be removed), outdated (should be updated), or legitimate technical terms (should be kept). The terminology shift from "sessions" to "endpoints" or "stages" has been partially implemented, but several old references remain.

**Total Findings: 50+ references across 15+ files**
- KEEP: ~25 references (proto types, Go structs, DB schema, generated code)
- REMOVE: 5 references (old Make targets, shell scripts)
- REPLACE: 7+ references (docs, CLAUDE.md, scripts)
- REVIEW: ~15 references (architecture docs, API documentation)

---

## Category 1: KEEP - Legitimate Technical References

These should **NOT** be changed as they are tied to the RPC API contract and internal implementation:

### 1.1 Protocol Buffer Definitions
**File:** `/Users/johnsabath/projects/browser-streamer/control-plane/proto/api/v1/session.proto`

Legitimate technical types that form the RPC API contract:
- `service SessionService { ... }`
  - `rpc CreateSession(CreateSessionRequest)`
  - `rpc ListSessions(ListSessionsRequest)`
  - `rpc GetSession(GetSessionRequest)`
  - `rpc DeleteSession(DeleteSessionRequest)`
- `message Session { ... }`
- `message CreateSessionRequest`, `CreateSessionResponse`
- `message ListSessionsRequest`, `ListSessionsResponse`
- `message GetSessionRequest`, `GetSessionResponse`
- `message DeleteSessionRequest`, `DeleteSessionResponse`

**Rationale:** Changing these would break the RPC API contract. Any client depending on SessionService would break. These are technical message names, not user-facing terminology.

**Action:** KEEP - Do not modify

### 1.2 Go Implementation Types
**File:** `/Users/johnsabath/projects/browser-streamer/control-plane/main.go`

- `type Session struct` (lines 52-60)
- `type SessionStatus string` (line 44)
- `type sessionServer struct` (lines 12-15)

**File:** `/Users/johnsabath/projects/browser-streamer/control-plane/connect_session.go`

- `func (s *sessionServer) CreateSession(...)`
- `func (s *sessionServer) ListSessions(...)`
- `func (s *sessionServer) GetSession(...)`
- `func (s *sessionServer) DeleteSession(...)`
- `func sessionToProto(s *Session) *apiv1.Session`

**Rationale:** These are implementation details tied to the proto message types. Renaming would require regeneration of proto code and would break API contracts.

**Action:** KEEP - Do not modify

### 1.3 Auto-Generated Protobuf Code
**Files:**
- `/Users/johnsabath/projects/browser-streamer/control-plane/gen/api/v1/session.pb.go`
- `/Users/johnsabath/projects/browser-streamer/control-plane/gen/api/v1/apiv1connect/session.connect.go`

**Rationale:** These are automatically generated from .proto files. Any changes should be made in the .proto source, not the generated files.

**Action:** KEEP - Auto-regenerate from proto source when proto changes

### 1.4 Database Schema References
**File:** `/Users/johnsabath/projects/browser-streamer/docs/data-models.md`

- `session_log` table (for tracking session lifecycle events)
- Session struct documentation with fields like `session_id`, `created_at`, `ended_at`

**Rationale:** These are internal database schema names that may be tied to existing migrations. Changing would require database migration effort.

**Action:** KEEP - Preserve schema names for backward compatibility

---

## Category 2: REMOVE - Completely Stale References

These should be **deleted entirely** as they reference old/non-existent API endpoints:

### 2.1 Makefile Targets
**File:** `/Users/johnsabath/projects/browser-streamer/Makefile`

**Line 7:** In `.PHONY` declaration
```makefile
.PHONY: help proto build-streamer build-control-plane build deploy restart \
        logs-cp logs-session status sessions create-session provision clean \
```
- Remove: `logs-session`
- Remove: `sessions`
- Remove: `create-session`

**Line 73-74:** Target definition
```makefile
logs-session: ## Tail logs for a session pod (usage: make logs-session POD=streamer-abc12345)
	$(SSH) "k3s kubectl logs -f $(POD) -n $(NS)"
```
**Action:** DELETE this entire target

**Line 89-93:** Target definitions
```makefile
sessions: ## List active sessions via API
	@curl -s "https://stream.dazzle.fm/api/sessions?token=$(TOKEN)" | python3 -m json.tool

create-session: ## Create a new session
	@curl -s -X POST "https://stream.dazzle.fm/api/session?token=$(TOKEN)" | python3 -m json.tool
```
**Action:** DELETE these targets entirely (API endpoints don't exist or have changed)

### 2.2 Provision Script
**File:** `/Users/johnsabath/projects/browser-streamer/provision.sh`

**Lines 128-129:** Echo messages with old API endpoints
```bash
echo "  New session: curl -X POST https://stream.dazzle.fm/api/session?token=${TOKEN}"
echo "  Sessions:    curl https://stream.dazzle.fm/api/sessions?token=${TOKEN}"
```

**Action:** DELETE or REPLACE with updated endpoint references

---

## Category 3: REPLACE - Documentation to Update

These are documentation or configuration files that reference old API terminology:

### 3.1 CLAUDE.md (Project Instructions)
**File:** `/Users/johnsabath/projects/browser-streamer/CLAUDE.md`

**Lines 37-39:**
```bash
make logs-session POD=<pod> # Tail a session pod
make sessions TOKEN=<token> # List active sessions via API
make create-session TOKEN=<token> # Create a new session
```

**Line 44:**
```bash
make clean                  # Delete all session pods
```

**Action:**
- Line 37: DELETE or replace with new equivalent (if it exists)
- Line 38: DELETE or replace with endpoint list command
- Line 39: DELETE or replace with endpoint create command
- Line 44: Keep but clarify it deletes "endpoint pods"

**Suggested Replacement:**
```bash
make status               # Show pods, services, etc
make control-plane/logs   # Tail control-plane logs
make clean                # Delete all endpoint pods
```

### 3.2 Development Guide
**File:** `/Users/johnsabath/projects/browser-streamer/docs/development-guide.md`

**Line 99:**
```bash
make sessions TOKEN=...         # List sessions via API
```

**Action:** DELETE or update to reflect current API

### 3.3 Deployment Guide
**File:** `/Users/johnsabath/projects/browser-streamer/docs/deployment-guide.md`

**Line 143:**
```bash
make sessions        # Active sessions
```

**Action:** DELETE or replace with appropriate endpoint management command

---

## Category 4: REVIEW & CLARIFY - Architecture Documentation

These documents discuss the system architecture and should clarify the distinction between "Session Manager" (component name) vs. "session" (entity name) vs. "stage" (user-facing term):

### 4.1 API Contracts Documentation
**File:** `/Users/johnsabath/projects/browser-streamer/docs/api-contracts.md`

Current structure:
- Lines 13, 24, 26: "SessionService" heading and descriptions
- Line 42: "Errors: ResourceExhausted (max sessions)"
- Line 49: "Response: { sessions: Session[] }"
- Line 183: "sessions: int, maxSessions: int"

**Action:** REVIEW - These are technically correct (they describe the SessionService RPC). Consider adding clarification that "Session" is the internal RPC entity name, while "Stage" or "Endpoint" is the user-facing term.

### 4.2 Session Manager Architecture
**File:** `/Users/johnsabath/projects/browser-streamer/docs/architecture-session-manager.md`

References:
- Title: "Session Manager (Go Control Plane)" - this is the component name, keep it
- Line 28: "connect_session.go | ConnectRPC SessionService handlers"
- Line 42-46: Description of SessionService RPC methods

**Action:** REVIEW - Keep "Session Manager" as the component name. The SessionService methods should be documented accurately. Consider cross-reference to "Stages" or "Endpoints" as user-facing terms.

### 4.3 Dashboard Architecture
**File:** `/Users/johnsabath/projects/browser-streamer/docs/architecture-dashboard.md`

References:
- Line 83: "sessionClient → SessionService (CRUD sessions)"
- Line 92-93: SessionService method descriptions
- Line 138: "Session Creation & Polling"
- Line 140: "Polls GetSession every 2s"

**Action:** REVIEW - These are accurate descriptions of the RPC API. Consider adding a glossary note that "Session" in the API means the same as "Stage" or "Endpoint" in user-facing terms.

### 4.4 Data Models
**File:** `/Users/johnsabath/projects/browser-streamer/docs/data-models.md`

References:
- Line 86-94: "Session" struct documentation
- Line 103: "sessions map[string]*Session"

**Action:** REVIEW - These are internal data structure names. Consider adding a note that this corresponds to what users see as "Stages" or "Endpoints".

### 4.5 Integration Architecture
**File:** `/Users/johnsabath/projects/browser-streamer/docs/integration-architecture.md`

References:
- Multiple references to "Session Manager", "SessionService", "session creation", "session lifecycle"

**Action:** REVIEW - The architecture documentation is technically accurate. Consider adding a terminology section explaining the mapping between internal names (Session) and user-facing terms (Stage/Endpoint).

### 4.6 Project Overview
**File:** `/Users/johnsabath/projects/browser-streamer/docs/project-overview.md`

References:
- Line 19: "Session Manager" (component name)
- Line 47: "Client → Session Manager (Go)" (architecture)
- Line 64-70: "control browser sessions", "create sessions", "session recovery"

**Action:** REVIEW - Update user-facing references to use "endpoint" or "stage" terminology.

---

## Detailed Removal Checklist

### Files to Modify

#### 1. `/Users/johnsabath/projects/browser-streamer/Makefile`
- [ ] Line 7: Remove `logs-session`, `sessions`, `create-session` from `.PHONY`
- [ ] Lines 73-74: Delete `logs-session` target
- [ ] Lines 89-93: Delete `sessions` and `create-session` targets

#### 2. `/Users/johnsabath/projects/browser-streamer/provision.sh`
- [ ] Lines 128-129: Update or delete echo messages with old API endpoints

#### 3. `/Users/johnsabath/projects/browser-streamer/CLAUDE.md`
- [ ] Line 37: Update `logs-session` reference or delete
- [ ] Line 38: Update `sessions` reference or delete
- [ ] Line 39: Update `create-session` reference or delete
- [ ] Line 44: Clarify comment about "session pods" vs "endpoint pods"

#### 4. `/Users/johnsabath/projects/browser-streamer/docs/development-guide.md`
- [ ] Line 99: Update or delete `make sessions` reference

#### 5. `/Users/johnsabath/projects/browser-streamer/docs/deployment-guide.md`
- [ ] Line 143: Update or delete `make sessions` reference

#### 6. Documentation files to REVIEW (no action needed, but clarify):
- [ ] `/Users/johnsabath/projects/browser-streamer/docs/api-contracts.md`
- [ ] `/Users/johnsabath/projects/browser-streamer/docs/architecture-session-manager.md`
- [ ] `/Users/johnsabath/projects/browser-streamer/docs/architecture-dashboard.md`
- [ ] `/Users/johnsabath/projects/browser-streamer/docs/data-models.md`
- [ ] `/Users/johnsabath/projects/browser-streamer/docs/integration-architecture.md`
- [ ] `/Users/johnsabath/projects/browser-streamer/docs/project-overview.md`

---

## Files That Should NOT Be Changed

- All `.proto` files (proto definitions)
- All `.pb.go` files (auto-generated)
- All `.connect.go` files (auto-generated)
- `/Users/johnsabath/projects/browser-streamer/control-plane/main.go` (Session type, sessionServer implementation)
- `/Users/johnsabath/projects/browser-streamer/control-plane/connect_session.go` (SessionService handlers)
- `/Users/johnsabath/projects/browser-streamer/control-plane/db.go` (session database operations)
- Any database schema that uses `session_*` fields

---

## Summary

| Category | Count | Files | Action |
|----------|-------|-------|--------|
| KEEP | ~25 | Proto files, Go impl, generated code | Do not modify |
| REMOVE | 5 | Makefile, provision.sh | Delete entirely |
| REPLACE | 7+ | CLAUDE.md, dev/deploy docs | Update references |
| REVIEW | ~15 | Architecture docs, API docs | Clarify terminology |

**Total effort:** Low to medium
- **Quick wins:** Delete stale Make targets and shell script messages (15 min)
- **Documentation cleanup:** Update CLAUDE.md and docs (30-60 min)
- **Architecture clarification:** Add terminology glossary to docs (optional, 30 min)

