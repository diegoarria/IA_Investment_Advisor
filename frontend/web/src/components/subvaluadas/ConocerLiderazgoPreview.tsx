"use client";

// ConocerLiderazgoPreview — Nuvos Radar 2.0, Fase 3 of the 6-phase learning
// journey. Diego, 2026-11-15: "LA FASE 3 DEBE SEGUIR FIELMENTE EL DISEÑO
// ACTUAL DE LAS FASES 1 Y 2." Every visual pattern here is copied from the
// real, current EntenderNegocioPreview.tsx/EntenderFinanzasPreview.tsx
// (card width/padding, title size, the "one idea + one simple visual +
// Quiero entenderlo mejor" rhythm, the vertical ↓ step-flow language, the
// 2-column grid with vertically-centered card content, the decorative
// icon-tint palette) — duplicated locally rather than importing from those
// files, the same convention Fase 2 itself used. Fases 1 and 2 are
// untouched by this file except for one explicit, minimal, reported
// addition to Fase 2's own closing note (see that file's own comment).
//
// All leadership/capital-allocation content comes from REAL, sourced
// research (frontend/web/src/lib/previewContent/leadership/*.json) — SEC
// filings, Alphabet's own Q4 2025 earnings release (primary source,
// fetched and read directly, 2026-11-15), a real SEC Form 4, and reported
// coverage of the 2025/2026 proxy statements. GOOGL is the only pilot with
// real research this round (per Diego's own scope — "usaremos Alphabet
// como caso piloto"); every other ticker gets an honest "contenido no
// construido todavía" state, never GOOGL's specific CEO/decisions/figures.
// Every claim carries a real source + date, or is explicitly marked
// unverified (`compensation_2025_verified: false`) rather than guessed.
//
// No new financial-engine field, no Supabase write, no live recompute —
// this screen's only real-time data dependency is the same already-
// persisted `companyDiagnosticPublic` ticker/sector/price header every
// other Radar 2.0 screen already uses.

import type { ReactNode } from "react";
import { Fragment } from "react";
import { UserCircle, Wallet, TrendingUp, Scale, Eye } from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { ExpandRow, SourceLinks } from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import { fmtPrice } from "@/lib/types/stock";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const ENTENDERLO_MEJOR = "Quiero entenderlo mejor";

// Same decorative, non-data-signal color variety Fases 1-2 introduced —
// gold stays dominant for every real figure, these only tint icon/card
// accents.
const BLOCK_BLUE = "#5B9BD5";
const BLOCK_GREEN = "#6FAE7D";
const BLOCK_STEEL = "#8B93B0";

/** Real, sourced leadership research for one ticker — never AI-fabricated
 * at request time, never edited at runtime. Mirrors the source-citation
 * shape already used by `company_qualitative_content` (source_name as
 * "label: url" pairs, source_document_date, source_accessed_at,
 * confidence) so `SourceLinks` renders it the same way. */
interface LeadershipContent {
  ticker: string;
  ceo: {
    name: string;
    role_explanation: string;
    since: string;
    source_name: string;
    confidence: "alta" | "media" | "baja";
  };
  capital_allocation: {
    fiscal_year: string;
    operating_cash_flow: number;
    capex: number;
    capex_prior_year: number;
    fcf_reported_ttm: number;
    buybacks: number;
    buybacks_prior_year: number;
    dividends_paid: number;
    dividends_paid_prior_year: number;
    dividend_per_share_quarterly: string;
    long_term_debt_current: number;
    long_term_debt_prior: number;
    debt_direction: string;
    acquisition_note: string;
    note: string;
    source_name: string;
  };
  decisions: {
    decision: string;
    outcome: string;
    uncertainty: string;
    source_name: string;
  }[];
  incentive_alignment: {
    last_confirmed_total_compensation: {
      fiscal_year: string;
      amount_usd: number;
      base_salary_usd: number;
      note: string;
      source_name: string;
    };
    compensation_2025_verified: boolean;
    compensation_2025_note: string;
    psu_award: { description: string; source_name: string };
    direct_ownership: { shares_class_c: number; shares_class_a: number; total_shares_outstanding_approx: number; ownership_pct_approx: number; note: string; source_name: string };
  };
  watch: string[];
}

/** $ formatting consistent with Fase 2's own `fmtMoney` — duplicated
 * locally rather than importing, same convention established there. */
function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "N/D";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  return `${sign}$${Math.round(abs / 1e6).toLocaleString("en-US")}M`;
}

/** Same card wrapper as Fases 1-2's `Nivel1Block`. */
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

/** B. "¿Qué hace con el dinero?" visual — one real source box (efectivo
 * generado) connecting down, via the same ↓ language as Fases 1-2, to the
 * REAL alternatives this company actually used this period. Alternatives
 * it did NOT use this period are listed as illustrative (dimmer), never
 * presented as if they happened — exactly Diego's "representa alternativas,
 * no implica que la empresa realice todas" instruction. */
function CapitalAllocationFlow({ items }: { items: { label: string; value: string; real: boolean }[] }) {
  return (
    <div className="flex flex-col items-stretch gap-2">
      <div className="rounded-2xl px-4 py-3 text-center" style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.35)" }}>
        <p className="text-[12px] font-black uppercase tracking-wide" style={{ color: "var(--sub)" }}>Una empresa genera efectivo</p>
      </div>
      <div className="flex items-center justify-center shrink-0 text-[16px]" style={{ color: "var(--sub)" }}>↓</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-xl px-2.5 py-2.5 text-center"
            style={{
              background: item.real ? "rgba(212,162,76,0.1)" : "rgba(127,127,127,0.05)",
              border: item.real ? "1px solid rgba(212,162,76,0.35)" : "1px dashed var(--border)",
              opacity: item.real ? 1 : 0.65,
            }}
          >
            <p className="text-[13px] font-black" style={{ color: item.real ? "var(--text)" : "var(--sub)" }}>{item.value}</p>
            <p className="text-[10.5px] font-semibold leading-tight mt-0.5" style={{ color: "var(--sub)" }}>{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** C. "¿Sus decisiones han funcionado?" visual — the same always-vertical
 * ↓-connected step language, but 3 distinct steps: decisión tomada →
 * resultado observado → lo que todavía no sabemos. Never collapses
 * decision and outcome into one box — Diego's explicit separation. */
function DecisionOutcomeSteps({ decision, outcome, uncertainty }: { decision: string; outcome: string; uncertainty: string }) {
  const steps = [
    { label: "Decisión tomada", text: decision },
    { label: "Resultado observado", text: outcome },
    { label: "Lo que todavía no sabemos", text: uncertainty },
  ];
  return (
    <div className="flex flex-col items-stretch gap-2">
      {steps.map((step, i) => (
        <Fragment key={step.label}>
          <div
            className="rounded-2xl px-3.5 py-3"
            style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.35)" }}
          >
            <p className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>{step.label}</p>
            <p className="text-[13.5px] leading-5 font-semibold" style={{ color: "var(--text)" }}>{step.text}</p>
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center justify-center shrink-0 text-[16px]" style={{ color: "var(--sub)" }}>↓</div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** D. "¿Sus intereses se parecen a los accionistas?" visual — the same
 * 2-column comparison-box language Fases 1-2 used for client/debt-vs-cash
 * comparisons. Never implies alignment from ownership alone — the % is
 * shown honestly small, with its own caveat, never dressed up. */
function OwnershipBox({ pct, note }: { pct: number; note: string }) {
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "rgba(127,127,127,0.06)", border: "1px solid var(--border)" }}>
      <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>Tenencia directa de acciones</p>
      <p className="text-[18px] font-black" style={{ color: "var(--text)" }}>~{pct}% del total en circulación</p>
      <p className="text-[12px] leading-4 mt-1" style={{ color: "var(--sub)" }}>{note}</p>
    </div>
  );
}

export function ConocerLiderazgoPreview({
  data, leadership,
}: { data: FullCompanyDiagnosticData; leadership: LeadershipContent | null }) {
  if (!leadership) {
    return (
      <GlowCard>
        <p className="text-[17px] italic" style={{ color: "var(--sub)" }}>
          Todavía no hay contenido investigado y verificado sobre el liderazgo de {data.ticker} — esta fase depende
          de esa investigación real y no puede construirse sin inventar información.
        </p>
      </GlowCard>
    );
  }

  const ca = leadership.capital_allocation;
  const capexGrowthPct = ((ca.capex - ca.capex_prior_year) / ca.capex_prior_year) * 100;
  const buybacksDirection = ca.buybacks > ca.buybacks_prior_year ? "subieron" : "bajaron";
  const ownershipShares = leadership.incentive_alignment.direct_ownership.shares_class_c + leadership.incentive_alignment.direct_ownership.shares_class_a;

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[13.5px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 3 de 7, no visible para usuarios reales.
      </div>

      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-finanzas`} className="text-[14.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Entender las finanzas
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={3} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[26px] font-black tracking-tight" style={{ color: "var(--text)" }}>Conocer a quienes dirigen</p>
          <p className="text-[14.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {data.valuation?.currentPrice != null && <> · {fmtPrice(data.valuation.currentPrice)}</>}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* A. ¿Quién dirige la empresa? */}
          <Nivel1Block
            icon={<UserCircle className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Quién dirige la empresa?"
            idea={leadership.ceo.role_explanation}
            visual={
              <div className="rounded-2xl p-3.5" style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.4)" }}>
                <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: GOLD }}>CEO actual</p>
                <p className="text-[17px] font-black" style={{ color: "var(--text)" }}>{leadership.ceo.name}</p>
                <p className="text-[12.5px] mt-0.5" style={{ color: "var(--sub)" }}>Desde {leadership.ceo.since}</p>
              </div>
            }
            expand={
              <div className="space-y-2">
                <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                  El CEO no toma todas las decisiones operativas por sí solo, pero sí coordina la estrategia general y
                  responde directamente ante el consejo de administración y los accionistas.
                </p>
                <SourceLinks raw={leadership.ceo.source_name} />
              </div>
            }
          />

          {/* B. ¿Qué hace con el dinero que gana? */}
          <Nivel1Block
            icon={<Wallet className="w-4 h-4" style={{ color: BLOCK_BLUE }} />}
            iconColor={BLOCK_BLUE}
            title="¿Qué hace con el dinero que gana?"
            idea={`En el año fiscal ${ca.fiscal_year}, reinvirtió en el negocio, recompró acciones y pagó dividendos — pero su deuda de largo plazo ${ca.debt_direction}, no bajó.`}
            visual={
              <CapitalAllocationFlow
                items={[
                  { label: "Reinvertir en el negocio (capex)", value: fmtMoney(ca.capex), real: true },
                  { label: "Recomprar acciones", value: fmtMoney(ca.buybacks), real: true },
                  { label: "Pagar dividendos", value: fmtMoney(ca.dividends_paid), real: true },
                  { label: "Reducir deuda", value: "No este período", real: false },
                ]}
              />
            }
            expand={
              <div className="space-y-2">
                <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                  Capex real: {fmtMoney(ca.capex)} en {ca.fiscal_year} (vs. {fmtMoney(ca.capex_prior_year)} el año
                  anterior, +{capexGrowthPct.toFixed(0)}%). Recompras: {fmtMoney(ca.buybacks)} (vs.{" "}
                  {fmtMoney(ca.buybacks_prior_year)} el año anterior — {buybacksDirection}). Dividendos pagados en
                  efectivo: {fmtMoney(ca.dividends_paid)} (vs. {fmtMoney(ca.dividends_paid_prior_year)}). Dividendo
                  trimestral declarado: {ca.dividend_per_share_quarterly}.
                </p>
                <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                  Deuda de largo plazo: pasó de {fmtMoney(ca.long_term_debt_prior)} a {fmtMoney(ca.long_term_debt_current)}{" "}
                  en el mismo año — {ca.acquisition_note}
                </p>
                <p className="text-[13px] leading-5" style={{ color: "var(--sub)" }}>{ca.note}</p>
                <SourceLinks raw={ca.source_name} />
              </div>
            }
          />
        </div>

        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* C. ¿Sus decisiones han funcionado? */}
          {leadership.decisions[0] && (
            <Nivel1Block
              icon={<TrendingUp className="w-4 h-4" style={{ color: BLOCK_GREEN }} />}
              iconColor={BLOCK_GREEN}
              title="¿Sus decisiones han funcionado?"
              idea="Una decisión importante de inversión, y lo que se observó después — sin afirmar causalidad que la evidencia no respalda."
              visual={
                <DecisionOutcomeSteps
                  decision={leadership.decisions[0].decision}
                  outcome={leadership.decisions[0].outcome}
                  uncertainty={leadership.decisions[0].uncertainty}
                />
              }
              expand={
                <div className="space-y-2">
                  <p className="text-[13px] leading-5" style={{ color: "var(--sub)" }}>
                    Esto no es una calificación del CEO ni una conclusión definitiva — es una observación de dos hechos
                    reales ocurridos en el mismo período, no una prueba de que uno causó el otro.
                  </p>
                  <SourceLinks raw={leadership.decisions[0].source_name} />
                </div>
              }
            />
          )}

          {/* D. ¿Sus intereses se parecen a los de los accionistas? */}
          <Nivel1Block
            icon={<Scale className="w-4 h-4" style={{ color: BLOCK_STEEL }} />}
            iconColor={BLOCK_STEEL}
            title="¿Sus intereses se parecen a los de los accionistas?"
            idea="Una parte real de su compensación depende de qué tan bien le vaya a la acción frente a sus pares — pero su tenencia directa de acciones es pequeña."
            visual={
              <OwnershipBox
                pct={leadership.incentive_alignment.direct_ownership.ownership_pct_approx}
                note={`${ownershipShares.toLocaleString("en-US")} acciones directas (Form 4, SEC) — no basta por sí sola para concluir alineación.`}
              />
            }
            expand={
              <div className="space-y-2">
                <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                  Última compensación total confirmada: {fmtMoney(leadership.incentive_alignment.last_confirmed_total_compensation.amount_usd)}{" "}
                  en {leadership.incentive_alignment.last_confirmed_total_compensation.fiscal_year} (salario base{" "}
                  {fmtMoney(leadership.incentive_alignment.last_confirmed_total_compensation.base_salary_usd)}).
                </p>
                {!leadership.incentive_alignment.compensation_2025_verified && (
                  <p className="text-[13px] leading-5 italic" style={{ color: "var(--sub)" }}>
                    {leadership.incentive_alignment.compensation_2025_note}
                  </p>
                )}
                <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                  {leadership.incentive_alignment.psu_award.description}
                </p>
                <p className="text-[13px] leading-5" style={{ color: "var(--sub)" }}>
                  {leadership.incentive_alignment.direct_ownership.note}
                </p>
                <SourceLinks raw={leadership.incentive_alignment.last_confirmed_total_compensation.source_name} />
                <SourceLinks raw={leadership.incentive_alignment.psu_award.source_name} />
                <SourceLinks raw={leadership.incentive_alignment.direct_ownership.source_name} />
              </div>
            }
          />
        </div>

        {/* E. ¿Qué deberíamos vigilar de su liderazgo? */}
        {leadership.watch.length > 0 && (
          <Nivel1Block
            icon={<Eye className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Qué deberíamos vigilar de su liderazgo?"
            idea="Esto es un resumen para recordar lo que viste arriba — no una calificación del CEO ni una recomendación de inversión."
            visual={
              <ul className="space-y-1.5">
                {leadership.watch.slice(0, 3).map((item, i) => (
                  <li key={i} className="text-[14.5px] leading-5 flex gap-2" style={{ color: "var(--text)" }}>
                    <span style={{ color: GOLD }}>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </div>

      <div className="mt-6 text-center">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-industria`} className="text-[14.5px] font-bold" style={{ color: GOLD }}>
          → Fase 4: Entender la industria
        </a>
        <p className="text-[14.5px] mt-1" style={{ color: "var(--sub)" }}>
          Fases 5-7 (valuación, riesgos a vigilar, mi tesis) todavía no están construidas en este prototipo.
        </p>
      </div>

      <JourneyBottomNav ticker={data.ticker} phase={3} />
    </div>
  );
}
