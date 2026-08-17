// Resolves which valuation panel /subvaluadas shows for a searched ticker.
// Extracted as a pure function (methodology audit — see /Users/diegoarria/
// .claude/plans/cosmic-munching-crown.md) so the "CompanyDiagnosticCard is
// the ONLY valuation panel this screen ever shows" rule has a real
// regression test, not just inline JSX no test touches.
//
// The retired legacy GQV/DCF panel (and its whole detail cascade — Follow
// Alert, Supuestos, Reverse DCF, Sensitivity, Modelo Completo, Checklist)
// used to be a fallback whenever `build_company_diagnostic()` returned None
// for a ticker. Diego's explicit, repeated instruction ("esta vista ya no
// puede existir... SIEMPRE SIEMPRE SIEMPRE") retired that fallback for
// good — there is no `gqv` mode anymore. The real fix for tickers that used
// to hit that fallback (e.g. UBER, whose trailing GAAP EPS goes negative
// often enough to null out `peCurrent`) is on the backend side
// (company_diagnostic_service.py's valuation gate now accepts peForward/
// peNormalized as alternatives), not a client-side escape hatch.
//
// `isDiagnosticLoading` closes the one real gap in "always first": the main
// ticker `data` resolves BEFORE the separate, slower `/company-diagnostic`
// fetch does, so without this flag `hasCompanyDiagnostic` is briefly false
// purely because the request is still in flight — not because the
// diagnostic is actually unavailable — and the page would flash the honest
// "unavailable" card before swapping to "diagnostic" moments later.
// Premium users (the only ones who ever get a CompanyDiagnosticCard) see a
// real loading state instead of that flash; free users, who never fetch it
// at all, pass `isDiagnosticLoading=false` and go straight to "unavailable".
export type ValuationPanelMode = "diagnostic" | "loading" | "unavailable";

export function resolveValuationPanelMode(
  hasCompanyDiagnostic: boolean, isDiagnosticLoading: boolean = false,
): ValuationPanelMode {
  if (hasCompanyDiagnostic) return "diagnostic";
  if (isDiagnosticLoading) return "loading";
  return "unavailable";
}
