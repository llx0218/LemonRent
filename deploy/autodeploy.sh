#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/var/www/LemonRent
REPO=llx0218/LemonRent
BRANCH=main
LOG=/var/log/lemonrent-autodeploy.log

sudo -u lemonrent env GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" fetch -q origin "$BRANCH"
LOCAL=$(sudo -u lemonrent git -C "$APP_DIR" rev-parse HEAD)
REMOTE=$(sudo -u lemonrent git -C "$APP_DIR" rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0

STATE=$(curl -fsS -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/$REPO/commits/$REMOTE/check-runs" \
  | python3 -c '
import json, sys
runs = json.load(sys.stdin).get("check_runs", [])
if not runs or any(r["status"] != "completed" for r in runs):
    print("pending")
elif all(r["conclusion"] in ("success", "skipped", "neutral") for r in runs):
    print("success")
else:
    print("failed")
') || STATE=unknown

if [ "$STATE" != "success" ]; then
  echo "$(date -Is) ${REMOTE:0:7} not deployed: tests $STATE" >> "$LOG"
  exit 0
fi

echo "$(date -Is) deploying ${REMOTE:0:7}" >> "$LOG"
if bash "$APP_DIR/deploy/update.sh" >> "$LOG" 2>&1; then
  echo "$(date -Is) deployed ${REMOTE:0:7}" >> "$LOG"
else
  echo "$(date -Is) deploy of ${REMOTE:0:7} FAILED" >> "$LOG"
  exit 1
fi
