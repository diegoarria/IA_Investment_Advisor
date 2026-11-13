import { describe, expect, it } from "vitest";
import { selectResumenObservation, buildPulseObservationCopy, type PulseCompareAvailable, type PulseCompareResult } from "./pulseObservation";
import type { PortfolioInsight } from "./primaryInsight";

const STATIC_INSIGHTS: PortfolioInsight[] = [
  { category: "dominant_sector", text: "Tecnología domina tu portafolio.", supporting_data: {} },
];

function _available(overrides: Partial<PulseCompareAvailable> = {}): PulseCompareAvailable {
  return {
    available: true,
    snapshot_before: { id: "a", observed_at: "2026-09-02T00:00:00Z", period_key: "2026-09", snapshot_type: "month_end", verification_state: "full", valuation_coverage_pct: 100 },
    snapshot_after: { id: "b", observed_at: "2026-10-02T00:00:00Z", period_key: "2026-10", snapshot_type: "month_end", verification_state: "full", valuation_coverage_pct: 100 },
    comparability: { status: "comparable", reason: null, warnings: [] },
    changes: { positions: [], sectors: null, composition: null, geography: { equity_domicile: null, etf_underlying: null } },
    primary_change: { category: "sector", label: "Tecnología", before_pct: 42.1, after_pct: 47.4, delta_pp: 5.3 },
    causality: { level: "undetermined", note_es: "No contamos con información suficiente para identificar completamente las causas." },
    ...overrides,
  };
}

describe("selectResumenObservation", () => {
  it("test 1: Pulse wins when available, comparable, and has a primary_change", () => {
    const result = selectResumenObservation(STATIC_INSIGHTS, _available());
    expect(result.source).toBe("pulse");
  });

  it("test 2/3: falls back to the static insight when Pulse has no second snapshot (unavailable) -- primaryInsight preserved", () => {
    const pulse: PulseCompareResult = { available: false, reason: "insufficient_history" };
    const result = selectResumenObservation(STATIC_INSIGHTS, pulse);
    expect(result.source).toBe("static");
    expect(result.source === "static" && result.insight?.category).toBe("dominant_sector");
  });

  it("never overrides the static observation when Pulse comparability is only 'partial' (important uncertainty)", () => {
    const pulse = _available({ comparability: { status: "partial", reason: null, warnings: [{ dimension: "sectors", reason: "sector_coverage_gap" }] } });
    const result = selectResumenObservation(STATIC_INSIGHTS, pulse);
    expect(result.source).toBe("static");
  });

  it("falls back to static when Pulse is available and comparable but has no relevant primary_change", () => {
    const pulse = _available({ primary_change: null, causality: { level: "no_change", note_es: "No se detectaron cambios relevantes entre ambas fechas." } });
    const result = selectResumenObservation(STATIC_INSIGHTS, pulse);
    expect(result.source).toBe("static");
  });

  it("test 4: deterministic -- same inputs always produce the same decision", () => {
    const pulse = _available();
    const r1 = selectResumenObservation(STATIC_INSIGHTS, pulse);
    const r2 = selectResumenObservation(STATIC_INSIGHTS, pulse);
    expect(r1.source).toBe(r2.source);
  });

  it("returns 'none' when there is neither a static insight nor an eligible Pulse change", () => {
    const result = selectResumenObservation([], { available: false, reason: "insufficient_history" });
    expect(result.source).toBe("none");
  });
});

describe("buildPulseObservationCopy", () => {
  it("test 6: sector observation re-presents the backend's own numbers verbatim", () => {
    const copy = buildPulseObservationCopy(_available(), "es");
    expect(copy).not.toBeNull();
    expect(copy!.before_pct).toBe(42.1);
    expect(copy!.after_pct).toBe(47.4);
    expect(copy!.delta_pp).toBe(5.3);
    expect(copy!.headline).toContain("Tecnología");
  });

  it("test 7: concentration observation uses the ticker as the label", () => {
    const pulse = _available({ primary_change: { category: "concentration", label: "AAPL", before_pct: 10, after_pct: 18, delta_pp: 8 } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy!.headline).toContain("AAPL");
  });

  it("test 8: composition observation never shows a raw category code", () => {
    const pulse = _available({ primary_change: { category: "composition", label: "etf", before_pct: 60, after_pct: 70, delta_pp: 10 } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy!.headline).not.toContain("etf");
    expect(copy!.headline).toContain("ETF");
  });

  it("never fabricates a causality note -- always the backend's own text", () => {
    const pulse = _available({ causality: { level: "undetermined", note_es: "TEXTO EXACTO DEL BACKEND" } });
    const copy = buildPulseObservationCopy(pulse, "es");
    expect(copy!.causalityNote).toBe("TEXTO EXACTO DEL BACKEND");
  });

  it("returns null when there is no primary_change -- never invents one", () => {
    const pulse = _available({ primary_change: null });
    expect(buildPulseObservationCopy(pulse, "es")).toBeNull();
  });

  it("test 19: never uses forbidden evaluative language", () => {
    const copy = buildPulseObservationCopy(_available(), "es")!;
    const forbidden = ["mejor", "peor", "peligroso", "deberías", "compra", "vende", "recomend"];
    const text = (copy.headline + " " + copy.explanation + " " + copy.causalityNote).toLowerCase();
    for (const word of forbidden) expect(text).not.toContain(word);
  });
});
