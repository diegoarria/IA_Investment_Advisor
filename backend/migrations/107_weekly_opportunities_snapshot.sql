-- Migration 107: store a real snapshot of what was actually picked/sent,
-- not just the ticker — Diego, 2026-09-24: "Cómo noooooo???? Si el domingo
-- me diste una lista de 5 posiciones" — the in-app Screener Semanal screen
-- was silently showing 0 results because it re-joined the sent tickers
-- against the CURRENT live undervalued-screener cache, which only holds
-- tickers that pass the margin-of-safety gate RIGHT NOW. A ticker's price
-- moving since Sunday (or the weekly cache simply refreshing since) drops
-- it out of that live list even though it was a completely real, valid
-- pick when it was sent. Persisting the full real pick at send time makes
-- the display permanently independent of what happens to the live
-- universe afterward.
ALTER TABLE weekly_opportunities_history
  ADD COLUMN IF NOT EXISTS snapshot JSONB;
