-- ============================================================================
-- 081_paid_1on1_sessions.sql
--
-- Closes a real gap found in a 2026-08-20 audit: paying for a 1:1 session
-- (the "session" upsell offer or the $20 "broker_call") landed the user on
-- the same PUBLIC Calendly link shown to everyone, paid or not — nothing in
-- the backend ever recorded that a specific Stripe payment happened, so the
-- payment→booking step had zero automated verification (100% manual
-- reconciliation by Diego against Stripe's dashboard).
--
-- paid_1on1_sessions is a durable credit balance, mirroring the existing
-- free_1on1_sessions column (referral-earned free sessions) but for PAID
-- sessions — kept separate rather than merged into free_1on1_sessions since
-- that column is user-facing as "sesiones gratis" and conflating a paid
-- credit into it would be misleading in the DB and in any UI that reads it.
--
-- redeemed_1on1_checkouts is the idempotency ledger: POST
-- /upsells/verify-1on1-payment grants credits by inserting the Stripe
-- checkout session id here first — a unique-violation on retry (page
-- reload, double-tap) means this exact payment was already credited, so it
-- never double-grants no matter how many times verification is re-run for
-- the same session_id.
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS paid_1on1_sessions integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS redeemed_1on1_checkouts (
  stripe_session_id text PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offer              text NOT NULL,
  credits_granted    integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redeemed_1on1_checkouts_user ON redeemed_1on1_checkouts(user_id);

-- Same defense-in-depth reasoning as 076_rls_daily_questions.sql — the anon
-- key is intentionally exposed client-side, so every table needs RLS
-- enabled explicitly rather than relying on an unverified assumption that
-- service_role bypasses it. Only the backend (service_role) ever touches
-- this table; no legitimate client-side Supabase call needs to.
ALTER TABLE redeemed_1on1_checkouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: redeemed 1on1 checkouts" ON redeemed_1on1_checkouts;
CREATE POLICY "Service: redeemed 1on1 checkouts" ON redeemed_1on1_checkouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
