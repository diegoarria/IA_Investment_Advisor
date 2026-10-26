-- ============================================================================
-- 118_system_event_log.sql
--
-- Diego, 2026-10-26: "un panel de salud del sistema... en vez de enterarte
-- por quejas de usuarios o porque yo lo encuentro buceando en Railway."
--
-- Generic, append-only log for background-job/system failures that aren't
-- already captured elsewhere. Pushes themselves are NOT logged here —
-- notification_log (migration 011) already records every send attempt
-- with status in ('sent','failed','skipped'), so the health panel reads
-- that table directly instead of duplicating it.
--
-- What IS new here, written by app/services/system_health.py:
--   - "broker_sync_failed"  — job_sync_connected_brokers per-user/provider
--     failure (Plaid/IOL/IBKR Flex)
--   - "arthur_fallback"     — Arthur's primary model + Haiku retry both
--     failed and the chat fell through to the generic GPT-mini answer
--   - "arthur_total_failure" — even the generic fallback failed (user got
--     a 503)
--
-- This only has data from the moment it's deployed forward — there is no
-- historical backfill, by nature of being a new log.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS system_event_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,
  detail      TEXT,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sys_event_type_created ON system_event_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sys_event_created       ON system_event_log(created_at DESC);

ALTER TABLE system_event_log ENABLE ROW LEVEL SECURITY;
-- Admin-only, same as subscription_audit_log — no user-facing policy,
-- read/written exclusively via the backend's service-role key.

COMMIT;
