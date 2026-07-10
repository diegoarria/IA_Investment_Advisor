-- ============================================================================
-- 033_security_events.sql
--
-- Audit trail for authentication abuse: failed logins, lockouts, password
-- reset abuse. Written by app/core/security.py — never blocks a request if
-- this insert fails (best-effort logging), but gives a real queryable trail
-- instead of only ephemeral log lines for incident response / abuse review.
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,       -- 'login_failed' | 'login_lockout' | 'password_reset_code_failed' | 'password_reset_lockout' | ...
  email       TEXT,
  ip_address  TEXT,
  user_id     UUID,                -- nullable: most brute-force events happen pre-auth, with no known user_id yet
  detail      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_email      ON security_events(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_ip         ON security_events(ip_address, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_type_time  ON security_events(event_type, created_at DESC);

-- No end-user ever reads this table directly (no app UI surfaces it) — it's
-- an internal/admin audit log. Only the backend's service_role writes or
-- reads it; RLS enabled with zero user-facing policies is intentional here
-- (mirrors benchmark_cohort_stats' pattern from 032), with an explicit
-- service_role policy per this project's now-standard defensive pattern.
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: security events" ON security_events;
CREATE POLICY "Service: security events" ON security_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
