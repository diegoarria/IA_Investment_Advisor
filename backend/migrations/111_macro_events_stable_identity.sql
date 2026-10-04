-- ============================================================================
-- 111_macro_events_stable_identity.sql
--
-- Root cause being fixed: `event_id` (migration 074) was
-- sha1(event_type|event_name|event_date_utc) — derived from TWO fields FMP
-- regularly mutates for the exact same real-world release (the exact
-- release timestamp, on a reschedule; the raw label text, on a wording
-- tweak). Every time either changed, the next sync upserted a BRAND NEW
-- row instead of updating the existing one — the old row was never deleted
-- (no DELETE exists anywhere in this codebase for this table), so
-- Supabase silently accumulated duplicate rows for the same release, and
-- the read path (_collapse_moved_releases/_dedupe_rescheduled) had to
-- guess at render time which rows were really the same release.
--
-- Fix: `event_id` becomes a STABLE identity derived from the release's own
-- PERIOD (the thing that never changes about a release — "CPI for
-- September 2026" is always that, no matter what day FMP currently thinks
-- it posts on), computed by macro_calendar_service.event_period() from
-- FMP's own period suffix ("(Sep)", "(Oct/03)", "(Q3)") + a year inferred
-- from the release date — see that function's own docstring for the full
-- per-type breakdown. `event_id` keeps its existing TEXT UNIQUE column
-- (migration 074) — only what Python computes to put in it changes; no
-- column rename needed.
--
-- `event_period`: the human-readable period key itself ("2026-09",
-- "2026-Q3", "2026-10-28"), stored alongside event_id for auditability/
-- debugging and so a future caller never has to re-derive it.
--
-- `first_seen_at` / `last_seen_at`: `created_at`/`updated_at` already
-- existed but conflated two different ideas — `updated_at` doesn't tell
-- you whether FMP just RE-CONFIRMED an unchanged row or actually changed
-- a value. `first_seen_at` = when Nuvos first discovered this exact
-- release (set once, at INSERT, never touched again). `last_seen_at` =
-- the last time FMP's feed confirmed this release still exists (touched
-- on EVERY sync that sees it, changed value or not). `updated_at` keeps
-- its existing meaning (bumped only when a real field value changes).
--
-- Run AFTER 074. Safe to run multiple times (IF NOT EXISTS everywhere).
-- Does NOT touch existing rows' event_id/event_period — see
-- macro_calendar_service.backfill_stable_event_identity() (run once,
-- manually, after this migration) for that one-time, carefully-merged
-- consolidation of any pre-existing duplicate rows.
-- ============================================================================

BEGIN;

ALTER TABLE macro_economic_events
  ADD COLUMN IF NOT EXISTS event_period   TEXT,
  ADD COLUMN IF NOT EXISTS first_seen_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at   TIMESTAMPTZ;

-- Backfill the two new timestamp columns for existing rows only (never
-- overwrites a value a later backfill/sync may have already set) — event_id
-- itself is NOT touched here; that's backfill_stable_event_identity()'s job,
-- since it requires the same period-inference logic macro_calendar_service.py
-- implements in Python, not something safely re-derivable in plain SQL.
UPDATE macro_economic_events
SET first_seen_at = COALESCE(first_seen_at, created_at),
    last_seen_at  = COALESCE(last_seen_at, updated_at)
WHERE first_seen_at IS NULL OR last_seen_at IS NULL;

ALTER TABLE macro_economic_events
  ALTER COLUMN first_seen_at SET DEFAULT NOW(),
  ALTER COLUMN last_seen_at  SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_macro_economic_events_period ON macro_economic_events(event_type, event_period);

-- ── Lossless batch upsert ───────────────────────────────────────────────
-- Why an RPC instead of the backend's plain `.upsert(rows, on_conflict=
-- "event_id")`: PostgREST's upsert is a blind REPLACE of every column on
-- conflict — if FMP's current response has `actual: null` (not yet
-- released) for a release Supabase already has a real confirmed
-- actual_value for, a plain upsert would silently NULL out that confirmed
-- number. This function does the equivalent of ON CONFLICT DO UPDATE with
-- COALESCE(new, existing) on exactly the 4 "can go from real back to
-- unknown" fields (actual/estimate/previous/unit/speaker_name) — a real
-- new value always wins, but FMP temporarily omitting a field already on
-- file never erases it. event_date_utc/event_name/impact_* DO get
-- overwritten unconditionally — those are supposed to track FMP's current
-- answer (a reschedule, a label wording fix), not freeze at first-seen.
-- first_seen_at is set once (DEFAULT, untouched by the UPDATE branch);
-- last_seen_at bumps on every sync that reconfirms the row, regardless of
-- whether any value changed; updated_at only bumps when a real field
-- value actually changed, so it keeps meaning "last time THIS record's
-- data changed" the way the rest of the codebase already expects it to.
--
-- Takes the whole batch as one JSONB array so a full ~500-row sync is one
-- round trip and one atomic statement (safe under concurrent refreshes —
-- Postgres's own row-level locking on the unique index serializes two
-- concurrent calls touching the same event_id; whichever commits second
-- just sees the first's row as the pre-existing one and COALESCEs against
-- it, never loses data either way).
CREATE OR REPLACE FUNCTION upsert_macro_events_batch(p_rows JSONB)
RETURNS TABLE(event_id TEXT, was_insert BOOLEAN, value_changed BOOLEAN)
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
