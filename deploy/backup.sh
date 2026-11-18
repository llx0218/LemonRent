#!/bin/sh
set -e
DIR=/var/backups/lemonrent
mkdir -p "$DIR"
chmod 700 "$DIR"
sudo -u postgres pg_dump -Fc lemonrent > "$DIR/lemonrent-$(date -u +%Y%m%d).dump"
find "$DIR" -name 'lemonrent-*.dump' -mtime +30 -delete
