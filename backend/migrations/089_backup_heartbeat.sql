-- ============================================================================
-- 089_backup_heartbeat.sql
--
-- Single-row liveness marker for the nightly Supabase backup
-- (.github/workflows/db-backup.yml) — written directly by that workflow via
-- psql immediately after a successful pg_dump, so a silently failing (or
-- silently not-running) backup finally has a queryable trail instead of
-- only a GitHub Actions red X nobody actively watches. Polled by
-- GET /sentinel/backup-heartbeat for the standalone Nuvos Sentinel monitor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS backup_heartbeats (
  id              TEXT PRIMARY KEY,   -- 'nightly_backup'
  last_success_at TIMESTAMPTZ NOT NULL,
  detail          TEXT
);

-- Internal/admin-only, same pattern as security_events (033).
ALTER TABLE backup_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: backup heartbeats" ON backup_heartbeats;
CREATE POLICY "Service: backup heartbeats" ON backup_heartbeats
  FOR ALL TO service_role USING (true) WITH CHECK (true);
