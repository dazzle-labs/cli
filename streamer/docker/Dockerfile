ARG VARIANT=cpu
ARG SIDECAR_IMAGE=dazzlefm/agent-streamer-sidecar:main

# --- Base images per variant ---
FROM ubuntu:24.04                        AS base-cpu
FROM nvidia/cuda:12.6.0-base-ubuntu24.04 AS base-gpu

# --- Common packages (no GL libs here) ---
FROM base-${VARIANT} AS base

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# Note: Ubuntu 22.04's chromium-browser is a snap stub that doesn't work in containers.
# We install Chromium from the Playwright team's PPA which provides a real .deb package.
RUN apt-get update && apt-get install -y \
    xvfb \
    xauth \
    pulseaudio \
    ffmpeg \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0t64 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    unclutter \
    && rm -rf /var/lib/apt/lists/*

# Install Chromium from the official Google Chrome stable channel (real .deb, not snap)
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

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

# Build ffmpeg from source with PulseAudio input + NVENC.
# Use latest nv-codec-headers (n12.2 was too old for RTX 5090 Blackwell).
# The actual NVENC library (libnvidia-encode) is bind-mounted at runtime
# by nvidia-container-toolkit, so it always matches the host driver.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git nasm pkg-config \
        libx264-dev libpulse-dev libx11-dev libxcb1-dev libxcb-shm0-dev \
        libxcb-xfixes0-dev \
    && git clone --depth 1 --branch n13.0.0.0 https://github.com/FFmpeg/nv-codec-headers /tmp/nv-codec-headers \
    && make -C /tmp/nv-codec-headers install \
    && git clone --depth 1 --branch n7.1 https://github.com/FFmpeg/FFmpeg /tmp/ffmpeg \
    && cd /tmp/ffmpeg \
    && ./configure \
        --enable-gpl --enable-nonfree \
        --enable-nvenc --enable-libx264 --enable-libpulse \
        --enable-libxcb --enable-libxcb-shm --enable-libxcb-xfixes \
        --disable-doc --disable-debug --disable-static --enable-shared \
    && make -j$(nproc) \
    && make install \
    && ldconfig \
    && cd / && rm -rf /tmp/ffmpeg /tmp/nv-codec-headers \
    && apt-get purge -y build-essential git nasm pkg-config \
        libx264-dev libpulse-dev libx11-dev libxcb1-dev libxcb-shm0-dev \
        libxcb-xfixes0-dev \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# --- Streamer image (CPU stages) ---
FROM gl-${VARIANT} AS streamer

# Copy PulseAudio config
COPY docker/pulse-default.pa /etc/pulse/default.pa

# Copy entrypoint, prestop hook, and multi-tenant stage-start script
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/prestop.sh /scripts/prestop.sh
COPY docker/stage-start.sh /stage-start.sh
RUN chmod +x /entrypoint.sh /scripts/prestop.sh /stage-start.sh

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
