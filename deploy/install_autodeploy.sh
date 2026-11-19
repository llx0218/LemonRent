#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run as root: sudo bash $0" >&2; exit 1; fi
APP_DIR=/var/www/LemonRent

cat > /etc/systemd/system/lemonrent-autodeploy.service <<UNIT
[Unit]
Description=Deploy new LemonRent versions that passed tests
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $APP_DIR/deploy/autodeploy.sh
UNIT

cat > /etc/systemd/system/lemonrent-autodeploy.timer <<'UNIT'
[Unit]
Description=Check GitHub for new LemonRent versions every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now lemonrent-autodeploy.timer
systemctl start lemonrent-autodeploy.service || true
tail -n 5 /var/log/lemonrent-autodeploy.log 2>/dev/null || true
systemctl list-timers lemonrent-autodeploy.timer --no-pager
echo "Auto-deploy is on. Log: /var/log/lemonrent-autodeploy.log"
