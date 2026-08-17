-- Migration 075: structured Q&A answers on the investment decisions diary
-- Run in Supabase SQL Editor
--
-- Backs the optional "self-check" mini-quiz on the Oportunidades screen
-- (CompanyDiagnosticCard / mobile subvaluadas) — 5 free-text questions
-- about a company ("¿Cómo gana dinero?", etc.) the user can answer before
-- deciding, saved to their existing Diario de Decisiones so they can
-- revisit them later. `investment_decisions.notes` (migration 007) is a
-- single TEXT field — squashing 5 Q&A pairs into it would lose structure
-- (no per-question display/edit later), so this adds a real JSONB column
-- instead: [{"question": "...", "answer": "..."}, ...].

ALTER TABLE investment_decisions
  ADD COLUMN IF NOT EXISTS quiz_answers JSONB;
