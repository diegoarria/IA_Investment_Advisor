"use client";

// EntenderNegocioPreview — Nuvos Radar 2.0, Fase 1 of the 6-phase learning
// journey. Diego, 2026-11-15 ("SIMPLICIDAD RADICAL"): each block collapses
// to ONE title, ONE short sentence, ONE simple visual, and a single
// "Quiero entenderlo mejor" control — everything else (fuller explanation,
// other revenue sources, real figures, sources, limitations) lives behind
// that one expand. This is a simplification pass on the existing screen,
// not a rebuild: same data wiring, same ExpandRow/GlowCard primitives,
// radically fewer things visible by default. Resumen stays untouched.
//
// Every claim traces to real stored content: frontend/web/src/lib/
// previewContent/*.json (GOOGL v3 + the other 4 pilots' drafts, read-only,
// never altered/published here) or the real revenueBreakdown from the
// public financial-diagnostic endpoint. The 3-step ad flow in section B is
// a deliberate, Diego-approved conceptual simplification, GOOGL-only
// (gated by ticker, not inferred) — other tickers get their own real
// top-revenue-source fact, never a copy of GOOGL's diagram.

import type { ReactNode } from "react";
import { Fragment } from "react";
import { Package, DollarSign, Users, Server, Shield } from "lucide-react";
import { GlowCard, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";

/** Extracts just the first real sentence from a longer field (e.g.
 * `weakening_factors`, which can be a dense multi-paragraph legal narrative)
 * for Level-1 display — never a fabricated summary, only the text's own
 * first sentence up to a real sentence-ending period (one followed by a
 * space+uppercase letter or end of string, so abbreviations like "EE.UU."
 * never trigger a false cut). The rest goes to `rest`, for the expand. */
function firstSentence(text: string): { lead: string; rest: string | null } {
  const match = text.match(/^[\s\S]*?[.;](?=\s+[A-ZÁÉÍÓÚÑ]|$)/);
  if (!match || match[0].length >= text.length) return { lead: text, rest: null };
  const lead = match[0];
  const rest = text.slice(lead.length).trim();
  return { lead, rest: rest.length > 0 ? rest : null };
}

// Diego, 2026-11-15 ("más iconos, gráficos... que se vea bonito y
// organizado"): a touch of per-block color variety on top of the base
// gold/navy identity — used only as faint IconSquare/GlowCard tints (same
// low-opacity mechanism those primitives already use elsewhere), never as a
// data signal. Gold stays the dominant accent everywhere else (flow steps,
// revenue figures, the big capex number) — this is strictly decorative.
const BLOCK_BLUE = "#5B9BD5";
const BLOCK_GREEN = "#6FAE7D";
const BLOCK_STEEL = "#8B93B0";
import {
  ExpandRow,
  SourceLinks,
  type QualitativeContentDraft,
} from "@/components/subvaluadas/ResumenPreview";
import { PhaseJumpMenu, JourneyBottomNav } from "@/components/subvaluadas/JourneyNav";
import { fmtPrice } from "@/lib/types/stock";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

const ENTENDERLO_MEJOR = "Quiero entenderlo mejor";

/** Same marker-based split used by ResumenPreview's own splitBusinessSummary
 * — duplicated locally (not exported there) rather than touching that file. */
function splitOpener(raw: string): { opener: string; detail: string | null } {
  if (!raw) return { opener: "", detail: null };
  const marker = raw.indexOf("Dos referencias de período");
  if (marker === -1) return { opener: raw.trim(), detail: null };
  return { opener: raw.slice(0, marker).trim(), detail: raw.slice(marker).trim() };
}

/** One block = one icon+title, one short idea, one simple visual (children),
 * and — only when there is real additional depth — a single expand control
 * with the exact label Diego asked for. Nothing else is visible by default.
 * `iconColor` only tints the icon badge + card background faintly (same
 * mechanism GlowCard/IconSquare already use) — purely decorative variety,
 * never a data signal. `h-full flex flex-col` + `mt-auto` on the expand row
 * is what makes two blocks placed side by side in a grid line up their
 * "Quiero entenderlo mejor" control at the same height, regardless of how
 * long each block's idea sentence is. */
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
      {/* `flex-1 justify-center` is what gives a visually light block (e.g. a
         3-step flow, a single stat) the same intentional, centered weight as
         a denser sibling card of equal height — instead of top-aligning the
         content and leaving a dead empty void below it. */}
      <div className="flex-1 flex flex-col justify-center gap-4 py-3">
        <p className="text-[16px] leading-6 font-semibold" style={{ color: "var(--text)" }}>{idea}</p>
        {visual}
      </div>
      {expand && <ExpandRow headline={ENTENDERLO_MEJOR}>{expand}</ExpandRow>}
    </GlowCard>
  );
}

/** The one simple visual for "cómo gana dinero": three plain labeled steps,
 * no arrow captions, no extra nodes. A deliberate conceptual simplification
 * (Diego, 2026-11-15) — the fuller, more precise mechanism lives in expand. */
function SimpleFlow3({ steps }: { steps: string[] }) {
  return (
    // One connected sequence, always top-to-bottom: a vertical column with a
    // ↓ connector between every pair of steps — never a horizontal row that
    // can overflow a narrow card, never a dangling arrow.
    <div className="flex flex-col items-stretch gap-2">
      {steps.map((step, i) => (
        <Fragment key={step}>
          <div
            className="rounded-2xl px-4 py-3.5 flex items-center justify-center text-center text-[14.5px] font-bold leading-5"
            style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.35)", color: "var(--text)" }}
          >
            {step}
          </div>
          {i < steps.length - 1 && (
            <div className="flex items-center justify-center shrink-0 text-[16px]" style={{ color: "var(--sub)" }}>
              ↓
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** One real revenue fact highlighted as the visual itself — for tickers
 * whose business isn't the GOOGL ad model. No full bar list at Level 1. */
function TopRevenueFact({ rows }: { rows: { category: string; percentage: number }[] }) {
  if (rows.length === 0) return null;
  const top = [...rows].sort((a, b) => b.percentage - a.percentage)[0];
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="text-[32px] font-black tracking-tight" style={{ color: GOLD }}>{top.percentage.toFixed(0)}%</span>
      <span className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
        del ingreso viene de <strong style={{ color: "var(--text)" }}>{top.category}</strong>
      </span>
    </div>
  );
}

/** Full labeled bars — moved out of Level 1, only shown inside an expand. */
function RevenueBars({ rows }: { rows: { category: string; percentage: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.category}>
          <div className="flex justify-between text-[14.5px] mb-1">
            <span style={{ color: "var(--sub)" }}>{row.category}</span>
            <span className="font-bold" style={{ color: "var(--text)" }}>{row.percentage.toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.14)" }}>
            <div className="h-full rounded-full" style={{ width: `${row.percentage}%`, background: GOLD }} />
          </div>
        </div>
      ))}
      <p className="text-[11.5px] mt-1" style={{ color: "var(--sub)" }}>
        % del ingreso total más reciente reportado, por línea de negocio. Clasificación propia de Nuvos, no idéntica a los segmentos exactos del reporte oficial.
      </p>
    </div>
  );
}

/** Simple product chips for "qué vende" — real category names from
 * revenueBreakdown, no invented one-line descriptions per product. */
function ProductChips({ rows }: { rows: { category: string; percentage: number }[] }) {
  if (rows.length === 0) return null;
  return (
    // A real 2-column grid, not a ragged flex-wrap — every chip gets the
    // same cell width and a consistent min-height, so a name that wraps to
    // 2 lines sits just as intentionally as a 1-line neighbor instead of
    // breaking the row's alignment.
    <div className="grid grid-cols-2 gap-2.5">
      {rows.map((row) => (
        <span
          key={row.category}
          className="rounded-xl px-3.5 py-2.5 min-h-[46px] flex items-center justify-center text-center text-[14px] leading-[1.25] font-semibold"
          style={{ background: "rgba(127,127,127,0.08)", border: "1px solid var(--border)", color: "var(--text)" }}
        >
          {row.category}
        </span>
      ))}
    </div>
  );
}

/** The fuller real mechanism — used to live in Level 1, now lives behind
 * "Quiero entenderlo mejor" for GOOGL's "cómo gana dinero" block. */
function AdModelDetail() {
  return (
    <div className="space-y-2.5">
      <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
        La persona que busca en Google no es quien le paga — Alphabet no le cobra por usar el buscador. Quien
        paga directamente es el anunciante, por el espacio publicitario. Por separado, una empresa que usa
        Google Cloud paga directamente por el cómputo que consume — un negocio distinto al de publicidad.
        Una porción menor de ingresos sí viene de una persona pagando directamente, como YouTube Premium o
        un teléfono Pixel.
      </p>
    </div>
  );
}

export function EntenderNegocioPreview({
  data, editorial,
}: { data: FullCompanyDiagnosticData; editorial: QualitativeContentDraft | null }) {
  const { opener, detail } = editorial ? splitOpener(editorial.business_model_summary) : { opener: "", detail: null };
  const moat = editorial?.moat ?? [];
  const topMoat = moat[0];
  const otherMoats = moat.slice(1);
  const isGoogleAdModel = data.ticker === "GOOGL";
  // Real capex guidance, lifted verbatim from the (already fact-checked)
  // rentabilidad risk entry — used only for "qué necesita para operar",
  // never re-explained in the depth Riesgos already covers. Only rendered
  // when a real matching entry exists for this ticker — never synthesized.
  const capexRisk = editorial?.risks.find((r) => r.category === "rentabilidad" && /capex|inversión de capital/i.test(r.explanation));

  if (!editorial) {
    return (
      <GlowCard>
        <p className="text-[17px] italic" style={{ color: "var(--sub)" }}>
          Todavía no hay contenido editorial (publicado o en vista previa) para {data.ticker} — esta fase depende de ese
          contenido y no puede construirse sin inventar información.
        </p>
      </GlowCard>
    );
  }

  return (
    <div className="max-w-[760px] mx-auto pb-10">
      <div
        className="rounded-xl px-3.5 py-2.5 mb-4 text-[13.5px] font-bold text-center"
        style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
      >
        Prototipo interno — Radar 2.0, Fase 1 de 7 ({editorial.review_status === "published" ? "contenido publicado" : `borrador, ${editorial.review_status}`}), no visible para usuarios reales.
      </div>

      {/* Encabezado */}
      <div className="flex items-center justify-between gap-4 mb-2">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}`} className="text-[14.5px] font-bold" style={{ color: "var(--sub)" }}>
          ← Volver a Resumen
        </a>
        <PhaseJumpMenu ticker={data.ticker} phase={1} />
      </div>
      <div className="flex items-center gap-3.5 mb-8">
        <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
        <div className="min-w-0">
          <p className="text-[26px] font-black tracking-tight" style={{ color: "var(--text)" }}>Entender el negocio</p>
          <p className="text-[14.5px]" style={{ color: "var(--sub)" }}>
            {data.companyName} · {data.ticker} · {data.sector}
            {data.valuation.currentPrice != null && <> · {fmtPrice(data.valuation.currentPrice)}</>}
          </p>
        </div>
      </div>

      {/* Diego, 2026-11-15: 2 cajas a la misma altura por fila — Qué vende /
         Cómo gana dinero, luego Quiénes son sus clientes / Por qué la eligen
         (o solo "Por qué la eligen" a lo ancho si el bloque C no aplica para
         este ticker). Grid colapsa a 1 columna en mobile como en el resto de
         las pantallas de esta sesión. `items-stretch` + `h-full flex flex-col`
         en cada tarjeta es lo que las empareja en altura. */}
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 items-stretch">
          {/* A. Qué vende */}
          <Nivel1Block
            icon={<Package className="w-4 h-4" style={{ color: GOLD }} />}
            title="¿Qué vende?"
            idea={opener}
            visual={<ProductChips rows={data.revenueBreakdown} />}
            expand={data.revenueBreakdown.length > 0 ? <RevenueBars rows={data.revenueBreakdown} /> : undefined}
          />

          {/* B. Cómo gana dinero */}
          <Nivel1Block
            icon={<DollarSign className="w-4 h-4" style={{ color: GOLD }} />}
            title={isGoogleAdModel ? "¿Cómo gana dinero Google?" : "¿Cómo gana dinero?"}
            idea={isGoogleAdModel ? "Su principal negocio es la publicidad." : opener}
            visual={
              isGoogleAdModel
                ? <SimpleFlow3 steps={["Personas usan Google", "Empresas anuncian", "Google cobra"]} />
                : <TopRevenueFact rows={data.revenueBreakdown} />
            }
            expand={
              <div className="space-y-3">
                {isGoogleAdModel && <AdModelDetail />}
                {detail && <p className="text-[16px] leading-5 whitespace-pre-line" style={{ color: "var(--sub)" }}>{detail}</p>}
              </div>
            }
          />
        </div>

        <div className={isGoogleAdModel ? "grid gap-6 md:grid-cols-2 items-stretch" : undefined}>
          {/* C. Quiénes son sus clientes — solo para el modelo publicitario de
             GOOGL, donde la distinción usuario-gratis vs. cliente-que-paga es
             real y material; para el resto, esa distinción ya quedó cubierta
             en el bloque B con su propio texto real, no se fuerza aquí. */}
          {isGoogleAdModel && (
            <Nivel1Block
              icon={<Users className="w-4 h-4" style={{ color: BLOCK_BLUE }} />}
              iconColor={BLOCK_BLUE}
              title="¿Quiénes son sus clientes?"
              idea="No todas las personas que usan un producto de Alphabet son, en sentido estricto, sus clientes."
              visual={
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl p-3.5" style={{ background: "rgba(127,127,127,0.06)", border: "1px solid var(--border)" }}>
                    <p className="text-[12px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>No le pagan directamente</p>
                    <p className="text-[14.5px] leading-5" style={{ color: "var(--text)" }}>Personas que usan Google Search o YouTube de forma gratuita.</p>
                  </div>
                  <div className="rounded-2xl p-3.5" style={{ background: "rgba(212,162,76,0.1)", border: "1px solid rgba(212,162,76,0.4)" }}>
                    <p className="text-[12px] font-black uppercase tracking-wide mb-1.5" style={{ color: GOLD }}>Sí le pagan directamente</p>
                    <p className="text-[14.5px] leading-5" style={{ color: "var(--text)" }}>Anunciantes, empresas clientes de Google Cloud, y personas con una suscripción (YouTube Premium) o un dispositivo (Pixel).</p>
                  </div>
                </div>
              }
            />
          )}

          {/* D. Por qué la eligen — una sola ventaja principal visible; el
             resto y la evidencia viven en el expand. */}
          {topMoat ? (
            <Nivel1Block
              icon={<Shield className="w-4 h-4" style={{ color: BLOCK_GREEN }} />}
              iconColor={BLOCK_GREEN}
              title="¿Por qué la eligen?"
              idea={topMoat.explanation}
              visual={
                topMoat.weakening_factors ? (
                  <div className="rounded-2xl p-3.5" style={{ background: "rgba(127,127,127,0.05)", border: "1px solid var(--border)" }}>
                    <p className="text-[12px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>Por qué no es fácil de copiar</p>
                    <p className="text-[14.5px] leading-5" style={{ color: "var(--sub)" }}>
                      {firstSentence(topMoat.weakening_factors).lead}
                    </p>
                  </div>
                ) : undefined
              }
              expand={
                <div className="space-y-3">
                  {topMoat.weakening_factors && firstSentence(topMoat.weakening_factors).rest && (
                    <div>
                      <p className="text-[13px] font-bold mb-1" style={{ color: "var(--sub)" }}>Por qué no es fácil de copiar (completo)</p>
                      <p className="text-[16px] leading-5" style={{ color: "var(--sub)" }}>
                        {firstSentence(topMoat.weakening_factors).rest}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[13px] font-bold mb-1" style={{ color: "var(--sub)" }}>Evidencia</p>
                    <p className="text-[16px] leading-5" style={{ color: "var(--sub)" }}>{topMoat.evidence}</p>
                    <SourceLinks raw={topMoat.source_name} />
                  </div>
                  {otherMoats.map((m, i) => (
                    <div key={i} className="pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <p className="text-[14.5px] leading-5 font-semibold" style={{ color: "var(--text)" }}>{m.explanation}</p>
                      {m.weakening_factors && <p className="text-[16px] leading-5 mt-1" style={{ color: "var(--sub)" }}>{m.weakening_factors}</p>}
                      <SourceLinks raw={m.source_name} />
                    </div>
                  ))}
                </div>
              }
            />
          ) : (
            <Nivel1Block
              icon={<Shield className="w-4 h-4" style={{ color: BLOCK_GREEN }} />}
              iconColor={BLOCK_GREEN}
              title="¿Por qué la eligen?"
              idea="Ventajas competitivas no disponibles todavía para esta empresa."
            />
          )}
        </div>

        {/* E. Qué necesita para operar — solo si existe un hecho real
           coincidente para este ticker; nunca una plantilla genérica. A lo
           ancho: es el bloque impar, no tiene pareja. */}
        {capexRisk && (
          <Nivel1Block
            icon={<Server className="w-4 h-4" style={{ color: BLOCK_STEEL }} />}
            iconColor={BLOCK_STEEL}
            title="¿Qué necesita para operar?"
            idea="Un negocio de esta escala requiere una inversión constante en infraestructura."
            visual={
              <div>
                <p className="text-[28px] font-black tracking-tight" style={{ color: GOLD }}>$195–205 mil millones</p>
                <p className="text-[13.5px] mt-1" style={{ color: "var(--sub)" }}>guía de inversión de capital (capex) para 2026, principalmente en centros de datos y cómputo</p>
              </div>
            }
            expand={
              <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>
                El detalle completo de este tema — incluyendo por qué importa y qué vigilar — vive en la pestaña Riesgos, no se repite aquí.
              </p>
            }
          />
        )}
      </div>

      <div className="mt-6 text-center">
        <a href={`/subvaluadas/resumen-preview/${data.ticker}/entender-finanzas`} className="text-[14.5px] font-bold" style={{ color: GOLD }}>
          → Fase 2: Entender las finanzas
        </a>
        <p className="text-[14.5px] mt-1" style={{ color: "var(--sub)" }}>
          Fases 3-7 (liderazgo, industria, valuación, riesgos a vigilar, mi tesis) todavía no están construidas en este prototipo.
        </p>
      </div>

      <JourneyBottomNav ticker={data.ticker} phase={1} />
    </div>
  );
}
