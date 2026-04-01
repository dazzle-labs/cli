# GPU Validation

Manual validation steps for RunPod GPU stages. Gate Tasks 11–13 on these passing.

## Prerequisites

- GPU streamer image built and pushed: `docker build --build-arg VARIANT=gpu -t dazzlefm/agent-streamer-stage:<tag>-gpu stage-runtime/docker/`
- RunPod account with API key
- NVIDIA L4 availability on Secure Cloud

## Validation Steps

### 1. Create RunPod Pod

Create via RunPod API or dashboard:
- GPU: `NVIDIA L4`
- Image: `dazzlefm/agent-streamer-stage:<tag>-gpu`
- Cloud Type: `SECURE`
- Ports: `22/tcp` (for SSH)
- GPU Count: 1

### 2. Verify GPU

```bash
nvidia-smi
# Expected: NVIDIA L4 listed with driver version
```

### 3. Verify OpenGL Renderer

```bash
DISPLAY=:99 Xvfb :99 -screen 0 1280x720x24 &
glxinfo -B | grep "OpenGL renderer"
# Expected: "NVIDIA ..." (NOT llvmpipe or softpipe)
```

### 4. Verify Chrome Hardware GL

Start Chrome with `--use-gl=desktop --ignore-gpu-blocklist` and navigate to `chrome://gpu`.

Expected: `WebGL: Hardware accelerated`

### 5. Verify NVENC

```bash
ffmpeg -f lavfi -i testsrc=duration=1 -c:v h264_nvenc -f null /dev/null
# Expected: encodes without error
```

## Results

Document renderer string and NVENC output here after validation:

- **GPU**: (e.g. NVIDIA L4, 24GB)
- **OpenGL renderer**: (e.g. NVIDIA L4/PCIe/SSE2)
- **NVENC**: (pass/fail)
- **Date validated**:
