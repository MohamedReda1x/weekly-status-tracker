#!/bin/sh
# Non-Docker restore (REPLACES data of DATABASE_URL). Usage: scripts/restore.sh file.dump [--yes]
[ -f "$1" ] || { echo "ERROR: file not found"; exit 1; }
[ "$(head -c5 "$1")" = "PGDMP" ] || { echo "ERROR: not a pg_dump custom archive"; exit 1; }
pg_restore --list "$1" > /dev/null || { echo "ERROR: corrupted dump, nothing changed"; exit 1; }
if [ "$2" != "--yes" ]; then printf "Type RESTORE to replace ALL data: "; read a; [ "$a" = "RESTORE" ] || { echo "Cancelled"; exit 1; }; fi
pg_restore --single-transaction --clean --if-exists --no-owner -d "$DATABASE_URL" "$1" || { echo "ERROR: restore failed and was rolled back"; exit 1; }
echo "Restore completed from $1"
