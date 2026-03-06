# Sprint Change Proposal — Dazzle UX & Reliability

**Date:** 2026-03-06
**Triggered by:** First-time user testing session (Conor, 2026-03-05)
**Scope Classification:** Moderate
**Status:** Approved

---

## 1. Issue Summary

Dazzle's first-time user experience has critical gaps in reliability, error handling, and onboarding flow. A real user testing session on 2026-03-05 took ~1 hour to reach the first successful end-to-end stream, with most of that time spent fighting the product rather than using it. The core value proposition — AI agents driving live streams via MCP — was validated ("Yeah!!! WOOOOOOO"), but the path to get there required developer hand-holding and platform-side intervention.

### Evidence

- Stage stuck on "starting" with no feedback, silently reverting to "inactive"
- API returned "stage disappeared" while dashboard showed "starting"
- No back button in onboarding wizard
- "New to this" option was a dead end
- Stream key concept presented without explanation
- Stage wouldn't start without a stream destination configured
- Scripts cleared on stage stop with no warning
- MCP-per-stage requires reconfiguration and session restart to switch stages
- Platform deploy mid-session was invisible to the user

---

## 2. Impact Analysis

### Epic/Area Impact

| Area | Impact | Severity |
|------|--------|----------|
| Control Plane (Go) | Stage lifecycle reliability, error propagation, script persistence | High |
| Web (React) | Onboarding flow, error states, progress indicators | Medium |
| Streamer (Node.js) | Script restoration on restart | Medium |
| MCP Architecture | Per-stage vs platform-wide design decision | Low (deferred) |
| K8s / Infra | Health check and readiness probe tuning | Low |

### Artifact Conflicts

- **PRD:** No conflict. Execution gaps, not vision problems.
- **Architecture:** MCP endpoint design is the only architectural tension (deferred). Script persistence needs a storage decision.
- **UI/UX:** Additive improvements only, no conflicts.
- **Infra:** K8s probes and observability gaps worth reviewing.

---

## 3. Recommended Approach

**Direct Adjustment** — fix within current architecture, defer MCP redesign.

### Rationale

- 4 of 5 issues are fixable within the current architecture
- Recent commits (`ac0b1b1` per-stage mutex, `a021097` optional destinations) show momentum in the right direction
- No strategic pivot needed — the product vision is validated
- MCP architecture decision deserves its own focused design discussion
- Highest ROI: stage reliability removes the biggest blocker with least risk

### Effort & Risk

| Priority | Issue | Effort | Risk |
|----------|-------|--------|------|
| P0 | Stage reliability + error messaging | Medium | Low |
| P1 | Destination-free streaming (finish) | Low | Low |
| P2 | Onboarding flow fixes | Low | Low |
| P3 | Script persistence on stop/restart | Medium | Low |
| Deferred | MCP platform-wide vs per-stage | High | Medium |

---

## 4. Detailed Change Proposals

### P0: Stage Reliability + Error Messaging

**Area:** `control-plane/`

**Current behavior:** Stage goes to "starting," hangs indefinitely, silently reverts to "inactive." API returns "stage disappeared" while dashboard shows "starting." No error messages, no progress indicators, no timeout feedback.

**Changes:**
1. Add explicit timeout for stage activation (~60s) with meaningful error returned to both API and dashboard
2. Fix dashboard/API status consistency — single source of truth for stage state
3. Surface pod-level errors (ImagePullBackOff, CrashLoopBackOff, resource limits) as human-readable messages in status response
4. Add `stage_error` or `last_error` field to the status endpoint

---

### P1: Destination-Free Streaming

**Area:** `control-plane/` + `web/`

**Current behavior:** Starting without a destination returns an error. Commit `a021097` made destinations optional but the error still appeared during testing.

**Changes:**
1. Verify `a021097`'s optional destination logic works end-to-end
2. Ensure preview and screenshot tools work without an active stream output
3. Let users skip the destination step in onboarding with clear messaging
4. Move stream destination setup to a post-onboarding "Go Live" step

---

### P2: Onboarding Flow Fixes

**Area:** `web/src/components/onboarding/`

**Current behavior:** No back button, "New to this" is a dead end, sign-in button anchors to page bottom, stream key presented without explanation, no loading/error states.

**Changes:**
1. Add back navigation to each wizard step
2. Fix "New to this" path — explanatory flow or docs link
3. Fix sign-in button navigation
4. Add contextual help for stream key / RTMP with platform-specific guides
5. Add loading/progress state for stage provisioning
6. Add error states with retry options

---

### P3: Script Persistence on Stop/Restart

**Area:** `control-plane/` + `streamer/`

**Current behavior:** Stopping a stage clears the script. Restarting requires manual re-set.

**Changes:**
1. Control-plane stores last `set_script` content associated with the stage
2. On stage start, restore previous script automatically
3. Add explicit `clear_script` tool or flag — stop should not imply clear
4. Return `script_restored` status in the start response

---

### Deferred: MCP Platform-Wide vs Per-Stage

**Current behavior:** Each stage has its own MCP endpoint. Switching requires reconfiguration and session restart.

**Options for future design discussion:**
- **Option A (recommended):** Platform-wide MCP with `select_stage` / `list_stages` tools
- **Option B:** Keep per-stage, reduce friction around switching

Deferred because it changes the API contract and needs deliberate design.

---

## 5. Implementation Handoff

**Scope classification: Moderate** — requires coordinated changes across control-plane, web, and streamer, but no architectural redesign.

### Responsibilities

| Role | Responsibility |
|------|---------------|
| Dev team | Implement P0-P3 changes |
| Product | Validate onboarding flow changes match user expectations |
| Architect | Lead deferred MCP design discussion separately |

### Success Criteria

- A new user can go from sign-up to seeing a rendered script in under 5 minutes without developer assistance
- Stage startup failures surface clear, actionable error messages
- Scripts survive stage stop/start cycles
- Stream destinations are optional for development and preview use cases

### Suggested Sequence

1. P0 (stage reliability) — unblocks everything
2. P1 (destination-free) — removes setup barrier
3. P2 (onboarding) — polish once core works
4. P3 (script persistence) — quality of life
5. MCP design discussion — separate track
