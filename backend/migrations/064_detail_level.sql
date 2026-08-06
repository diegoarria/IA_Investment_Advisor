-- Fase 4, Incremento 1 — "Nivel de Detalle" (Principiante/Intermedio/
-- Avanzado/Profesional), see /Users/diegoarria/.claude/plans/
-- stateful-painting-flurry.md. Deliberately a NEW, separate preference from
-- portfolio_view_mode/watchlist_view_mode (migrations 020/021/057) — those
-- are a binary basic/advanced density toggle per page; this is an explicit
-- 4-level "how much do I want to see right now" setting that will control
-- section visibility across the redesigned /subvaluadas dashboard.
--
-- Default 'intermedio' (not 'avanzado', unlike the 057 reset) — see the
-- plan's Decisión 2 for why: this setting hides/shows whole SECTIONS, not
-- just tooltips, so defaulting to the most complex view risks overwhelming
-- a new user, and defaulting to the simplest risks hiding real data from an
-- experienced one on day one. Intermedio is the safer starting point; users
-- can move either direction immediately.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS detail_level VARCHAR(20) DEFAULT 'intermedio';
