ARG VARIANT=cpu
ARG SIDECAR_IMAGE=dazzlefm/agent-streamer-sidecar:main
ARG STAGE_RUNTIME_IMAGE=

# --- Base images per variant ---
FROM ubuntu:24.04                        AS base-cpu
FROM nvidia/cuda:12.4.1-base-ubuntu22.04 AS base-gpu

# --- Common packages (no GL libs here) ---
FROM base-${VARIANT} AS base

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# Note: Ubuntu 22.04's chromium-browser is a snap stub that doesn't work in containers.
# We install Chromium from the Playwright team's PPA which provides a real .deb package.
RUN apt-get update \
    && if dpkg --compare-versions "$(. /etc/os-release && echo "$VERSION_ID")" ge 24.04; then \
         LIBASOUND=libasound2t64; LIBGTK=libgtk-3-0t64; \
       else \
         LIBASOUND=libasound2; LIBGTK=libgtk-3-0; \
       fi \
    && apt-get install -y \
    xvfb \
    xserver-xorg-core \
    xserver-xorg-video-dummy \
    xauth \
    pulseaudio \
    ffmpeg \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    $LIBASOUND \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    $LIBGTK \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    unclutter \
    && rm -rf /var/lib/apt/lists/*

# Install Chrome/Chromium — Google Chrome .deb is amd64-only, so on arm64 we
# use Playwright's standalone Chromium (first-class arm64 support, no snap).
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:22-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN ARCH=$(dpkg --print-architecture) \
    && if [ "$ARCH" = "arm64" ]; then \
         npx --yes playwright install --with-deps chromium \
         && CHROME_DIR=$(find /root/.cache/ms-playwright -maxdepth 1 -name 'chromium-*' -type d | head -1) \
         && ln -sf "$CHROME_DIR/chrome-linux/chrome" /usr/bin/google-chrome-stable \
         && rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/lib/node_modules; \
       else \
         wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
         && apt-get update \
         && apt-get install -y /tmp/chrome.deb \
         && rm /tmp/chrome.deb \
         && rm -rf /var/lib/apt/lists/* \
         && rm -rf /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx /usr/local/lib/node_modules; \
       fi

# --- GL libraries per variant ---
FROM base AS gl-cpu
RUN apt-get update && apt-get install -y \
    libglvnd0 \
    libglx0 \
    libgl1-mesa-dri \
    libglapi-mesa \
    mesa-vulkan-drivers \
    mesa-utils \
    && rm -rf /var/lib/apt/lists/*

FROM base AS gl-gpu
# GPU GL layer: Vulkan for Chrome ANGLE, plus Mesa DRI (llvmpipe) as software fallback.
# Chrome uses --use-gl=angle --use-angle=vulkan to render WebGL via Vulkan, bypassing
# X11/GLX entirely (Xvfb can't hardware-accelerate GLX). The NVIDIA Vulkan ICD is
# bind-mounted by nvidia-container-toolkit when NVIDIA_DRIVER_CAPABILITIES includes graphics.
RUN apt-get update && apt-get install -y \
    libglvnd0 \
    libglx0 \
    libgl1 \
    libgl1-mesa-dri \
    libgles2 \
    libegl1 \
    libvulkan1 \
    mesa-vulkan-drivers \
    vulkan-tools \
    mesa-utils \
    && rm -rf /var/lib/apt/lists/*

# Build ffmpeg from source with NVENC + PulseAudio.
# nv-codec-headers n12.2.72.0 works with driver 550+ (CUDA 12.4).
# The actual NVENC libraries are bind-mounted at runtime
# by nvidia-container-toolkit, so they always match the host driver.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git nasm pkg-config \
        libssl-dev libx264-dev libpulse-dev libx11-dev libxcb1-dev libxcb-shm0-dev \
        libxcb-xfixes0-dev libfreetype-dev libfontconfig-dev libharfbuzz-dev \
        libssl-dev \
    # nv-codec-headers for NVENC
    && git clone --depth 1 --branch n12.2.72.0 https://github.com/FFmpeg/nv-codec-headers /tmp/nv-codec-headers \
    && make -C /tmp/nv-codec-headers install \
    # ffmpeg — pinned to 313e776 (2026-03-20).
    && git init /tmp/ffmpeg \
    && cd /tmp/ffmpeg \
    && git fetch --depth 1 https://github.com/FFmpeg/FFmpeg.git 313e776ba7d79e0830e2769ba88b787f0f1da24c \
    && git checkout FETCH_HEAD \
    && ./configure \
        --enable-gpl --enable-nonfree \
        --enable-openssl \
        --enable-nvenc --enable-libx264 --enable-libpulse --enable-libfreetype --enable-libfontconfig --enable-libharfbuzz \
        --enable-libxcb --enable-libxcb-shm --enable-libxcb-xfixes \
        --disable-doc --disable-debug --disable-static --enable-shared \
    && make -j$(nproc) \
    && make install \
    && ldconfig \
    && cd / && rm -rf /tmp/ffmpeg /tmp/ffmpeg.tar.gz /tmp/nv-codec-headers \
    && apt-get purge -y build-essential git nasm pkg-config \
        libx264-dev libpulse-dev libx11-dev libxcb1-dev libxcb-shm0-dev \
        libxcb-xfixes0-dev libssl-dev \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
    # Smoke test: verify nothing critical was removed by autoremove
    && google-chrome-stable --version \
    && ffmpeg -encoders 2>/dev/null | grep -q h264_nvenc \
    && ffmpeg -filters 2>/dev/null | grep -q drawtext \
    && ffmpeg -protocols 2>/dev/null | grep -q rtmps \
    && echo "GPU image smoke test passed"

# --- Optional: stage-runtime binary (Rust stage runtime) ---
# When STAGE_RUNTIME_IMAGE is set, the binary is copied into both CPU and GPU images.
# Build it separately: docker build -f stage-runtime-rust/Dockerfile --target builder ...
ARG STAGE_RUNTIME_IMAGE
FROM ${STAGE_RUNTIME_IMAGE:-ubuntu:24.04} AS stage-runtime-src
# Ensure the path exists so the glob COPY trick works even on the bare ubuntu fallback.
RUN mkdir -p /build/target/release

# --- Streamer image (CPU stages) ---
FROM gl-${VARIANT} AS streamer

# Copy PulseAudio config
COPY docker/pulse-default.pa /etc/pulse/default.pa

# Copy Xorg dummy driver config (30Hz display — halves Chrome rendering vs Xvfb's 60fps)
COPY docker/xorg-dummy.conf /etc/X11/xorg-dummy.conf

# Copy CORS/network-isolation Chrome extension
COPY docker/cors-extension /opt/cors-extension

# Copy entrypoint, prestop hook, and multi-tenant stage-start script
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/prestop.sh /scripts/prestop.sh
COPY docker/stage-start.sh /stage-start.sh
RUN chmod +x /entrypoint.sh /scripts/prestop.sh /stage-start.sh

# Copy stage-runtime binary if the builder image was provided.
# Glob trick: trailing [e] is a no-op when the path doesn't exist (default ubuntu base).
COPY --from=stage-runtime-src /build/target/release/stage-runtim[e] /stage-runtime

ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse/native
# NVIDIA container runtime: request specific driver capabilities.
# "video" is required for NVENC/NVDEC — without it, libnvidia-encode
# is not bind-mounted and h264_nvenc fails with "No NVENC capable devices".
# "all" should include video but some runtimes don't honor it.
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,graphics,utility

ENTRYPOINT ["/entrypoint.sh"]

# --- GPU Agent: streamer + sidecar in agent mode ---
FROM ${SIDECAR_IMAGE} AS sidecar-src

FROM streamer AS gpu-node
COPY --from=sidecar-src /sidecar /sidecar
ENTRYPOINT ["/sidecar", "agent"]
