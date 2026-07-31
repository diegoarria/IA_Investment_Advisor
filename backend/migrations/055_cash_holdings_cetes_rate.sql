-- Migration 055: rate tracking on cash holdings
--
-- CETES and US Treasury bonds lock in their yield at purchase (unlike a
-- savings account, the rate doesn't float day to day) — so when a "cetes" or
-- "bonds" cash holding is created, the backend captures a live rate
-- (Banxico's 364-day CETES rate, SIE series SF43945, or FRED's 1-year
-- Treasury constant-maturity rate, series DGS1) and the capture timestamp.
-- A user can also type their own annual rate manually (e.g. a bank
-- account's real APY) — a manual rate always wins over auto-fetching. The
-- displayed amount then accrues from whichever rate is set via simple
-- annualized interest, the same convention these yields are quoted in.

ALTER TABLE cash_holdings
  ADD COLUMN IF NOT EXISTS rate_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS rate_captured_at TIMESTAMPTZ;
