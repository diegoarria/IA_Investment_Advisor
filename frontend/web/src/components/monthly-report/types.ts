// Reuse Wrapped's brand tokens/formatters — Monthly Report is a sibling
// experience (same full-bleed story-card format), not a separate design
// system. See wrapped/types.ts for the source of truth.
export { WT, fmtPct, fmtUsd } from "../wrapped/types";

export interface MonthlyReportArchetype {
  key: string;
  name: string;
  emoji: string;
  tagline: string;
  traits: string[];
}

export interface MonthlyReportPositionMove {
  ticker: string;
  company_name?: string | null;
  move_pct: number;
}

// growth/quality/value/defensive/other -> % of portfolio (real GQV
// classification rollup — see monthly_report_service.py). Only buckets
// that are actually present (>0%) are included.
export type MonthlyReportComposition = Record<string, number>;

export interface MonthlyReportPortfolio {
  available: boolean;
  return_pct: number | null;
  benchmark_pct: number | null;
  diff_pp: number | null;
  best_position: MonthlyReportPositionMove | null;
  worst_position: MonthlyReportPositionMove | null;
  composition: MonthlyReportComposition | null;
  insight: string | null;
}

export interface MonthlyReportDecisions {
  total: number;
  buys_count: number;
  sells_count: number;
  holds_count: number;
  has_activity: boolean;
  highlight: string | null;
  improvement_tip: string | null;
}

export interface MonthlyReportCompany {
  ticker: string;
  company_name?: string | null;
  times_analyzed: number;
}

export interface MonthlyReportResearch {
  companies_researched: number;
  top_companies: MonthlyReportCompany[];
  favorite_company: MonthlyReportCompany | null;
  research_pattern: string[] | null;
  insight: string | null;
}

export interface MonthlyReportWealth {
  available: boolean;
  portfolio_value: number | null;
  variation_pct: number | null;
  stocks_value: number | null;
  cash_value: number | null;
  dividend_value: number | null;
}

export interface MonthlyReportHabits {
  active_days: number;
  longest_streak: number;
  favorite_weekday: string | null;
  activity_breakdown: { analizar: number; seguimiento: number; decisiones: number };
}

export interface MonthlyReportEvolution {
  current_archetype: MonthlyReportArchetype | null;
  past_archetype: MonthlyReportArchetype | null;
  months_compared: number | null;
  insight: string | null;
}

export interface MonthlyReportMission {
  key: string;
  title: string;
  text: string;
}

export interface MonthlyReportNextMonth {
  missions: MonthlyReportMission[];
  next_milestone: string | null;
}

export interface MonthlyReportAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface MonthlyReportAchievements {
  unlocked_this_month: MonthlyReportAchievement[];
  total_unlocked: number;
  total_available: number;
  next_achievement: MonthlyReportAchievement | null;
}

// The PUBLIC, shareable subset — server-enforced to never carry a DOLLAR-
// AMOUNT field (portfolio value, cash, position sizes — see monthly_report_
// service.py's build_share_card + FORBIDDEN_SHARE_FIELDS). return_pct/
// move_pct ARE percentages, deliberately allowed here (Diego, 2026-09-08,
// confirmed explicitly) — trust the backend contract; this type just
// mirrors its shape, it isn't itself the privacy boundary.
export interface MonthlyReportShareCardBestPosition {
  ticker: string;
  company_name?: string | null;
  move_pct: number;
}

export interface MonthlyReportShareCard {
  month_label: string;
  user_name: string;
  avatar_url: string | null;
  return_pct: number | null;
  positions_count: number;
  best_position: MonthlyReportShareCardBestPosition | null;
  decisions_count: number;
  companies_researched: number;
  archetype_name: string | null;
  achievement: { name: string; icon: string } | null;
}

export interface MonthlyReportOverview {
  month_label: string;
  year: number;
  month: number;
  is_current_month: boolean;
  decisions_count: number;
  companies_researched: number;
  active_days: number;
}

export interface MonthlyReportData {
  available: true;
  overview: MonthlyReportOverview;
  portfolio: MonthlyReportPortfolio;
  decisions: MonthlyReportDecisions;
  research: MonthlyReportResearch;
  wealth: MonthlyReportWealth;
  habits: MonthlyReportHabits;
  evolution: MonthlyReportEvolution;
  next_month: MonthlyReportNextMonth;
  achievements: MonthlyReportAchievements;
  share_card: MonthlyReportShareCard;
}

export interface MonthlyReportUnavailable {
  available: false;
  reason?: "future_month" | "before_account_inception" | string;
}

export type MonthlyReportResponse = MonthlyReportData | MonthlyReportUnavailable;

// Composition bucket display labels (Spanish) — kept here, not derived
// from the raw GQV category strings, since the backend already collapses
// those into these 5 buckets (never shows raw Lynch category names).
export const COMPOSITION_LABELS: Record<string, string> = {
  growth: "Growth",
  quality: "Quality",
  value: "Value",
  defensive: "Defensivo",
  other: "Otro",
};
