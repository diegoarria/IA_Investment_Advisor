// Fase 4, Incremento 6 — Historial de valuaciones (Parte E, alcance
// ajustado). Reuses what Fase 3 already stores incrementally
// (user_investment_theses' real version history — never UPDATEd, so a
// full real history exists from the moment a user forks/creates a
// thesis) rather than building a new automatic valuation-snapshot cron,
// which is out of scope for a UX phase (see the plan's Decisión/alcance
// note). Pure diff logic, unit tested — no financial computation, just
// set comparison between two real, already-stored claim lists.

export interface ThesisClaimLike {
  text: string;
}

export interface ThesisVersion {
  id: string;
  version: number;
  thesis_summary: string;
  strengths: ThesisClaimLike[];
  critical_variables: ThesisClaimLike[];
  key_risks: ThesisClaimLike[];
  invalidation_events: ThesisClaimLike[];
  is_current: boolean;
  created_at: string;
  edited_at: string | null;
}

export interface ClaimListDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/** Real set comparison between two already-stored claim lists — never a
 * new AI judgment, just "which of these real strings appear in the new
 * version but not the old one, and vice versa." */
export function diffClaimTexts(oldClaims: ThesisClaimLike[], newClaims: ThesisClaimLike[]): ClaimListDiff {
  const oldTexts = new Set(oldClaims.map((c) => c.text));
  const newTexts = new Set(newClaims.map((c) => c.text));
  return {
    added: newClaims.map((c) => c.text).filter((t) => !oldTexts.has(t)),
    removed: oldClaims.map((c) => c.text).filter((t) => !newTexts.has(t)),
    unchanged: newClaims.map((c) => c.text).filter((t) => oldTexts.has(t)),
  };
}

/** Versions already arrive sorted desc from the backend
 * (get_user_thesis_history orders by version desc) — this just picks the
 * two most recent as the default comparison pair, never assumes an order
 * the caller didn't already establish. */
export function defaultComparisonPair(versions: ThesisVersion[]): [ThesisVersion, ThesisVersion] | null {
  if (versions.length < 2) return null;
  return [versions[0], versions[1]];
}
