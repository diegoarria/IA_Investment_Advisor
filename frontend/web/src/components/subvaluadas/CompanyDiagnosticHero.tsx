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
import { ExternalLink } from "lucide-react";
import { fmtPrice } from "@/lib/types/stock";
import { _SCENARIO_COLOR, _valuationStatus, _VERDICT_COLOR, _VERDICT_EMOJI } from "@/components/subvaluadas/shared";
import type { CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

type ScenarioKey = "bear" | "base" | "bull";

// The Artifact's own real gold/teal/coral palette (already used identically
// elsewhere in this exact codebase — CompanyDiagnosticValuationTabs.tsx's
// _SCENARIO_COLOR, CompanyDiagnosticValuePillar.tsx, etc. — not a new,
// invented palette). The Artifact's hero uses gold as its ONE accent
// throughout (score, badges, every info link/toggle) — teal/coral are
// reserved strictly for the undervalued/overvalued semantic signal, and
// the app's own green brand accent doesn't appear in this card at all.
const _GOLD = "#D4A24C";

export function CompanyDiagnosticHero({ data }: { data: CompanyDiagnosticData }) {
  const { t } = useTranslation();
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [whyOpen, setWhyOpen] = useState(false);

  const { conservative, baseFairValue, optimistic, currentPrice } = data.valuation;
  const scenarioValue: Record<ScenarioKey, number> = { bear: conservative, base: baseFairValue, bull: optimistic };
  const activeValue = scenarioValue[scenario];
  // Diego, 2026-09-07 — the Wall Street bar now tracks the same
  // bear/base/bull toggle as the Valor razonable bar above it, instead of
  // always showing the flat analyst mean regardless of which scenario is
  // selected: target_low for Bajista, target_mean (falling back to
  // target_median when the mean specifically is missing) for Base, and
  // target_high for Alcista — the real low/base/high spread analysts
  // themselves publish, not a single number treated as if analysts agreed
  // on one price.
  const analystTarget = data.valuation.analystTarget;
  const wallStreetByScenario: Record<ScenarioKey, number | null> = {
    bear: analystTarget?.target_low ?? null,
    base: analystTarget?.target_mean ?? analystTarget?.target_median ?? null,
    bull: analystTarget?.target_high ?? null,
  };
  const wallStreet = wallStreetByScenario[scenario];

  const status = _valuationStatus(activeValue, currentPrice);
  const maxVal = Math.max(activeValue, currentPrice, wallStreet ?? 0) || 1;

  const bars: { label: string; value: number; color: string; external?: boolean }[] = [
    { label: t("companyDiagnostic.hero.fairValueBar"), value: activeValue, color: _SCENARIO_COLOR[scenario] },
    { label: t("companyDiagnostic.hero.priceTodayBar"), value: currentPrice, color: "var(--dim)" },
  ];
  if (wallStreet != null) {
    bars.push({ label: t("companyDiagnostic.hero.wallStreetBar"), value: wallStreet, color: "var(--sub)", external: true });
  }

  const _classificationLabel = data.valuation.classification?.category
    ? t(`companyDiagnostic.classification.category.${data.valuation.classification.category}`, {
        defaultValue: data.valuation.classification.category,
      })
    : t("companyDiagnostic.hero.whySummaryFallback");
  // Diego, 2026-09-03 — full replacement only applies when the dual-track
  // was actually computable (data.valuation.shadowDualTrack?.applicable);
  // otherwise baseFairValue silently falls back to the old P/E-only
  // engine (see fundamental_analysis_service.py's _attach_gqv_fair_value)
  // and this summary must describe THAT single-track method, not claim a
  // blend that isn't actually behind the number shown.
  const whySummary = t(
    data.valuation.shadowDualTrack?.applicable ? "companyDiagnostic.hero.whySummary" : "companyDiagnostic.hero.whySummarySingleTrack",
    { classification: _classificationLabel },
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-black" style={{ color: "var(--text)" }}>{data.ticker}</h1>
            <span className="text-[15px] font-semibold truncate" style={{ color: "var(--sub)" }}>{data.companyName}</span>
          </div>
          <p className="text-[14px] mt-1" style={{ color: "var(--muted)" }}>{data.sector} · {data.exchange}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="flex items-baseline gap-1">
            <span className="text-4xl sm:text-5xl font-black tabular-nums" style={{ color: _GOLD, textShadow: `0 0 24px ${_GOLD}66` }}>{data.score}</span>
            <span className="text-lg font-bold" style={{ color: "var(--muted)" }}>/100</span>
          </span>
          <p className="text-[13px] font-bold uppercase tracking-wide mt-1.5" style={{ color: _GOLD }}>{data.scoreLabel}</p>
        </div>
      </div>

      {data.badges.length > 0 && (
        <div className="flex flex-wrap gap-2.5 mb-5">
          {data.badges.map((b) => (
            <span
              key={b}
              className="text-[13px] font-bold px-3.5 py-2 rounded-xl"
              style={{ color: _GOLD, background: `${_GOLD}24`, border: `1px solid ${_GOLD}`, boxShadow: `0 3px 10px ${_GOLD}1f` }}
            >
              {b}
            </span>
          ))}
        </div>
      )}

      {status && (
        <div className="flex justify-center mb-4">
          <span
            className="inline-flex items-center gap-2 text-[14px] font-black px-5 py-2.5 rounded-full"
            style={{
              background: `${_VERDICT_COLOR[status.verdict]}33`,
              color: _VERDICT_COLOR[status.verdict],
              border: `1.5px solid ${_VERDICT_COLOR[status.verdict]}`,
              boxShadow: `0 6px 22px ${_VERDICT_COLOR[status.verdict]}40`,
            }}
          >
            <span aria-hidden>{_VERDICT_EMOJI[status.verdict]}</span>
            {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
          </span>
        </div>
      )}

      <p className="text-[13.5px] leading-relaxed text-center mb-1" style={{ color: "var(--sub)" }}>
        {t("companyDiagnostic.hero.sentence", {
          price: fmtPrice(currentPrice),
          ticker: data.ticker,
          fairValue: fmtPrice(activeValue),
        })}{" "}
        {status && (
          <strong style={{ color: _VERDICT_COLOR[status.verdict] }}>
            {t(`companyDiagnostic.hero.verdict.${status.verdict}`, { pct: status.pct.toFixed(0) })}
          </strong>
        )}
        .
      </p>
      <p className="text-[10.5px] text-center mb-5" style={{ color: "var(--dim)" }}>
        {t("companyDiagnostic.hero.disclaimer")}
      </p>

      {/* Diego, 2026-09-06 — real, requested guardrail against a specific
          misread: a high-quality business (Apple, Walmart, Costco, Google
          — real names Diego gave) trading "overvalued" reads, to a casual
          user, as "this is a bad company," when the two scores measure
          completely different things (business quality vs. today's price).
          Shown ONLY in that exact mismatch (real quality score >= 70 AND
          today's verdict is overvalued) — never a generic disclaimer on
          every card, so it stays meaningful instead of becoming background
          noise. Deliberately does NOT reword the verdict pill/sentence
          above (Diego explicitly rejected that option) — this is an
          ADDITIONAL note, not a replacement.  */}
      {status?.verdict === "overvalued" && data.pillarScores.quality >= 70 && (
        <div
          className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 mb-5"
          style={{ background: `${_GOLD}14`, border: `1px solid ${_GOLD}40` }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={_GOLD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
            <path d="M12 2l8 4v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-4z" />
          </svg>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
            {t("companyDiagnostic.hero.qualityOvervaluedNote", { ticker: data.ticker, score: data.pillarScores.quality })}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2.5 mb-4">
        {bars.map((bar) => {
          const pct = Math.min(100, (bar.value / maxVal) * 100);
          return (
            <div key={bar.label} className="flex items-center gap-2.5">
              <span className="text-[11.5px] font-bold w-[100px] shrink-0 flex items-center gap-1" style={{ color: bar.color }}>
                {bar.external && <ExternalLink className="w-2.5 h-2.5 shrink-0" style={{ color: "var(--dim)" }} />}
                {bar.label}
              </span>
              <div className="flex-1 rounded-lg overflow-hidden" style={{ height: 30, background: "var(--card-2, var(--raised))", border: "1px solid var(--border)" }}>
                <div
                  className="h-full rounded-lg"
                  style={{
                    width: `${pct}%`,
                    background: bar.external ? "var(--border-s, var(--dim))" : `linear-gradient(180deg, ${bar.color}dd, ${bar.color})`,
                    boxShadow: bar.external ? "none" : `0 0 16px ${bar.color}80`,
                  }}
                />
              </div>
              <span className="text-[13.5px] font-black tabular-nums w-[82px] text-right shrink-0" style={{ color: "var(--text)" }}>
                {fmtPrice(bar.value)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-1.5">
        {(["bear", "base", "bull"] as ScenarioKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setScenario(key)}
            className="rounded-xl px-2 py-2.5 text-center transition-colors"
            style={{
              border: `1px solid ${scenario === key ? _SCENARIO_COLOR[key] : "var(--border)"}`,
              background: scenario === key ? `${_SCENARIO_COLOR[key]}24` : "transparent",
              boxShadow: scenario === key ? `0 4px 14px ${_SCENARIO_COLOR[key]}26` : "none",
            }}
          >
            <p className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: _SCENARIO_COLOR[key] }}>
              {t(`companyDiagnostic.hero.scenario.${key}`)}
            </p>
            <p className="text-[14px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(scenarioValue[key])}</p>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-center mb-5" style={{ color: "var(--dim)" }}>{t("companyDiagnostic.hero.scenarioHint")}</p>

      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background: "var(--card-2, var(--raised))",
          border: "1px solid var(--border)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.02)",
        }}
      >
        <p className="text-[11px] font-black uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
          {t("companyDiagnostic.hero.whyTitle")}
        </p>
        <p className="text-[12.5px] leading-relaxed" style={{ color: "var(--sub)" }}>{whySummary}</p>
        <button
          onClick={() => setWhyOpen((v) => !v)}
          className="text-[11px] font-bold mt-3 flex items-center gap-1"
          style={{ color: _GOLD }}
        >
          {whyOpen ? t("companyDiagnostic.hero.whyHide") : t("companyDiagnostic.hero.whyShow")}
        </button>
        {whyOpen && (
          <div className="mt-3 space-y-3">
            {data.valuation.waccDetails?.wacc_pct != null && (
              <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                {t("companyDiagnostic.modelAssumptions.wacc")}:{" "}
                <strong style={{ color: "var(--text)" }}>{data.valuation.waccDetails.wacc_pct.toFixed(1)}%</strong>
              </p>
            )}
            {data.valuation.fairPeBreakdown && (
              <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                {t("companyDiagnostic.fairPeBreakdown.finalPe")}:{" "}
                <strong style={{ color: "var(--text)" }}>{data.valuation.fairPeBreakdown.fair_pe.toFixed(1)}x</strong>
              </p>
            )}

            {data.valuation.shadowDualTrack?.applicable && (
              <div className="pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <p className="text-[10px] font-black uppercase tracking-wide mb-2" style={{ color: "var(--muted)" }}>
                  {t("companyDiagnostic.shadowDualTrack.title")}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex-1 min-w-[110px] rounded-lg p-2.5" style={{ background: "var(--card-2, var(--raised))" }}>
                    <div className="text-[10px] font-bold" style={{ color: "var(--muted)" }}>
                      {t("companyDiagnostic.shadowDualTrack.earningsTrack")}
                      {data.valuation.shadowDualTrack.earningsTrackWeightPct != null && (
                        <span className="ml-1" style={{ color: "var(--dim)" }}>
                          {t("companyDiagnostic.shadowDualTrack.weight", { pct: data.valuation.shadowDualTrack.earningsTrackWeightPct })}
                        </span>
                      )}
                    </div>
                    <div className="text-[15px] font-black" style={{ color: "#4FA695" }}>
                      {fmtPrice(data.valuation.shadowDualTrack.earningsTrackValue)}
                    </div>
                  </div>
                  <span className="text-base font-bold" style={{ color: "var(--dim)" }}>+</span>
                  <div className="flex-1 min-w-[110px] rounded-lg p-2.5" style={{ background: "var(--card-2, var(--raised))" }}>
                    <div className="text-[10px] font-bold" style={{ color: "var(--muted)" }}>
                      {t("companyDiagnostic.shadowDualTrack.fcfTrack")}
                      {data.valuation.shadowDualTrack.fcfTrackWeightPct != null && (
                        <span className="ml-1" style={{ color: "var(--dim)" }}>
                          {t("companyDiagnostic.shadowDualTrack.weight", { pct: data.valuation.shadowDualTrack.fcfTrackWeightPct })}
                        </span>
                      )}
                    </div>
                    <div className="text-[15px] font-black" style={{ color: _GOLD }}>
                      {data.valuation.shadowDualTrack.fcfTrackValue != null ? fmtPrice(data.valuation.shadowDualTrack.fcfTrackValue) : "—"}
                    </div>
                  </div>
                  <span className="text-base font-bold" style={{ color: "var(--dim)" }}>=</span>
                  <div className="shrink-0 rounded-lg px-3 py-2 text-center" style={{ background: `${_GOLD}24`, border: `1.5px solid ${_GOLD}`, boxShadow: `0 4px 14px ${_GOLD}26` }}>
                    <div className="text-[9px] font-black uppercase" style={{ color: _GOLD }}>
                      {t("companyDiagnostic.shadowDualTrack.blended")}
                    </div>
                    <div className="text-[17px] font-black" style={{ color: _GOLD }}>
                      {fmtPrice(data.valuation.shadowDualTrack.blendedFairValue)}
                    </div>
                  </div>
                </div>
                <p className="text-[10.5px] leading-relaxed mt-2" style={{ color: "var(--dim)" }}>
                  {t("companyDiagnostic.shadowDualTrack.subtitle")}
                </p>
              </div>
            )}

            <a href="#valuation-tabs" className="text-[11px] font-bold underline block" style={{ color: _GOLD }}>
              {t("companyDiagnostic.hero.whyFullDetail")}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
