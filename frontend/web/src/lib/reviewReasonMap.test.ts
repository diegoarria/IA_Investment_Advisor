// Nuvos Radar Etapa 0 (2026-11-11) — guards the deterministic reviewReason
// mapping: known categories must map to a verified plain-language text,
// and anything unrecognized must fall back rather than be fabricated.
import { describe, it, expect } from "vitest";
import { getPlainReviewReason } from "./reviewReasonMap";

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key;

describe("getPlainReviewReason", () => {
  it("returns unmatched for null/undefined (nothing to explain)", () => {
    expect(getPlainReviewReason(null, t)).toEqual({ plain: "", matched: false });
    expect(getPlainReviewReason(undefined, t)).toEqual({ plain: "", matched: false });
  });

  it("matches the static mixed-regime anchor fallback literal (AXON-class)", () => {
    const raw =
      "operating_margin_anchor computed from a thin mixed-regime trend — unreliable 10-year anchor";
    const result = getPlainReviewReason(raw, t);
    expect(result.matched).toBe(true);
    expect(result.plain).toBe("companyDiagnostic.underReview.reasonMixedRegime");
  });

  it("matches a dynamic mixed-regime warning string too, not just the static literal", () => {
    const raw = "Mixed-regime margin trend over the last 10 years, anchor is unreliable for ABC";
    expect(getPlainReviewReason(raw, t).matched).toBe(true);
  });

  it("matches the price-gap-below template and extracts the real ratio (CHTR-class)", () => {
    const raw =
      "intrinsic/price ratio 0.150x fuera del rango esperado (0.2x-5.0x) — requiere revisión manual antes de publicarse como válida";
    const result = getPlainReviewReason(raw, t);
    expect(result.matched).toBe(true);
    expect(result.plain).toBe(
      'companyDiagnostic.underReview.reasonPriceGapBelow:{"ratio":"0.15"}'
    );
  });

  it("matches the price-gap-above template with the real ratio (Ford's current case)", () => {
    const raw =
      "intrinsic/price ratio 10.613x fuera del rango esperado (0.2x-5.0x) — requiere revisión manual antes de publicarse como válida";
    const result = getPlainReviewReason(raw, t);
    expect(result.matched).toBe(true);
    expect(result.plain).toBe(
      'companyDiagnostic.underReview.reasonPriceGapAbove:{"ratio":"10.61"}'
    );
  });

  it("never fabricates an explanation for an unrecognized reason", () => {
    const raw = "some future backend reason text we've never seen before";
    expect(getPlainReviewReason(raw, t)).toEqual({ plain: "", matched: false });
  });
});
