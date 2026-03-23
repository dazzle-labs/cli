#!/usr/bin/env bash
# Mock dazzle CLI for VHS recordings.
set -euo pipefail

# Colors
G='\033[38;2;52;211;153m'  # emerald (success)
C='\033[38;2;96;165;250m'  # blue (URLs)
D='\033[38;2;161;161;170m' # zinc-400 (dim)
R='\033[0m'                # reset

CMD="$*"

case "$CMD" in
  "stage create demo")
    sleep 0.3
    echo -e "Stage \"demo\" created."
    ;;
  "stage up")
    sleep 1.5
    echo -e "Stage \"demo\" activated (status: running)"
    echo -e "Watch:  ${C}https://dazzle.fm/preview/a8f2k${R}"
    ;;
  "stage sync"*)
    sleep 0.4
    dir=$(echo "$CMD" | awk '{print $3}')
    n=$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')
    echo -e "${n} files synced."
    ;;
  "stage screenshot -o preview.png")
    sleep 0.5
    echo "preview.png"
    ;;
  "stage event emit"*|"stage ev e"*)
    sleep 0.2
    event=$(echo "$CMD" | awk '{print $4}')
    echo -e "Event \"${event}\" emitted."
    ;;
  "destination attach"*)
    sleep 0.4
    dest=$(echo "$CMD" | awk '{print $3}')
    echo -e "Destination \"${dest}\" attached to stage."
    ;;
  "stage status")
    sleep 0.3
    echo -e "Name:   demo"
    echo -e "Status: running"
    echo -e "Watch:  ${C}https://dazzle.fm/preview/a8f2k${R}"
    echo -e "Broadcast: active (fps=30.0)"
    ;;
  "stage down")
    sleep 0.4
    echo -e "Stage \"demo\" deactivated."
    ;;
  *)
    echo "Unknown mock command: $CMD" >&2
    exit 1
    ;;
esac
