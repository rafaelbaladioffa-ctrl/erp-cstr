#!/bin/sh
# Backup diário do Postgres local (pg_dump --format=custom) — roda via cron
# no host (não dentro de um container), guarda os últimos 14 dias local e
# some com o resto. Local do backup: ~/db_backups no notebook-servidor.
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
. "$PROJECT_DIR/.env"
set +a

BACKUP_DIR="$(dirname "$PROJECT_DIR")/db_backups"
KEEP_DAYS=14
STAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/erp_backup_$STAMP.dump"

mkdir -p "$BACKUP_DIR"

docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" erp-cstr-db-1 \
    pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom -f "/tmp/backup_$STAMP.dump"
docker cp "erp-cstr-db-1:/tmp/backup_$STAMP.dump" "$FILE"
docker exec erp-cstr-db-1 rm -f "/tmp/backup_$STAMP.dump"

echo "Backup salvo em $FILE ($(du -h "$FILE" | cut -f1))"

find "$BACKUP_DIR" -name 'erp_backup_*.dump' -mtime +"$KEEP_DAYS" -delete
