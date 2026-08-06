// Fase 4, Incremento 1 — "Nivel de Detalle" (Principiante/Intermedio/
// Avanzado/Profesional): an explicit, user-switchable preference for how
// much of the analysis to show at once.
//
// Deliberately SEPARATE from `UserLevel` (src/lib/userLevel.ts), which stays
// an *inferred* knowledge signal (from onboarding) driving jargon tooltips
// (FinancialTip/TOOLTIPS) — this file answers "how much do I want to see
// right now," not "how much does the system think I know." A beginner may
// still want to see everything; an expert may want a quick glance. Mixing
// the two would force one axis to do two jobs.
//
// Same shape as userLevel.ts's LEVEL_ORDER/isAtLeast pattern, extended to 4
// values and applied to dashboard SECTIONS rather than jargon tooltips.

export type DetailLevel = "principiante" | "intermedio" | "avanzado" | "profesional";

export const DETAIL_LEVELS: DetailLevel[] = ["principiante", "intermedio", "avanzado", "profesional"];

export const DEFAULT_DETAIL_LEVEL: DetailLevel = "intermedio";

const LEVEL_ORDER: Record<DetailLevel, number> = {
  principiante: 0,
  intermedio: 1,
  avanzado: 2,
  profesional: 3,
};

/** Returns true if `level` is at least as detailed as `min`. */
export function isAtLeastDetail(level: DetailLevel, min: DetailLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[min];
}

// Every section a Fase 4 dashboard can show, mapped to the minimum detail
// level required to display it. Sections marked "avanzado"/"profesional"
// already exist in `/subvaluadas` today (DCF, Reverse DCF, sensitivity,
// scenarios, raw factors[]) — this mapping only controls visibility, it
// never hides data the backend doesn't already compute.
//
// "monte_carlo" was retired (Nuvos AI Fair Value Engine redesign,
// Incremento 13) along with monte_carlo_engine.py — no component ever
// gated on it (`isSectionVisible(level, "monte_carlo")` had zero callers).
export type DashboardSection =
  | "summary"
  | "quality_headline"
  | "fair_value_range"
  | "key_risks"
  | "conclusion"
  | "roic_fcf_growth"
  | "moat_score"
  | "capital_allocation"
  | "competitors"
  | "timeline"
  | "dcf_full"
  | "reverse_dcf"
  | "sensitivity"
  | "scenarios"
  | "raw_assumptions"
  | "factors_detail";

export const SECTION_MIN_LEVEL: Record<DashboardSection, DetailLevel> = {
  summary: "principiante",
  quality_headline: "principiante",
  fair_value_range: "principiante",
  key_risks: "principiante",
  conclusion: "principiante",

  roic_fcf_growth: "intermedio",
  moat_score: "intermedio",
  capital_allocation: "intermedio",
  competitors: "intermedio",
  timeline: "intermedio",

  dcf_full: "avanzado",
  reverse_dcf: "avanzado",
  sensitivity: "avanzado",
  scenarios: "avanzado",

  raw_assumptions: "profesional",
  factors_detail: "profesional",
};

/** Whether `section` should render for a user currently on `level`. */
export function isSectionVisible(level: DetailLevel, section: DashboardSection): boolean {
  return isAtLeastDetail(level, SECTION_MIN_LEVEL[section]);
}

export function isValidDetailLevel(value: unknown): value is DetailLevel {
  return typeof value === "string" && (DETAIL_LEVELS as string[]).includes(value);
}

/** i18n-aware label for a detail level — call with the `t` from useTranslation(). */
export function getDetailLevelLabel(t: (key: string) => string, level: DetailLevel): string {
  return t(`common.detailLevel.${level}`);
}
