-- ============================================================================
-- 036_major_news_events.sql
--
-- Tracks the "big event" push alerts sent by worker.py's job_major_news_alert
-- (geopolitical tensions, macro indicators, major corporate news, major
-- statements/deals from big-company leaders — never analyst opinions or
-- price-target changes). Capped at 3 per calendar day
-- (ET), shared across ALL users (one event = one row here, then fanned out
-- to everyone), so this table is what makes that daily cap durable across
-- worker restarts/redeploys — an in-memory or Redis-only counter would reset
-- on every deploy, exactly like the price-alert dedup bug fixed earlier.
-- ============================================================================

CREATE TABLE IF NOT EXISTS major_news_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date    DATE NOT NULL,       -- ET calendar day this counts against (max 3/day)
  headline_hash TEXT NOT NULL,       -- md5 of the headline — dedup so the same story isn't re-sent same day
  headline      TEXT NOT NULL,
  category      TEXT NOT NULL,       -- 'geopolitics' | 'macro' | 'corporate' | 'leadership'
  push_body     TEXT NOT NULL,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_major_news_events_date ON major_news_events(event_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_major_news_events_date_hash
  ON major_news_events(event_date, headline_hash);

-- Internal/system table — no end-user ever reads it directly. Only the
-- backend's service_role writes or reads it; RLS enabled with zero
-- user-facing policies is intentional (mirrors security_events' pattern
-- from 033).
ALTER TABLE major_news_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service: major news events" ON major_news_events;
CREATE POLICY "Service: major news events" ON major_news_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
