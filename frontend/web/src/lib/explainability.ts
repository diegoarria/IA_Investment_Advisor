// Fase 4, Incremento 3 — Explainability Engine (Parte C). Pure helper
// functions that adapt data ALREADY returned by Fase 2/3 backend engines
// (factors[]/EvidenceTaggedClaim) into the ExplanationContent shape
// ExplainableValue renders — never invents an explanation, only extracts
// and formats what the backend already computed.

import type { ExplanationFactor } from "@/components/ui/ExplainableValue";

/** Safely extracts a real `factors[]` array (name/value/score/reason) from
 * a loosely-typed `nuvos_estimate` object (NifPillarData.nuvos_estimate is
 * `Record<string, unknown>` since each pillar has different fields) —
 * never throws on a malformed/missing shape, just returns []. */
export function extractFactorsFromNuvosEstimate(
  nuvosEstimate: Record<string, unknown> | null | undefined,
): ExplanationFactor[] {
  const raw = nuvosEstimate?.factors;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      name: typeof f.name === "string" ? f.name : "",
      value: typeof f.value === "number" || typeof f.value === "string" ? f.value : null,
      score: typeof f.score === "number" ? f.score : null,
      reason: typeof f.reason === "string" ? f.reason : "",
    }))
    .filter((f) => f.name && f.reason);
}

interface DeteriorationFactorLike {
  name: string;
  direction: "mejorando" | "deteriorando" | "estable" | null;
  reason: string;
}

/** Picks the most notable real Deterioration Engine factor among
 * `relevantNames` (never "estable"/null — a metric that isn't moving isn't
 * a change worth surfacing here) to answer "qué cambió vs. el trimestre
 * anterior" for a specific score. Returns null (never a fabricated "no
 * changes") when nothing in the relevant set actually moved. Duck-typed
 * (not importing NifDeteriorationFactor from components/) so this stays a
 * components-independent logic module, per Fase 4 Parte O's layering rule. */
export function pickDeteriorationChangeNote(
  factors: DeteriorationFactorLike[] | null | undefined, relevantNames: string[],
): string | null {
  if (!factors) return null;
  const moving = factors.find((f) => relevantNames.includes(f.name) && f.direction && f.direction !== "estable");
  return moving ? moving.reason : null;
}

/** The real margin-of-safety formula, rendered with the real price/
 * intrinsic-value numbers already on the page — not a re-derivation of
 * the backend's own margin_of_safety_pct (which stays the source of
 * truth), just showing the arithmetic behind it. */
export function formatMarginOfSafetyFormula(price: number | null, intrinsicValue: number | null): string | null {
  if (price === null || intrinsicValue === null || intrinsicValue === 0) return null;
  return `(($${intrinsicValue.toFixed(2)} - $${price.toFixed(2)}) / $${intrinsicValue.toFixed(2)}) × 100`;
}
