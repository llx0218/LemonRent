#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run as root: sudo bash $0" >&2; exit 1; fi
APP_DIR=/var/www/LemonRent
ENV_FILE=/etc/lemonrent/lemonrent.env
sudo -u lemonrent env GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" pull --ff-only
sudo -u lemonrent "$APP_DIR/.venv/bin/pip" install -q -r "$APP_DIR/requirements.txt"
cd "$APP_DIR/web"
sudo -u lemonrent env HOME=/var/lib/lemonrent npm ci --silent
sudo -u lemonrent env HOME=/var/lib/lemonrent npm run build
cd "$APP_DIR"
sudo -u lemonrent bash -c "set -a; . $ENV_FILE; set +a; cd $APP_DIR && .venv/bin/alembic upgrade head"
systemctl restart lemonrent-api
sleep 2
systemctl is-active lemonrent-api
curl -s http://127.0.0.1:8100/api/health; echo
sudo -u lemonrent git -C "$APP_DIR" log --oneline -1
