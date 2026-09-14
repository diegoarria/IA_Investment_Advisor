-- ============================================================================
-- 096_business_overview_snapshots.sql
--
-- Diego, 2026-09-14 — /admin/overview showed only a same-day snapshot (total
-- users, MRR, DAU/WAU/MAU, etc.) with no way to see whether any of it is
-- trending up or down week over week. One row per day, aggregate business
-- metrics only — NOT per-user data, so this table is intentionally left out
-- of delete_user_data (there's no user_id column to delete by).
-- ============================================================================

CREATE TABLE IF NOT EXISTS business_overview_snapshots (
  snapshot_date            DATE PRIMARY KEY,
  total_users              INT NOT NULL,
  premium_count            INT NOT NULL,
  manual_comp_count        INT NOT NULL,
  trialing_count           INT NOT NULL,
  free_count               INT NOT NULL,
  signups_last_7d          INT NOT NULL,
  signups_last_30d         INT NOT NULL,
  -- Stripe fields nullable — a source outage on a given day shouldn't block
  -- the rest of the snapshot from being written (see snapshot_business_
  -- overview's docstring in business_overview_service.py).
  mrr_usd                  NUMERIC,
  active_subscriptions     INT,
  trialing_subscriptions   INT,
  cancellations_last_30d   INT,
  churn_rate_pct_30d       NUMERIC,
  dau                      INT,
  wau                      INT,
  mau                      INT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE business_overview_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: business overview snapshots" ON business_overview_snapshots;
CREATE POLICY "Service: business overview snapshots" ON business_overview_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);
