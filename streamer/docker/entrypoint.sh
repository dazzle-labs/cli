#!/usr/bin/env bash
set -euo pipefail

cleanup() {
    echo "Shutting down..."
    kill "$CHROME_PID" 2>/dev/null || true
    kill "$PULSE_PID" 2>/dev/null || true
    kill "$XVFB_PID" 2>/dev/null || true
    wait
    echo "All processes stopped."
}
trap cleanup EXIT INT TERM

# Screen resolution (default 1280x720)
SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-720}"

# Allow per-stage WebGL disable if needed (default: enabled)
if [ "${DISABLE_WEBGL:-false}" = "true" ]; then
    echo "WebGL disabled via DISABLE_WEBGL=true"
    CHROME_GL_FLAG="--disable-gpu"
else
    CHROME_GL_FLAG="--use-gl=swiftshader"
fi

# 1. Start Xvfb
echo "Starting Xvfb (${SCREEN_WIDTH}x${SCREEN_HEIGHT})..."
Xvfb :99 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

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

# 3. Wait for sidecar to be healthy (serves content on port 8080)
echo "Waiting for sidecar..."
for i in $(seq 1 120); do
    if curl -s http://localhost:8080/_dz_9f7a3b1c/health > /dev/null 2>&1; then
        echo "Sidecar ready."
        break
    fi
    sleep 0.5
done

# 4. Start Chromium pointed at sidecar (serves user content at /)
echo "Starting Chromium..."
google-chrome-stable \
    --no-sandbox \
    $CHROME_GL_FLAG \
    --disable-dev-shm-usage \
    --no-first-run \
    --no-default-browser-check \
    --disable-infobars \
    --autoplay-policy=no-user-gesture-required \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --user-data-dir=/data/chrome \
    --kiosk \
    --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} \
    --window-position=0,0 \
    --display=:99 \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    "http://localhost:8080/" &
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

# Test WebGL context creation
echo "Verifying WebGL context via SwiftShader..."
curl -s -X POST http://localhost:9222/json/evaluate \
  -H "Content-Type: application/json" \
  -d '{"expression":"typeof WebGLRenderingContext"}' \
  2>/dev/null | grep -q "function" && \
  echo "✓ WebGL context available" || \
  echo "⚠ WebGL context test inconclusive (check Chrome console)"

# 5. HLS + RTMP encoding is handled by the sidecar (manages ffmpeg directly).
# No OBS needed — the sidecar's pipeline package captures Xvfb via x11grab
# and encodes to HLS (always-on preview) + RTMP (when broadcasting).
mkdir -p /tmp/hls

echo "All processes started. Waiting..."
# Wait for any process to exit and log if it's Chrome
wait -n
EXITED_PID=$!
if [ "$EXITED_PID" = "$CHROME_PID" ]; then
    echo "ERROR: Chrome process exited unexpectedly"
    echo "Chrome command was: $(ps -p $CHROME_PID -o cmd= 2>/dev/null || echo 'process not found')"
fi
echo "A process exited, shutting down."
