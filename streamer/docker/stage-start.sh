#!/usr/bin/env bash
set -euo pipefail
# Per-stage startup script for multi-tenant GPU nodes.
# Runs as a dedicated UID (10000+slot) in a process group managed by the agent.
#
# Isolation model (process-level, no kernel namespaces):
#   - UID:      each stage runs as a unique UID (/proc isolation, file permissions)
#   - Display:  each stage gets its own Xvfb display with auth cookie (XAUTHORITY)
#   - Port:     each sidecar listens on a unique port (PORT env var)
#   - Data:     each stage has its own data dir (DATA_DIR env var, owned by stage UID)
#   - Audio:    each stage has its own PulseAudio socket (PULSE_SERVER env var)
#   - HLS:      each stage writes to its own HLS dir (HLS_DIR env var, owned by stage UID)
#
# Environment variables (set by agent):
#   DISPLAY, PORT, STAGE_ID, USER_ID, TOKEN, SLOT, DATA_DIR, HOME, XAUTHORITY
#   SCREEN_WIDTH, SCREEN_HEIGHT, CHROME_FLAGS, SIDECAR_VIDEO_CODEC
#   CONTENT_NONCE, PULSE_SERVER, HLS_DIR, R2_*, TLS_*
#   __NV_PRIME_RENDER_OFFLOAD, __GLX_VENDOR_LIBRARY_NAME

CHROME_PID=""
SIDECAR_PID=""
PULSE_PID=""
XVFB_PID=""

cleanup() {
    echo "[stage $STAGE_ID] Shutting down..."
    [ -n "$CHROME_PID" ] && kill "$CHROME_PID" 2>/dev/null || true
    [ -n "$SIDECAR_PID" ] && kill "$SIDECAR_PID" 2>/dev/null || true
    [ -n "$PULSE_PID" ] && kill "$PULSE_PID" 2>/dev/null || true
    [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null || true
    wait 2>/dev/null
    rm -f "/tmp/cdp-in-${SLOT:-0}" "/tmp/cdp-out-${SLOT:-0}" 2>/dev/null || true
    echo "[stage $STAGE_ID] All processes stopped."
}
trap cleanup EXIT INT TERM

SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-720}"
SLOT="${SLOT:-0}"
DATA_DIR="${DATA_DIR:-/data}"
HLS_DIR="${HLS_DIR:-/tmp/hls-$SLOT}"

if [ -z "${CHROME_FLAGS:-}" ]; then
    echo "ERROR: CHROME_FLAGS env var is required"
    exit 1
fi

# Strip runtime flags that may be left over from legacy CHROME_FLAGS values.
# These are now managed by stage-start.sh, not the env var.
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

# Ensure data directories exist and are owned by the stage UID
# (Chrome runs as non-root and needs write access)
mkdir -p "$DATA_DIR/content" "$DATA_DIR/chrome"
if [ -n "${STAGE_UID:-}" ] && [ "$STAGE_UID" != "0" ]; then
    chown -R "$STAGE_UID:${STAGE_GID:-$STAGE_UID}" "$DATA_DIR"
fi

# CDP transport: use pipe mode (no TCP port) for multi-tenant isolation.
# Named FIFOs are created by the agent with 0600 permissions and owned by the
# stage UID. Only recreate them here if they don't exist (standalone mode).
CDP_PIPE_IN="/tmp/cdp-in-$SLOT"
CDP_PIPE_OUT="/tmp/cdp-out-$SLOT"
if [ ! -p "$CDP_PIPE_IN" ]; then
    rm -f "$CDP_PIPE_IN" "$CDP_PIPE_OUT"
    mkfifo "$CDP_PIPE_IN" "$CDP_PIPE_OUT"
    chmod 600 "$CDP_PIPE_IN" "$CDP_PIPE_OUT"
fi

# Append per-slot runtime flags (display, data dir, window size, CDP pipe).
# CHROME_FLAGS from the env contains only policy flags; runtime flags are managed here.
CHROME_FLAGS="$CHROME_FLAGS --display=$DISPLAY --user-data-dir=$DATA_DIR/chrome"
CHROME_FLAGS="$CHROME_FLAGS --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} --window-position=0,0"

echo "[stage $STAGE_ID] Starting Xvfb ($DISPLAY, ${SCREEN_WIDTH}x${SCREEN_HEIGHT})..."
DISPLAY_NUM="${DISPLAY#:}"
# Use -auth instead of -ac to require XAUTHORITY cookie for display access.
# This prevents other stages from capturing our screen via xdpyinfo/xwd.
XVFB_AUTH_ARGS=""
if [ -n "${XAUTHORITY:-}" ] && [ -f "$XAUTHORITY" ]; then
    XVFB_AUTH_ARGS="-auth $XAUTHORITY"
    echo "[stage $STAGE_ID] Xvfb auth enabled (cookie: $XAUTHORITY)"
else
    # Fallback to open access if no xauth cookie (non-hardened mode)
    XVFB_AUTH_ARGS="-ac"
    echo "[stage $STAGE_ID] WARN: No XAUTHORITY set, Xvfb running without auth"
fi
Xvfb ":$DISPLAY_NUM" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24" $XVFB_AUTH_ARGS +extension GLX +render -noreset &
XVFB_PID=$!

# PulseAudio — each stage gets its own socket directory
PULSE_DIR="$(dirname "${PULSE_SERVER#unix:}")"
# PulseAudio needs a unique runtime dir per instance to avoid conflicts.
export XDG_RUNTIME_DIR="/tmp/pulse-runtime-$SLOT"
mkdir -p "$XDG_RUNTIME_DIR" "$PULSE_DIR"
echo "[stage $STAGE_ID] Starting PulseAudio (socket: $PULSE_DIR)..."
pulseaudio --daemonize --no-cpu-limit \
    --exit-idle-time=-1 \
    --load="module-native-protocol-unix auth-anonymous=1 socket=$PULSE_DIR/native" 2>/dev/null || true
PULSE_PID=$(pgrep -n -f "socket=$PULSE_DIR/native" || true)

sleep 0.3

echo "[stage $STAGE_ID] Starting sidecar (port $PORT, CDP via pipe)..."
export CONTENT_ROOT="$DATA_DIR/content"
export SYNC_DIR="$DATA_DIR/content/sync"
export CDP_PIPE_IN="$CDP_PIPE_IN"
export CDP_PIPE_OUT="$CDP_PIPE_OUT"
/sidecar serve &
SIDECAR_PID=$!

# When mTLS is configured, the main port serves TLS and a localhost-only
# HTTP port is used for Chrome content and health checks.
LOCAL_PORT="${LOCAL_HTTP_PORT:-$PORT}"
if [ -n "${TLS_SERVER_CERT:-}" ]; then
    LOCAL_PORT="${LOCAL_HTTP_PORT:-8080}"
fi

# Wait for sidecar to be healthy
for i in $(seq 1 120); do
    if curl -s "http://127.0.0.1:$LOCAL_PORT/_dz_9f7a3b1c/health" > /dev/null 2>&1; then
        echo "[stage $STAGE_ID] Sidecar ready."
        break
    fi
    sleep 0.5
done

# Hide cursor
unclutter -idle 0 -root -display "$DISPLAY" &>/dev/null &
disown

echo "[stage $STAGE_ID] Starting Chrome (CDP via pipe)..."
echo "  Display: $DISPLAY"
echo "  Flags: $CHROME_FLAGS --remote-debugging-pipe"
# Launch Chrome with --remote-debugging-pipe: fd 3 = read commands, fd 4 = write responses.
# Named FIFOs provide the transport, owned by the stage UID for isolation.
# Build Chrome's start URL — in multi-tenant mode, Chrome loads /_boot which
# redirects to /<nonce>/. The nonce never appears in the command line
# (which is world-readable via /proc/<pid>/cmdline without hidepid=2).
CHROME_START_URL="http://127.0.0.1:$LOCAL_PORT/"
if [ -n "${CONTENT_NONCE:-}" ]; then
    CHROME_START_URL="http://127.0.0.1:$LOCAL_PORT/_boot"
fi
# Drop to non-root stage UID for Chrome (process isolation).
# Sidecar/ffmpeg stay root for /dev/nvidia* NVENC access.
if [ -n "${STAGE_UID:-}" ] && [ "$STAGE_UID" != "0" ]; then
    (exec 3<>"$CDP_PIPE_IN" 4>"$CDP_PIPE_OUT"; exec setpriv --reuid="$STAGE_UID" --regid="${STAGE_GID:-$STAGE_UID}" --clear-groups google-chrome-stable $CHROME_FLAGS --remote-debugging-pipe "$CHROME_START_URL") &
else
    (exec 3<>"$CDP_PIPE_IN" 4>"$CDP_PIPE_OUT"; exec google-chrome-stable $CHROME_FLAGS --remote-debugging-pipe "$CHROME_START_URL") &
fi
CHROME_PID=$!

# Brief wait for Chrome to initialize (no TCP port to poll — pipe connects on first message)
sleep 2
echo "[stage $STAGE_ID] Chrome started (CDP pipe: $CDP_PIPE_IN, $CDP_PIPE_OUT)."

mkdir -p "$HLS_DIR"

echo "[stage $STAGE_ID] All processes started. Waiting..."
wait -n
echo "[stage $STAGE_ID] A process exited, shutting down."
