import { describe, expect, it } from "vitest";
import { selectPrimaryInsight, buildObservationCopy, type PortfolioInsight } from "./primaryInsight";

function insight(category: string): PortfolioInsight {
  return { category, text: `text for ${category}`, supporting_data: {} };
}

describe("selectPrimaryInsight", () => {
  it("picks dominant_sector even when it is not insights[0]", () => {
    const insights = [insight("single_position_concentration"), insight("dominant_sector"), insight("coverage_gap")];
    expect(selectPrimaryInsight(insights)?.category).toBe("dominant_sector");
  });

  it("falls back to single_position_concentration when there is no dominant sector", () => {
    const insights = [insight("coverage_gap"), insight("single_position_concentration")];
    expect(selectPrimaryInsight(insights)?.category).toBe("single_position_concentration");
  });

  it("falls back to top_holdings when neither dominant_sector nor single_position_concentration exist", () => {
    const insights = [insight("coverage_gap"), insight("top_holdings")];
    expect(selectPrimaryInsight(insights)?.category).toBe("top_holdings");
  });

  it("falls back to coverage_gap as the last resort", () => {
    const insights = [insight("coverage_gap")];
    expect(selectPrimaryInsight(insights)?.category).toBe("coverage_gap");
  });

  it("returns null (neutral state) when there are no insights at all", () => {
    expect(selectPrimaryInsight([])).toBeNull();
  });

  it("returns null when only unrecognized categories are present, rather than fabricating a pick", () => {
    expect(selectPrimaryInsight([insight("composition")])).toBeNull();
  });
});

describe("buildObservationCopy", () => {
  it("builds a qualitative dominant_sector headline from the real percentage, never a fabricated number", () => {
    const i: PortfolioInsight = {
      category: "dominant_sector",
      text: "El sector Tecnología representa el 47% de tu portafolio: VOO aporta 17.6 puntos porcentuales.",
      supporting_data: { sector: "Tecnología", total_pct_of_portfolio: 47, contributors: [{ ticker: "VOO" }, { ticker: "ASML" }, { ticker: "QQQ" }] },
    };
    const copy = buildObservationCopy(i, "es");
    expect(copy.headline).toBe("Casi la mitad del valor analizado de tu portafolio está expuesto al sector Tecnología.");
    expect(copy.explanation).toBe("Esta exposición proviene principalmente de VOO, ASML y QQQ.");
    expect(copy.detailText).toBe(i.text); // exact backend sentence preserved for the detail view
  });

  it("switches dominant_sector wording by magnitude (>=50% vs 30-39%) without recomputing the percentage", () => {
    const base = { category: "dominant_sector", text: "x", supporting_data: {} };
    const majority = buildObservationCopy({ ...base, supporting_data: { sector: "Salud", total_pct_of_portfolio: 55, contributors: [] } } as PortfolioInsight, "es");
    expect(majority.headline).toContain("Más de la mitad");
    const minority = buildObservationCopy({ ...base, supporting_data: { sector: "Energía", total_pct_of_portfolio: 32, contributors: [] } } as PortfolioInsight, "es");
    expect(minority.headline).toContain("Una parte importante");
  });

  it("builds a single_position_concentration headline using the per-$100 framing from the real weight_pct", () => {
    const i: PortfolioInsight = { category: "single_position_concentration", text: "...", supporting_data: { ticker: "VOO", weight_pct: 30.5 } };
    const copy = buildObservationCopy(i, "es");
    expect(copy.headline).toBe("Aproximadamente $31 de cada $100 de tu portafolio verificado están en una sola posición.");
    expect(copy.explanation).toContain("VOO");
  });

  it("builds a coverage_gap headline that stays generic while the explanation keeps the backend's precise text", () => {
    const i: PortfolioInsight = { category: "coverage_gap", text: "Cobertura incompleta: no pudimos verificar el valor de mercado del 15% de tu portafolio.", supporting_data: {} };
    const copy = buildObservationCopy(i, "es");
    expect(copy.explanation).toBe(i.text);
    expect(copy.detailText).toBeNull();
  });

  it("falls back to the insight's own text as the headline for an unrecognized category or missing supporting_data", () => {
    const i: PortfolioInsight = { category: "composition", text: "fallback text", supporting_data: {} };
    const copy = buildObservationCopy(i, "es");
    expect(copy.headline).toBe("fallback text");
  });

  it("supports English wording via the lang argument", () => {
    const i: PortfolioInsight = {
      category: "dominant_sector",
      text: "...",
      supporting_data: { sector: "Technology", total_pct_of_portfolio: 47, contributors: [{ ticker: "VOO" }] },
    };
    const copy = buildObservationCopy(i, "en");
    expect(copy.headline).toBe("Nearly half of your portfolio's analyzed value is exposed to the Technology sector.");
    expect(copy.explanation).toBe("This exposure comes mainly from VOO.");
  });
});
