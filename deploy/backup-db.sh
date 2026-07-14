#!/bin/bash
set -euo pipefail
cd /srv/sim-waimai

mkdir -p backups
STAMP=$(date +%F)
FILE="sim_waimai_${STAMP}.sql.gz"

docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U postgres sim_waimai | gzip > "backups/${FILE}"

# Local retention: drop anything older than 7 days.
find backups -name '*.sql.gz' -mtime +7 -delete

# Upload today's dump to COS and let the script clean up stale COS-side backups too.
docker run --rm --env-file .env -v "$(pwd):/app" -w /app node:20-alpine node deploy/backup-upload.mjs "${FILE}"
