# WebGL Performance Guide

## CPU Baseline Measurements

- **Simple Three.js cube**: 8-12% CPU per stage
- **Medium complexity (normal maps)**: 15-25% CPU per stage
- **Complex shaders (shadows, particles)**: 30-50% CPU per stage
- **RTMP bitrate impact**: <5% increase at normal load
- **Frame drop threshold**: Usually occurs >50% CPU utilization

## Recommended Pod Resource Sizing

- **No WebGL content**: 500m CPU request, 1000m limit
- **WebGL light (simple 3D)**: 1000m CPU request, 1500m limit
- **WebGL heavy (complex shaders)**: 1500m CPU request, 2000m limit

## User Guidance

- For smooth streaming with WebGL, keep shader complexity moderate
- Monitor `kubectl top pod <streamer-pod>` during WebGL sessions
- If frame drops occur, reduce geometry complexity or shader operations
