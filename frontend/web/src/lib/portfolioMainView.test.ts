import { describe, expect, it } from "vitest";
import { computeTabVisibility } from "./portfolioMainView";

describe("computeTabVisibility", () => {
  it("test 1: Posiciones is the initial/default state's visibility shape", () => {
    const v = computeTabVisibility("posiciones");
    expect(v.showPosiciones).toBe(true);
    expect(v.showDistribucion).toBe(false);
    expect(v.simulatorDisplay).toBe("none");
  });

  it("test 2: Distribución opens correctly -- and hides the floating ExplainButton (its own contextual one takes over)", () => {
    const v = computeTabVisibility("distribucion");
    expect(v.showPosiciones).toBe(false);
    expect(v.showDistribucion).toBe(true);
    expect(v.simulatorDisplay).toBe("none");
    expect(v.showFloatingExplainButton).toBe(false);
  });

  it("test 3: Antes de invertir opens correctly -- simulator becomes visible, floating ExplainButton stays (no dedicated context exists for it)", () => {
    const v = computeTabVisibility("antes_de_invertir");
    expect(v.showPosiciones).toBe(false);
    expect(v.showDistribucion).toBe(false);
    expect(v.simulatorDisplay).toBe("block");
    expect(v.showFloatingExplainButton).toBe(true);
  });

  it("test 8: at most one ExplainButton-relevant state is ever active per view -- Posiciones and Antes de invertir share the floating one, Distribución never does", () => {
    for (const view of ["posiciones", "distribucion", "antes_de_invertir"] as const) {
      const v = computeTabVisibility(view);
      // Distribución is the ONLY view where the floating button is hidden
      // (because PortfolioDistribution renders its own contextual one
      // instead) -- never both, never neither by surprise.
      expect(v.showFloatingExplainButton).toBe(view !== "distribucion");
    }
  });

  it("the simulator's display is a CSS value (always mounted, never conditionally rendered) -- never 'none' except when truly inactive", () => {
    expect(computeTabVisibility("posiciones").simulatorDisplay).toBe("none");
    expect(computeTabVisibility("distribucion").simulatorDisplay).toBe("none");
    expect(computeTabVisibility("antes_de_invertir").simulatorDisplay).toBe("block");
  });

  it("deterministic: same input always produces the same output", () => {
    const a = computeTabVisibility("distribucion");
    const b = computeTabVisibility("distribucion");
    expect(a).toEqual(b);
  });
});
