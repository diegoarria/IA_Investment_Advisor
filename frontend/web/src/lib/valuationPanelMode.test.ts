import { describe, it, expect } from "vitest";
import { resolveValuationPanelMode } from "./valuationPanelMode";

// Regression guard for Diego's explicit "siempre siempre siempre" ask —
// CompanyDiagnosticCard must always render when available, and the
// retired legacy GQV/DCF panel design must never be reachable through this
// function's output (only "diagnostic" | "loading" | "unavailable" exist —
// no "gqv" escape hatch, ever).
describe("resolveValuationPanelMode", () => {
  it("prefers CompanyDiagnosticCard whenever it's available", () => {
    expect(resolveValuationPanelMode(true)).toBe("diagnostic");
    expect(resolveValuationPanelMode(true, true)).toBe("diagnostic");
  });

  it("shows the honest unavailable state when the diagnostic isn't available and nothing is loading", () => {
    expect(resolveValuationPanelMode(false)).toBe("unavailable");
    expect(resolveValuationPanelMode(false, false)).toBe("unavailable");
  });

  it("shows a loading state while the diagnostic is still in flight, instead of ever falling back to a legacy panel", () => {
    expect(resolveValuationPanelMode(false, true)).toBe("loading");
  });

  it("defaults isDiagnosticLoading to false", () => {
    expect(resolveValuationPanelMode(false)).toBe("unavailable");
  });

  it("never returns anything other than the 3 known modes (no legacy-panel escape hatch)", () => {
    const allOutcomes = [
      resolveValuationPanelMode(true),
      resolveValuationPanelMode(true, true),
      resolveValuationPanelMode(false, true),
      resolveValuationPanelMode(false, false),
    ];
    for (const outcome of allOutcomes) {
      expect(["diagnostic", "loading", "unavailable"]).toContain(outcome);
    }
  });
});
