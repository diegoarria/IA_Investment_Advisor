// Reuse Wrapped's brand tokens/formatters — Investor Recap is a sibling
// experience (same full-bleed story-card format), not a separate design
// system. See wrapped/types.ts for the source of truth.
export { WT, fmtPct, fmtUsd } from "../wrapped/types";

export interface RecapArchetype {
  key: string;
  name: string;
  emoji: string;
  tagline: string;
  traits: string[];
}

export interface RecapPositionMove {
  ticker: string;
  company_name?: string | null;
  move_pct: number;
}

// growth/quality/value/defensive/other -> % of portfolio (real GQV
// classification rollup — see investor_recap_service.py). Only buckets
// that are actually present (>0%) are included.
export type RecapComposition = Record<string, number>;

export interface RecapPortfolio {
  available: boolean;
  return_pct: number | null;
  benchmark_pct: number | null;
  diff_pp: number | null;
  best_position: RecapPositionMove | null;
  worst_position: RecapPositionMove | null;
  composition: RecapComposition | null;
  insight: string | null;
}

export interface RecapDecisions {
  total: number;
  buys_count: number;
  sells_count: number;
  holds_count: number;
  has_activity: boolean;
  highlight: string | null;
  improvement_tip: string | null;
}

export interface RecapCompany {
  ticker: string;
  company_name?: string | null;
  times_analyzed: number;
}

export interface RecapResearch {
  companies_researched: number;
  top_companies: RecapCompany[];
  favorite_company: RecapCompany | null;
  research_pattern: string[] | null;
  insight: string | null;
}

export interface RecapWealth {
  available: boolean;
  portfolio_value: number | null;
  variation_pct: number | null;
  stocks_value: number | null;
  cash_value: number | null;
  dividend_value: number | null;
}

export interface RecapHabits {
  active_days: number;
  longest_streak: number;
  favorite_weekday: string | null;
  activity_breakdown: { analizar: number; seguimiento: number; decisiones: number };
}

export interface RecapEvolution {
  current_archetype: RecapArchetype | null;
  past_archetype: RecapArchetype | null;
  months_compared: number | null;
  insight: string | null;
}

export interface RecapMission {
  key: string;
  title: string;
  text: string;
}

export interface RecapNextMonth {
  missions: RecapMission[];
  next_milestone: string | null;
}

export interface RecapAchievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface RecapAchievements {
  unlocked_this_month: RecapAchievement[];
  total_unlocked: number;
  total_available: number;
  next_achievement: RecapAchievement | null;
}

// The PUBLIC, shareable subset — server-enforced to never carry money/
// portfolio-value/return fields (see investor_recap_service.py's
// build_share_card + FORBIDDEN_SHARE_FIELDS). Trust the backend contract;
// this type just mirrors its shape, it isn't itself the privacy boundary.
export interface RecapShareCard {
  month_label: string;
  archetype: { name: string; emoji: string; tagline: string; traits: string[] } | null;
  achievement: { name: string; icon: string } | null;
  favorite_activity: string | null;
  research_obsession: string | null;
  current_focus: string | null;
  strongest_skill: string | null;
  active_days: number;
}

export interface RecapOverview {
  month_label: string;
  year: number;
  month: number;
  is_current_month: boolean;
  decisions_count: number;
  companies_researched: number;
  active_days: number;
}

export interface InvestorRecapData {
  available: true;
  overview: RecapOverview;
  portfolio: RecapPortfolio;
  decisions: RecapDecisions;
  research: RecapResearch;
  wealth: RecapWealth;
  habits: RecapHabits;
  evolution: RecapEvolution;
  next_month: RecapNextMonth;
  achievements: RecapAchievements;
  share_card: RecapShareCard;
}

export interface InvestorRecapUnavailable {
  available: false;
  reason?: "future_month" | "before_account_inception" | string;
}

export type InvestorRecapResponse = InvestorRecapData | InvestorRecapUnavailable;

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
