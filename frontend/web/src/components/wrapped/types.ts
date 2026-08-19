export interface WrappedTopStock {
  ticker: string;
  ytd_pct: number;
  invested?: number;
  current_value?: number;
}

export interface WrappedFavorita {
  ticker: string;
  times_analyzed: number;
}

export interface WrappedMilestone {
  title: string;
  description?: string;
}

export interface WrappedArchetype {
  key: string;
  name: string;
  tagline: string;
  traits: string[];
}

export interface WrappedInvestorScore {
  score: number;
  sub_scores: Record<string, number>;
}

export interface WrappedEvolution {
  start_score?: number;
  end_score?: number;
}

export interface WrappedCommunity {
  percentile: number;
  cohort_size: number;
}

export interface WrappedData {
  year: number;
  user_name: string;
  avatar_url?: string | null;
  top_stocks: WrappedTopStock[];
  favoritas: WrappedFavorita[];
  lessons: number;
  days_active: number;
  top_sector: string;
  sim_count: number;
  debate_count: number;
  next_chapter?: string | null;
  vs_community?: WrappedCommunity | null;
  spy_ytd_pct?: number | null;
  growth_pct?: number;
  milestones_this_year?: WrappedMilestone[];
  decisions_logged_this_year?: number;
  diversification_note?: string;
  archetype?: WrappedArchetype;
  investor_score?: WrappedInvestorScore;
  evolution?: WrappedEvolution;
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
