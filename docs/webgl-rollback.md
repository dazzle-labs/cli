# WebGL Rollback Procedure

## If WebGL causes problems:

### 1. Immediate (per-stage)
Set env var `DISABLE_WEBGL=true` on streamer pod to disable WebGL without rebuilding.

```bash
kubectl set env deployment/streamer-<stage-id> DISABLE_WEBGL=true
```

Chrome will revert to `--disable-gpu`.

### 2. Full rollback (all stages)

Change `STREAMER_CHROME_FLAGS` in `k8s/control-plane/deployment.yaml`:
replace `--use-gl=desktop` with `--disable-gpu`, then redeploy.

### 3. Testing rollback

Verify Chrome args:

```bash
kubectl exec <pod> -- ps aux | grep chrome
```

Should show `--disable-gpu` instead of `--use-gl=desktop`.

Create test stage without WebGL and verify it still works.
