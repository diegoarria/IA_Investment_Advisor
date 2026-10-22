-- ============================================================================
-- 116_fix_brk_dual_class_ticker_split.sql
--
-- One-time data fix, 2026-10-21 (Nuvos Radar structural audit). Before
-- app/services/company_valuation_service.py's ticker normalization was
-- unified with the route layer's (screener._resolve_quick_ticker), a
-- caller writing "BRK.B" literally (bypassing the route's dot->hyphen
-- fix) created a SEPARATE current row from the real "BRK-B" row — both
-- "current" simultaneously, since they're different primary-key strings
-- to Postgres (confirmed live: BRK-B valid $751.86, BRK.B
-- insufficient_data, both is_current=true).
--
-- Going forward every writer normalizes to the hyphen form, so "BRK.B"
-- should never be written/read as a key again — this just demotes the
-- orphaned "BRK.B" row(s) to history (is_current=false), the same thing
-- that would have happened automatically if they'd shared one key all
-- along. NOTHING is deleted — full audit trail preserved, exactly the
-- "sin eliminar historial por accidente" requirement.
--
-- Idempotent: a second run has nothing left to update (WHERE clause only
-- ever matches literal "BRK.B"/"BF.B"-style dotted keys that are still
-- marked current).
-- ============================================================================

BEGIN;

UPDATE company_valuations
SET is_current = FALSE
WHERE is_current = TRUE
  AND ticker ~ '\.[A-Z]$';  -- any dotted dual-class key (BRK.B, BF.B, ...) still marked current

COMMIT;
