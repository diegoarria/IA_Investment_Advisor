// Nuvos Plus — "Sectores" refinement (2026-11): editorial copy for the
// dominant-sector block inside "Entender mi portafolio". Pure,
// deterministic, side-effect-free — every number here is read verbatim
// from the backend's own `dominant_sector` insight
// (app/services/portfolio_exposure/insights.py's
// `_dominant_sector_observation`, specifically `total_pct_of_portfolio`
// and `contributors[].contribution_pct_points`), never a parallel
// calculation. Contributor rows are ONLY available when the backend
// itself produced a `dominant_sector` insight (its own >=30% threshold
// and real contributing positions) — when it didn't, this module has
// nothing to re-present and the caller must show a neutral state instead
// of inventing a breakdown.

export type SectorContributor = { ticker: string; name?: string | null; contribution_pct_points: number };
export type PositionAssetClassLookup = { ticker: string; asset_class: "equity" | "etf" | "unknown" };

export function describeSectorHeadline(sector: string, pct: number, lang: "es" | "en" = "es"): string {
  const p = pct.toFixed(1);
  return lang === "es"
    ? `${sector} representa el ${p}% del valor analizado de tu portafolio.`
    : `${sector} represents ${p}% of your portfolio's analyzed value.`;
}

// "De cada $100…" — a plain re-expression of the same percentage, not a
// new figure (rounded to the nearest whole dollar, exactly like the
// per-$100 framing already used elsewhere in Fase 4E).
export function describeSectorShare(sector: string, pct: number, lang: "es" | "en" = "es"): string {
  const n = Math.round(pct);
  return lang === "es"
    ? `De cada $100 del valor analizado, aproximadamente $${n} están expuestos a empresas del sector ${sector}.`
    : `Of every $100 of the analyzed value, approximately $${n} is exposed to ${sector} companies.`;
}

function joinNames(names: string[], lang: string): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  const last = names[names.length - 1];
  const head = names.slice(0, -1).join(", ");
  return lang === "es" ? `${head} y ${last}` : `${head} and ${last}`;
}

// Describes WHY several positions can contribute to the same sector —
// purely descriptive (never "you're too concentrated" / "you should
// diversify"), and only generated when there's more than one real
// contributor to explain. Cross-references each contributor's
// `asset_class` against the portfolio's own `positions` (already fetched,
// no new lookup against an external source) only to decide which of the
// three honest phrasings fits — never to recompute a weight or a sector.
export function describeContributorsExplanation(
  sector: string,
  contributors: SectorContributor[],
  positions: PositionAssetClassLookup[],
  lang: "es" | "en" = "es"
): string | null {
  if (contributors.length < 2) return null;
  // A contributor whose ticker isn't found in `positions` (shouldn't
  // happen with real backend data, but never assumed) counts as
  // "unknown" rather than being silently dropped — otherwise two real
  // ETF contributors plus one untraceable one would wrongly look like
  // an ETF-only set.
  const classes = new Set(
    contributors.map((c) => positions.find((p) => p.ticker === c.ticker)?.asset_class ?? "unknown")
  );
  const mixed = classes.has("equity") && classes.has("etf");
  const onlyEtf = classes.size === 1 && classes.has("etf");
  const onlyEquity = classes.size === 1 && classes.has("equity");

  if (mixed) {
    return lang === "es"
      ? `Aunque tienes varias inversiones, algunas contribuyen al mismo sector. Por eso puedes tener exposición a ${sector} tanto a través de acciones individuales como de ETFs.`
      : `Even though you hold several investments, some of them contribute to the same sector. That's why your exposure to ${sector} comes both from individual stocks and from ETFs.`;
  }
  if (onlyEtf) {
    return lang === "es"
      ? `Varios de tus ETFs incluyen empresas del sector ${sector} entre sus activos, por eso su exposición se suma.`
      : `Several of your ETFs include ${sector} companies among their holdings, which is why their exposure adds up.`;
  }
  if (onlyEquity) {
    return lang === "es"
      ? `Varias de tus acciones individuales pertenecen al sector ${sector}, por eso su exposición se suma.`
      : `Several of your individual stocks belong to the ${sector} sector, which is why their exposure adds up.`;
  }
  const names = joinNames(contributors.map((c) => c.ticker), lang);
  return lang === "es"
    ? `${names} contribuyen juntas a tu exposición a ${sector}.`
    : `${names} together contribute to your exposure to ${sector}.`;
}
