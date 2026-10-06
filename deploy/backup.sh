#!/usr/bin/env bash
# Dumps the Sprout database to a gzipped SQL file and keeps the newest 14.
# Run from the deploy folder (needs .env with MYSQL_URL and Docker):
#   ./backup.sh            # backups go to ~/sprout-backups
#   crontab: 17 3 * * * cd /opt/sprout/deploy && ./backup.sh >> ~/sprout-backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")"
set -a; . ./.env; set +a
: "${MYSQL_URL:?MYSQL_URL is not set in .env}"

OUT_DIR="${BACKUP_DIR:-$HOME/sprout-backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"

# Split mysql://user:pass@host:port/db into parts (handles URL-encoded passwords).
eval "$(python3 - <<'PY'
import os, shlex
from urllib.parse import urlparse, unquote
u = urlparse(os.environ["MYSQL_URL"])
for key, val in {
    "DB_USER": unquote(u.username or ""),
    "DB_PASS": unquote(u.password or ""),
    "DB_HOST": u.hostname or "",
    "DB_PORT": str(u.port or 3306),
    "DB_NAME": u.path.lstrip("/"),
}.items():
    print(f"{key}={shlex.quote(val)}")
PY
)"

SSL_ARGS=()
[ "${MYSQL_SSL:-false}" = "true" ] && SSL_ARGS=(--ssl-mode=REQUIRED)

# --no-tablespaces: shared hosts like DreamHost don't grant the PROCESS privilege.
docker run --rm -e MYSQL_PWD="$DB_PASS" ${DOCKER_NETWORK:+--network "$DOCKER_NETWORK"} mysql:8.4 \
  mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" "${SSL_ARGS[@]}" \
  --single-transaction --no-tablespaces --default-character-set=utf8mb4 "$DB_NAME" \
  | gzip > "$OUT_DIR/sprout_$STAMP.sql.gz"

echo "Wrote $OUT_DIR/sprout_$STAMP.sql.gz ($(du -h "$OUT_DIR/sprout_$STAMP.sql.gz" | cut -f1))"
# Keep the newest 14.
ls -1t "$OUT_DIR"/sprout_*.sql.gz | tail -n +15 | xargs -r rm --
