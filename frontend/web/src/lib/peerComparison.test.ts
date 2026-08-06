import { describe, it, expect } from "vitest";
import { buildRows, type CompanyComparisonMetrics, type PeerMetricRow } from "./peerComparison";

const companyMetrics: CompanyComparisonMetrics = {
  quality_score: 80, roic_pct: 25, operating_margin_pct: 30, revenue_cagr_pct: 10,
};

const peers: PeerMetricRow[] = [
  { ticker: "MSFT", quality_score: 90, roic_pct: 35, operating_margin_pct: 40, revenue_cagr_pct: 12 },
  { ticker: "GOOGL", quality_score: 70, roic_pct: 20, operating_margin_pct: 25, revenue_cagr_pct: 8 },
  { ticker: "META", quality_score: null, roic_pct: 18, operating_margin_pct: null, revenue_cagr_pct: 15 },
];

describe("buildRows", () => {
  it("includes the company row and sorts descending by the selected metric", () => {
    const rows = buildRows("AAPL", companyMetrics, peers, "quality_score");
    expect(rows.map((r) => r.ticker)).toEqual(["MSFT", "AAPL", "GOOGL"]);
    // META has quality_score: null -> excluded from this metric's rows
    expect(rows.find((r) => r.ticker === "META")).toBeUndefined();
  });

  it("marks only the company's own row as isCompany", () => {
    const rows = buildRows("AAPL", companyMetrics, peers, "roic_pct");
    expect(rows.find((r) => r.ticker === "AAPL")?.isCompany).toBe(true);
    expect(rows.filter((r) => r.isCompany)).toHaveLength(1);
  });

  it("switches metric correctly", () => {
    const rows = buildRows("AAPL", companyMetrics, peers, "operating_margin_pct");
    expect(rows.map((r) => r.ticker)).toEqual(["MSFT", "AAPL", "GOOGL"]);
  });

  it("excludes the company row entirely when its own metric is null", () => {
    const metricsWithGap: CompanyComparisonMetrics = { ...companyMetrics, revenue_cagr_pct: null };
    const rows = buildRows("AAPL", metricsWithGap, peers, "revenue_cagr_pct");
    expect(rows.find((r) => r.ticker === "AAPL")).toBeUndefined();
    expect(rows.map((r) => r.ticker)).toEqual(["META", "MSFT", "GOOGL"]);
  });

  it("a real peer with a null value for this metric is excluded, never shown as zero", () => {
    const rows = buildRows("AAPL", companyMetrics, peers, "operating_margin_pct");
    expect(rows.find((r) => r.ticker === "META")).toBeUndefined();
  });

  it("empty peer list still returns the company's own row", () => {
    const rows = buildRows("AAPL", companyMetrics, [], "quality_score");
    expect(rows).toEqual([{ ticker: "AAPL", value: 80, isCompany: true }]);
  });
});
