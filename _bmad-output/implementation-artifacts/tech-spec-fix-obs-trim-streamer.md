---
title: 'Fix OBS Crash and Trim Streamer Container'
slug: 'fix-obs-trim-streamer'
created: '2026-03-02'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['OBS Studio 30.2.3', 'Ubuntu 22.04', 'Xvfb', 'PulseAudio', 'bash', 'Node.js 20']
files_to_modify: ['docker/entrypoint.sh', 'docker/Dockerfile', 'docker/pulse-default.pa']
code_patterns: ['sequential service startup in entrypoint', 'heredoc config generation', 'OBS scene JSON as flat sources array with scenes as id:scene entries']
test_patterns: ['manual: make build-streamer deploy then verify via gobs CLI']
---

# Tech-Spec: Fix OBS Crash and Trim Streamer Container

**Created:** 2026-03-02

## Overview

### Problem Statement

OBS Studio crashes immediately after startup in the streamer pod with `terminate called after throwing an instance of 'std::logic_error' — what(): basic_string::_M_construct null not valid`. This happens because the pre-baked scene collection JSON (`Untitled.json`) has a malformed structure that causes OBS to dereference a null pointer when constructing internal strings. Additionally, missing environment setup (`XDG_RUNTIME_DIR`, dbus) causes secondary errors. The container also still ships ffmpeg which is no longer needed since OBS handles streaming.

### Solution

1. Fix the OBS scene collection JSON to use the correct OBS 30.x format so it loads without crashing.
2. Set up `XDG_RUNTIME_DIR` and dbus in the entrypoint to eliminate environment errors.
3. Remove ffmpeg from the Dockerfile since OBS replaces it for streaming.

### Scope

**In Scope:**
- Fix OBS scene collection JSON structure to prevent the null string crash
- Add `XDG_RUNTIME_DIR` and dbus session bus setup to entrypoint
- Remove ffmpeg from `docker/Dockerfile`
- Ensure OBS WebSocket (port 4455) stays up after startup

**Out of Scope:**
- Changing the OBS streaming configuration (RTMP keys, encoding settings)
- Modifying `server/index.js` (already clean, no ffmpeg code)
- Adding new features to OBS setup
- Changing session-manager Go code

## Context for Development

### Codebase Patterns

- Streamer pod entrypoint is a sequential bash script starting services one by one
- OBS config is pre-baked via heredocs in entrypoint.sh
- OBS 30.x scene collection format: flat `"sources"` array where scenes are entries with `"id": "scene"` — no top-level `"scenes"` key
- Scene items live inside `scene.settings.items`, not in a separate structure
- Builds happen remotely via `make build-streamer` (SSH + buildkit)
- `imagePullPolicy: Never` — image must be pre-loaded on node

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `docker/entrypoint.sh` | Streamer pod entrypoint — starts Xvfb, PulseAudio, Chrome, OBS, Node. OBS scene JSON heredoc (lines 108-141) is the crash source. |
| `docker/Dockerfile` | Streamer image build — installs all deps. Missing `dbus-x11`, has unused `ffmpeg`. |
| `docker/pulse-default.pa` | PulseAudio config — has stale ffmpeg comment, otherwise fine. |

### Technical Decisions

- Use `xshm_input` source type (X11 shared memory capture) — works with Xvfb without a window manager
- OBS WebSocket server: port 4455, no auth (matches existing global.ini config)
- Remove ffmpeg entirely — never invoked anywhere in codebase, OBS handles all capture/streaming
- Add `dbus-x11` package — provides `dbus-launch` needed by OBS for session bus
- Set `XDG_RUNTIME_DIR=/tmp/runtime-root` — eliminates Qt warning

## Implementation Plan

### Tasks

- [x] Task 1: Add `dbus-x11` and remove `ffmpeg` from Dockerfile
  - File: `docker/Dockerfile`
  - Action: In the first `apt-get install` block (lines 8-34), remove `ffmpeg \` and add `dbus-x11 \`
  - Notes: `dbus-x11` provides `dbus-launch` which OBS needs for session bus. `ffmpeg` is unused — OBS handles all capture/streaming.

- [x] Task 2: Add environment setup before OBS startup in entrypoint
  - File: `docker/entrypoint.sh`
  - Action: Before the OBS config section (line 70), add:
    - `export XDG_RUNTIME_DIR=/tmp/runtime-root && mkdir -p "$XDG_RUNTIME_DIR"` — eliminates Qt `XDG_RUNTIME_DIR not set` warning
    - `eval $(dbus-launch --sh-syntax)` — starts a dbus session bus so OBS can use D-Bus services
  - Notes: Must come after Xvfb is started but before OBS launches.

- [x] Task 3: Replace the malformed OBS scene collection JSON
  - File: `docker/entrypoint.sh`
  - Action: Replace the entire `Untitled.json` heredoc (lines 108-141) with a correct OBS 30.x scene collection. The key structural fixes:
    - Remove invalid top-level `"scenes"` array
    - Add the scene as a source entry with `"id": "scene"` in the `"sources"` array
    - Add required `"settings": { "custom_size": false, "id_counter": 1, "items": [...] }` to the scene source
    - Reference the xshm_input source by `"name": "Screen"` inside `items`
    - Add required source metadata fields (`versioned_id`, `flags`, `volume`, `mixers`, `muted`, etc.) to both source entries
    - Add required top-level fields (`"groups": []`, `"transitions": []`, `"transition_duration": 300`)
  - Notes: This is the root cause of the crash. OBS finds zero scenes because the `"scenes"` key is unrecognized, then crashes trying to get `current_scene` name from a null pointer.

- [x] Task 4: Update stale comment in pulse-default.pa
  - File: `docker/pulse-default.pa`
  - Action: Change comment on line 7 from `# Allow monitor source to be used by ffmpeg` to `# Allow monitor source to be used by OBS and other clients`
  - Notes: Cosmetic only, keeps docs accurate.

### Acceptance Criteria

- [ ] AC 1: Given a freshly deployed streamer pod, when the entrypoint runs, then OBS Studio starts without crashing and the `obs` process remains running (visible in `ps aux`).
- [ ] AC 2: Given OBS is running in the pod, when connecting to WebSocket port 4455, then the OBS WebSocket server responds (verified via `gobs st ss` or `nc -z localhost 4455`).
- [ ] AC 3: Given OBS is running with the xshm_input source, when the Xvfb display shows content, then the "Screen" source captures the display (verified via `gobs si ls` showing the Screen source in Scene).
- [ ] AC 4: Given the updated Dockerfile, when building the image, then `ffmpeg` is not installed and `dbus-launch` is available (verified via `which dbus-launch` succeeds and `which ffmpeg` fails inside the container).
- [ ] AC 5: Given the entrypoint sets `XDG_RUNTIME_DIR`, when OBS starts, then the `QStandardPaths: XDG_RUNTIME_DIR not set` warning does not appear in logs.

## Additional Context

### Dependencies

Adding: `dbus-x11` (provides `dbus-launch`). Removing: `ffmpeg`. Net change: ~neutral on image size.

### Testing Strategy

Manual verification after `make build-streamer deploy`:
1. Check pod logs for OBS startup without crash: `kubectl logs <pod> -n browser-streamer | grep -i obs`
2. Verify OBS WebSocket: `kubectl exec <pod> -- nc -z localhost 4455`
3. Verify OBS process alive: `kubectl exec <pod> -- pgrep obs`
4. Verify ffmpeg removed: `kubectl exec <pod> -- which ffmpeg` should fail
5. Verify dbus-launch present: `kubectl exec <pod> -- which dbus-launch` should succeed
6. End-to-end: use dazzle MCP `gobs st ss` to query stream status

### Notes

- The crash is a known OBS issue (GitHub #10682) — empty/missing scene names cause null pointer dereference in obs-websocket's nlohmann-json integration
- `xshm_input` works fine with Xvfb — no window manager needed for X11 shared memory capture
- The `window manager does not support EWMH` error only affects XComposite capture (which we don't use)
- OBS `--minimize-to-tray` flag is correct for headless operation

## Review Notes
- Adversarial review completed
- Findings: 12 total, 6 fixed, 3 skipped (undecided/noise), 3 skipped (pre-existing)
- Resolution approach: auto-fix
- Fixed: dbus-launch validation, XDG_RUNTIME_DIR permissions, dbus-daemon cleanup, stale CLAUDE.md docs, redundant dbus package, OBS crash detection during startup
