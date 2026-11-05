-- Migration 120: price_alerts range support ("Mi Precio Objetivo"),
-- 2026-11-05.
--
-- Why: the existing price_alerts table (032_rls_hardening.sql) only
-- supports a single above/below threshold, and feeds a dead code path
-- — check_custom_price_alerts() / scan_and_notify_all_users() /
-- run_notifications() (backend/app/services/notification_service.py)
-- is defined but never scheduled or called anywhere in worker.py
-- (confirmed by repo-wide grep, 2026-11-05). This migration extends
-- the table to also store a true price RANGE (target_price = low
-- bound, new target_price_high = high bound, condition = 'range'),
-- for the stock-detail "Mi Precio Objetivo" widget. 'above'/'below'
-- are kept for backward compat with the existing subvaluadas "Mi Zona
-- de Compra" feature (FollowAlertPanel.tsx), which only ever writes
-- condition='below'.
--
-- UNIQUE(user_id, ticker) is kept as-is — a user gets exactly one
-- active target per ticker, the same invariant the table already
-- enforced. Saving a "Mi Precio Objetivo" range for a ticker that
-- already has a subvaluadas 'below' alert overwrites that row — same
-- behavior the table already has between re-saves of the same alert
-- type, just now also across alert types. Deliberate: both features
-- share the same table/row by design.
--
-- Rollback:
--   ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_range_bounds_check;
--   ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_condition_check;
--   ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_condition_check
--     CHECK (condition IN ('above', 'below'));
--   ALTER TABLE price_alerts DROP COLUMN IF EXISTS target_price_high;
--   (Any existing condition='range' rows must be deleted/migrated BEFORE
--   re-adding the narrower CHECK, or the ALTER will fail.)

ALTER TABLE price_alerts ADD COLUMN IF NOT EXISTS target_price_high NUMERIC NULL;

ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_condition_check;
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_condition_check
  CHECK (condition IN ('above', 'below', 'range'));

-- Guard: a 'range' row must always carry both bounds, low < high.
ALTER TABLE price_alerts DROP CONSTRAINT IF EXISTS price_alerts_range_bounds_check;
ALTER TABLE price_alerts ADD CONSTRAINT price_alerts_range_bounds_check
  CHECK (
    condition != 'range'
    OR (target_price_high IS NOT NULL AND target_price_high > target_price)
  );
