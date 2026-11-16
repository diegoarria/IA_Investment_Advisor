"use client";

// EntenderValuacionPreview — Nuvos Radar 2.0, Fase 5 of the 7-phase learning
// journey. Diego, 2026-11-15 ("ADAPTAR LA VALUACIÓN EXISTENTE", then split
// per his follow-up "separar 1 fase solo de valuación... y en otra fase
// completamente aparte poner los riesgos"): this phase is now a FOCUSED,
// valuation-only re-presentation of the already-complete, already-approved
// Valuación screen (ValuacionPreview.tsx) — price/value/scenarios, why the
// model estimates that value, and the real historical chart. The risk
// subset that used to live here was split out into its own phase
// (VigilarRiesgosPreview.tsx, Fase 6). No financial logic is re-derived
// here: every number below is read straight from the same
// `FullCompanyDiagnosticData` object Valuación already consumes, via the
// same real `companyDiagnosticPublic` endpoint.
//
// Visual language duplicated locally from Fases 1-4 (Nivel1Block, the
// icon-per-block decorative tint, the draft-banner/header/"← Volver"/
// "Fase X de 7"/closing-note pattern) — same convention every phase this
// session has used, to avoid ever modifying an earlier, already-approved
// phase's own file. ValuacionPreview.tsx itself is a read-only reference
// here — nothing in it is imported in a way that could change its own
// rendering (only its already-exported, shared-by-design primitives via
// ResumenPreview.tsx, and the real `HistoryTab` chart component, reused by
// direct import, unmodified — its methodology is never touched, no new
// series are added, only WHERE it's placed changed: now a first-class,
// always-visible section of this phase rather than a secondary link-out).

import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Target, Layers, LineChart as LineChartIcon } from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import { _valuationStatus, _VERDICT_COLOR } from "@/components/subvaluadas/shared";
import { ExpandRow } from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import { HistoryTab } from "@/components/subvaluadas/CompanyDiagnosticValuationTabs";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const ENTENDERLO_MEJOR = "Quiero entenderlo mejor";

// Same decorative, non-data-signal color variety Fases 1-4 introduced —
// gold stays dominant for every real figure, these only tint icon/card
// accents.
const BLOCK_BLUE = "#5B9BD5";

/** Same card wrapper as Fases 1-4's `Nivel1Block` (duplicated locally, same
 * established convention — never imported across phase files). */
function Nivel1Block({
  icon, iconColor = GOLD, title, idea, visual, expand,
}: {
  icon: ReactNode; iconColor?: string; title: string; idea: string; visual?: ReactNode; expand?: ReactNode;
}) {
  return (
    <GlowCard
      tint={iconColor}
      className="h-full flex flex-col transition-shadow duration-300 hover:shadow-[0_18px_40px_-20px_rgba(0,0,0,0.55)]"
      style={{ boxShadow: "0 14px 32px -20px rgba(0,0,0,0.5)" }}
    >
      <div className="flex items-center gap-3 mb-1">
        <IconSquare color={iconColor} size={38}>{icon}</IconSquare>
        <p className="text-[19px] font-black tracking-tight" style={{ color: "var(--text)" }}>{title}</p>
      </div>
      <div className="flex-1 flex flex-col justify-center gap-4 py-3">
        <p className="text-[16px] leading-6 font-semibold" style={{ color: "var(--text)" }}>{idea}</p>
        {visual}
      </div>
      {expand && <ExpandRow headline={ENTENDERLO_MEJOR}>{expand}</ExpandRow>}
    </GlowCard>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-[12px] leading-[16px]" style={{ color: "var(--sub)" }}>{label}</span>
      <span className="text-[13px] font-bold tabular-nums text-right shrink-0" style={{ color: "var(--text)" }}>{value}</span>
    </div>
  );
}

type ScenarioKey = "conservative" | "base" | "optimistic";
const _SCENARIO_META: Record<ScenarioKey, string> = {
  conservative: "Conservador",
  base: "Base",
  optimistic: "Optimista",
};

/** A. ¿Cuánto cuesta y cuánto podría valer? — price, estimated value and the
 * 3 real interactive scenarios, visible immediately, no expand required to
 * understand it (per Diego: "mostrar inmediatamente... no añadir
 * indicadores innecesarios"). Same real fields Valuación's own hero
 * (`ValueExplorer`) reads — never recomputed here. */
function PriceVsValue({
  data, selected, onSelect,
}: { data: FullCompanyDiagnosticData; selected: ScenarioKey; onSelect: (k: ScenarioKey) => void }) {
  const { currentPrice, conservative, baseFairValue, optimistic } = data.valuation;
  const values: Record<ScenarioKey, number | null> = { conservative, base: baseFairValue, optimistic };
  const selectedValue = values[selected];
  const status = selectedValue != null ? _valuationStatus(selectedValue, currentPrice) : null;
  const verdictColor = status ? _VERDICT_COLOR[status.verdict] : "var(--sub)";
  const verdictLabel =
    status?.verdict === "overvalued" ? `${Math.abs(status.pct).toFixed(0)}% sobrevalorada` :
    status?.verdict === "undervalued" ? `${Math.abs(status.pct).toFixed(0)}% infravalorada` :
    status ? "Valor razonable" : null;

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-end gap-x-7 gap-y-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: "var(--sub)" }}>Precio actual</p>
          <p className="text-[26px] leading-none font-black tabular-nums" style={{ color: "var(--text)" }}>
            {currentPrice != null ? fmtPrice(currentPrice) : "No disponible"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide font-bold mb-0.5" style={{ color: "var(--sub)" }}>
            Valor estimado — {_SCENARIO_META[selected]}
          </p>
          <p className="text-[26px] leading-none font-black tabular-nums" style={{ color: GOLD }}>
            {selectedValue != null ? fmtPrice(selectedValue) : "No disponible"}
          </p>
        </div>
        {verdictLabel && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full mb-0.5" style={{ color: verdictColor, background: `${verdictColor}18` }}>
            {verdictLabel}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(_SCENARIO_META) as ScenarioKey[]).map((key) => {
          const value = values[key];
          const isSelected = key === selected;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              disabled={value == null}
              className="rounded-2xl py-2.5 px-2 text-center transition-all duration-200 min-h-[52px]"
              style={{
                background: isSelected ? `${GOLD}1f` : "var(--raised)",
                border: `1px solid ${isSelected ? `${GOLD}aa` : "var(--border)"}`,
                opacity: value == null ? 0.5 : 1,
                cursor: value == null ? "default" : "pointer",
              }}
            >
              <p className="text-[10px] font-extrabold uppercase tracking-wide mb-0.5" style={{ color: isSelected ? GOLD : "var(--sub)" }}>
                {_SCENARIO_META[key]}
              </p>
              <p className="text-[14px] font-black tabular-nums" style={{ color: isSelected ? GOLD : "var(--text)" }}>
                {value != null ? fmtPrice(value) : "—"}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** B. ¿Por qué podría valer eso? — a simple synthesis adapted to the real
 * method actually used for this ticker (dual-track vs. the financial-sector
 * model), with the real method breakdown behind "Quiero entenderlo mejor" —
 * never a re-derivation, just the same real fields Valuación's own
 * "¿por qué estimamos este valor?" section reads. */
function WhyThisValueSimple({ data, selected }: { data: FullCompanyDiagnosticData; selected: ScenarioKey }) {
  const breakdown = data.valuation.scenarioBreakdown;
  const scenKey = selected === "base" ? "base" : selected === "conservative" ? "bear" : "bull";
  const scenData = breakdown?.[scenKey];
  const hasDcfDetail = breakdown != null && scenData?.eps != null;
  const dualTrack = data.valuation.dualTrack;
  const hasRealFcfTrack =
    selected === "base" &&
    dualTrack != null &&
    dualTrack.fcf_track_value != null &&
    dualTrack.earnings_track_weight_pct != null &&
    dualTrack.fcf_track_weight_pct != null;

  const idea = hasDcfDetail
    ? "Nuvos estima el valor de la empresa analizando sus ganancias, el dinero que genera y los supuestos sobre su futuro."
    : "Nuvos usa un modelo distinto para empresas del sector financiero: estima cuánto vale su capital propio a partir de su rentabilidad frente a su costo, en vez de proyectar flujo de caja libre.";

  const finalValues: Record<ScenarioKey, number | null> = {
    conservative: data.valuation.conservative, base: data.valuation.baseFairValue, optimistic: data.valuation.optimistic,
  };
  const finalValue = finalValues[selected];
  const wacc = data.valuation.waccDetails;
  const fairPe = data.valuation.fairPeBreakdown;

  return (
    <Nivel1Block
      icon={<Layers className="w-4 h-4" style={{ color: BLOCK_BLUE }} />}
      iconColor={BLOCK_BLUE}
      title="¿Por qué podría valer eso?"
      idea={idea}
      expand={
        hasDcfDetail && scenData ? (
          <div className="space-y-1">
            <DetailRow label="Ganancia por acción usada" value={`$${scenData.eps!.toFixed(2)}`} />
            <DetailRow label="Múltiplo justo aplicado" value={`${scenData.fair_pe.toFixed(1)}x`} />
            {wacc?.wacc_pct != null && <DetailRow label="Tasa de descuento (WACC)" value={`${wacc.wacc_pct.toFixed(1)}%`} />}
            {fairPe?.primary_anchor && <DetailRow label="Ancla del múltiplo justo" value={fairPe.primary_anchor} />}
            {hasRealFcfTrack && (
              <>
                <DetailRow label="Peso — enfoque de ganancias" value={`${dualTrack!.earnings_track_weight_pct!.toFixed(0)}%`} />
                <DetailRow label="Peso — enfoque de flujo de caja" value={`${dualTrack!.fcf_track_weight_pct!.toFixed(0)}%`} />
              </>
            )}
            {finalValue != null && <DetailRow label="Valor combinado (real)" value={fmtPrice(finalValue)} />}
            <p className="text-[11px] leading-[16px] pt-2" style={{ color: "var(--dim)" }}>
              Esta es una síntesis — el desglose completo (metodología, ponderaciones, fuentes y limitaciones) está
              disponible en la pestaña Valuación completa.
            </p>
            <a
              href={`/subvaluadas/resumen-preview/${data.ticker}/valuacion`}
              className="inline-block mt-1 text-[12px] font-bold"
              style={{ color: GOLD }}
            >
              Ver el cálculo completo en Valuación →
            </a>
          </div>
        ) : (
          <p className="text-[12.5px] leading-[19px]" style={{ color: "var(--sub)" }}>
            Los supuestos detallados de este modelo sectorial específico todavía no están disponibles en esta vista
            simplificada —{" "}
            <a href={`/subvaluadas/resumen-preview/${data.ticker}/valuacion`} className="font-bold" style={{ color: GOLD }}>
              revísalos en la pestaña Valuación completa
            </a>.
          </p>
        )
      }
    />
  );
}

/** Gráfica histórica — reutilizada tal cual (nunca reconstruida, nunca se le
 * cambia la metodología ni se le agregan series). Diego, tras el split:
 * "incluir la gráfica de la valuación histórica" — ahora es una sección de
 * primer nivel, siempre visible, no escondida detrás de un link-out; el
 * detalle más técnico (ejes/periodos/metodología) sigue viviendo dentro del
 * propio `HistoryTab`, que no se modifica. */
function HistoricalChartSection({ data, t, lang }: { data: FullCompanyDiagnosticData; t: (k: string, o?: Record<string, unknown>) => string; lang: string }) {
  if (!data.valuation.priceHistoryContext) return null;
  return (
    <Nivel1Block
      icon={<LineChartIcon className="w-4 h-4" style={{ color: BLOCK_BLUE }} />}
      iconColor={BLOCK_BLUE}
      title="¿Cómo ha variado esto en el tiempo?"
      idea="El precio real de la acción y el valor estimado por Nuvos no siempre se han movido igual — aquí puedes ver esa relación a lo largo de los años."
      visual={<HistoryTab data={data} t={t} lang={lang} />}
      expand={
        <a
          href={`/subvaluadas/resumen-preview/${data.ticker}/valuacion`}
          className="inline-block text-[12px] font-bold"
          style={{ color: GOLD }}
        >
          Ver el análisis histórico completo en Valuación →
        </a>
      }
    />
  );
}

export function EntenderValuacionPreview({
  data,
}: { data: FullCompanyDiagnosticData }) {
  const { t, i18n } = useTranslation();
  const [selected, setSelected] = useState<ScenarioKey>("base");
  const { validationStatus, reviewReason } = data.valuation;
  const underReview = validationStatus === "under_review";

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[13.5px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 5 de 7, no visible para usuarios reales.
      </div>

      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-industria`} className="text-[14.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Entender la industria
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={5} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[26px] font-black tracking-tight" style={{ color: "var(--text)" }}>Entender la valuación</p>
          <p className="text-[14.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {data.valuation.currentPrice != null && <> · {fmtPrice(data.valuation.currentPrice)}</>}
          </p>
        </div>
      </div>

      {underReview && (
        <div className="rounded-[14px] px-3.5 py-3 mb-6" style={{ background: "rgba(239,68,68,0.08)", borderLeft: "3px solid #ef4444" }}>
          <p className="text-[10px] font-extrabold uppercase mb-1" style={{ color: "#ef4444" }}>Valoración en revisión</p>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
            Estos números son reales y trazables, pero todavía no deben leerse como una conclusión validada.
            {reviewReason ? ` ${reviewReason}` : ""}
          </p>
        </div>
      )}

      <div className="space-y-6">
        {/* A. ¿Cuánto cuesta y cuánto podría valer? */}
        <Nivel1Block
          icon={<Target className="w-4 h-4" style={{ color: GOLD }} />}
          title="¿Cuánto cuesta y cuánto podría valer?"
          idea="El precio es lo que el mercado paga hoy; el valor estimado es lo que el modelo de Nuvos calcula que podría valer el negocio. No es una recomendación de compra o venta."
          visual={<PriceVsValue data={data} selected={selected} onSelect={setSelected} />}
        />

        {/* B. ¿Por qué podría valer eso? */}
        <WhyThisValueSimple data={data} selected={selected} />

        {/* Gráfica histórica — ahora de primer nivel, siempre visible */}
        <HistoricalChartSection data={data} t={t} lang={i18n.language} />
      </div>

      <div className="mt-6 text-center">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/riesgos-a-vigilar`} className="text-[14.5px] font-bold" style={{ color: GOLD }}>
          → Fase 6: Riesgos a vigilar
        </a>
        <p className="text-[14.5px] mt-1" style={{ color: "var(--sub)" }}>
          Fase 7 (mi tesis) todavía no está integrada a este recorrido guiado.
        </p>
      </div>
      <p className="text-[10.5px] text-center mt-3" style={{ color: "var(--sub)" }}>
        <LineChartIcon className="inline w-3 h-3 mr-1 -mt-0.5" />
        Esta información es educativa y no constituye una recomendación de compra o venta.
      </p>

      <JourneyBottomNav ticker={data.ticker} phase={5} />
    </div>
  );
}
