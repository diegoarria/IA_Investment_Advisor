import { selectPrimaryInsight, buildObservationCopy, type PortfolioInsight } from "./primaryInsight";

function insight(category: string, supporting_data: Record<string, unknown> = {}): PortfolioInsight {
  return { category, text: `texto de ${category}`, supporting_data };
}

describe("selectPrimaryInsight", () => {
  it("returns null when there are no insights", () => {
    expect(selectPrimaryInsight([])).toBeNull();
  });

  it("picks dominant_sector over any other category present", () => {
    const list = [insight("coverage_gap"), insight("top_holdings"), insight("dominant_sector")];
    expect(selectPrimaryInsight(list)?.category).toBe("dominant_sector");
  });

  it("falls back to single_position_concentration when dominant_sector is absent", () => {
    const list = [insight("coverage_gap"), insight("single_position_concentration")];
    expect(selectPrimaryInsight(list)?.category).toBe("single_position_concentration");
  });

  it("falls back to top_holdings when neither dominant_sector nor single_position_concentration is present", () => {
    const list = [insight("coverage_gap"), insight("top_holdings")];
    expect(selectPrimaryInsight(list)?.category).toBe("top_holdings");
  });

  it("falls back to coverage_gap when it is the only known category present", () => {
    const list = [insight("some_unrelated_category"), insight("coverage_gap")];
    expect(selectPrimaryInsight(list)?.category).toBe("coverage_gap");
  });

  it("returns null when only unknown categories are present", () => {
    const list = [insight("unrelated_a"), insight("unrelated_b")];
    expect(selectPrimaryInsight(list)).toBeNull();
  });
});

describe("buildObservationCopy", () => {
  it("builds dominant_sector copy with contributors and keeps the backend's text as detailText", () => {
    const i = insight("dominant_sector", {
      total_pct_of_portfolio: 55,
      sector: "Tecnología",
      contributors: [{ ticker: "AAPL" }, { ticker: "MSFT" }],
    });
    const copy = buildObservationCopy(i, "es");
    expect(copy.headline).toMatch(/más de la mitad/i);
    expect(copy.explanation).toContain("AAPL");
    expect(copy.explanation).toContain("MSFT");
    expect(copy.detailText).toBe(i.text);
  });

  it("falls back to the backend's own text when dominant_sector has no contributors", () => {
    const i = insight("dominant_sector", { total_pct_of_portfolio: 30, sector: "Salud" });
    const copy = buildObservationCopy(i, "es");
    expect(copy.explanation).toBe("texto de dominant_sector");
  });

  it("builds single_position_concentration copy using the real ticker and rounded weight", () => {
    const i = insight("single_position_concentration", { weight_pct: 23.6, ticker: "NVDA" });
    const copy = buildObservationCopy(i, "es");
    expect(copy.headline).toContain("$24");
    expect(copy.explanation).toContain("NVDA");
    expect(copy.detailText).toBe(i.text);
  });

  it("builds top_holdings copy joining ticker names with 'y' in Spanish", () => {
    const i = insight("top_holdings", { combined_pct: 61.2, tickers: ["AAPL", "MSFT", "GOOGL"] });
    const copy = buildObservationCopy(i, "es");
    expect(copy.explanation).toBe("Esta concentración proviene principalmente de AAPL, MSFT y GOOGL.");
  });

  it("builds top_holdings copy joining ticker names with 'and' in English", () => {
    const i = insight("top_holdings", { combined_pct: 61.2, tickers: ["AAPL", "MSFT"] });
    const copy = buildObservationCopy(i, "en");
    expect(copy.explanation).toBe("This concentration comes mainly from AAPL and MSFT.");
  });

  it("never fabricates a detailText for coverage_gap — explanation reuses backend text, detail is null", () => {
    const i = insight("coverage_gap");
    const copy = buildObservationCopy(i, "es");
    expect(copy.explanation).toBe(i.text);
    expect(copy.detailText).toBeNull();
  });

  it("falls back to the raw insight text for an unrecognized category", () => {
    const i = insight("unrelated_category");
    const copy = buildObservationCopy(i, "es");
    expect(copy.headline).toBe(i.text);
    expect(copy.explanation).toBe("");
    expect(copy.detailText).toBeNull();
  });
});
