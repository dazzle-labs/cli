#!/bin/sh
pkill -TERM chrome
sleep 2
pkill -9 chrome 2>/dev/null
touch /data/.sync-request
for i in $(seq 1 50); do
  [ -f /data/.sync-done ] && break
  sleep 0.5
done
