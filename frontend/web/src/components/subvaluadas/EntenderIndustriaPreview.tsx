"use client";

// EntenderIndustriaPreview — Nuvos Radar 2.0, Fase 4 of the 6-phase learning
// journey. Diego, 2026-11-15: "LA FASE 4 DEBE UTILIZAR EXACTAMENTE EL MISMO
// SISTEMA VISUAL Y EDUCATIVO" as Fases 1-3. Every visual pattern here is
// copied from the real, current EntenderNegocioPreview.tsx /
// EntenderFinanzasPreview.tsx / ConocerLiderazgoPreview.tsx (card width/
// padding, title size, the "one idea + one simple visual + Quiero
// entenderlo mejor" rhythm, the vertical ↓ step-flow language, the
// 2-column grid with vertically-centered card content, the decorative
// icon-tint palette) — duplicated locally rather than importing from those
// files, the same convention Fases 2-3 already used. Fases 1-3 are
// untouched by this file except for one explicit, minimal, reported
// addition to Fase 3's own closing note (see that file's own comment).
//
// All industry/competitive content comes from REAL, sourced research
// (frontend/web/src/lib/previewContent/industry/*.json) — Synergy Research
// Group's real cloud-market figures (same ones already fact-checked in the
// Riesgos tab's editorial content), Alphabet's real Q3 2026 earnings
// coverage, and fresh 2026-11-15 web research for section B's market-
// growth figures. Several claims carry an explicit lower-confidence/
// "no verificado" note where a primary source could not be reached
// (eMarketer/Synergy's own pages returned 403/429 to automated fetches) —
// never guessed to fill the gap. GOOGL is the only pilot with real research
// this round; every other ticker gets an honest "contenido no construido
// todavía" state, never GOOGL's specific competitors/figures.
//
// No new financial-engine field, no Supabase write, no live recompute —
// this screen's only real-time data dependency is the same already-
// persisted `companyDiagnosticPublic` ticker/sector/price header every
// other Radar 2.0 screen already uses.
//
// 2026-11-15, Fase 5 round: the closing note below now links forward to
// the real Fase 5 route (same minimal, one-line pattern every phase this
// session has used to link into the next one) — no other change to this
// file.

import type { ReactNode } from "react";
import { Fragment } from "react";
import { Swords, BarChart3, Shield, Sparkles, Eye } from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { ExpandRow, SourceLinks } from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import { fmtPrice } from "@/lib/types/stock";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const ENTENDERLO_MEJOR = "Quiero entenderlo mejor";

// Same decorative, non-data-signal color variety Fases 1-3 introduced —
// gold stays dominant for every real figure, these only tint icon/card
// accents.
const BLOCK_BLUE = "#5B9BD5";
const BLOCK_GREEN = "#6FAE7D";
const BLOCK_STEEL = "#8B93B0";

interface IndustryContent {
  ticker: string;
  competitors: {
    segment: string;
    rivals: string[];
    note: string;
    source_name: string;
    confidence: "alta" | "media" | "baja";
  }[];
  market_growth: {
    // Generic by design — a company's real market-growth findings vary in
    // count/topic (GOOGL has 2: cloud + advertising; others may have 1 or
    // 0 when no real sourceable figure was found this round). Never a
    // fixed cloud/advertising shape forced onto every ticker.
    findings?: { label: string; finding: string; figure_note: string; source_document_date: string | null; source_accessed_at: string; confidence: "alta" | "media" | "baja" }[];
    // Legacy GOOGL shape, still read if `findings` is absent.
    cloud?: { finding: string; figure_note: string; source_document_date: string | null; source_accessed_at: string; confidence: "alta" | "media" | "baja" };
    advertising?: { finding: string; figure_note: string; source_document_date: string | null; source_accessed_at: string; confidence: "alta" | "media" | "baja" };
    note?: string;
    distinction_note: string;
  };
  competitive_strength: {
    rival: string;
    evidence: string;
    caveat: string;
    source_name: string;
    confidence: "alta" | "media" | "baja";
  }[];
  industry_shifts: {
    change: string;
    what_it_means: string;
    // Generic field name — this content applies to whatever ticker the
    // fixture is for, never hardcoded to GOOGL.
    effect_on_company: string;
    is_prediction: boolean;
    source_name: string;
    confidence: "alta" | "media" | "baja";
  }[];
  watch: string[];
}

/** Same card wrapper as Fases 1-3's `Nivel1Block`. */
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

/** A. "¿Contra quién compite?" visual — one row per business segment,
 * showing that the same company has different rivals depending on the
 * product. No market-share numbers here (those belong to section C, where
 * real evidence exists) — just a verified name list. */
function CompetitorRows({ rows }: { rows: IndustryContent["competitors"] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.segment} className="rounded-xl px-3 py-2.5" style={{ background: "rgba(127,127,127,0.05)", border: "1px solid var(--border)" }}>
          <p className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>{row.segment}</p>
          <div className="flex flex-wrap gap-1.5">
            {row.rivals.map((rival) => (
              <span
                key={rival}
                className="rounded-full px-2.5 py-1 text-[12px] font-bold"
                style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.3)", color: "var(--text)" }}
              >
                {rival}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** C/D visual — the same always-vertical ↓-connected step language Fases
 * 1-3 use for any real sequential relationship, here for CAMBIO → QUÉ
 * SIGNIFICA → EFECTO EN LA EMPRESA. Reused for section D too, since a
 * forward-looking shift maps onto the same 3-step shape. */
function ChangeEffectSteps({ change, meaning, effect }: { change: string; meaning: string; effect: string }) {
  const steps = [
    { label: "Cambio", text: change },
    { label: "Qué significa para la industria", text: meaning },
    { label: "Posible efecto en la empresa", text: effect },
  ];
  return (
    <div className="flex flex-col items-stretch gap-2">
      {steps.map((step, i) => (
        <Fragment key={step.label}>
          <div className="rounded-2xl px-3.5 py-3" style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.35)" }}>
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

/** C. "¿Qué tan fuerte es frente a sus competidores?" visual — one real
 * rival + real evidence + an honest caveat, never a comparative score. */
function RivalEvidenceBox({ rival, evidence, caveat }: { rival: string; evidence: string; caveat: string }) {
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "rgba(127,127,127,0.06)", border: "1px solid var(--border)" }}>
      <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: GOLD }}>Frente a {rival}</p>
      <p className="text-[13.5px] leading-5" style={{ color: "var(--text)" }}>{evidence}</p>
      <p className="text-[12px] leading-4 mt-1.5 italic" style={{ color: "var(--sub)" }}>{caveat}</p>
    </div>
  );
}

export function EntenderIndustriaPreview({
  data, industry,
}: { data: FullCompanyDiagnosticData; industry: IndustryContent | null }) {
  if (!industry) {
    return (
      <GlowCard>
        <p className="text-[17px] italic" style={{ color: "var(--sub)" }}>
          Todavía no hay contenido investigado y verificado sobre la industria y competencia de {data.ticker} — esta
          fase depende de esa investigación real y no puede construirse sin inventar información.
        </p>
      </GlowCard>
    );
  }

  const mainRival = industry.competitive_strength[0];
  const secondRival = industry.competitive_strength[1];
  const shift = industry.industry_shifts[0];

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[13.5px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 4 de 7, no visible para usuarios reales.
      </div>

      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/conocer-liderazgo`} className="text-[14.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Conocer a quienes dirigen
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={4} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[26px] font-black tracking-tight" style={{ color: "var(--text)" }}>Entender la industria</p>
          <p className="text-[14.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {data.valuation?.currentPrice != null && <> · {fmtPrice(data.valuation.currentPrice)}</>}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* A. ¿Contra quién compite? */}
          <Nivel1Block
            icon={<Swords className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Contra quién compite?"
            idea="Alphabet participa en varios negocios distintos, y tiene competidores diferentes según el producto."
            visual={<CompetitorRows rows={industry.competitors} />}
            expand={
              <div className="space-y-3">
                {industry.competitors.map((row) => (
                  <div key={row.segment}>
                    <p className="text-[13px] font-bold mb-1" style={{ color: "var(--sub)" }}>{row.segment}</p>
                    <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{row.note}</p>
                    <SourceLinks raw={row.source_name} />
                  </div>
                ))}
              </div>
            }
          />

          {/* B. ¿Está creciendo su mercado? — `findings` is generic (any
             number of real market-growth findings); GOOGL's legacy
             `cloud`/`advertising` shape is normalized into the same list
             so the render never special-cases a ticker. */}
          {(() => {
            const mg = industry.market_growth;
            const findings =
              mg.findings ??
              [
                mg.cloud ? { label: "Mercado de nube", ...mg.cloud } : null,
                mg.advertising ? { label: "Mercado publicitario", ...mg.advertising } : null,
              ].filter((f): f is NonNullable<typeof f> => f != null);
            const lead = findings[0];
            if (!lead) return null;
            return (
              <Nivel1Block
                icon={<BarChart3 className="w-4 h-4" style={{ color: BLOCK_BLUE }} />}
                iconColor={BLOCK_BLUE}
                title="¿Está creciendo su mercado?"
                idea={lead.finding}
                visual={
                  <div className="rounded-2xl p-3.5" style={{ background: "rgba(91,155,213,0.08)", border: "1px solid rgba(91,155,213,0.3)" }}>
                    <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: BLOCK_BLUE }}>Importante</p>
                    <p className="text-[12.5px] leading-5" style={{ color: "var(--text)" }}>{mg.distinction_note}</p>
                  </div>
                }
                expand={
                  <div className="space-y-3">
                    {mg.note && <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{mg.note}</p>}
                    {findings.map((f) => (
                      <div key={f.label}>
                        <p className="text-[13px] font-bold mb-1" style={{ color: "var(--sub)" }}>{f.label}</p>
                        <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{f.figure_note}</p>
                      </div>
                    ))}
                  </div>
                }
              />
            );
          })()}
        </div>

        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* C. ¿Qué tan fuerte es frente a sus competidores? */}
          {mainRival && (
            <Nivel1Block
              icon={<Shield className="w-4 h-4" style={{ color: BLOCK_GREEN }} />}
              iconColor={BLOCK_GREEN}
              title="¿Qué tan fuerte es frente a sus competidores?"
              idea="Sus ventajas no se entienden en abstracto — se entienden frente a rivales concretos."
              visual={<RivalEvidenceBox rival={mainRival.rival} evidence={mainRival.evidence} caveat={mainRival.caveat} />}
              expand={
                <div className="space-y-3">
                  <SourceLinks raw={mainRival.source_name} />
                  {secondRival && (
                    <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: GOLD }}>Frente a {secondRival.rival}</p>
                      <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{secondRival.evidence}</p>
                      <p className="text-[12px] leading-4 mt-1 italic" style={{ color: "var(--sub)" }}>{secondRival.caveat}</p>
                      <SourceLinks raw={secondRival.source_name} />
                    </div>
                  )}
                </div>
              }
            />
          )}

          {/* D. ¿Qué podría cambiar su industria? */}
          {shift && (
            <Nivel1Block
              icon={<Sparkles className="w-4 h-4" style={{ color: BLOCK_STEEL }} />}
              iconColor={BLOCK_STEEL}
              title="¿Qué podría cambiar su industria?"
              idea={shift.is_prediction ? "Esto es un cambio en desarrollo — no una certeza ya confirmada." : "Esto ya es un hecho, no una hipótesis futura."}
              visual={<ChangeEffectSteps change={shift.change} meaning={shift.what_it_means} effect={shift.effect_on_company} />}
              expand={
                <div className="space-y-2">
                  <SourceLinks raw={shift.source_name} />
                  {industry.industry_shifts[1] && (
                    <div className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <p className="text-[13.5px] leading-5 font-semibold" style={{ color: "var(--text)" }}>{industry.industry_shifts[1].change}</p>
                      <p className="text-[13px] leading-5 mt-1" style={{ color: "var(--sub)" }}>{industry.industry_shifts[1].effect_on_company}</p>
                      <SourceLinks raw={industry.industry_shifts[1].source_name} />
                    </div>
                  )}
                </div>
              }
            />
          )}
        </div>

        {/* E. ¿Qué deberíamos vigilar? */}
        {industry.watch.length > 0 && (
          <Nivel1Block
            icon={<Eye className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Qué deberíamos vigilar?"
            idea="Esto es un resumen para recordar lo que viste arriba — no repite todos los riesgos de la pestaña Riesgos."
            visual={
              <ul className="space-y-1.5">
                {industry.watch.slice(0, 3).map((item, i) => (
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
        <p className="text-[14.5px]" style={{ color: "var(--sub)" }}>
          →{" "}
          <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-valuacion`} className="font-bold" style={{ color: GOLD }}>
            Fase 5: Entender la valuación
          </a>
          . Fases 6-7 (riesgos a vigilar, mi tesis) todavía no están integradas a este recorrido guiado.
        </p>
      </div>

      <JourneyBottomNav ticker={data.ticker} phase={4} />
    </div>
  );
}
