import { describe, it, expect } from "vitest";
import {
  isAtLeastDetail,
  isSectionVisible,
  isValidDetailLevel,
  DETAIL_LEVELS,
  DEFAULT_DETAIL_LEVEL,
  type DetailLevel,
} from "./detailLevel";

describe("isAtLeastDetail", () => {
  it("returns true when level equals min", () => {
    expect(isAtLeastDetail("intermedio", "intermedio")).toBe(true);
  });

  it("returns true when level exceeds min", () => {
    expect(isAtLeastDetail("profesional", "principiante")).toBe(true);
  });

  it("returns false when level is below min", () => {
    expect(isAtLeastDetail("principiante", "avanzado")).toBe(false);
  });

  it("orders all four levels correctly", () => {
    for (let i = 0; i < DETAIL_LEVELS.length; i++) {
      for (let j = 0; j < DETAIL_LEVELS.length; j++) {
        expect(isAtLeastDetail(DETAIL_LEVELS[i], DETAIL_LEVELS[j])).toBe(i >= j);
      }
    }
  });
});

describe("isSectionVisible", () => {
  it("principiante sees only principiante-tier sections", () => {
    expect(isSectionVisible("principiante", "summary")).toBe(true);
    expect(isSectionVisible("principiante", "roic_fcf_growth")).toBe(false);
    expect(isSectionVisible("principiante", "dcf_full")).toBe(false);
    expect(isSectionVisible("principiante", "raw_assumptions")).toBe(false);
  });

  it("intermedio sees principiante + intermedio sections, not beyond", () => {
    expect(isSectionVisible("intermedio", "summary")).toBe(true);
    expect(isSectionVisible("intermedio", "moat_score")).toBe(true);
    expect(isSectionVisible("intermedio", "dcf_full")).toBe(false);
  });

  it("avanzado sees everything up through avanzado", () => {
    expect(isSectionVisible("avanzado", "scenarios")).toBe(true);
    expect(isSectionVisible("avanzado", "raw_assumptions")).toBe(false);
  });

  it("profesional sees every section", () => {
    expect(isSectionVisible("profesional", "raw_assumptions")).toBe(true);
    expect(isSectionVisible("profesional", "factors_detail")).toBe(true);
    expect(isSectionVisible("profesional", "summary")).toBe(true);
  });
});

describe("isValidDetailLevel", () => {
  it("accepts every real level", () => {
    for (const level of DETAIL_LEVELS) {
      expect(isValidDetailLevel(level)).toBe(true);
    }
  });

  it("rejects unknown strings and non-strings", () => {
    expect(isValidDetailLevel("experto")).toBe(false);
    expect(isValidDetailLevel(null)).toBe(false);
    expect(isValidDetailLevel(42)).toBe(false);
    expect(isValidDetailLevel(undefined)).toBe(false);
  });
});

describe("DEFAULT_DETAIL_LEVEL", () => {
  it("is intermedio — neither the simplest nor the most complex", () => {
    const level: DetailLevel = DEFAULT_DETAIL_LEVEL;
    expect(level).toBe("intermedio");
  });
});
