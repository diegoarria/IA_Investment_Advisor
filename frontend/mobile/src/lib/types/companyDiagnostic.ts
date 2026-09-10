// Mirror of frontend/web/src/lib/types/companyDiagnostic.ts — keep both in sync.

export interface CompetitorComparison {
  metricName: string;
  targetCompanyValue: string;
  competitorValue: string;
  competitorName: string;
  nuvosAdvantageNote: string;
}

export interface SectorComparisonRow {
  metricName: string;
  companyValue: string;
  sectorValue: string;
  delta: "up" | "down" | "flat" | null;
  deltaLabel: string;
}

export interface SectorComparison {
  sector: string;
  peerCount: number;
  peerTickers: string[];
  rows: SectorComparisonRow[];
  insight: string;
}

export interface ValuationScenarios {
  conservative: number;
  baseFairValue: number;
  optimistic: number;
  currentPrice: number;
  marginOfSafetyPercent: number;
  peCurrent: number;
  peHistoricalAvg: number | null;
  evFcf: number | null;
  fcfAssumptions: {
    fcf_reported: number | null;
    fcf_normalized: number | null;
    maintenance_capex_estimate: number | null;
    growth_capex_estimate: number | null;
    methodology_note: string;
  } | null;
  waccDetails: {
    method: string;
    wacc_pct: number | null;
    beta: number | null;
    risk_free_rate_pct: number | null;
    equity_risk_premium_pct: number | null;
    cost_of_equity_pct: number | null;
    cost_of_debt_pct: number | null;
    tax_rate_pct: number | null;
    equity_weight_pct: number | null;
    debt_weight_pct: number | null;
  } | null;
  peForward: number | null;
  peNormalized: number | null;
  // Diego, 2026-09-03 — brought over from web's Fase 3 hero redesign (see
  // /Users/diegoarria/.claude/plans/dapper-scribbling-honey.md). Real
  // production fields the backend already returns; mobile's type just
  // hadn't declared them yet.
  analystTarget: { target_high: number | null; target_low: number | null; target_mean: number | null; target_median: number | null } | null;
  classification: {
    category: string;
    confidence: number;
    secondary_category: string | null;
    reason: string;
    factors: string[];
    method: string;
  } | null;
  fairPeBreakdown: {
    fair_pe: number;
    band: [number, number];
    primary_anchor: string;
    base_multiple: number | null;
    adjustments: { factor: string; points: number; reason: string }[];
    factors: { name: string; value: number | null; weight: number | null; reason: string }[];
  } | null;
  // Shadow-mode dual-track fair value — see CompanyDiagnosticShadowDualTrack.tsx.
  // ADDITIVE ONLY: never used for baseFairValue/marginOfSafetyPercent above.
  shadowDualTrack: ShadowDualTrack | null;
  // Diego, 2026-09-06 — brought over from web (same real production fields
  // company_diagnostic_service.py already returns; mobile's type just
  // hadn't declared them yet, same gap the fields above had).
  scenarioBreakdown: {
    bear: { eps: number | null; fair_pe: number; fair_value_per_share: number | null };
    base: { eps: number | null; fair_pe: number; fair_value_per_share: number | null };
    bull: { eps: number | null; fair_pe: number; fair_value_per_share: number | null };
  } | null;
  priceHistoryContext: {
    percentileCheaperThan: number;
    daysUsed: number;
    todayBucket: "cheap" | "normal" | "expensive";
    buckets: Record<
      "cheap" | "normal" | "expensive",
      { daysCount: number; timesHigherLater: number; medianReturnPct: number } | null
    >;
  } | null;
  fairValueChart: {
    points: { date: string; price: number; fairValue: number }[];
    effectiveMultiple: number;
    currentTtmEps: number;
  } | null;
}

export type ShadowDualTrack =
  | { applicable: false; note: string | null }
  | {
      applicable: true;
      earningsTrackValue: number;
      earningsTrackMultiple: number;
      multipleNote: string | null;
      epsUsed: number;
      epsNote: string | null;
      epsFlaggedQuarters: string[];
      fcfTrackValue: number | null;
      fcfTrackNote: string | null;
      capexSupercycleDetected: boolean;
      normalizedFcfMarginPct: number | null;
      blendedFairValue: number;
      earningsTrackWeightPct: number | null;
      fcfTrackWeightPct: number | null;
    };

export interface CompanyDiagnosticData {
  // Diego, 2026-09-09: set when this search was past the free weekly VI
  // search limit — data is still real (never fabricated); the card dims
  // everything but name/logo/price and shows an upgrade CTA.
  locked?: boolean;
  ticker: string;
  companyName: string;
  sector: string;
  exchange: string;
  score: number;
  scoreLabel: string;
  pillarScores: {
    quality: number;
    trust: number;
    value: number;
    simplicity: number;
  };
  badges: string[];
  oneLinerPitch: string;
  investmentThesis: string | null;
  revenueBreakdown: { category: string; percentage: number }[];
  moatPoints: string[];
  competitorComparison: {
    competitorName: string;
    rows: CompetitorComparison[];
    conclusion: string;
  } | null;
  sectorComparison: SectorComparison | null;
  financialHealth: {
    longTermDebt: string;
    netCash: string;
    roic: string;
    operatingMargin: string;
    netMargin: string;
    operatingCashFlow: string;
  };
  roicAdjustedForBuybacks: boolean;
  valuation: ValuationScenarios;
  sectorModelNote: { sector_type: string; detalle: string } | null;
  noiseVsReality: {
    marketSaw: string;
    nuvosReality: string;
  } | null;
  actionPlan: {
    profile: string;
    strategy: string;
  } | null;
}

export function fmtPrice(v: number | null | undefined, currency = "USD"): string {
  if (v == null) return "—";
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  return `${sym}${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type Verdict = "undervalued" | "overvalued" | "fair";
export interface ValuationStatus {
  verdict: Verdict;
  pct: number;
}

// Mirror of web's shared.tsx `_valuationStatus` — see its own doc comment
// for why undervalued/overvalued use two different denominators.
export function valuationStatus(fairValue: number | null, price: number | null): ValuationStatus | null {
  if (fairValue === null || fairValue <= 0 || price === null || price <= 0) return null;
  if (price > fairValue) {
    const premiumPct = ((price - fairValue) / price) * 100;
    return { verdict: premiumPct >= 5 ? "overvalued" : "fair", pct: premiumPct };
  }
  const mosPct = ((fairValue - price) / fairValue) * 100;
  return { verdict: mosPct >= 5 ? "undervalued" : "fair", pct: mosPct };
}

export const VERDICT_COLOR: Record<Verdict, string> = {
  undervalued: "#22c55e", overvalued: "#ef4444", fair: "#D4A24C",
};
export const VERDICT_EMOJI: Record<Verdict, string> = {
  undervalued: "🟢", overvalued: "🔴", fair: "🟡",
};
export const SCENARIO_COLOR: Record<"bear" | "base" | "bull", string> = {
  bear: "#DD6E63", base: "#D4A24C", bull: "#4FA695",
};

export function scoreColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return "#9ca3af";
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#eab308";
  if (score >= 40) return "#f59e0b";
  return "#ef4444";
}
