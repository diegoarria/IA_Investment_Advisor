// Deterministic, verified plain-language mapping for `reviewReason` —
// Nuvos Radar Etapa 0 (2026-11-11). `reviewReason` is a real, persisted
// string (backend: company_valuation_service._anomaly_review_reason) with
// exactly two known literal templates today:
//   A) "operating_margin_anchor computed from a thin mixed-regime trend —
//      unreliable 10-year anchor" (or a dynamic operating_margin_anchor_warning
//      string, when the anchor itself is unreliable — AXON/KHC/CAVA/GME/CAH/
//      DDOG/TAP class)
//   B) f"intrinsic/price ratio {ratio}x fuera del rango esperado
//      ({LOW}x-{HIGH}x) — requiere revisión manual antes de publicarse como
//      válida" (CHTR/PLTR/TSLA/Ford's current case/etc.)
// Anything that doesn't match either pattern gets the neutral fallback
// (companyDiagnostic.underReview.reasonFallback) instead of a fabricated
// explanation — never guess at an unrecognized reason.

export interface PlainReviewReason {
  /** Simplified, human-readable explanation. Empty string when unmatched. */
  plain: string;
  /** True only when `raw` matched a known, verified pattern. */
  matched: boolean;
}

const MIXED_REGIME_RE = /mixed-regime|mixed regime|unreliable.*anchor/i;
const PRICE_GAP_RE = /intrinsic\/price ratio\s+([\d.]+)x\s+fuera del rango esperado/i;

export function getPlainReviewReason(
  raw: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string
): PlainReviewReason {
  if (!raw) return { plain: "", matched: false };

  if (MIXED_REGIME_RE.test(raw)) {
    return { matched: true, plain: t("companyDiagnostic.underReview.reasonMixedRegime") };
  }

  const gapMatch = raw.match(PRICE_GAP_RE);
  if (gapMatch) {
    const ratio = parseFloat(gapMatch[1]);
    const key =
      Number.isFinite(ratio) && ratio < 1
        ? "companyDiagnostic.underReview.reasonPriceGapBelow"
        : "companyDiagnostic.underReview.reasonPriceGapAbove";
    return {
      matched: true,
      plain: t(key, { ratio: Number.isFinite(ratio) ? ratio.toFixed(2) : gapMatch[1] }),
    };
  }

  return { matched: false, plain: "" };
}
