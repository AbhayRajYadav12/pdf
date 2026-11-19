#!/usr/bin/env bash
# Restore a directory created by scripts/backup.sh.
# Usage: bash scripts/restore.sh /var/backups/pdf-summary/20260101T000000Z
# Stops the API and worker, replaces MongoDB, PDFs, and Qdrant, then starts them again.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: bash scripts/restore.sh <backup-directory>" >&2
  exit 1
fi

if [[ ! -d "$1" ]]; then
  echo "Backup directory not found: $1" >&2
  exit 1
fi
BACKUP="$(cd "$1" && pwd)"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for required in mongo.archive files.tar.gz qdrant.tar.gz; do
  if [[ ! -f "$BACKUP/$required" ]]; then
    echo "Missing $BACKUP/$required" >&2
    exit 1
  fi
done

if [[ -f "$BACKUP/SHA256SUMS" ]]; then
  (cd "$BACKUP" && sha256sum -c SHA256SUMS)
fi

if [[ "${BACKUP_COMPOSE:-public}" == "local" ]]; then
  COMPOSE=(docker compose --project-directory "$ROOT" -f infrastructure/docker-compose.yml)
else
  COMPOSE=(docker compose --project-directory "$ROOT" -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.public.yml)
fi

container_id() {
  local ids
  ids="$("${COMPOSE[@]}" ps -aq "$1")"
  printf '%s\n' "${ids%%$'\n'*}"
}

volume_name() {
  local id="$1"
  local destination="$2"
  docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "'"$destination"'" }}{{ .Name }}{{ end }}{{ end }}' "$id"
}

API_ID="$(container_id api)"
QDRANT_ID="$(container_id qdrant)"
MONGO_ID="$(container_id mongo)"
if [[ -z "$API_ID" || -z "$QDRANT_ID" || -z "$MONGO_ID" ]]; then
  echo "Start the stack once before restoring, so the containers and volumes exist." >&2
  exit 1
fi

FILES_VOL="$(volume_name "$API_ID" /data/documents)"
QDRANT_VOL="$(volume_name "$QDRANT_ID" /qdrant/storage)"
if [[ -z "$FILES_VOL" || -z "$QDRANT_VOL" ]]; then
  echo "Could not resolve the files or Qdrant volume." >&2
  exit 1
fi

stopped=0
bring_back() {
  if [[ "$stopped" -eq 1 ]]; then
    "${COMPOSE[@]}" start qdrant api worker || true
    stopped=0
  fi
}
trap bring_back EXIT

echo "Stopping API, worker, and Qdrant"
"${COMPOSE[@]}" stop api worker qdrant
stopped=1

echo "Restoring MongoDB"
"${COMPOSE[@]}" exec -T mongo mongorestore --drop --archive < "$BACKUP/mongo.archive"

echo "Restoring PDF files"
docker run --rm --entrypoint sh \
  -v "${FILES_VOL}:/data" \
  -v "$BACKUP:/backup:ro" \
  mongo:7 \
  -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf /backup/files.tar.gz -C /data'

echo "Restoring Qdrant storage"
docker run --rm --entrypoint sh \
  -v "${QDRANT_VOL}:/qdrant/storage" \
  -v "$BACKUP:/backup:ro" \
  mongo:7 \
  -c 'find /qdrant/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf /backup/qdrant.tar.gz -C /qdrant/storage'

echo "Starting Qdrant, API, and worker"
bring_back
trap - EXIT
echo "Restore finished from $BACKUP"
echo "Check GET /api/ready, then open a document that existed in this backup."
