import { describe, expect, it } from "vitest";
import { buildPositionsSummary, type PositionLike } from "./positionsSummary";

function pos(ticker: string, weight_pct: number | null, verifiable = true, name: string | null = null): PositionLike {
  return { ticker, name, weight_pct, verifiable };
}

describe("buildPositionsSummary", () => {
  it("builds VOO/QQQ style concentration + largest-position copy from real weights", () => {
    const summary = buildPositionsSummary([pos("VOO", 43.4), pos("QQQ", 20.9), pos("ASML", 10.0)], "es");
    expect(summary.largestHeadline).toBe("VOO es tu posición más grande.");
    expect(summary.largestDetail).toBe("Representa 43.4% del valor verificado de tu portafolio.");
    expect(summary.concentrationHeadline).toBe("Tus posiciones están concentradas."); // top-2 combined = 64.3% >= 60%
    expect(summary.concentrationDetail).toBe("VOO y QQQ representan juntos el 64.3% del valor verificado.");
    expect(summary.largestTicker).toBe("VOO");
  });

  it("labels combined weight >=60% as concentrated and <40% as well distributed", () => {
    const concentrated = buildPositionsSummary([pos("A", 45), pos("B", 20)], "es");
    expect(concentrated.concentrationHeadline).toBe("Tus posiciones están concentradas.");
    const distributed = buildPositionsSummary([pos("A", 15), pos("B", 10), pos("C", 10)], "es");
    expect(distributed.concentrationHeadline).toBe("Tus posiciones están bien distribuidas.");
  });

  it("handles a single verifiable position without a combined-pct sentence", () => {
    const summary = buildPositionsSummary([pos("VOO", 100)], "es");
    expect(summary.concentrationHeadline).toBe("Toda tu inversión verificada está en una sola posición.");
    expect(summary.concentrationDetail).toBeNull();
  });

  it("excludes unverifiable positions and null weights, never treating them as zero", () => {
    const summary = buildPositionsSummary([pos("VOO", 60), pos("GHOST", null), pos("ALSO_GHOST", 30, false)], "es");
    expect(summary.largestTicker).toBe("VOO");
    expect(summary.concentrationHeadline).toBe("Toda tu inversión verificada está en una sola posición.");
  });

  it("returns all-null fields when there are no verifiable positions, never fabricating a summary", () => {
    const summary = buildPositionsSummary([pos("GHOST", null), pos("ALSO_GHOST", 30, false)], "es");
    expect(summary).toEqual({ concentrationHeadline: null, concentrationDetail: null, largestHeadline: null, largestDetail: null, largestTicker: null });
  });

  it("supports English wording via the lang argument", () => {
    const summary = buildPositionsSummary([pos("VOO", 43.4), pos("QQQ", 20.9)], "en");
    expect(summary.largestHeadline).toBe("VOO is your largest position.");
    expect(summary.concentrationDetail).toBe("VOO and QQQ together represent 64.3% of the verified value.");
  });
});
