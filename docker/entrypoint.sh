#!/usr/bin/env bash
set -euo pipefail

cleanup() {
    echo "Shutting down..."
    kill "$NODE_PID" 2>/dev/null || true
    kill "$OBS_PID" 2>/dev/null || true
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

# Hide cursor
unclutter -idle 0 -root &

# 3. Start Chromium (kiosk mode, no UI chrome)
echo "Starting Chromium..."
google-chrome-stable \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --no-first-run \
    --no-default-browser-check \
    --disable-infobars \
    --autoplay-policy=no-user-gesture-required \
    --remote-debugging-port=9222 \
    --remote-debugging-address=0.0.0.0 \
    --user-data-dir=/tmp/chrome-data \
    --kiosk \
    --display=:99 \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    "data:text/html,<html><body style='display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,%230a0a0a,%231a1a2e,%2316213e);color:%23eee;font-family:system-ui;overflow:hidden'><div style='text-align:center'><div style='font-size:72px;font-weight:200;letter-spacing:8px;background:linear-gradient(90deg,%2360a5fa,%23a78bfa,%23f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent'>HELLO WORLD</div><div style='margin-top:16px;font-size:14px;letter-spacing:12px;color:%23555;text-transform:uppercase'>browser streamer</div></div></body></html>" &
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

# 4. Pre-bake OBS config and start OBS Studio
echo "Setting up OBS configuration..."
OBS_CONFIG_DIR="$HOME/.config/obs-studio"
mkdir -p "$OBS_CONFIG_DIR/basic/scenes" "$OBS_CONFIG_DIR/basic/profiles/Default"

# Global config: enable WebSocket on port 4455, no auth
cat > "$OBS_CONFIG_DIR/global.ini" <<'OBSINI'
[OBSWebSocket]
ServerEnabled=true
ServerPort=4455
AuthRequired=false
OBSINI

# Default profile
cat > "$OBS_CONFIG_DIR/basic/profiles/Default/basic.ini" <<PROFILEINI
[General]
Name=Default

[Video]
BaseCX=${SCREEN_WIDTH}
BaseCY=${SCREEN_HEIGHT}
OutputCX=${SCREEN_WIDTH}
OutputCY=${SCREEN_HEIGHT}
FPSType=0
FPSCommon=30

[Output]
Mode=Simple

[SimpleOutput]
StreamEncoder=x264
RecQuality=Stream
RecEncoder=x264
VBitrate=2500
ABitrate=128
PROFILEINI

# Scene collection with screen capture source
cat > "$OBS_CONFIG_DIR/basic/scenes/Untitled.json" <<'SCENEJSON'
{
    "name": "Untitled",
    "current_scene": "Scene",
    "current_program_scene": "Scene",
    "sources": [
        {
            "id": "xshm_input",
            "name": "Screen",
            "settings": {
                "screen": 0,
                "show_cursor": false,
                "advanced": false
            },
            "enabled": true
        }
    ],
    "scene_order": [
        {"name": "Scene"}
    ],
    "scenes": [
        {
            "name": "Scene",
            "items": [
                {
                    "name": "Screen",
                    "source_name": "Screen",
                    "visible": true
                }
            ]
        }
    ]
}
SCENEJSON

echo "Starting OBS Studio..."
obs --minimize-to-tray --disable-shutdown-check --display=:99 &
OBS_PID=$!

# Wait for OBS WebSocket to be ready
echo "Waiting for OBS WebSocket (port 4455)..."
for i in $(seq 1 60); do
    if curl -s http://localhost:4455 > /dev/null 2>&1 || nc -z localhost 4455 2>/dev/null; then
        echo "OBS WebSocket ready."
        break
    fi
    sleep 0.5
done

# 5. Start Node.js server
echo "Starting Node.js server..."
cd /app
node index.js &
NODE_PID=$!

echo "All processes started. Waiting..."
wait -n
echo "A process exited, shutting down."
