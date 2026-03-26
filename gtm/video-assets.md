# GTM Video Assets

Demo recordings from [stream-examples](https://github.com/dazzle-labs/stream-examples), captured via Dazzle stage HLS streams using FFmpeg.

## showcase-grid-15s.mp4

15-second 2x3 grid of all demos playing simultaneously with a 3D CSS camera orbit. 1280x720 @ 30fps. Designed as a background layer for promotional video (overlay your talking head on top).

## clips/

Best segments extracted from each 90-second raw recording. Each clip is 8-15 seconds, CRF 18, no audio.

| Clip | Source | Description |
|------|--------|-------------|
| `hello-world_go-live.mp4` | hello-world 35-50s | "Go Live" green glow scene |
| `hello-world_particles-title.mp4` | hello-world 58-73s | "Hello, World" with particle field |
| `hello-world_how-it-works.mp4` | hello-world 15-30s | Your Code > dazzle sync > Cloud Renderer > Broadcast |
| `hello-world_terminal.mp4` | hello-world 72-87s | Full CLI workflow being typed |
| `hyperstructure_dense-geometry.mp4` | hyperstructure 30-45s | Dense colorful GPU shader geometry |
| `hyperstructure_opening.mp4` | hyperstructure 0-15s | Rainbow floor with floating shapes |
| `hyperstructure_close-up.mp4` | hyperstructure 60-75s | Tight psychedelic close-up |
| `club-claude_spotlights.mp4` | club-claude 0-15s | 3D club scene, sweeping spotlights |
| `club-claude_wide-angle.mp4` | club-claude 55-70s | Wider camera angle |
| `remotion-stream_signal-text.mp4` | remotion-stream 0-15s | "THE SIGNAL IS THE SHOW" text typing |
| `remotion-stream_orbital-nodes.mp4` | remotion-stream 25-40s | Orbital node visualization |
| `remotion-stream_frame-counter.mp4` | remotion-stream 38-46s | "27,262 FRAMES RENDERED" counter |
| `live-wikipedia-edits_active-clusters.mp4` | wikipedia 20-35s | Globe with bright edit clusters |
| `live-wikipedia-edits_steady-state.mp4` | wikipedia 50-65s | Alternate cluster pattern |
| `claude-code-stream_scrolling.mp4` | claude-code-stream 0-15s | Claude Code event log scrolling |

## showcase/

HTML source for the 3D grid. Six videos in a 2x3 grid with CSS perspective animation that orbits slowly. Runs on a Dazzle stage or any browser at 1280x720.

Grid layout:
```
[hyperstructure]  [remotion-signal]  [club-claude]
[hello-world]     [wikipedia]        [claude-code]
```

To re-record: sync `showcase/` to a Dazzle stage, then capture the HLS stream with FFmpeg.

## How these were made

1. Each example from stream-examples was synced to a Dazzle stage (`dazzle stage sync`)
2. 90 seconds of each stage's HLS stream was recorded (`ffmpeg -i .../index.m3u8 -t 90`)
3. Contact sheets were generated (1 frame per 5 seconds) and visually audited
4. Best segments were extracted as individual clips
5. The showcase HTML was built and synced to its own stage
6. The grid was recorded from the stage's HLS stream and trimmed to 15 seconds
