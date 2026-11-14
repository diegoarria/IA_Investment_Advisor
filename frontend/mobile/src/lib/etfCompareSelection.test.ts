import { addToCompareSelection, removeFromCompareSelection, canCompare, MIN_COMPARE, MAX_COMPARE } from "./etfCompareSelection";

describe("addToCompareSelection", () => {
  it("adds a new ticker, uppercased and trimmed", () => {
    const result = addToCompareSelection(["VOO"], " qqq ");
    expect(result).toEqual({ selected: ["VOO", "QQQ"], error: null });
  });

  it("rejects a ticker already in the selection without duplicating it", () => {
    const result = addToCompareSelection(["VOO", "QQQ"], "voo");
    expect(result.error).toBe("already_added");
    expect(result.selected).toEqual(["VOO", "QQQ"]);
  });

  it("rejects a 4th ticker — mirrors backend MAX_COMPARE=3", () => {
    const result = addToCompareSelection(["VOO", "QQQ", "VXUS"], "SPY", MAX_COMPARE);
    expect(result.error).toBe("max_reached");
    expect(result.selected).toEqual(["VOO", "QQQ", "VXUS"]);
  });

  it("allows exactly 3 tickers total", () => {
    const result = addToCompareSelection(["VOO", "QQQ"], "VXUS", MAX_COMPARE);
    expect(result.error).toBeNull();
    expect(result.selected).toHaveLength(3);
  });
});

describe("removeFromCompareSelection", () => {
  it("removes a ticker by exact match regardless of case", () => {
    expect(removeFromCompareSelection(["VOO", "QQQ"], "voo")).toEqual(["QQQ"]);
  });

  it("is a no-op when the ticker isn't selected", () => {
    expect(removeFromCompareSelection(["VOO"], "QQQ")).toEqual(["VOO"]);
  });
});

describe("canCompare", () => {
  it("requires at least MIN_COMPARE (2) tickers — mirrors backend", () => {
    expect(canCompare([])).toBe(false);
    expect(canCompare(["VOO"])).toBe(false);
    expect(canCompare(["VOO", "QQQ"], MIN_COMPARE)).toBe(true);
  });
});
