-- ============================================================================
-- 069_personalization_settings.sql
--
-- Fase 4, Incremento 12 (Personalización, Parte L — see
-- /Users/diegoarria/.claude/plans/stateful-painting-flurry.md).
--
-- Deliberately scoped to per-request surfaces only (confirmed with the
-- user before building this) — required_return_pct/min_margin_of_safety_pct
-- do NOT feed the shared nif_dashboard/quick_analysis caches (those are
-- keyed by ticker+lang only, shared across every user; making them
-- per-user would mean per-user cache keys, i.e. losing the shared-cache
-- design Fases 1-4 rely on — a real architectural change, out of scope for
-- a UX personalization increment). Instead:
--   - required_return_pct + preferred_discount_rate_method: default the
--     MANUAL DCF calculator's discount rate on /subvaluadas (already a
--     live, per-request computation, never cached across users) — reuses
--     dcf_engine.select_discount_rate's existing WACC-vs-required-return
--     rule, just exposed as a default instead of dead code.
--   - min_margin_of_safety_pct: highlights/sorts in the watchlist and
--     informs the Investment Checklist gate — both already per-user reads.
--   - favorite_metrics: pins columns in AdvancedStockTable.
--   - dashboard_section_order: reorders /subvaluadas's already-existing
--     detail-level-gated sections (src/lib/detailLevel.ts).
-- `detail_level` already exists (migration 064) — not touched here.
-- ============================================================================

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS required_return_pct NUMERIC;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS min_margin_of_safety_pct NUMERIC;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS preferred_discount_rate_method VARCHAR(20) DEFAULT 'wacc';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS favorite_metrics JSONB DEFAULT '[]';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS dashboard_section_order JSONB;
