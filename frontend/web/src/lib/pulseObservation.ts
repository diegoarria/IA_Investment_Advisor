// Nuvos Plus — Fase 6D: Nuvos Pulse integrado en Resumen. Nunca una
// pantalla nueva — este módulo solo decide QUÉ observación ocupa el
// único espacio que ya existe en "Resumen" (Vista A): la de Pulse (un
// cambio real entre dos fotografías verificables) o la estática ya
// existente (`primaryInsight.ts`). Nunca ambas a la vez, nunca una
// segunda tarjeta.
import { selectPrimaryInsight, type PortfolioInsight } from "@/lib/primaryInsight";

export type PulseChangeRow = { before_pct: number; after_pct: number; delta_pp: number };
export type PulsePositionChange = {
  ticker: string; name?: string | null;
  weight_before_pct: number | null; weight_after_pct: number | null; delta_pp: number | null;
  status: "existing" | "new" | "no_longer_verified";
  classification_changed: boolean;
};
export type PulseSectorChange = PulseChangeRow & { sector: string };
export type PulseCompositionChange = {
  equity_before_pct: number; equity_after_pct: number; equity_delta_pp: number;
  etf_before_pct: number; etf_after_pct: number; etf_delta_pp: number;
};
export type PulsePrimaryChange = {
  category: "sector" | "composition" | "concentration";
  label: string; before_pct: number; after_pct: number; delta_pp: number;
};
export type PulseSnapshotSummary = {
  id: string; observed_at: string; period_key: string; snapshot_type: string;
  verification_state: string; valuation_coverage_pct: number | null;
};
export type PulseCausality = { level: "undetermined" | "no_change"; note_es: string };

export type PulseCompareAvailable = {
  available: true;
  snapshot_before: PulseSnapshotSummary;
  snapshot_after: PulseSnapshotSummary;
  comparability: { status: "comparable" | "partial"; reason: null; warnings: { dimension: string; reason: string; detail?: unknown }[] };
  changes: {
    positions: PulsePositionChange[];
    sectors: PulseSectorChange[] | null;
    composition: PulseCompositionChange | null;
    geography: { equity_domicile: (PulseChangeRow & { country: string })[] | null; etf_underlying: (PulseChangeRow & { country: string })[] | null };
  };
  primary_change: PulsePrimaryChange | null;
  causality: PulseCausality;
};
export type PulseCompareUnavailable = { available: false; reason: string };
export type PulseCompareResult = PulseCompareAvailable | PulseCompareUnavailable;

export type ResumenObservation =
  | { source: "pulse"; pulse: PulseCompareAvailable }
  | { source: "static"; insight: PortfolioInsight | null }
  | { source: "none" };

// Fase 6D §4: Pulse solo ocupa el espacio de la observación estática
// cuando está disponible, es una comparación limpia (nunca "partial" —
// una comparación con advertencias de cobertura relevantes nunca se
// presenta como si tuviera la misma certeza que una limpia), y el motor
// ya determinó (con sus propios umbrales, backend) que el cambio es
// relevante. Nunca asume que cualquier cambio temporal vale más que la
// concentración/sector actual: si Pulse no cumple estas tres
// condiciones, la observación estática de siempre se conserva sin
// cambios.
export function selectResumenObservation(staticInsights: PortfolioInsight[], pulse: PulseCompareResult | null): ResumenObservation {
  const staticInsight = selectPrimaryInsight(staticInsights);
  if (pulse && pulse.available && pulse.comparability.status === "comparable" && pulse.primary_change) {
    return { source: "pulse", pulse };
  }
  return staticInsight ? { source: "static", insight: staticInsight } : { source: "none" };
}

export type PulseObservationCopy = {
  headline: string;
  explanation: string;
  before_pct: number;
  after_pct: number;
  delta_pp: number;
  causalityNote: string;
};

// Fase 6D §5/§6 — solo re-presenta los números que el backend ya validó
// como relevantes (`primary_change`) y el texto de causalidad que el
// backend ya decidió (`causality.note_es`) — nunca inventa una frase de
// causa, nunca usa IA generativa, nunca una conclusión valorativa.
export function buildPulseObservationCopy(pulse: PulseCompareAvailable, lang: "es" | "en" = "es"): PulseObservationCopy | null {
  const change = pulse.primary_change;
  if (!change) return null;
  const direction = change.delta_pp >= 0 ? (lang === "es" ? "aumentó" : "increased") : (lang === "es" ? "disminuyó" : "decreased");
  const categoryLabel =
    change.category === "sector" ? change.label
    : change.category === "composition" ? (change.label === "etf" ? (lang === "es" ? "la proporción de ETFs" : "the ETF share") : (lang === "es" ? "la proporción de acciones" : "the equity share"))
    : change.label; // concentration: the ticker itself

  const headline = lang === "es"
    ? `Tu exposición a ${categoryLabel} ${direction}.`
    : `Your exposure to ${categoryLabel} ${direction}.`;
  const explanation = lang === "es"
    ? `La participación de ${categoryLabel} dentro del valor analizado cambió entre ambas fotografías.`
    : `${categoryLabel}'s share of the analyzed value changed between both snapshots.`;

  return {
    headline, explanation,
    before_pct: change.before_pct, after_pct: change.after_pct, delta_pp: change.delta_pp,
    causalityNote: pulse.causality.note_es,
  };
}
