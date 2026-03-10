# Streamer Image Guide

## Image Size Impact

- Base Ubuntu 24.04 + Chrome: ~800 MB
- Mesa libraries addition: ~150-200 MB
- **Total expected**: ~950-1000 MB
- **Pull time impact**: ~2-3 sec additional on 10 Mbps connection
- **Storage impact**: Per-stage ~1 GB in container registry

The size increase is acceptable for feature value (WebGL support).
No image optimization recommended unless size becomes critical constraint.

## WebGL Support

The streamer image includes Mesa graphics libraries to enable WebGL via software rendering (SwiftShader). All stages have WebGL capability by default. To disable WebGL for a specific stage, set the `DISABLE_WEBGL=true` environment variable.

See [WebGL Performance Guide](webgl-performance-guide.md) for resource sizing and performance baselines.
