# Sessions Terminology - Code Snippets for Changes

## File 1: Makefile

### Current Code (REMOVE)

```makefile
.PHONY: help proto build-streamer build-control-plane build deploy restart \
        logs-cp logs-session status sessions create-session provision clean \
        secrets install-cert-manager setup-tls \
        control-plane/% streamer/% web/%
```

**After change (line 7):**
```makefile
.PHONY: help proto build-streamer build-control-plane build deploy restart \
        logs-cp status provision clean \
        secrets install-cert-manager setup-tls \
        control-plane/% streamer/% web/%
```

---

### Current Code (REMOVE)

```makefile
logs-session: ## Tail logs for a session pod (usage: make logs-session POD=streamer-abc12345)
	$(SSH) "k3s kubectl logs -f $(POD) -n $(NS)"
```

**Action:** Delete lines 73-74 entirely.

---

### Current Code (REMOVE)

```makefile
sessions: ## List active sessions via API
	@curl -s "https://stream.dazzle.fm/api/sessions?token=$(TOKEN)" | python3 -m json.tool

create-session: ## Create a new session
	@curl -s -X POST "https://stream.dazzle.fm/api/session?token=$(TOKEN)" | python3 -m json.tool
```

**Action:** Delete lines 89-93 entirely (or replace with endpoint equivalents if those API endpoints exist).

---

## File 2: CLAUDE.md

### Current Code (REPLACE)

Lines 37-39 in Observe & Monitor section:
```bash
make logs-session POD=<pod> # Tail a session pod
make sessions TOKEN=<token> # List active sessions via API
make create-session TOKEN=<token> # Create a new session
```

**Option A - Delete completely:**
```bash
# (Remove the above three lines)
```

**Option B - Replace with current endpoints (if they exist):**
```bash
make logs-cp                # Tail control-plane logs
make control-plane/logs     # Alternative control-plane logs
```

---

### Current Code (UPDATE)

Line 44 in Cleanup section:
```bash
make clean                  # Delete all session pods
```

**After change:**
```bash
make clean                  # Delete all endpoint pods
```

---

## File 3: provision.sh

### Current Code (UPDATE OR DELETE)

Lines 128-129 at the end:
```bash
echo "  New session: curl -X POST https://stream.dazzle.fm/api/session?token=${TOKEN}"
echo "  Sessions:    curl https://stream.dazzle.fm/api/sessions?token=${TOKEN}"
```

**Option A - Delete:**
```bash
# (Remove these two lines entirely)
```

**Option B - Update to endpoints (if API endpoints exist):**
```bash
echo "  New endpoint: curl -X POST https://stream.dazzle.fm/api/endpoint?token=${TOKEN}"
echo "  Endpoints:    curl https://stream.dazzle.fm/api/endpoints?token=${TOKEN}"
```

---

## File 4: docs/development-guide.md

### Current Code (UPDATE OR DELETE)

Line 99 in the Observe & Monitor section:
```bash
make sessions TOKEN=...         # List sessions via API
```

**Option A - Delete:**
```bash
# (Remove this line entirely)
```

**Option B - Replace with current endpoint command:**
```bash
make control-plane/logs         # Tail control-plane logs
```

---

## File 5: docs/deployment-guide.md

### Current Code (UPDATE OR DELETE)

Line 143 in a code block showing Make commands:
```bash
make logs-sm         # Session manager logs
make sessions        # Active sessions
```

**Option A - Delete the sessions line:**
```bash
make logs-sm         # Session manager logs
```

**Option B - Replace with endpoint equivalent:**
```bash
make logs-sm         # Control-plane logs
make control-plane/logs  # Detailed control-plane logs
```

---

## Files to REVIEW but NOT CHANGE

These sections are technically correct. You may want to add clarification, but no code removal needed:

### docs/api-contracts.md

Lines 24-62 (SessionService documentation):
```markdown
### SessionService

#### CreateSession
POST /api.v1.SessionService/CreateSession
...

#### ListSessions
POST /api.v1.SessionService/ListSessions
Response: { sessions: Session[] }
...
```

**Status:** KEEP AS-IS. These accurately describe the RPC API.
**Optional Enhancement:** Add a note explaining that "Session" in the API corresponds to "Stage" or "Endpoint" in user-facing terminology.

---

### docs/architecture-session-manager.md

Lines 28, 42-46 (SessionService description):
```markdown
| `connect_session.go` | ~80 | ConnectRPC SessionService handlers |

**SessionService** (Clerk JWT or API key auth):
- `CreateSession` — Creates streamer pod, returns session details
- `ListSessions` — Lists sessions for authenticated user
- `GetSession` — Gets specific session by ID
- `DeleteSession` — Kills session pod and marks stopped
```

**Status:** KEEP AS-IS. These are accurate descriptions.
**Note:** "Session Manager" is the actual component name - this is correct.

---

### control-plane/proto/api/v1/session.proto

Lines 1-52 (entire file):
```protobuf
syntax = "proto3";

package api.v1;

service SessionService {
  rpc CreateSession(CreateSessionRequest) returns (CreateSessionResponse);
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);
  ...
}

message Session {
  string id = 1;
  string pod_name = 2;
  ...
}
```

**Status:** KEEP AS-IS. This is the RPC API contract.
**Action:** Do NOT modify. If changes are needed, regenerate from this source.

---

### control-plane/main.go

Lines 44-60 (Session types):
```go
type SessionStatus string

const (
	StatusStarting SessionStatus = "starting"
	StatusRunning  SessionStatus = "running"
	StatusStopping SessionStatus = "stopping"
)

type Session struct {
	ID           string        `json:"id"`
	PodName      string        `json:"podName"`
	PodIP        string        `json:"podIP,omitempty"`
	DirectPort   int32         `json:"directPort"`
	CreatedAt    time.Time     `json:"createdAt"`
	Status       SessionStatus `json:"status"`
	OwnerUserID  string        `json:"ownerUserId,omitempty"`
}
```

**Status:** KEEP AS-IS. These are implementation types tied to the RPC contract.

---

## Summary Table

| File | Lines | Action | Reason |
|------|-------|--------|--------|
| Makefile | 7 | Remove from .PHONY | Targets don't exist |
| Makefile | 73-74 | Delete target | logs-session is stale |
| Makefile | 89-93 | Delete targets | sessions/create-session are stale |
| provision.sh | 128-129 | Update/delete | API endpoints changed |
| CLAUDE.md | 37-39 | Update/delete | References stale targets |
| CLAUDE.md | 44 | Update comment | session → endpoint |
| docs/development-guide.md | 99 | Delete/update | References stale target |
| docs/deployment-guide.md | 143 | Delete/update | References stale target |
| docs/api-contracts.md | 24-62 | Review (optional) | Technically correct |
| docs/architecture-*.md | Multiple | Review (optional) | Technically correct |
| Proto files | All | KEEP | RPC contracts |
| Go implementation | All | KEEP | API contracts |
| Generated code | All | KEEP | Auto-generated |

---

## Testing After Changes

```bash
# Verify Makefile syntax
make help | grep -E "logs-session|sessions|create-session"
# Output: (should be empty, no matches)

# Verify .proto files weren't modified
git diff control-plane/proto/api/v1/session.proto
# Output: (should show no changes)

# Verify CLAUDE.md is readable
cat CLAUDE.md | grep -E "make (logs-session|sessions|create-session)"
# Output: (should be empty, no matches)

# See all changes
git diff --stat
# Output: Should show only doc/config files, not proto or generated code
```

