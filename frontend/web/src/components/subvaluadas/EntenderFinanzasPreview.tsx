"use client";

// EntenderFinanzasPreview — Nuvos Radar 2.0, Fase 2 of the 6-phase learning
// journey. Diego, 2026-11-15: "LA FASE 1 ACTUAL ES LA REFERENCIA OFICIAL Y
// OBLIGATORIA DE DISEÑO." Every visual pattern here is copied from the real,
// current EntenderNegocioPreview.tsx (card width/padding, title size, the
// "one idea + one simple visual + Quiero entenderlo mejor" rhythm, the
// vertical ↓ step-flow language, the first-sentence extraction discipline)
// — duplicated locally rather than importing from that file, the same
// convention Fase 1 itself used for `splitOpener` (never touching an
// earlier phase's file to enable reuse). Fase 1 is untouched by this file
// except for one explicit, minimal, reported addition to its own closing
// note (see that file's own comment).
//
// Every number here is real: `data.financialTrends` (company_diagnostic_
// service.py, additive field, 2026-11-15) — real per-year revenue/net
// income/margins/operating-cash-flow/capex/FCF, reusing arrays
// get_fundamental_analysis() already computed for its own DCF math. No new
// financial provider, no engine change, no fabricated figure. Nuvos's own
// FCF-normalization adjustment (`fcfNormalized`) is kept visually and
// textually separate from the real reported `fcfReported` — never shown as
// if it were the same thing.
//
// Bank/insurer gate: cash-flow-from-operations and total-debt-vs-cash mean
// something structurally different for a deposit-taking bank (financing
// activity dominates "operating" cash flow; "debt" includes deposits) than
// for a normal operating company — confirmed empirically for JPM (real
// ocf_trend swings to -$147,782M, capex_trend is $0 across all 5 years).
// Sections C and D are gated off for financial-sector tickers using the
// exact same real classification keywords the backend's own
// `_is_financial_sector` already uses, applied client-side to the same
// real `data.sector` string every other screen already shows — an honest
// "no disponible para este tipo de negocio" replaces the metric instead of
// forcing a misleading one.

import type { ReactNode } from "react";
import { Fragment } from "react";
import { TrendingUp, Percent, Droplets, Scale, ListChecks } from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { ExpandRow, SourceLinks } from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import { fmtPrice } from "@/lib/types/stock";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const ENTENDERLO_MEJOR = "Quiero entenderlo mejor";

// Same decorative, non-data-signal color variety Fase 1 introduced — gold
// stays dominant for every real figure, these only tint icon/card accents.
const BLOCK_BLUE = "#5B9BD5";
const BLOCK_GREEN = "#6FAE7D";
const BLOCK_STEEL = "#8B93B0";

// Cohorte 2, 2026-11-17 — real bug found auditing Visa/Mastercard: the old
// version of this gate matched on the coarse `sector` string alone
// ("Financial Services" includes "financial services"), which caught Visa
// and Mastercard too — real payment NETWORKS (toll-road economics, no
// deposits, no loan-loss provisioning, genuinely normal capex/FCF like any
// other company), not deposit-taking lenders like JPM. The backend's own
// real valuation engine already solves this correctly — it only applies the
// financial-sector ROE model when `_is_financial_sector(sector) AND NOT
// _is_asset_light_financial_industry(...)` (fundamental_analysis_service.py)
// — and only in THAT case does it ever populate `sectorModelNote` with
// `sector_type: "financial"`. Confirmed live: JPM/NU both get a real
// sectorModelNote; Visa/Mastercard get `sectorModelNote: null` and a normal
// `scenarioBreakdown` (eps/fair_pe), exactly like any standard company. So
// `sectorModelNote` is already the backend's own authoritative answer to
// "does THIS company get the bank-specific treatment" — reusing it here
// means this gate can never drift out of sync with the real engine again,
// unlike the old string-matching copy of logic that lived only in this file.
function isFinancialSector(sectorModelNote: { sector_type: string } | null | undefined): boolean {
  return sectorModelNote?.sector_type === "financial";
}

/** $ formatting consistent with the rest of this session's work (M/B
 * suffix, en-US thousand separators) — picks B over M above $1,000M purely
 * for readability, never changes the underlying real value. */
function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "N/D";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  return `${sign}$${Math.round(abs / 1e6).toLocaleString("en-US")}M`;
}

/** Last non-null value + its real year label from two index-aligned
 * oldest->newest arrays — never assumes the newest array slot is filled. */
function lastReal(values: (number | null)[], years: string[]): { value: number; year: string } | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return { value: v, year: years[i] ?? "" };
  }
  return null;
}

/** Same card wrapper as Fase 1's `Nivel1Block`: one icon+title, one short
 * idea, one simple visual, and — only when there's real depth — a single
 * "Quiero entenderlo mejor" control. `flex-1 justify-center` keeps a
 * visually light block as intentionally composed as a denser sibling of
 * equal height, never top-aligned with dead space below. */
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

/** A. "¿Está vendiendo más?" visual — plain bars, real years, real $ labels,
 * max 5 most-recent years, no decoration. Same restrained visual language
 * as Fase 1's RevenueBars (gold fill, var(--sub) labels). */
function RevenueBarChart({ years, revenue }: { years: string[]; revenue: (number | null)[] }) {
  const rows = years.map((y, i) => ({ year: y, value: revenue[i] })).filter((r) => r.value != null).slice(-5);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.value as number));
  return (
    <div className="flex items-end gap-2.5 h-[108px]">
      {rows.map((r) => (
        <div key={r.year} className="flex-1 flex flex-col items-center justify-end h-full gap-1.5">
          <span className="text-[11px] font-bold" style={{ color: "var(--sub)" }}>{fmtMoney(r.value)}</span>
          <div
            className="w-full rounded-t-md"
            style={{ height: `${Math.max(6, ((r.value as number) / max) * 72)}px`, background: GOLD }}
          />
          <span className="text-[11.5px] font-semibold" style={{ color: "var(--sub)" }}>{r.year}</span>
        </div>
      ))}
    </div>
  );
}

/** B. "¿Cuánto le queda?" visual — "de cada $100, te quedan $X" as a single
 * split bar: gold portion = real net margin, the rest a neutral track. */
function MarginOutOf100({ marginPct }: { marginPct: number }) {
  const kept = Math.max(0, Math.min(100, marginPct));
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[32px] font-black tracking-tight" style={{ color: GOLD }}>${kept.toFixed(0)}</span>
        <span className="text-[14.5px]" style={{ color: "var(--sub)" }}>de cada $100 que vende, como ganancia</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.14)" }}>
        <div className="h-full rounded-full" style={{ width: `${kept}%`, background: GOLD }} />
      </div>
    </div>
  );
}

/** C. "¿Genera efectivo?" visual — the same always-vertical, ↓-connected
 * step language as Fase 1's SimpleFlow3, but each step carries a real
 * labeled $ value instead of plain text. */
function CashFlowSteps({ steps }: { steps: { label: string; value: string }[] }) {
  return (
    <div className="flex flex-col items-stretch gap-2">
      {steps.map((step, i) => (
        <Fragment key={step.label}>
          <div
            className="rounded-2xl px-4 py-3 text-center"
            style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.35)" }}
          >
            <p className="text-[15px] font-black" style={{ color: "var(--text)" }}>{step.value}</p>
            <p className="text-[12px] font-semibold" style={{ color: "var(--sub)" }}>{step.label}</p>
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center justify-center shrink-0 text-[16px]" style={{ color: "var(--sub)" }}>↓</div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** D. "¿Puede pagar sus deudas?" visual — the same 2-column comparison-box
 * language Fase 1 used for "quiénes son sus clientes" (two bordered boxes,
 * one gold-tinted), here comparing real debt vs. real cash. */
function DebtVsCash({ debt, cash }: { debt: number; cash: number }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="rounded-2xl p-3.5" style={{ background: "rgba(127,127,127,0.06)", border: "1px solid var(--border)" }}>
        <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>Deuda financiera</p>
        <p className="text-[18px] font-black" style={{ color: "var(--text)" }}>{fmtMoney(debt)}</p>
      </div>
      <div className="rounded-2xl p-3.5" style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.4)" }}>
        <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: GOLD }}>Efectivo y equivalentes</p>
        <p className="text-[18px] font-black" style={{ color: "var(--text)" }}>{fmtMoney(cash)}</p>
      </div>
    </div>
  );
}

/** Honest, non-templated fallback for a financial-sector ticker where a
 * metric would be structurally misleading if forced — never a blank gap,
 * never a forced number. */
function NotApplicableForSector({ reason }: { reason: string }) {
  return (
    <p className="text-[14.5px] leading-5 italic" style={{ color: "var(--sub)" }}>
      No disponible de forma comparable para este tipo de negocio — {reason}
    </p>
  );
}

export function EntenderFinanzasPreview({ data }: { data: FullCompanyDiagnosticData }) {
  const ft = data.financialTrends;
  const isBank = isFinancialSector(data.sectorModelNote);

  if (!ft || ft.years.length === 0) {
    return (
      <GlowCard>
        <p className="text-[17px] italic" style={{ color: "var(--sub)" }}>
          Todavía no hay suficientes estados financieros anuales reales para {data.ticker} — esta fase depende de
          ese histórico y no puede construirse sin inventar cifras.
        </p>
      </GlowCard>
    );
  }

  const latestRevenue = lastReal(ft.revenue, ft.years);
  const firstRevenue = ft.revenue.find((v) => v != null) ?? null;
  const latestNetMargin = lastReal(ft.netMargin, ft.years);
  const latestOperatingMargin = lastReal(ft.operatingMargin, ft.years);
  const latestNetIncome = lastReal(ft.netIncome, ft.years);
  const latestOcf = lastReal(ft.operatingCashFlow, ft.years);
  const latestCapex = lastReal(ft.capex, ft.years);
  const latestFcfReported = lastReal(ft.fcfReported, ft.years);
  const latestFcfNormalized = lastReal(ft.fcfNormalized, ft.years);

  const sellingMoreIdea =
    latestRevenue && firstRevenue != null && firstRevenue > 0
      ? latestRevenue.value > firstRevenue
        ? `${data.companyName} vendió más en el año fiscal ${latestRevenue.year} que en el ${ft.years[0]} — un crecimiento real de ${(((latestRevenue.value - firstRevenue) / firstRevenue) * 100).toFixed(0)}% en ese período.`
        : `${data.companyName} vendió menos en el año fiscal ${latestRevenue.year} que en el ${ft.years[0]}.`
      : "No hay suficiente histórico real para comparar.";

  // E. Up to 3 rule-based observations — never AI-generated, never a new
  // score, each one traceable to a real trend direction already computed
  // above. Omitted (not fabricated) when the underlying comparison isn't
  // available.
  const observations: string[] = [];
  if (latestRevenue && firstRevenue != null && firstRevenue > 0) {
    observations.push(
      latestRevenue.value > firstRevenue
        ? "Mejorando: los ingresos reales crecieron en el período mostrado."
        : "Genera presión: los ingresos reales cayeron en el período mostrado.",
    );
  }
  const marginValid = ft.netMargin.filter((v): v is number => v != null);
  if (marginValid.length >= 2) {
    const delta = marginValid[marginValid.length - 1] - marginValid[0];
    observations.push(
      delta > 0.5
        ? "Mejorando: el margen neto real es más alto hoy que al inicio del período mostrado."
        : delta < -0.5
          ? "Merece seguimiento: el margen neto real es más bajo hoy que al inicio del período mostrado."
          : "Estable: el margen neto real se ha mantenido en un rango similar.",
    );
  }
  if (!isBank && latestFcfReported && latestOcf) {
    observations.push(
      latestFcfReported.value > 0
        ? "Mejorando: el efectivo real que queda después de invertir en el negocio es positivo en el período más reciente."
        : "Merece seguimiento: el efectivo real que queda después de invertir en el negocio fue negativo en el período más reciente.",
    );
  }

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[13.5px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 2 de 7, no visible para usuarios reales.
      </div>

      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-negocio`} className="text-[14.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Entender el negocio
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={2} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[26px] font-black tracking-tight" style={{ color: "var(--text)" }}>Entender las finanzas</p>
          <p className="text-[14.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {data.valuation?.currentPrice != null && <> · {fmtPrice(data.valuation.currentPrice)}</>}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* A. ¿Está vendiendo más? */}
          <Nivel1Block
            icon={<TrendingUp className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Está vendiendo más?"
            idea={sellingMoreIdea}
            visual={<RevenueBarChart years={ft.years} revenue={ft.revenue} />}
            expand={
              <div className="space-y-2">
                <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                  Los ingresos son todo el dinero real que entra por vender productos o servicios, antes de restar
                  ningún costo. Cifras anuales reales por año fiscal, {ft.years[0]}–{ft.years[ft.years.length - 1]}, en dólares.
                </p>
                <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                  Fuente: estados financieros anuales reportados (FMP), sección de ingresos del estado de resultados.
                </p>
              </div>
            }
          />

          {/* B. ¿Cuánto dinero le queda de lo que vende? */}
          <Nivel1Block
            icon={<Percent className="w-4 h-4" style={{ color: BLOCK_BLUE }} />}
            iconColor={BLOCK_BLUE}
            title="¿Cuánto le queda de lo que vende?"
            idea={
              latestNetMargin
                ? `Por cada $100 que gana, le quedan $${latestNetMargin.value.toFixed(0)} como ganancia neta en ${latestNetMargin.year}.`
                : "Margen neto no disponible todavía para esta empresa."
            }
            visual={latestNetMargin ? <MarginOutOf100 marginPct={latestNetMargin.value} /> : undefined}
            expand={
              <div className="space-y-2">
                {latestNetIncome && (
                  <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                    Beneficio neto real en {latestNetIncome.year}: <strong style={{ color: "var(--text)" }}>{fmtMoney(latestNetIncome.value)}</strong>.
                  </p>
                )}
                {latestOperatingMargin && (
                  <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                    Margen operativo real (antes de impuestos e intereses) en {latestOperatingMargin.year}:{" "}
                    <strong style={{ color: "var(--text)" }}>{latestOperatingMargin.value.toFixed(1)}%</strong> — distinto del margen
                    neto de arriba, que ya incluye esos costos.
                  </p>
                )}
                <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                  Cifras anuales reales (no se mezclan con datos trimestrales). Fuente: estados financieros anuales
                  reportados (FMP).
                </p>
              </div>
            }
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* C. ¿Genera efectivo? — gated off for banks/insurers */}
          <Nivel1Block
            icon={<Droplets className="w-4 h-4" style={{ color: BLOCK_GREEN }} />}
            iconColor={BLOCK_GREEN}
            title="¿Genera efectivo?"
            idea={
              isBank
                ? "El flujo de caja de un banco no se lee igual que el de una empresa operativa normal."
                : latestOcf && latestCapex && latestFcfReported
                  ? `En ${latestFcfReported.year}, después de invertir en el negocio, le quedaron ${fmtMoney(latestFcfReported.value)} en efectivo real.`
                  : "Flujo de caja real no disponible todavía para esta empresa."
            }
            visual={
              isBank ? (
                <NotApplicableForSector reason="gran parte de su flujo de caja 'operativo' refleja depósitos y préstamos, no la operación del negocio en el sentido convencional." />
              ) : latestOcf && latestCapex && latestFcfReported ? (
                <CashFlowSteps
                  steps={[
                    { label: "Efectivo de operaciones", value: fmtMoney(latestOcf.value) },
                    { label: "Inversiones de capital (CapEx)", value: `-${fmtMoney(latestCapex.value)}` },
                    { label: "Efectivo restante (FCF reportado)", value: fmtMoney(latestFcfReported.value) },
                  ]}
                />
              ) : undefined
            }
            expand={
              !isBank ? (
                <div className="space-y-2">
                  <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                    Declarar ganancias (arriba) no es lo mismo que generar efectivo: una empresa puede ser rentable en
                    el papel y aun así necesitar mucho dinero real para operar e invertir.
                  </p>
                  {latestFcfNormalized && (
                    <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                      Ajuste propio de Nuvos (no es el flujo de caja realmente reportado): separando la inversión de
                      mantenimiento de la de crecimiento, el flujo de caja "normalizado" en {latestFcfNormalized.year}{" "}
                      sería de <strong style={{ color: "var(--text)" }}>{fmtMoney(latestFcfNormalized.value)}</strong>.
                    </p>
                  )}
                  <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                    Cifras anuales reales reportadas (FMP) — Efectivo de operaciones e Inversiones de capital, sin
                    ajustar.
                  </p>
                </div>
              ) : undefined
            }
          />

          {/* D. ¿Puede pagar sus deudas? — gated off for banks/insurers */}
          <Nivel1Block
            icon={<Scale className="w-4 h-4" style={{ color: BLOCK_STEEL }} />}
            iconColor={BLOCK_STEEL}
            title="¿Puede pagar sus deudas?"
            idea={
              isBank
                ? "La deuda de un banco incluye los depósitos de sus clientes — no es comparable a la de una empresa normal."
                : ft.totalDebt != null && ft.netCash != null
                  ? ft.netCash >= 0
                    ? `Tiene más efectivo que deuda financiera — caja neta positiva de ${fmtMoney(ft.netCash)}.`
                    : `Tiene más deuda financiera que efectivo disponible — posición neta de deuda de ${fmtMoney(Math.abs(ft.netCash))}.`
                  : "Deuda y efectivo no disponibles todavía para esta empresa."
            }
            visual={
              isBank ? (
                <NotApplicableForSector reason="su 'deuda' incluye los depósitos de clientes, que no son una obligación comparable a la deuda de una empresa operativa." />
              ) : ft.totalDebt != null && ft.netCash != null ? (
                <DebtVsCash debt={ft.totalDebt} cash={ft.totalDebt + ft.netCash} />
              ) : undefined
            }
            expand={
              !isBank ? (
                <div className="space-y-2">
                  {latestOcf && (
                    <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                      Capacidad de generar efectivo: en {latestOcf.year}, el efectivo real de sus operaciones fue de{" "}
                      <strong style={{ color: "var(--text)" }}>{fmtMoney(latestOcf.value)}</strong>.
                    </p>
                  )}
                  <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                    Esta comparación por sí sola no basta para concluir si puede cubrir todas sus obligaciones —
                    no incluye compromisos como arrendamientos u otras obligaciones que podrían no estar reflejados
                    aquí.
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--sub)" }}>
                    Cifras reales más recientes reportadas (FMP) — deuda financiera y efectivo/equivalentes.
                  </p>
                </div>
              ) : undefined
            }
          />
        </div>

        {/* E. ¿Está mejorando o empeorando? — hasta 3 observaciones
           determinísticas, nunca una calificación nueva. A lo ancho, es el
           bloque de cierre, no tiene pareja. */}
        {observations.length > 0 && (
          <Nivel1Block
            icon={<ListChecks className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Está mejorando o empeorando?"
            idea="Esto es un resumen para recordar lo que viste arriba — no una recomendación de inversión."
            visual={
              <ul className="space-y-1.5">
                {observations.slice(0, 3).map((obs, i) => (
                  <li key={i} className="text-[14.5px] leading-5 flex gap-2" style={{ color: "var(--text)" }}>
                    <span style={{ color: GOLD }}>•</span>
                    <span>{obs}</span>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </div>

      <div className="mt-6 text-center">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/conocer-liderazgo`} className="text-[14.5px] font-bold" style={{ color: GOLD }}>
          → Fase 3: Conocer a quienes dirigen
        </a>
        <p className="text-[14.5px] mt-1" style={{ color: "var(--sub)" }}>
          Fases 4-7 (industria, valuación, riesgos a vigilar, mi tesis) todavía no están construidas en este prototipo.
        </p>
      </div>

      <JourneyBottomNav ticker={data.ticker} phase={2} />
    </div>
  );
}
