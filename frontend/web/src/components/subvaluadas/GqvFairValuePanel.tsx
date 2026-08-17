"use client";

// Nuvos Fair Value Engine (Growth + Quality + Value) — PRIMARY valuation
// panel on Oportunidades. See /Users/diegoarria/.claude/plans/
// cosmic-munching-crown.md — promoted from experimental after calibration
// against real tickers. Rendered as primary only when this run's status is
// "ok"; the caller (subvaluadas/page.tsx) falls back to the DCF + exit-
// multiple panel (FairValueScenariosPanel, now labeled as a cross-check)
// whenever this engine couldn't produce a reliable result for a ticker —
// same "never force a number" discipline the backend already enforces.
//
// Internal only: never mentions the underlying investing philosophy this
// engine is inspired by, per this codebase's standing rule (see
// fair_value_engine.py's module docstring) — only the resulting numbers
// and plain-language reasoning are shown.

import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { _SCENARIO_COLOR, _VERDICT_COLOR, _VERDICT_EMOJI, _valuationStatus, type ConfidenceMeterData } from "@/components/subvaluadas/shared";

interface GqvFactor {
  name: string;
  value: number | null;
  weight: number | null;
  reason: string;
}
interface GqvAdjustment {
  factor: string;
  points: number;
  reason: string;
}
interface GqvScenarioValue {
  eps: number | null;
  fair_pe: number;
  fair_value_per_share: number | null;
}
interface GqvGateCheck {
  name: string;
  passed: boolean;
  detail: string;
  critical: boolean;
}

export interface GqvFairValueData {
  status: "ok" | "insufficient_data" | "financial_sector";
  classification: {
    category: string;
    confidence: number;
    secondary_category: string | null;
    reason: string;
    factors: string[];
  } | null;
  earnings_state: {
    state: string;
    normalized_eps: number | null;
    reliability_note: string | null;
    reason: string;
  } | null;
  fair_pe: {
    fair_pe: number;
    band: [number, number];
    primary_anchor: string;
    factors: GqvFactor[];
    adjustments: GqvAdjustment[];
  } | null;
  scenarios: {
    bear: GqvScenarioValue;
    base: GqvScenarioValue;
    bull: GqvScenarioValue;
    current_price: number | null;
    margin_of_safety_pct: number | null;
  } | null;
  reality_gate: { checks: GqvGateCheck[]; overall_pass: boolean } | null;
  divergence: { divergence_pct: number; material: boolean; explained: boolean; causes: string[]; reason: string } | null;
  confidence_meter: ConfidenceMeterData | null;
  insufficient_data_reason: string | null;
  // Methodology-audit transparency (see /Users/diegoarria/.claude/plans/
  // cosmic-munching-crown.md) — how the model actually got to this number.
  fcf_assumptions: {
    fcf_reported: number | null;
    fcf_normalized: number | null;
    maintenance_capex_estimate: number | null;
    growth_capex_estimate: number | null;
    methodology_note: string;
  } | null;
  wacc_details: {
    method: string;
    wacc_pct: number | null;
  } | null;
  // Methodology audit round 2 — same fields as CompanyDiagnosticCard's
  // peForward/peNormalized (see companyDiagnostic.ts for why both are kept
  // alongside the raw GAAP figure rather than replacing it).
  pe_on_normalized_eps: number | null;
  pe_gaap: number | null;
}

const _CATEGORY_LABEL: Record<string, string> = {
  slow_grower: "Slow Grower", stalwart: "Stalwart", fast_grower: "Fast Grower",
  cyclical: "Cyclical", turnaround: "Turnaround", asset_play: "Asset Play", financial: "Financial",
};

function ScenarioCard({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="flex-1 text-center rounded-xl py-3.5" style={{ background: "var(--raised)" }}>
      <div className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>{label}</div>
      <div className="text-lg font-black tabular-nums mt-1" style={{ color: "var(--text)" }}>
        {value != null ? `$${value.toFixed(2)}` : "—"}
      </div>
    </div>
  );
}

// Returns null when this engine has nothing reliable to show — the caller
// is expected to check `data?.status === "ok"` before rendering this as
// the page's PRIMARY panel; this internal guard is a defensive fallback,
// not the primary/secondary decision point itself.
export function GqvFairValuePanel({ data }: { data: GqvFairValueData | null | undefined }) {
  const { t } = useTranslation();
  if (!data || data.status !== "ok" || !data.scenarios) return null;

  const status = _valuationStatus(data.scenarios.base.fair_value_per_share, data.scenarios.current_price);

  return (
    <Card padding="p-6">
      <SectionHeader title={t("subvaluadas.nuvosFairValue.title")} subtitle={t("subvaluadas.nuvosFairValue.subtitle")} />

      <div className="flex items-center gap-2 flex-wrap mt-3 mb-4">
        {data.classification && (
          <span className="text-[11px] font-bold px-2 py-1 rounded-md" style={{ background: "var(--raised)", color: "var(--text)" }}>
            {_CATEGORY_LABEL[data.classification.category] || data.classification.category}
          </span>
        )}
        {data.earnings_state && (
          <span className="text-[11px] px-2 py-1 rounded-md" style={{ background: "var(--raised)", color: "var(--sub)" }}>
            {t("subvaluadas.nuvosFairValue.earningsLabel")}{" "}
            {t(`subvaluadas.nuvosFairValue.earningsStateLabel.${data.earnings_state.state}`, { defaultValue: data.earnings_state.state })}
          </span>
        )}
        {data.fair_pe && (
          <span className="text-[11px] px-2 py-1 rounded-md" style={{ background: "var(--raised)", color: "var(--sub)" }}>
            {t("subvaluadas.nuvosFairValue.fairPeLabel")} {data.fair_pe.fair_pe.toFixed(1)}x
          </span>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        <ScenarioCard label={t("subvaluadas.nuvosFairValue.scenarios.bear")} value={data.scenarios.bear.fair_value_per_share} color={_SCENARIO_COLOR.bear} />
        <ScenarioCard label={t("subvaluadas.nuvosFairValue.scenarios.base")} value={data.scenarios.base.fair_value_per_share} color={_SCENARIO_COLOR.base} />
        <ScenarioCard label={t("subvaluadas.nuvosFairValue.scenarios.bull")} value={data.scenarios.bull.fair_value_per_share} color={_SCENARIO_COLOR.bull} />
      </div>

      {status && (
        <p className="text-[13px] mb-3">
          {_VERDICT_EMOJI[status.verdict]}{" "}
          <span style={{ color: _VERDICT_COLOR[status.verdict], fontWeight: 700 }}>
            {t(`subvaluadas.nuvosFairValue.verdictLabel.${status.verdict}`)}
          </span>{" "}
          <span style={{ color: "var(--muted)" }}>({status.pct.toFixed(1)}%)</span>
        </p>
      )}

      {data.confidence_meter && (
        <p className="text-[11px] mb-2" style={{ color: "var(--muted)" }}>
          {t("subvaluadas.nuvosFairValue.modelConfidenceLabel")}{" "}
          <span style={{ color: "var(--sub)", fontWeight: 700 }}>{data.confidence_meter.score}/100</span> — {data.confidence_meter.label}
        </p>
      )}

      {data.divergence?.material && (
        <p className="text-[11px] mt-2 leading-relaxed" style={{ color: "var(--muted)" }}>
          {data.divergence.explained ? data.divergence.causes.join(" ") : t("subvaluadas.nuvosFairValue.divergenceUnexplained")}
        </p>
      )}

      {data.reality_gate && data.reality_gate.checks.some((c) => !c.passed) && (
        <details className="mt-3">
          <summary className="text-[10.5px] cursor-pointer" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.nuvosFairValue.realityGateToggle", {
              passed: data.reality_gate.checks.filter((c) => c.passed).length,
              total: data.reality_gate.checks.length,
            })}
          </summary>
          <ul className="mt-2 space-y-1">
            {data.reality_gate.checks.filter((c) => !c.passed).map((c) => (
              <li key={c.name} className="text-[10.5px]" style={{ color: c.critical ? "#DD6E63" : "var(--muted)" }}>
                • {c.detail}
              </li>
            ))}
          </ul>
        </details>
      )}

      {(data.fcf_assumptions || data.wacc_details || data.pe_on_normalized_eps != null) && (
        <details className="mt-3">
          <summary className="text-[10.5px] cursor-pointer" style={{ color: "var(--muted)" }}>
            {t("companyDiagnostic.modelAssumptions.toggle")}
          </summary>
          <div className="mt-2 space-y-1.5 text-[10.5px]" style={{ color: "var(--sub)" }}>
            {data.fcf_assumptions && (
              <>
                <p>
                  {t("companyDiagnostic.modelAssumptions.fcfReported")}:{" "}
                  <span style={{ color: "var(--text)", fontWeight: 700 }}>
                    {data.fcf_assumptions.fcf_reported != null ? `$${(data.fcf_assumptions.fcf_reported / 1e6).toFixed(0)}M` : "—"}
                  </span>
                  {" · "}{t("companyDiagnostic.modelAssumptions.fcfNormalized")}:{" "}
                  <span style={{ color: "var(--accent-l)", fontWeight: 700 }}>
                    {data.fcf_assumptions.fcf_normalized != null ? `$${(data.fcf_assumptions.fcf_normalized / 1e6).toFixed(0)}M` : "—"}
                  </span>
                </p>
                {data.fcf_assumptions.growth_capex_estimate != null && data.fcf_assumptions.growth_capex_estimate > 0 && (
                  <p>
                    {t("companyDiagnostic.modelAssumptions.growthCapex")}:{" "}
                    <span style={{ color: "var(--text)", fontWeight: 700 }}>
                      ${(data.fcf_assumptions.growth_capex_estimate / 1e6).toFixed(0)}M
                    </span>
                  </p>
                )}
              </>
            )}
            {data.wacc_details?.wacc_pct != null && (
              <p>
                {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                <span style={{ color: "var(--text)", fontWeight: 700 }}>{data.wacc_details.wacc_pct.toFixed(1)}%</span>
              </p>
            )}
            {data.pe_gaap != null && data.pe_on_normalized_eps != null && Math.abs(data.pe_gaap - data.pe_on_normalized_eps) >= 0.1 && (
              <p>
                {t("subvaluadas.nuvosFairValue.peGaapLabel")}{" "}
                <span style={{ color: "var(--text)", fontWeight: 700 }}>{data.pe_gaap.toFixed(1)}x</span>
                {" · "}{t("subvaluadas.nuvosFairValue.peNormalizedLabel")}{" "}
                <span style={{ color: "var(--accent-l)", fontWeight: 700 }}>{data.pe_on_normalized_eps.toFixed(1)}x</span>
              </p>
            )}
            {data.fcf_assumptions?.methodology_note && (
              <p style={{ color: "var(--dim)" }}>{data.fcf_assumptions.methodology_note}</p>
            )}
          </div>
        </details>
      )}
    </Card>
  );
}
