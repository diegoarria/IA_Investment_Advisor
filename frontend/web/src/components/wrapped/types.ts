export interface WrappedArchetype {
  key: string;
  name: string;
  tagline: string;
  traits: string[];
}

export interface WrappedInvestorType {
  key: string;
  emoji: string;
  name: string;
  tagline: string;
}

export interface WrappedInvestorScore {
  score: number;
  sub_scores: Record<string, number>;
}

export interface WrappedPercentile {
  percentile: number;
  cohort_size: number;
}

export interface WrappedFavoriteCompany {
  ticker: string;
  company_name?: string | null;
  times_analyzed: number;
  in_portfolio: boolean;
  weight_pct?: number | null;
}

export interface WrappedTopPosition {
  ticker: string;
  company_name?: string | null;
  return_pct: number;
  invested: number;
  current_value: number;
}

export interface WrappedWorstDecision {
  ticker: string;
  company_name?: string | null;
  pnl: number;
  pnl_pct: number;
  realized: boolean;
}

export interface WrappedData {
  year: number;
  user_name: string;
  avatar_url?: string | null;
  archetype?: WrappedArchetype | null;
  investor_type?: WrappedInvestorType | null;
  invested_this_year: number;
  growth_pct?: number | null;
  companies_analyzed: number;
  arthur_conversations: number;
  longest_streak?: number | null;
  days_active: number;
  percentile?: WrappedPercentile | null;
  favorite_companies: WrappedFavoriteCompany[];
  top_positions: WrappedTopPosition[];
  worst_decision?: WrappedWorstDecision | null;
  investor_score?: WrappedInvestorScore | null;
}

// Brand tokens — same values as globals.css's :root, kept literal here since
// Wrapped is a full-bleed, deliberately dark experience that doesn't switch
// with the app's light/dark theme toggle (same reasoning as /subvaluadas's
// own fixed viTheme).
export const WT = {
  bg: "#03060e",
  card: "#090f1f",
  card2: "#0d1526",
  border: "#162035",
  borderS: "#1e2e48",
  text: "#eef2ff",
  sub: "#8fa3c0",
  muted: "#546b85",
  dim: "#2a3f58",
  accent: "#00b96d",
  accentL: "#00e887",
  gold: "#D4A24C",
  coral: "#DD6E63",
  teal: "#4FA695",
  gradGreen: "linear-gradient(135deg, #00b96d 0%, #00e887 100%)",
};

export const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
export const fmtUsd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const SCORE_LABELS: Record<string, string> = {
  educacion: "Educación",
  paciencia: "Paciencia",
  diversificacion: "Diversificación",
  analisis: "Análisis",
};

/** Highest-scoring sub-score, human-labeled — Wrapped's "mayor fortaleza". */
export function topStrength(score: WrappedInvestorScore | null | undefined): string | null {
  if (!score || !Object.keys(score.sub_scores).length) return null;
  const [key] = Object.entries(score.sub_scores).sort((a, b) => b[1] - a[1])[0];
  return SCORE_LABELS[key] || key;
}
