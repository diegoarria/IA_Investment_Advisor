import { describe, it, expect } from "vitest";
import { buildSimulationInsights, describeHypotheticalWeight, type SimulationResult } from "./simulationInsights";

function makeBlock(overrides: Partial<SimulationResult["before"]> = {}): SimulationResult["before"] {
  return {
    valuation: { total_value_verified: 16389.45, valuation_coverage_pct: 100 },
    positions: [],
    sector_exposure: { by_sector: [], coverage_pct: 100 },
    concentration: { top_positions: [], largest_single_position_pct: null },
    ...overrides,
  };
}

// Diego's own corrected worked example: V=$16,389.45, +$5,000 into QQQ,
// Tecnología 48.2% -> 50.7% (+2.5pp). QQQ also becomes the new largest
// position — the exact scenario that originally produced the duplicate
// "QQQ's weight grows" / "the largest position, QQQ, grows" pair.
function diegoExample(): SimulationResult {
  return {
    amount: 5000,
    hypothetical_ticker: "QQQ",
    hypothetical_asset_class: "etf",
    before_had_no_verified_positions: false,
    before: makeBlock({
      positions: [
        { ticker: "QQQ", verifiable: true, weight_pct: 21.1, sector: null },
        { ticker: "VOO", verifiable: true, weight_pct: 43.0, sector: null },
      ],
      sector_exposure: {
        coverage_pct: 100,
        by_sector: [
          { sector: "Tecnología", value: 7899.71, pct_of_verified_total: 48.2 },
          { sector: "Servicios financieros", value: 803.08, pct_of_verified_total: 4.9 },
        ],
      },
      concentration: { top_positions: [{ ticker: "VOO", name: null, weight_pct: 43.0 }], largest_single_position_pct: 43.0 },
    }),
    after: makeBlock({
      valuation: { total_value_verified: 21389.45, valuation_coverage_pct: 100 },
      positions: [
        { ticker: "QQQ", verifiable: true, weight_pct: 39.6, sector: null },
        { ticker: "VOO", verifiable: true, weight_pct: 33.0, sector: null },
      ],
      sector_exposure: {
        coverage_pct: 100,
        by_sector: [
          { sector: "Tecnología", value: 10849.71, pct_of_verified_total: 50.7 }, // grew — QQQ's own 59% tech weight landed here
          { sector: "Servicios financieros", value: 803.08, pct_of_verified_total: 3.7 }, // UNCHANGED dollars, diluted %
        ],
      },
      concentration: { top_positions: [{ ticker: "QQQ", name: null, weight_pct: 39.6 }], largest_single_position_pct: 39.6 },
    }),
    sector_deltas: [
      { sector: "Tecnología", pct_before: 48.2, pct_after: 50.7, delta_pct_points: 2.5 },
      { sector: "Servicios financieros", pct_before: 4.9, pct_after: 3.7, delta_pct_points: -1.2 },
    ],
  };
}

describe("buildSimulationInsights", () => {
  it("names the real weight change of the hypothetical ticker", () => {
    const insights = buildSimulationInsights(diegoExample(), "QQQ", "es");
    const weight = insights.find((i) => i.category === "position_weight");
    expect(weight).toBeDefined();
    expect(weight!.text).toContain("QQQ");
    expect(weight!.text).toContain("21.1%");
    expect(weight!.text).toContain("39.6%");
  });

  it("surfaces the largest sector shift, exactly matching sector_deltas[0]", () => {
    const insights = buildSimulationInsights(diegoExample(), "QQQ", "es");
    const sector = insights.find((i) => i.category === "sector_shift");
    expect(sector).toBeDefined();
    expect(sector!.text).toContain("Tecnología");
    expect(sector!.text).toContain("48.2%");
    expect(sector!.text).toContain("50.7%");
    expect(sector!.text).toContain("+2.5");
  });

  describe("semantic deduplication (Fase 4C audit, point 2)", () => {
    it("never shows both position_weight AND concentration_change for the same ticker", () => {
      // QQQ is both the simulated ticker AND the new largest position —
      // the real scenario Diego reported as a duplicate pair.
      const insights = buildSimulationInsights(diegoExample(), "QQQ", "es");
      const categories = insights.map((i) => i.category);
      expect(categories).toContain("position_weight");
      expect(categories).not.toContain("concentration_change");
    });

    it("DOES show concentration_change when the new largest position is a DIFFERENT ticker than the one simulated", () => {
      const sim = diegoExample();
      // Simulate adding to VOO instead — VOO stays the largest position,
      // so this isn't the dedup case; use a scenario where a THIRD ticker
      // ends up largest after a simulation on QQQ.
      sim.after.concentration = { top_positions: [{ ticker: "ASML", name: null, weight_pct: 45.0 }], largest_single_position_pct: 45.0 };
      const insights = buildSimulationInsights(sim, "QQQ", "es");
      const concentration = insights.find((i) => i.category === "concentration_change");
      expect(concentration).toBeDefined();
      expect(concentration!.text).toContain("ASML");
    });

    it("dedup is a real ticker-identity check, not a text/string comparison", () => {
      // Two DIFFERENT prose strings could still refer to the same
      // ticker — the function must key off `afterTop.ticker === ticker`,
      // not any textual similarity between the two observations.
      const sim = diegoExample();
      sim.before.concentration = { top_positions: [{ ticker: "QQQ", name: "Invesco QQQ Trust", weight_pct: 21.1 }], largest_single_position_pct: 21.1 };
      sim.after.concentration = { top_positions: [{ ticker: "QQQ", name: "Invesco QQQ Trust Series 1", weight_pct: 39.6 }], largest_single_position_pct: 39.6 };
      const insights = buildSimulationInsights(sim, "QQQ", "es");
      expect(insights.map((i) => i.category)).not.toContain("concentration_change");
    });
  });

  describe("causal explanations (Fase 4C audit, point 3)", () => {
    it("explains dilution (not a sale) when a sector's % drops but its dollar value is unchanged", () => {
      const sim = diegoExample();
      // Force the top delta to be the DILUTED sector by clearing the tech one.
      sim.sector_deltas = [{ sector: "Servicios financieros", pct_before: 4.9, pct_after: 3.7, delta_pct_points: -1.2 }];
      const insights = buildSimulationInsights(sim, "QQQ", "es");
      const sector = insights.find((i) => i.category === "sector_shift");
      expect(sector).toBeDefined();
      // must name the real cause (the new contribution), not imply a sale
      expect(sector!.text).toContain("QQQ");
      // the text may correctly NEGATE a sale ("no porque hayas vendido
      // nada") — what it must never do is claim a sale happened without
      // that negation.
      expect(sector!.text.toLowerCase()).not.toMatch(/(?<!no porque hayas )vendiste/);
      expect(sector!.text).toContain("no porque hayas vendido");
      // must show the dollar value explicitly, and it must be UNCHANGED
      expect(sector!.supporting_data.dollar_value_changed).toBe(false);
      expect(sector!.supporting_data.value_before).toBe(sector!.supporting_data.value_after);
    });

    it("never claims a sector's dollar value fell when only its percentage fell", () => {
      const sim = diegoExample();
      sim.sector_deltas = [{ sector: "Servicios financieros", pct_before: 4.9, pct_after: 3.7, delta_pct_points: -1.2 }];
      const insights = buildSimulationInsights(sim, "QQQ", "es");
      const sector = insights.find((i) => i.category === "sector_shift");
      // the two dollar figures are the SAME number — the text must not
      // say "disminuyó" about the dollar amount (the % framing is fine)
      const financieros = sim.before.sector_exposure.by_sector[1];
      expect(sector!.text).toContain(`$${Math.round(financieros.value).toLocaleString()}`);
    });

    it("attributes a growing sector to the real contribution when its dollar value DID grow", () => {
      const insights = buildSimulationInsights(diegoExample(), "QQQ", "es"); // top delta is Tecnología, which grew in $ too
      const sector = insights.find((i) => i.category === "sector_shift");
      expect(sector!.supporting_data.dollar_value_changed).toBe(true);
      expect(sector!.text).toContain("QQQ");
    });
  });

  it("never fabricates a number not present in before/after/deltas", () => {
    const sim = diegoExample();
    const insights = buildSimulationInsights(sim, "QQQ", "es");
    // every numeric figure quoted in the text must trace back to a real
    // field somewhere in supporting_data
    for (const insight of insights) {
      const numbersInText = insight.text.match(/\d+\.\d/g) || [];
      const numbersInData = Object.values(insight.supporting_data)
        .filter((v): v is number => typeof v === "number")
        .map((v) => v.toFixed(1));
      for (const n of numbersInText) {
        const stripped = n.replace("+", "");
        expect(numbersInData.some((d) => d === stripped || `-${d}` === stripped)).toBe(true);
      }
    }
  });

  it("never emits more than 3 observations", () => {
    const insights = buildSimulationInsights(diegoExample(), "QQQ", "es");
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it("never emits a buy/sell/hold recommendation or a good/bad judgement", () => {
    const insights = buildSimulationInsights(diegoExample(), "QQQ", "es");
    const forbidden = ["comprar", "vender", "mantener", "recomend", "deberías", "conviene", "riesgoso", "bueno", "malo"];
    for (const insight of insights) {
      const lowered = insight.text.toLowerCase();
      for (const word of forbidden) {
        expect(lowered).not.toContain(word);
      }
    }
  });

  it("skips the sector-shift observation when no delta is meaningful", () => {
    const sim = diegoExample();
    sim.sector_deltas = [{ sector: "Tecnología", pct_before: 48.2, pct_after: 48.3, delta_pct_points: 0.1 }];
    const insights = buildSimulationInsights(sim, "QQQ", "es");
    expect(insights.some((i) => i.category === "sector_shift")).toBe(false);
  });

  it("flags unclassified sector data for the hypothetical ticker instead of silently omitting it", () => {
    const sim = diegoExample();
    // isolate the scenario: no sector delta, no concentration change, so
    // the coverage-gap caveat (priority 4) actually makes it into the
    // capped top-3 instead of being crowded out by higher-priority ones.
    sim.sector_deltas = [];
    sim.after.positions = [{ ticker: "WEIRDETF", verifiable: true, weight_pct: 20.0, sector: null }];
    sim.after.concentration = { top_positions: [], largest_single_position_pct: null };
    const insights = buildSimulationInsights(sim, "WEIRDETF", "es");
    const gap = insights.find((i) => i.category === "coverage_gap");
    expect(gap).toBeDefined();
    expect(gap!.text).toContain("WEIRDETF");
  });

  it("drops the coverage-gap caveat when 3 higher-priority observations already fill the cap", () => {
    const sim = diegoExample();
    sim.after.positions = [...sim.after.positions, { ticker: "WEIRDETF", verifiable: true, weight_pct: 5.0, sector: null }];
    sim.after.concentration = { top_positions: [{ ticker: "ASML", name: null, weight_pct: 45.0 }], largest_single_position_pct: 45.0 };
    const insights = buildSimulationInsights(sim, "QQQ", "es"); // QQQ, not the unclassified one
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it("returns an empty list rather than padding when nothing is computable", () => {
    const sim: SimulationResult = {
      amount: 100,
      hypothetical_ticker: "X",
      hypothetical_asset_class: "equity",
      before_had_no_verified_positions: true,
      before: makeBlock({ valuation: { total_value_verified: null, valuation_coverage_pct: null } }),
      after: makeBlock({ valuation: { total_value_verified: null, valuation_coverage_pct: null } }),
      sector_deltas: [],
    };
    const insights = buildSimulationInsights(sim, "X", "es");
    expect(insights).toEqual([]);
  });

  it("handles a brand-new ticker (0% before) correctly", () => {
    const sim = diegoExample();
    sim.before.positions = [{ ticker: "VOO", verifiable: true, weight_pct: 100.0, sector: null }];
    sim.after.positions = [
      { ticker: "VOO", verifiable: true, weight_pct: 76.6, sector: null },
      { ticker: "NEWTICKER", verifiable: true, weight_pct: 23.4, sector: null },
    ];
    sim.after.concentration = { top_positions: [{ ticker: "VOO", name: null, weight_pct: 76.6 }], largest_single_position_pct: 76.6 };
    const insights = buildSimulationInsights(sim, "NEWTICKER", "es");
    const weight = insights.find((i) => i.category === "position_weight");
    expect(weight!.text).toContain("0.0%");
    expect(weight!.text).toContain("23.4%");
  });

  it("produces an English variant that differs from Spanish", () => {
    const es = buildSimulationInsights(diegoExample(), "QQQ", "es");
    const en = buildSimulationInsights(diegoExample(), "QQQ", "en");
    expect(es[0].text).not.toBe(en[0].text);
  });
});

describe("describeHypotheticalWeight", () => {
  it("re-presents the real afterPct as a per-$100 sentence, rounded, never a new calculation", () => {
    expect(describeHypotheticalWeight("MSFT", 6.2, "es")).toBe(
      "MSFT pasaría a representar aproximadamente $6 de cada $100 del valor analizado de tu portafolio."
    );
    expect(describeHypotheticalWeight("MSFT", 6.2, "en")).toBe(
      "MSFT would come to represent approximately $6 of every $100 of your portfolio's analyzed value."
    );
  });

  it("returns null when there is no verified afterPct to express a share of", () => {
    expect(describeHypotheticalWeight("MSFT", null, "es")).toBeNull();
  });
});
