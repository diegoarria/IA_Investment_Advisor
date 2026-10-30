// Radar WACC-persistence audit, 2026-10-29: a component calling
// `someOptionalField.toFixed(1)` directly crashes the whole ficha the
// moment that field is null/undefined/NaN/Infinity — which every
// `company_valuations` row persisted before today's fix actually was for
// `assumptions.discount_rate_pct` (a separate, now-fixed persistence bug;
// historical rows are intentionally left null, never backfilled with an
// invented value). Never falls back to 0 — a missing rate rendered as
// "0.0%" is a real, misleading number, not an empty state.
export function safeToFixed(v: number | null | undefined, decimals: number): string | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return v.toFixed(decimals);
}
