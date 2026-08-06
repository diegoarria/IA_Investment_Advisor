// Fase 4, Incremento 7 — Manual vs. IA (Parte G). Pure comparison logic
// between the user's own manual DCF assumptions (the sliders already on
// /subvaluadas) and Nuvos's real suggested assumptions (data.dcf_assumptions,
// already computed by the backend) — never a new valuation, never a
// verdict on which side is "right." Just a neutral, deterministic diff.

export interface AssumptionComparison {
  key: "growth" | "wacc" | "terminalGrowth";
  userValuePct: number;
  nuvosValuePct: number;
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

function buildAssumption(key: AssumptionComparison["key"], userValuePct: number, nuvosValuePct: number): AssumptionComparison {
  return { key, userValuePct, nuvosValuePct, diffPct: Math.round((userValuePct - nuvosValuePct) * 100) / 100 };
}

export function buildManualVsAiComparison(
  userG: number, userR: number, userGt: number,
  nuvosG: number, nuvosR: number, nuvosGt: number,
  userIntrinsicValue: number | null, nuvosIntrinsicValue: number | null,
): ManualVsAiComparison {
  const assumptions = [
    buildAssumption("growth", userG, nuvosG),
    buildAssumption("wacc", userR, nuvosR),
    buildAssumption("terminalGrowth", userGt, nuvosGt),
  ];

  const valueDiffPct = userIntrinsicValue !== null && nuvosIntrinsicValue !== null && nuvosIntrinsicValue !== 0
    ? Math.round(((userIntrinsicValue - nuvosIntrinsicValue) / nuvosIntrinsicValue) * 1000) / 10
    : null;

  const mostDivergentAssumption = assumptions.length > 0
    ? assumptions.reduce((worst, a) => (Math.abs(a.diffPct) > Math.abs(worst.diffPct) ? a : worst))
    : null;

  return { assumptions, userIntrinsicValue, nuvosIntrinsicValue, valueDiffPct, mostDivergentAssumption };
}
