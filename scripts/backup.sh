#!/usr/bin/env bash
# Backup MongoDB, the Qdrant storage volume, and the PDF volume.
# Run on the VM from any directory: bash scripts/backup.sh
# Copy the resulting directory off the VM. A copy on the same disk is lost with the VM.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${BACKUP_COMPOSE:-public}" == "local" ]]; then
  COMPOSE=(docker compose --project-directory "$ROOT" -f infrastructure/docker-compose.yml)
else
  COMPOSE=(docker compose --project-directory "$ROOT" -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.public.yml)
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_DIR:-/var/backups/pdf-summary}/$STAMP"
mkdir -p "$DEST"

echo "Writing backup to $DEST"

"${COMPOSE[@]}" exec -T mongo mongodump --db pdf_summary --archive > "$DEST/mongo.archive"
"${COMPOSE[@]}" exec -T api tar -C /data/documents -czf - . > "$DEST/files.tar.gz"

QDRANT_ID="$("${COMPOSE[@]}" ps -aq qdrant)"
QDRANT_ID="${QDRANT_ID%%$'\n'*}"
if [[ -z "$QDRANT_ID" ]]; then
  echo "Qdrant container does not exist. Start the stack before backing up." >&2
  exit 1
fi
QDRANT_VOL="$(docker inspect -f '{{ range .Mounts }}{{ if eq .Destination "/qdrant/storage" }}{{ .Name }}{{ end }}{{ end }}' "$QDRANT_ID")"
if [[ -z "$QDRANT_VOL" ]]; then
  echo "Could not find the Qdrant volume on $QDRANT_ID" >&2
  exit 1
fi

qdrant_stopped=0
start_qdrant() {
  if [[ "$qdrant_stopped" -eq 1 ]]; then
    "${COMPOSE[@]}" start qdrant || true
    qdrant_stopped=0
  fi
}
trap start_qdrant EXIT

echo "Stopping Qdrant so its storage files are a consistent copy"
"${COMPOSE[@]}" stop qdrant
qdrant_stopped=1
docker run --rm --entrypoint tar \
  -v "${QDRANT_VOL}:/qdrant/storage:ro" \
  -v "$DEST:/backup" \
  mongo:7 \
  -C /qdrant/storage -czf /backup/qdrant.tar.gz .
start_qdrant
trap - EXIT

(
  cd "$DEST"
  sha256sum mongo.archive files.tar.gz qdrant.tar.gz > SHA256SUMS
)

echo "Backup complete: $DEST"
echo "Copy this directory off the VM. A copy that stays on the same disk does not survive VM loss."
