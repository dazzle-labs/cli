#!/bin/sh
set -e

# Clean up stale sentinel files from previous sessions
rm -f /data/.sync-request /data/.sync-done

LOCKFILE=/tmp/sync.lock
SHUTDOWN=0

do_sync() {
  flock -n "$LOCKFILE" rclone sync /data/ "R2:${R2_BUCKET}/users/$USER_ID/stages/$STAGE_ID/" \
    --include "content/**" \
    --include "chrome/Default/Local Storage/**" \
    --include "chrome/Default/IndexedDB/**" || true
}

final_sync() {
  # Guard against being called twice (trap + sentinel)
  if [ "$SHUTDOWN" = "1" ]; then return; fi
  SHUTDOWN=1
  # Wait for any in-progress sync to finish, then do final sync
  flock "$LOCKFILE" rclone sync /data/ "R2:${R2_BUCKET}/users/$USER_ID/stages/$STAGE_ID/" \
    --include "content/**" \
    --include "chrome/Default/Local Storage/**" \
    --include "chrome/Default/IndexedDB/**"
  touch /data/.sync-done
}

trap 'final_sync; exit 0' TERM

# If R2 is not configured, just sleep forever (sidecar is a no-op)
if [ -z "$RCLONE_CONFIG_R2_ACCESS_KEY_ID" ]; then
  echo "R2 not configured, sidecar idle"
  while true; do
    if [ -f /data/.sync-request ]; then
      touch /data/.sync-done
      exit 0
    fi
    sleep 10
  done
fi

# Ensure watched directories exist (Chrome creates nested dirs later, but we need them for inotifywait)
mkdir -p /data/content "/data/chrome/Default/Local Storage" "/data/chrome/Default/IndexedDB"

# Watch for changes and sync (debounced via inotifywait -t 10)
while true; do
  inotifywait -r -q -t 10 /data/content/ "/data/chrome/Default/Local Storage/" "/data/chrome/Default/IndexedDB/" 2>/dev/null || true
  if [ -f /data/.sync-request ]; then
    final_sync
    exit 0
  fi
  do_sync
done
