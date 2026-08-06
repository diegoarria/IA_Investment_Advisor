import { describe, it, expect } from "vitest";
import { diffClaimTexts, defaultComparisonPair, type ThesisVersion } from "./thesisHistory";

describe("diffClaimTexts", () => {
  it("detects added and removed claims correctly", () => {
    const oldClaims = [{ text: "Margen sobre 25%" }, { text: "Sin competencia nueva" }];
    const newClaims = [{ text: "Margen sobre 25%" }, { text: "Nueva competencia regional" }];
    const diff = diffClaimTexts(oldClaims, newClaims);
    expect(diff.added).toEqual(["Nueva competencia regional"]);
    expect(diff.removed).toEqual(["Sin competencia nueva"]);
    expect(diff.unchanged).toEqual(["Margen sobre 25%"]);
  });

  it("empty old list -> everything in new is added", () => {
    const diff = diffClaimTexts([], [{ text: "a" }, { text: "b" }]);
    expect(diff.added).toEqual(["a", "b"]);
    expect(diff.removed).toEqual([]);
  });

  it("empty new list -> everything in old is removed", () => {
    const diff = diffClaimTexts([{ text: "a" }], []);
    expect(diff.removed).toEqual(["a"]);
    expect(diff.added).toEqual([]);
  });

  it("identical lists produce no added/removed", () => {
    const claims = [{ text: "a" }, { text: "b" }];
    const diff = diffClaimTexts(claims, claims);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual(["a", "b"]);
  });
});

describe("defaultComparisonPair", () => {
  const v = (version: number): ThesisVersion => ({
    id: `t${version}`, version, thesis_summary: "x", strengths: [], critical_variables: [],
    key_risks: [], invalidation_events: [], is_current: version === 2, created_at: "2026-01-01", edited_at: null,
  });

  it("returns the two most recent (first two of the desc-sorted list)", () => {
    const pair = defaultComparisonPair([v(2), v(1)]);
    expect(pair).toEqual([v(2), v(1)]);
  });

  it("returns null when fewer than 2 versions exist", () => {
    expect(defaultComparisonPair([v(1)])).toBeNull();
    expect(defaultComparisonPair([])).toBeNull();
  });
});
