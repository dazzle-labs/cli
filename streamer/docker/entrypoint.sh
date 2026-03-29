#!/usr/bin/env bash
set -euo pipefail

CHROME_PID=""
RENDER_PID=""
PULSE_PID=""
XVFB_PID=""

cleanup() {
    echo "Shutting down..."
    [ -n "$CHROME_PID" ] && kill "$CHROME_PID" 2>/dev/null || true
    [ -n "$RENDER_PID" ] && kill "$RENDER_PID" 2>/dev/null || true
    [ -n "$PULSE_PID" ] && kill "$PULSE_PID" 2>/dev/null || true
    [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null || true
    wait
    echo "All processes stopped."
}
trap cleanup EXIT INT TERM

# Screen resolution (default 1280x720)
SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-720}"

RENDERER="${RENDERER:-chrome}"

# CDP pipes: shared between streamer and sidecar containers via a volume.
CDP_PIPE_IN="${CDP_PIPE_IN:-/tmp/cdp/in}"
CDP_PIPE_OUT="${CDP_PIPE_OUT:-/tmp/cdp/out}"

if [ "$RENDERER" = "native" ]; then
    # --- native mode: stage-runtime replaces Xvfb + PulseAudio + Chrome ---
    # Create CDP FIFOs for sidecar communication
    mkdir -p "$(dirname "$CDP_PIPE_IN")"
    rm -f "$CDP_PIPE_IN" "$CDP_PIPE_OUT"
    mkfifo "$CDP_PIPE_IN" "$CDP_PIPE_OUT"
    chmod 666 "$CDP_PIPE_IN" "$CDP_PIPE_OUT"

    # Wait for sidecar to be healthy
    LOCAL_PORT="${LOCAL_HTTP_PORT:-8080}"
    echo "Waiting for sidecar on port $LOCAL_PORT..."
    for i in $(seq 1 120); do
        if curl -s "http://localhost:$LOCAL_PORT/_dz_9f7a3b1c/health" > /dev/null 2>&1; then
            echo "Sidecar ready."
            break
        fi
        sleep 0.5
    done

    echo "Starting stage-runtime (${SCREEN_WIDTH}x${SCREEN_HEIGHT})..."
    mkdir -p /data/content
    /stage-runtime \
        --content-dir /data/content \
        --data-dir /data \
        --cdp-pipe-in "$CDP_PIPE_IN" \
        --cdp-pipe-out "$CDP_PIPE_OUT" \
        --width "$SCREEN_WIDTH" \
        --height "$SCREEN_HEIGHT" &
    RENDER_PID=$!

    mkdir -p /tmp/hls
    echo "stage-runtime started. Waiting..."
    wait -n
    echo "A process exited, shutting down."
    exit 0
fi

# --- Chrome mode (default) ---

# Chrome policy flags — set via CHROME_FLAGS env var from the k8s deployment.
# Runtime flags (display, data dir, window size, CDP) are appended below.
if [ -z "${CHROME_FLAGS:-}" ]; then
    echo "ERROR: CHROME_FLAGS env var is required (set RENDERER=native to use stage-runtime)"
    exit 1
fi

# Strip runtime flags that may be left over from legacy CHROME_FLAGS values.
# These are now managed by the entrypoint/stage-start scripts, not the env var.
strip_runtime_flags() {
    echo "$1" | sed -E \
        -e 's/--display=:[0-9]+//g' \
        -e 's/--user-data-dir=[^ ]+//g' \
        -e 's/--window-size=[^ ]+//g' \
        -e 's/--window-position=[^ ]+//g' \
        -e 's/--remote-debugging-port=[0-9]+//g' \
        -e 's/--remote-debugging-address=[^ ]+//g' \
        -e 's/  +/ /g' -e 's/^ +//' -e 's/ +$//'
}
CHROME_FLAGS="$(strip_runtime_flags "$CHROME_FLAGS")"

# Append per-instance runtime flags
CHROME_FLAGS="$CHROME_FLAGS --display=:99 --user-data-dir=/data/chrome"
CHROME_FLAGS="$CHROME_FLAGS --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} --window-position=0,0"
CHROME_FLAGS="$CHROME_FLAGS --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1"

# Renderer config (SwiftShader.ini) is mounted from the swiftshader-ini ConfigMap.
# Controls thread count for software rendering. Entrypoint ensures the dir exists.
mkdir -p /data/chrome
echo "Renderer config:"
cat /data/chrome/SwiftShader.ini 2>/dev/null || echo "  (not mounted — using defaults)"

# 1. Start display server — prefer Xorg dummy driver at 30Hz (Chrome syncs rAF to
# display refresh rate, halving rendering work). Fall back to Xvfb if unavailable.
if [ -x /usr/bin/Xorg ] && [ -f /etc/X11/xorg-dummy.conf ]; then
    echo "Starting Xdummy (${SCREEN_WIDTH}x${SCREEN_HEIGHT} @ 30Hz)..."
    Xorg :99 -noreset +extension GLX +extension RANDR \
        -config /etc/X11/xorg-dummy.conf -nolisten tcp -ac vt1 2>/dev/null &
    XVFB_PID=$!
else
    echo "Starting Xvfb (${SCREEN_WIDTH}x${SCREEN_HEIGHT})..."
    Xvfb :99 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24 -ac +extension GLX +render -noreset &
    XVFB_PID=$!
fi

# 2. Start PulseAudio (can start in parallel with Xvfb settling)
echo "Starting PulseAudio..."
mkdir -p /tmp/pulse
pulseaudio --daemonize --no-cpu-limit --system=false \
    --exit-idle-time=-1 \
    --load="module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulse/native"
PULSE_PID=$(pgrep -f pulseaudio || true)

# Brief wait for Xvfb display to be ready
sleep 0.3

# Verify GLX is working
echo "Verifying GLX extension..."
for i in $(seq 1 10); do
    if glxinfo -B 2>/dev/null | grep -q "OpenGL version"; then
        echo "✓ GLX verified and working."
        break
    fi
    if [ $i -eq 10 ]; then
        echo "⚠ GLX verification inconclusive (may still work)"
    fi
    sleep 0.2
done

# Hide cursor
unclutter -idle 0 -root &
disown

# 3. Wait for sidecar to be healthy
LOCAL_PORT="${LOCAL_HTTP_PORT:-8080}"
echo "Waiting for sidecar on port $LOCAL_PORT..."
for i in $(seq 1 120); do
    if curl -s "http://localhost:$LOCAL_PORT/_dz_9f7a3b1c/health" > /dev/null 2>&1; then
        echo "Sidecar ready."
        break
    fi
    sleep 0.5
done

# 4. Start Chromium pointed at sidecar (serves user content at /)
echo "Starting Chromium with flags:"
echo "  $CHROME_FLAGS"
google-chrome-stable $CHROME_FLAGS "http://localhost:$LOCAL_PORT/" &
CHROME_PID=$!

# Wait for Chrome CDP to be available
echo "Waiting for Chrome CDP..."
for i in $(seq 1 60); do
    if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
        echo "Chrome CDP ready."
        break
    fi
    sleep 0.2
done

# 5. HLS + RTMP encoding is handled by the sidecar (manages ffmpeg directly).
# No OBS needed — the sidecar's pipeline package captures Xvfb via x11grab
# and encodes to HLS (always-on preview) + RTMP (when broadcasting).
mkdir -p /tmp/hls

echo "All processes started. Waiting..."
wait -n
echo "A process exited, shutting down."
