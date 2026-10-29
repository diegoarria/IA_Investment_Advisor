-- Migration 117: full diagnostic snapshot persistence for company_valuations.
--
-- Why: migrations 114-116 persist the NUMERIC valuation (intrinsic value,
-- scenario bounds, validation status) but not the full rich diagnostic the
-- frontend actually renders (score, pillar scores, competitor comparison,
-- sector comparison, PE waterfall, fair-PE breakdown, narrative fields,
-- etc. — see frontend/web/src/lib/types/companyDiagnostic.ts, ~30
-- top-level fields). Today, when a read falls back to the persisted row
-- (_degraded_diagnostic in screener.py), it can only reconstruct a
-- CUT-DOWN ficha (price + fair value band, nothing else) — not the full
-- experience a user would see on a live-computed open. This column lets
-- the fallback path serve the exact same rich ficha the user would have
-- seen live, with zero recomputation and zero external-provider calls.
--
-- Purely additive: 2 nullable columns, no existing column/constraint/
-- index/RPC changes, no data migration. Old rows (without a snapshot)
-- keep working exactly as today via the existing cut-down reconstruction
-- in _degraded_diagnostic — this is a read enhancement, not a read
-- requirement.
--
-- Rollback: DROP COLUMN both — nothing else references them.

ALTER TABLE company_valuations
  ADD COLUMN IF NOT EXISTS diagnostic_snapshot JSONB,
  -- Mirrors the existing Redis _DIAGNOSTIC_SCHEMA_VERSION convention
  -- (screener.py) — a snapshot shaped by an older frontend contract is
  -- recognizably stale once that version advances, same "treat as miss,
  -- not as a crash" discipline already used for the Redis cache.
  ADD COLUMN IF NOT EXISTS snapshot_schema_version INTEGER;

-- Read pattern is always "give me the current row for this ticker" (same
-- as every existing query against this table) — no new index needed,
-- idx_company_valuations_current (migration 114) already covers it.
