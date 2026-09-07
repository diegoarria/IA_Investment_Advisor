"use client";

// 4-tab transparency block for the hero card: Valuación / Escenarios /
// Sensibilidad / Comparables — replaces the standalone fairPeBreakdown box.
// Every number here is real, already computed by the Nuvos engine
// (classification.py, fair_pe.py, scenarios.py) and exposed unchanged —
// nothing here is a new heuristic. Fields the mockup this was modeled on
// asked for but the engine doesn't compute (per-scenario probability,
// named catalysts, trigger conditions, peer-by-peer Fair Value) are
// deliberately omitted rather than fabricated — see
// /Users/diegoarria/.claude/plans/dapper-scribbling-honey.md.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Trophy, Shield, Scale, Sparkles } from "lucide-react";
import { fmtPrice } from "@/lib/types/stock";
import { ExplainableValue } from "@/components/ui/ExplainableValue";
import { CompanyDiagnosticPEWaterfall } from "@/components/subvaluadas/CompanyDiagnosticPEWaterfall";
import { CompanyDiagnosticQualityPillar } from "@/components/subvaluadas/CompanyDiagnosticQualityPillar";
import { CompanyDiagnosticTrustPillar } from "@/components/subvaluadas/CompanyDiagnosticTrustPillar";
import { CompanyDiagnosticValuePillar } from "@/components/subvaluadas/CompanyDiagnosticValuePillar";
import { CompanyDiagnosticSimplicityPillar } from "@/components/subvaluadas/CompanyDiagnosticSimplicityPillar";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

type TabKey = "valuation" | "scenarios" | "comparables" | "history";
type PillarKey = "quality" | "trust" | "value" | "simplicity";

const _SCENARIO_COLOR: Record<string, string> = { bear: "#DD6E63", base: "#D4A24C", bull: "#4FA695" };
const _GOLD = "#D4A24C";

// Maps fair_value_engine.py's real adjustment factor keys (growth,
// quality, fcf_margin, leverage, dividend, moat_management — see
// MultipleAdjustment(...) call sites) to a plain-language explanations.*
// entry, so each adjustment reason gets a tap-to-explain label using the
// same ExplainableValue pattern already used for WACC/pillar metrics.
const _ADJUSTMENT_EXPLANATION_KEY: Record<string, string> = {
  growth: "adjGrowth",
  quality: "adjQuality",
  fcf_margin: "adjFcfMargin",
  leverage: "adjLeverage",
  dividend: "adjDividend",
  moat_management: "adjMoatManagement",
};

// Reproduces the Artifact's exact structure: two tab-groups sharing one
// panel area inside the same card ("¿Por qué este número?" — Valuación/
// Escenarios/Comparables/Historial — and "Los 4 pilares de calidad" —
// Calidad/Confianza/Valor/Simplicidad), instead of the 4 pillars living
// as separate stacked cards below. The 4 pillar components themselves
// (CompanyDiagnosticQualityPillar etc.) are untouched, real, and already
// rich — this only changes WHERE they render, not what they show.
export function CompanyDiagnosticValuationTabs({ data }: { data: CompanyDiagnosticData }) {
  const { t, i18n } = useTranslation();
  const { valuation, sectorComparison, competitorComparison } = data;
  const [tab, setTab] = useState<TabKey | PillarKey>("valuation");

  const hasFairPe = !!valuation.fairPeBreakdown;
  const hasScenarios = !!valuation.scenarioBreakdown;
  // Comparables only gets its own tab when there's real data to show — an
  // empty tab (no peers) took up a whole slot for nothing, same reasoning
  // the Artifact's own comment gives for hiding it entirely in that case.
  const hasComparables = !!sectorComparison || !!competitorComparison;
  const hasHistory = !!valuation.priceHistoryContext;

  const whyTabs: { key: TabKey; label: string; available: boolean }[] = [
    { key: "valuation", label: t("companyDiagnostic.tabs.valuation"), available: hasFairPe || !!valuation.classification },
    { key: "scenarios", label: t("companyDiagnostic.tabs.scenarios"), available: hasScenarios },
    { key: "comparables", label: t("companyDiagnostic.tabs.comparables"), available: hasComparables },
    { key: "history", label: t("companyDiagnostic.tabs.history"), available: hasHistory },
  ];
  const pillarTabs: { key: PillarKey; label: string; icon: React.ReactNode }[] = [
    { key: "quality", label: t("companyDiagnostic.pillars.quality.title"), icon: <Trophy className="w-3.5 h-3.5" /> },
    { key: "trust", label: t("companyDiagnostic.pillars.trust.title"), icon: <Shield className="w-3.5 h-3.5" /> },
    { key: "value", label: t("companyDiagnostic.pillars.value.title"), icon: <Scale className="w-3.5 h-3.5" /> },
    { key: "simplicity", label: t("companyDiagnostic.pillars.simplicity.title"), icon: <Sparkles className="w-3.5 h-3.5" /> },
  ];

  if (!whyTabs.some((tb) => tb.available)) return null;

  function TabStrip<K extends TabKey | PillarKey>(props: { items: { key: K; label: string; available?: boolean; icon?: React.ReactNode }[] }) {
    return (
      <div className="flex overflow-x-auto gap-1 p-1" style={{ background: "var(--raised)" }}>
        {props.items.map((tb) => {
          const isAvailable = tb.available ?? true;
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              disabled={!isAvailable}
              onClick={() => setTab(tb.key)}
              className="flex-1 py-2.5 px-2 text-[11px] sm:text-[12px] font-bold uppercase tracking-wide transition-colors whitespace-nowrap flex items-center justify-center gap-1 rounded-lg"
              style={{
                color: !isAvailable ? "var(--dim)" : active ? _GOLD : "var(--muted)",
                background: active ? `${_GOLD}22` : "transparent",
                border: active ? `1px solid ${_GOLD}66` : "1px solid transparent",
                boxShadow: active ? `0 4px 14px ${_GOLD}2e` : "none",
                opacity: isAvailable ? 1 : 0.4,
                cursor: isAvailable ? "pointer" : "not-allowed",
              }}
            >
              {tb.icon}{tb.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div id="valuation-tabs" className="mt-4 rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <p className="text-[9.5px] font-bold uppercase tracking-wide px-3.5 pt-3 pb-1" style={{ color: "var(--muted)", background: "var(--raised)" }}>
        {t("companyDiagnostic.tabs.whyGroupLabel")}
      </p>
      <TabStrip items={whyTabs} />
      <p className="text-[9.5px] font-bold uppercase tracking-wide px-3.5 pt-2.5 pb-1" style={{ color: "var(--muted)", background: "var(--raised)" }}>
        {t("companyDiagnostic.tabs.pillarsGroupLabel")}
      </p>
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        <TabStrip items={pillarTabs} />
      </div>

      <div className="p-3.5 sm:p-4">
        {tab === "valuation" && <ValuationTab data={data} t={t} />}
        {tab === "scenarios" && <ScenariosTab data={data} t={t} />}
        {tab === "comparables" && <ComparablesTab data={data} t={t} />}
        {tab === "history" && <HistoryTab data={data} t={t} lang={i18n.language} />}
        {tab === "quality" && (
          <CompanyDiagnosticQualityPillar
            score={data.pillarScores.quality}
            revenueBreakdown={data.revenueBreakdown}
            moatPoints={data.moatPoints}
            competitorComparison={data.competitorComparison}
            sectorComparison={data.sectorComparison}
            ticker={data.ticker}
          />
        )}
        {tab === "trust" && (
          <CompanyDiagnosticTrustPillar
            score={data.pillarScores.trust}
            financialHealth={data.financialHealth}
            roicAdjustedForBuybacks={data.roicAdjustedForBuybacks}
          />
        )}
        {tab === "value" && (
          <CompanyDiagnosticValuePillar
            score={data.pillarScores.value}
            ticker={data.ticker}
            companyName={data.companyName}
            valuation={data.valuation}
          />
        )}
        {tab === "simplicity" && (
          <CompanyDiagnosticSimplicityPillar
            score={data.pillarScores.simplicity}
            noiseVsReality={data.noiseVsReality}
            actionPlan={data.actionPlan}
          />
        )}
      </div>
    </div>
  );
}

// Numbered step wrapper — same visual language as the Artifact's
// .step-rail/.step-num/.step-line/.step-content: a circled number, a
// connecting line down to the next step, and a bold step label above the
// real content. `last` skips the connecting line for the final step.
function Step({
  n, label, explainer, children, last,
}: { n: number; label: string; explainer?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center shrink-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-black shrink-0"
          style={{ background: `${_GOLD}2e`, border: `2px solid ${_GOLD}`, color: _GOLD, boxShadow: `0 0 0 5px ${_GOLD}17, 0 4px 12px ${_GOLD}40` }}
        >
          {n}
        </div>
        {!last && <div className="w-0.5 flex-1 mt-2 rounded-full" style={{ background: `linear-gradient(${_GOLD}66, var(--border))`, minHeight: 16 }} />}
      </div>
      <div className="flex-1 min-w-0 pb-6">
        <p className="text-[13.5px] font-black mb-1" style={{ color: "var(--text)" }}>{label}</p>
        {explainer && (
          <p className="text-[11.5px] leading-relaxed mb-3" style={{ color: "var(--sub)" }}>{explainer}</p>
        )}
        {children}
      </div>
    </div>
  );
}

function ValuationTab({ data, t }: { data: CompanyDiagnosticData; t: (k: string, o?: Record<string, unknown>) => string }) {
  const { classification, fairPeBreakdown, scenarioBreakdown, waccDetails, shadowDualTrack } = data.valuation;
  const hasShadowFcf = shadowDualTrack?.applicable && shadowDualTrack.fcfTrackValue != null;

  return (
    <div>
      {/* Paso 1 — qué tipo de empresa es */}
      {classification && (
        <Step n={1} label={t("companyDiagnostic.classification.step")} explainer={t("companyDiagnostic.classification.explainer")}>
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", borderLeft: `3px solid ${_GOLD}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.4)" }}>
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="text-[13px] font-black" style={{ color: "var(--text)" }}>
                {t(`companyDiagnostic.classification.category.${classification.category}`, { defaultValue: classification.category })}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.classification.confidence")}</span>
                <div className="w-14 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div className="h-full rounded-full" style={{ width: `${classification.confidence}%`, background: _GOLD }} />
                </div>
                <span className="text-[10px] font-bold tabular-nums" style={{ color: "var(--text)" }}>{Math.round(classification.confidence)}/100</span>
              </div>
            </div>
            <div className="rounded-lg px-3 py-2.5 mb-2" style={{ background: "var(--card-2, var(--raised))", borderLeft: `3px solid ${_GOLD}` }}>
              <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--sub)" }}>{classification.reason}</p>
            </div>
            {classification.factors.length > 0 && (
              <div className="space-y-1">
                {classification.factors.map((f, i) => (
                  <p key={i} className="text-[11px] leading-relaxed flex gap-1.5" style={{ color: "var(--dim)" }}>
                    <span className="shrink-0">•</span>{f}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Step>
      )}

      {/* Paso 2 — tasa de descuento (WACC) */}
      {waccDetails && (
        <Step n={2} label={t("companyDiagnostic.discountRate.step")} explainer={t("companyDiagnostic.discountRate.explainer")}>
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", borderLeft: `3px solid ${_GOLD}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.4)" }}>
            {waccDetails.method === "capm" && waccDetails.beta != null ? (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-md p-2" style={{ background: "var(--card-2, var(--card))" }}>
                    <ExplainableValue label={t("companyDiagnostic.explanations.beta.title")} content={{ summary: t("companyDiagnostic.explanations.beta.body") }}>
                      <span className="text-[9.5px] font-bold uppercase" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.beta")}</span>
                    </ExplainableValue>
                    <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{waccDetails.beta.toFixed(2)}</p>
                  </div>
                  {waccDetails.risk_free_rate_pct != null && (
                    <div className="rounded-md p-2" style={{ background: "var(--card-2, var(--card))" }}>
                      <ExplainableValue label={t("companyDiagnostic.explanations.riskFree.title")} content={{ summary: t("companyDiagnostic.explanations.riskFree.body") }}>
                        <span className="text-[9.5px] font-bold uppercase" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.riskFree")}</span>
                      </ExplainableValue>
                      <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{waccDetails.risk_free_rate_pct.toFixed(1)}%</p>
                    </div>
                  )}
                  {waccDetails.equity_risk_premium_pct != null && (
                    <div className="rounded-md p-2" style={{ background: "var(--card-2, var(--card))" }}>
                      <ExplainableValue label={t("companyDiagnostic.explanations.erp.title")} content={{ summary: t("companyDiagnostic.explanations.erp.body") }}>
                        <span className="text-[9.5px] font-bold uppercase" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.erp")}</span>
                      </ExplainableValue>
                      <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{waccDetails.equity_risk_premium_pct.toFixed(1)}%</p>
                    </div>
                  )}
                  {waccDetails.cost_of_equity_pct != null && (
                    <div className="rounded-md p-2" style={{ background: "var(--card-2, var(--card))" }}>
                      <ExplainableValue label={t("companyDiagnostic.explanations.costOfEquity.title")} content={{ summary: t("companyDiagnostic.explanations.costOfEquity.body") }}>
                        <span className="text-[9.5px] font-bold uppercase" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.costOfEquity")}</span>
                      </ExplainableValue>
                      <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{waccDetails.cost_of_equity_pct.toFixed(1)}%</p>
                    </div>
                  )}
                  {waccDetails.cost_of_debt_pct != null && (
                    <div className="rounded-md p-2" style={{ background: "var(--card-2, var(--card))" }}>
                      <ExplainableValue label={t("companyDiagnostic.explanations.costOfDebt.title")} content={{ summary: t("companyDiagnostic.explanations.costOfDebt.body") }}>
                        <span className="text-[9.5px] font-bold uppercase" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.costOfDebt")}</span>
                      </ExplainableValue>
                      <p className="text-[13px] font-black tabular-nums" style={{ color: "var(--text)" }}>{waccDetails.cost_of_debt_pct.toFixed(1)}%</p>
                    </div>
                  )}
                </div>
                {waccDetails.equity_weight_pct != null && waccDetails.debt_weight_pct != null && (
                  <>
                    <p className="text-[10px] font-bold mb-1" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.weights")}</p>
                    <div className="flex h-2 rounded-full overflow-hidden mb-1">
                      <div style={{ width: `${waccDetails.equity_weight_pct}%`, background: _GOLD }} />
                      <div style={{ width: `${waccDetails.debt_weight_pct}%`, background: "var(--dim)" }} />
                    </div>
                    <div className="flex justify-between text-[10px] font-bold mb-3">
                      <span style={{ color: _GOLD }}>{t("companyDiagnostic.discountRate.equityLabel", { pct: waccDetails.equity_weight_pct.toFixed(0) })}</span>
                      <span style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.debtLabel", { pct: waccDetails.debt_weight_pct.toFixed(0) })}</span>
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="text-[11px] mb-2" style={{ color: "var(--dim)" }}>{t("companyDiagnostic.discountRate.fallbackNote")}</p>
            )}
            {waccDetails.wacc_pct != null && (
              <div className="rounded-lg text-center py-3" style={{ background: `${_GOLD}14`, border: `1px solid ${_GOLD}40` }}>
                <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.discountRate.finalWacc")}</p>
                <p className="text-[22px] font-black tabular-nums" style={{ color: _GOLD, textShadow: `0 0 18px ${_GOLD}4d` }}>{waccDetails.wacc_pct.toFixed(1)}%</p>
              </div>
            )}
          </div>
        </Step>
      )}

      {/* Paso 3 — P/E justo (track de ganancias) */}
      {fairPeBreakdown && (
        <Step n={3} label={t("companyDiagnostic.fairPeBreakdown.toggle")} explainer={t("companyDiagnostic.fairPeBreakdown.explainer")}>
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", borderLeft: `3px solid ${_GOLD}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.4)" }}>
            {fairPeBreakdown.base_multiple != null && (
              <CompanyDiagnosticPEWaterfall breakdown={fairPeBreakdown} t={t} />
            )}
            <div className="space-y-2.5 mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
              {fairPeBreakdown.adjustments.map((adj) => {
                const explKey = _ADJUSTMENT_EXPLANATION_KEY[adj.factor];
                const color = adj.points > 0 ? "#4FA695" : adj.points < 0 ? "#DD6E63" : "var(--dim)";
                return (
                  <div key={adj.factor}>
                    {explKey && (
                      <ExplainableValue
                        label={t(`companyDiagnostic.explanations.${explKey}.title`)}
                        content={{ summary: t(`companyDiagnostic.explanations.${explKey}.body`) }}
                      >
                        <span className="text-[9.5px] font-black uppercase tracking-wide" style={{ color }}>
                          {t(`companyDiagnostic.explanations.${explKey}.title`)}
                        </span>
                      </ExplainableValue>
                    )}
                    <p className="text-[11px] leading-relaxed" style={{ color: explKey ? "var(--sub)" : color }}>
                      {adj.reason}
                    </p>
                  </div>
                );
              })}
            </div>
            {fairPeBreakdown.factors.length > 0 && (
              <div className="mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
                <p className="text-[9.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
                  {t("companyDiagnostic.fairPeBreakdown.anchorsTitle")}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {fairPeBreakdown.factors.map((f, i, arr) => (
                    <div key={f.name} className="flex items-center gap-2">
                      <div className="rounded-lg p-2 min-w-[92px]" style={{ background: "var(--card-2, var(--card))" }}>
                        <p className="text-[9px] font-bold" style={{ color: "var(--muted)" }}>
                          {f.reason.split("(")[0].trim()}
                          {f.weight != null && <span style={{ color: "var(--dim)" }}> {Math.round(f.weight * 100)}%</span>}
                        </p>
                        {f.value != null && (
                          <p className="text-[13px] font-black" style={{ color: "#4FA695" }}>{f.value.toFixed(1)}x</p>
                        )}
                      </div>
                      {i < arr.length - 1 && <span className="text-[13px] font-bold" style={{ color: "var(--dim)" }}>+</span>}
                    </div>
                  ))}
                  <span className="text-[13px] font-bold" style={{ color: "var(--dim)" }}>=</span>
                  <div className="rounded-lg px-3 py-2 text-center" style={{ background: `${_GOLD}24`, border: `1.5px solid ${_GOLD}`, boxShadow: `0 4px 14px ${_GOLD}26` }}>
                    <p className="text-[9px] font-black uppercase" style={{ color: _GOLD }}>{t("companyDiagnostic.fairPeBreakdown.finalPe")}</p>
                    <p className="text-[15px] font-black" style={{ color: _GOLD }}>{fairPeBreakdown.fair_pe.toFixed(1)}x</p>
                  </div>
                </div>
              </div>
            )}
            <p className="text-[10.5px] mt-2.5 pt-2.5" style={{ borderTop: "1px solid var(--border)", color: "var(--dim)" }}>
              {t("companyDiagnostic.fairPeBreakdown.band")}: {fairPeBreakdown.band[0].toFixed(1)}x–{fairPeBreakdown.band[1].toFixed(1)}x
            </p>
          </div>
        </Step>
      )}

      {/* Paso 4 — cálculo final del track de ganancias */}
      {fairPeBreakdown && scenarioBreakdown?.base?.eps != null && (
        <Step n={4} label={t("companyDiagnostic.classification.fairValueFormula")} last={!hasShadowFcf}>
          <div className="rounded-lg p-3 text-[13px] tabular-nums" style={{ background: "rgba(255,255,255,0.035)", color: "var(--text)", border: "1px solid var(--border-s, var(--border))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.4)" }}>
            EPS <span style={{ fontWeight: 800 }}>${scenarioBreakdown.base.eps.toFixed(2)}</span>
            {" × "}{t("companyDiagnostic.fairPeBreakdown.finalPe")}{" "}
            <span style={{ fontWeight: 800 }}>{fairPeBreakdown.fair_pe.toFixed(1)}x</span>
            {" = "}
            <span style={{ color: "#4FA695", fontWeight: 800 }}>{fmtPrice(scenarioBreakdown.base.eps * fairPeBreakdown.fair_pe)}</span>
          </div>
          {hasShadowFcf && (
            <p className="text-[10.5px] leading-relaxed mt-2" style={{ color: "var(--dim)" }}>
              {t("companyDiagnostic.classification.fairValueFormulaNote")}
            </p>
          )}
        </Step>
      )}

      {/* Paso 5 — segundo track: flujo de caja (shadow-mode) */}
      {hasShadowFcf && shadowDualTrack && shadowDualTrack.applicable && (
        <Step n={5} label={t("companyDiagnostic.shadowDualTrack.stepLabel")} last>
          <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", borderLeft: `3px solid ${_GOLD}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.4)" }}>
            <p className="text-[11px] leading-relaxed mb-3" style={{ color: "var(--sub)" }}>
              {t("companyDiagnostic.shadowDualTrack.subtitle")}
            </p>
            <div className="rounded-lg text-center py-3 mb-3" style={{ background: "var(--card-2, var(--raised))" }}>
              <p className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.shadowDualTrack.fcfTrack")}</p>
              <p className="text-[20px] font-black tabular-nums" style={{ color: _GOLD }}>{fmtPrice(shadowDualTrack.fcfTrackValue)}</p>
            </div>
            {shadowDualTrack.normalizedFcfMarginPct != null && (
              <p className="text-[11px] mb-1.5" style={{ color: "var(--sub)" }}>
                {t("companyDiagnostic.shadowDualTrack.normalizedMargin")}:{" "}
                <strong style={{ color: "var(--text)" }}>{shadowDualTrack.normalizedFcfMarginPct.toFixed(1)}%</strong>
              </p>
            )}
            {shadowDualTrack.fcfTrackNote && (
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--dim)" }}>{shadowDualTrack.fcfTrackNote}</p>
            )}
          </div>
        </Step>
      )}
    </div>
  );
}

function ScenariosTab({ data, t }: { data: CompanyDiagnosticData; t: (k: string) => string }) {
  const sb = data.valuation.scenarioBreakdown;
  const grid = data.valuation.sensitivityGrid;
  if (!sb) return null;
  const rows: { key: "bear" | "base" | "bull"; label: string }[] = [
    { key: "bear", label: t("companyDiagnostic.pillars.value.conservative") },
    { key: "base", label: t("companyDiagnostic.pillars.value.baseFairValue") },
    { key: "bull", label: t("companyDiagnostic.pillars.value.optimistic") },
  ];
  const peLabels = grid?.rows[0]?.values.map((v) => v.peLabel) ?? [];
  return (
    <div>
      <p className="text-[11.5px] leading-relaxed mb-3.5" style={{ color: "var(--sub)" }}>
        {t("companyDiagnostic.scenarios.explainer")}
      </p>
      <div className="space-y-2.5">
        {rows.map(({ key, label }) => {
          const s = sb[key];
          const color = _SCENARIO_COLOR[key];
          const isBase = key === "base";
          return (
            <div
              key={key}
              className="rounded-lg p-3 flex items-center justify-between gap-2"
              style={{
                background: isBase ? `${color}1a` : "rgba(255,255,255,0.035)",
                border: `1px solid ${isBase ? `${color}70` : "var(--border-s, var(--border))"}`,
                borderLeft: `3px solid ${color}`,
                boxShadow: isBase ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px ${color}30` : "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 22px rgba(0,0,0,0.3)",
              }}
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color }}>{label}</p>
                <p className="text-[11px] mt-0.5 tabular-nums" style={{ color: "var(--muted)" }}>
                  EPS ${s.eps?.toFixed(2) ?? "—"} × {s.fair_pe.toFixed(1)}x
                </p>
              </div>
              <p className="text-[18px] font-black tabular-nums" style={{ color: "var(--text)" }}>{fmtPrice(s.fair_value_per_share ?? 0)}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[10.5px] leading-relaxed mt-2.5" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.scenarios.noProbabilityNote")}
      </p>

      {grid && (
        <>
          <p className="text-[11px] font-bold mt-5 mb-1" style={{ color: "var(--text)" }}>
            {t("companyDiagnostic.sensitivity.title")}
          </p>
          <p className="text-[10.5px] leading-relaxed mb-2.5" style={{ color: "var(--dim)" }}>
            {t("companyDiagnostic.sensitivity.subtitle")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="text-left py-1.5 pr-2" style={{ color: "var(--muted)" }}>EPS \ P/E</th>
                  {peLabels.map((pl, i) => (
                    <th key={pl} className="text-right py-1.5 px-2 font-bold" style={{ color: _SCENARIO_COLOR[["bear", "fair", "bull"][i]] ?? "var(--text)" }}>
                      {grid.rows[0].values[i].pe.toFixed(1)}x
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.epsLabel} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-1.5 pr-2 font-bold" style={{ color: "var(--text)" }}>${row.eps.toFixed(2)}</td>
                    {row.values.map((v) => (
                      <td key={v.peLabel} className="text-right py-1.5 px-2" style={{ color: "var(--sub)" }}>{fmtPrice(v.fairValue)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ComparablesTab({ data, t }: { data: CompanyDiagnosticData; t: (k: string) => string }) {
  const { sectorComparison, competitorComparison } = data;
  return (
    <div className="space-y-4">
      <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--sub)" }}>
        {t("companyDiagnostic.tabs.comparablesExplainer")}
      </p>
      {sectorComparison && (
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.35)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {sectorComparison.sector} · {sectorComparison.peerCount} {t("companyDiagnostic.tabs.peers")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="text-left py-1.5 pr-2" style={{ color: "var(--muted)" }}></th>
                  <th className="text-right py-1.5 px-2" style={{ color: "var(--text)" }}>{data.ticker}</th>
                  <th className="text-right py-1.5 px-2" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.tabs.sectorMedian")}</th>
                </tr>
              </thead>
              <tbody>
                {sectorComparison.rows.map((r) => (
                  <tr key={r.metricName} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-1.5 pr-2" style={{ color: "var(--sub)" }}>{r.metricName}</td>
                    <td className="text-right py-1.5 px-2 font-bold" style={{ color: "var(--text)" }}>{r.companyValue}</td>
                    <td className="text-right py-1.5 px-2" style={{ color: "var(--muted)" }}>{r.sectorValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sectorComparison.insight && (
            <p className="text-[11px] leading-relaxed mt-2" style={{ color: "var(--sub)" }}>{sectorComparison.insight}</p>
          )}
        </div>
      )}
      {competitorComparison && (
        <div className="rounded-lg p-3" style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.35)" }}>
          <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
            {data.ticker} vs. {competitorComparison.competitorName}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] tabular-nums" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th className="text-left py-1.5 pr-2" style={{ color: "var(--muted)" }}></th>
                  <th className="text-right py-1.5 px-2" style={{ color: "var(--text)" }}>{data.ticker}</th>
                  <th className="text-right py-1.5 px-2" style={{ color: "var(--muted)" }}>{competitorComparison.competitorName}</th>
                </tr>
              </thead>
              <tbody>
                {competitorComparison.rows.map((r) => (
                  <tr key={r.metricName} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-1.5 pr-2" style={{ color: "var(--sub)" }}>{r.metricName}</td>
                    <td className="text-right py-1.5 px-2 font-bold" style={{ color: "var(--text)" }}>{r.targetCompanyValue}</td>
                    <td className="text-right py-1.5 px-2" style={{ color: "var(--muted)" }}>{r.competitorValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {competitorComparison.conclusion && (
            <p className="text-[11px] leading-relaxed mt-2" style={{ color: "var(--sub)" }}>{competitorComparison.conclusion}</p>
          )}
        </div>
      )}
      {!sectorComparison && !competitorComparison && (
        <p className="text-[11px]" style={{ color: "var(--dim)" }}>{t("companyDiagnostic.tabs.noComparables")}</p>
      )}
    </div>
  );
}

const _BUCKET_COLOR: Record<"cheap" | "normal" | "expensive", string> = {
  cheap: _SCENARIO_COLOR.bull, normal: _SCENARIO_COLOR.base, expensive: _SCENARIO_COLOR.bear,
};

// ~5-year real "precio real vs. valor razonable" line chart — see
// company_diagnostic_service.py / price_history_context_service.
// compute_fair_value_chart_series's own docstring for the constant-
// effective-multiple methodology. Points are evenly index-spaced (not
// strictly date-weighted), same simplification ValuationBacktestPanel's
// own monthly chart already uses.
const _CHART_W = 1000;
const _CHART_H = 260;
const _CHART_PAD_TOP = 14;
const _CHART_PAD_BOTTOM = 26;

function _chartPointsFor(values: number[], min: number, max: number): { x: number; y: number }[] {
  const range = max - min || 1;
  const usableH = _CHART_H - _CHART_PAD_TOP - _CHART_PAD_BOTTOM;
  return values.map((v, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * _CHART_W : 0,
    y: _CHART_PAD_TOP + usableH - ((v - min) / range) * usableH,
  }));
}

function _chartSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

const _MONTH_ABBR: Record<"es" | "en", string[]> = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
};

function _monthYearLabel(dateStr: string, lang: string): string {
  const [y, m] = dateStr.split("-");
  const abbr = _MONTH_ABBR[lang.startsWith("en") ? "en" : "es"][Number(m) - 1];
  return `${abbr} '${y.slice(2)}`;
}

function _fullDateLabel(dateStr: string, lang: string): string {
  const [y, m, d] = dateStr.split("-");
  const abbr = _MONTH_ABBR[lang.startsWith("en") ? "en" : "es"][Number(m) - 1];
  return lang.startsWith("en") ? `${abbr} ${Number(d)}, '${y.slice(2)}` : `${Number(d)} ${abbr} '${y.slice(2)}`;
}

function FairValueLineChart({
  chart, ticker, t, lang,
}: {
  chart: NonNullable<CompanyDiagnosticData["valuation"]["fairValueChart"]>;
  ticker: string;
  t: (k: string, o?: Record<string, unknown>) => string;
  lang: string;
}) {
  const { points, effectiveMultiple } = chart;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (points.length < 2) return null;

  const prices = points.map((p) => p.price);
  const fairValues = points.map((p) => p.fairValue);
  const all = [...prices, ...fairValues];
  const min = Math.min(...all) * 0.94;
  const max = Math.max(...all) * 1.06;

  const pricePts = _chartPointsFor(prices, min, max);
  const fairPts = _chartPointsFor(fairValues, min, max);

  // Shaded area between the two lines — teal when price is below fair
  // value (cheap), coral when above (expensive). Consecutive same-color
  // segments are merged into ONE polygon (not one trapezoid per real
  // segment) so shared edges between adjacent polygons don't double-blend
  // under SVG anti-aliasing and render as faint seam stripes — the
  // crossing points (where the fill switches color) still land exactly
  // where the real data crosses.
  const segmentCheap = points.slice(0, -1).map((_, i) => (prices[i] + prices[i + 1]) / 2 < (fairValues[i] + fairValues[i + 1]) / 2);
  const segments: { d: string; color: string; key: number }[] = [];
  let runStart = 0;
  for (let i = 1; i <= segmentCheap.length; i++) {
    if (i === segmentCheap.length || segmentCheap[i] !== segmentCheap[runStart]) {
      const runEnd = i; // exclusive, covers points[runStart..runEnd]
      const top = pricePts.slice(runStart, runEnd + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      const bottom = fairPts.slice(runStart, runEnd + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).reverse();
      segments.push({
        d: `M${top.join(" L")} L${bottom.join(" L")} Z`,
        color: segmentCheap[runStart] ? _SCENARIO_COLOR.bull : _SCENARIO_COLOR.bear,
        key: runStart,
      });
      runStart = i;
    }
  }

  // ~6 evenly-spaced x-axis tick labels across the real date range.
  const tickCount = Math.min(7, points.length);
  const tickIdx = Array.from({ length: tickCount }, (_, i) => Math.round((i / (tickCount - 1)) * (points.length - 1)));

  const todayX = pricePts[pricePts.length - 1].x;
  const todayY = pricePts[pricePts.length - 1].y;

  const handlePointerMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xFrac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverIdx(Math.round(xFrac * (points.length - 1)));
  };

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverPricePt = hoverIdx !== null ? pricePts[hoverIdx] : null;
  // Same convention as backend calc_margin_of_safety: % measured against
  // fair value, not price — "cuánto más barato está vs. lo que vale".
  const hoverPct = hover ? ((hover.fairValue - hover.price) / hover.fairValue) * 100 : 0;
  const hoverUndervalued = hoverPct >= 0;
  const hoverColor = hoverUndervalued ? _SCENARIO_COLOR.bull : _SCENARIO_COLOR.bear;

  return (
    <div className="mb-5">
      <p className="text-[10.5px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
        {t("companyDiagnostic.priceHistory.chartTitle")}
      </p>
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-0.5" style={{ background: "var(--text)" }} />
          <span className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>{t("companyDiagnostic.priceHistory.legendPrice")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="3"><line x1="0" y1="1.5" x2="14" y2="1.5" stroke={_GOLD} strokeWidth="2" strokeDasharray="3 2.5" /></svg>
          <span className="text-[10px] font-bold" style={{ color: "var(--sub)" }}>{t("companyDiagnostic.priceHistory.legendFairValue")}</span>
        </div>
      </div>

      <div
        className="rounded-xl p-2.5 relative"
        style={{ background: "rgba(255,255,255,0.035)", border: "1px solid var(--border-s, var(--border))", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px rgba(0,0,0,0.38)", cursor: "crosshair" }}
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <svg viewBox={`0 0 ${_CHART_W} ${_CHART_H}`} className="w-full h-auto" style={{ overflow: "visible" }}>
          {segments.map((s) => (
            <path key={s.key} d={s.d} fill={s.color} opacity={0.14} />
          ))}
          <path d={_chartSmoothPath(fairPts)} fill="none" stroke={_GOLD} strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />
          <path d={_chartSmoothPath(pricePts)} fill="none" stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={todayX} cy={todayY} r="4" fill="var(--text)" />
          {hoverIdx === null && (
            <g transform={`translate(${Math.min(todayX + 8, _CHART_W - 46)}, ${Math.max(todayY - 20, 4)})`}>
              <rect x="0" y="0" width="44" height="18" rx="9" fill="var(--text)" />
              <text x="22" y="12.5" fontSize="10" fontWeight="800" fill="var(--bg)" textAnchor="middle">
                {t("companyDiagnostic.priceHistory.today")}
              </text>
            </g>
          )}
          {tickIdx.map((idx) => (
            <text
              key={idx}
              x={(idx / (points.length - 1)) * _CHART_W}
              y={_CHART_H - 6}
              fontSize="10"
              fontWeight="700"
              fill="var(--dim)"
              textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
            >
              {_monthYearLabel(points[idx].date, lang)}
            </text>
          ))}
          {hoverIdx !== null && hoverPricePt && (
            <>
              <line x1={hoverPricePt.x} y1={_CHART_PAD_TOP} x2={hoverPricePt.x} y2={_CHART_H - _CHART_PAD_BOTTOM} stroke="var(--dim)" strokeWidth="1.5" />
              <circle cx={hoverPricePt.x} cy={hoverPricePt.y} r="4.5" fill={hoverColor} stroke="var(--raised)" strokeWidth="2" />
            </>
          )}
        </svg>

        {hoverIdx !== null && hover && hoverPricePt && (
          <div
            className="absolute top-1 rounded-lg px-3 py-2 pointer-events-none whitespace-nowrap"
            style={{
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
              left: `${Math.min(Math.max((hoverPricePt.x / _CHART_W) * 100, 18), 82)}%`,
              transform: "translateX(-50%)",
            }}
          >
            <p className="text-[11px] font-black" style={{ color: "var(--text)" }}>
              {_fullDateLabel(hover.date, lang)}
              {" — "}
              <span style={{ color: hoverColor }}>
                {Math.abs(Math.round(hoverPct))}% {t(hoverUndervalued ? "companyDiagnostic.priceHistory.hoverUndervalued" : "companyDiagnostic.priceHistory.hoverOvervalued")}
              </span>
            </p>
            <p className="text-[10.5px] mt-0.5" style={{ color: "var(--sub)" }}>
              {t("companyDiagnostic.priceHistory.hoverPrice")} {fmtPrice(hover.price)} · {t("companyDiagnostic.priceHistory.hoverFairValue")} {fmtPrice(hover.fairValue)}
            </p>
          </div>
        )}
      </div>

      <p className="text-[10.5px] leading-relaxed mt-2" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.priceHistory.chartDisclaimer", {
          ticker,
          multiple: effectiveMultiple.toFixed(1),
          fairValue: fmtPrice(fairValues[fairValues.length - 1]),
        })}
      </p>
    </div>
  );
}

function HistoryTab({ data, t, lang }: { data: CompanyDiagnosticData; t: (k: string, o?: Record<string, unknown>) => string; lang: string }) {
  const ctx = data.valuation.priceHistoryContext;
  if (!ctx) return null;
  const { percentileCheaperThan, daysUsed, todayBucket, buckets } = ctx;

  const bucketOrder: ("cheap" | "normal" | "expensive")[] = ["cheap", "normal", "expensive"];
  // percentileCheaperThan = % of years priced HIGHER than today (today is
  // cheap relative to that %); the marker's position along the bar reads
  // left-to-right as "cheap -> expensive", so it sits at (100 - pct)% from
  // the left — the higher the % of history that was pricier, the further
  // left/cheap today sits.
  const markerPct = Math.min(96, Math.max(4, 100 - percentileCheaperThan));

  return (
    <div>
      <p className="text-[14px] font-black mb-1" style={{ color: "var(--text)" }}>
        {t(`companyDiagnostic.priceHistory.headline.${todayBucket}`, { ticker: data.ticker })}
      </p>
      <p className="text-[11.5px] leading-relaxed mb-4" style={{ color: "var(--sub)" }}>
        {t(`companyDiagnostic.priceHistory.subheadline.${todayBucket}`, { pct: Math.round(percentileCheaperThan), days: daysUsed })}
      </p>

      <div className="relative mt-6 mb-2">
        <div className="h-2 rounded-full flex overflow-hidden">
          <div className="flex-1" style={{ background: _BUCKET_COLOR.cheap }} />
          <div className="flex-1" style={{ background: "var(--dim)" }} />
          <div className="flex-1" style={{ background: _BUCKET_COLOR.expensive }} />
        </div>
        <div className="absolute -top-6 -translate-x-1/2 flex flex-col items-center" style={{ left: `${markerPct}%` }}>
          <span className="text-[10px] font-black uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: "var(--text)", color: "var(--bg)" }}>
            {t("companyDiagnostic.priceHistory.today")}
          </span>
          <div className="w-0.5 h-2.5 mt-0.5" style={{ background: "var(--text)" }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-5">
        <p className="text-[10.5px] font-bold text-left" style={{ color: _BUCKET_COLOR.cheap }}>{t("companyDiagnostic.priceHistory.bucket.cheap")}</p>
        <p className="text-[10.5px] font-bold text-center" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.priceHistory.bucket.normal")}</p>
        <p className="text-[10.5px] font-bold text-right" style={{ color: _BUCKET_COLOR.expensive }}>{t("companyDiagnostic.priceHistory.bucket.expensive")}</p>
      </div>

      {data.valuation.fairValueChart && (
        <FairValueLineChart chart={data.valuation.fairValueChart} ticker={data.ticker} t={t} lang={lang} />
      )}

      <p className="text-[11px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
        {t("companyDiagnostic.priceHistory.whatHappened")}
      </p>
      <div className="space-y-2">
        {bucketOrder.map((key) => {
          const b = buckets[key];
          const isToday = key === todayBucket;
          return (
            <div
              key={key}
              className="rounded-lg p-3"
              style={{
                background: isToday ? `${_BUCKET_COLOR[key]}1a` : "rgba(255,255,255,0.035)",
                border: `1px solid ${isToday ? _BUCKET_COLOR[key] : "var(--border-s, var(--border))"}`,
                borderLeft: `3px solid ${isToday ? _BUCKET_COLOR[key] : "var(--border-s, var(--border))"}`,
                boxShadow: isToday ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 22px ${_BUCKET_COLOR[key]}30` : "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 22px rgba(0,0,0,0.3)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: _BUCKET_COLOR[key] }}>
                  {t(`companyDiagnostic.priceHistory.bucket.${key}`)}
                </span>
                {isToday && (
                  <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: `${_BUCKET_COLOR[key]}22`, color: _BUCKET_COLOR[key] }}>
                    {t("companyDiagnostic.priceHistory.today")}
                  </span>
                )}
              </div>
              {b ? (
                <p className="text-[11.5px]" style={{ color: "var(--sub)" }}>
                  {t("companyDiagnostic.priceHistory.timesHigher", { n: b.timesHigherLater, total: b.daysCount })}
                  {" · "}
                  {t("companyDiagnostic.priceHistory.typicalReturn")}:{" "}
                  <span style={{ color: b.medianReturnPct >= 0 ? _SCENARIO_COLOR.bull : _SCENARIO_COLOR.bear, fontWeight: 700 }}>
                    {b.medianReturnPct >= 0 ? "+" : ""}{b.medianReturnPct.toFixed(1)}%
                  </span>
                </p>
              ) : (
                <p className="text-[11px]" style={{ color: "var(--dim)" }}>{t("companyDiagnostic.priceHistory.insufficientData")}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[10.5px] leading-relaxed mt-3" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.priceHistory.disclaimer", { days: daysUsed })}
      </p>
    </div>
  );
}
