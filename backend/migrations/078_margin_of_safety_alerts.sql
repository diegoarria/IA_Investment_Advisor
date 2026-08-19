-- ============================================================================
-- 078_margin_of_safety_alerts.sql
--
-- Revives saved_valuations (migration 048) for the current Nuvos AI Fair
-- Value Engine instead of the retired manual-DCF-sliders methodology.
-- growth_pct/discount_rate_pct/terminal_growth_pct become nullable (the
-- new save flow never fills them — no manual DCF sliders exist on
-- /subvaluadas anymore, see valuationPanelMode.ts). target_margin_of_
-- safety_pct is the user's own configured alert threshold, replacing the
-- old fixed 6-value milestone ladder. notified_at replaces the
-- notified_milestones ratchet — a single one-shot threshold only ever
-- needs one timestamp, null until it fires, reset to null when the user
-- edits/re-saves their threshold (same "re-saving is a new baseline"
-- rule the old ratchet already followed).
-- ============================================================================

ALTER TABLE saved_valuations
  ALTER COLUMN growth_pct DROP NOT NULL,
  ALTER COLUMN discount_rate_pct DROP NOT NULL,
  ALTER COLUMN terminal_growth_pct DROP NOT NULL;

ALTER TABLE saved_valuations
  ADD COLUMN IF NOT EXISTS target_margin_of_safety_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
