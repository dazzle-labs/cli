# StageRuntime CDP Domain

Custom Chrome DevTools Protocol domain for stage-runtime. These commands are sent through the same CDP pipe as standard commands, using the session ID from `Target.attachToTarget`.

## Commands

### `StageRuntime.setOutputs`

Configure RTMP output destinations. Replaces the current output list. Empty list stops transmitting.

**Request:**
```json
{
  "id": 123,
  "sessionId": "...",
  "method": "StageRuntime.setOutputs",
  "params": {
    "outputs": [
      { "name": "twitch", "url": "rtmp://live.twitch.tv/app/...", "watermarked": true },
      { "name": "ingest", "url": "rtmp://ingest.dazzle.fm/live/...", "watermarked": false }
    ]
  }
}
```

**Response:**
```json
{ "id": 123, "sessionId": "...", "result": {} }
```

**Behavior:**
- Diffs current vs requested outputs — only restarts changed destinations
- `watermarked: true` renders "dazzle.fm" text overlay (bottom-right, 40% opacity)
- Empty `outputs` array stops all transmitting
- Invalid RTMP URLs return an error response

### `StageRuntime.getStats`

Get renderer statistics.

**Request:**
```json
{ "id": 124, "sessionId": "...", "method": "StageRuntime.getStats", "params": {} }
```

**Response:**
```json
{
  "id": 124,
  "sessionId": "...",
  "result": {
    "renderFps": 30,
    "encodeFps": 30,
    "droppedFrames": 0,
    "totalBytes": 1234567,
    "frameCount": 900,
    "uptimeMs": 30000
  }
}
```

## Standard CDP Commands Supported

| Command | Notes |
|---------|-------|
| `Target.setDiscoverTargets` | Returns immediately |
| `Target.getTargets` | Returns one page target |
| `Target.createTarget` | Returns existing target ID |
| `Target.attachToTarget` | Returns session ID, starts frame loop |
| `Runtime.enable` | Enables console event emission |
| `Log.enable` | Enables log event emission |
| `Runtime.evaluate` | Evaluates JS in V8, returns CDP-formatted result |
| `Page.navigate` | Reloads content from disk (URL → filesystem path) |
| `Page.captureScreenshot` | Returns base64 PNG of current framebuffer |

## Events Emitted

| Event | When |
|-------|------|
| `Runtime.consoleAPICalled` | JS calls console.log/warn/error |
| `Target.attachedToTarget` | After Target.attachToTarget |
