-- Diego wants the dense "Avanzado" stock table to be the default view for
-- EVERY user in Portfolio and Watchlist, never "Básico" — with FinancialTip
-- (i) icons doing the explaining for básico-level users instead of hiding
-- the real metrics behind a dumbed-down default.
--
-- Both columns were added with DEFAULT 'basic' (migrations 020/021), which
-- Postgres backfilled onto every existing row at the time — so today
-- 'basic' is indistinguishable between "a user deliberately chose básico"
-- and "this row was never touched." Per Diego's explicit "para todos,
-- siempre, nunca en básico," this resets everyone (not just future rows)
-- to 'advanced'. Anyone who genuinely prefers the simple card view can
-- still switch back with the toggle in the UI — nothing here removes that.

ALTER TABLE user_profiles ALTER COLUMN portfolio_view_mode SET DEFAULT 'advanced';
ALTER TABLE user_profiles ALTER COLUMN watchlist_view_mode SET DEFAULT 'advanced';

UPDATE user_profiles SET portfolio_view_mode = 'advanced' WHERE portfolio_view_mode = 'basic';
UPDATE user_profiles SET watchlist_view_mode = 'advanced' WHERE watchlist_view_mode = 'basic';
