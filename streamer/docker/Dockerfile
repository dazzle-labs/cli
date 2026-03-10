FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# Note: Ubuntu 22.04's chromium-browser is a snap stub that doesn't work in containers.
# We install Chromium from the Playwright team's PPA which provides a real .deb package.
RUN apt-get update && apt-get install -y \
    xvfb \
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
    libglvnd0 \
    libglx0 \
    libgl1-mesa-dri \
    libglapi-mesa \
    mesa-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Chromium from the official Google Chrome stable channel (real .deb, not snap)
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# Copy PulseAudio config
COPY docker/pulse-default.pa /etc/pulse/default.pa

# Copy entrypoint and prestop hook
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/prestop.sh /scripts/prestop.sh
RUN chmod +x /entrypoint.sh /scripts/prestop.sh

ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse/native

ENTRYPOINT ["/entrypoint.sh"]
