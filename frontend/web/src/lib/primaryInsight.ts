// Nuvos Plus — Fase 4D: deterministic selection of the ONE observation
// shown in "Resumen" (Vista A). Diego, 2026-11 (Fase 4D approval, point
// 2): must NOT just take insights[0] in whatever order the backend
// happens to return — pick by a fixed priority of categories (sector
// exposure with contributing positions first, then concentration in
// individual positions, then coverage limitations), reusing the exact
// objects + supporting_data the backend already computed
// (app/services/portfolio_exposure/insights.py). Never fabricates a new
// conclusion and never confuses concentration with risk — it only
// picks among candidates that already exist; returns null (a neutral
// state, never a invented one) when none of these categories is present.
export type PortfolioInsight = { category: string; text: string; supporting_data: Record<string, unknown> };

const PRIORITY: readonly string[] = [
  "dominant_sector",               // 1. exposición sectorial relevante + contribuyentes
  "single_position_concentration", // 2. concentración en una posición individual
  "top_holdings",                  // 2b. concentración combinada de las principales posiciones
  "coverage_gap",                  // 3. limitaciones de cobertura
];

export function selectPrimaryInsight(insights: PortfolioInsight[]): PortfolioInsight | null {
  for (const category of PRIORITY) {
    const found = insights.find((i) => i.category === category);
    if (found) return found;
  }
  return null;
}

// Fase 4E (2026-11): "Conclusión → Explicación → Evidencia." The backend's
// own `insight.text` is already correct and precise (see
// app/services/portfolio_exposure/insights.py) — this never recomputes a
// number, it only re-presents the SAME supporting_data already attached
// to the insight as a short conclusion + a one-line cause, matching
// Diego's example ("Casi la mitad del valor analizado de tu portafolio
// está expuesto a tecnología" / "Esta exposición proviene principalmente
// de VOO, ASML y QQQ"). The exact backend sentence is kept as
// `detailText` so nothing verifiable is lost — the UI must still show it
// (plus the raw supporting_data) under "Ver desglose y cómo lo
// calculamos".
export type ObservationCopy = { headline: string; explanation: string; detailText: string | null };

function joinNames(names: string[], lang: string): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  const last = names[names.length - 1];
  const head = names.slice(0, -1).join(", ");
  return lang === "es" ? `${head} y ${last}` : `${head} and ${last}`;
}

export function buildObservationCopy(insight: PortfolioInsight, lang: "es" | "en" = "es"): ObservationCopy {
  const sd = insight.supporting_data as Record<string, unknown>;

  if (insight.category === "dominant_sector" && typeof sd.total_pct_of_portfolio === "number" && typeof sd.sector === "string") {
    const pct = sd.total_pct_of_portfolio;
    const sector = sd.sector;
    const headline = lang === "es"
      ? pct >= 50 ? `Más de la mitad del valor analizado de tu portafolio está expuesto al sector ${sector}.`
        : pct >= 40 ? `Casi la mitad del valor analizado de tu portafolio está expuesto al sector ${sector}.`
        : `Una parte importante de tu portafolio está expuesta al sector ${sector}.`
      : pct >= 50 ? `More than half of your portfolio's analyzed value is exposed to the ${sector} sector.`
        : pct >= 40 ? `Nearly half of your portfolio's analyzed value is exposed to the ${sector} sector.`
        : `A significant part of your portfolio is exposed to the ${sector} sector.`;
    const contributors = Array.isArray(sd.contributors) ? (sd.contributors as { ticker: string }[]) : [];
    const tickers = contributors.slice(0, 3).map((c) => c.ticker).filter(Boolean);
    const explanation = tickers.length
      ? (lang === "es" ? `Esta exposición proviene principalmente de ${joinNames(tickers, lang)}.` : `This exposure comes mainly from ${joinNames(tickers, lang)}.`)
      : insight.text;
    return { headline, explanation, detailText: insight.text };
  }

  if (insight.category === "single_position_concentration" && typeof sd.weight_pct === "number" && typeof sd.ticker === "string") {
    const n = Math.round(sd.weight_pct);
    const headline = lang === "es"
      ? `Aproximadamente $${n} de cada $100 de tu portafolio verificado están en una sola posición.`
      : `About $${n} of every $100 of your verified portfolio sits in a single position.`;
    const explanation = lang === "es"
      ? `Se trata de ${sd.ticker}, tu posición con mayor peso individual.`
      : `That position is ${sd.ticker}, your largest single holding.`;
    return { headline, explanation, detailText: insight.text };
  }

  if (insight.category === "top_holdings" && typeof sd.combined_pct === "number" && Array.isArray(sd.tickers)) {
    const n = Math.round(sd.combined_pct);
    const tickers = (sd.tickers as unknown[]).filter((t): t is string => typeof t === "string");
    const headline = lang === "es"
      ? `Aproximadamente $${n} de cada $100 de tu portafolio verificado están en tus posiciones principales.`
      : `About $${n} of every $100 of your verified portfolio sits in your top holdings.`;
    const explanation = tickers.length
      ? (lang === "es" ? `Esta concentración proviene principalmente de ${joinNames(tickers, lang)}.` : `This concentration comes mainly from ${joinNames(tickers, lang)}.`)
      : insight.text;
    return { headline, explanation, detailText: insight.text };
  }

  if (insight.category === "coverage_gap") {
    const headline = lang === "es"
      ? "Parte de tu portafolio todavía no se puede analizar por completo."
      : "Part of your portfolio can't be fully analyzed yet.";
    return { headline, explanation: insight.text, detailText: null };
  }

  return { headline: insight.text, explanation: "", detailText: null };
}
