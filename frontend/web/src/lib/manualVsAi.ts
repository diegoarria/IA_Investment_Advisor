// Fase 4, Incremento 7 — Manual vs. IA (Parte G). Pure comparison logic
// between the user's own manual DCF assumptions (the sliders already on
// /subvaluadas) and Nuvos's real suggested assumptions (data.dcf_assumptions,
// already computed by the backend) — never a new valuation, never a
// verdict on which side is "right." Just a neutral, deterministic diff.

/** Fase 1.5, Incremento 15 — generalized from a fixed 3-tuple
 * (growth/wacc/terminalGrowth) to an arbitrary list: `key` just needs a
 * matching `subvaluadas.manualVsAi.assumptions.<key>` i18n entry, so adding
 * a 4th comparison (e.g. a future high-growth-years slider) is appending to
 * the caller's input array, not editing a closed union type here. */
export interface AssumptionInput {
  key: string;
  userValuePct: number;
  nuvosValuePct: number;
}

export interface AssumptionComparison extends AssumptionInput {
  /** userValuePct - nuvosValuePct, in percentage points. Positive means
   * the user assumed MORE than Nuvos, negative means LESS — never framed
   * as better/worse. */
  diffPct: number;
}

export interface ManualVsAiComparison {
  assumptions: AssumptionComparison[];
  userIntrinsicValue: number | null;
  nuvosIntrinsicValue: number | null;
  /** (user - nuvos) / nuvos * 100 — null when either value is missing or
   * Nuvos's value is 0 (division by zero). */
  valueDiffPct: number | null;
  /** The single assumption with the largest absolute divergence — null
   * only if `assumptions` is empty (never happens in practice, since all
   * three DCF inputs are always present on this page). */
  mostDivergentAssumption: AssumptionComparison | null;
}

function buildAssumption({ key, userValuePct, nuvosValuePct }: AssumptionInput): AssumptionComparison {
  return { key, userValuePct, nuvosValuePct, diffPct: Math.round((userValuePct - nuvosValuePct) * 100) / 100 };
}

export function buildManualVsAiComparison(
  inputs: AssumptionInput[],
  userIntrinsicValue: number | null, nuvosIntrinsicValue: number | null,
): ManualVsAiComparison {
  const assumptions = inputs.map(buildAssumption);

  const valueDiffPct = userIntrinsicValue !== null && nuvosIntrinsicValue !== null && nuvosIntrinsicValue !== 0
    ? Math.round(((userIntrinsicValue - nuvosIntrinsicValue) / nuvosIntrinsicValue) * 1000) / 10
    : null;

  const mostDivergentAssumption = assumptions.length > 0
    ? assumptions.reduce((worst, a) => (Math.abs(a.diffPct) > Math.abs(worst.diffPct) ? a : worst))
    : null;

  return { assumptions, userIntrinsicValue, nuvosIntrinsicValue, valueDiffPct, mostDivergentAssumption };
}
