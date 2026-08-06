import { describe, it, expect } from "vitest";
import { extractFactorsFromNuvosEstimate, formatMarginOfSafetyFormula, pickDeteriorationChangeNote } from "./explainability";

describe("extractFactorsFromNuvosEstimate", () => {
  it("extracts a real, well-formed factors array", () => {
    const result = extractFactorsFromNuvosEstimate({
      composite_score: 85,
      factors: [
        { name: "roic", value: 30.0, score: 90, reason: "ROIC alto y estable." },
        { name: "growth", value: 12.0, score: 70, reason: "Crecimiento de ingresos real." },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "roic", value: 30.0, score: 90, reason: "ROIC alto y estable." });
  });

  it("returns [] when nuvos_estimate has no factors field", () => {
    expect(extractFactorsFromNuvosEstimate({ composite_score: 85 })).toEqual([]);
  });

  it("returns [] when nuvos_estimate is null or undefined", () => {
    expect(extractFactorsFromNuvosEstimate(null)).toEqual([]);
    expect(extractFactorsFromNuvosEstimate(undefined)).toEqual([]);
  });

  it("returns [] when factors is not an array", () => {
    expect(extractFactorsFromNuvosEstimate({ factors: "not an array" })).toEqual([]);
  });

  it("skips malformed entries missing name/reason", () => {
    const result = extractFactorsFromNuvosEstimate({
      factors: [
        { name: "roic", value: 30, score: 90, reason: "Real reason." },
        { value: 12, score: 70 }, // missing name/reason
        { name: "", reason: "" }, // empty name/reason
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("roic");
  });

  it("defaults score/value to null when not numbers", () => {
    const result = extractFactorsFromNuvosEstimate({
      factors: [{ name: "x", reason: "y", value: "not a number or string type check", score: "also not a number" }],
    });
    // value IS a string, so it passes through; score is a non-number string -> null
    expect(result[0].score).toBeNull();
  });
});

describe("formatMarginOfSafetyFormula", () => {
  it("formats the real formula with real numbers", () => {
    const formula = formatMarginOfSafetyFormula(80, 100);
    expect(formula).toBe("(($100.00 - $80.00) / $100.00) × 100");
  });

  it("returns null when price is missing", () => {
    expect(formatMarginOfSafetyFormula(null, 100)).toBeNull();
  });

  it("returns null when intrinsic value is missing", () => {
    expect(formatMarginOfSafetyFormula(80, null)).toBeNull();
  });

  it("returns null when intrinsic value is zero (division by zero)", () => {
    expect(formatMarginOfSafetyFormula(80, 0)).toBeNull();
  });
});

describe("pickDeteriorationChangeNote", () => {
  const factors = [
    { name: "roic", direction: "estable" as const, reason: "ROIC estable." },
    { name: "operating_margin", direction: "deteriorando" as const, reason: "Margen operativo cayendo." },
    { name: "revenue", direction: "mejorando" as const, reason: "Ingresos creciendo." },
  ];

  it("picks the first moving factor among the relevant set", () => {
    expect(pickDeteriorationChangeNote(factors, ["roic", "operating_margin"])).toBe("Margen operativo cayendo.");
  });

  it("returns null when every relevant factor is estable", () => {
    expect(pickDeteriorationChangeNote(factors, ["roic"])).toBeNull();
  });

  it("returns null when no factor name is in the relevant set", () => {
    expect(pickDeteriorationChangeNote(factors, ["fcf_margin"])).toBeNull();
  });

  it("returns null when factors is null or undefined", () => {
    expect(pickDeteriorationChangeNote(null, ["roic"])).toBeNull();
    expect(pickDeteriorationChangeNote(undefined, ["roic"])).toBeNull();
  });

  it("ignores a null direction", () => {
    const withNull = [{ name: "roic", direction: null, reason: "Historial insuficiente." }];
    expect(pickDeteriorationChangeNote(withNull, ["roic"])).toBeNull();
  });
});
