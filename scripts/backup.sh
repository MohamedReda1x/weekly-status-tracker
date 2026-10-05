#!/bin/sh
# Non-Docker backup (uses DATABASE_URL). Usage: scripts/backup.sh [outfile]
set -e; OUT="${1:-backups/tracker_$(date +%Y%m%d_%H%M%S).dump}"; mkdir -p "$(dirname "$OUT")"
pg_dump -Fc "$DATABASE_URL" -f "$OUT"; pg_restore --list "$OUT" > /dev/null
[ "$(head -c5 "$OUT")" = "PGDMP" ] || { rm -f "$OUT"; echo "invalid dump"; exit 1; }
echo "Backup written and verified: $OUT"
