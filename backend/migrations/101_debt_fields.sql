-- Migration 101: debt/liabilities fields on user_profiles
--
-- Gap identified against the ARTHUR spec (§5 CONTEXTO FINANCIERO — pasivos):
-- decision_engine.py already has a comment admitting "NO HAY DATOS
-- ESTRUCTURADOS DE DEUDA EN NUVOS TODAVÍA" and silently treats debt as
-- unknown rather than zero. This adds a minimal, explicit place to store it
-- so Arthur can reason about it (opportunity cost of paying off debt vs.
-- investing, risk capacity for big life decisions) instead of always having
-- to ask or assume.
--
-- Deliberately minimal (has_debt + total amount), not a full liabilities
-- ledger (cards/loans/mortgage broken out) — that's a bigger feature than
-- this gap-fix warrants today. NULL/false is the safe default for every
-- existing row (no debt known, matches current behavior exactly).
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS has_debt BOOLEAN,
  ADD COLUMN IF NOT EXISTS debt_amount_usd NUMERIC(14, 2);
