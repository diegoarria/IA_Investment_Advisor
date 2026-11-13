"use client";

// ValuacionPreview — Nuvos Radar "Valuación" tab, UX round 4 ("rediseño
// definitivo"), local dev only — NOT wired into the real ficha.
// Diego, 2026-11-12: fuse hero+scenarios into one compact composition, drop
// the EPS×multiple "nivel 3" claim (it doesn't reconcile — see below),
// demote the technical stat tiles, replace the long "qué limita esta
// valoración" prose with a compact 3-scenario comparison grid, gold (not
// red) for the selected intrinsic value, de-emphasize the verdict label.
//
// Every number still comes straight from `data` (FullCompanyDiagnosticData)
// — same real valuation engine as every prior round. Nothing here
// recomputes or fabricates a financial figure.
//
// ── MANDATORY RECONCILIATION (Diego's PASO 3) — investigated, not assumed ──
// Diego caught: EPS $6.00 × Fair P/E 31.5x = $189, but baseFairValue shown
// was $269.51 (session figures at the time he wrote this; live right now
// they're $6.00 / 27.01x / $339.48 — same inconsistency, different moment).
// Traced the real backend code (read-only, nothing touched):
//   - `nuvos_engine/scenarios.py`'s `build_scenarios()` DOES set
//     fair_value_per_share = eps × fair_pe at first (this is the pure
//     "earnings track" — confirmed by hand: 6.00 × 27.01 = 162.06).
//   - But `fundamental_analysis_service.py` (~line 3146-3156) then runs
//     `compute_shadow_dual_track()` (dual-track earnings+FCF blend, "full
//     replacement" per Diego's own 2026-09-03 confirmation) and OVERWRITES
//     scenarios["base"]["fair_value_per_share"] with the confidence-
//     weighted BLEND of that earnings-track value and a SEPARATE FCF-track
//     value — while leaving `eps`/`fair_pe` on the same object UNCHANGED
//     (still the pre-blend earnings-only inputs). Verified live: GOOGL's
//     ratio blended/earnings_track ≈ 2.095, applied identically to
//     bear/base/bull (confirmed: 170.33/81.31 ≈ 339.48/162.06 ≈
//     444.14/212.02 ≈ 2.095) — so the RELATIVE eps/multiple deltas between
//     scenarios are still an honest, consistent story (the same ratio
//     cancels out), but the ABSOLUTE claim "value = eps × multiple" is
//     false for all three, by design, not by bug.
//   - Confirmed via direct curl against the real local API that the blend's
//     own weight/fcf-track-value fields (`shadowDualTrack`, `blend`) are
//     NOT exposed in the JSON this screen receives — only pre-blend
//     eps/fair_pe and post-blend fair_value_per_share are. Exposing them
//     would mean changing what the backend route returns — a contract
//     change out of scope for a frontend-presentation task, not attempted.
// Fix applied: removed the false "Valor estimado = EPS × múltiplo justo"
// claim from the "ver cómo llegamos a este valor" detail. Replaced with an
// honest description that names BOTH real inputs to the blend (earnings-
// based estimate shown above, PLUS a separate cash-flow-based estimate)
// without fabricating weights/numbers this screen doesn't have. The
// relative eps/multiple-delta explanations between scenarios are kept
// (verified mathematically honest per the ratio-cancellation above), but
// no longer phrased as if multiplying them reproduces the headline number.
//
// ── Historical chart + historical-range indicator — audit unchanged ──
// Same findings as every prior round, re-applied, not re-derived:
//   A. `company_valuations` historical (is_current=false) rows: incidental
//      repeat recomputes, not a defensible multi-year fair-value history.
//   B. `fairValueChart` applies TODAY's effective P/E multiple to each
//      historical day's REAL TTM EPS — a retrospective reconstruction,
//      unmistakably labeled via the already-approved
//      `companyDiagnostic.priceHistory.chartDisclaimer` text, never
//      rewritten here.
//   C. `priceHistoryContext`'s cheap/normal/expensive indicator is genuine
//      category A — price TODAY vs. its OWN historical range, a different
//      question than "cheap vs. intrinsic value" (the scenario panel).
// No new chart/statistics code — reusing the real, tested, in-production
// component. Still no 1A/3A/5A/max selector (only ~260-293 real trading
// days per pilot ticker — offering multi-year buttons would be dishonest);
// the honest real-day-count label next to the chart stays as-is.
//
// Reverse-DCF section stays OMITTED — real backend infrastructure exists
// (`reverse_dcf_engine.py`) but isn't wired into this screen's data
// contract (confirmed via curl in the prior round) — exposing it needs
// separate backend-contract authorization, not granted by this directive.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Shield, Wallet, Scale, TrendingUp, TrendingDown, EyeOff, Plus } from "lucide-react";
import { GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import { _valuationStatus, _VERDICT_COLOR } from "@/components/subvaluadas/shared";
import { TabNav } from "@/components/subvaluadas/ResumenPreview";
import { HistoryTab } from "@/components/subvaluadas/CompanyDiagnosticValuationTabs";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

// Round 5 — Diego: make the historical chart the genuine visual
// protagonist of Valuación (bigger, more air, simpler language, a quick
// 3-chip summary before it, honest period selector, 3 short bullets
// after instead of a wall of text). Scope: ONLY this section — the
// hero/scenarios/why/comparison/assumptions sections from round 4 are
// untouched below.
//
// CORRECTION to a false assumption carried in rounds 3-4's own comments:
// those rounds assumed fairValueChart only has ~260-293 real TRADING
// DAYS (≈1 year) because they conflated the chart's DOWNSAMPLED POINT
// COUNT (_CHART_MAX_POINTS=260 in price_history_context_service.py,
// confirmed by reading that file just now) with the real underlying date
// RANGE. Verified live against the local backend for GOOGL just now:
// first point 2017-10-02, last point 2026-11-10 — a genuine ~9-year real
// window (matches priceHistoryContext.daysUsed=2290 and the type file's
// own comment "~5 real years" — actual verified range is closer to 9).
// This means a real, honest 1A/3A/5A/Máx period selector IS legitimate
// to build now — it was wrongly deferred twice before on a false
// premise. Implemented below as a client-side filter over the real,
// already-fetched points array (no new backend call, no new data).
type _Period = "1A" | "3A" | "5A" | "Max";
const _PERIOD_DAYS: Record<Exclude<_Period, "Max">, number> = { "1A": 365, "3A": 365 * 3, "5A": 365 * 5 };
const _PERIOD_LABEL: Record<_Period, string> = { "1A": "1 año", "3A": "3 años", "5A": "5 años", Max: "Todo el período" };

function _filterChartByPeriod(
  chart: NonNullable<FullCompanyDiagnosticData["valuation"]["fairValueChart"]>,
  period: _Period,
): NonNullable<FullCompanyDiagnosticData["valuation"]["fairValueChart"]> {
  if (period === "Max" || chart.points.length < 2) return chart;
  const lastDate = new Date(chart.points[chart.points.length - 1].date).getTime();
  const cutoff = lastDate - _PERIOD_DAYS[period] * 86400000;
  const filtered = chart.points.filter((p) => new Date(p.date).getTime() >= cutoff);
  // Need at least a handful of real points for a meaningful line — fall
  // back to the full series rather than rendering a near-empty chart.
  return filtered.length >= 4 ? { ...chart, points: filtered } : chart;
}

// Which period buttons are honest to offer, given the REAL span of this
// specific ticker's data — never show "5A" if there genuinely isn't 5
// years of real history for this company (e.g. a recent IPO).
function _availablePeriods(chart: NonNullable<FullCompanyDiagnosticData["valuation"]["fairValueChart"]> | null): _Period[] {
  if (!chart || chart.points.length < 2) return ["Max"];
  const spanDays = (new Date(chart.points[chart.points.length - 1].date).getTime() - new Date(chart.points[0].date).getTime()) / 86400000;
  const periods: _Period[] = [];
  (["1A", "3A", "5A"] as const).forEach((p) => {
    if (spanDays >= _PERIOD_DAYS[p] * 1.05) periods.push(p); // small margin so "1A" isn't offered for 370 real days of data
  });
  periods.push("Max");
  return periods;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "No disponible";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

type ScenarioKey = "conservative" | "base" | "optimistic";

const _SCENARIO_META: Record<ScenarioKey, { label: string; breakdownKey: "bear" | "base" | "bull" }> = {
  conservative: { label: "Conservador", breakdownKey: "bear" },
  base: { label: "Base", breakdownKey: "base" },
  optimistic: { label: "Optimista", breakdownKey: "bull" },
};

// What would need to happen for THIS scenario vs. Base, derived strictly
// from the real per-scenario EPS/fair-P/E numbers (scenarioBreakdown).
// Honest about what this explains: the RELATIVE difference between this
// scenario and Base (mathematically consistent — see reconciliation note
// above), never phrased as "this reproduces the headline value."
function scenarioRationale(
  breakdown: NonNullable<FullCompanyDiagnosticData["valuation"]["scenarioBreakdown"]>,
  key: "bear" | "base" | "bull",
): string | null {
  if (key === "base") {
    const b = breakdown.base;
    if (b.eps == null) return null;
    return `Parte de la ganancia por acción actual (${b.eps.toFixed(2)}) y un múltiplo justo de ${b.fair_pe.toFixed(1)}x como punto medio del modelo, combinados con una estimación independiente basada en flujo de caja — sin supuestos optimistas ni pesimistas adicionales.`;
  }
  const scen = breakdown[key];
  const base = breakdown.base;
  if (scen.eps == null || base.eps == null) return null;
  const epsDelta = ((scen.eps - base.eps) / base.eps) * 100;
  const peDelta = scen.fair_pe - base.fair_pe;
  const parts: string[] = [];
  if (Math.abs(epsDelta) > 0.5) {
    parts.push(`una ganancia por acción ${epsDelta >= 0 ? `${epsDelta.toFixed(0)}% mayor` : `${Math.abs(epsDelta).toFixed(0)}% menor`} que en el escenario base`);
  }
  if (Math.abs(peDelta) > 0.1) {
    parts.push(`un múltiplo justo ${peDelta >= 0 ? `${peDelta.toFixed(1)} puntos más alto` : `${Math.abs(peDelta).toFixed(1)} puntos más bajo`}`);
  }
  if (parts.length === 0) return null;
  return `Para justificar este valor, tendría que materializarse ${parts.join(" y ")} frente al escenario base.`;
}

function scenarioDelta(
  breakdown: NonNullable<FullCompanyDiagnosticData["valuation"]["scenarioBreakdown"]>,
  key: "bear" | "bull",
): { epsDeltaPct: number | null; peDelta: number | null; scen: { eps: number | null; fair_pe: number }; base: { eps: number | null; fair_pe: number } } | null {
  const scen = breakdown[key];
  const base = breakdown.base;
  if (scen.eps == null || base.eps == null) return null;
  return {
    epsDeltaPct: ((scen.eps - base.eps) / base.eps) * 100,
    peDelta: scen.fair_pe - base.fair_pe,
    scen: { eps: scen.eps, fair_pe: scen.fair_pe },
    base: { eps: base.eps, fair_pe: base.fair_pe },
  };
}

// ── 1. ¿CUÁNTO PODRÍA VALER? — hero + escenarios FUSIONADOS en una sola
// composición compacta (Diego: "fusionar esa experiencia", "evita grandes
// espacios vacíos"). El número protagonista es dorado (nunca rojo); el
// veredicto sobre/infravalorada es un detalle discreto, no el elemento
// dominante.
function ValueExplorer({
  data, selected, onSelect, selectedValue,
}: { data: FullCompanyDiagnosticData; selected: ScenarioKey; onSelect: (k: ScenarioKey) => void; selectedValue: number | null }) {
  const { currentPrice, conservative, baseFairValue, optimistic } = data.valuation;
  const valuationAsOf = data.valuationAsOf;
  const values: Record<ScenarioKey, number | null> = { conservative, base: baseFairValue, optimistic };
  const status = selectedValue != null ? _valuationStatus(selectedValue, currentPrice) : null;
  const verdictColor = status ? _VERDICT_COLOR[status.verdict] : "var(--sub)";
  const verdictLabel =
    status?.verdict === "overvalued" ? `${Math.abs(status.pct).toFixed(0)}% sobrevalorada` :
    status?.verdict === "undervalued" ? `${Math.abs(status.pct).toFixed(0)}% infravalorada` :
    status ? "Valor razonable" : null;

  return (
    <div className="rounded-[28px] p-5 md:p-7" style={{ background: "linear-gradient(135deg, rgba(212,162,76,0.06) 0%, var(--card) 60%)", border: "1px solid var(--border)" }}>
      <p className="text-[19px] md:text-[23px] leading-tight font-black tracking-tight mb-4" style={{ color: "var(--text)" }}>
        ¿Cuánto podría valer {data.companyName}?
      </p>

      {/* Números protagonistas + veredicto discreto, todo en una fila */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 mb-5">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: "var(--sub)" }}>Precio actual</p>
          <p className="text-[30px] md:text-[38px] leading-none font-black tabular-nums" style={{ color: "var(--text)" }}>
            {currentPrice != null ? fmtPrice(currentPrice) : "No disponible"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: "var(--sub)" }}>
            Valor estimado — {_SCENARIO_META[selected].label}
          </p>
          {/* Siempre dorado — nunca rojo — para el valor intrínseco mismo. */}
          <p className="text-[30px] md:text-[38px] leading-none font-black tabular-nums" style={{ color: GOLD }}>
            {selectedValue != null ? fmtPrice(selectedValue) : "No disponible"}
          </p>
        </div>
        {verdictLabel && (
          <div className="pb-1">
            <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full" style={{ color: verdictColor, background: `${verdictColor}18` }}>
              {verdictLabel}
            </span>
          </div>
        )}
      </div>

      {/* Selector de escenarios — pills horizontales compactas, no tarjetas apiladas */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {(Object.keys(_SCENARIO_META) as ScenarioKey[]).map((key) => {
          const value = values[key];
          const isSelected = key === selected;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              disabled={value == null}
              className="rounded-2xl py-2.5 px-3 text-center transition-all duration-200 min-h-[52px]"
              style={{
                background: isSelected ? `${GOLD}1f` : "var(--raised)",
                border: `1px solid ${isSelected ? `${GOLD}aa` : "var(--border)"}`,
                transform: isSelected ? "scale(1.03)" : "scale(1)",
                boxShadow: isSelected ? `0 6px 18px ${GOLD}22` : "none",
                opacity: value == null ? 0.5 : 1,
                cursor: value == null ? "default" : "pointer",
              }}
            >
              <p className="text-[10.5px] font-extrabold uppercase tracking-wide mb-0.5" style={{ color: isSelected ? GOLD : "var(--sub)" }}>
                {_SCENARIO_META[key].label}
              </p>
              <p className="text-[15px] font-black tabular-nums" style={{ color: isSelected ? GOLD : "var(--text)" }}>
                {value != null ? fmtPrice(value) : "—"}
              </p>
            </button>
          );
        })}
      </div>

      <p className="text-[12px] leading-[18px]" style={{ color: "var(--sub)" }}>
        El precio es lo que el mercado paga hoy; el valor estimado es lo que el modelo de Nuvos calcula que podría
        valer el negocio. No es una recomendación de compra o venta.
      </p>
      <p className="text-[10px] mt-1.5" style={{ color: "var(--dim)" }}>
        {valuationAsOf ? `Cálculo del modelo: ${valuationAsOf}.` : "El precio corresponde a una cotización de mercado con fecha verificable en la fuente."}
      </p>
    </div>
  );
}

// ── 2. ¿POR QUÉ ESTIMAMOS ESTE VALOR? — comprimido a 2 niveles ─────────
// Nivel inicial: valor + 2-3 factores reales + explicación de máx. 2
// oraciones + diferencia vs. base, todo en un solo bloque compacto (ya no
// 3 niveles separados). Nivel avanzado: "ver cómo llegamos a este valor".
function WhyThisValue({
  data, selected,
}: { data: FullCompanyDiagnosticData; selected: ScenarioKey }) {
  const [showCalc, setShowCalc] = useState(false);
  const breakdown = data.valuation.scenarioBreakdown;
  const wacc = data.valuation.waccDetails;
  const fairPe = data.valuation.fairPeBreakdown;
  const scenKey = _SCENARIO_META[selected].breakdownKey;
  const scenData = breakdown?.[scenKey];
  const hasDcfDetail = breakdown != null && scenData?.eps != null;

  const level1 = hasDcfDetail
    ? scenarioRationale(breakdown!, scenKey) ?? `Combina una estimación basada en ganancias con una estimación independiente basada en flujo de caja, ponderadas por su confianza relativa.`
    : `Nuvos usa un modelo distinto para empresas del sector financiero: estima cuánto vale el capital propio del banco a partir de su rentabilidad sobre ese capital (ROE) frente a su costo, en vez de proyectar flujo de caja libre. Los supuestos detallados de ese modelo específico todavía no están disponibles en esta vista.`;

  const factors: { label: string; value: string; icon: _Glyph; color: string }[] = [];
  if (hasDcfDetail && scenData) {
    factors.push({ label: "Ganancia por acción usada", value: `$${scenData.eps!.toFixed(2)}`, icon: TrendingUp, color: "#2dd4bf" });
    factors.push({ label: "Múltiplo justo aplicado", value: `${scenData.fair_pe.toFixed(1)}x`, icon: Scale, color: "#a78bfa" });
    if (wacc?.wacc_pct != null) factors.push({ label: "Tasa de descuento (WACC)", value: `${wacc.wacc_pct.toFixed(1)}%`, icon: Shield, color: GOLD });
  }

  // Real final value for the selected scenario (never recomputed — straight
  // from `data`), and the real earnings-track-only number (eps × fair_pe,
  // the honest pre-blend component) for the FlowCombo below.
  const finalValues: Record<ScenarioKey, number | null> = {
    conservative: data.valuation.conservative, base: data.valuation.baseFairValue, optimistic: data.valuation.optimistic,
  };
  const finalValue = finalValues[selected];
  const earningsTrackValue = hasDcfDetail && scenData ? scenData.eps! * scenData.fair_pe : null;

  // 2026-11-12 — real dual-track components (earnings track + FCF track +
  // their weights) only ever describe the BASE scenario's blend (that's
  // the only scenario the shadow dual-track engine actually computes —
  // bear/bull are scaled off it by a fixed ratio, see dual_track_blend_
  // engine.py). Showing it for conservative/optimistic would misattribute
  // base-scenario weights to a different number, so it only renders when
  // `selected === "base"`. Absent for any ticker/snapshot that predates
  // this field or whose dual-track blend didn't run (REIT, legacy-engine,
  // no FCF track) — the existing "No visible aquí" fallback stays exactly
  // as it was for every one of those cases, nothing is invented.
  const dualTrack = data.valuation.dualTrack;
  const hasRealFcfTrack =
    selected === "base" &&
    dualTrack != null &&
    dualTrack.fcf_track_value != null &&
    dualTrack.earnings_track_weight_pct != null &&
    dualTrack.fcf_track_weight_pct != null;

  return (
    <div className="mb-5 rounded-[24px] p-5 md:p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <p className="text-[16px] font-black tracking-tight mb-2.5" style={{ color: "var(--text)" }}>¿Por qué estimamos este valor?</p>
      <p className="text-[12.5px] leading-[19px] mb-4" style={{ color: "var(--sub)" }}>{level1}</p>

      {factors.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-2.5 mb-3">
          {factors.map((f) => (
            <div key={f.label} className="rounded-xl p-3" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2 mb-1.5"><IconBadge icon={f.icon} color={f.color} /></div>
              <p className="text-[9px] uppercase tracking-wide font-bold mb-0.5" style={{ color: "var(--sub)" }}>{f.label}</p>
              <p className="text-[18px] font-black tabular-nums" style={{ color: "var(--text)" }}>{f.value}</p>
            </div>
          ))}
        </div>
      )}

      {hasDcfDetail && (
        <>
          <button
            onClick={() => setShowCalc((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-bold min-h-[32px]"
            style={{ color: GOLD }}
          >
            Ver cómo llegamos a este valor
            {showCalc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showCalc && (
            <div className="mt-3 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
              <SimpleIntro>
                no es solo "ganancia × múltiplo" — Nuvos combina ese enfoque con una segunda estimación
                independiente, basada en flujo de caja, y pondera ambas según su confiabilidad para esta empresa.
              </SimpleIntro>
              {earningsTrackValue != null && finalValue != null && (
                <div className="mb-3">
                  <FlowCombo
                    steps={[
                      <FlowStep
                        key="eps"
                        icon={TrendingUp}
                        color="#2dd4bf"
                        label="Enfoque de ganancias"
                        value={fmtPrice(hasRealFcfTrack ? dualTrack!.earnings_track_value! : earningsTrackValue)}
                        sublabel={
                          hasRealFcfTrack
                            ? `peso ${dualTrack!.earnings_track_weight_pct!.toFixed(0)}% · $${scenData!.eps!.toFixed(2)} × ${scenData!.fair_pe.toFixed(1)}x`
                            : `$${scenData!.eps!.toFixed(2)} × ${scenData!.fair_pe.toFixed(1)}x`
                        }
                      />,
                      hasRealFcfTrack ? (
                        <FlowStep
                          key="fcf"
                          icon={TrendingUp}
                          color="#a78bfa"
                          label="Enfoque de flujo de caja"
                          value={fmtPrice(dualTrack!.fcf_track_value!)}
                          sublabel={`peso ${dualTrack!.fcf_track_weight_pct!.toFixed(0)}% · estimación independiente`}
                        />
                      ) : (
                        <FlowStep key="fcf" icon={EyeOff} color="var(--dim)" label="Enfoque de flujo de caja" value="No visible aquí" sublabel="estimación independiente" muted />
                      ),
                    ]}
                    result={<FlowStep icon={Shield} color={GOLD} label="Valor combinado (real)" value={fmtPrice(finalValue)} />}
                  />
                  {!hasRealFcfTrack && (
                    <p className="text-[10px] mt-2" style={{ color: "var(--dim)" }}>
                      El detalle del enfoque de flujo de caja todavía no está disponible para este cálculo específico —
                      el valor combinado de arriba sí es real, pero sus dos componentes por separado no se guardaron en este cómputo.
                    </p>
                  )}
                </div>
              )}
              <DetailGrid>
                <DetailRow label="Ganancia por acción (EPS)" value={`$${scenData!.eps!.toFixed(2)}`} />
                {fairPe?.primary_anchor && <DetailRow label="Ancla del múltiplo justo" value={fairPe.primary_anchor} />}
              </DetailGrid>
              <p className="text-[10px] mt-2" style={{ color: "var(--dim)" }}>
                El EPS puede estar normalizado por el modelo cuando hubo eventos puntuales que distorsionan el año.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Comparación de escenarios — grid compacto reemplaza los párrafos largos ──
function ScenarioComparison({ data }: { data: FullCompanyDiagnosticData }) {
  const breakdown = data.valuation.scenarioBreakdown;
  if (!breakdown) return null;
  const rows: { key: ScenarioKey; bKey: "bear" | "base" | "bull" }[] = [
    { key: "conservative", bKey: "bear" },
    { key: "base", bKey: "base" },
    { key: "optimistic", bKey: "bull" },
  ];
  const up = scenarioDelta(breakdown, "bull");
  const down = scenarioDelta(breakdown, "bear");

  return (
    <div className="mb-5 rounded-[24px] p-5 md:p-7" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <p className="text-[16px] font-black tracking-tight mb-3" style={{ color: "var(--text)" }}>¿Qué limita esta valoración?</p>
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-[12px] border-collapse min-w-[460px]">
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th className="text-left font-bold py-2 pr-2" style={{ color: "var(--sub)" }}>Escenario</th>
              <th className="text-right font-bold py-2 px-2" style={{ color: "var(--sub)" }}>Ganancias usadas</th>
              <th className="text-right font-bold py-2 px-2" style={{ color: "var(--sub)" }}>Múltiplo</th>
              <th className="text-right font-bold py-2 pl-2" style={{ color: "var(--sub)" }}>Valor estimado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = breakdown[r.bKey];
              return (
                <tr key={r.key} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="py-2 pr-2 font-bold" style={{ color: "var(--text)" }}>{_SCENARIO_META[r.key].label}</td>
                  <td className="text-right py-2 px-2 tabular-nums" style={{ color: "var(--sub)" }}>{d.eps != null ? `$${d.eps.toFixed(2)}` : "—"}</td>
                  <td className="text-right py-2 px-2 tabular-nums" style={{ color: "var(--sub)" }}>{d.fair_pe != null ? `${d.fair_pe.toFixed(1)}x` : "—"}</td>
                  <td className="text-right py-2 pl-2 font-bold tabular-nums" style={{ color: GOLD }}>{d.fair_value_per_share != null ? fmtPrice(d.fair_value_per_share) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-4">
        {up && (
          <p className="text-[12px] leading-[18px]" style={{ color: "var(--sub)" }}>
            <strong style={{ color: "#22c55e" }}>¿Qué tendría que mejorar?</strong> Una ganancia por acción o un
            múltiplo mayores a los del escenario base, en la magnitud que ya se ve en la fila «Optimista» de la tabla.
          </p>
        )}
        {down && (
          <p className="text-[12px] leading-[18px]" style={{ color: "var(--sub)" }}>
            <strong style={{ color: "#ef4444" }}>¿Qué podría reducirla?</strong> Lo contrario — una ganancia por
            acción o un múltiplo menores, como en la fila «Conservador».
          </p>
        )}
      </div>
      <p className="text-[10px] mt-3" style={{ color: "var(--dim)" }}>
        Estas diferencias separan los tres escenarios en el modelo — no son una predicción de que vayan a ocurrir.
      </p>
    </div>
  );
}

const _BUCKET_LABEL_ES: Record<"cheap" | "normal" | "expensive", string> = {
  cheap: "barata",
  normal: "en un rango habitual",
  expensive: "cara",
};

// ── SECCIÓN 3 — gráfica histórica, ahora genuinamente protagonista ──────
// Diego: "mucho más alta y ancha", "más aire", "menos texto antes de
// verla", lenguaje simple, 3 chips de resumen rápido, selector de
// período honesto, 3 bullets cortos debajo en vez de un párrafo largo.
function HistoricalChartSection({ data, t, lang }: { data: FullCompanyDiagnosticData; t: (k: string, o?: Record<string, unknown>) => string; lang: string }) {
  const ctx = data.valuation.priceHistoryContext;
  const chart = data.valuation.fairValueChart;
  const { currentPrice, baseFairValue } = data.valuation;
  const available = useMemo(() => _availablePeriods(chart), [chart]);
  const [period, setPeriod] = useState<_Period>("Max");

  if (!ctx) {
    return (
      <div className="mb-5 rounded-[28px] p-6 md:p-9" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <p className="text-[19px] md:text-[23px] font-black tracking-tight mb-2" style={{ color: "var(--text)" }}>
          ¿Cómo se ha movido el precio frente a su valor estimado?
        </p>
        <p className="text-[12.5px] italic" style={{ color: "var(--sub)" }}>
          No hay suficiente profundidad de precio histórico disponible para esta empresa todavía.
        </p>
      </div>
    );
  }

  const status = baseFairValue != null ? _valuationStatus(baseFairValue, currentPrice) : null;
  const todayChip = status
    ? status.verdict === "fair"
      ? "Cerca de nuestro valor estimado base"
      : `${Math.abs(status.pct).toFixed(0)}% ${status.verdict === "overvalued" ? "por encima" : "por debajo"} del valor estimado base`
    : "No disponible";
  // 2026-11-12 — Diego's point 5: verified against price_history_context_
  // service.py (read-only) that `todayBucket` is NOT a nominal-price
  // comparison — it ranks TODAY's real P/E (price ÷ real trailing-twelve-
  // month EPS) against the real rolling distribution of this ticker's OWN
  // daily P/E over its own recent history. That's a financially valid,
  // earnings-aware metric, so it stays visible (Diego's instruction was to
  // hide it only if it couldn't be verified as valid). The prior copy said
  // "frente a su propio historial de precio" ("vs. its own price history"),
  // which was the actual problem: it implied a raw-price comparison,
  // inviting a false "contradiction" reading against the intrinsic-value
  // verdict above. Corrected to name the real metric (P/E), and this is
  // NOT a contradiction with the hero verdict even when the two disagree —
  // they answer different questions on different reference frames: this
  // chip ranks today's multiple against the company's OWN recent multiple
  // history (a relative, earnings-aware comparison), while the hero
  // compares price against an absolute DCF/earnings-blend intrinsic
  // estimate. A stock can legitimately look "cheap" vs. its own recent
  // P/E range while still being "overvalued" vs. intrinsic value — e.g.
  // after a broad market re-rating that lifted the whole historical band,
  // or when the DCF anchor has moved for reasons the trailing P/E range
  // hasn't caught up to yet. See the explanatory line rendered below.
  const historyChip = `Hoy luce ${_BUCKET_LABEL_ES[ctx.todayBucket]} frente a su propio historial de múltiplo de ganancias (P/E)`;
  const yearsSpan = chart && chart.points.length > 1
    ? Math.round(((new Date(chart.points[chart.points.length - 1].date).getTime() - new Date(chart.points[0].date).getTime()) / 86400000 / 365) * 10) / 10
    : null;
  const periodChip = period === "Max"
    ? (yearsSpan ? `Analizando ${yearsSpan} años de precio real` : "Período completo disponible")
    : `Mostrando los últimos ${_PERIOD_LABEL[period]}`;

  const filteredChart = chart ? _filterChartByPeriod(chart, period) : null;
  const historyTabData: FullCompanyDiagnosticData = filteredChart
    ? { ...data, valuation: { ...data.valuation, fairValueChart: filteredChart } }
    : data;

  return (
    <div className="mb-5 rounded-[28px] p-6 md:p-10" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {/* Bloque 1 — encabezado breve, lenguaje simple */}
      <p className="text-[19px] md:text-[25px] font-black tracking-tight mb-1.5" style={{ color: "var(--text)" }}>
        ¿Cómo se ha movido el precio frente a su valor estimado?
      </p>
      <p className="text-[12.5px] md:text-[13px] mb-6" style={{ color: "var(--sub)" }}>
        Compara el precio real de la acción con la estimación histórica de valor de Nuvos.
      </p>

      {/* Bloque 2 — resumen rápido, 3 chips, todo de datos reales */}
      <div className="grid sm:grid-cols-3 gap-2.5 mb-7">
        <div className="rounded-2xl px-4 py-3" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <p className="text-[9.5px] uppercase tracking-wide font-bold mb-1" style={{ color: "var(--dim)" }}>Hoy</p>
          <p className="text-[13px] font-bold leading-[18px]" style={{ color: status ? _VERDICT_COLOR[status.verdict] : "var(--text)" }}>{todayChip}</p>
        </div>
        <div className="rounded-2xl px-4 py-3" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <p className="text-[9.5px] uppercase tracking-wide font-bold mb-1" style={{ color: "var(--dim)" }}>Históricamente</p>
          <p className="text-[13px] font-bold leading-[18px]" style={{ color: "var(--text)" }}>{historyChip}</p>
        </div>
        <div className="rounded-2xl px-4 py-3" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <p className="text-[9.5px] uppercase tracking-wide font-bold mb-1" style={{ color: "var(--dim)" }}>Período</p>
          <p className="text-[13px] font-bold leading-[18px]" style={{ color: "var(--text)" }}>{periodChip}</p>
        </div>
      </div>

      {/* Diego's point 5 — only shown when the two real signals actually
          disagree (e.g. "overvalued" vs. intrinsic value but "cheap" vs.
          its own P/E history, or the reverse), so readers never have to
          wonder on their own whether that's a mistake. */}
      {status && status.verdict !== "fair" && (ctx.todayBucket === "cheap" || ctx.todayBucket === "expensive") &&
        ((status.verdict === "overvalued" && ctx.todayBucket === "cheap") ||
          (status.verdict === "undervalued" && ctx.todayBucket === "expensive")) && (
          <p className="text-[11px] leading-[16px] mb-6 px-3.5 py-2.5 rounded-xl" style={{ color: "var(--sub)", background: "var(--raised)", border: "1px solid var(--border)" }}>
            <strong style={{ color: "var(--text)" }}>Esto no es una contradicción —</strong> son dos preguntas distintas.
            Arriba comparamos el precio con una estimación de valor intrínseco (DCF/ganancias); aquí comparamos el
            múltiplo de ganancias de hoy con el rango reciente propio de {data.companyName}. Pueden apuntar en
            direcciones distintas, por ejemplo si el múltiplo de todo el mercado subió, o si el valor intrínseco
            cambió por razones que el rango histórico de múltiplo todavía no refleja.
          </p>
        )}

      {/* Selector de período — honesto: solo ofrece rangos que la empresa
          realmente tiene en su historial real (ver _availablePeriods). */}
      {available.length > 1 && (
        <div className="flex gap-1.5 mb-4">
          {available.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="rounded-full px-3.5 py-1.5 text-[11px] font-extrabold transition-colors"
              style={{
                background: period === p ? GOLD : "var(--raised)",
                color: period === p ? "#1a1408" : "var(--sub)",
                border: `1px solid ${period === p ? GOLD : "var(--border)"}`,
              }}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Bloque 3 — gráfica hero, grande, protagonista */}
      <div className="mt-2">
        <HistoryTab data={historyTabData} t={t} lang={lang} />
      </div>

      {/* Bloque 4 — 3 bullets cortos, no un párrafo largo */}
      <div className="grid sm:grid-cols-3 gap-3 mt-6 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
        <p className="text-[11.5px] leading-[17px]" style={{ color: "var(--sub)" }}>
          <strong style={{ color: "var(--text)" }}>Línea sólida —</strong> el precio real de la acción, día a día.
        </p>
        <p className="text-[11.5px] leading-[17px]" style={{ color: "var(--sub)" }}>
          <strong style={{ color: GOLD }}>Línea punteada —</strong> una referencia histórica estimada de lo que Nuvos
          cree que valía el negocio en cada momento.
        </p>
        <p className="text-[11.5px] leading-[17px]" style={{ color: "var(--sub)" }}>
          <strong style={{ color: "var(--text)" }}>Importante —</strong> esa línea es una reconstrucción con los
          supuestos de hoy, no una predicción ni un valor calculado día por día en el pasado.
        </p>
      </div>
    </div>
  );
}

function ReverseDcfSection() {
  return (
    <div className="mb-5 rounded-[24px] p-5 md:p-7" style={{ background: "var(--card)", border: "1px dashed var(--border)" }}>
      <p className="text-[16px] font-black tracking-tight mb-2" style={{ color: "var(--text)" }}>¿Qué tendría que pasar para justificar el precio de hoy?</p>
      <p className="text-[12px] leading-[18px]" style={{ color: "var(--sub)" }}>
        Nuvos sí tiene un modelo real para responder esta pregunta (una «valoración inversa» que resuelve qué
        crecimiento o margen harían que el valor estimado coincidiera con el precio actual, manteniendo todo lo demás
        constante), pero ese cálculo todavía no está conectado a esta vista específica. Preferimos no mostrar una
        aproximación improvisada — esta sección estará disponible una vez quede conectada de forma verificable.
      </p>
    </div>
  );
}

// Shared primitives for everything inside a "Ver detalle" panel — Diego,
// round 6: "que la información esté organizada mucho mejor... fácil de
// leer, entender, seguir" in every expand/detail section. One consistent
// label:value row pattern + one consistent short-note pattern, reused
// across the WACC/FCF/Fair-P/E detail panels, the "ver cómo llegamos a
// este valor" advanced explanation, and the methodology accordion —
// instead of ad-hoc stacks of same-styled <p> paragraphs.
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-[10.5px] leading-[14px]" style={{ color: "var(--sub)" }}>{label}</span>
      <span className="text-[12px] font-bold tabular-nums text-right shrink-0" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0">{children}</div>;
}

// A short, clearly-separated note below the label:value rows — for a
// methodology caveat, adjustment list, or limitation, never blended into
// the rows themselves. Dividers go BETWEEN notes (via DetailNoteGroup),
// not before the first one inside an already-bordered container.
function DetailNote({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div>
      {title && <p className="text-[9px] uppercase tracking-wide font-extrabold mb-1" style={{ color: "var(--dim)" }}>{title}</p>}
      <div className="text-[10.5px] leading-[16px]" style={{ color: "var(--sub)" }}>{children}</div>
    </div>
  );
}

// Stacks several DetailNotes with one divider BETWEEN each (never a
// doubled-up border against the container's own top divider).
function DetailNoteGroup({ children }: { children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {items.map((child, i) => (
        <div key={i} className={i > 0 ? "pt-2.5" : undefined} style={i > 0 ? { borderTop: "1px dashed var(--border)" } : undefined}>
          {child}
        </div>
      ))}
    </div>
  );
}

// Round 7 — Diego: "MEJORALO MÁS AUN... TIENE QUE SER SUMAMENTE SENCILLO...
// ESO SE LOGRA HACIENDO LO VISUAL EXTREMADAMENTE ATRACTIVO". Label:value
// rows alone still read as "a list of facts" — a beginner needs the
// numbers to visually TEACH their relationship, not just sit next to each
// other. New real-data-only visual techniques, reused consistently across
// every "Ver detalle" panel below:
//   - IconBadge: a concept gets a consistent icon+color (risk=Shield/gold,
//     cash=Wallet/teal, multiple=Scale/purple) so a reader recognizes the
//     TYPE of number before reading it, every time.
//   - SplitBar: a real two-part percentage split (equity vs. debt weight)
//     rendered as a literal two-color bar — makes a weighted-average
//     formula visually obvious instead of two separate numbers you have
//     to multiply in your head.
//   - RangeBar: Fair P/E's real [band_low, band_high] range with the real
//     fair_pe plotted as a marker inside it — shows AT A GLANCE whether
//     the multiple used sits low/mid/high in the band Nuvos considers
//     reasonable, using only numbers already in fairPeBreakdown.
//   - FlowCombo: a real "A + B = C" visual build-up. Used for WACC's own
//     real weighted-average formula (equity_weight% × cost_of_equity% +
//     debt_weight% × cost_of_debt% ≈ WACC%, the literal real computation,
//     not a metaphor) AND for the earnings-vs-cash-flow blend explainer
//     (where the SECOND input genuinely isn't exposed by the backend to
//     this screen — rendered with an explicit EyeOff icon and "no visible
//     aquí" label, never a fabricated number, so the visual honestly shows
//     "two real things combine" without pretending to know the second one).
// Nothing here changes what data exists — every value plotted is read
// straight from `data`, same as every prior round.

type _Glyph = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

function IconBadge({ icon: Icon, color }: { icon: _Glyph; color: string }) {
  return (
    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}22` }}>
      <Icon className="w-4 h-4" style={{ color }} />
    </div>
  );
}

// Two real percentages as one literal bar — e.g. capital vs. deuda weight.
function SplitBar({
  aLabel, aPct, aColor, bLabel, bPct, bColor,
}: { aLabel: string; aPct: number; aColor: string; bLabel: string; bPct: number; bColor: string }) {
  return (
    <div className="mb-1">
      <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: "var(--border)" }}>
        <div style={{ width: `${aPct}%`, background: aColor }} />
        <div style={{ width: `${bPct}%`, background: bColor }} />
      </div>
      <div className="flex justify-between mt-1 text-[10px] font-bold">
        <span style={{ color: aColor }}>{aLabel} {aPct.toFixed(0)}%</span>
        <span style={{ color: bColor }}>{bLabel} {bPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}

// A real [low, high] band with the real chosen value marked inside it —
// instantly shows where in the "reasonable" range the model landed.
function RangeBar({ low, high, value }: { low: number; high: number; value: number }) {
  const span = high - low;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((value - low) / span) * 100)) : 50;
  return (
    <div className="mb-1">
      <div className="relative h-2.5 rounded-full" style={{ background: "var(--border)" }}>
        <div
          className="absolute top-1/2 w-3.5 h-3.5 rounded-full -translate-y-1/2 -translate-x-1/2 border-2"
          style={{ left: `${pct}%`, background: GOLD, borderColor: "var(--card)" }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[9.5px] font-bold" style={{ color: "var(--sub)" }}>
        <span>{low.toFixed(1)}x</span>
        <span style={{ color: GOLD }}>{value.toFixed(1)}x usado</span>
        <span>{high.toFixed(1)}x</span>
      </div>
    </div>
  );
}

function FlowStep({
  icon, color, label, value, sublabel, muted,
}: { icon: _Glyph; color: string; label: string; value: string; sublabel?: string; muted?: boolean }) {
  return (
    <div className="flex-1 min-w-[120px] rounded-xl p-3 text-center" style={{ background: "var(--raised)", border: `1px solid ${muted ? "var(--border)" : `${color}55`}` }}>
      <div className="flex justify-center mb-1.5"><IconBadge icon={icon} color={color} /></div>
      <p className="text-[9px] uppercase tracking-wide font-extrabold mb-1" style={{ color: "var(--sub)" }}>{label}</p>
      <p className="text-[15px] font-black tabular-nums" style={{ color: muted ? "var(--dim)" : "var(--text)" }}>{value}</p>
      {sublabel && <p className="text-[9px] mt-0.5" style={{ color: "var(--dim)" }}>{sublabel}</p>}
    </div>
  );
}

// A real "A + B = C" visual build-up. `result` is always the true final
// number (never recomputed/approximated here) — the steps before it are
// genuine contributing inputs, explicitly marked `muted` + EyeOff when a
// real second input exists but isn't exposed to this screen.
function FlowCombo({ steps, result }: { steps: React.ReactNode[]; result: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {s}
          <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--dim)" }} />
        </div>
      ))}
      <span className="text-[16px] font-black shrink-0" style={{ color: "var(--dim)" }}>≈</span>
      {result}
    </div>
  );
}

function SimpleIntro({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11.5px] leading-[17px] mb-3 px-3 py-2 rounded-lg" style={{ color: "var(--text)", background: `${GOLD}14`, borderLeft: `3px solid ${GOLD}` }}>
      <strong style={{ color: GOLD }}>En términos simples: </strong>{children}
    </p>
  );
}

function StatTile({
  label, technicalTerm, value, explanation, detail, icon, color = GOLD,
}: { label: string; technicalTerm?: string; value: string; explanation: string; detail?: React.ReactNode; icon: _Glyph; color?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
      <div className="flex items-start gap-2.5 mb-2">
        <IconBadge icon={icon} color={color} />
        <div className="min-w-0">
          <p className="text-[11px] font-bold leading-[14px]" style={{ color: "var(--text)" }}>{label}</p>
          {technicalTerm && (
            <p className="text-[8.5px] uppercase tracking-wide font-bold mt-0.5" style={{ color: "var(--dim)" }}>{technicalTerm}</p>
          )}
        </div>
      </div>
      <p className="text-[26px] font-black tabular-nums mb-1 leading-none" style={{ color }}>{value}</p>
      <p className="text-[10.5px] leading-[15px]" style={{ color: "var(--sub)" }}>{explanation}</p>
      {detail && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 mt-2.5 text-[10.5px] font-bold min-h-[32px]"
            style={{ color: GOLD }}
          >
            {open ? "Ocultar detalle" : "Ver detalle"}
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {open && <div className="mt-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>{detail}</div>}
        </>
      )}
    </div>
  );
}

function FundamentalsRow({ data }: { data: FullCompanyDiagnosticData }) {
  const wacc = data.valuation.waccDetails;
  const fcf = data.valuation.fcfAssumptions;
  const fairPe = data.valuation.fairPeBreakdown;

  const tiles: React.ReactNode[] = [];

  const TEAL = "#2dd4bf";
  const PURPLE = "#a78bfa";

  if (wacc?.wacc_pct != null) {
    const hasSplit = wacc.equity_weight_pct != null && wacc.debt_weight_pct != null;
    const hasFormula = hasSplit && wacc.cost_of_equity_pct != null && wacc.cost_of_debt_pct != null;
    tiles.push(
      <StatTile
        key="wacc"
        icon={Shield}
        color={GOLD}
        label="¿Qué tan riesgoso consideramos este negocio?"
        technicalTerm="Tasa de descuento (WACC)"
        value={`${wacc.wacc_pct.toFixed(1)}%`}
        explanation="El retorno mínimo que el modelo exige antes de considerar valiosas las ganancias futuras."
        detail={
          <>
            <SimpleIntro>
              mientras más alto este número, más duda el modelo de las ganancias futuras — y más le resta al valor
              presente de la empresa.
            </SimpleIntro>
            {hasSplit && (
              <div className="mb-3">
                <p className="text-[9px] uppercase tracking-wide font-extrabold mb-1.5" style={{ color: "var(--dim)" }}>Cómo se financia el negocio</p>
                <SplitBar aLabel="Capital propio" aPct={wacc.equity_weight_pct!} aColor={GOLD} bLabel="Deuda" bPct={wacc.debt_weight_pct!} bColor="#64748b" />
              </div>
            )}
            {hasFormula && (
              <div className="mb-3">
                <p className="text-[9px] uppercase tracking-wide font-extrabold mb-1.5" style={{ color: "var(--dim)" }}>Cómo se arma el {wacc.wacc_pct.toFixed(1)}%</p>
                <FlowCombo
                  steps={[
                    <FlowStep key="eq" icon={Shield} color={GOLD} label="Capital propio" value={`${wacc.cost_of_equity_pct!.toFixed(1)}%`} sublabel={`× ${wacc.equity_weight_pct!.toFixed(0)}% del total`} />,
                    <FlowStep key="debt" icon={Shield} color="#64748b" label="Deuda" value={`${wacc.cost_of_debt_pct!.toFixed(1)}%`} sublabel={`× ${wacc.debt_weight_pct!.toFixed(0)}% del total`} />,
                  ]}
                  result={<FlowStep icon={Shield} color={GOLD} label="WACC" value={`${wacc.wacc_pct.toFixed(1)}%`} />}
                />
                <p className="text-[9px] mt-1.5" style={{ color: "var(--dim)" }}>Promedio ponderado de ambos costos — puede incluir un ajuste fiscal menor sobre el costo de la deuda.</p>
              </div>
            )}
            <DetailGrid>
              <DetailRow label="Método" value={wacc.method} />
              {wacc.beta != null && <DetailRow label="Beta (sensibilidad al mercado)" value={wacc.beta.toFixed(2)} />}
              {wacc.risk_free_rate_pct != null && <DetailRow label="Tasa libre de riesgo" value={`${wacc.risk_free_rate_pct.toFixed(2)}%`} />}
            </DetailGrid>
          </>
        }
      />,
    );
  }

  if (fcf?.fcf_normalized != null) {
    const reportedM = fcf.fcf_reported != null ? Math.round(fcf.fcf_reported / 1e6) : null;
    const normalizedM = Math.round(fcf.fcf_normalized / 1e6);
    const maxM = Math.max(Math.abs(reportedM ?? 0), Math.abs(normalizedM), 1);
    tiles.push(
      <StatTile
        key="fcf"
        icon={Wallet}
        color={TEAL}
        label="¿Cuánto dinero puede generar el negocio?"
        technicalTerm="Flujo de caja libre normalizado (FCF)"
        value={`$${normalizedM.toLocaleString("en-US")}M`}
        explanation="Efectivo que el modelo considera sostenible cada año, ajustado por eventos puntuales."
        detail={
          <>
            <SimpleIntro>
              es el dinero que le sobra al negocio después de pagar lo necesario para operar y crecer — lo que
              realmente queda disponible para los dueños de la empresa.
            </SimpleIntro>
            {reportedM != null && (
              <div className="mb-3 space-y-2">
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span style={{ color: "var(--sub)" }}>Reportado</span>
                    <span style={{ color: "var(--text)" }}>${reportedM.toLocaleString("en-US")}M</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(Math.abs(reportedM) / maxM) * 100}%`, background: "#64748b" }} />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span style={{ color: TEAL }}>Normalizado (usado en el modelo)</span>
                    <span style={{ color: TEAL }}>${normalizedM.toLocaleString("en-US")}M</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(Math.abs(normalizedM) / maxM) * 100}%`, background: TEAL }} />
                  </div>
                </div>
              </div>
            )}
            {fcf.methodology_note && <DetailNote title="Por qué difiere del normalizado">{fcf.methodology_note}</DetailNote>}
          </>
        }
      />,
    );
  }

  if (fairPe) {
    tiles.push(
      <StatTile
        key="fairpe"
        icon={Scale}
        color={PURPLE}
        label="¿Cuánto estamos valorando sus ganancias?"
        technicalTerm="Múltiplo justo (Fair P/E)"
        value={`${fairPe.fair_pe.toFixed(1)}x`}
        explanation={`Cada dólar de ganancias se valora en ${fairPe.fair_pe.toFixed(1)} dólares, principalmente a partir de ${fairPe.primary_anchor}.`}
        detail={
          <>
            <SimpleIntro>
              piensa en esto como el "precio por dólar de ganancias" que el modelo considera justo — ni el optimismo
              del mercado de hoy, ni un descuento exagerado.
            </SimpleIntro>
            <div className="mb-3">
              <p className="text-[9px] uppercase tracking-wide font-extrabold mb-1.5" style={{ color: "var(--dim)" }}>Dónde cae dentro del rango razonable</p>
              <RangeBar low={fairPe.band[0]} high={fairPe.band[1]} value={fairPe.fair_pe} />
            </div>
            {fairPe.adjustments?.length > 0 && (
              <div>
                <p className="text-[9px] uppercase tracking-wide font-extrabold mb-1.5" style={{ color: "var(--dim)" }}>Ajustes aplicados al múltiplo</p>
                <div className="space-y-1.5">
                  {fairPe.adjustments.map((a, i) => {
                    const up = a.points >= 0;
                    const AdjIcon = up ? TrendingUp : TrendingDown;
                    const adjColor = up ? "#22c55e" : "#ef4444";
                    return (
                      <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--card)" }}>
                        <AdjIcon className="w-3.5 h-3.5 shrink-0" style={{ color: adjColor }} />
                        <span className="flex-1 text-[10.5px] leading-[14px]" style={{ color: "var(--sub)" }}>
                          <strong style={{ color: "var(--text)" }}>{a.factor}</strong> — {a.reason}
                        </span>
                        <span className="font-black tabular-nums shrink-0 text-[11px]" style={{ color: adjColor }}>
                          {up ? "+" : ""}{a.points.toFixed(1)} pts
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        }
      />,
    );
  }

  if (tiles.length === 0) {
    return (
      <p className="text-[12px] italic" style={{ color: "var(--sub)" }}>
        Detalle de supuestos no disponible para esta empresa (posible motor sectorial distinto, ej. financiero).
      </p>
    );
  }

  return <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">{tiles}</div>;
}

export function ValuacionPreview({ data }: { data: FullCompanyDiagnosticData }) {
  const { t, i18n } = useTranslation();
  const { validationStatus, reviewReason, conservative, baseFairValue, optimistic } = data.valuation;
  const underReview = validationStatus === "under_review";

  const [selected, setSelected] = useState<ScenarioKey>("base");
  const values: Record<ScenarioKey, number | null> = { conservative, base: baseFairValue, optimistic };
  const selectedValue = values[selected];

  return (
    <div className="max-w-[1320px] mx-auto px-1 pb-14">
      <div className="rounded-xl px-3.5 py-2.5 mb-5 text-[11.5px] font-bold text-center" style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}>
        Vista previa interna — pestaña Valuación.
      </div>

      {/* ── Encabezado ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>
          {data.ticker} · {data.sector}
        </p>
        <TabNav active="valuacion" ticker={data.ticker} />
      </div>

      {underReview && (
        <div className="rounded-[14px] px-3.5 py-3 mb-5" style={{ background: "rgba(239,68,68,0.08)", borderLeft: "3px solid #ef4444" }}>
          <p className="text-[10px] font-extrabold uppercase mb-1" style={{ color: "#ef4444" }}>Valoración en revisión</p>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
            Estos números son reales y trazables, pero todavía no deben leerse como una conclusión validada.
            {reviewReason ? ` ${reviewReason}` : ""}
          </p>
        </div>
      )}

      {/* ── SECCIÓN 1 — ¿CUÁNTO PODRÍA VALER? (hero + escenarios fusionados) ── */}
      <div className="mb-5">
        <ValueExplorer data={data} selected={selected} onSelect={setSelected} selectedValue={selectedValue} />
      </div>

      {/* ── SECCIÓN 2 — ¿POR QUÉ ESTIMAMOS ESTE VALOR? + comparación ── */}
      <WhyThisValue data={data} selected={selected} />
      <ScenarioComparison data={data} />

      {/* ── SECCIÓN 3 — ¿CÓMO HA CAMBIADO SU VALORACIÓN? — gráfica, protagonista real ── */}
      <HistoricalChartSection data={data} t={t} lang={i18n.language} />

      {/* ── SECCIÓN 4 — ¿QUÉ TENDRÍA QUE PASAR PARA JUSTIFICAR EL PRECIO DE HOY? ── */}
      <ReverseDcfSection />

      {/* ── SECCIÓN 5 — ¿CÓMO LO CALCULAMOS? — variables fundamentales, segunda capa ── */}
      <div className="mb-5">
        <p className="text-[12px] font-extrabold uppercase tracking-wide mb-3" style={{ color: "var(--sub)" }}>Explorar los cálculos y supuestos</p>
        <FundamentalsRow data={data} />
      </div>
      <MethodologyAccordion />
    </div>
  );
}

function MethodologyAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl p-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between min-h-[44px]">
        <span className="text-[13px] font-extrabold" style={{ color: "var(--text)" }}>Metodología y limitaciones</span>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--muted)" }} />}
      </button>
      {open && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
          <DetailNoteGroup>
            <DetailNote title="Cómo se calculan los escenarios">
              Combinan una proyección basada en ganancias (ganancia por acción × múltiplo justo) con una estimación
              independiente de flujo de caja descontado a la tasa de descuento (WACC) mostrada arriba, ponderadas
              según qué tan confiable es cada enfoque para esta empresa.
            </DetailNote>
            <DetailNote title="Para empresas financieras">
              Nuvos usa un modelo distinto — ingreso residual sobre capital propio — en vez de flujo de caja libre,
              por ser más apropiado para ese tipo de negocio.
            </DetailNote>
            <DetailNote title="Lo que esto no es">
              Ninguna cifra en esta pantalla es una recomendación de comprar o vender. Son estimaciones que dependen
              de los supuestos mostrados arriba — cambiar esos supuestos cambiaría el resultado.
            </DetailNote>
          </DetailNoteGroup>
        </div>
      )}
    </div>
  );
}
