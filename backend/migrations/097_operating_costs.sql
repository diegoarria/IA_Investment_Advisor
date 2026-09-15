-- ============================================================================
-- 097_operating_costs.sql
--
-- Diego, 2026-09-14 — /admin/overview should show real margins, not just
-- MRR. LLM/token cost is already tracked live (llm_usage_log) and Stripe
-- processing fees are queryable live from Stripe, but the rest of Nuvos's
-- monthly bill (FMP, Finnhub, fiscal.ai, Railway, Vercel, Twilio, etc.) are
-- flat-rate/usage plans with no per-call billing API to pull from — so
-- Diego enters them here once and edits them from the dashboard whenever a
-- plan changes. One row per platform, aggregate-only (no user_id).
-- ============================================================================

CREATE TABLE IF NOT EXISTS operating_costs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,   -- e.g. "FMP", "Finnhub", "Railway", "Vercel", "Twilio"
  monthly_usd   NUMERIC NOT NULL DEFAULT 0,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE operating_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: operating costs" ON operating_costs;
CREATE POLICY "Service: operating costs" ON operating_costs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trend charts for the new margin section need the same day-over-day
-- history the rest of /admin/overview already has.
ALTER TABLE business_overview_snapshots ADD COLUMN IF NOT EXISTS llm_cost_usd_30d NUMERIC;
ALTER TABLE business_overview_snapshots ADD COLUMN IF NOT EXISTS stripe_fees_usd_30d NUMERIC;
ALTER TABLE business_overview_snapshots ADD COLUMN IF NOT EXISTS fixed_costs_usd NUMERIC;
ALTER TABLE business_overview_snapshots ADD COLUMN IF NOT EXISTS margin_usd NUMERIC;
ALTER TABLE business_overview_snapshots ADD COLUMN IF NOT EXISTS margin_pct NUMERIC;
