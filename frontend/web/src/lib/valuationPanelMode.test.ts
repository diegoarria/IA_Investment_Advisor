import { describe, it, expect } from "vitest";
import { resolveValuationPanelMode } from "./valuationPanelMode";

// Regression guard for Diego's explicit "siempre siempre siempre" ask —
// CompanyDiagnosticCard must always render when available, and the
// retired legacy DCF panel design must never be reachable through this
// function's output (only "diagnostic" | "gqv" | "unavailable" exist).
describe("resolveValuationPanelMode", () => {
  it("prefers CompanyDiagnosticCard whenever it's available, regardless of GQV status", () => {
    expect(resolveValuationPanelMode(true, true)).toBe("diagnostic");
    expect(resolveValuationPanelMode(true, false)).toBe("diagnostic");
  });

  it("falls back to the GQV panel only when CompanyDiagnosticCard is unavailable", () => {
    expect(resolveValuationPanelMode(false, true)).toBe("gqv");
  });

  it("shows the honest unavailable state when neither engine produced a reliable result", () => {
    expect(resolveValuationPanelMode(false, false)).toBe("unavailable");
  });

  it("never returns anything other than the 3 known modes (no legacy-panel escape hatch)", () => {
    const allOutcomes = [
      resolveValuationPanelMode(true, true),
      resolveValuationPanelMode(true, false),
      resolveValuationPanelMode(false, true),
      resolveValuationPanelMode(false, false),
    ];
    for (const outcome of allOutcomes) {
      expect(["diagnostic", "gqv", "unavailable"]).toContain(outcome);
    }
  });
});
