-- ============================================================================
-- 084_real_patrimonio_ath.sql
--
-- "Nuevo máximo histórico" milestone (investor_progress_service.py's
-- _check_new_ath) only ever compares fmg_portfolio_snapshots.total_value —
-- cost basis of stock positions ONLY, never live-priced, never including
-- cash available to invest or dividends received (the exact same gap
-- _real_portfolio_total was built to fix for Home/Wrapped/Morning Brief,
-- 2026-08-30 audit). Diego wants a real all-time-high push based on the
-- TRUE total: live position value + real cash + real dividends.
--
-- That real total was never recorded per historical day (cash/dividend
-- totals aren't snapshotted daily anywhere), so there's no history to
-- retroactively compute a max from — this column is a simple running max,
-- updated the moment a higher real total is observed, seeded silently on
-- first read (never fires a push comparing against a number that was never
-- real to begin with).
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS max_real_patrimonio_usd numeric;
