// Fase 4, Incremento 4 — Comparaciones (Parte D). Pure row-building logic
// for the peer comparison bar chart, split out of PeerComparisonChart.tsx
// (a "use client" component) per Parte O's rule ("evitar lógica financiera
// en componentes visuales") — also lets this run through vitest without a
// JSX-aware test harness, which this repo doesn't have set up yet.
//
// Deliberately limited to the four metrics quality.peer_comparison_engine
// (Fase 2) actually computes per real peer — never fabricates a
// comparison for a metric the backend doesn't provide.

export interface CompanyComparisonMetrics {
  quality_score: number | null;
  roic_pct: number | null;
  operating_margin_pct: number | null;
  revenue_cagr_pct: number | null;
}

export type MetricKey = "quality_score" | "roic_pct" | "operating_margin_pct" | "revenue_cagr_pct";

export interface PeerMetricRow {
  ticker: string;
  quality_score: number | null;
  roic_pct: number | null;
  operating_margin_pct: number | null;
  revenue_cagr_pct: number | null;
}

export interface Row {
  ticker: string;
  value: number;
  isCompany: boolean;
}

export const METRICS: { key: MetricKey; labelKey: string; suffix: string }[] = [
  { key: "quality_score", labelKey: "subvaluadas.comparisons.metrics.qualityScore", suffix: "" },
  { key: "roic_pct", labelKey: "subvaluadas.comparisons.metrics.roic", suffix: "%" },
  { key: "operating_margin_pct", labelKey: "subvaluadas.comparisons.metrics.operatingMargin", suffix: "%" },
  { key: "revenue_cagr_pct", labelKey: "subvaluadas.comparisons.metrics.revenueGrowth", suffix: "%" },
];

/** Builds the sorted bar-chart rows for one metric — the company's own row
 * (if it has a real value for this metric) plus every real peer that also
 * has a real value. A peer/company with `null` for this specific metric is
 * EXCLUDED, never shown as zero (a real "no data" must never look like a
 * real "zero"). */
export function buildRows(
  ticker: string, companyMetrics: CompanyComparisonMetrics, peers: PeerMetricRow[], metric: MetricKey,
): Row[] {
  const rows: Row[] = [];
  const companyValue = companyMetrics[metric];
  if (companyValue !== null) rows.push({ ticker, value: companyValue, isCompany: true });
  for (const peer of peers) {
    const value = peer[metric];
    if (value !== null) rows.push({ ticker: peer.ticker, value, isCompany: false });
  }
  return rows.sort((a, b) => b.value - a.value);
}
