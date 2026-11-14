import {
  selectResumenObservation,
  buildPulseObservationCopy,
  type PulseCompareAvailable,
  type PulseCompareResult,
} from "./pulseObservation";
import type { PortfolioInsight } from "./primaryInsight";

function staticInsight(category: string): PortfolioInsight {
  return { category, text: `texto de ${category}`, supporting_data: {} };
}

function pulseAvailable(overrides: Partial<PulseCompareAvailable> = {}): PulseCompareAvailable {
  return {
    available: true,
    snapshot_before: { id: "a", observed_at: "2026-01-01", period_key: "2026-W01", snapshot_type: "weekly", verification_state: "verified", valuation_coverage_pct: 100 },
    snapshot_after: { id: "b", observed_at: "2026-01-08", period_key: "2026-W02", snapshot_type: "weekly", verification_state: "verified", valuation_coverage_pct: 100 },
    comparability: { status: "comparable", reason: null, warnings: [] },
    changes: { positions: [], sectors: null, composition: null, geography: { equity_domicile: null, etf_underlying: null } },
    primary_change: { category: "sector", label: "Tecnología", before_pct: 30, after_pct: 40, delta_pp: 10 },
    causality: { level: "undetermined", note_es: "No se puede determinar la causa exacta del cambio." },
    ...overrides,
  };
}

describe("selectResumenObservation", () => {
  it("prefers Pulse when it is available, comparable, and has a primary_change", () => {
    const result = selectResumenObservation([staticInsight("dominant_sector")], pulseAvailable());
    expect(result.source).toBe("pulse");
  });

  it("never shows both Pulse and the static insight at once — falls back to static only when Pulse is null", () => {
    const result = selectResumenObservation([staticInsight("dominant_sector")], null);
    expect(result.source).toBe("static");
    if (result.source === "static") expect(result.insight?.category).toBe("dominant_sector");
  });

  it("falls back to the static insight when Pulse is unavailable", () => {
    const unavailable: PulseCompareResult = { available: false, reason: "insufficient_snapshots" };
    const result = selectResumenObservation([staticInsight("top_holdings")], unavailable);
    expect(result.source).toBe("static");
  });

  it("falls back to the static insight when Pulse comparability is only 'partial'", () => {
    const partial = pulseAvailable({ comparability: { status: "partial", reason: null, warnings: [{ dimension: "sectors", reason: "methodology_mismatch" }] } });
    const result = selectResumenObservation([staticInsight("coverage_gap")], partial);
    expect(result.source).toBe("static");
  });

  it("falls back to the static insight when Pulse is comparable but has no primary_change", () => {
    const noChange = pulseAvailable({ primary_change: null });
    const result = selectResumenObservation([staticInsight("coverage_gap")], noChange);
    expect(result.source).toBe("static");
  });

  it("returns 'none' when there is no Pulse data and no static insight either", () => {
    const result = selectResumenObservation([], null);
    expect(result.source).toBe("none");
  });
});

describe("buildPulseObservationCopy", () => {
  it("returns null when the Pulse snapshot has no primary_change (never fabricates one)", () => {
    const pulse = pulseAvailable({ primary_change: null });
    expect(buildPulseObservationCopy(pulse, "es")).toBeNull();
  });

  it("re-presents the backend's own before/after/delta numbers without recomputing them", () => {
    const pulse = pulseAvailable({ primary_change: { category: "sector", label: "Tecnología", before_pct: 30, after_pct: 42.5, delta_pp: 12.5 } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy?.before_pct).toBe(30);
    expect(copy?.after_pct).toBe(42.5);
    expect(copy?.delta_pp).toBe(12.5);
  });

  it("uses the backend's own causality note verbatim, never inventing a cause", () => {
    const pulse = pulseAvailable({ causality: { level: "no_change", note_es: "nota exacta del backend" } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy?.causalityNote).toBe("nota exacta del backend");
  });

  it("describes a positive delta as an increase in Spanish", () => {
    const pulse = pulseAvailable({ primary_change: { category: "sector", label: "Tecnología", before_pct: 10, after_pct: 20, delta_pp: 10 } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy?.headline).toMatch(/aumentó/);
  });

  it("describes a negative delta as a decrease in English", () => {
    const pulse = pulseAvailable({ primary_change: { category: "sector", label: "Energy", before_pct: 20, after_pct: 10, delta_pp: -10 } });
    const copy = buildPulseObservationCopy(pulse, "en");
    expect(copy?.headline).toMatch(/decreased/);
  });

  it("labels an ETF composition change using the translated category label, not the raw 'etf' code", () => {
    const pulse = pulseAvailable({ primary_change: { category: "composition", label: "etf", before_pct: 20, after_pct: 35, delta_pp: 15 } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy?.headline).toContain("la proporción de ETFs");
  });

  it("uses the ticker label directly for a concentration change", () => {
    const pulse = pulseAvailable({ primary_change: { category: "concentration", label: "NVDA", before_pct: 15, after_pct: 25, delta_pp: 10 } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy?.headline).toContain("NVDA");
  });
});
