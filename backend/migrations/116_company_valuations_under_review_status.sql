-- Migration 116: a 4th validation_status, 'under_review' — for a
-- computation that completed successfully (not a fetch/calc failure) but
-- tripped an automated anomaly guard (e.g. an operating-margin anchor
-- built from a thin mixed-regime trend, or an intrinsic-value/price gap
-- far outside this universe's normal range) and must not present as a
-- trustworthy `valid` number until a human reviews it.
--
-- Real case this exists for: AXON's 2026-10-27 backfill-pilot run
-- published $36.30 vs. a $425.87 real price (0.085x, vs. 0.7-0.9x for
-- every other ticker in the pilot) — root-caused to operating_margin_
-- anchor being computed from a genuinely mixed-sign, SBC-distorted
-- 5-year trend (see fundamental_analysis_service.py's
-- operating_margin_anchor_reliable flag, added in the same change as
-- this migration). The row stays queryable, with its real computed
-- number and assumptions intact — this is a presentation/trust flag,
-- never a deletion or a correction of the number itself.
--
-- Purely additive: widens the existing CHECK constraints and the RPC's
-- allowed values; no existing row changes shape, no index changes.
--
-- Rollback: re-run migration 114's original CHECK/RPC definitions (the
-- two ALTER/CREATE OR REPLACE statements below are themselves idempotent
-- supersets, so reverting means restoring the narrower lists, not
-- undoing a destructive change — see the inline comments below for the
-- exact prior text).

-- Was: CHECK (validation_status IN ('valid', 'insufficient_data', 'failed'))
-- Dropped by querying the catalog rather than a hardcoded name, since the
-- original constraint was declared inline on the column (migration 114)
-- and Postgres auto-names those — safer than guessing the generated name.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'company_valuations'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%validation_status%IN%'
  LOOP
    EXECUTE format('ALTER TABLE company_valuations DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE company_valuations ADD CONSTRAINT company_valuations_validation_status_check
  CHECK (validation_status IN ('valid', 'insufficient_data', 'failed', 'under_review'));

-- Was: CHECK (NOT (validation_status = 'failed' AND is_current)) — unchanged,
-- 'under_review' is allowed to be is_current (same as 'insufficient_data':
-- it's a real completed computation, just not a trustworthy one yet, and
-- the ticker's page should still show whatever it has rather than nothing).

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
  -- Was: IF p_validation_status NOT IN ('valid', 'insufficient_data') THEN
  IF p_validation_status NOT IN ('valid', 'insufficient_data', 'under_review') THEN
    RAISE EXCEPTION 'set_current_company_valuation: validation_status must be valid, insufficient_data, or under_review, got %', p_validation_status;
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
