#!/bin/sh
set -e

# Clean up stale sentinel files before restore
rm -f /data/.sync-request /data/.sync-done

# Restore from R2 on stage start (no-op if R2 path is empty or R2 not configured)
if [ -n "$RCLONE_CONFIG_R2_ACCESS_KEY_ID" ]; then
  rclone sync "R2:${R2_BUCKET}/users/$USER_ID/stages/$STAGE_ID/" /data/ \
    --include "content/**" \
    --include "chrome/Default/Local Storage/**" \
    --include "chrome/Default/IndexedDB/**" || true
fi

# Ensure directories exist even if R2 is empty
mkdir -p /data/content /data/chrome
