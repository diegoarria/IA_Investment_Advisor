-- Migration 114: durable, versioned persistence of Nuvos Radar's computed
-- intrinsic valuations — Supabase becomes the source of truth; Redis stays
-- as a fast-path cache in front of it, not the only copy.
--
-- Applied 2026-10-20/21 — confirmed live in production (157 rows as of
-- 2026-10-21; re-running this file now fails on "policy already exists",
-- which is expected and not a problem). Shared platform data (not
-- per-user), mirrors macro_calendar's public-read RLS pattern rather than
-- cash_holdings' per-user one.

CREATE TABLE IF NOT EXISTS company_valuations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                  TEXT NOT NULL,
  intrinsic_value_usd     NUMERIC,
  currency                TEXT NOT NULL DEFAULT 'USD',
  -- Which model actually produced this number — GQV dual-track, REIT
  -- FFO/AFFO, financial-sector, legacy P/E/relative fallback, etc. Must
  -- always reflect the real sector-aware routing already in
  -- fundamental_analysis_service.py — never a single generic label.
  methodology             TEXT NOT NULL,
  -- Mirrors the existing Redis cache-key version-bump convention
  -- (company_diagnostic:v10:...) — a row computed by an older model
  -- version is recognizably stale once the app's version advances.
  model_version           TEXT NOT NULL,
  -- The fiscal period actually used (e.g. "2026-Q2"), from the same
  -- _latest_reported_earnings_period() signal the app already computes —
  -- NOT the calendar date of the run.
  financial_report_period TEXT,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Real inputs used for this specific computation (discount rate, growth
  -- assumptions, scenario bounds) — an audit trail, not displayed as-is.
  assumptions             JSONB,
  validation_status       TEXT NOT NULL CHECK (validation_status IN ('valid', 'insufficient_data', 'failed')),
  error_detail            TEXT,
  -- TRUE marks the row a ticker's screen should read today. A 'failed'
  -- (transient fetch/compute error) row can NEVER be current — it's a log
  -- entry only, and the previous valid/insufficient_data row stays active
  -- untouched. This is enforced by the CHECK below, not just app
  -- discipline, so a bug can't silently promote an error into "the truth."
  is_current              BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (NOT (validation_status = 'failed' AND is_current)),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2026-10-20, compatibility review before applying: dropped the
-- originally-drafted `in_progress_since` column — "is a ticker's
-- recompute already running" is a coordination concern, not data of
-- record, and this codebase already has a proven, self-expiring,
-- cross-process-safe primitive for exactly that
-- (app/core/cache.py's acquire_lock/release_lock, TTL-based, reused
-- as-is by company_valuation_service.py rather than a new DB-backed
-- claim column that would need its own staleness logic re-invented).

-- Exactly one current row per ticker at a time; every prior computation
-- (valid or not) stays in the table as history, is_current = FALSE.
CREATE UNIQUE INDEX IF NOT EXISTS idx_company_valuations_current
  ON company_valuations (ticker) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_company_valuations_ticker_computed
  ON company_valuations (ticker, computed_at DESC);

ALTER TABLE company_valuations ENABLE ROW LEVEL SECURITY;

-- Shared read-only data for every signed-in/guest screen, same pattern as
-- macro_calendar_events — no per-user ownership concept here.
CREATE POLICY company_valuations_read_all ON company_valuations
  FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policy for anon/authenticated roles: writes only
-- ever happen through the backend's service_role key, which bypasses RLS
-- entirely (same caveat as cash_holdings/dividend_income — see the
-- 2026-10-20 cash/dividends audit).

-- Atomic "make this the new current valuation" — a plain two-step
-- UPDATE-then-INSERT from application code would have a real window
-- where a crash between the two calls leaves the ticker with NO current
-- row at all (the old one already flipped false, the new one never
-- landed). Wrapping both in one function means they commit or roll back
-- together. Never called for validation_status='failed' — that path is
-- a plain INSERT with is_current=false from the service, no flip needed,
-- so a failed computation can never touch the last valid row.
CREATE OR REPLACE FUNCTION set_current_company_valuation(
  p_ticker TEXT,
  p_intrinsic_value_usd NUMERIC,
  p_currency TEXT,
  p_methodology TEXT,
  p_model_version TEXT,
  p_financial_report_period TEXT,
  p_assumptions JSONB,
  p_validation_status TEXT
) RETURNS company_valuations
LANGUAGE plpgsql
AS $$
DECLARE
  v_row company_valuations;
BEGIN
  IF p_validation_status NOT IN ('valid', 'insufficient_data') THEN
    RAISE EXCEPTION 'set_current_company_valuation: validation_status must be valid or insufficient_data, got %', p_validation_status;
  END IF;

  UPDATE company_valuations SET is_current = FALSE
    WHERE ticker = p_ticker AND is_current = TRUE;

  INSERT INTO company_valuations (
    ticker, intrinsic_value_usd, currency, methodology, model_version,
    financial_report_period, assumptions, validation_status, is_current
  ) VALUES (
    p_ticker, p_intrinsic_value_usd, p_currency, p_methodology, p_model_version,
    p_financial_report_period, p_assumptions, p_validation_status, TRUE
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
