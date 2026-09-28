"use client";

// Hero simplificado — Fase 3 del plan en /Users/diegoarria/.claude/plans/
// dapper-scribbling-honey.md. Reemplaza el hero anterior (2 tarjetas KPI +
// cita en itálica + oración de blend + termómetro estático) por el diseño
// validado en el Artifact de META: veredicto, una frase, 3 barras
// (valor razonable del escenario activo / precio / Wall Street), 3
// escenarios clicables que actualizan el veredicto y las barras, y UNA
// tarjeta colapsada "¿Por qué llegamos a este número?" con divulgación
// progresiva.
//
// Diego, 2026-09-03 (segundo cambio el mismo día) — full replacement: el
// veredicto/frase/barras/escenarios de arriba YA NO son el motor P/E
// único viejo. baseFairValue/conservative/optimistic ahora vienen del
// blend ganancias+flujo de caja (dual-track), aplicado en el backend en
// fundamental_analysis_service.py._attach_gqv_fair_value — un solo punto
// de mutación que alimenta toda la app (diagnóstico, screener de
// Oportunidades, overlay de precio en vivo), no solo esta pantalla. La
// tarjeta "por qué" adentro sigue mostrando el mismo blend (ganancias +
// FCF = valor razonable) que YA SE VE arriba en las barras — ya no es una
// "segunda perspectiva", es el desglose del número principal.
//
// El detalle completo del cálculo real (clasificación, WACC, cascada del
// P/E justo) sigue viviendo en la pestaña Valuación de
// CompanyDiagnosticValuationTabs — el enlace de acá apunta ahí.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, Minus, ShieldCheck, Lightbulb, ChevronDown, ChevronUp } from "lucide-react";
import { GlowCard, RingGauge, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import { _SCENARIO_COLOR, _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI } from "@/components/subvaluadas/shared";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

type ScenarioKey = "bear" | "base" | "bull";

const _GOLD = GOLD;

// Redesign v2 (2026-09-27) — same structure as mobile's CompanyDiagnosticHero:
// 1) verdict card tinted by the verdict (big margin number, pill, sentence,
// gradient bars, scenario switch), 2) Nuvos score card (gradient ring),
// 3) "¿por qué?" card. Web keeps its locked behavior and the anchor link to
// the full step-by-step detail in the tabs below.
export function CompanyDiagnosticHero({
  data, locked, onUnlock,
}: {
  data: CompanyDiagnosticData;
  locked?: boolean;
  onUnlock?: () => void;
}) {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [whyOpen, setWhyOpen] = useState(false);

  const { conservative, baseFairValue, optimistic, currentPrice } = data.valuation;
  const scenarioValue: Record<ScenarioKey, number> = { bear: conservative, base: baseFairValue, bull: optimistic };
  const activeValue = scenarioValue[scenario];
  // Diego, 2026-09-07 — the Wall Street bar tracks the same bear/base/bull
  // toggle: target_low for Bajista, target_mean (→ median) for Base,
  // target_high for Alcista.
  const analystTarget = data.valuation.analystTarget;
  const wallStreetByScenario: Record<ScenarioKey, number | null> = {
    bear: analystTarget?.target_low ?? null,
    base: analystTarget?.target_mean ?? analystTarget?.target_median ?? null,
    bull: analystTarget?.target_high ?? null,
  };
  const wallStreet = wallStreetByScenario[scenario];

  const status = _valuationStatus(activeValue, currentPrice);
  const maxVal = Math.max(activeValue, currentPrice, wallStreet ?? 0) || 1;
  const bars: { label: string; value: number; color: string }[] = [
    { label: t("companyDiagnostic.hero.fairValueBar"), value: activeValue, color: _SCENARIO_COLOR[scenario] },
    { label: t("companyDiagnostic.hero.priceTodayBar"), value: currentPrice, color: "#5C6883" },
  ];
  if (wallStreet != null) bars.push({ label: t("companyDiagnostic.hero.wallStreetBar"), value: wallStreet, color: "#8C97AD" });

  const _classificationLabel = data.valuation.classification?.category
    ? t(`companyDiagnostic.classification.category.${data.valuation.classification.category}`, {
        defaultValue: data.valuation.classification.category,
      })
    : t("companyDiagnostic.hero.whySummaryFallback");
  const whySummary = t(
    data.valuation.shadowDualTrack?.applicable ? "companyDiagnostic.hero.whySummary" : "companyDiagnostic.hero.whySummarySingleTrack",
    { classification: _classificationLabel },
  );

  const vColor = status ? _VERDICT_COLOR[status.verdict] : _GOLD;
  const VIcon = status?.verdict === "undervalued" ? TrendingUp : status?.verdict === "overvalued" ? TrendingDown : Minus;

  return (
    <div className="space-y-4">
      {/* ── 1. Verdict ── */}
      <GlowCard tint={vColor} strong>
        {status && (
          <div className="flex flex-col items-center mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: `${vColor}2e` }}>
                <VIcon className="w-[22px] h-[22px]" style={{ color: vColor }} />
              </div>
              {status.verdict !== "fair" && (
                <span className="text-[54px] leading-[60px] font-black tabular-nums tracking-[-2px]" style={{ color: vColor }}>
                  {status.pct.toFixed(0)}%
                </span>
              )}
            </div>
            <span className="mt-2.5 px-3.5 py-[7px] rounded-full text-[13.5px] font-black" style={{ color: vColor, background: `${vColor}24` }}>
              {_VERDICT_EMOJI[status.verdict]} {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
            </span>
          </div>
        )}

        <p className="text-[15px] leading-[22px] text-center mb-1.5" style={{ color: "var(--text)" }}>
          {t("companyDiagnostic.hero.sentence", { price: fmtPrice(currentPrice), ticker: data.ticker, fairValue: fmtPrice(activeValue) })}{" "}
          {status && (
            <strong className="font-black" style={{ color: vColor }}>
              {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
            </strong>
          )}.
        </p>
        <p className="text-[10.5px] text-center mb-5" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.hero.disclaimer")}</p>

        <div className="space-y-3.5 mb-5">
          {bars.map((bar) => {
            const pct = Math.max(4, Math.min(100, (bar.value / maxVal) * 100));
            return (
              <div key={bar.label}>
                <div className="flex items-baseline justify-between mb-[7px]">
                  <span className="text-[12.5px] font-bold truncate" style={{ color: "var(--sub)" }}>{bar.label}</span>
                  <span className="text-[17px] font-black tabular-nums" style={{ color: "var(--text)" }}>{fmtPrice(bar.value)}</span>
                </div>
                <div className="h-3 rounded-md overflow-hidden" style={{ background: "rgba(127,127,127,0.14)" }}>
                  <div className="h-full rounded-md transition-all" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${bar.color}99, ${bar.color})` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-1.5 p-[5px] rounded-[18px]" style={{ background: "rgba(0,0,0,0.22)" }}>
          {(["bear", "base", "bull"] as ScenarioKey[]).map((key) => {
            const active = scenario === key;
            const sc = _SCENARIO_COLOR[key];
            return (
              <button
                key={key}
                onClick={() => setScenario(key)}
                className="flex-1 rounded-[14px] py-[11px] flex flex-col items-center transition-all"
                style={{ background: active ? `linear-gradient(135deg, ${sc}, ${sc}b3)` : "transparent" }}
              >
                <span className="text-[10px] font-black uppercase tracking-[0.6px]" style={{ color: active ? "#0A0F1A" : sc }}>
                  {t(`companyDiagnostic.hero.scenario.${key}`)}
                </span>
                <span className="text-[15px] font-black tabular-nums mt-[3px]" style={{ color: active ? "#0A0F1A" : "var(--text)" }}>
                  {fmtPrice(scenarioValue[key])}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-center mt-2.5" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.hero.scenarioHint")}</p>
      </GlowCard>

      {/* ── 2. Nuvos score ── */}
      <GlowCard tint={_GOLD}>
        <div className="flex items-center gap-[18px]">
          <div className="relative">
            <div className="absolute inset-[10px] rounded-full" style={{ background: `${_GOLD}22` }} />
            <RingGauge score={data.score} size={116} stroke={11}>
              <span className="text-[36px] leading-[40px] font-black tabular-nums" style={{ color: "var(--text)" }}>{data.score}</span>
              <span className="text-[11px] font-extrabold -mt-0.5" style={{ color: "var(--muted)" }}>/100</span>
            </RingGauge>
          </div>
          <div className="flex-1 min-w-0 space-y-2.5">
            <p className="text-[15px] leading-5 font-black uppercase tracking-[0.6px]" style={{ color: _GOLD }}>{data.scoreLabel}</p>
            {data.badges.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.badges.map((b) => (
                  <span key={b} className="px-2.5 py-[5px] rounded-full text-[11px] font-extrabold" style={{ color: _GOLD, background: `${_GOLD}1f`, border: `1px solid ${_GOLD}55` }}>
                    {b}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Diego, 2026-09-06 — guardrail against "overvalued reads as a bad
            company" for a genuinely high-quality business. Shown ONLY when
            real quality >= 70 AND today's verdict is overvalued. */}
        {status?.verdict === "overvalued" && data.pillarScores.quality >= 70 && (
          <div className="flex items-start gap-2.5 rounded-2xl p-3.5 mt-[18px]" style={{ background: "rgba(0,0,0,0.18)" }}>
            <ShieldCheck className="w-[17px] h-[17px] shrink-0 mt-px" style={{ color: _GOLD }} />
            <p className="text-[12.5px] leading-[18px]" style={{ color: "var(--sub)" }}>
              {t("companyDiagnostic.hero.qualityOvervaluedNote", { ticker: data.ticker, score: data.pillarScores.quality })}
            </p>
          </div>
        )}
      </GlowCard>

      {/* ── 3. Why this number ── */}
      <GlowCard>
        <div className="flex items-center gap-3 mb-3">
          <IconSquare color={_GOLD} size={40}><Lightbulb className="w-[19px] h-[19px]" style={{ color: _GOLD }} /></IconSquare>
          <p className="flex-1 text-base font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("companyDiagnostic.hero.whyTitle")}</p>
        </div>
        <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{whySummary}</p>
        <button
          onClick={() => (locked ? onUnlock?.() : setWhyOpen((v) => !v))}
          className="mt-3.5 w-full flex items-center justify-center gap-1.5 py-[11px] rounded-[14px] text-[13px] font-extrabold"
          style={{ color: _GOLD, border: `1px solid ${_GOLD}55`, background: `${_GOLD}12` }}
        >
          {locked ? t("companyDiagnostic.hero.whyFullDetail") : whyOpen ? t("companyDiagnostic.hero.whyHide") : t("companyDiagnostic.hero.whyShow")}
          {!locked && (whyOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />)}
        </button>
        {whyOpen && !locked && (
          <div className="mt-3.5 space-y-3.5">
            {data.valuation.waccDetails?.wacc_pct != null && (
              <p className="text-[13px]" style={{ color: "var(--sub)" }}>
                {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                <strong className="font-black" style={{ color: "var(--text)" }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</strong>
              </p>
            )}
            {data.valuation.fairPeBreakdown && (
              <p className="text-[13px]" style={{ color: "var(--sub)" }}>
                {t("companyDiagnostic.fairPeBreakdown.finalPe")}:{" "}
                <strong className="font-black" style={{ color: "var(--text)" }}>{data.valuation.fairPeBreakdown.fair_pe.toFixed(1)}x</strong>
              </p>
            )}
            {data.valuation.shadowDualTrack?.applicable && (
              <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <p className="text-[9.5px] font-black uppercase mb-1.5" style={{ color: "var(--muted)" }}>{t("companyDiagnostic.shadowDualTrack.title")}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex-1 min-w-[90px] rounded-[10px] p-2" style={{ background: "var(--raised)" }}>
                    <div className="text-[9px] font-extrabold" style={{ color: "var(--muted)" }}>
                      {t("companyDiagnostic.shadowDualTrack.earningsTrack")}
                      {data.valuation.shadowDualTrack.earningsTrackWeightPct != null ? ` ${t("companyDiagnostic.shadowDualTrack.weight", { pct: data.valuation.shadowDualTrack.earningsTrackWeightPct })}` : ""}
                    </div>
                    <div className="text-sm font-black" style={{ color: "#4FA695" }}>{fmtPrice(data.valuation.shadowDualTrack.earningsTrackValue)}</div>
                  </div>
                  <span className="text-[15px] font-extrabold" style={{ color: "var(--dim)" }}>+</span>
                  <div className="flex-1 min-w-[90px] rounded-[10px] p-2" style={{ background: "var(--raised)" }}>
                    <div className="text-[9px] font-extrabold" style={{ color: "var(--muted)" }}>
                      {t("companyDiagnostic.shadowDualTrack.fcfTrack")}
                      {data.valuation.shadowDualTrack.fcfTrackWeightPct != null ? ` ${t("companyDiagnostic.shadowDualTrack.weight", { pct: data.valuation.shadowDualTrack.fcfTrackWeightPct })}` : ""}
                    </div>
                    <div className="text-sm font-black" style={{ color: _GOLD }}>
                      {data.valuation.shadowDualTrack.fcfTrackValue != null ? fmtPrice(data.valuation.shadowDualTrack.fcfTrackValue) : "—"}
                    </div>
                  </div>
                  <span className="text-[15px] font-extrabold" style={{ color: "var(--dim)" }}>=</span>
                  <div className="rounded-[10px] px-2.5 py-[7px] text-center" style={{ background: `${_GOLD}24`, border: `1.5px solid ${_GOLD}` }}>
                    <div className="text-[8.5px] font-black uppercase" style={{ color: _GOLD }}>{t("companyDiagnostic.shadowDualTrack.blended")}</div>
                    <div className="text-[15.5px] font-black" style={{ color: _GOLD }}>{fmtPrice(data.valuation.shadowDualTrack.blendedFairValue)}</div>
                  </div>
                </div>
                <p className="text-[9.5px] leading-[13px] mt-1.5" style={{ color: "var(--dim)" }}>{t("companyDiagnostic.shadowDualTrack.subtitle")}</p>
              </div>
            )}
            <a href="#valuation-tabs" className="text-xs font-extrabold underline block" style={{ color: _GOLD }}>
              {t("companyDiagnostic.hero.whyFullDetail")}
            </a>
          </div>
        )}
      </GlowCard>
    </div>
  );
}
