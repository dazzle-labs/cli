#!/usr/bin/env bash
set -euo pipefail

cleanup() {
    echo "Shutting down..."
    kill "${FFMPEG_PID:-}" 2>/dev/null || true
    kill "$NODE_PID" 2>/dev/null || true
    kill "$OBS_PID" 2>/dev/null || true
    kill "$CHROME_PID" 2>/dev/null || true
    kill "$PULSE_PID" 2>/dev/null || true
    kill "${DBUS_SESSION_BUS_PID:-}" 2>/dev/null || true
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
disown

# 3. Start Node.js server (must be up before Chrome navigates to panel URL)
echo "Starting Node.js server..."
cd /app
node index.js &
NODE_PID=$!

# Wait for Node.js to be serving
echo "Waiting for Node.js server..."
for i in $(seq 1 60); do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo "Node.js server ready."
        break
    fi
    sleep 0.2
done

# 4. Start Chromium pointed directly at the Vite panel URL (no CDP navigate needed)
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
    --user-data-dir=/data/chrome \
    --kiosk \
    --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} \
    --window-position=0,0 \
    --display=:99 \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    "http://localhost:8080/@panel/main/" &
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

# Set up XDG_RUNTIME_DIR and dbus session bus for OBS
export XDG_RUNTIME_DIR=/tmp/runtime-root
mkdir -p "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"
eval $(dbus-launch --sh-syntax)
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    echo "WARNING: dbus-launch failed to set DBUS_SESSION_BUS_ADDRESS"
fi

# 4. Pre-bake OBS config and start OBS Studio
echo "Setting up OBS configuration..."
OBS_CONFIG_DIR="$HOME/.config/obs-studio"
mkdir -p "$OBS_CONFIG_DIR/basic/scenes" "$OBS_CONFIG_DIR/basic/profiles/Default"

# Global config: enable WebSocket on port 4455, no auth
cat > "$OBS_CONFIG_DIR/global.ini" <<'OBSINI'
[General]
FirstRun=false
LastVersion=603979776
InfoIncrement=9999

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

# Scene collection with xshm_input screen capture (Chrome renders on Xvfb, OBS captures via xshm)
cat > "$OBS_CONFIG_DIR/basic/scenes/Untitled.json" <<SCENEJSON
{
    "name": "Untitled",
    "current_scene": "Scene",
    "current_program_scene": "Scene",
    "scene_order": [
        {"name": "Scene"}
    ],
    "sources": [
        {
            "id": "xshm_input",
            "versioned_id": "xshm_input",
            "name": "Screen",
            "uuid": "00000000-0000-0000-0000-000000000001",
            "enabled": true,
            "flags": 0,
            "volume": 1.0,
            "mixers": 0,
            "muted": false,
            "settings": {
                "screen": 0,
                "show_cursor": false,
                "advanced": false
            }
        },
        {
            "id": "scene",
            "versioned_id": "scene",
            "name": "Scene",
            "uuid": "00000000-0000-0000-0000-000000000002",
            "enabled": true,
            "flags": 0,
            "volume": 1.0,
            "mixers": 0,
            "muted": false,
            "settings": {
                "custom_size": false,
                "id_counter": 1,
                "items": [
                    {
                        "name": "Screen",
                        "source_uuid": "00000000-0000-0000-0000-000000000001",
                        "id": 1,
                        "pos": { "x": 0.0, "y": 0.0 },
                        "bounds": { "x": ${SCREEN_WIDTH}.0, "y": ${SCREEN_HEIGHT}.0 },
                        "bounds_type": 2,
                        "bounds_align": 0
                    }
                ]
            }
        }
    ],
    "groups": [],
    "transitions": [],
    "transition_duration": 300
}
SCENEJSON

echo "Starting OBS Studio..."
# Force software rendering — OBS 32.x's CEF crashes in headless Xvfb without this.
# LIBGL_ALWAYS_SOFTWARE + GALLIUM_DRIVER=llvmpipe gives CEF a usable software GPU.
export LIBGL_ALWAYS_SOFTWARE=1
export GALLIUM_DRIVER=llvmpipe
export QT_XCB_GL_INTEGRATION=none
export MESA_GL_VERSION_OVERRIDE=4.5
obs --minimize-to-tray --disable-shutdown-check --display=:99 --disable-gpu &
OBS_PID=$!

# Wait for OBS WebSocket to be ready
echo "Waiting for OBS WebSocket (port 4455)..."
for i in $(seq 1 60); do
    if curl -s http://localhost:4455 > /dev/null 2>&1 || nc -z localhost 4455 2>/dev/null; then
        echo "OBS WebSocket ready."
        break
    fi
    if ! kill -0 "$OBS_PID" 2>/dev/null; then
        echo "ERROR: OBS process died during startup."
        exit 1
    fi
    sleep 0.5
done

# Move OBS window off-screen so it doesn't appear in the screen capture
# (no window manager in Xvfb, so windowminimize doesn't work)
echo "Moving OBS off-screen..."
sleep 1
for wid in $(xdotool search --class obs 2>/dev/null); do
    xdotool windowmove "$wid" 9999 9999 2>/dev/null || true
done

# 6. Start HLS preview pipeline
echo "Starting HLS preview..."
mkdir -p /tmp/hls
ffmpeg -loglevel warning -f x11grab -video_size ${SCREEN_WIDTH}x${SCREEN_HEIGHT} -framerate 30 -i :99 \
    -c:v libx264 -preset ultrafast -tune zerolatency -g 30 \
    -f hls -hls_time 1 -hls_list_size 5 -hls_flags delete_segments+append_list \
    -hls_segment_filename '/tmp/hls/seg%03d.ts' /tmp/hls/stream.m3u8 &
FFMPEG_PID=$!

# Wait briefly for ffmpeg to start producing segments
for i in $(seq 1 10); do
    if [ -f /tmp/hls/stream.m3u8 ]; then
        echo "HLS preview ready."
        break
    fi
    sleep 0.5
done

echo "All processes started. Waiting..."
echo "Tracked PIDs: XVFB=$XVFB_PID NODE=$NODE_PID CHROME=$CHROME_PID OBS=$OBS_PID FFMPEG=${FFMPEG_PID:-unset}"
# Check which processes are still alive before waiting
for name_pid in "XVFB:$XVFB_PID" "NODE:$NODE_PID" "CHROME:$CHROME_PID" "OBS:$OBS_PID" "FFMPEG:${FFMPEG_PID:-}"; do
    name="${name_pid%%:*}"
    pid="${name_pid##*:}"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        echo "WARNING: $name (PID $pid) already dead before wait"
    fi
done
wait -n $XVFB_PID $NODE_PID $CHROME_PID $OBS_PID ${FFMPEG_PID:-}
EXIT_CODE=$?
# Identify which process exited
for name_pid in "XVFB:$XVFB_PID" "NODE:$NODE_PID" "CHROME:$CHROME_PID" "OBS:$OBS_PID" "FFMPEG:${FFMPEG_PID:-}"; do
    name="${name_pid%%:*}"
    pid="${name_pid##*:}"
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        echo "EXITED: $name (PID $pid)"
    fi
done
echo "A process exited (code=$EXIT_CODE), shutting down."
