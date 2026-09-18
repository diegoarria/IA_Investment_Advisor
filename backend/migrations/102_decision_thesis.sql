-- Migration 102: investment decision thesis (motivo/expectativa/horizonte/convicción)
--
-- Gap identified against the ARTHUR spec (§7 MEMORIA DE DECISIONES): today
-- investment_decisions only logs a decision as a transaction (action,
-- ticker, price, a coarse trigger category) — not as a reasoned thesis
-- ("compró Nvidia porque esperaba crecimiento de ingresos y expansión de
-- márgenes"). This adds one flexible JSONB column, following the same
-- idiom as quiz_answers (migration 075), instead of a rigid set of typed
-- columns — the exact shape (motivo, expectativa, horizonte, convicción,
-- que_invalidaria_la_tesis) is enforced at the application layer, not the
-- DB, and only populated when the user actually states a reason — never
-- inferred/guessed to avoid extra per-message LLM extraction cost.
ALTER TABLE investment_decisions
  ADD COLUMN IF NOT EXISTS thesis JSONB;
