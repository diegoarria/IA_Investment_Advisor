import { describe, expect, it } from "vitest";
import { describeSectorHeadline, describeSectorShare, describeContributorsExplanation } from "./sectorExposureSummary";

describe("describeSectorHeadline", () => {
  it("re-presents the real backend percentage, never a recomputed one", () => {
    expect(describeSectorHeadline("Tecnología", 47.4, "es")).toBe("Tecnología representa el 47.4% del valor analizado de tu portafolio.");
    expect(describeSectorHeadline("Technology", 47.4, "en")).toBe("Technology represents 47.4% of your portfolio's analyzed value.");
  });
});

describe("describeSectorShare", () => {
  it("builds the per-$100 framing, rounded, from the real pct", () => {
    expect(describeSectorShare("Tecnología", 47.4, "es")).toBe(
      "De cada $100 del valor analizado, aproximadamente $47 están expuestos a empresas del sector Tecnología."
    );
  });
});

describe("describeContributorsExplanation", () => {
  const positions = [
    { ticker: "VOO", asset_class: "etf" as const },
    { ticker: "QQQ", asset_class: "etf" as const },
    { ticker: "ASML", asset_class: "equity" as const },
  ];

  it("returns null with fewer than two contributors — nothing to explain", () => {
    expect(describeContributorsExplanation("Tecnología", [{ ticker: "VOO", contribution_pct_points: 17.6 }], positions, "es")).toBeNull();
  });

  it("explains a mix of ETFs and individual stocks contributing to the same sector", () => {
    const text = describeContributorsExplanation(
      "Tecnología",
      [{ ticker: "VOO", contribution_pct_points: 17.6 }, { ticker: "ASML", contribution_pct_points: 17.5 }],
      positions,
      "es"
    );
    expect(text).toBe(
      "Aunque tienes varias inversiones, algunas contribuyen al mismo sector. Por eso puedes tener exposición a Tecnología tanto a través de acciones individuales como de ETFs."
    );
  });

  it("uses ETF-only wording when every contributor is an ETF", () => {
    const text = describeContributorsExplanation(
      "Tecnología",
      [{ ticker: "VOO", contribution_pct_points: 17.6 }, { ticker: "QQQ", contribution_pct_points: 12.3 }],
      positions,
      "es"
    );
    expect(text).toBe("Varios de tus ETFs incluyen empresas del sector Tecnología entre sus activos, por eso su exposición se suma.");
  });

  it("never fabricates a class-specific phrasing when a contributor's asset_class is unknown", () => {
    const text = describeContributorsExplanation(
      "Tecnología",
      [{ ticker: "VOO", contribution_pct_points: 17.6 }, { ticker: "GHOST", contribution_pct_points: 5.0 }],
      positions, // "GHOST" isn't in the positions lookup
      "es"
    );
    expect(text).toBe("VOO y GHOST contribuyen juntas a tu exposición a Tecnología.");
  });

  it("supports English wording via the lang argument", () => {
    const text = describeContributorsExplanation(
      "Technology",
      [{ ticker: "VOO", contribution_pct_points: 17.6 }, { ticker: "ASML", contribution_pct_points: 17.5 }],
      positions,
      "en"
    );
    expect(text).toContain("both from individual stocks and from ETFs");
  });
});
