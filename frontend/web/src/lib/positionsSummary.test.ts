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
    expect(summary.largestConsequence).toBe("Una variación en esta posición pesa proporcionalmente más sobre tu portafolio que una variación equivalente en una posición más pequeña.");
    // Diego, 2026-11 (rediseño): el titular es ahora el hecho verificable
    // mismo (el % combinado real), nunca un juicio de valor basado en
    // umbrales arbitrarios como "concentradas"/"bien distribuidas".
    expect(summary.concentrationHeadline).toBe("VOO y QQQ representan juntos el 64.3% de tu portafolio verificado.");
    expect(summary.concentrationDetail).toBe("Esto significa que el resultado de tu portafolio depende, en una parte importante, del comportamiento de estas dos inversiones.");
    expect(summary.largestTicker).toBe("VOO");
  });

  it("never labels a portfolio as 'concentrated' or 'well distributed' — only states the real combined percentage", () => {
    const highlyConcentrated = buildPositionsSummary([pos("A", 45), pos("B", 20)], "es");
    expect(highlyConcentrated.concentrationHeadline).toBe("A y B representan juntos el 65.0% de tu portafolio verificado.");
    expect(highlyConcentrated.concentrationHeadline).not.toMatch(/concentrad|distribuid/i);
    const lessConcentrated = buildPositionsSummary([pos("A", 15), pos("B", 10), pos("C", 10)], "es");
    expect(lessConcentrated.concentrationHeadline).toBe("A y B representan juntos el 25.0% de tu portafolio verificado.");
    expect(lessConcentrated.concentrationHeadline).not.toMatch(/concentrad|distribuid/i);
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
    expect(summary).toEqual({ concentrationHeadline: null, concentrationDetail: null, largestHeadline: null, largestDetail: null, largestConsequence: null, largestTicker: null });
  });

  it("supports English wording via the lang argument", () => {
    const summary = buildPositionsSummary([pos("VOO", 43.4), pos("QQQ", 20.9)], "en");
    expect(summary.largestHeadline).toBe("VOO is your largest position.");
    expect(summary.largestConsequence).toBe("A change in this position carries proportionally more weight on your portfolio than an equivalent change in a smaller position.");
    expect(summary.concentrationHeadline).toBe("VOO and QQQ together represent 64.3% of your verified portfolio.");
  });
});
