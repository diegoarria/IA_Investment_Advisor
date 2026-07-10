#!/usr/bin/env bash
# ============================================================================
# backup_db.sh — nightly independent Postgres backup.
#
# Why this exists alongside Supabase's own backups: Supabase's Point-in-Time
# Recovery (if enabled on a paid plan) protects against "I need to rewind
# this project to 10 minutes ago." It does NOT protect against losing the
# Supabase project/account itself (billing lapse, account compromise,
# platform-side incident). This script produces a portable pg_dump that can
# be restored into ANY Postgres instance, on any provider — the independent
# second layer a real disaster-recovery plan needs. See
# docs/DISASTER_RECOVERY.md for the full runbook and RTO/RPO targets.
#
# Usage:
#   DATABASE_URL=postgresql://... ./scripts/backup_db.sh
#
# Optional:
#   BACKUP_DIR         where dumps are written before/absent upload (default: ./backups)
#   BACKUP_S3_BUCKET    if set, the dump is uploaded via `aws s3 cp` (requires
#                       the AWS CLI + credentials to already be configured)
#   BACKUP_RETENTION_DAYS  local dumps older than this are pruned (default: 7 —
#                          the durable copy of record should be the S3 upload,
#                          not this local/CI-runner directory)
# ============================================================================
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Get it from Supabase dashboard → Settings → Database → Connection string (use the 'Session pooler' URI for pg_dump)." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILENAME="nuvos_backup_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

echo "[backup_db] Starting pg_dump at ${TIMESTAMP}..."
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${BACKUP_DIR}/${FILENAME}"

DUMP_SIZE=$(du -h "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "[backup_db] Dump complete: ${BACKUP_DIR}/${FILENAME} (${DUMP_SIZE})"

# Sanity check: a 0-byte or near-empty dump is worse than no backup at all
# (false confidence) — fail loudly instead of silently "succeeding."
DUMP_BYTES=$(stat -f%z "${BACKUP_DIR}/${FILENAME}" 2>/dev/null || stat -c%s "${BACKUP_DIR}/${FILENAME}")
if [ "$DUMP_BYTES" -lt 1024 ]; then
  echo "ERROR: dump is suspiciously small (${DUMP_BYTES} bytes) — treating as a failed backup." >&2
  exit 1
fi

if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "[backup_db] Uploading to s3://${BACKUP_S3_BUCKET}/${FILENAME}..."
  aws s3 cp "${BACKUP_DIR}/${FILENAME}" "s3://${BACKUP_S3_BUCKET}/${FILENAME}"
  echo "[backup_db] Upload complete."
else
  echo "[backup_db] WARNING: BACKUP_S3_BUCKET not set — dump is only stored locally at ${BACKUP_DIR}/${FILENAME}." >&2
  echo "[backup_db] This is NOT a durable backup location. Set BACKUP_S3_BUCKET (or equivalent) before relying on this in production." >&2
fi

# Prune local dumps older than retention window — the durable copy of record
# is the S3 (or equivalent) upload above, not this directory.
find "$BACKUP_DIR" -name "nuvos_backup_*.dump" -mtime "+${RETENTION_DAYS}" -delete
echo "[backup_db] Done."
