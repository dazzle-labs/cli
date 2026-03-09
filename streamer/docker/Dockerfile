FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# Note: Ubuntu 22.04's chromium-browser is a snap stub that doesn't work in containers.
# We install Chromium from the Playwright team's PPA which provides a real .deb package.
RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    dbus-x11 \
    curl \
    gnupg \
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
    xdotool \
    software-properties-common \
    netcat-openbsd \
    tmux \
    mesa-utils \
    libgl1-mesa-dri \
    libegl-mesa0 \
    && rm -rf /var/lib/apt/lists/*

# Install OBS Studio 32.x (includes obs-websocket built-in)
RUN add-apt-repository ppa:obsproject/obs-studio \
    && apt-get update \
    && apt-get install -y obs-studio ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Remove outdated python3-cryptography installed as OBS dependency
RUN apt-get update && apt-get install -y python3-pip \
    && apt-get remove -y python3-cryptography \
    && pip3 install cryptography --break-system-packages \
    && apt-get purge -y python3-pip && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Install Chromium from the official Google Chrome stable channel (real .deb, not snap)
RUN wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get update \
    && apt-get install -y /tmp/chrome.deb \
    && rm /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 24 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy streamer code and install dependencies
COPY package.json package-lock.json* ./
RUN npm install

COPY index.js sync.js shell.html prelude.js style.css vite-init.mjs ./

# Remove npm (only needed for install, not runtime) to eliminate bundled dep vulns
RUN rm -rf /usr/lib/node_modules/npm /usr/bin/npm /usr/bin/npx

# Copy PulseAudio config
COPY docker/pulse-default.pa /etc/pulse/default.pa

# Copy entrypoint and prestop hook
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/prestop.sh /scripts/prestop.sh
RUN chmod +x /entrypoint.sh /scripts/prestop.sh

ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse/native

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
