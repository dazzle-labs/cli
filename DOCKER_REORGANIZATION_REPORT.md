# Docker Files Reorganization Report

**Date:** March 3, 2026
**Status:** COMPLETED

## Summary

Successfully reorganized Docker files from a flat root `docker/` directory to a component-nested structure. All files have been moved using `git mv` to preserve git history, and all references have been updated across the codebase.

## New Directory Structure

```
browser-streamer/
├── streamer/
│   ├── docker/
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh
│   │   └── pulse-default.pa
│   ├── index.js
│   ├── package.json
│   └── Makefile
├── control-plane/
│   ├── docker/
│   │   └── Dockerfile
│   ├── main.go
│   ├── go.mod
│   └── Makefile
├── web/
│   ├── package.json
│   └── Makefile
├── Makefile (root)
├── provision.sh
├── CLAUDE.md
└── .dockerignore
```

## Files Moved

All moves performed using `git mv` for complete history preservation:

| Old Path | New Path | Type |
|----------|----------|------|
| `docker/Dockerfile` | `streamer/docker/Dockerfile` | Streamer image definition |
| `docker/entrypoint.sh` | `streamer/docker/entrypoint.sh` | Streamer entrypoint script |
| `docker/pulse-default.pa` | `streamer/docker/pulse-default.pa` | PulseAudio configuration |
| `docker/Dockerfile.control-plane` | `control-plane/docker/Dockerfile` | Control-plane image (renamed) |

## References Updated

### 1. `/Users/johnsabath/projects/browser-streamer/streamer/Makefile`

**Changed:**
```makefile
# OLD:
scp -r ../docker/ . root@$(HOST):/tmp/browser-streamer-build/

# NEW:
scp -r docker/ . root@$(HOST):/tmp/browser-streamer-build/
```

**Rationale:** The streamer/docker directory is now local to the streamer component.

### 2. `/Users/johnsabath/projects/browser-streamer/control-plane/Makefile`

**Changed:**
```makefile
# OLD:
scp ../docker/Dockerfile.control-plane root@$(HOST):/tmp/control-plane-build/Dockerfile

# NEW:
scp docker/Dockerfile root@$(HOST):/tmp/control-plane-build/Dockerfile
```

**Rationale:** The control-plane Dockerfile is now in control-plane/docker/Dockerfile.

### 3. `/Users/johnsabath/projects/browser-streamer/provision.sh`

**Streamer Image Build (Step 7):**
```bash
# OLD:
scp -r docker/ streamer/ "root@${HOST}:/tmp/browser-streamer-build/"
${SSH} "cd /tmp/browser-streamer-build && buildctl build \
    --frontend=dockerfile.v0 \
    --local context=. \
    --local dockerfile=docker \
    ..."

# NEW:
scp -r streamer/ "root@${HOST}:/tmp/browser-streamer-build/"
${SSH} "cd /tmp/browser-streamer-build && buildctl build \
    --frontend=dockerfile.v0 \
    --local context=streamer \
    --local dockerfile=streamer/docker \
    ..."
```

**Control-plane Image Build (Step 8):**
```bash
# OLD:
scp -r control-plane/ viewer.html "root@${HOST}:/tmp/control-plane-build/"
scp docker/Dockerfile.control-plane "root@${HOST}:/tmp/control-plane-build/Dockerfile"

# NEW:
scp -r control-plane/ web/ "root@${HOST}:/tmp/control-plane-build/"
scp control-plane/docker/Dockerfile "root@${HOST}:/tmp/control-plane-build/Dockerfile"
```

**Rationale:** Reflected new component structure and directory names (dashboard → web).

### 4. `/Users/johnsabath/projects/browser-streamer/CLAUDE.md`

**Changed:**
```markdown
# OLD:
2. **Streamer Pod** (`streamer/index.js` + `docker/entrypoint.sh`) — ...

# NEW:
2. **Streamer Pod** (`streamer/index.js` + `streamer/docker/entrypoint.sh`) — ...
```

**Rationale:** Updated documentation to reflect new file locations.

## Empty Directory Removal

The root `docker/` directory was empty after all files were moved and has been removed.

## Build Workflow Examples

### Component-Level Builds

**Streamer Component:**
```bash
cd /Users/johnsabath/projects/browser-streamer/streamer
make build
```

**Control-Plane Component:**
```bash
cd /Users/johnsabath/projects/browser-streamer/control-plane
make build
```

### Root-Level Builds

```bash
cd /Users/johnsabath/projects/browser-streamer
make build                  # Builds both streamer and control-plane
make build-streamer         # Builds only streamer
make build-control-plane    # Builds only control-plane
```

### Provision from Scratch

```bash
./provision.sh 5.78.145.53 my-secret-token
```

This script now correctly references:
- `streamer/docker/Dockerfile`
- `control-plane/docker/Dockerfile`

## Dockerfile Validation

Both Dockerfiles remain valid and unchanged in their content:

**Streamer Dockerfile** (`streamer/docker/Dockerfile`)
- Base: `ubuntu:24.04`
- Installs: Xvfb, PulseAudio, OBS Studio, Chrome, Node.js
- Copies: streamer code, PulseAudio config, entrypoint script
- Entry: `/entrypoint.sh`
- Ports: 8080

**Control-Plane Dockerfile** (`control-plane/docker/Dockerfile`)
- Multi-stage build: node:24-alpine (web), golang:1.25-alpine (builder), alpine:3.19 (final)
- Builds: Web frontend + Go control-plane binary
- Includes: gobs-cli CLI utility
- Entry: `./control-plane`
- Ports: 8080

## Git History Preservation

All file moves were performed using `git mv`, preserving complete commit history for:
- `streamer/docker/Dockerfile` (originally `docker/Dockerfile`)
- `streamer/docker/entrypoint.sh` (originally `docker/entrypoint.sh`)
- `streamer/docker/pulse-default.pa` (originally `docker/pulse-default.pa`)
- `control-plane/docker/Dockerfile` (originally `docker/Dockerfile.control-plane`)

## Benefits of New Structure

1. **Component Ownership:** Each component owns its Docker artifacts
2. **Clear Boundaries:** No ambiguity about which Docker files belong to which component
3. **Scalability:** Easy to add new components with their own Docker workflows
4. **Reduced Root Clutter:** Root directory only contains root-level Makefile and orchestration scripts
5. **Logical Organization:** Related files (build definition, entrypoint, configs) are colocated

## Verification Checklist

- [x] All Docker files moved using git mv
- [x] streamer/docker/ directory created with 3 files (Dockerfile, entrypoint.sh, pulse-default.pa)
- [x] control-plane/docker/ directory created with 1 file (Dockerfile)
- [x] streamer/Makefile updated: references local docker/ instead of ../docker/
- [x] control-plane/Makefile updated: references docker/Dockerfile instead of ../docker/Dockerfile.control-plane
- [x] provision.sh updated: correctly references new paths for both streamer and control-plane builds
- [x] CLAUDE.md updated: documentation reflects new file locations
- [x] Root docker/ directory removed (was empty)
- [x] Makefile syntax validation passed
- [x] No broken paths in any build scripts
- [x] Git history preserved for all moved files

## Testing Recommendations

1. **Dry-run Makefiles:**
   ```bash
   make -n -C streamer build
   make -n -C control-plane build
   ```

2. **Verify buildctl would work:**
   ```bash
   # In streamer directory:
   cat docker/Dockerfile  # Should be readable
   cat docker/entrypoint.sh  # Should be readable
   cat docker/pulse-default.pa  # Should be readable

   # In control-plane directory:
   cat docker/Dockerfile  # Should be readable
   ```

3. **Full provision test (on remote host):**
   ```bash
   ./provision.sh 5.78.145.53 test-token
   ```

## Related Files Not Modified

The following files reference Docker but required no changes:
- `.dockerignore` - remains at root (applies to all Docker builds via buildkit)
- Root `Makefile` - delegates to component Makefiles
- `k8s/` manifests - unchanged (reference image names, not file paths)

## Future Improvements

1. Consider adding component-level `.dockerignore` files if needed
2. Consider adding component-level docker build caching configurations
3. Consider CI/CD integration tests for Docker builds
4. Consider versioning strategy for Docker images
