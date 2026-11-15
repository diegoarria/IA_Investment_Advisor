import { maxPointsForWidth } from "./chartResolution";

describe("maxPointsForWidth", () => {
  it("falls back to a sane default before the chart has been measured (width 0)", () => {
    expect(maxPointsForWidth(0)).toBe(120);
  });

  it("falls back to the default for non-finite or negative widths", () => {
    expect(maxPointsForWidth(NaN)).toBe(120);
    expect(maxPointsForWidth(-10)).toBe(120);
  });

  it("scales up for a wider chart (tablet) without exceeding the upper cap", () => {
    expect(maxPointsForWidth(2000)).toBe(220);
  });

  it("never drops below the lower cap on a very small chart", () => {
    expect(maxPointsForWidth(50)).toBe(60);
  });

  it("scales roughly linearly with width within the caps", () => {
    const narrow = maxPointsForWidth(300);
    const wide = maxPointsForWidth(600);
    expect(wide).toBeGreaterThan(narrow);
  });
});
