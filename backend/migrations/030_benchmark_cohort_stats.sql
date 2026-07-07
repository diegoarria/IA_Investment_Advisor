-- Migration 030: anonymous peer benchmarking
-- Stores only aggregate, anonymous distributions per risk cohort — never a
-- user_id, never a value tied to a specific person. Refreshed weekly by
-- job_compute_benchmarks. The API compares a user's own live metric against
-- this precomputed distribution to answer "you're beating N% of investors
-- with your risk profile" without ever exposing anyone else's data.

CREATE TABLE IF NOT EXISTS benchmark_cohort_stats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key  TEXT NOT NULL,   -- 'conservative' | 'moderate' | 'aggressive'
  metric_key  TEXT NOT NULL,   -- 'cumulative_return_pct' | 'consecutive_months_contributing'
  values      JSONB NOT NULL,  -- sorted array of anonymous numeric values, no user_id attached
  sample_size INT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cohort_key, metric_key)
);

-- No RLS policy on purpose: this table has zero user-identifying columns —
-- there is nothing to scope by. Only the backend (service role) ever reads
-- or writes it; RLS is still enabled so no anon/authenticated client key can
-- touch it directly.
ALTER TABLE benchmark_cohort_stats ENABLE ROW LEVEL SECURITY;
