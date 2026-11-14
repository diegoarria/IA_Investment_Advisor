import { describe, expect, it } from "vitest";
import {
  selectPrimaryObservation, anchorForInsight, describeSectorConcentration,
  describeGeographyNote, describeHoldingsCaveat, describeHoldingsUnavailableNote, type Insight,
} from "./etfDetailCopy";

function insight(category: string): Insight {
  return { category, text: `texto real de ${category}`, supporting_data: {} };
}

describe("selectPrimaryObservation", () => {
  it("picks the first insight — verified against the backend's own fixed priority contract (sector > geographic > cost)", () => {
    const insights = [insight("sector_concentration"), insight("geographic_exposure"), insight("cost")];
    expect(selectPrimaryObservation(insights)?.category).toBe("sector_concentration");
  });

  it("picks whatever is first when sector is unavailable — the backend already filtered it out, never reordered client-side", () => {
    const insights = [insight("geographic_exposure"), insight("cost")];
    expect(selectPrimaryObservation(insights)?.category).toBe("geographic_exposure");
  });

  it("returns null when there are no insights at all, never fabricating one", () => {
    expect(selectPrimaryObservation([])).toBeNull();
  });
});

describe("anchorForInsight", () => {
  it("maps each known category to the section that backs it up", () => {
    expect(anchorForInsight(insight("sector_concentration"))).toBe("etf-section-composicion");
    expect(anchorForInsight(insight("geographic_exposure"))).toBe("etf-section-geografia");
    expect(anchorForInsight(insight("cost"))).toBe("etf-section-costos");
  });

  it("returns null for an unrecognized category rather than guessing an anchor", () => {
    expect(anchorForInsight(insight("unknown_future_category"))).toBeNull();
  });
});

describe("describeSectorConcentration", () => {
  it("states the real top1/top3 numbers without labeling them good or bad", () => {
    const text = describeSectorConcentration({ top1_name: "Tecnología", top1_weight_pct: 32.4, top3_weight_pct: 58.1, bucket_count: 11 }, "es");
    expect(text).toBe("El sector Tecnología concentra el 32.4% del fondo (los 3 principales suman 58.1%).");
    expect(text).not.toMatch(/alta|baja|alto|bajo/i);
  });

  it("never repeats the exact sentence insights.py would produce for the same data", () => {
    const text = describeSectorConcentration({ top1_name: "Tecnología", top1_weight_pct: 45, top3_weight_pct: 70, bucket_count: 5 }, "es");
    // The backend's own phrasing for >=40% is "... representa el X% del fondo — una concentración alta en un solo sector."
    expect(text).not.toContain("representa el");
    expect(text).not.toContain("concentración alta");
  });

  it("falls back to a top1-only sentence when top3 isn't available", () => {
    const text = describeSectorConcentration({ top1_name: "Salud", top1_weight_pct: 22, top3_weight_pct: null, bucket_count: 1 }, "es");
    expect(text).toBe("El sector Salud concentra el 22.0% del fondo.");
  });

  it("returns null when there's no real sector data, never fabricating a percentage", () => {
    expect(describeSectorConcentration({ top1_name: null, top1_weight_pct: null, top3_weight_pct: null, bucket_count: 0 }, "es")).toBeNull();
  });

  it("supports English wording", () => {
    const text = describeSectorConcentration({ top1_name: "Technology", top1_weight_pct: 32.4, top3_weight_pct: 58.1, bucket_count: 11 }, "en");
    expect(text).toBe("The Technology sector makes up 32.4% of the fund (the top 3 sectors add up to 58.1%).");
  });
});

describe("describeGeographyNote / describeHoldingsCaveat / describeHoldingsUnavailableNote", () => {
  it("clarifies domicile vs. revenue location, never claiming revenue data exists", () => {
    expect(describeGeographyNote("es")).toMatch(/domicilio/);
    expect(describeGeographyNote("es")).toMatch(/no necesariamente/);
  });

  it("never implies holdings count alone guarantees diversification", () => {
    expect(describeHoldingsCaveat("es")).toMatch(/no garantiza diversificación/);
  });

  it("is explicit that individual holdings data doesn't exist, never implying it was omitted by choice", () => {
    expect(describeHoldingsUnavailableNote("es")).toMatch(/no tiene acceso/);
  });
});
