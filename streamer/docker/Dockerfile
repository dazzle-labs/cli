ARG VARIANT=cpu
ARG SIDECAR_IMAGE=dazzlefm/agent-streamer-sidecar:main

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

# Build ffmpeg from source with Vulkan Video + NVENC + PulseAudio.
# Pinned to ffmpeg commit 313e776 (2026-03-20) for h264_vulkan support —
# n7.1 had a vkCreateDevice bug on NVIDIA 550 drivers.
# nv-codec-headers n12.2.72.0 works with driver 550+ (CUDA 12.4).
# The actual NVENC/Vulkan libraries are bind-mounted at runtime
# by nvidia-container-toolkit, so they always match the host driver.
#
# Vulkan SDK 1.3.283 from LunarG is required — Ubuntu 22.04's
# libvulkan-dev is 1.3.204, too old for ffmpeg's h264_vulkan (needs >= 1.3.277).
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget gnupg2 build-essential git nasm pkg-config \
        libx264-dev libpulse-dev libx11-dev libxcb1-dev libxcb-shm0-dev \
        libxcb-xfixes0-dev libdrm-dev \
    # Install Vulkan SDK 1.3.283 from LunarG
    && wget -qO- https://packages.lunarg.com/lunarg-signing-key-pub.asc \
        | gpg --dearmor -o /usr/share/keyrings/lunarg.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/lunarg.gpg] https://packages.lunarg.com/vulkan/1.3.283 jammy main" \
        > /etc/apt/sources.list.d/lunarg-vulkan.list \
    && apt-get update && apt-get install -y --no-install-recommends \
        libvulkan1 libvulkan-dev shaderc \
    # nv-codec-headers for NVENC
    && git clone --depth 1 --branch n12.2.72.0 https://github.com/FFmpeg/nv-codec-headers /tmp/nv-codec-headers \
    && make -C /tmp/nv-codec-headers install \
    # ffmpeg — pinned to 313e776 (2026-03-20, post-n7.1 Vulkan Video fix).
    # Clone from git.ffmpeg.org with enough depth to reach the commit.
    && git clone --depth 100 https://git.ffmpeg.org/ffmpeg.git /tmp/ffmpeg \
    && cd /tmp/ffmpeg && git checkout 313e776 \
    && pkg-config --modversion vulkan && pkg-config --modversion shaderc \
    && grep VK_HEADER_VERSION /usr/include/vulkan/vulkan_core.h | head -2 \
    && (./configure \
        --enable-gpl --enable-nonfree \
        --enable-vulkan --enable-libshaderc --enable-libdrm \
        --enable-nvenc --enable-libx264 --enable-libpulse \
        --enable-libxcb --enable-libxcb-shm --enable-libxcb-xfixes \
        --disable-doc --disable-debug --disable-static --enable-shared \
    || (grep -A5 "vulkan" ffbuild/config.log | head -30 && false)) \
    && make -j$(nproc) \
    && make install \
    && ldconfig \
    && cd / && rm -rf /tmp/ffmpeg /tmp/ffmpeg.tar.gz /tmp/nv-codec-headers \
    # Purge build-time deps but keep runtime libs (libvulkan1 for Vulkan
    # Video, shaderc for SPIR-V compilation).
    && apt-mark manual libvulkan1 shaderc \
    && apt-get purge -y wget gnupg2 build-essential git nasm pkg-config \
        libx264-dev libpulse-dev libx11-dev libxcb1-dev libxcb-shm0-dev \
        libxcb-xfixes0-dev libdrm-dev libvulkan-dev \
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
