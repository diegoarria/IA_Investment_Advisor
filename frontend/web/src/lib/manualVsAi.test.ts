import { describe, it, expect } from "vitest";
import { buildManualVsAiComparison, type AssumptionInput } from "./manualVsAi";

const threeAssumptions = (userG: number, userR: number, userGt: number, nuvosG: number, nuvosR: number, nuvosGt: number): AssumptionInput[] => [
  { key: "growth", userValuePct: userG, nuvosValuePct: nuvosG },
  { key: "wacc", userValuePct: userR, nuvosValuePct: nuvosR },
  { key: "terminalGrowth", userValuePct: userGt, nuvosValuePct: nuvosGt },
];

describe("buildManualVsAiComparison", () => {
  it("computes real diffs per assumption", () => {
    const result = buildManualVsAiComparison(threeAssumptions(10, 9, 3, 7, 9, 3), 150, 130);
    const growth = result.assumptions.find((a) => a.key === "growth")!;
    expect(growth.userValuePct).toBe(10);
    expect(growth.nuvosValuePct).toBe(7);
    expect(growth.diffPct).toBe(3);

    const wacc = result.assumptions.find((a) => a.key === "wacc")!;
    expect(wacc.diffPct).toBe(0);
  });

  it("identifies the most divergent assumption by absolute value", () => {
    const result = buildManualVsAiComparison(threeAssumptions(10, 9, 3, 7, 8.5, 3.5), null, null);
    // growth diff = +3, wacc diff = +0.5, terminalGrowth diff = -0.5
    expect(result.mostDivergentAssumption?.key).toBe("growth");
  });

  it("picks the negative diff when it's the largest in absolute value", () => {
    const result = buildManualVsAiComparison(threeAssumptions(5, 9, 3, 12, 9, 3), null, null);
    // growth diff = -7, the largest magnitude
    expect(result.mostDivergentAssumption?.key).toBe("growth");
    expect(result.mostDivergentAssumption?.diffPct).toBe(-7);
  });

  it("computes real value diff percentage", () => {
    const result = buildManualVsAiComparison(threeAssumptions(10, 9, 3, 7, 9, 3), 130, 100);
    expect(result.valueDiffPct).toBe(30);
  });

  it("value diff is null when either intrinsic value is missing", () => {
    const result = buildManualVsAiComparison(threeAssumptions(10, 9, 3, 7, 9, 3), null, 100);
    expect(result.valueDiffPct).toBeNull();
    const result2 = buildManualVsAiComparison(threeAssumptions(10, 9, 3, 7, 9, 3), 100, null);
    expect(result2.valueDiffPct).toBeNull();
  });

  it("value diff is null when nuvos's value is zero (division by zero)", () => {
    const result = buildManualVsAiComparison(threeAssumptions(10, 9, 3, 7, 9, 3), 100, 0);
    expect(result.valueDiffPct).toBeNull();
  });

  it("identical assumptions produce zero diffs and no value diff", () => {
    const result = buildManualVsAiComparison(threeAssumptions(8, 9, 3, 8, 9, 3), 100, 100);
    expect(result.assumptions.every((a) => a.diffPct === 0)).toBe(true);
    expect(result.valueDiffPct).toBe(0);
  });

  // Fase 1.5, Incremento 15 — generalized from a fixed 3-tuple to N inputs.
  it("supports an arbitrary number of assumptions, not just the original 3", () => {
    const result = buildManualVsAiComparison(
      [
        { key: "growth", userValuePct: 10, nuvosValuePct: 7 },
        { key: "highGrowthYears", userValuePct: 3, nuvosValuePct: 2 },
      ],
      null, null,
    );
    expect(result.assumptions).toHaveLength(2);
    expect(result.assumptions.map((a) => a.key)).toEqual(["growth", "highGrowthYears"]);
  });

  it("handles zero assumptions without crashing", () => {
    const result = buildManualVsAiComparison([], null, null);
    expect(result.assumptions).toEqual([]);
    expect(result.mostDivergentAssumption).toBeNull();
  });
});
