-- Migration 042: Investment Graph
-- Append-only event log that ties everything a user does around a specific
-- ticker (questions to Mentor IA, valuation theses, watchlist changes,
-- market events like earnings) into one timeline per company and one global
-- cross-company timeline. investment_decisions (migration 007) stays a
-- separate table — the graph read endpoints merge both at query time rather
-- than duplicating decision rows in here.

CREATE TABLE IF NOT EXISTS investment_graph_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker        TEXT NOT NULL,
  event_type    TEXT NOT NULL,   -- question | thesis | watchlist_add | watchlist_remove | market_event
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  parent_event_id UUID REFERENCES investment_graph_events(id) ON DELETE SET NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_graph_events_user_ticker ON investment_graph_events (user_id, ticker, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_graph_events_user_time   ON investment_graph_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_graph_events_parent       ON investment_graph_events (parent_event_id);

ALTER TABLE investment_graph_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY investment_graph_events_self ON investment_graph_events FOR ALL USING (user_id = auth.uid());
