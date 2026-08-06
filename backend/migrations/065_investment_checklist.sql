-- ============================================================================
-- 065_investment_checklist.sql
--
-- Fase 4, Incremento 8 (Investment Checklist, Parte H — see
-- /Users/diegoarria/.claude/plans/stateful-painting-flurry.md): a
-- customizable checklist that must be completed before a user marks a
-- company as "Invertible." Minimal backend support per Decisión 3 — no new
-- financial/scoring logic, just persistence for a UI gate.
--
-- user_checklist_items: the user's PERSONALIZED item list. Empty (no rows)
-- for a user who has never customized it — the backend returns a real
-- default set (app/services/checklist_service.py's DEFAULT_CHECKLIST_ITEMS)
-- in that case, never fabricating rows just to have something to return.
-- The first add/remove action "materializes" the defaults into real rows
-- (see checklist_service.py) so personalization is additive, not a
-- from-scratch rebuild. `label IS NULL` means "use the i18n translation
-- for this default item_key" (frontend concern, matches the existing
-- subvaluadas.checklist.items.* convention); a real label means a
-- user-authored custom item.
--
-- checklist_completions: a row = this item is checked for this
-- (user, ticker) — deleting the row unchecks it. Same
-- "row-exists-is-the-state" pattern watchlist/price_alerts already use.
--
-- investable_marks: a row = the user has marked this ticker "Invertible."
-- Deliberately NOT a column on `watchlist` — marking a company investable
-- shouldn't require it to already be followed.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_checklist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  label       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, item_key)
);

ALTER TABLE user_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own checklist items" ON user_checklist_items;
CREATE POLICY "Users manage own checklist items" ON user_checklist_items
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS checklist_completions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker, item_key)
);

CREATE INDEX IF NOT EXISTS idx_checklist_completions_lookup ON checklist_completions (user_id, ticker);

ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own checklist completions" ON checklist_completions;
CREATE POLICY "Users manage own checklist completions" ON checklist_completions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS investable_marks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker      TEXT NOT NULL,
  marked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, ticker)
);

ALTER TABLE investable_marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage own investable marks" ON investable_marks;
CREATE POLICY "Users manage own investable marks" ON investable_marks
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
