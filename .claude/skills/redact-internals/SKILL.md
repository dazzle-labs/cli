---
name: redact-internals
description: "Redact internal implementation details from public-facing content. Use when writing or editing docs, llms.txt, guide.md, marketing copy, or any user-facing text that describes how Dazzle stages work."
---

# Redact Internals

## When to Use
- Writing or editing public-facing docs: `guide.md`, `llms.txt.tmpl`, `llms-full.txt.tmpl`, landing pages, blog posts
- Describing stage capabilities to users (performance, features, environment)
- Reviewing PRs or content that will be visible to end users

## Rules

**Describe capabilities and outcomes, never mechanisms.**

### Never reveal
- **Rendering implementation**: llvmpipe, Mesa, SwiftShader, ANGLE backend names, `--use-gl=` flags, or how software OpenGL is achieved. Say "Software OpenGL" or "hardware WebGL" — not the renderer name.
- **Network isolation implementation**: the Chrome extension, webRequest listeners, RFC1918 blocking rules, or that CORS is handled by injecting response headers. Say "relaxed CORS" or "cross-origin requests work" — not how.
- **Infrastructure details**: specific cloud providers for GPU nodes (RunPod), sidecar architecture, ffmpeg pipeline internals, CDP pipe transport, Xvfb/Xorg dummy driver setup, "shared CPU" (implies multi-tenant).
- **Encoder names**: x264, NVENC, Vulkan Video. Say "hardware video encoder" or "software video encoder" — not the codec library.
- **Audio subsystem**: PulseAudio. Say "Web Audio API supported" or "audio captured to the stream" — not the capture mechanism.
- **Chrome configuration**: kiosk mode, specific Chrome flags. Say "full viewport" — not the mode name.
- **Security mechanisms**: how multi-tenant isolation works (UID separation, XAUTHORITY, process groups), Chrome flags used for security, extension-based network isolation.

### Safe to mention
- Capability statements: "stages have relaxed CORS", "WebGL runs at 30 FPS", "GPU stages use NVIDIA RTX"
- User-facing environment: resolution, frame rate, browser (Chrome), persistence (localStorage), audio (Web Audio API)
- Performance numbers: FPS benchmarks, encoding bitrates (CBR 2500k is fine — it's the output quality, not the tool)
- CLI commands and workflows

## Procedure

When writing public content:

1. Draft the content focusing on **what the user can do**, not how it works internally
2. Scan for any terms from the "Never reveal" list above
3. Replace implementation details with capability descriptions:
   - "llvmpipe software renderer" → "Software OpenGL"
   - "Chrome extension injects CORS headers" → "relaxed CORS policy"
   - "RFC1918 addresses are blocked" → (omit entirely)
   - "RunPod GPU nodes" → "GPU stages"
   - "NVENC, CBR 2500k" → "Hardware video encoder, CBR 2500k"
   - "x264 (CPU)" → "Software video encoder"
   - "PulseAudio capture" → "audio captured to the stream"
   - "Chrome, kiosk mode" → "Chrome, full viewport"
   - "shared CPU" → "no hardware GPU"
4. Read the final text as an outsider — could someone reverse-engineer the implementation from what's written?

## Pitfalls

- **Restriction details leak architecture**: saying "localhost and 10.x/172.x/192.168.x are blocked" tells users exactly how network isolation works and implies a shared-host model. Just don't mention restrictions.
- **Chrome flags in docs**: flags like `--use-gl=desktop`, `--load-extension=`, `--remote-debugging-pipe` reveal implementation. Never include these in user-facing content.
- **"Extension" or "middleware"**: these words hint at the mechanism. Use "policy" or just describe the effect.
