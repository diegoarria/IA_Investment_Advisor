-- ============================================================================
-- 115_fix_upsert_macro_events_ambiguous_column.sql
--
-- Root cause found 2026-10-21, confirmed live against production (called
-- the RPC directly 3 times — empty payload, a synthetic row, a real-world
-- row — all 3 failed identically):
--
--   Error 42702: column reference "event_id" is ambiguous
--   Details: It could refer to either a PL/pgSQL variable or a table
--   column.
--
-- Migration 111's `upsert_macro_events_batch` declares
-- `RETURNS TABLE(event_id TEXT, ...)`, which implicitly creates a
-- PL/pgSQL variable named `event_id` in scope for the whole function
-- body — colliding with macro_economic_events' own `event_id` column
-- every time it's referenced unqualified inside the embedded SQL (the
-- INSERT's ON CONFLICT target list and column list). The RPC has been
-- throwing this on EVERY call since the day migration 111 shipped
-- (2026-10-04), silently caught by _upsert_rows_lossless's except block
-- and falling back to a plain `.upsert()` — which does NOT have the
-- COALESCE loss-protection on actual/estimate/previous_value/unit/
-- speaker_name that was the entire point of migration 111, and never
-- advances first_seen_at/last_seen_at. A field that should stay at its
-- last confirmed real value can get silently blanked by a transient null
-- from FMP — "a veces los eventos... no se muestran correctamente."
--
-- Fix: rename the colliding OUT parameter to `out_event_id` so no
-- identifier in the function body can mean both the variable and the
-- table column. Everything else is unchanged — the Python caller
-- (_upsert_rows_lossless) only ever reads `was_insert` off each returned
-- row, never `event_id`, so this rename needs no application code change.
-- ============================================================================

BEGIN;

-- CREATE OR REPLACE cannot change a function's OUT-parameter names (only
-- the body) — Postgres requires DROP + CREATE for that, which is exactly
-- what renaming the colliding `event_id` OUT param to `out_event_id`
-- needs to do.
DROP FUNCTION IF EXISTS upsert_macro_events_batch(JSONB);

CREATE FUNCTION upsert_macro_events_batch(p_rows JSONB)
RETURNS TABLE(out_event_id TEXT, was_insert BOOLEAN, value_changed BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH incoming AS (
    SELECT
      r->>'event_id'        AS event_id,
      r->>'event_type'      AS event_type,
      r->>'event_period'    AS event_period,
      r->>'event_name'      AS event_name,
      (r->>'event_date_utc')::TIMESTAMPTZ AS event_date_utc,
      COALESCE(r->>'country', 'US')        AS country,
      r->>'impact_source'   AS impact_source,
      r->>'impact_level'    AS impact_level,
      r->>'actual_value'    AS actual_value,
      r->>'estimate_value'  AS estimate_value,
      r->>'previous_value'  AS previous_value,
      r->>'unit'            AS unit,
      r->>'speaker_name'    AS speaker_name,
      COALESCE(r->>'source', 'fmp')         AS source
    FROM jsonb_array_elements(p_rows) AS r
  ),
  upserted AS (
    INSERT INTO macro_economic_events AS t (
      event_id, event_type, event_period, event_name, event_date_utc, country,
      impact_source, impact_level, actual_value, estimate_value, previous_value,
      unit, speaker_name, source, first_seen_at, last_seen_at, created_at, updated_at
    )
    SELECT
      i.event_id, i.event_type, i.event_period, i.event_name, i.event_date_utc, i.country,
      i.impact_source, i.impact_level, i.actual_value, i.estimate_value, i.previous_value,
      i.unit, i.speaker_name, i.source, NOW(), NOW(), NOW(), NOW()
    FROM incoming i
    ON CONFLICT (event_id) DO UPDATE SET
      event_period    = EXCLUDED.event_period,
      event_name      = EXCLUDED.event_name,
      event_date_utc  = EXCLUDED.event_date_utc,
      impact_source   = EXCLUDED.impact_source,
      impact_level    = EXCLUDED.impact_level,
      actual_value    = COALESCE(EXCLUDED.actual_value, t.actual_value),
      estimate_value  = COALESCE(EXCLUDED.estimate_value, t.estimate_value),
      previous_value  = COALESCE(EXCLUDED.previous_value, t.previous_value),
      unit            = COALESCE(EXCLUDED.unit, t.unit),
      speaker_name    = COALESCE(EXCLUDED.speaker_name, t.speaker_name),
      last_seen_at    = NOW(),
      updated_at      = CASE
        WHEN EXCLUDED.event_date_utc IS DISTINCT FROM t.event_date_utc
          OR EXCLUDED.event_name IS DISTINCT FROM t.event_name
          OR COALESCE(EXCLUDED.actual_value, t.actual_value) IS DISTINCT FROM t.actual_value
          OR COALESCE(EXCLUDED.estimate_value, t.estimate_value) IS DISTINCT FROM t.estimate_value
          OR COALESCE(EXCLUDED.previous_value, t.previous_value) IS DISTINCT FROM t.previous_value
        THEN NOW() ELSE t.updated_at
      END
    RETURNING t.event_id, (xmax = 0) AS was_insert, (t.updated_at = NOW()) AS value_changed
  )
  SELECT * FROM upserted;
END;
$$;

REVOKE ALL ON FUNCTION upsert_macro_events_batch(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_macro_events_batch(JSONB) TO service_role;

COMMIT;
