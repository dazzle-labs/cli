---
title: 'Dedicated Destinations Page'
slug: 'dedicated-destinations-page'
created: '2026-03-04'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React 19', 'TypeScript 5.6', 'Tailwind 4', 'ConnectRPC', 'lucide-react', 'Go 1.24']
files_to_modify: ['control-plane/connect_stream.go', 'control-plane/db.go', 'web/src/App.tsx', 'web/src/components/Layout.tsx', 'web/src/pages/StreamConfig.tsx', 'web/src/pages/Dashboard.tsx']
code_patterns: ['Sidebar nav items array in Layout.tsx', 'StreamConfig.tsx exists with table+create+toggle+delete but not routed', 'Stage panel streaming section (Dashboard.tsx:378-445) has dropdown+toggle+StreamDestinationForm', 'StreamDestinationForm supports compact/verbose modes with initial data for editing', 'stageClient.setStageDestination for stage-destination linking', 'ON DELETE SET NULL FK handles DB cleanup when destination deleted', 'deleteStreamDestination handler does no stage checking — relies on FK constraint', 'UpdateStreamDestination always re-encrypts stream key — no skip-if-empty logic', 'listStreamDestinations masks stream keys via maskStreamKey()', 'handleToggle in StreamConfig sends masked key — pre-existing credential corruption bug']
test_patterns: ['No test suites — validation via go vet + npm run build']
---

# Tech-Spec: Dedicated Destinations Page

**Created:** 2026-03-04

## Overview

### Problem Statement

Destinations are managed entirely inline within the stage slide-over panel, making the UX cluttered. The stage panel has a dropdown selector, an enable/disable toggle, AND a full create/edit form — all crammed into one section. Users need a dedicated place to manage their streaming destinations (CRUD), and the stage panel should be simplified to just picking which destination a stage uses.

### Solution

1. Fix the backend `UpdateStreamDestination` handler to skip stream key re-encryption when the key is empty (prerequisite for safe edit and toggle operations)
2. Wire up the existing `StreamConfig.tsx` as a new `/destinations` route with a "Destinations" sidebar nav item
3. Enhance `StreamConfig.tsx` with edit mode and replace its raw form with `StreamDestinationForm`
4. Simplify the stage slide-over panel to just a destination dropdown selector + a "Manage destinations" link pointing to `/destinations`
5. Remove the inline `StreamDestinationForm`, enable/disable toggle, and `handleStreamSave` logic from Dashboard.tsx

### Scope

**In Scope:**
- Backend fix: `UpdateStreamDestination` skips stream key when empty
- New `/destinations` route and sidebar nav item (below Stages)
- Enhance existing `StreamConfig.tsx` with edit capability via `StreamDestinationForm`
- Add delete confirmation dialog
- Simplify stage panel streaming section to dropdown-only + link
- Remove destination CRUD code from Dashboard.tsx
- Fix pre-existing toggle credential corruption bug

**Out of Scope:**
- Changes to the onboarding wizard (keeps inline creation)
- Changes to MCP flow or destination-stage linking logic

## Context for Development

### Codebase Patterns

- React 19 + Tailwind 4, shadcn-style hand-written UI components
- `.js` extensions required on TS imports (e.g., `import { Foo } from "./bar.js"`)
- Sidebar nav is a static array in `Layout.tsx` — `navItems = [{ path, label, icon }]`
- `StreamConfig.tsx` already exists with full table view, raw create form, toggle, and delete — but is not routed in App.tsx
- Stage panel uses `selectedDest` derived from `selectedStage.destinationId` matched against `destinations` array
- `handleStreamSave` and `handleToggleStream` in Dashboard.tsx handle all destination CRUD inline — to be removed
- `StreamDestinationForm` component supports `compact` and `verbose` modes with `initial` data for editing, custom `submitLabel`, and `hideSkip`
- `ON DELETE SET NULL` FK constraint on `stages.destination_id` handles DB cleanup when a destination is deleted
- `deleteStreamDestination` backend handler does no stage checking — relies entirely on FK constraint
- **Pre-existing bug:** `UpdateStreamDestination` always re-encrypts `msg.StreamKey`, and `listStreamDestinations` returns masked keys (`****abcd`). Any update (including toggle) sends the masked key, silently corrupting the real credential. Fixed in Task 1.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `control-plane/connect_stream.go:61-78` | `UpdateStreamDestination` handler — always re-encrypts stream key |
| `control-plane/db.go:241-253` | `dbUpdateStreamDest` — SQL UPDATE includes stream_key |
| `web/src/pages/StreamConfig.tsx` | Existing dead-code destinations page — has table, raw create form, toggle, delete |
| `web/src/pages/Dashboard.tsx:378-445` | Stage panel streaming section to simplify |
| `web/src/pages/Dashboard.tsx:111-159` | `handleToggleStream` and `handleStreamSave` — to remove |
| `web/src/pages/Dashboard.tsx:1-15` | Imports to clean up |
| `web/src/pages/Dashboard.tsx:220` | `Radio` icon used in streaming banner — must keep in imports |
| `web/src/components/Layout.tsx:9-13` | Sidebar `navItems` array |
| `web/src/App.tsx:33-37` | Routes definition |
| `web/src/components/onboarding/StreamDestinationForm.tsx` | Reusable form component with `initial`, `submitLabel`, `compact`, `hideSkip` props |
| `web/src/client.ts` | `streamClient` and `stageClient` exports |

### Technical Decisions

- **Backend fix for stream key preservation:** `UpdateStreamDestination` must skip re-encryption when `msg.StreamKey` is empty. The DB function `dbUpdateStreamDest` gets a new variant or conditional SQL that excludes `stream_key` from the UPDATE when the value is empty. This fixes the pre-existing toggle corruption bug AND enables safe editing without re-entering the stream key.
- **Build on `StreamConfig.tsx`** rather than starting fresh — it already has the right structure (table + toggle + delete). Replace its raw form with `StreamDestinationForm` for RTMP auto-fill and consistency.
- **Stage panel keeps the dropdown** for destination selection (`setStageDestination` RPC) but removes all CRUD (form, toggle). Adds a link to `/destinations` for management.
- **Dashboard.tsx still fetches destinations** (for the dropdown) but no longer needs `StreamDestinationForm` or CRUD handlers.
- **Streaming banner** keeps pointing to the stage panel — the panel's dropdown + link is the natural breadcrumb.
- **Stage panel empty state** — when no destinations exist, show "No destinations yet. Create one" linking to `/destinations`.
- **Edit form replaces the create form area** — same toggle pattern. Click a row → form appears pre-filled → "Save". Header button becomes "Cancel" during both create and edit. On save/cancel, form clears and collapses.
- **Edit form passes empty `streamKey` in `initial`** — not the masked value. The form's stream key field appears blank with placeholder text. If user leaves it blank, the backend preserves the existing key. If user enters a new key, it's re-encrypted.
- **Generic delete confirmation** — "This destination will be unlinked from any stages using it. Delete?" No `listStages` fetch needed.
- **`Radio` icon stays in Dashboard.tsx imports** — it's used in the streaming banner (line 220). Only remove `ToggleLeft`, `ToggleRight`.
- **Toggle sends empty `streamKey`** — `handleToggle` in `StreamConfig.tsx` sends `streamKey: ""` instead of `dest.streamKey` (the masked value). Backend skip-if-empty logic preserves the real key.
- **Platform list:** Switching from StreamConfig's raw form (4 platforms) to `StreamDestinationForm` adds "Kick" as a 5th platform. This is an improvement, not a regression.

## Implementation Plan

### Tasks

- [x] **Task 1: Backend fix — skip stream key re-encryption when empty**
  - File: `control-plane/connect_stream.go`
  - Action: Update `UpdateStreamDestination` handler (lines 61-78) to conditionally handle stream key:
    ```go
    func (s *rtmpDestinationServer) UpdateStreamDestination(ctx context.Context, req *connect.Request[apiv1.UpdateStreamDestinationRequest]) (*connect.Response[apiv1.UpdateStreamDestinationResponse], error) {
        info := mustAuth(ctx)
        msg := req.Msg

        var encKey string
        if msg.StreamKey != "" {
            var err error
            encKey, err = encryptString(s.mgr.encryptionKey, msg.StreamKey)
            if err != nil {
                return nil, connect.NewError(connect.CodeInternal, err)
            }
        }

        row, err := dbUpdateStreamDest(s.mgr.db, msg.Id, info.UserID, msg.Name, msg.Platform, msg.RtmpUrl, encKey, msg.Enabled)
        if err != nil {
            return nil, connect.NewError(connect.CodeNotFound, err)
        }

        return connect.NewResponse(&apiv1.UpdateStreamDestinationResponse{
            Destination: streamDestToProto(row, false),
        }), nil
    }
    ```
  - File: `control-plane/db.go`
  - Action: Update `dbUpdateStreamDest` to conditionally include `stream_key` in the UPDATE:
    ```go
    func dbUpdateStreamDest(db *sql.DB, id, userID, name, platform, rtmpURL, encStreamKey string, enabled bool) (*streamDestRow, error) {
        row := &streamDestRow{}
        var err error
        if encStreamKey != "" {
            err = db.QueryRow(`
                UPDATE stream_destinations SET name=$3, platform=$4, rtmp_url=$5, stream_key=$6, enabled=$7, updated_at=NOW()
                WHERE id=$1 AND user_id=$2
                RETURNING id, user_id, name, platform, rtmp_url, stream_key, enabled, created_at, updated_at`,
                id, userID, name, platform, rtmpURL, encStreamKey, enabled).
                Scan(&row.ID, &row.UserID, &row.Name, &row.Platform, &row.RtmpURL, &row.StreamKey, &row.Enabled, &row.CreatedAt, &row.UpdatedAt)
        } else {
            err = db.QueryRow(`
                UPDATE stream_destinations SET name=$3, platform=$4, rtmp_url=$5, enabled=$6, updated_at=NOW()
                WHERE id=$1 AND user_id=$2
                RETURNING id, user_id, name, platform, rtmp_url, stream_key, enabled, created_at, updated_at`,
                id, userID, name, platform, rtmpURL, enabled).
                Scan(&row.ID, &row.UserID, &row.Name, &row.Platform, &row.RtmpURL, &row.StreamKey, &row.Enabled, &row.CreatedAt, &row.UpdatedAt)
        }
        if err != nil {
            return nil, err
        }
        return row, nil
    }
    ```
  - Notes: This also fixes the pre-existing bug where `handleToggle` in `StreamConfig.tsx` sends the masked stream key, corrupting credentials. After this fix, any caller that sends `streamKey: ""` preserves the existing key. **Must be deployed before the frontend changes go live.**

- [x] **Task 2: Add route and sidebar nav item**
  - File: `web/src/App.tsx`
  - Action:
    1. Add import: `import { StreamConfig } from "./pages/StreamConfig.js";`
    2. Add route inside `<Routes>`: `<Route path="/destinations" element={<StreamConfig />} />`
  - File: `web/src/components/Layout.tsx`
  - Action:
    1. Add `Radio` to lucide-react imports
    2. Add nav item to `navItems` array after "Stages": `{ path: "/destinations", label: "Destinations", icon: Radio }`
  - Notes: `Radio` icon matches the destination concept. Place between Stages and API Keys in nav order.

- [x] **Task 3: Enhance StreamConfig.tsx — replace raw form with StreamDestinationForm + add edit mode + fix toggle**
  - File: `web/src/pages/StreamConfig.tsx`
  - Action:
    1. Add imports:
       ```typescript
       import { StreamDestinationForm } from "@/components/onboarding/StreamDestinationForm.js";
       import type { StreamDestinationData } from "@/components/onboarding/StreamDestinationForm.js";
       ```
    2. Add state:
       ```typescript
       const [editingId, setEditingId] = useState<string | null>(null);
       const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
       ```
    3. Remove the raw `form` state object (`useState({ name: "", platform: "custom", rtmpUrl: "", streamKey: "", enabled: true })`) and the `platforms` constant (line 8) — no longer needed
    4. Remove the `Input` import — no longer needed (StreamDestinationForm handles its own inputs)
    5. Replace `handleCreate` to accept `StreamDestinationData`:
       ```typescript
       async function handleCreate(data: StreamDestinationData) {
         try {
           await streamClient.createStreamDestination({
             name: data.name,
             platform: data.platform,
             rtmpUrl: data.rtmpUrl,
             streamKey: data.streamKey,
             enabled: true,
           });
           setShowForm(false);
           await refresh();
         } catch {
           // ignore
         }
       }
       ```
    6. Add `handleUpdate`:
       ```typescript
       async function handleUpdate(id: string, data: StreamDestinationData) {
         try {
           const existing = destinations.find(d => d.id === id);
           await streamClient.updateStreamDestination({
             id,
             name: data.name,
             platform: data.platform,
             rtmpUrl: data.rtmpUrl,
             streamKey: data.streamKey,
             enabled: existing?.enabled ?? true,
           });
           setEditingId(null);
           await refresh();
         } catch {
           // ignore
         }
       }
       ```
    7. **Fix `handleToggle`** — send empty `streamKey` instead of masked value:
       ```typescript
       async function handleToggle(dest: StreamDestination) {
         try {
           await streamClient.updateStreamDestination({
             id: dest.id,
             name: dest.name,
             platform: dest.platform,
             rtmpUrl: dest.rtmpUrl,
             streamKey: "",
             enabled: !dest.enabled,
           });
           await refresh();
         } catch {
           // ignore
         }
       }
       ```
    8. Replace the entire `{showForm && (...)}` create form block (lines 102-148) with:
       ```tsx
       {(showForm || editingId) && (
         <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 mb-8">
           <h3 className="text-sm font-semibold text-white mb-5">
             {editingId ? "Edit Destination" : "New Destination"}
           </h3>
           <StreamDestinationForm
             key={editingId ?? "new"}
             compact
             hideSkip
             initial={editingId ? (() => {
               const d = destinations.find(d => d.id === editingId);
               return d ? { name: d.name, platform: d.platform, rtmpUrl: d.rtmpUrl, streamKey: "" } : undefined;
             })() : undefined}
             submitLabel={editingId ? "Save" : "Create"}
             onNext={(data) => {
               if (data) {
                 if (editingId) {
                   handleUpdate(editingId, data);
                 } else {
                   handleCreate(data);
                 }
               }
             }}
           />
         </div>
       )}
       ```
    9. Add click handler on table rows to enter edit mode:
       ```tsx
       <tr key={d.id} onClick={() => { setEditingId(d.id); setShowForm(false); }} className="... cursor-pointer">
       ```
    10. Update "Add Destination" header button:
        ```tsx
        onClick={() => {
          if (showForm || editingId) { setShowForm(false); setEditingId(null); }
          else { setShowForm(true); }
        }}
        ```
        Button label: show "Cancel" when `showForm || editingId`, otherwise "Add Destination"
    11. Replace direct `handleDelete` call in delete button with confirmation flow:
        - If `confirmDeleteId === d.id`: show inline text "Unlinks from stages. Delete?" with two buttons:
          - "Delete" (calls `handleDelete(d.id)` then `setConfirmDeleteId(null)`)
          - "Cancel" (calls `setConfirmDeleteId(null)`)
        - Otherwise: show trash icon button that calls `setConfirmDeleteId(d.id)`
        - Add `onClick` stop propagation on the delete cell to prevent row click from triggering edit: `onClick={(e) => e.stopPropagation()}`
  - Notes: `key={editingId ?? "new"}` forces form remount when switching destinations. `streamKey: ""` in `initial` ensures the form shows a blank password field, not the masked value. If the user leaves stream key blank and submits, the backend preserves the existing key (Task 1). The `StreamDestinationForm` requires stream key — need to make it optional for edit mode. See Task 3a.

- [x] **Task 3a: Make StreamDestinationForm stream key optional for edit mode**
  - File: `web/src/components/onboarding/StreamDestinationForm.tsx`
  - Action:
    1. Add optional `streamKeyOptional` prop to `StreamDestinationFormProps`:
       ```typescript
       streamKeyOptional?: boolean;
       ```
    2. Remove `required` from the stream key `<Input>` when `streamKeyOptional` is true:
       ```tsx
       <Input
         type="password"
         value={streamKey}
         onChange={(e) => setStreamKey(e.target.value)}
         placeholder={streamKeyOptional ? "Leave blank to keep current key" : "Your stream key"}
         required={!streamKeyOptional}
       />
       ```
  - Notes: Only `StreamConfig.tsx` passes `streamKeyOptional={!!editingId}`. The onboarding wizard and any other callers are unaffected (prop defaults to false/undefined = required).

- [x] **Task 4: Simplify Dashboard.tsx stage panel streaming section**
  - File: `web/src/pages/Dashboard.tsx`
  - Action:
    1. **Update imports:**
       - Remove: `StreamDestinationForm` and `StreamDestinationData` imports (lines 11-12)
       - Remove: `ToggleLeft`, `ToggleRight` from lucide-react imports (line 10). **Keep `Radio`** — used in streaming banner (line 220).
       - Add: `ArrowUpRight` to lucide-react imports
       - Add: `Link` to `react-router-dom` import (line — add to existing import from "react-router-dom" if present, otherwise add new import)
    2. **Remove functions:**
       - Remove `handleToggleStream` (lines 111-125)
       - Remove `handleStreamSave` (lines 127-159)
    3. **Remove `selectedDest` computation** (lines 207-209) — no longer needed
    4. **Replace the entire streaming section** (lines 378-445, the `{/* Section 4: Stream Destination */}` div) with:
       ```tsx
       {/* Section 4: Stream Destination */}
       <div className="border-t border-white/[0.06] pt-4 mt-4">
         <p className="text-xs font-medium text-zinc-400 mb-3">Streaming</p>
         {destinations.length > 0 ? (
           <>
             <select
               value={selectedStage?.destinationId || ""}
               onChange={async (e) => {
                 try {
                   await stageClient.setStageDestination({ stageId: selectedStageId!, destinationId: e.target.value });
                   await refresh();
                 } catch {
                   // ignore
                 }
               }}
               className="w-full rounded-lg border border-white/[0.06] bg-zinc-950/50 px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 mb-3"
             >
               <option value="">Select destination...</option>
               {destinations.map((d) => (
                 <option key={d.id} value={d.id}>{d.name} ({d.platform})</option>
               ))}
             </select>
             <Link
               to="/destinations"
               className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
             >
               Manage destinations
               <ArrowUpRight className="h-3 w-3" />
             </Link>
           </>
         ) : (
           <Link
             to="/destinations"
             className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors"
           >
             No destinations yet. Create one
             <ArrowUpRight className="h-3 w-3" />
           </Link>
         )}
       </div>
       ```
    5. **Clean up unused imports** — verify `StreamDestination` type import is still needed for `destinations` state typing. Remove if not needed (the `useState<StreamDestination[]>` may infer from the RPC response).
  - Notes: The `Link` component requires `import { Link } from "react-router-dom"` — Dashboard.tsx does NOT currently import it. The `hasStreamDests` variable (line 202) and streaming banner (lines 217-243) remain unchanged — banner still opens the stage panel. The dropdown `onChange` is the stage-destination linking, not CRUD.

### Acceptance Criteria

- [ ] **AC 1:** Given a signed-in user, when they look at the sidebar, then they see "Destinations" between "Stages" and "API Keys"
- [ ] **AC 2:** Given a user clicks "Destinations" in the sidebar, when the page loads, then they see a table of their stream destinations with name, platform, RTMP URL, enabled status, and delete action
- [ ] **AC 3:** Given a user clicks "Add Destination" on the Destinations page, when the form appears, then it uses `StreamDestinationForm` with RTMP auto-fill on platform change (including Kick platform)
- [ ] **AC 4:** Given a user clicks a destination row in the table, when the edit form appears, then it is pre-filled with the destination's name, platform, and RTMP URL. The stream key field is blank with placeholder "Leave blank to keep current key"
- [ ] **AC 5:** Given a user edits a destination and leaves stream key blank, when the form submits, then the backend preserves the existing encrypted stream key (does not overwrite with empty)
- [ ] **AC 6:** Given a user edits a destination and enters a new stream key, when the form submits, then the backend encrypts and stores the new key
- [ ] **AC 7:** Given a user toggles a destination's enabled status, when the toggle fires, then the stream key is NOT sent (empty string), preserving the existing credential
- [ ] **AC 8:** Given a user clicks the delete button on a destination, when the confirmation appears, then it shows "Unlinks from stages. Delete?" with Delete/Cancel options
- [ ] **AC 9:** Given a user opens a stage's slide-over panel, when they look at the Streaming section, then they see only a destination dropdown and a "Manage destinations" link (no form, no toggle)
- [ ] **AC 10:** Given a user selects a destination from the stage panel dropdown, when the selection changes, then `setStageDestination` is called and the selection persists on refresh
- [ ] **AC 11:** Given a user has no destinations, when they open a stage panel, then they see "No destinations yet. Create one" linking to `/destinations`
- [ ] **AC 12:** Given a user clicks "Manage destinations" in the stage panel, when they click it, then they navigate to `/destinations`

## Additional Context

### Dependencies

- Existing `StreamDestinationForm` component (minor change: add `streamKeyOptional` prop)
- Existing ConnectRPC `streamClient` and `stageClient` with all required RPCs
- `react-router-dom` `Link` component (already in project)
- Backend deploy must happen before or alongside frontend deploy (Task 1 before Tasks 2-4)

### Testing Strategy

- Pre-deploy validation: `go vet ./...` (Go) + `cd web && npm run build` (TypeScript type check)
- Manual testing:
  1. Verify "Destinations" appears in sidebar between Stages and API Keys
  2. Navigate to `/destinations` — verify table shows existing destinations
  3. Click "Add Destination" — verify form appears with RTMP auto-fill, Kick platform available
  4. Create a destination, verify it appears in table
  5. Click a table row — verify form appears pre-filled, stream key blank with helper placeholder
  6. Edit name only (leave stream key blank), save — verify name updated, stream still works (key preserved)
  7. Edit with new stream key — verify new key is stored correctly
  8. Toggle enabled/disabled — verify stream key is NOT corrupted (test by starting a stream after toggle)
  9. Click delete — verify confirmation dialog, then delete
  10. Open a stage panel — verify only dropdown + "Manage destinations" link (no form)
  11. Select a destination from dropdown — verify persists on reload
  12. With no destinations, open stage panel — verify "No destinations yet" link
  13. `npm run build` passes with no type errors

### Notes

- **Stream key handling:** The `listStreamDestinations` API returns masked keys (e.g., `****abcd`). The edit form passes `streamKey: ""` in `initial` (NOT the masked value) so the password field appears blank. If the user doesn't enter a new key, the backend preserves the existing encrypted key. This is the safest pattern — no credential data round-trips through the frontend.
- **Pre-existing bug fixed:** The `handleToggle` function previously sent the masked stream key via `updateStreamDestination`, which would re-encrypt the mask and destroy the real credential. Fixed by sending `streamKey: ""` and the backend skip-if-empty logic.
- The `StreamConfig.tsx` filename is a legacy artifact — it manages "Destinations" not "Stream Config". Could be renamed in a future cleanup.
- The streaming banner on the Stages page continues to open the stage panel, not navigate to `/destinations`. The panel's dropdown + link provides the natural path.

## Review Notes
- Pre-implementation adversarial review completed (noted in spec)
- Post-implementation adversarial review completed
- Findings: 12 total — 3 real fixed, 9 noise/out-of-scope
- Resolution approach: auto-fix
- Fixed: F2 (added input validation to UpdateStreamDestination), F5 (clear confirmDeleteId on row click), F11 (clear editingId when deleting the edited destination)
- Skipped: F1 (toggle pattern correct), F3/F6/F8 (consistent with codebase), F4/F10 (SQL duplication — out of scope), F7 (banner pre-existing), F9 (guard exists), F12 (panel unmounts on navigation)
