-- Nuvos ETF Phase 0 — fake test data for the ISOLATED dev Supabase project.
-- NEVER run this against the production project.
--
-- Supabase's `auth.users` table is managed by Supabase Auth itself — rather
-- than hand-crafting a fake row there (fragile, can skip internal triggers),
-- sign up ONE real test account through the normal app flow pointed at the
-- dev project (e.g. http://localhost:3000 with frontend/web/.env.local's
-- Supabase vars swapped to the dev project), then paste that account's UUID
-- below. No real user data is involved — it's an account you just created.
--
-- 1. Replace every <TEST_USER_ID> below with that UUID.
-- 2. Run this in the dev project's SQL editor AFTER the migration bundle.

-- Equity + ETF tickers mixed on purpose, to exercise asset-classification
-- (Phase 0) and the future ETF module side by side with Radar's stock path.
--
-- A fresh auth.users signup does NOT auto-create a user_profiles row (no DB
-- trigger does this — confirmed empty on a brand-new local test user), so
-- this is an upsert, not an update.
insert into user_profiles (user_id, subscription_tier)
values ('<TEST_USER_ID>', 'premium')  -- unblock Radar/ETF feature gating for manual testing
on conflict (user_id) do update set subscription_tier = excluded.subscription_tier;

insert into watchlist (user_id, ticker, name)
values
  ('<TEST_USER_ID>', 'AAPL', 'Apple Inc.'),
  ('<TEST_USER_ID>', 'SPY',  'State Street SPDR S&P 500 ETF'),
  ('<TEST_USER_ID>', 'QQQ',  'Invesco QQQ Trust'),
  ('<TEST_USER_ID>', 'BOTZ', 'Global X Robotics & AI ETF')
on conflict (user_id, ticker) do nothing;

-- user_portfolio's real PK is (user_id, portfolio_id) — portfolio_id
-- defaults to 'default', not just user_id alone.
insert into user_portfolio (user_id, positions)
values (
  '<TEST_USER_ID>',
  '{
    "_v": 1,
    "currency": "USD",
    "positions": [
      {"ticker": "AAPL", "shares": 10, "avg_price": 180.0, "date": "2026-01-15"},
      {"ticker": "VOO",  "shares": 5,  "avg_price": 420.0, "date": "2026-02-01"}
    ],
    "closed_positions": [],
    "inception_date": "2026-01-15"
  }'::jsonb
)
on conflict (user_id, portfolio_id) do update set positions = excluded.positions;
