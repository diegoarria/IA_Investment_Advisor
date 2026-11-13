// Nuvos Plus — Fase 4E-2 (2026-11): editorial summary for "Posiciones"
// inside "Explora tu portafolio". Pure, deterministic, side-effect-free —
// every number here is read verbatim from `weight_pct` values the backend
// already computed (app/services/portfolio_exposure), never a parallel
// calculation. Only verifiable positions with a real weight are
// considered; unverifiable ones are silently excluded from this summary,
// never treated as zero.

export type PositionLike = { ticker: string; name: string | null; weight_pct: number | null; verifiable: boolean };

export type PositionsSummary = {
  concentrationHeadline: string | null;
  concentrationDetail: string | null;
  largestHeadline: string | null;
  largestDetail: string | null;
  largestConsequence: string | null;
  largestTicker: string | null;
};

export function buildPositionsSummary(positions: PositionLike[], lang: "es" | "en" = "es"): PositionsSummary {
  const verified = positions.filter((p): p is PositionLike & { weight_pct: number } => p.verifiable && p.weight_pct !== null);
  if (verified.length === 0) {
    return { concentrationHeadline: null, concentrationDetail: null, largestHeadline: null, largestDetail: null, largestConsequence: null, largestTicker: null };
  }

  const sorted = [...verified].sort((a, b) => b.weight_pct - a.weight_pct);
  const largest = sorted[0];
  const largestPct = Math.round(largest.weight_pct * 10) / 10;
  const largestLabel = largest.name || largest.ticker;

  const largestHeadline = lang === "es" ? `${largestLabel} es tu posición más grande.` : `${largestLabel} is your largest position.`;
  const largestDetail = lang === "es"
    ? `Representa ${largestPct.toFixed(1)}% del valor verificado de tu portafolio.`
    : `It represents ${largestPct.toFixed(1)}% of your portfolio's verified value.`;
  // Diego, 2026-11 (rediseño): la consecuencia educativa pedida
  // explícitamente — nunca una predicción, solo lo que significa el
  // PESO relativo ya calculado por el backend.
  const largestConsequence = lang === "es"
    ? "Una variación en esta posición pesa proporcionalmente más sobre tu portafolio que una variación equivalente en una posición más pequeña."
    : "A change in this position carries proportionally more weight on your portfolio than an equivalent change in a smaller position.";

  let concentrationHeadline: string;
  let concentrationDetail: string | null = null;

  if (sorted.length === 1) {
    concentrationHeadline = lang === "es"
      ? "Toda tu inversión verificada está en una sola posición."
      : "All of your verified investment is in a single position.";
  } else {
    // Diego, 2026-11 (rediseño): eliminado el juicio de valor "bien
    // distribuidas"/"concentradas" basado en umbrales arbitrarios (60%/
    // 40%) — per instrucción explícita "preferir hechos verificables".
    // El titular ahora es el hecho mismo (el % combinado real), sin
    // calificarlo de bueno o malo.
    const top2 = sorted.slice(0, 2);
    const combined = Math.round(top2.reduce((s, p) => s + p.weight_pct, 0) * 10) / 10;
    const names = top2.map((p) => p.ticker);
    const joined = lang === "es" ? `${names[0]} y ${names[1]}` : `${names[0]} and ${names[1]}`;
    concentrationHeadline = lang === "es"
      ? `${joined} representan juntos el ${combined.toFixed(1)}% de tu portafolio verificado.`
      : `${joined} together represent ${combined.toFixed(1)}% of your verified portfolio.`;
    concentrationDetail = lang === "es"
      ? "Esto significa que el resultado de tu portafolio depende, en una parte importante, del comportamiento de estas dos inversiones."
      : "This means your portfolio's outcome depends, to an important degree, on how these two investments behave.";
  }

  return { concentrationHeadline, concentrationDetail, largestHeadline, largestDetail, largestConsequence, largestTicker: largest.ticker };
}
