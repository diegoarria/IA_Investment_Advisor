-- Migration 126 (PREPARED ONLY — NOT applied anywhere, NOT authorized for
-- production in this pass). Diego, 2026-11-16: extend
-- company_qualitative_content (migrations 123/124/125, already live) so
-- Radar 2.0's Fase 3 ("Conocer a quienes dirigen") and Fase 4 ("Entender
-- la industria") can eventually read real backend-versioned content
-- instead of the local-only previewContent/leadership|industry/*.json
-- fixtures built today.
--
-- WHY two nullable columns on the EXISTING table, not two new tables:
-- leadership/industry content shares every lifecycle property moat/risks
-- already has — one row per (ticker, version), draft->reviewed->published,
-- is_current, the same RLS policy, the same publish RPC's crash-safety
-- (flip old row to not-current and insert the new one atomically). Two new
-- tables would duplicate all of that machinery for zero real benefit and
-- would reopen the exact "which table is authoritative for this ticker
-- right now" question migration 123 already solved once. Per Diego's own
-- instruction ("Priorizar reutilización y simplicidad. No crear una
-- nueva arquitectura innecesaria"), this is the simpler, already-proven
-- path. Both columns are NULLABLE so every existing row (GOOGL v1/v2/v3,
-- and the older COST/JPM/NVDA/MCD drafts) keeps working unchanged with
-- leadership/industry simply absent — no backfill, no default value
-- that could look like real content.
--
-- Shape mirrors previewContent/leadership/googl.json and
-- previewContent/industry/googl.json exactly (read 2026-11-16, the real
-- local fixtures already built and researched for all 5 pilots):
--   leadership: { "ceo": {name, role_explanation, since, source_name,
--                          source_document_date, source_accessed_at, confidence},
--                 "capital_allocation": {fiscal_year, operating_cash_flow,
--                          capex, capex_prior_year, fcf_reported_ttm,
--                          buybacks, buybacks_prior_year, dividends_paid,
--                          dividends_paid_prior_year, long_term_debt_current,
--                          long_term_debt_prior, debt_direction,
--                          acquisition_note, note, source_name,
--                          source_document_date, source_accessed_at, confidence},
--                 "decisions": [ {decision, outcome, uncertainty, source_name,
--                          source_document_date, source_accessed_at, confidence} ],
--                 "incentive_alignment": { last_confirmed_total_compensation: {...},
--                          compensation_2025_verified, compensation_2025_note,
--                          psu_award: {...}, direct_ownership: {...} },
--                 "watch": ["...", "..."] }
--   industry:   { "competitors": [ {segment, rivals[], note, source_name, confidence} ],
--                 "market_growth": { <sector key>: {finding, figure_note,
--                          source_document_date, source_accessed_at, confidence}, ...,
--                          "distinction_note" },
--                 "competitive_strength": [ {rival, evidence, caveat, source_name, confidence} ],
--                 "industry_shifts": [ {change, what_it_means, effect_on_company,
--                          is_prediction, source_name, confidence} ],
--                 "watch": ["...", "..."] }
--
-- Every numeric field that's company-specific (capex, buybacks, etc.) and
-- every CEO/capital-allocation/competitor claim already carries its own
-- source_name/source_document_date/confidence at the application layer,
-- same discipline moat/risks already use — this migration does not add
-- Postgres-level JSON-schema enforcement for the SAME reason migration 123
-- didn't for moat/risks (no pg_jsonschema extension installed; structural
-- validation lives in qualitative_content_service.py, see
-- validate_qualitative_entries's new leadership/industry checks added
-- alongside this migration).
--
-- Rollback: ALTER TABLE company_qualitative_content
--   DROP COLUMN IF EXISTS leadership, DROP COLUMN IF EXISTS industry;
-- (Safe — both are nullable additive columns; dropping them loses no
-- moat/risks/business_model_summary history.)

ALTER TABLE company_qualitative_content
  ADD COLUMN IF NOT EXISTS leadership JSONB,
  ADD COLUMN IF NOT EXISTS industry   JSONB;

-- Cheap type-shape guard, same philosophy as the existing moat/risks
-- CHECKs (jsonb_typeof(moat)='array') — these two are OBJECTS, not
-- arrays, so the check mirrors that but for 'object', and only applies
-- when the column is non-null (a draft legitimately created before this
-- migration, or one that simply doesn't have leadership/industry content
-- yet, stores NULL here — never an empty object standing in for "no
-- content", same "null means honestly absent" discipline used
-- everywhere else in this table).
ALTER TABLE company_qualitative_content
  ADD CONSTRAINT company_qualitative_content_leadership_is_object
    CHECK (leadership IS NULL OR jsonb_typeof(leadership) = 'object'),
  ADD CONSTRAINT company_qualitative_content_industry_is_object
    CHECK (industry IS NULL OR jsonb_typeof(industry) = 'object');

-- No RLS change needed — the existing policy (review_status='published'
-- AND is_current=TRUE) already governs the whole row, these two columns
-- included, automatically. No change to publish_company_qualitative_content()
-- either in THIS migration (see note below) — see the follow-up function
-- replacement that adds the two new parameters, kept as its own
-- CREATE OR REPLACE so this migration's column-add stays a pure additive
-- step that could be applied alone if leadership/industry parameters
-- aren't ready yet.

-- publish_company_qualitative_content(): extended with 2 new REQUIRED
-- JSONB parameters (p_leadership, p_industry — no DEFAULT). Diego,
-- 2026-11-16, real dry-run finding: giving these two DEFAULT NULL made
-- the 7-param function callable with only 5 arguments too, so Postgres
-- could no longer tell a bare 5-argument call apart from the original
-- 5-param function — "function ... is not unique". Dropping the DEFAULT
-- removes that overlap: a 5-argument call can now only match the
-- original 5-param function (unchanged, untouched by this migration),
-- while a 7-argument call only matches this one. This is NOT a NOT NULL
-- constraint on the parameter — a caller can still legitimately pass a
-- literal NULL for p_leadership/p_industry, it just can no longer OMIT
-- them from the call. qualitative_content_service.py::publish_version()
-- already always passes both keys explicitly (even as None when there's
-- no real content yet), so the real app code path is unaffected.
CREATE OR REPLACE FUNCTION publish_company_qualitative_content(
  p_ticker TEXT,
  p_business_model_summary TEXT,
  p_moat JSONB,
  p_risks JSONB,
  p_updated_by TEXT,
  p_leadership JSONB,
  p_industry JSONB
) RETURNS company_qualitative_content
LANGUAGE plpgsql
AS $$
DECLARE
  v_row company_qualitative_content;
  v_next_version INTEGER;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM company_qualitative_content WHERE ticker = p_ticker;

  UPDATE company_qualitative_content SET is_current = FALSE
    WHERE ticker = p_ticker AND is_current = TRUE;

  INSERT INTO company_qualitative_content (
    ticker, version, review_status, business_model_summary, moat, risks,
    leadership, industry, updated_by, published_at, published_by, is_current
  ) VALUES (
    p_ticker, v_next_version, 'published', p_business_model_summary, p_moat, p_risks,
    p_leadership, p_industry, p_updated_by, now(), p_updated_by, TRUE
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Migration 124's hardening (REVOKE EXECUTE FROM PUBIC/anon/authenticated,
-- locked search_path) applies to the NEW function signature automatically
-- in Postgres only if re-stated, since CREATE OR REPLACE on a function
-- with added DEFAULT parameters is still technically a new overload
-- resolution target for the grant system in some Postgres versions — redo
-- both grants explicitly here so this migration can never accidentally
-- reopen the PUBLIC-execute gap migration 124 closed.
REVOKE EXECUTE ON FUNCTION publish_company_qualitative_content(
  TEXT, TEXT, JSONB, JSONB, TEXT, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION publish_company_qualitative_content(
  TEXT, TEXT, JSONB, JSONB, TEXT, JSONB, JSONB
) SET search_path = public, pg_temp;
