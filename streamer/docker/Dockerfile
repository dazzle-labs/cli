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
# NVIDIA container runtime: request all driver capabilities so that
# libGL/libEGL/libvulkan are bind-mounted from the host GPU driver.
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=all

ENTRYPOINT ["/entrypoint.sh"]

# --- GPU Agent: streamer + sidecar in agent mode ---
FROM ${SIDECAR_IMAGE} AS sidecar-src
FROM streamer AS gpu-agent
COPY --from=sidecar-src /sidecar /sidecar
ENTRYPOINT ["/sidecar", "agent"]
