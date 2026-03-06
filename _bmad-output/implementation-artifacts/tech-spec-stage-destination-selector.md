---
title: 'Stage Destination Selector'
slug: 'stage-destination-selector'
created: '2026-03-04'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Go 1.24', 'ConnectRPC', 'PostgreSQL (lib/pq)', 'React 19', 'TypeScript 5.6', 'Tailwind 4', 'Protobuf (buf)']
files_to_modify: ['control-plane/migrations/006_stage_destination.up.sql', 'control-plane/db.go', 'control-plane/proto/api/v1/stage.proto', 'control-plane/connect_stage.go', 'control-plane/main.go', 'control-plane/mcp.go', 'web/src/pages/Dashboard.tsx', 'web/src/components/onboarding/OnboardingWizard.tsx']
code_patterns: ['Raw SQL with lib/pq, no ORM', 'ConnectRPC handlers in connect_*.go files', 'DB queries as standalone functions (dbXxx pattern)', 'stageRow struct maps 1:1 to DB columns', 'stageRowToStruct merges DB row with in-memory live state', 'StreamDestinationForm is reusable with compact/verbose modes', 'Dashboard.tsx line 199: selectedDest = destinations[0] — hardcoded first destination']
test_patterns: ['No test suites — validation via go vet + npm run build']
---

# Tech-Spec: Stage Destination Selector

**Created:** 2026-03-04

## Overview

### Problem Statement

When starting a stream, `configureOBSStream` blindly picks the first enabled RTMP destination for the user. Users can't choose which destination a specific stage uses, and stages don't remember their selection. This means users with multiple destinations (e.g., Twitch + YouTube) have no control over where a stage streams to.

### Solution

Add a destination selector (dropdown/list of previously configured destinations) in both the onboarding flow and the stage side panel. Persist the selected destination per-stage in the database. The MCP `start` tool uses the stage's assigned destination instead of the first enabled one.

### Scope

**In Scope:**
- Destination picker UI in onboarding + stage slide-over panel
- Per-stage destination persistence (stage ↔ destination association)
- `configureOBSStream` uses the stage's assigned destination
- `validateStreamDestination` checks the stage's assigned destination
- Backfill migration for existing stages (auto-assign first enabled destination)

**Out of Scope:**
- Multi-destination streaming (Twitch + YouTube simultaneously)
- Creating new destinations inline from the selector (use existing CRUD flow)

## Context for Development

### Codebase Patterns

- ConnectRPC for all API calls; proto definitions in `control-plane/proto/api/v1/`
- Clerk JWT auth on all services
- Stream keys encrypted at rest with AES-256-GCM
- Raw SQL with `lib/pq` — no ORM; queries are standalone `dbXxx()` functions in `db.go`
- `stageRow` struct maps 1:1 to DB columns; `stageRowToStruct()` merges with in-memory live state
- React 19 + Tailwind 4, shadcn-style hand-written UI components
- `.js` extensions required on TS imports
- Migrations are sequential numbered files in `control-plane/migrations/`
- Proto codegen: `buf generate` outputs to `control-plane/gen/` (Go) and `web/src/gen/` (TS)
- In-memory `Stage` struct (`main.go:52-61`) is separate from `stageRow` DB struct

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `control-plane/mcp.go:266-367` | `handleMCPCreateStage`, `validateStreamDestination`, `configureOBSStream` |
| `control-plane/connect_stage.go` | StageService CRUD handlers, `stageRowToStruct`, `stageToProto` |
| `control-plane/connect_stream.go` | RtmpDestinationService CRUD handlers |
| `control-plane/db.go:267-339` | Stage DB queries (`stageRow`, `dbCreateStage`, `dbListStages`, `dbGetStage`, `dbUpdateStageStatus`) |
| `control-plane/db.go:194-265` | Stream destination DB queries |
| `control-plane/main.go:52-61` | In-memory `Stage` struct |
| `control-plane/main.go:478-493` | `createStageRecord` — creates DB row + returns Stage |
| `control-plane/migrations/005_consolidate_stages.up.sql` | Latest migration — stages table |
| `control-plane/proto/api/v1/stage.proto` | Stage proto message + StageService RPCs |
| `control-plane/proto/api/v1/stream.proto` | StreamDestination proto + RtmpDestinationService RPCs |
| `web/src/pages/Dashboard.tsx:199` | `selectedDest = destinations[0]` — hardcoded first dest |
| `web/src/pages/Dashboard.tsx:368-413` | Streaming section in slide-over panel |
| `web/src/components/onboarding/OnboardingWizard.tsx:62-74` | `createStreamDestination` in onboarding flow |
| `web/src/components/onboarding/StreamDestinationForm.tsx` | Reusable form component |
| `web/src/client.ts` | ConnectRPC client setup (`stageClient`, `streamClient`) |

### Technical Decisions

- **Stage ↔ destination is a nullable FK** on the `stages` table (`destination_id TEXT REFERENCES stream_destinations(id) ON DELETE SET NULL`). A stage can exist without a destination.
- **Selection persisted server-side** so MCP `start` can read it without UI involvement.
- **New RPC `SetStageDestination`** on StageService to set the destination_id. Separate from a general "UpdateStage" to keep it focused.
- **`configureOBSStream` retains `userID` parameter** for user-scoped destination lookup. It uses the stage's `destination_id` to find the specific destination but verifies the destination belongs to the user via `dbGetStreamDestForUser(destID, userID)`.
- **`validateStreamDestination` changes** to accept both `stageID` and `userID`, called BEFORE `activateStage` (the stage DB record already exists at this point — `agentID` IS the stage ID).
- **Dashboard UI replaces** the hardcoded `destinations[0]` with a dropdown of the user's destinations, pre-selecting the stage's current `destination_id`.
- **Onboarding flow** creates the destination, then assigns it to the newly created stage via `SetStageDestination`.
- **Backfill migration** assigns existing stages their user's first enabled destination so existing users aren't broken.

## Implementation Plan

### Tasks

- [x] **Task 1: Database migration — add `destination_id` to stages + backfill**
  - File: `control-plane/migrations/006_stage_destination.up.sql` (NEW)
  - Action: Create migration that:
    1. Adds `destination_id TEXT REFERENCES stream_destinations(id) ON DELETE SET NULL` to the `stages` table
    2. Backfills existing stages: `UPDATE stages SET destination_id = (SELECT id FROM stream_destinations WHERE user_id = stages.user_id ORDER BY created_at LIMIT 1) WHERE destination_id IS NULL`
  - Notes: `ON DELETE SET NULL` ensures deleting a destination doesn't break stages. Backfill assigns any destination (enabled or not) — a disabled destination gives a better error ("destination 'My Twitch' is disabled") than no destination ("no destination configured"). The runtime `validateStreamDestination` check handles the enabled/disabled distinction.

- [x] **Task 2: Update `stageRow` struct and DB queries**
  - File: `control-plane/db.go`
  - Action:
    - Add `DestinationID sql.NullString` field to `stageRow` struct (after `PodIP`)
    - Update `dbListStages` SELECT + Scan to include `destination_id`
    - Update `dbGetStage` SELECT + Scan to include `destination_id`
    - Add new function `dbSetStageDestination(db *sql.DB, stageID, userID, destinationID string) error` — when `destinationID` is empty, use `sql.NullString{Valid: false}` to set `destination_id = NULL` (not empty string `""`, which would violate the FK constraint). When non-empty, use `sql.NullString{String: destinationID, Valid: true}`. SQL: `UPDATE stages SET destination_id=$3, updated_at=NOW() WHERE id=$1 AND user_id=$2` (user-scoped)
    - Add new function `dbGetStreamDestForUser(db *sql.DB, destID, userID string) (*streamDestRow, error)` — `SELECT ... FROM stream_destinations WHERE id=$1 AND user_id=$2` (user-scoped to prevent cross-user access)
  - Notes: Do NOT modify `dbCreateStage` — destination is always assigned separately via `SetStageDestination` after stage creation. This avoids Go's lack of optional params and keeps the creation path simple. **IMPORTANT**: When clearing `destination_id`, always use SQL `NULL`, never empty string `""` — the FK constraint will reject empty strings since no `stream_destinations` row has `id = ''`.

- [x] **Task 3: Update proto — add `destination_id` to Stage message + new RPC**
  - File: `control-plane/proto/api/v1/stage.proto`
  - Action:
    - Add `string destination_id = 10;` to the `Stage` message
    - Add new RPC `SetStageDestination` to `StageService`:
      ```proto
      rpc SetStageDestination(SetStageDestinationRequest) returns (SetStageDestinationResponse);
      ```
    - Add messages:
      ```proto
      message SetStageDestinationRequest {
        string stage_id = 1;
        string destination_id = 2;  // empty string to clear
      }
      message SetStageDestinationResponse {
        Stage stage = 1;
      }
      ```
  - Notes: Run `make proto` after this to regenerate Go + TS code. **Build will fail until Task 4+5 are also done** (generated interface requires `SetStageDestination` implementation). Tasks 3, 4, 5 must be implemented together before compiling.

- [x] **Task 4: Update `stageToProto` and `stageRowToStruct`**
  - File: `control-plane/connect_stage.go`
  - Action:
    - Update `stageRowToStruct` to copy `DestinationID` from `stageRow.DestinationID.String` to the in-memory `Stage.DestinationID` field
    - Update `stageToProto` to set `DestinationId: s.DestinationID` on the proto Stage message
  - File: `control-plane/main.go`
  - Action:
    - Add `DestinationID string` field to the in-memory `Stage` struct (line ~60, after `OwnerUserID`)

- [x] **Task 5: Implement `SetStageDestination` RPC handler**
  - File: `control-plane/connect_stage.go`
  - Action:
    - Add `SetStageDestination` method to `stageServer`:
      ```go
      func (s *stageServer) SetStageDestination(ctx context.Context, req *connect.Request[apiv1.SetStageDestinationRequest]) (*connect.Response[apiv1.SetStageDestinationResponse], error) {
      ```
    - Authenticate via `mustAuth(ctx)` to get `info.UserID`
    - Validate the stage belongs to the user: `dbGetStage(s.mgr.db, req.Msg.StageId)` then check `row.UserID == info.UserID`
    - If `destination_id` is non-empty: validate destination exists AND belongs to the same user via `dbGetStreamDestForUser(s.mgr.db, req.Msg.DestinationId, info.UserID)`. Return `connect.CodeNotFound` if not found.
    - Call `dbSetStageDestination(s.mgr.db, req.Msg.StageId, info.UserID, req.Msg.DestinationId)`. Pass empty string to clear (the DB function converts `""` to SQL `NULL`).
    - Re-fetch and return updated stage
  - Notes: Handler registration is automatic — the generated `StageServiceHandler` interface requires it, and the `_ apiv1connect.StageServiceHandler = (*stageServer)(nil)` check in `main.go` enforces compile-time compliance.

- [x] **Task 6: Update MCP flow — `validateStreamDestination` and `configureOBSStream`**
  - File: `control-plane/mcp.go`
  - Action:
    - **`validateStreamDestination`**: Change signature from `(userID string) error` to `(stageID, userID string) (*streamDestRow, error)` — returns the validated destination row so `configureOBSStream` can reuse it without re-fetching.
      1. Look up stage's `destination_id` via `dbGetStage(m.db, stageID)`.
      2. If `destination_id` is NULL/empty, return error: `"no stream destination configured for stage %s — select one in the dashboard"` (include stage ID for actionability).
      3. Fetch the specific destination via `dbGetStreamDestForUser(m.db, destID, userID)` (user-scoped).
      4. Validate it's enabled, has non-empty RTMP URL, and stream key is decryptable.
      5. If destination is disabled, return error: `"stream destination '%s' is disabled on stage %s — enable it in the dashboard"` (include destination name + stage ID).
      6. Return the validated `*streamDestRow` on success.
    - **`configureOBSStream`**: Change signature from `(stage *Stage, userID string)` to `(stage *Stage, dest *streamDestRow)` — accepts the already-validated destination row from `validateStreamDestination`. No DB queries needed:
      1. Decrypt `dest.StreamKey` using `m.encryptionKey`.
      2. Configure OBS with `dest.RtmpURL` and decrypted key.
      3. No more iterating all destinations, no redundant DB calls.
    - **`handleMCPCreateStage`**: Update the flow to:
      ```go
      // Validate destination BEFORE activating stage
      dest, err := m.validateStreamDestination(agentID, userID)
      if err != nil { return error }

      // Activate stage (spin up pod)
      readyStage, err := m.activateStage(waitCtx, agentID, userID)
      if err != nil { return error }

      // Configure OBS with the already-validated destination
      if err := m.configureOBSStream(readyStage, dest); err != nil { return error }
      ```
  - **IMPORTANT**: Validation stays BEFORE activation. The `agentID` is the stage ID. The stage record exists in the `stages` DB table before `activateStage` is called (created via `createStageRecord` or the UI). `activateStage` just spins up the k8s pod. Do NOT reorder.
  - **NOTE**: The in-memory `Stage` struct's `DestinationID` field (added in Task 4) is NOT populated in the MCP path because `activateStage` -> `createStage` -> `waitForStage` builds the `Stage` from the in-memory map, not from a DB row. This is fine — the validated `dest` is passed directly from `validateStreamDestination` to `configureOBSStream`, avoiding any reliance on the in-memory struct.

- [x] **Task 7: Dashboard UI — destination selector in stage panel**
  - File: `web/src/pages/Dashboard.tsx`
  - Action:
    - Remove the hardcoded `selectedDest = destinations[0]` (line 199)
    - Compute `selectedDest` by matching `selectedStage?.destinationId` against the `destinations` array: `destinations.find(d => d.id === selectedStage?.destinationId)`. If `destinationId` is set but no match found in `destinations` (stale/deleted), treat as no selection.
    - Replace the streaming section (lines 368-413) with a destination selector:
      - Show a `<select>` dropdown listing all user destinations (`${dest.name} (${dest.platform})`), plus an empty `<option value="">Select destination...</option>`
      - Pre-select the stage's current `destinationId`
      - On change, call `stageClient.setStageDestination({ stageId: selectedStageId!, destinationId: e.target.value })` then `await refresh()`
    - Keep the existing `StreamDestinationForm` below the selector for editing the selected destination's details (or creating a new one if none exist)
    - Keep the enable/disable toggle for the selected destination
    - **Auto-select on create**: When `handleStreamSave` creates a NEW destination (not updating an existing one), after `streamClient.createStreamDestination` returns the new dest, call `stageClient.setStageDestination({ stageId: selectedStageId!, destinationId: newDest.id })` before `refresh()`. This way a user who creates their first destination in the panel doesn't have to manually select it from the dropdown afterward.

- [x] **Task 8: Onboarding — assign destination to stage after creation**
  - File: `web/src/components/onboarding/OnboardingWizard.tsx`
  - Action:
    - Change `createStreamDestination` return type from `void` to `string | null` (returns the new destination ID or null on failure):
      ```typescript
      async function createStreamDestination(dest: StreamDestinationData): Promise<string | null> {
        try {
          const resp = await streamClient.createStreamDestination({
            name: dest.name,
            platform: dest.platform,
            rtmpUrl: dest.rtmpUrl,
            streamKey: dest.streamKey,
            enabled: true,
          });
          return resp.destination?.id ?? null;
        } catch {
          return null;
        }
      }
      ```
    - In the `EndpointCreator` callback (lines 98-103), after creating the destination, assign it to the stage:
      ```typescript
      onCreated={async (st, key) => {
        setStage(st);
        setApiKey(key);
        let destId: string | null = null;
        if (streamDest) {
          destId = await createStreamDestination(streamDest);
        }
        if (destId && st.id) {
          try {
            await stageClient.setStageDestination({ stageId: st.id, destinationId: destId });
          } catch {
            // best-effort — user can fix in dashboard
          }
        }
        setStep(3);
      }}
      ```
  - Notes: **Add `stageClient` to the import** — change `import { streamClient } from "../../client.js"` to `import { stageClient, streamClient } from "../../client.js"`. The `CreateStreamDestinationResponse` proto has `StreamDestination destination = 1` which includes the `id` field, accessible as `resp.destination?.id` in the generated TS types.

### Acceptance Criteria

- [ ] **AC 1:** Given a user with multiple RTMP destinations, when they open a stage's slide-over panel, then they see a dropdown listing all their destinations with the stage's current selection highlighted
- [ ] **AC 2:** Given a user selects a different destination from the dropdown, when the selection changes, then `SetStageDestination` is called and the stage's `destination_id` is persisted in the database
- [ ] **AC 3:** Given a stage has a `destination_id` set, when the MCP `start` tool is called for that stage, then OBS is configured with that specific destination's RTMP URL and stream key (not the first enabled one)
- [ ] **AC 4:** Given a stage has no `destination_id` set, when the MCP `start` tool is called, then it returns an error message telling the user to configure a destination for the stage
- [ ] **AC 5:** Given a user completes onboarding and creates both a stage and a destination, when the wizard finishes, then the new destination is automatically assigned to the new stage
- [ ] **AC 6:** Given a destination is deleted, when a stage was using that destination, then the stage's `destination_id` is set to NULL (ON DELETE SET NULL) and the UI shows "Select destination..."
- [ ] **AC 7:** Given a stage with a destination selected, when the user reopens the panel later, then the previously selected destination is still shown (persistence works)
- [ ] **AC 8:** Given a stage's assigned destination is disabled, when the MCP `start` tool is called, then it returns a descriptive error naming the disabled destination (not a generic "no destination" error)
- [ ] **AC 9:** Given an existing user with stages and destinations before this change, when the migration runs, then existing stages are automatically assigned their user's first destination (no breaking change)
- [ ] **AC 10:** Given a user creates a new destination via the form in the stage panel, when the destination is saved, then it is automatically selected as the stage's destination without requiring manual dropdown selection

## Additional Context

### Dependencies

- Existing `stream_destinations` table and CRUD operations
- Existing stage management (create/list/activate)
- `buf` CLI for proto codegen (`make proto`)
- `make build deploy` for remote build + deploy

### Testing Strategy

- Pre-deploy validation: `go vet ./...` (in `control-plane/`) + `cd web && npm run build` (TS type check)
- Manual testing:
  1. Create two RTMP destinations
  2. Create a stage, verify dropdown shows both destinations
  3. Select one, reload page, verify selection persists
  4. Start stage via MCP, verify OBS uses the selected destination (check control-plane logs for "Configuring OBS stream for stage X (dest=Y)")
  5. Delete the selected destination, verify stage shows empty selector
  6. Run onboarding wizard, verify new stage gets new destination auto-assigned
  7. Disable a destination, try to start — verify descriptive error mentioning the disabled destination by name

### Notes

- The MCP `start` flow validates destination BEFORE activating the stage. The `agentID` in the MCP context IS the stage ID. The stage DB record exists before `activateStage` is called (created via `createStageRecord` or the UI's `CreateStage` RPC). `activateStage` just spins up the k8s pod.
- The in-memory `Stage` struct gets `DestinationID` for consistency with `stageRowToStruct` and the ConnectRPC ListStages/GetStage path. It is NOT populated in the MCP `activateStage` path — the MCP flow passes the validated `*streamDestRow` directly from `validateStreamDestination` to `configureOBSStream` instead.
- `dbGetStreamDestForUser` is user-scoped (filters by both `id` and `user_id`) to prevent cross-user destination access. This is defense-in-depth — `SetStageDestination` also validates ownership, but the validation + OBS config path double-checks.
- Tasks 3, 4, 5 must be implemented together before compiling — the generated interface enforces that all RPC methods are implemented.
- When clearing `destination_id` (via `SetStageDestination` with empty string), the DB function must use SQL `NULL`, not empty string `""`. An empty string violates the FK constraint.
- The backfill migration auto-assigns existing stages their user's first enabled destination. Users with NO destinations will still have `NULL` — this is expected; they'll see the "Select destination..." prompt in the UI. There is no auto-assignment mechanism after migration; users must select manually.

## Review Notes
- Adversarial review completed
- Findings: 11 total, 3 fixed, 8 skipped (pre-existing/by-design/low-impact)
- Resolution approach: auto-fix
- Fixed: F2 (RowsAffected check in dbSetStageDestination), F9 (eliminated double decryption), F10 (struct alignment)
- Skipped: F1 (naming — works correctly today), F3 (UX — future enhancement), F4 (pre-existing), F5 (FK handles race), F6 (acceptable UX), F7 (by design), F8 (low impact), F11 (by design)
