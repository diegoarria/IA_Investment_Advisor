// Nuvos ETF — ficha individual, rediseño de una sola columna (2026-11).
// Copy educativo puro, determinista, sin IA — cada función solo
// re-presenta un número que el backend YA calculó (nunca uno nuevo) con
// una frase distinta a la que el backend usa en `insights[]`, para que
// la sección correspondiente nunca repita literalmente el texto de la
// observación principal mostrada arriba.

export type SectorDiversification = { top1_name: string | null; top1_weight_pct: number | null; top3_weight_pct: number | null; bucket_count: number };
export type Insight = { category: string; text: string; supporting_data: Record<string, unknown> };

// Diego, 2026-11: "no asumir que insights[0] es siempre la mejor
// observación sin comprobar el contrato." Verificado contra
// backend/app/services/etf/insights.py::build_insights — devuelve SIEMPRE
// en orden de prioridad fijo (sector → geográfico → costo), filtrando los
// que no tienen datos, nunca relleno ni reordenado por el cliente. Esta
// función solo documenta y aísla esa suposición verificada en un único
// lugar, para que un cambio real de contrato rompa un test aquí, no una
// falla silenciosa en la UI.
export function selectPrimaryObservation(insights: Insight[]): Insight | null {
  return insights[0] ?? null;
}

const ANCHOR_BY_CATEGORY: Record<string, string> = {
  sector_concentration: "etf-section-composicion",
  geographic_exposure: "etf-section-geografia",
  cost: "etf-section-costos",
};

export function anchorForInsight(insight: Insight): string | null {
  return ANCHOR_BY_CATEGORY[insight.category] ?? null;
}

// Frase de concentración sectorial para la sección "Composición" —
// deliberadamente distinta de insights.py's `_sector_observation` (que
// ya se muestra arriba como la observación principal, cuando aplica).
// Nunca califica "alta"/"baja" sin el número real en la misma frase.
export function describeSectorConcentration(by_sector: SectorDiversification, lang: "es" | "en" = "es"): string | null {
  const { top1_name, top1_weight_pct, top3_weight_pct, bucket_count } = by_sector;
  if (top1_name === null || top1_weight_pct === null) return null;
  const top1 = top1_weight_pct.toFixed(1);
  const top3 = top3_weight_pct !== null ? top3_weight_pct.toFixed(1) : null;
  if (lang === "es") {
    return top3
      ? `El sector ${top1_name} concentra el ${top1}% del fondo (los ${Math.min(3, bucket_count)} principales suman ${top3}%).`
      : `El sector ${top1_name} concentra el ${top1}% del fondo.`;
  }
  return top3
    ? `The ${top1_name} sector makes up ${top1}% of the fund (the top ${Math.min(3, bucket_count)} sectors add up to ${top3}%).`
    : `The ${top1_name} sector makes up ${top1}% of the fund.`;
}

export function describeGeographyNote(lang: "es" | "en" = "es"): string {
  return lang === "es"
    ? "Esta distribución describe el domicilio de las empresas subyacentes, no necesariamente dónde generan sus ingresos."
    : "This distribution describes where the underlying companies are domiciled, not necessarily where they generate their revenue.";
}

export function describeHoldingsCaveat(lang: "es" | "en" = "es"): string {
  return lang === "es"
    ? "Este fondo invierte en varias empresas, pero algunas tienen un peso mayor que otras — el número de posiciones por sí solo no garantiza diversificación."
    : "This fund invests in several companies, but some carry more weight than others — the number of holdings alone doesn't guarantee diversification.";
}

// "No existen holdings individuales disponibles hoy" — una sola nota,
// contextual, mostrada solo donde el usuario naturalmente buscaría esa
// lista (Composición), nunca repetida en Riesgos/Fuentes.
export function describeHoldingsUnavailableNote(lang: "es" | "en" = "es"): string {
  return lang === "es"
    ? "Nuvos no tiene acceso hoy al detalle de las empresas individuales dentro de este fondo — solo a su composición agregada por sector y país."
    : "Nuvos doesn't have access today to the individual companies inside this fund — only its aggregated composition by sector and country.";
}
