-- Migration 119: company_valuation_reviews — audit trail for under_review
-- tickers, 2026-10-29 scaling-review design.
--
-- Why a new table instead of a JSONB sub-object on company_valuations.
-- assumptions/diagnostic_snapshot: those two fields are OVERWRITTEN on
-- every recompute (set_current_company_valuation does an INSERT with
-- is_current flip, never an in-place UPDATE of history) — any field
-- nested there is a snapshot of "what the code computed this run", not
-- a durable human decision log. A review decision ("I checked this,
-- it's a real methodology gap, approved 2026-11-02 by Diego") must
-- survive the next automated recompute attempt untouched, and must be
-- queryable across the whole history of a ticker, not just its current
-- row — that's a distinct lifecycle from the valuation data itself, so
-- it gets its own table, same reasoning that gave subscription changes
-- their own audit_log table rather than a column on `users`.
--
-- Purely additive: one new table, no changes to company_valuations's
-- existing columns/constraints/RPC. Nothing reads this table yet except
-- a future admin panel and manual queries — it does not change any
-- current runtime behavior.
--
-- Rollback: DROP TABLE company_valuation_reviews — nothing else
-- references it.

CREATE TABLE IF NOT EXISTS company_valuation_reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker              TEXT NOT NULL,
  -- One of the Paso 2 categories — CHECK keeps this from drifting into
  -- free-text buckets that can't be aggregated/reported on later.
  category            TEXT NOT NULL CHECK (category IN (
                         'data_inconsistency',
                         'unreliable_anchor',
                         'methodology_mismatch',
                         'extreme_price_gap_unexplained',
                         'insufficient_evidence'
                       )),
  -- Free-text detail — the specific reason, same content today's
  -- error_detail column already carries, duplicated here so it survives
  -- a future recompute that might change/clear error_detail.
  detected_reason     TEXT NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'open' | 'investigating' | 'resolved_valid' | 'resolved_methodology_fix'
  -- | 'resolved_data_fix' | 'wont_fix_stays_under_review'. Only a human
  -- (via whatever future admin action writes this row) may set a
  -- resolved_* status — no code path in this migration or elsewhere
  -- auto-writes one, by design (Paso 3's policy: no automatic
  -- valid promotion just because the market-price gap shrinks).
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                         'open', 'investigating', 'resolved_valid',
                         'resolved_methodology_fix', 'resolved_data_fix',
                         'wont_fix_stays_under_review'
                       )),
  -- Numbers worth keeping alongside the row even though they also live
  -- in company_valuations at the time of detection — company_valuations
  -- keeps getting overwritten; this is the frozen "as first flagged" view.
  intrinsic_value_usd NUMERIC,
  price_at_detection  NUMERIC,
  ratio_at_detection  NUMERIC,
  methodology         TEXT,
  evidence            JSONB,              -- freeform: FCF/SBC/debt/shares backing the finding
  next_action         TEXT,
  resolved_by         TEXT,               -- human identifier (email), set only alongside a resolved_* status
  resolved_at         TIMESTAMPTZ,
  resolution_rationale TEXT,              -- required in practice (enforce in app code) whenever resolved_*
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_valuation_reviews_ticker
  ON company_valuation_reviews (ticker, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_valuation_reviews_open
  ON company_valuation_reviews (status) WHERE status IN ('open', 'investigating');

-- RLS: same public-read-admin-write posture as company_valuations and
-- macro_calendar_events — read is safe to expose (it's an explanation,
-- not sensitive), writes are backend-service-key only (the app always
-- queries through the service-role key; this just blocks any direct
-- anon-key path).
ALTER TABLE company_valuation_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_valuation_reviews_public_read
  ON company_valuation_reviews FOR SELECT
  USING (true);
