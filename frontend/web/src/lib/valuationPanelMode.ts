// Resolves which valuation panel /subvaluadas shows for a searched ticker.
// Extracted as a pure function (methodology audit — see /Users/diegoarria/
// .claude/plans/cosmic-munching-crown.md) so the "CompanyDiagnosticCard
// always shows first, never falls back to the retired legacy DCF panel
// design" rule has a real regression test, not just inline JSX no test
// touches.
export type ValuationPanelMode = "diagnostic" | "gqv" | "unavailable";

export function resolveValuationPanelMode(hasCompanyDiagnostic: boolean, gqvIsPrimary: boolean): ValuationPanelMode {
  if (hasCompanyDiagnostic) return "diagnostic";
  if (gqvIsPrimary) return "gqv";
  return "unavailable";
}
