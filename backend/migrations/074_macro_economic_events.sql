-- ============================================================================
-- 074_macro_economic_events.sql
--
-- Backs the Watchlist calendar's new macro-economic-events layer (FOMC, CPI,
-- NFP, GDP, PMIs, jobless claims, etc.), on top of the existing per-ticker
-- earnings/dividend events already shown there. Populated by a daily cron
-- (worker.py's job_refresh_macro_calendar) from FMP's economic-calendar API,
-- never written to directly by any request path — mirrors major_news_events'
-- (036) service-role-only shape, since nothing in this codebase lets the
-- frontend talk to Supabase directly; it always reads through a backend API
-- route instead.
--
-- event_id is a stable dedup key (sha1 of event_type|event_name|event_date_utc)
-- so re-running the daily sync never creates duplicate rows across syncs,
-- name changes, or repeated cron runs — enforced by the UNIQUE constraint,
-- with the sync using upsert(on_conflict="event_id").
-- ============================================================================

CREATE TABLE IF NOT EXISTS macro_economic_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       TEXT NOT NULL UNIQUE,        -- sha1(event_type|event_name|event_date_utc)
  event_type     TEXT NOT NULL,               -- canonical Nuvos type, e.g. 'cpi', 'fomc_rate_decision'
  event_name     TEXT NOT NULL,               -- source's raw label, verbatim (e.g. "Core Inflation Rate YoY (Sep)")
  event_date_utc TIMESTAMPTZ NOT NULL,
  country        TEXT NOT NULL DEFAULT 'US',
  impact_source  TEXT,                        -- source's own raw impact rating, kept for reference/audit
  impact_level   TEXT NOT NULL,               -- Nuvos's fixed classification: VERY_HIGH | HIGH | MEDIUM
  actual_value   TEXT,
  estimate_value TEXT,
  previous_value TEXT,
  unit           TEXT,
  speaker_name   TEXT,                        -- only for fed_speaker events, extracted from the source's own event name
  source         TEXT NOT NULL DEFAULT 'fmp',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_macro_economic_events_date ON macro_economic_events(event_date_utc);
CREATE INDEX IF NOT EXISTS idx_macro_economic_events_type_date ON macro_economic_events(event_type, event_date_utc);

-- Internal/system table — no end-user ever reads it directly. Only the
-- backend's service_role writes or reads it; frontend reads through the
-- GET /api/watchlist/macro-calendar route (mirrors major_news_events' 036
-- pattern and every other backend-owned table in this codebase).
ALTER TABLE macro_economic_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: macro economic events" ON macro_economic_events;
CREATE POLICY "Service: macro economic events" ON macro_economic_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
