FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# System deps: build essentials, V8 build deps, Vulkan SDK, ffmpeg
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    pkg-config \
    cmake \
    git \
    python3 \
    # Audio (for web-audio-api cpal backend)
    libasound2-dev \
    # Vulkan (for wgpu)
    libvulkan-dev \
    # SSL (for reqwest)
    libssl-dev \
    # Clang (for V8 bindgen)
    clang \
    libclang-dev \
    # FFmpeg dev headers (for ffmpeg-next encoder)
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswscale-dev \
    libswresample-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build

# Copy manifest first for dependency caching
COPY Cargo.toml Cargo.lock ./

# Copy benches (Cargo.toml references them, manifest parse fails without them)
COPY benches/ benches/

# Create dummy main.rs to build deps
RUN mkdir -p src/runtime && \
    echo 'fn main() { println!("dummy"); }' > src/main.rs && \
    echo '' > src/runtime/polyfills.js

# Build dependencies only (cache layer)
RUN cargo build --release 2>&1 || true
RUN rm -rf src

# Copy actual source
COPY src/ src/

# Build for real
RUN cargo build --release 2>&1

# --- Dev image: just the build environment with sources mounted ---
FROM builder AS dev
ENTRYPOINT ["cargo"]
CMD ["check"]
