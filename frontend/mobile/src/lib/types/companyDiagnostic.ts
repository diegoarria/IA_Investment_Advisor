// Mirror of frontend/web/src/lib/types/companyDiagnostic.ts — keep both in sync.

export interface CompetitorComparison {
  metricName: string;
  targetCompanyValue: string;
  competitorValue: string;
  competitorName: string;
  nuvosAdvantageNote: string;
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
  waccDetails: { method: string; wacc_pct: number | null } | null;
  peForward: number | null;
  peNormalized: number | null;
}

export interface CompanyDiagnosticData {
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
