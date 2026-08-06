// Fase 4, Incremento 12 (Personalización, Parte L) — pure helpers shared
// between the Settings page and /subvaluadas. Deliberately scoped to
// per-request surfaces only (confirmed with the user before building
// this) — see backend/migrations/069_personalization_settings.sql's
// docstring for why required_return/min_margin_of_safety never touch the
// shared nif_dashboard/quick_analysis caches.

export type DiscountRateMethod = "wacc" | "required_return";

export const DISCOUNT_RATE_METHODS: DiscountRateMethod[] = ["wacc", "required_return"];

export function isValidDiscountRateMethod(value: unknown): value is DiscountRateMethod {
  return value === "wacc" || value === "required_return";
}

/** Mirrors backend/app/services/valuation/dcf_engine.py's
 * select_discount_rate EXACTLY (same selection rule, not a re-derivation)
 * — picks the manual DCF calculator's default discount rate. Falls back
 * to `wacc` whenever `required_return` is requested but the user hasn't
 * set one, same "never silently paper over a missing value" rule as the
 * backend function (there it raises; here — a UI default — it degrades
 * to the safe fallback instead of throwing). */
export function selectDefaultDiscountRatePct(
  wacc: number, requiredReturnPct: number | null, method: DiscountRateMethod,
): number {
  if (method === "required_return" && requiredReturnPct !== null) return requiredReturnPct;
  return wacc;
}

/** Every dashboard block on /subvaluadas that can independently move —
 * deliberately a SMALL, separate list from src/lib/detailLevel.ts's
 * DashboardSection (that type controls VISIBILITY per detail level; this
 * one controls ORDER, and only covers the blocks that are already
 * standalone JSX siblings — the giant NIF pillars/quality-engines grid
 * moves as ONE block, not pillar-by-pillar, since splitting it further
 * would be a real restructuring, not a reorder). */
export type ReorderableSection = "checklist" | "nif" | "timeline" | "thesis_history";

export const REORDERABLE_SECTIONS: ReorderableSection[] = ["checklist", "nif", "timeline", "thesis_history"];

export const DEFAULT_DASHBOARD_SECTION_ORDER: ReorderableSection[] = ["checklist", "nif", "timeline", "thesis_history"];

/** Validates a stored order against the known reorderable keys — any
 * unknown/missing key falls back to the full default order rather than
 * silently dropping a section from the page. */
export function resolveDashboardSectionOrder(stored: string[] | null | undefined): ReorderableSection[] {
  if (!stored || stored.length !== REORDERABLE_SECTIONS.length) return DEFAULT_DASHBOARD_SECTION_ORDER;
  const asSet = new Set(stored);
  const allKnown = stored.every((s) => (REORDERABLE_SECTIONS as string[]).includes(s));
  if (!allKnown || asSet.size !== REORDERABLE_SECTIONS.length) return DEFAULT_DASHBOARD_SECTION_ORDER;
  return stored as ReorderableSection[];
}

export const FAVORITE_METRIC_KEYS = [
  "qualityScore", "convictionScore", "marginOfSafetyPct", "opportunityScore", "thesisStatus", "netChangeScore",
] as const;
export type FavoriteMetricKey = typeof FAVORITE_METRIC_KEYS[number];

export const MAX_FAVORITE_METRICS = 6;

export function sanitizeFavoriteMetrics(values: string[] | null | undefined): FavoriteMetricKey[] {
  if (!values) return [];
  return values.filter((v): v is FavoriteMetricKey => (FAVORITE_METRIC_KEYS as readonly string[]).includes(v)).slice(0, MAX_FAVORITE_METRICS);
}
