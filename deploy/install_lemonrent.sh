#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run as root: sudo bash $0 rent.yourdomain.com" >&2; exit 1; fi
APP_DOMAIN="${1:-}"
REPO="${2:-https://github.com/llx0218/LemonRent.git}"
if [ -z "$APP_DOMAIN" ]; then echo "Usage: sudo bash $0 rent.yourdomain.com [git_repo_url]" >&2; exit 1; fi

APP_DIR=/var/www/LemonRent
ENV_FILE=/etc/lemonrent/lemonrent.env
CADDYFILE=/etc/caddy/Caddyfile

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git python3 python3-venv python3-pip postgresql caddy curl
command -v npm >/dev/null || apt-get install -y nodejs npm

id lemonrent >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/lemonrent --shell /usr/sbin/nologin lemonrent

mkdir -p /var/www
if [ ! -d "$APP_DIR/.git" ]; then
  git clone --depth 1 "$REPO" "$APP_DIR"
fi
chown -R lemonrent:lemonrent "$APP_DIR"
sudo -u lemonrent env GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" pull --ff-only \
  || echo "Could not pull updates (private repo without saved credentials); using the code already in $APP_DIR"

sudo -u lemonrent python3 -m venv "$APP_DIR/.venv"
sudo -u lemonrent "$APP_DIR/.venv/bin/pip" install --upgrade pip
sudo -u lemonrent "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

cd "$APP_DIR/web"
sudo -u lemonrent env HOME=/var/lib/lemonrent npm ci
sudo -u lemonrent env HOME=/var/lib/lemonrent npm run build
cd "$APP_DIR"

systemctl enable --now postgresql
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='lemonrent'" | grep -q 1 || sudo -u postgres createuser lemonrent
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='lemonrent'" | grep -q 1 || sudo -u postgres createdb -O lemonrent lemonrent

mkdir -p /etc/lemonrent
if [ ! -f "$ENV_FILE" ]; then
  SECRET_KEY="$("$APP_DIR/.venv/bin/python" -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
  cat > "$ENV_FILE" <<ENV
DATABASE_URL=postgresql+psycopg://lemonrent@/lemonrent
LEMONRENT_SECRET_KEY=$SECRET_KEY
PUBLIC_APP_URL=https://$APP_DOMAIN
CURRENCY=RM
PYTHONPATH=$APP_DIR/src
ENV
fi
chown root:lemonrent "$ENV_FILE"
chmod 640 "$ENV_FILE"

sudo -u lemonrent bash -c "set -a; . $ENV_FILE; set +a; cd $APP_DIR && .venv/bin/alembic upgrade head"

cp "$APP_DIR/deploy/systemd/lemonrent-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable lemonrent-api
systemctl restart lemonrent-api

touch "$CADDYFILE"
if ! grep -q "^# BEGIN lemonrent" "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak.$(date +%s)"
  {
    echo
    echo "# BEGIN lemonrent"
    sed "s/^rent.example.com {/$APP_DOMAIN {/" "$APP_DIR/deploy/Caddyfile.snippet"
    echo "# END lemonrent"
  } >> "$CADDYFILE"
fi
caddy validate --config "$CADDYFILE" --adapter caddyfile
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

install -m 755 "$APP_DIR/deploy/backup.sh" /etc/cron.daily/lemonrent-backup

echo
systemctl --no-pager --lines=0 status lemonrent-api caddy || true
echo
if ! sudo -u postgres psql -d lemonrent -tAc "SELECT 1 FROM users LIMIT 1" | grep -q 1; then
  echo "== Your invite code (use it once on the Create account page) =="
  sudo -u lemonrent bash -c "set -a; . $ENV_FILE; set +a; cd $APP_DIR && .venv/bin/python -m lemonrent.cli invite --admin --note owner"
fi
echo
echo "Portal: https://$APP_DOMAIN"
