#!/usr/bin/env bash
# Run a bench experiment with custom SwiftShader.ini and/or Chrome flags.
#
# Usage: ./bench-experiment.sh "EXPERIMENT_NAME" "SWIFTSHADER_INI_CONTENT" [SCENE] [DURATION] [CHROME_FLAGS]
#
# CHROME_FLAGS overrides ALL Chrome args. Omit to use the standard flags.
#
# Examples:
#   ./bench-experiment.sh "threads-4" "[Processor]\nThreadCount=4"
#   ./bench-experiment.sh "threads-8" "[Processor]\nThreadCount=8"
#   ./bench-experiment.sh "custom-flags" "" "shader_simple" 15 "--no-sandbox --use-gl=angle ..."
set -euo pipefail

CTX="${BENCH_CTX:---context kind-browser-streamer}"
NS="browser-streamer"
TAG="${BENCH_IMAGE_TAG:-main}"
NAME=$1
INI_CONTENT=${2:-"[Processor]\nThreadCount=4"}
SCENE=${3:-"shader_simple"}
DURATION=${4:-15}

# Standard Chrome flags — same as production deployment.yaml
DEFAULT_CHROME_FLAGS="--no-sandbox --use-gl=desktop --disable-gpu-compositing --disable-gpu-watchdog --no-first-run --no-default-browser-check --disable-infobars --autoplay-policy=no-user-gesture-required --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 --user-data-dir=/data/chrome --renderer-process-limit=1 --kiosk --window-size=1280,720 --window-position=0,0 --display=:99 --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
CHROME_FLAGS=${5:-"$DEFAULT_CHROME_FLAGS"}

echo "=== Experiment: $NAME ==="
echo "SwiftShader.ini: $(echo -e "$INI_CONTENT" | tr '\n' ' ')"
echo "Scene: $SCENE  Duration: ${DURATION}s  Image: $TAG"
[ "$CHROME_FLAGS" != "$DEFAULT_CHROME_FLAGS" ] && echo "Chrome flags override: $CHROME_FLAGS"

# Clean up
kubectl delete pod bench -n $NS $CTX --force --grace-period=0 2>/dev/null || true
kubectl delete configmap swiftshader-ini -n $NS $CTX 2>/dev/null || true
sleep 2

# Create ConfigMap with SwiftShader.ini
kubectl create configmap swiftshader-ini -n $NS $CTX \
  --from-literal="SwiftShader.ini=$(echo -e "$INI_CONTENT")"

# The entrypoint requires CHROME_FLAGS env var — no defaults baked in.
# We mount the configmap at /data/chrome/SwiftShader.ini so the entrypoint
# skips its write and Chrome picks up our config instead.
cat > /tmp/bench-exp.yaml << ENDYAML
apiVersion: v1
kind: Pod
metadata:
  name: bench
  namespace: browser-streamer
spec:
  restartPolicy: Never
  terminationGracePeriodSeconds: 10
  containers:
    - name: streamer
      image: dazzlefm/agent-streamer-stage:${TAG}
      imagePullPolicy: IfNotPresent
      env:
        - name: STAGE_ID
          value: bench
        - name: USER_ID
          value: bench
        - name: CHROME_FLAGS
          value: "${CHROME_FLAGS}"
      resources:
        requests:
          cpu: 500m
          memory: 2Gi
        limits:
          cpu: 3500m
          memory: 14Gi
      volumeMounts:
        - name: dshm
          mountPath: /dev/shm
        - name: stage-data
          mountPath: /data
        - name: hls-data
          mountPath: /tmp/hls
        - name: x11-socket
          mountPath: /tmp/.X11-unix
        - name: pulse-socket
          mountPath: /tmp/pulse
        - name: swiftshader-ini
          mountPath: /data/chrome/SwiftShader.ini
          subPath: SwiftShader.ini
    - name: sidecar
      image: dazzlefm/agent-streamer-sidecar:${TAG}
      imagePullPolicy: IfNotPresent
      command: ["/sidecar", "serve"]
      env:
        - name: STAGE_ID
          value: bench
        - name: USER_ID
          value: bench
        - name: DISPLAY
          value: ":99"
        - name: PULSE_SERVER
          value: unix:/tmp/pulse/native
        - name: SCREEN_WIDTH
          value: "1280"
        - name: SCREEN_HEIGHT
          value: "720"
      volumeMounts:
        - name: stage-data
          mountPath: /data
        - name: hls-data
          mountPath: /tmp/hls
        - name: x11-socket
          mountPath: /tmp/.X11-unix
        - name: pulse-socket
          mountPath: /tmp/pulse
      resources:
        requests:
          cpu: 500m
          memory: 512Mi
        limits:
          cpu: 2000m
          memory: 1Gi
  volumes:
    - name: dshm
      emptyDir:
        medium: Memory
        sizeLimit: 2Gi
    - name: stage-data
      emptyDir:
        sizeLimit: 2Gi
    - name: hls-data
      emptyDir:
        sizeLimit: 512Mi
    - name: x11-socket
      emptyDir: {}
    - name: pulse-socket
      emptyDir: {}
    - name: swiftshader-ini
      configMap:
        name: swiftshader-ini
ENDYAML

kubectl apply -f /tmp/bench-exp.yaml $CTX 2>&1 | grep -v "PodSecurity"
echo "Waiting for pod..."
kubectl wait --for=condition=Ready pod/bench -n $NS $CTX --timeout=120s

echo "Waiting for Chrome CDP..."
for i in $(seq 1 30); do
    if kubectl exec -n $NS bench -c sidecar $CTX -- curl -s http://localhost:9222/json/version >/dev/null 2>&1; then
        echo "Chrome ready."
        break
    fi
    sleep 2
done

echo "Running bench (scene=$SCENE, duration=${DURATION}s)..."
kubectl exec -n $NS bench -c sidecar $CTX -- /sidecar bench --scene "$SCENE" --duration "$DURATION" 2>&1 | grep "browser_fps_avg\|browser_fps_min\|==="

# Clean up
kubectl delete pod bench -n $NS $CTX --force --grace-period=0 2>/dev/null || true
kubectl delete configmap swiftshader-ini -n $NS $CTX 2>/dev/null || true
echo "=== Done: $NAME ==="
