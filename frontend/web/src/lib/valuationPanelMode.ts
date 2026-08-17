// Resolves which valuation panel /subvaluadas shows for a searched ticker.
// Extracted as a pure function (methodology audit — see /Users/diegoarria/
// .claude/plans/cosmic-munching-crown.md) so the "CompanyDiagnosticCard
// always shows first, never falls back to the retired legacy DCF panel
// design" rule has a real regression test, not just inline JSX no test
// touches.
//
// `isDiagnosticLoading` closes the one real gap in that "always first" rule:
// the main ticker `data` (which `gqvIsPrimary` is derived from) resolves
// BEFORE the separate, slower `/company-diagnostic` fetch does, so without
// this flag hasCompanyDiagnostic is briefly false purely because the request
// is still in flight — not because the diagnostic is actually unavailable —
// and the page would flash the retired "gqv" panel before swapping to
// "diagnostic" moments later. Premium users (the only ones who ever get a
// CompanyDiagnosticCard) now see a loading state instead of that flash;
// free users, who never fetch it at all, pass `isDiagnosticLoading=false`
// and go straight to "gqv"/"unavailable" exactly as before.
export type ValuationPanelMode = "diagnostic" | "loading" | "gqv" | "unavailable";

export function resolveValuationPanelMode(
  hasCompanyDiagnostic: boolean, gqvIsPrimary: boolean, isDiagnosticLoading: boolean = false,
): ValuationPanelMode {
  if (hasCompanyDiagnostic) return "diagnostic";
  if (isDiagnosticLoading) return "loading";
  if (gqvIsPrimary) return "gqv";
  return "unavailable";
}
