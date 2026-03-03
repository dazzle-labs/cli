# Sessions Terminology: Quick Reference

## What to Remove

### Makefile targets (DELETE entirely)
```makefile
logs-session: ## Tail logs for a session pod (usage: make logs-session POD=streamer-abc12345)
	$(SSH) "k3s kubectl logs -f $(POD) -n $(NS)"

sessions: ## List active sessions via API
	@curl -s "https://stream.dazzle.fm/api/sessions?token=$(TOKEN)" | python3 -m json.tool

create-session: ## Create a new session
	@curl -s -X POST "https://stream.dazzle.fm/api/session?token=$(TOKEN)" | python3 -m json.tool
```

Also remove from `.PHONY` declaration: `logs-session sessions create-session`

### provision.sh output messages (UPDATE or DELETE)
```bash
# Lines 128-129: Remove or update these API endpoint references
echo "  New session: curl -X POST https://stream.dazzle.fm/api/session?token=${TOKEN}"
echo "  Sessions:    curl https://stream.dazzle.fm/api/sessions?token=${TOKEN}"
```

### CLAUDE.md references (UPDATE or DELETE)
- Line 37: `make logs-session POD=<pod> # Tail a session pod`
- Line 38: `make sessions TOKEN=<token> # List active sessions via API`
- Line 39: `make create-session TOKEN=<token> # Create a new session`
- Line 44: Comment mentions "session pods"

### docs/development-guide.md
- Line 99: `make sessions TOKEN=...         # List sessions via API`

### docs/deployment-guide.md
- Line 143: `make sessions        # Active sessions`

---

## What to KEEP (Do NOT modify)

### Proto Message Types
File: `control-plane/proto/api/v1/session.proto`
- `service SessionService`
- `message Session`
- All CreateSession, ListSessions, GetSession, DeleteSession messages

### Go Implementation
File: `control-plane/main.go`
- `type Session struct`
- `type sessionServer struct`

File: `control-plane/connect_session.go`
- All `sessionServer` method implementations

### Auto-Generated Code
- All `.pb.go` files in `gen/api/v1/`
- All `.connect.go` files in `gen/api/v1/apiv1connect/`

**Rationale:** These are tied to the RPC API contract. Changing them would break client compatibility.

---

## What to REVIEW/CLARIFY (Architecture Documentation)

These docs are technically correct but could clarify the distinction between:
- **"Session Manager"** = Go component name (keep as-is)
- **"Session"** = Internal RPC entity name (keep as-is)
- **"Stage" or "Endpoint"** = User-facing term for what a Session represents

Files to review:
1. `docs/api-contracts.md` - API reference documentation
2. `docs/architecture-session-manager.md` - Component overview
3. `docs/architecture-dashboard.md` - Dashboard integration
4. `docs/data-models.md` - Internal data structures
5. `docs/integration-architecture.md` - System architecture
6. `docs/project-overview.md` - High-level overview

Suggested addition to docs: Include a terminology glossary section explaining the mapping.

---

## Implementation Priority

1. **HIGH (Breaking for users):** Remove stale Make targets
   - Prevents users from running non-existent commands
   - Files: Makefile, CLAUDE.md

2. **HIGH (User confusion):** Update provision.sh
   - Provides correct API examples to new operators
   - File: provision.sh

3. **MEDIUM (Documentation clarity):** Update development/deployment guides
   - Ensures consistency across documentation
   - Files: docs/development-guide.md, docs/deployment-guide.md

4. **LOW (Nice to have):** Clarify architecture documentation
   - Helps developers understand terminology mapping
   - Multiple doc files

---

## Files by Status

### Files with Changes Needed (5)
1. `Makefile` - Remove 3 targets
2. `provision.sh` - Update 2 lines
3. `CLAUDE.md` - Update 4 references
4. `docs/development-guide.md` - Update 1 line
5. `docs/deployment-guide.md` - Update 1 line

### Files to Review but Not Modify (6)
1. `docs/api-contracts.md`
2. `docs/architecture-session-manager.md`
3. `docs/architecture-dashboard.md`
4. `docs/data-models.md`
5. `docs/integration-architecture.md`
6. `docs/project-overview.md`

### Files to NOT Touch (10+)
- `control-plane/proto/api/v1/session.proto`
- `control-plane/main.go` (Session struct)
- `control-plane/connect_session.go` (SessionService handlers)
- `control-plane/db.go` (Session operations)
- All generated `.pb.go` and `.connect.go` files

---

## Line-by-Line Changes

### Makefile Changes
```diff
Line 7:
- .PHONY: help proto build-streamer build-control-plane build deploy restart \
-         logs-cp logs-session status sessions create-session provision clean \
+ .PHONY: help proto build-streamer build-control-plane build deploy restart \
+         logs-cp status provision clean \

Lines 73-93:
- logs-session: ## Tail logs for a session pod (usage: make logs-session POD=streamer-abc12345)
- 	$(SSH) "k3s kubectl logs -f $(POD) -n $(NS)"
-
- sessions: ## List active sessions via API
- 	@curl -s "https://stream.dazzle.fm/api/sessions?token=$(TOKEN)" | python3 -m json.tool
-
- create-session: ## Create a new session
- 	@curl -s -X POST "https://stream.dazzle.fm/api/session?token=$(TOKEN)" | python3 -m json.tool
```

### CLAUDE.md Changes
```diff
Lines 37-39:
- make logs-session POD=<pod> # Tail a session pod
- make sessions TOKEN=<token> # List active sessions via API
- make create-session TOKEN=<token> # Create a new session
+ # (Remove these lines or replace with endpoint equivalents)

Line 44:
- make clean                  # Delete all session pods
+ make clean                  # Delete all endpoint pods
```

### provision.sh Changes
```diff
Lines 128-129:
- echo "  New session: curl -X POST https://stream.dazzle.fm/api/session?token=${TOKEN}"
- echo "  Sessions:    curl https://stream.dazzle.fm/api/sessions?token=${TOKEN}"
+ echo "  New endpoint: curl -X POST https://stream.dazzle.fm/api/endpoint?token=${TOKEN}"
+ echo "  Endpoints:    curl https://stream.dazzle.fm/api/endpoints?token=${TOKEN}"
```

Or if those endpoints don't exist, remove the lines entirely.

