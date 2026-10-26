-- ============================================================================
-- 117_subscription_audit_log.sql
--
-- Diego, 2026-10-26: "quién (tú, Stripe, un cron) cambió el plan de cada
-- usuario y cuándo" — after repeatedly hitting "por qué cambió a Free sin
-- que yo lo tocara" (manual_comp downgrade bug, the Oct 21-22 lapsed-
-- premium_until incident) with no way to answer it except grepping
-- Railway logs, every write site that changes a user's subscription_tier/
-- subscription_source/premium_until now also writes one row here — see
-- app/services/subscription_audit.py.
--
-- Deliberately append-only and minimal: no "old value" column. The
-- previous row for the same user IS the old value — a chronological feed
-- per user already tells the whole story without duplicating state that
-- can drift from the real one in user_profiles.
--
-- `premium_until` here is NULL whenever that specific write didn't touch
-- the column (e.g. a plain tier downgrade) — NOT evidence it was cleared.
-- Compare against the next row's premium_until (or user_profiles' current
-- value) for "what is it now," not this column alone.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS subscription_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  actor           TEXT NOT NULL,   -- e.g. "admin:diego@...", "stripe_webhook:checkout.session.completed", "stripe_self_heal"
  tier            TEXT,            -- subscription_tier this write set, if any
  source          TEXT,            -- subscription_source this write set, if any
  premium_until   TIMESTAMPTZ,     -- premium_until this write set, if any (see note above)
  reason          TEXT,            -- short human-readable context
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_audit_user     ON subscription_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sub_audit_created   ON subscription_audit_log(created_at DESC);

ALTER TABLE subscription_audit_log ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT policy for the anon/authenticated roles on purpose —
-- this is an admin-only trail, read and written exclusively via the
-- backend's service-role key (which bypasses RLS), the same way
-- notification_analytics has no user-facing policy either.

COMMIT;
