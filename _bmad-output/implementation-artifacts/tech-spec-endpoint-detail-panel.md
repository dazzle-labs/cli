---
title: 'Endpoint Detail Panel'
slug: 'endpoint-detail-panel'
created: '2026-03-02'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React 19', 'React Router 7', 'Tailwind CSS v4', 'Lucide React', 'class-variance-authority', 'bufbuild/protobuf gRPC Connect']
files_to_modify: ['dashboard/src/pages/Dashboard.tsx', 'dashboard/src/components/onboarding/StreamDestinationForm.tsx']
code_patterns: ['Tailwind dark theme with emerald accents', 'DM Serif Display headers / Outfit body', 'border-white/[0.06] card borders', 'bg-white/[0.02] card backgrounds', 'Overlay uses createPortal + backdrop blur + Escape', 'Badge CVA success/warning variants', 'StreamDestinationForm accepts initial/submitLabel/hideSkip props', 'Docs.tsx copy pattern with clipboard API + Check/Copy icon swap']
test_patterns: ['No test suite in dashboard']
---

# Tech-Spec: Endpoint Detail Panel

**Created:** 2026-03-02

## Overview

### Problem Statement

The endpoints page shows a card grid with limited info and modal-based editing. Users need a streamlined way to see an endpoint's full details, edit stream destinations, and grab copy-ready CLI commands with real session IDs filled in — all without hunting through separate pages.

### Solution

Replace the card grid with a compact list view. Clicking a row opens a slide-over panel showing: endpoint details, stream destination editing (inline, no modal), and tabbed framework CLI snippets with the session's UUID pre-filled.

### Scope

**In Scope:**
- Compact list layout replacing the card grid on Dashboard
- Slide-over detail panel (not a new route — panel state managed via `useState`)
- Tabbed CLI snippets (one framework visible at a time) with session UUID filled in
- Stream destination editing inline on the detail panel
- Stream toggle in the detail panel (for manual override when needed)
- Delete action with confirmation prompt in detail panel
- Minor `StreamDestinationForm` changes for inline embedding (hide heading, always hide skip)
- Responsive panel width (`max-w-full` safety valve)

**Out of Scope:**
- New routes — stays at `/`
- API key selection/inline in snippets
- Changes to the `frameworks.ts` snippet definitions
- Changes to the empty state / "Welcome to Dazzle" flow
- Backend/proto changes
- Fixing session-to-destination round-robin mapping (pre-existing, tracked separately)
- Slide-in/out animation (panel appears/disappears instantly; animation can be added later)
- Focus trap / full ARIA compliance (can be added as a follow-up)

## Context for Development

### Codebase Patterns

- React 19 + React Router 7 SPA, Vite build
- Tailwind v4 dark theme: `bg-zinc-950` base, `bg-white/[0.02]` cards, `border-white/[0.06]` borders, emerald accents for active/CTA
- `'DM Serif Display', serif` for headings, `'Outfit'` for body
- Icons: Lucide React throughout
- API: gRPC Connect clients (`sessionClient`, `streamClient`, `userClient`) from `../client.js`
- Overlay component at `@/components/ui/overlay` — uses `createPortal`, backdrop blur, Escape to close, click-outside to close. **Note:** Overlay hard-codes `flex items-center justify-center` on the backdrop. Do NOT use Overlay for the slide-over panel. Instead, build a custom portal using `createPortal` directly with right-aligned positioning.
- `StreamDestinationForm` at `@/components/onboarding/StreamDestinationForm` — accepts `initial`, `submitLabel`, `hideSkip` props, calls `onNext(data | null)`. **Note:** The form currently renders with centered layout (`flex flex-col items-center`), its own `<h2>` heading, and a help icon. For inline panel embedding, add a `compact` prop that hides the heading/subtitle/help and removes centering.
- `FRAMEWORKS` array in `@/components/onboarding/frameworks.ts` — each has `getSnippet(mcpUrl, apiKey)` returning a string. The `apiKey` parameter is unused by all framework snippets (they each reference the env var in their own language-specific syntax: `$DAZZLE_API_KEY` for shell, `os.environ['DAZZLE_API_KEY']` for Python, `\${DAZZLE_API_KEY}` for YAML). Always pass `""` for `apiKey`.
- MCP URL format: `${window.location.origin}/mcp/${sessionId}`
- Copy pattern from `Docs.tsx`: `navigator.clipboard.writeText()` + `copiedId` state + `Check`/`Copy` icon swap with 2s timeout

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `dashboard/src/pages/Dashboard.tsx` | Current endpoints page — card grid, stream toggle/edit, delete, modal overlay. **Primary file to modify.** |
| `dashboard/src/components/onboarding/StreamDestinationForm.tsx` | Stream dest create/edit form. **Minor modification:** add `compact` prop. |
| `dashboard/src/components/onboarding/frameworks.ts` | `FRAMEWORKS` array with `getSnippet(mcpUrl, apiKey)` — import and use as-is |
| `dashboard/src/pages/Docs.tsx` | Reference for copy-to-clipboard pattern and snippet rendering style |
| `dashboard/src/components/ui/overlay.tsx` | Reference only — do NOT reuse for slide-over (centering conflict). Use `createPortal` directly. |
| `dashboard/src/components/ui/badge.tsx` | `Badge` with `success`/`warning` variants — reuse in list rows |
| `dashboard/src/components/ui/button.tsx` | `Button` with `ghost`/`sm` variants — reuse for delete action |

### Technical Decisions

- **Two files modified** — Main work in `Dashboard.tsx`, minor `compact` prop addition to `StreamDestinationForm.tsx`.
- **Custom portal instead of Overlay** — The existing `Overlay` component hard-codes `flex items-center justify-center` which conflicts with right-aligned slide-over positioning. Build the slide-over backdrop + panel using `createPortal` directly, replicating Overlay's Escape and click-outside behavior.
- **Panel state** — `useState<string | null>(null)` for `selectedSessionId`. When non-null, the slide-over opens with that session's data.
- **Tab state** — `useState(FRAMEWORKS[0].id)` for the active framework tab. Persists across panel open/close.
- **Copy state** — `useState<string | null>(null)` for `copiedId`, same pattern as `Docs.tsx`.
- **`getDestForSession` stays** — Same round-robin logic. Known limitation: index-based mapping shifts when sessions are added/deleted. Out of scope to fix.
- **`StreamDestinationForm` compact mode** — New `compact?: boolean` prop. When true: hides the `<h2>` heading, subtitle, and help icon; removes `items-center` centering from the root div; removes `max-w-md` and `mt-4` from the form element; hides `ArrowRight` icon on submit button; always hides skip button. The form internals (fields, validation, submit) are unchanged.
- **Form `key` prop** — `StreamDestinationForm` uses `useState(initial?.name)` at mount, meaning it won't react to `initial` prop changes. Pass `key={selectedSessionId}` to force remount when the user switches sessions.
- **Timestamp formatting** — Use `timestampDate` from `@bufbuild/protobuf/wkt` (same as `ApiKeys.tsx`), not hand-rolled Date conversion. Show `"—"` for undefined timestamps.
- **Panel close helper** — Single `closePanel()` function that resets both `selectedSessionId` and `confirmingDelete`. Prevents stale `confirmingDelete` state when reopening the same session.
- **Copy timeout cleanup** — Store timeout ID in a ref, clear on unmount via `useEffect` cleanup. Prevents state updates on unmounted panel.
- **Stream toggle in panel** — Users can manually toggle stream on/off from the panel. This is a convenience override; agents also control it programmatically.
- **Delete confirmation** — Panel shows a confirmation prompt ("Delete this endpoint? This will terminate the running session.") before calling `handleDelete`.
- **Responsive width** — Panel uses `w-[480px] max-w-full` so it doesn't overflow on narrow viewports.
- **No animation** — Panel appears/disappears instantly. Slide-in transition is a follow-up enhancement.

## Implementation Plan

### Tasks

- [x] Task 1: Add `compact` prop to `StreamDestinationForm`
  - File: `dashboard/src/components/onboarding/StreamDestinationForm.tsx`
  - Action: Add `compact?: boolean` to `StreamDestinationFormProps`. When `compact` is true:
    - Replace the root `<div className="flex flex-col items-center">` with `<div className="flex flex-col">` (remove centering)
    - Conditionally hide the `<h2>` heading, the subtitle `<p>`, and the help `<button>` (wrap them in `{!compact && (...)}`)
    - Force `hideSkip` behavior (don't render the skip button) when `compact` is true
    - On the `<form>` element, change `className="w-full max-w-md mt-4"` to conditionally remove `max-w-md` and `mt-4` when compact: `className={compact ? "w-full" : "w-full max-w-md mt-4"}`
    - On the submit `<Button>`, conditionally hide the `<ArrowRight>` icon when compact (it's a save action, not navigation)
  - Notes: All existing callers pass no `compact` prop, so default `false` preserves current behavior.

- [x] Task 2: Add new imports and state variables to Dashboard
  - File: `dashboard/src/pages/Dashboard.tsx`
  - Action:
    - Add imports: `FRAMEWORKS` from `@/components/onboarding/frameworks`, `Copy`/`Check`/`ChevronRight`/`X` from lucide-react, `createPortal` from `react-dom`, `useEffect`/`useRef` (useEffect already imported), `timestampDate` from `@bufbuild/protobuf/wkt` (used in `ApiKeys.tsx` — follow the same pattern)
    - Add state: `selectedSessionId: string | null` (default `null`), `activeFramework: string` (default `FRAMEWORKS[0].id`), `copiedId: string | null` (default `null`), `confirmingDelete: boolean` (default `false`)
    - Add ref: `const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>(null)` for copy timeout cleanup
    - Keep `ToggleLeft`/`ToggleRight` imports — they are used for the stream toggle in the panel
    - Remove imports: `Pencil`, `Overlay`
    - Remove `editingStream` state and its type.

- [x] Task 3: Refactor `handleStreamSave` to accept explicit parameters
  - File: `dashboard/src/pages/Dashboard.tsx`
  - Action: Replace the current `handleStreamSave` function:
    ```typescript
    // Before: depends on editingStream state
    async function handleStreamSave(data: StreamDestinationData) {
      if (!editingStream) return;
      if (editingStream.dest) { /* update */ } else { /* create */ }
    }

    // After: explicit parameters, no dependency on removed state
    async function handleStreamSave(data: StreamDestinationData, existingDest?: StreamDestination) {
      if (existingDest) {
        await streamClient.updateStreamDestination({
          id: existingDest.id,
          name: data.name,
          platform: data.platform,
          rtmpUrl: data.rtmpUrl,
          streamKey: data.streamKey,
          enabled: existingDest.enabled,
        });
      } else {
        await streamClient.createStreamDestination({
          name: data.name,
          platform: data.platform,
          rtmpUrl: data.rtmpUrl,
          streamKey: data.streamKey,
          enabled: true,
        });
      }
      await refresh();
    }
    ```
  - Notes: Create-vs-update is determined by whether `existingDest` is passed. The panel calls it as `handleStreamSave(data, dest)` where `dest` comes from `getDestForSession(...)`. No more dependency on `editingStream` state. Also wrap `handleToggleStream` in try/catch (it currently has none — a network failure will throw unhandled). Same pattern as `handleDelete`'s existing `try { } catch { }` block.

- [x] Task 4: Replace card grid with compact list
  - File: `dashboard/src/pages/Dashboard.tsx`
  - Action: Replace the `<div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">` block and its card children with a vertical list. Each row is a clickable `<button>` with:
    - Left side: truncated session ID (`s.id.slice(0, 8)`) in monospace + status `Badge` (success for "running", warning otherwise)
    - Right side: stream destination platform badge (if `dest` exists, show `dest.platform` in a small `text-xs font-mono text-zinc-400 bg-white/[0.04] px-1.5 py-0.5 rounded` span) + `ChevronRight` icon in `text-zinc-600`
    - Add `type="button"` to the button element
    - Styling: `w-full flex items-center justify-between px-4 py-3 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:border-emerald-500/15 hover:bg-emerald-500/[0.02] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/50 transition-all cursor-pointer`
    - `onClick` sets `selectedSessionId` to `s.id`
  - Notes: Wrap list in `<div className="flex flex-col gap-2">`. Keep the empty state ("Welcome to Dazzle") unchanged.

- [x] Task 5: Build slide-over panel using `createPortal`
  - File: `dashboard/src/pages/Dashboard.tsx`
  - Action: When `selectedSessionId` is non-null, render via `createPortal` to `document.body`:
    - **Helper**: Create a `closePanel` function that sets `selectedSessionId` to `null` and `confirmingDelete` to `false`. Use this everywhere instead of calling `setSelectedSessionId(null)` directly. This ensures `confirmingDelete` is always reset on close (including when re-opening the same session).
    - **Backdrop**: `<div className="fixed inset-0 z-50 backdrop-blur-sm bg-zinc-950/80">` with `onClick` that checks `e.target === e.currentTarget` and calls `closePanel()`. Add `useEffect` for Escape key handler — copy the exact pattern from `overlay.tsx` (lines 13-18): register `keydown` listener when panel is open, clean up on unmount, depend on `closePanel` callback.
    - **Panel**: `<div className="fixed right-0 top-0 h-full w-[480px] max-w-full bg-zinc-900 border-l border-white/[0.06] overflow-y-auto p-6 z-50">` positioned inside the backdrop.
    - **Close button**: Absolute-positioned `X` icon top-right, calls `closePanel()`.
    - Look up selected session: `const selected = sessions.find(s => s.id === selectedSessionId)`. If `!selected`, call `closePanel()` in an effect and render nothing.
    - Look up dest: `const selectedIndex = sessions.findIndex(s => s.id === selectedSessionId); const dest = getDestForSession(selectedIndex);`

    **Panel Sections:**

    **Section 1 — Header** (top of panel):
    - Full session ID in `<code className="text-sm font-mono text-zinc-300 bg-white/[0.04] px-2 py-0.5 rounded">` + status `Badge`

    **Section 2 — Details** (`border-t border-white/[0.06] pt-4 mt-4`):
    - Label/value pairs for: Pod name (with `Cpu` icon), Direct port (with `Globe` icon), Created (`selected.createdAt ? timestampDate(selected.createdAt).toLocaleDateString() : "—"`), Last activity (same pattern: `selected.lastActivity ? timestampDate(selected.lastActivity).toLocaleDateString() : "—"`). Use `timestampDate` from `@bufbuild/protobuf/wkt` — same pattern as `ApiKeys.tsx`.

    **Section 3 — Stream Destination** (`border-t border-white/[0.06] pt-4 mt-4`):
    - Section label: "Stream destination" in `text-xs font-medium text-zinc-400 mb-3`
    - If `dest` exists: show platform + name + toggle button (use `ToggleRight`/`ToggleLeft` icons from lucide, call `handleToggleStream(dest)`, emerald when `dest.enabled`, zinc when disabled), then render `<StreamDestinationForm key={selectedSessionId} compact initial={{name: dest.name, platform: dest.platform, rtmpUrl: dest.rtmpUrl, streamKey: dest.streamKey}} submitLabel="Save" hideSkip onNext={(data) => { if (data) handleStreamSave(data, dest); }} />`
    - If no `dest`: render `<StreamDestinationForm key={selectedSessionId} compact submitLabel="Create" hideSkip onNext={(data) => { if (data) handleStreamSave(data); }} />`
    - **Important:** The `key={selectedSessionId}` prop is required to force the form to remount when switching between sessions. Without it, the form's `useState(initial?.name)` will retain stale values from the previous session because React initial state only applies at mount time.

    **Section 4 — Connect** (`border-t border-white/[0.06] pt-4 mt-4`):
    - Section label: "Connect" in `text-xs font-medium text-zinc-400 mb-3`
    - Tab bar: `<div className="flex gap-1 mb-3 overflow-x-auto">` with `FRAMEWORKS.map(fw => <button>)`. Active: `bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-md font-medium`. Inactive: `text-zinc-500 hover:text-zinc-300 text-xs px-2.5 py-1 rounded-md`.
    - Compute: `const mcpUrl = \`${window.location.origin}/mcp/${selectedSessionId}\``; `const activeFw = FRAMEWORKS.find(fw => fw.id === activeFramework) ?? FRAMEWORKS[0]`; `const snippet = activeFw.getSnippet(mcpUrl, "")`
    - Snippet block: `<div className="relative">` containing a `<pre className="font-mono text-sm text-zinc-300 bg-zinc-950/50 rounded-lg px-4 py-3 border border-white/[0.06] whitespace-pre-wrap overflow-x-auto">` and an absolute-positioned copy button top-right. Copy handler: clear any existing timeout via `copyTimeoutRef.current`, call `navigator.clipboard.writeText(snippet)`, set `copiedId` to `activeFw.id`, set `copyTimeoutRef.current = setTimeout(() => setCopiedId(null), 2000)`. Show `Check` icon when `copiedId === activeFw.id`, else `Copy` icon. Add cleanup: `useEffect(() => () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); }, [])` to prevent state updates after panel unmount.

    **Section 5 — Danger Zone** (`border-t border-red-500/10 pt-4 mt-6`):
    - If `!confirmingDelete`: `<Button variant="ghost" size="sm" className="text-zinc-500 hover:text-red-400 hover:bg-red-500/10" onClick={() => setConfirmingDelete(true)}>` with `Trash2` icon + "Delete endpoint"
    - If `confirmingDelete`: Show warning text "Delete this endpoint? This will terminate the running session." + two buttons: "Cancel" (resets `confirmingDelete` to false) and "Delete" (calls `closePanel()` first to close the panel immediately, then `handleDelete(selectedSessionId)` — close before async delete so the user doesn't see a stale panel during the RPC call).

- [x] Task 6: Remove old card grid JSX and modal overlay
  - File: `dashboard/src/pages/Dashboard.tsx`
  - Action: Remove the `<Overlay open={!!editingStream}>` block and all remaining `setEditingStream` calls. Remove `Overlay` import. Remove old card JSX (already replaced in Task 4). Remove `editingStream` state (already done in Task 2).
  - Notes: This is cleanup of references that should already be gone from Tasks 2-5. Verify no dangling references remain.

### Acceptance Criteria

- [ ] AC 1: Given the endpoints page with 1+ sessions, when the page loads, then sessions are displayed as a compact vertical list (not a card grid), each showing truncated session ID, status badge, and stream platform if configured.
- [ ] AC 2: Given the endpoint list, when a user clicks a row, then a slide-over panel opens from the right showing that session's full details (ID, status, pod, port, timestamps).
- [ ] AC 3: Given the slide-over panel is open, when the user presses Escape or clicks the backdrop, then the panel closes.
- [ ] AC 4: Given the slide-over panel, when viewing the "Connect" section, then framework tabs are displayed and clicking a tab shows that framework's CLI snippet with the session's real UUID filled into the MCP URL.
- [ ] AC 5: Given a framework snippet is displayed, when the user clicks the copy button, then the snippet is copied to clipboard and the button shows a checkmark for 2 seconds.
- [ ] AC 6: Given the slide-over panel with no stream destination configured, when the user fills in the stream destination form and clicks Create, then the destination is created and the panel refreshes to show it.
- [ ] AC 7: Given the slide-over panel with an existing stream destination, when the user edits the form and clicks Save, then the destination is updated.
- [ ] AC 8: Given the slide-over panel, when the user clicks "Delete endpoint", then a confirmation prompt appears. Clicking "Delete" deletes the session and closes the panel. Clicking "Cancel" dismisses the prompt.
- [ ] AC 9: Given no active sessions, when the page loads, then the "Welcome to Dazzle" empty state is shown unchanged.
- [ ] AC 10: Given a narrow viewport (< 480px), when the panel is open, then the panel does not overflow horizontally (uses `max-w-full`).

## Additional Context

### Dependencies

- No new npm packages needed — all imports (`FRAMEWORKS`, `StreamDestinationForm`, `Badge`, `Button`, Lucide icons, `createPortal`) are already in the project.
- No backend changes — uses existing `sessionClient`, `streamClient` RPC methods.

### Testing Strategy

- No automated test suite exists in the dashboard. Manual testing:
  1. Load endpoints page with 0 sessions → verify empty state unchanged
  2. Load with 1+ sessions → verify list layout renders correctly
  3. Click a row → verify slide-over opens with correct session data
  4. Verify timestamps show formatted dates or "—" for undefined
  5. Switch framework tabs → verify snippet updates with correct session UUID
  6. Click copy → verify clipboard contains correct snippet with real UUID
  7. Create stream destination from panel (no existing dest) → verify it saves
  8. Edit existing stream destination from panel → verify update works
  9. Toggle stream on/off from panel → verify toggle works
  10. Click Delete → verify confirmation appears → click Cancel → verify nothing deleted
  11. Click Delete → click Delete again in confirmation → verify session removed and panel closes
  12. Press Escape / click backdrop → verify panel closes
  13. Resize browser to < 480px with panel open → verify no horizontal overflow

### Notes

- The `getDestForSession` round-robin logic means session-to-destination mapping depends on array index. If sessions are reordered (e.g., one is deleted), mappings shift. This is pre-existing behavior and out of scope to fix, but should be tracked as a follow-up.
- Tab state (`activeFramework`) persists across panel open/close at the Dashboard level so the user's preferred framework stays selected.
- `StreamDestinationForm` in compact mode strips its heading/subtitle/help but preserves all field behavior, validation, and the submit button. The `compact` prop defaults to `false` so no existing callers are affected.
- Error handling for RPC calls (stream save, toggle, delete) inherits the existing silent-catch behavior. Improving error feedback (toasts, inline errors) is a follow-up concern.

## Review Notes
- Adversarial review completed
- Findings: 11 total, 5 fixed, 4 skipped (out of scope / matches spec), 1 undecided, 1 already addressed
- Resolution approach: auto-fix
- Fixed: F1 (handleStreamSave try/catch), F3 (body scroll lock), F4 (clipboard error handling), F5 (close panel on session disappear), F8 (reset copiedId on tab switch)
- Skipped: F2 (pre-existing round-robin, out of scope), F7 (undecided — edit discoverability), F10 (save feedback out of scope), F11 (timestamps match spec)
