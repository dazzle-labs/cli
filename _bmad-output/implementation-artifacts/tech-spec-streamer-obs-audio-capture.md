---
title: 'Enable Audio Capture in Streamer OBS'
slug: 'streamer-obs-audio-capture'
created: '2026-03-04'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['PulseAudio (module-null-sink)', 'OBS Studio 32.0.2 (scene collection JSON)', 'gobs-cli (runtime control)', 'Bash (entrypoint.sh heredoc)']
files_to_modify: ['streamer/docker/entrypoint.sh', 'streamer/docker/pulse-default.pa']
code_patterns: ['OBS scene collection JSON pre-baked inline via heredoc in entrypoint.sh', 'Sources array with id/versioned_id/uuid/mixers/settings structure', 'xshm_input uses mixers:0 (video-only), audio sources need mixers:255']
test_patterns: ['No automated tests — manual verification via SSH + gobs-cli + stream platform']
---

# Tech-Spec: Enable Audio Capture in Streamer OBS

**Created:** 2026-03-04

## Overview

### Problem Statement

The streamer pod has PulseAudio running with a virtual null sink (`virtual_out`) and Chrome configured to output audio to it, but OBS has no audio input source configured. Chrome's Web Audio API output (procedural music, sound effects, etc.) is generated correctly but never reaches the OBS stream because OBS only captures the X11 screen (video-only via `xshm_input`).

### Solution

Add a PulseAudio output capture source to the pre-baked OBS scene collection JSON in `entrypoint.sh` so OBS captures audio from the virtual sink's monitor output. This requires adding a `pulse_output_capture` source (desktop audio — captures what plays on a sink) with `device_id: "virtual_out.monitor"` and `mixers: 255` to route audio into the stream output. Also align the PulseAudio null sink sample rate with OBS (48kHz) to avoid unnecessary resampling.

### Scope

**In Scope:**
- Add PulseAudio audio capture source to OBS scene collection JSON in entrypoint.sh
- Configure mixer routing so the audio source feeds into the stream output
- Verify `gobs-cli` can see and control the new audio input at runtime

**Out of Scope:**
- HLS preview audio (ffmpeg x11grab pipeline — separate concern; note: HLS preview will remain video-only after this change)
- Audio level metering UI in the web dashboard
- Per-scene audio mixing or volume automation
- Changes to Chrome launch flags (already correct)
- A/V sync tuning (OBS `sync` field defaults to 0; adjust post-deploy if needed)
- PulseAudio health monitoring (PA crash silently kills audio with no error signal)

## Context for Development

### Codebase Patterns

- OBS scene collection is a JSON blob written inline in `entrypoint.sh` via heredoc (lines 142-198)
- The JSON follows OBS's internal scene collection format with `sources`, `current_scene`, etc.
- Each source has: `id`, `versioned_id`, `name`, `uuid`, `enabled`, `flags`, `volume`, `mixers`, `muted`, `settings`
- Currently two sources: `xshm_input` (video capture, uuid `...0001`) and `scene` (container, uuid `...0002`)
- `xshm_input` has `"mixers": 0` — this means it contributes no audio to the output mixer
- PulseAudio virtual sink is named `virtual_out` (in `pulse-default.pa`), monitor source is `virtual_out.monitor`
- Chrome outputs to virtual sink via `PULSE_SERVER=unix:/tmp/pulse/native` env var
- Chrome has `--autoplay-policy=no-user-gesture-required` — Web Audio API works without user interaction
- Process startup order: Xvfb → PulseAudio → Node.js → Chrome → OBS (PulseAudio is ready before Chrome and OBS)

### Files to Reference

| File | Purpose | Key Lines |
| ---- | ------- | --------- |
| `streamer/docker/entrypoint.sh` | Pre-bakes OBS scene collection JSON, launches all processes | 142-198 (scene JSON), 99-139 (OBS config) |
| `streamer/docker/pulse-default.pa` | PulseAudio config — defines `virtual_out` null sink | 4-5 (sink definition) |
| `streamer/docker/Dockerfile` | Installs PulseAudio, sets PULSE_SERVER env | 10 (apt install), 70 (copy PA config), 76-77 (env vars) |

### Technical Decisions

- **Pre-baked vs runtime**: Adding the audio source to the scene collection JSON (pre-baked) is more reliable than trying to create it at runtime via gobs-cli, which fails with `InvalidInputKind (605)` errors for all PulseAudio capture kinds.
- **Source type**: Use `pulse_output_capture` (not `pulse_input_capture`). Both exist in `linux-pulseaudio.so`, but `pulse_output_capture` is OBS's "Desktop Audio" kind — semantically correct for capturing a sink's monitor output. `pulse_input_capture` is for microphone/input devices. Confirmed via binary inspection on the running pod. No version suffix needed.
- **Settings key**: Use `device_id` (not `device`) — confirmed from the plugin binary.
- **Device name**: `virtual_out.monitor` — confirmed via `pactl list sources short` on the running pod (source 0, s16le 2ch 44100Hz, IDLE state).
- **Mixer assignment**: The audio source needs `"mixers": 255` (all mixer channels) to feed into the stream output. The `xshm_input` stays at `"mixers": 0` (video-only).
- **UUID**: Use `00000000-0000-0000-0000-000000000003` to follow the existing sequential pattern.
- **Monitoring type**: Set `"monitoring_type": 0` (monitor off) to prevent feedback — audio goes to stream output only.
- **Omitted fields**: OBS 32.x adds many fields to sources on load (`prev_ver`, `sync`, `balance`, `push-to-mute`, `hotkeys`, `deinterlace_mode`, `private_settings`, etc.). These can be safely omitted — OBS fills defaults. The existing `xshm_input` in the entrypoint also omits them and OBS handles it correctly (verified from real OBS export on running pod).
- **Heredoc constraint**: The `SCENEJSON` heredoc is unquoted (to allow `${SCREEN_WIDTH}/${SCREEN_HEIGHT}` expansion). The audio source JSON must not contain `$`, backticks, or `!` characters. The `device_id: "virtual_out.monitor"` value is safe.
- **Audio encoder**: OBS uses `libfdk_aac` at 160kbps stereo (confirmed from OBS stream logs). No profile changes needed.

## Implementation Plan

### Tasks

- [x] Task 1: Set PulseAudio null sink sample rate to 48kHz to match OBS
  - File: `streamer/docker/pulse-default.pa`
  - Action: Add `rate=48000 channels=2` to the `module-null-sink` load line:
    ```
    load-module module-null-sink sink_name=virtual_out rate=48000 channels=2 sink_properties=device.description="VirtualOutput"
    ```
  - Notes: Avoids unnecessary 44100→48000 resampling on every audio frame. OBS audio is 48kHz stereo (confirmed from logs).

- [x] Task 2: Add `pulse_output_capture` source to OBS scene collection JSON
  - File: `streamer/docker/entrypoint.sh`
  - Action: In the `sources` array (after the `xshm_input` object, before the `scene` object), insert a new source object:
    ```json
    {
        "id": "pulse_output_capture",
        "versioned_id": "pulse_output_capture",
        "name": "Audio",
        "uuid": "00000000-0000-0000-0000-000000000003",
        "enabled": true,
        "flags": 0,
        "volume": 1.0,
        "mixers": 255,
        "muted": false,
        "monitoring_type": 0,
        "settings": {
            "device_id": "virtual_out.monitor"
        }
    }
    ```
  - Notes: Use `pulse_output_capture` (Desktop Audio), not `pulse_input_capture` (Mic/Aux). Must add a comma after the closing `}` of the `xshm_input` source object. OBS fills missing fields (`prev_ver`, `sync`, `balance`, `push-to-mute`, etc.) with defaults on load — safe to omit. The `scene` source object does not need changes — the audio source is a global input routed via mixer, not a scene item. Ensure no `$` or backtick characters in the JSON (unquoted heredoc).

- [ ] Task 3: Build and deploy the updated streamer image
  - Action: Run `make build-streamer`, then create a new stage or delete/recreate an existing streamer pod to pick up the new image.
  - Notes: Existing streamer pods continue running with old config. `make deploy` restarts the control-plane, not streamer pods. Only newly created pods will have the audio source.

- [ ] Task 4: Verify audio capture is working
  - Action: After a new streamer pod starts, use `gobs-cli i ls` (via dazzle MCP `obs` tool) to confirm the "Audio" input appears with `pulse_output_capture` kind. Then use `set_script` to play Web Audio API content and verify audio is present on the stream output (check via stream platform).

### Acceptance Criteria

- [ ] AC 1: Given a newly started streamer pod, when OBS loads its scene collection, then `gobs-cli i ls` shows an input named "Audio" with kind `pulse_output_capture` (not muted).
- [ ] AC 2: Given a streamer pod with the Audio input loaded, when a `set_script` plays Web Audio API output (e.g., an oscillator tone), then the audio is present in the OBS stream output (audible on the streaming platform, no crackling or distortion).
- [ ] AC 3: Given a streamer pod with the Audio input loaded, when `gobs-cli i m Audio` is run, then the audio input is muted and no audio reaches the stream output.
- [ ] AC 4: Given the existing `xshm_input` screen capture source, when the Audio input is added, then video capture continues to work unchanged (no regression).
- [ ] AC 5: Given a streamer pod with the Audio input loaded, when no Chrome audio is playing (silence), then OBS encodes silent audio frames (no source errors or disconnections).

## Additional Context

### Dependencies

- PulseAudio must be running before OBS starts (already enforced in entrypoint.sh startup order)
- The virtual sink name `virtual_out` must match between `pulse-default.pa` and the OBS source config
- `linux-pulseaudio.so` OBS plugin must be installed (already present in the Docker image)

### Testing Strategy

- **Automated**: None (no test suites in this project)
- **Manual verification**:
  1. `make build-streamer` — confirm build succeeds
  2. Create a new stage (or restart an existing streamer pod)
  3. `gobs-cli i ls` via dazzle MCP — confirm "Audio" input appears
  4. `set_script` with a simple Web Audio oscillator tone
  5. Start streaming to a test destination and verify audio is audible
  6. `gobs-cli i m Audio` / `gobs-cli i um Audio` — verify mute/unmute works
  7. Take screenshot — verify video is unaffected

### Notes

- The `gobs-cli input create` command fails with `InvalidInputKind (605)` for PulseAudio capture kinds when called at runtime. Root cause unclear (could be gobs-cli or OBS WebSocket plugin registration). Pre-baking in the scene collection JSON bypasses this entirely. Runtime control (mute/unmute/volume) via gobs-cli should still work once the source is loaded.
- OBS uses `libfdk_aac` encoder at 160kbps stereo for streaming (confirmed from OBS stream logs). No profile changes needed.
- The audio source is a global OBS input (routed via mixer channels), not a scene item. It does not need to be added to the scene's `items` array — only to the top-level `sources` array.
- **HLS preview discrepancy**: After this change, OBS streams will have audio but the HLS preview pipeline (ffmpeg x11grab) will remain video-only. This is expected — do not debug "missing audio" against HLS.
- **PulseAudio double module load**: `pulse-default.pa` and the `--load=` CLI arg in entrypoint.sh both load `module-native-protocol-unix` on the same socket. PulseAudio silently ignores the duplicate. Pre-existing, not addressed in this spec.
- **Silent behavior**: When Chrome produces no audio, the PulseAudio monitor source remains in IDLE state and OBS receives silence frames. This is correct behavior — no errors or disconnections.
