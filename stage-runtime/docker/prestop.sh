#!/bin/sh
pkill -TERM chrome
sleep 2
pkill -9 chrome 2>/dev/null
