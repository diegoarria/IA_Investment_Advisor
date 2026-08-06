import { describe, it, expect } from "vitest";
import {
  isValidDiscountRateMethod,
  selectDefaultDiscountRatePct,
  resolveDashboardSectionOrder,
  sanitizeFavoriteMetrics,
  DEFAULT_DASHBOARD_SECTION_ORDER,
} from "./personalization";

describe("isValidDiscountRateMethod", () => {
  it("accepts wacc and required_return", () => {
    expect(isValidDiscountRateMethod("wacc")).toBe(true);
    expect(isValidDiscountRateMethod("required_return")).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isValidDiscountRateMethod("garbage")).toBe(false);
    expect(isValidDiscountRateMethod(null)).toBe(false);
  });
});

describe("selectDefaultDiscountRatePct", () => {
  it("uses wacc when method is wacc", () => {
    expect(selectDefaultDiscountRatePct(9, 15, "wacc")).toBe(9);
  });
  it("uses required_return when method is required_return and a value is set", () => {
    expect(selectDefaultDiscountRatePct(9, 15, "required_return")).toBe(15);
  });
  it("falls back to wacc when required_return method is chosen but no value is set", () => {
    expect(selectDefaultDiscountRatePct(9, null, "required_return")).toBe(9);
  });
});

describe("resolveDashboardSectionOrder", () => {
  it("returns the default order when nothing is stored", () => {
    expect(resolveDashboardSectionOrder(null)).toEqual(DEFAULT_DASHBOARD_SECTION_ORDER);
    expect(resolveDashboardSectionOrder(undefined)).toEqual(DEFAULT_DASHBOARD_SECTION_ORDER);
  });
  it("returns a valid custom order as-is", () => {
    const custom = ["nif", "checklist", "thesis_history", "timeline"];
    expect(resolveDashboardSectionOrder(custom)).toEqual(custom);
  });
  it("falls back to default when a stored key is unknown", () => {
    expect(resolveDashboardSectionOrder(["checklist", "nif", "timeline", "made_up"])).toEqual(DEFAULT_DASHBOARD_SECTION_ORDER);
  });
  it("falls back to default when the stored list has the wrong length", () => {
    expect(resolveDashboardSectionOrder(["checklist", "nif"])).toEqual(DEFAULT_DASHBOARD_SECTION_ORDER);
  });
  it("falls back to default when there are duplicate keys", () => {
    expect(resolveDashboardSectionOrder(["checklist", "checklist", "nif", "timeline"])).toEqual(DEFAULT_DASHBOARD_SECTION_ORDER);
  });
});

describe("sanitizeFavoriteMetrics", () => {
  it("returns empty array for null/undefined", () => {
    expect(sanitizeFavoriteMetrics(null)).toEqual([]);
    expect(sanitizeFavoriteMetrics(undefined)).toEqual([]);
  });
  it("keeps only known metric keys", () => {
    expect(sanitizeFavoriteMetrics(["qualityScore", "madeUpMetric", "convictionScore"])).toEqual([
      "qualityScore", "convictionScore",
    ]);
  });
  it("caps at MAX_FAVORITE_METRICS", () => {
    const many = ["qualityScore", "convictionScore", "marginOfSafetyPct", "opportunityScore", "thesisStatus", "netChangeScore", "qualityScore"];
    expect(sanitizeFavoriteMetrics(many).length).toBeLessThanOrEqual(6);
  });
});
