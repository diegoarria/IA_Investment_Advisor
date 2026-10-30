import { describe, it, expect } from "vitest";
import { safeToFixed } from "./numberFormat";

// Regression guard for the Radar `discount_rate_pct.toFixed(1)` crash
// risk (2026-10-29 audit): every company_valuations row persisted before
// the persistence fix had this field null, and historical rows are
// intentionally never backfilled with an invented value.
describe("safeToFixed", () => {
  it("formats a valid WACC-shaped value", () => {
    expect(safeToFixed(6.49, 1)).toBe("6.5");
  });

  it("formats with a custom decimal count", () => {
    expect(safeToFixed(6.494, 2)).toBe("6.49");
  });

  it("returns null for null (historical row predating the persistence fix)", () => {
    expect(safeToFixed(null, 1)).toBeNull();
  });

  it("returns null for undefined (field absent from an older schema shape)", () => {
    expect(safeToFixed(undefined, 1)).toBeNull();
  });

  it("returns null for NaN rather than rendering 'NaN'", () => {
    expect(safeToFixed(NaN, 1)).toBeNull();
  });

  it("returns null for Infinity/-Infinity rather than rendering 'Infinity'", () => {
    expect(safeToFixed(Infinity, 1)).toBeNull();
    expect(safeToFixed(-Infinity, 1)).toBeNull();
  });

  it("never substitutes 0 for a missing rate — a legitimate zero still formats as a real number", () => {
    expect(safeToFixed(0, 1)).toBe("0.0");
    expect(safeToFixed(0, 1)).not.toBeNull();
  });

  it("formats negative rates as real numbers", () => {
    expect(safeToFixed(-1.5, 1)).toBe("-1.5");
  });
});
