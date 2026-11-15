import { formatWeightPct, isValidEtfTicker, costTierColor, formatUnixTimestamp } from "./etfFormat";

describe("formatWeightPct", () => {
  it("renders the literal 'no disponible' for a null weight — never an empty/zero bar", () => {
    expect(formatWeightPct(null, "No disponible")).toBe("No disponible");
  });

  it("renders the literal fallback for undefined too", () => {
    expect(formatWeightPct(undefined, "No disponible")).toBe("No disponible");
  });

  it("never confuses a genuine confirmed 0% with missing data", () => {
    expect(formatWeightPct(0, "No disponible")).toBe("0.0%");
  });

  it("formats a real percentage to one decimal place", () => {
    expect(formatWeightPct(23.456, "No disponible")).toBe("23.5%");
  });
});

describe("isValidEtfTicker", () => {
  it("accepts a plain ticker", () => {
    expect(isValidEtfTicker("VOO")).toBe(true);
  });

  it("accepts a dot-suffixed ticker (e.g. dual-class style)", () => {
    expect(isValidEtfTicker("BRK.B")).toBe(true);
  });

  it("accepts lowercase input by normalizing before validating", () => {
    expect(isValidEtfTicker("voo")).toBe(true);
  });

  it("rejects a ticker longer than 6 letters before the suffix", () => {
    expect(isValidEtfTicker("TOOLONGTICKER")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidEtfTicker("")).toBe(false);
  });

  it("rejects a string with invalid characters", () => {
    expect(isValidEtfTicker("VOO$")).toBe(false);
  });
});

describe("formatUnixTimestamp", () => {
  it("converts a real Unix timestamp (time.time() from the backend) into a readable date, never a raw number", () => {
    const result = formatUnixTimestamp(1700000000, "es");
    expect(result).not.toBeNull();
    expect(result).not.toMatch(/^1700000000$/);
  });

  it("returns null for a missing timestamp instead of a placeholder string", () => {
    expect(formatUnixTimestamp(null)).toBeNull();
    expect(formatUnixTimestamp(undefined)).toBeNull();
  });

  it("returns null for a non-finite timestamp rather than crashing or showing 'Invalid Date'", () => {
    expect(formatUnixTimestamp(NaN)).toBeNull();
  });
});

describe("costTierColor", () => {
  it("returns a distinct color per known tier", () => {
    const colors = new Set([
      costTierColor("muy_bajo"),
      costTierColor("bajo"),
      costTierColor("moderado"),
      costTierColor("alto"),
    ]);
    expect(colors.size).toBe(4);
  });

  it("falls back to a neutral color for an unknown/missing tier instead of guessing", () => {
    expect(costTierColor(null)).toBe("#94a3b8");
    expect(costTierColor(undefined)).toBe("#94a3b8");
    expect(costTierColor("unexpected_value")).toBe("#94a3b8");
  });
});
