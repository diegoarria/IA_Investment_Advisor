-- ============================================================================
-- 067_smart_alerts.sql
--
-- Fase 4, Incremento 10 (Alertas Inteligentes, Parte J — see
-- /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): bridges
-- signals Fase 2/3 ALREADY compute into push notifications. No new
-- detection logic — only 5 toggles, each backed by a real existing signal
-- (see app/services/smart_alerts_service.py's module docstring for exactly
-- which engine output backs each category). Deliberately excludes "moat
-- change"/"capital allocation change" from the original 8-category brief —
-- neither has a real detected-change signal anywhere in the codebase today,
-- and inventing one would violate this phase's own rule against new
-- financial/detection logic (confirmed with the user before building this).
--
-- smart_alert_state: one row per (user, ticker, category) — the LAST real
-- value seen for that category on that ticker, so the daily job can detect
-- a genuine transition instead of re-notifying the same state every day.
-- Same "store last-seen state, compare, notify on change" pattern as
-- saved_valuations.notified_milestones (Incremento 9's sibling job),
-- generalized into its own table since (unlike saved valuations) there's
-- no natural per-user row to attach this state to for arbitrary watchlist
-- tickers.
-- ============================================================================

CREATE TABLE IF NOT EXISTS smart_alert_state (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      TEXT NOT NULL,
  category    TEXT NOT NULL,  -- 'thesis_change' | 'guidance_change' | 'roic_fcf_deterioration' | 'new_risk' | 'price_in_range'
  last_value  TEXT,           -- last real value seen (event id, direction, risk-list hash, 'in_range'/'out_of_range')
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker, category)
);

CREATE INDEX IF NOT EXISTS idx_smart_alert_state_lookup ON smart_alert_state (user_id, ticker);

ALTER TABLE smart_alert_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own smart alert state" ON smart_alert_state;
CREATE POLICY "Users manage own smart alert state" ON smart_alert_state
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5 new push toggles, same DEFAULT true convention as every existing
-- push_* column in this table (migration 011).
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_thesis_changes         BOOLEAN DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_guidance_changes        BOOLEAN DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_roic_fcf_deterioration  BOOLEAN DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_new_risks               BOOLEAN DEFAULT true;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS push_price_in_range          BOOLEAN DEFAULT true;
