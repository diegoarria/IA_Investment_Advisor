"use client";

// ResumenPreview — Nuvos Radar "Resumen" prototype, FOURTH iteration / final
// polish pass (local dev only — NOT wired into the real ficha yet, NOT
// reachable by real users). Diego, 2026-11-12: "Entiende primero.
// Profundiza cuando quieras".
//
// Iteration 4 fixes exactly Diego's 4 flagged issues on top of iteration 3's
// approved layout/nav/style (content/data work from earlier rounds is
// unchanged):
//
// 1. Empty-space bug: the old 12-col CSS grid auto-placed multiple items
//    into shared row tracks, so a short item (the business-model opener)
//    got stretched to the height of whatever tall item landed in the same
//    row (the "Calidad del negocio" card) — `items-start` only controls
//    alignment WITHIN a cell, not the row-track height itself. Fixed by
//    collapsing each column into exactly ONE grid item (a flex column
//    holding all of that column's cards with its own gap), so row-track
//    matching no longer applies at all.
//
// 2. "Calidad del negocio" no longer renders `data.scoreLabel` (the
//    backend's composite string, which blends business quality with a
//    cheap/expensive verdict — real string, e.g. "Buen negocio, cara").
//    Replaced with a neutral, methodology-grounded explanation + a
//    breakdown of the REAL pillarScores, explicitly EXCLUDING the "value"
//    pillar (the one pillar that *is* about price attractiveness — leaving
//    it out of this specific card is what actually fixes the conflation,
//    not just hiding a label). No backend change, no new/fabricated score.
//
// 3. Contrast: `var(--dim)` (#2a3f58, ~1.8:1 against the card background —
//    fails WCAG AA even for large text) and `var(--muted)` (#546b85,
//    ~3.5:1 — fails the 4.5:1 normal-text AA threshold, though it clears
//    the 3:1 UI-component/large-text one) were both used for real body
//    copy (captions, methodology notes, chart labels, source chips,
//    section titles). Real body text now uses `var(--sub)` (#8fa3c0,
//    ~7.4:1 — clears AA with margin) throughout. `var(--muted)` is kept
//    only for genuine UI-chrome (icons, dividers, disabled nav labels —
//    WCAG explicitly exempts inactive controls from the contrast
//    requirement).
//
// 4. Price-vs-value card: removed the large colored circular icon + full-
//    width verdict pill ("Posiblemente sobrevalorada") as the dominant
//    element. Scenario numbers now lead; the % difference is a small,
//    inline, modestly-colored label next to the base-case figure — never
//    full-width, never icon-accented. Added an explicit assumptions
//    caveat and the real quote date when the API actually provides one
//    (`data.valuationAsOf`) — never a fabricated date; when that field is
//    absent (the normal case for a fresh full diagnostic), the caveat
//    states the price is a live quote without inventing a specific date.
//
// Content/data logic carried over unchanged from iteration 2-3: short
// business-model opener extracted from the real stored text (not
// invented), financial-period detail + full moat/risk evidence + sources
// behind ExpandRow accordions, SourceLinks renders citations as short
// clickable chips (never a raw URL in body text), top-3-of-N risks picked
// by materiality (fact_type=hecho + confidence=alta first, N may be fewer
// than 3 — never assume a fixed moat/risk count per Diego's standing
// editorial-materiality policy) with any remainder reported as deferred
// (not deleted from the content). Headlines: see ROUND 5 note below.
//
// Never fabricates a number or a new claim: every figure comes straight
// from `data` or the real editorial fixture; every headline is a
// rephrasing of real stored text, never a new claim; every date shown is a
// real field, never invented.
//
// ROUND 5 — "universalizar por ticker" (2026-11-12): generalized from
// GOOGL-only to any ticker. Removed the two hand-written GOOGL-specific
// headline-override tables (headlines are now always derived generically
// via headlineFrom, per Diego's "evita condicionales específicos como
// ticker === GOOGL"). Fixed the quality-score card's honesty gap Diego
// flagged: confirmed in company_diagnostic_service.py that the single
// `score` number is `round(sum(pillar_scores.values()) / 4)` — it DOES
// blend in the `value` (margin-of-safety) pillar at 25% weight, so titling
// it "Calidad del negocio" misrepresented it even with that pillar hidden
// from the breakdown. Renamed to "Score Nuvos" with an honest 4-axis
// explanation; the breakdown still shows only quality/trust/simplicity
// (the price axis has its own card below, not duplicated here). No
// algorithm change, no alternative score invented — same real `data.score`
// number, better-labeled.

import { useState, type ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { GlowCard, RingGauge, IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
import { fmtPrice } from "@/lib/types/stock";
import { _valuationStatus, _VERDICT_COLOR } from "@/components/subvaluadas/shared";
import type { FullCompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

type FactType = "hecho" | "interpretacion" | "escenario_hipotetico";
type Confidence = "alta" | "media" | "baja";

interface QualitativeMoat {
  type: string;
  explanation: string;
  evidence: string;
  weakening_factors: string;
  source_name: string;
  source_document_date: string | null;
  source_accessed_at: string | null;
  confidence: Confidence;
}

export interface QualitativeRisk {
  category: string;
  fact_type: FactType;
  explanation: string;
  evidence: string;
  watch_indicator: string;
  uncertainty: string;
  source_name: string;
  source_document_date: string | null;
  source_accessed_at: string | null;
  confidence: Confidence;
}

export interface QualitativeContentDraft {
  ticker: string;
  review_status: string;
  is_current: boolean;
  business_model_summary: string;
  moat: QualitativeMoat[];
  risks: QualitativeRisk[];
}

export const _FACT_TYPE_LABEL: Record<FactType, string> = {
  hecho: "Hecho",
  interpretacion: "Interpretación",
  escenario_hipotetico: "Escenario hipotético",
};
export const _FACT_TYPE_COLOR: Record<FactType, string> = {
  hecho: "#22c55e",
  interpretacion: "#D4A24C",
  escenario_hipotetico: "#8C97AD",
};
export const _CONFIDENCE_LABEL: Record<Confidence, string> = { alta: "Confianza alta", media: "Confianza media", baja: "Confianza baja" };
export const _CONFIDENCE_COLOR: Record<Confidence, string> = { alta: "#22c55e", media: "#D4A24C", baja: "#8C97AD" };
const _MOAT_TYPE_LABEL: Record<string, string> = {
  scale: "Escala y distribución",
  network_effect: "Efecto de red",
  switching_costs: "Costos de cambio",
  brand: "Marca",
  patents: "Patentes",
  regulatory: "Posición regulatoria",
};
export const _RISK_CATEGORY_LABEL: Record<string, string> = {
  competencia: "Competencia",
  regulacion: "Regulación",
  rentabilidad: "Rentabilidad",
  deuda_liquidez: "Deuda y liquidez",
  concentracion_clientes: "Concentración de clientes",
  tecnologia_disrupcion: "Tecnología y disrupción",
  ejecucion_operativa: "Ejecución operativa",
  riesgo_sectorial: "Riesgo del sector",
};

/** Truncates at a word boundary — the universal headline derivation for
 * every ticker (no per-company hand-written overrides: a prior GOOGL-only
 * round had those, removed on 2026-11-12 when this screen was generalized
 * to work with any ticker's real content, per Diego's "evita condicionales
 * específicos como ticker === GOOGL" instruction). A TRANSFORMATION of the
 * real stored text, never new prose. */
export function headlineFrom(text: string, maxLen = 100): string {
  if (!text) return "";
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  const window = clean.slice(0, maxLen + 20);
  const breakMatch = window.match(/^.{20,}?[.;—]/);
  if (breakMatch && breakMatch[0].length <= maxLen + 15) {
    return breakMatch[0].replace(/[.;—]$/, "").trim() + "…";
  }
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

/** Splits the real, already-approved business_model_summary into: a short
 * plain-language opener (derived, not invented — the summary's own first
 * sentence(s) before any period-specific figures start), and the full
 * financial-period detail (kept 100% verbatim, just moved behind an expand
 * instead of shown inline by default). */
function splitBusinessSummary(raw: string): { opener: string; detail: string | null } {
  if (!raw) return { opener: "", detail: null };
  const marker = raw.indexOf("Dos referencias de período");
  if (marker === -1) return { opener: raw.trim(), detail: null };
  return { opener: raw.slice(0, marker).trim(), detail: raw.slice(marker).trim() };
}

/** Picks the 3 most material risks for the Resumen summary (Diego, round 3:
 * "presentar los tres riesgos más relevantes en Resumen"). Ranks by
 * fact_type (hecho > interpretacion > escenario_hipotetico) then confidence
 * (alta > media > baja) — materiality + certainty drive prominence. The
 * other 2 are NOT deleted from the fixture, just not rendered here. */
function risksForSummary(risks: QualitativeRisk[]): { shown: { risk: QualitativeRisk; index: number }[]; deferredCount: number } {
  const factRank: Record<FactType, number> = { hecho: 0, interpretacion: 1, escenario_hipotetico: 2 };
  const confRank: Record<Confidence, number> = { alta: 0, media: 1, baja: 2 };
  const ranked = risks
    .map((risk, index) => ({ risk, index }))
    .sort((a, b) => factRank[a.risk.fact_type] - factRank[b.risk.fact_type] || confRank[a.risk.confidence] - confRank[b.risk.confidence]);
  return { shown: ranked.slice(0, 3), deferredCount: Math.max(0, risks.length - 3) };
}

/** Parses a `source_name` field that embeds one or more "label: url"
 * citations separated by " ; " — real data already produced this shape in
 * the stored editorial content. Renders as short labels, never prints a
 * full URL in the body. */
export function parseSources(raw: string): { label: string; url: string | null }[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const match = seg.match(/https?:\/\/\S+/);
      const url = match ? match[0].replace(/[),.]+$/, "") : null;
      let label = url ? seg.replace(url, "") : seg;
      label = label.replace(/[:,]\s*$/, "").trim();
      if (!label && url) {
        try {
          label = new URL(url).hostname.replace(/^www\./, "");
        } catch {
          label = "Fuente";
        }
      }
      if (label.length > 34) label = label.slice(0, 32).trim() + "…";
      return { label: label || "Fuente", url };
    });
}

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-2 py-[3px] rounded-full text-[10px] font-extrabold uppercase tracking-wide shrink-0"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}
    >
      {label}
    </span>
  );
}

export function SourceLinks({ raw }: { raw: string }) {
  const sources = parseSources(raw);
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2.5">
      {sources.map((s, i) =>
        s.url ? (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold"
            style={{ background: "var(--raised)", color: "var(--sub)", border: "1px solid var(--border)" }}
          >
            {s.label} <ExternalLink className="w-2.5 h-2.5" style={{ color: "var(--muted)" }} />
          </a>
        ) : (
          <span key={i} className="inline-flex items-center px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background: "var(--raised)", color: "var(--sub)" }}>
            {s.label}
          </span>
        )
      )}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="text-[13px] font-black uppercase tracking-wide mb-3" style={{ color: "var(--sub)" }}>{children}</p>;
}

/** Collapsed-by-default row: a short headline + chevron, expands to reveal
 * the full original content. Core de-densifying primitive — nothing long
 * renders without one of these. Touch target is the full-width button
 * (≥44px tall via py-3 + line-height) so it stays comfortable on mobile. */
export function ExpandRow({ headline, eyebrow, eyebrowColor, children, defaultOpen = false }: {
  headline: string; eyebrow?: string; eyebrowColor?: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-3" style={{ borderTop: "1px solid var(--border)" }}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-start justify-between gap-2.5 text-left min-h-[44px]">
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-extrabold uppercase tracking-wide mb-1" style={{ color: eyebrowColor ?? "var(--sub)" }}>{eyebrow}</p>}
          <p className="text-[13.5px] leading-5 font-semibold" style={{ color: "var(--text)" }}>{headline}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--muted)" }} /> : <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--muted)" }} />}
      </button>
      {open && <div className="mt-2.5 pl-0.5">{children}</div>}
    </div>
  );
}

// 4-tab navigation placeholder, integrated into the header. Only Resumen is
// interactive today; the other 3 reuse this same visual slot instead of
// floating disabled buttons at the page bottom. Disabled tabs are exempt
// from WCAG's contrast requirement (1.4.3 excludes inactive UI components)
// — left at --dim deliberately, since a disabled control isn't meant to be
// read closely, only recognized as present-but-unavailable.
// Exported (round 6 — Valuación tab) so the Valuación screen can render the
// same nav slot with "valuacion" active, instead of forking a second copy.
export function TabNav({ active, ticker }: { active: "resumen" | "valuacion" | "riesgos" | "tesis"; ticker: string }) {
  const tabs: { key: typeof active; label: string; href: string | null }[] = [
    { key: "resumen", label: "Resumen", href: `/subvaluadas/resumen-preview/${ticker}` },
    { key: "valuacion", label: "Valuación", href: `/subvaluadas/resumen-preview/${ticker}/valuacion` },
    { key: "riesgos", label: "Riesgos", href: `/subvaluadas/resumen-preview/${ticker}/riesgos` },
    { key: "tesis", label: "Mi tesis", href: `/subvaluadas/resumen-preview/${ticker}/mi-tesis` },
  ];
  return (
    <div className="flex gap-1 p-1 rounded-xl w-full sm:w-auto" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
      {tabs.map((t) => {
        const isActive = t.key === active;
        const isBuilt = t.href !== null;
        const content = (
          <span
            className="flex-1 sm:flex-none px-3.5 py-2 rounded-lg text-[12.5px] font-extrabold transition-colors flex items-center justify-center min-h-[40px]"
            style={isActive ? { background: GOLD, color: "#1a1206" } : { color: isBuilt ? "var(--sub)" : "var(--dim)" }}
          >
            {t.label}
          </span>
        );
        if (isActive || !isBuilt) {
          return (
            <button
              key={t.key}
              disabled={!isActive}
              className="flex-1 sm:flex-none disabled:cursor-not-allowed"
              title={isActive ? undefined : isBuilt ? undefined : "Todavía no construido en este prototipo"}
            >
              {content}
            </button>
          );
        }
        return (
          <a key={t.key} href={t.href!} className="flex-1 sm:flex-none">
            {content}
          </a>
        );
      })}
    </div>
  );
}

// "Calidad del negocio" pillar breakdown — deliberately excludes the
// "value" pillar (the one axis that *is* about price attractiveness).
// Showing quality/trust/simplicity here, and nowhere mixing in "value" or
// the backend's composite scoreLabel string, is what actually keeps this
// card answering only "how sound is the business on its own merits" rather
// than quietly re-introducing a cheap/expensive verdict through the back
// door.
function PillarMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-[10px] mb-1">
        <span style={{ color: "var(--sub)" }}>{label}</span>
        <span className="font-bold tabular-nums" style={{ color: "var(--text)" }}>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.14)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: GOLD }} />
      </div>
    </div>
  );
}

export function ResumenPreview({ data, editorial }: { data: FullCompanyDiagnosticData; editorial: QualitativeContentDraft | null }) {
  const { conservative, baseFairValue, optimistic, currentPrice } = data.valuation;
  const status = _valuationStatus(baseFairValue, currentPrice);
  const diffColor = status ? _VERDICT_COLOR[status.verdict] : "var(--sub)";
  const DiffIcon = status?.verdict === "undervalued" ? TrendingUp : status?.verdict === "overvalued" ? TrendingDown : Minus;
  const { opener, detail } = editorial ? splitBusinessSummary(editorial.business_model_summary) : { opener: "", detail: null };
  const { shown: topRisks, deferredCount } = editorial ? risksForSummary(editorial.risks) : { shown: [], deferredCount: 0 };

  return (
    <div className="max-w-[1180px] mx-auto pb-10">
      {editorial?.review_status !== "published" && (
        <div
          className="rounded-xl px-3.5 py-2.5 mb-4 text-[11.5px] font-bold text-center"
          style={{ background: "rgba(212,162,76,0.12)", border: "1px dashed rgba(212,162,76,0.5)", color: "#D4A24C" }}
        >
          Vista previa interna — contenido editorial en borrador ({editorial?.review_status ?? "sin contenido"}), no visible para usuarios reales.
        </div>
      )}

      {/* ── Encabezado: nombre, ticker, sector, precio y navegación ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <IconSquare size={48}><span className="text-lg font-black" style={{ color: "var(--text)" }}>{data.ticker.slice(0, 2)}</span></IconSquare>
          <div className="min-w-0">
            <p className="text-xl font-black tracking-tight truncate" style={{ color: "var(--text)" }}>{data.companyName}</p>
            <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>
              {data.ticker} · {data.sector}
              {currentPrice != null && (
                <> · <span style={{ color: "var(--text)", fontWeight: 700 }}>{fmtPrice(currentPrice)}</span></>
              )}
            </p>
          </div>
        </div>
        <TabNav active="resumen" ticker={data.ticker} />
      </div>

      {/* ── Dos columnas explícitas (cada una UN solo item de grid, con su
          propio flex interno) — evita que la altura de una tarjeta en una
          columna fuerce espacio vacío en la otra. Una sola columna en
          móvil (el orden del DOM ya es el correcto de arriba a abajo). ── */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
        {/* Columna principal (~66%) */}
        <div className="flex flex-col gap-5 lg:flex-[2] min-w-0">
          {/* Qué hace la empresa — 1-2 oraciones, sin cifras */}
          <div className="px-1">
            {opener ? (
              <p className="text-[16px] leading-[24px] font-medium" style={{ color: "var(--text)" }}>{opener}</p>
            ) : (
              <p className="text-[13px] italic" style={{ color: "var(--sub)" }}>No disponible — sin contenido editorial publicado para esta empresa todavía.</p>
            )}
          </div>

          {/* Cómo gana dinero — gráfico siempre visible, cifras duras colapsadas */}
          <GlowCard>
            <SectionTitle>Cómo gana dinero</SectionTitle>
            {data.revenueBreakdown.length > 0 ? (
              <div className="space-y-2">
                {data.revenueBreakdown.map((row) => (
                  <div key={row.category}>
                    <div className="flex justify-between text-[12.5px] mb-1">
                      <span style={{ color: "var(--sub)" }}>{row.category}</span>
                      <span className="font-bold" style={{ color: "var(--text)" }}>{row.percentage.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.14)" }}>
                      <div className="h-full rounded-full" style={{ width: `${row.percentage}%`, background: GOLD }} />
                    </div>
                  </div>
                ))}
                <p className="text-[10.5px] mt-1" style={{ color: "var(--sub)" }}>
                  Clasificación propia de Nuvos — no es idéntica a los segmentos exactos del reporte oficial de la empresa.
                </p>
              </div>
            ) : (
              <p className="text-[12.5px] italic" style={{ color: "var(--sub)" }}>No disponible.</p>
            )}

            {detail && (
              <ExpandRow headline="Ver resultados financieros recientes (por período, con fuente)" eyebrow="Detalle">
                <p className="text-[12px] leading-5 whitespace-pre-line" style={{ color: "var(--sub)" }}>{detail}</p>
              </ExpandRow>
            )}
          </GlowCard>

          {/* Ventajas competitivas — títulos específicos, detalle al expandir */}
          <GlowCard>
            <SectionTitle>Ventajas competitivas</SectionTitle>
            {editorial && editorial.moat.length > 0 ? (
              <div className="-mt-3">
                {editorial.moat.map((m, i) => (
                  <ExpandRow
                    key={i}
                    headline={headlineFrom(m.explanation)}
                    eyebrow={`${_MOAT_TYPE_LABEL[m.type] ?? m.type} · ${_CONFIDENCE_LABEL[m.confidence]}`}
                    eyebrowColor={_CONFIDENCE_COLOR[m.confidence]}
                  >
                    <p className="text-[12.5px] leading-5 mb-2" style={{ color: "var(--sub)" }}>{m.explanation}</p>
                    <p className="text-[11.5px] leading-4 mb-1" style={{ color: "var(--sub)" }}><strong style={{ color: "var(--text)" }}>Evidencia:</strong> {m.evidence}</p>
                    {m.weakening_factors && (
                      <p className="text-[11.5px] leading-4" style={{ color: "var(--sub)" }}><strong style={{ color: "var(--text)" }}>Podría debilitarse por:</strong> {m.weakening_factors}</p>
                    )}
                    <SourceLinks raw={m.source_name} />
                  </ExpandRow>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] italic" style={{ color: "var(--sub)" }}>Explicación cualitativa no disponible todavía para esta empresa.</p>
            )}
            {data.moatPoints.length > 0 && (
              <ExpandRow headline="Ver evidencia cuantitativa (ROIC, márgenes vs. industria)" eyebrow="Métricas">
                <ul className="space-y-1">
                  {data.moatPoints.map((p, i) => <li key={i} className="text-[12px] leading-4" style={{ color: "var(--sub)" }}>• {p}</li>)}
                </ul>
              </ExpandRow>
            )}
          </GlowCard>

          {/* Riesgos principales — solo los 3 más relevantes, resto en Riesgos */}
          <GlowCard>
            <SectionTitle>Riesgos principales</SectionTitle>
            {editorial && topRisks.length > 0 ? (
              <div className="-mt-3">
                {topRisks.map(({ risk: r, index: i }) => (
                  <ExpandRow
                    key={i}
                    headline={headlineFrom(r.explanation)}
                    eyebrow={_RISK_CATEGORY_LABEL[r.category] ?? r.category}
                    eyebrowColor="var(--sub)"
                  >
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <Pill label={_FACT_TYPE_LABEL[r.fact_type]} color={_FACT_TYPE_COLOR[r.fact_type]} />
                      <Pill label={_CONFIDENCE_LABEL[r.confidence]} color={_CONFIDENCE_COLOR[r.confidence]} />
                    </div>
                    <p className="text-[12.5px] leading-5 mb-2" style={{ color: "var(--sub)" }}>{r.explanation}</p>
                    <p className="text-[11.5px] leading-4 mb-1" style={{ color: "var(--sub)" }}><strong style={{ color: "var(--text)" }}>Por qué importa:</strong> {r.watch_indicator}</p>
                    {r.uncertainty && (
                      <p className="text-[11.5px] leading-4" style={{ color: "var(--sub)" }}><strong style={{ color: "var(--text)" }}>Incertidumbre:</strong> {r.uncertainty}</p>
                    )}
                    <SourceLinks raw={r.source_name} />
                  </ExpandRow>
                ))}
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
                <p className="text-[12.5px] italic" style={{ color: "var(--sub)" }}>Riesgos cualitativos no disponibles todavía.</p>
              </div>
            )}
            {deferredCount > 0 && (
              <div className="pt-3 mt-1" style={{ borderTop: "1px solid var(--border)" }}>
                <button className="w-full rounded-xl py-2.5 text-[12px] font-extrabold min-h-[44px]" style={{ background: "var(--raised)", color: "var(--sub)" }} disabled>
                  Ver {deferredCount} riesgo{deferredCount > 1 ? "s" : ""} adicional{deferredCount > 1 ? "es" : ""} en Riesgos →
                </button>
              </div>
            )}
          </GlowCard>
        </div>

        {/* Columna de señales (~34%) */}
        <div className="flex flex-col gap-5 lg:flex-1 min-w-0">
          {/* Score Nuvos — real composite score (quality+trust+value+simplicity,
              equally weighted, see company_diagnostic_service.py's
              overall_score = sum(pillar_scores)/4). Diego, round 5
              ("universalizar"): confirmed this single number DOES blend in
              the `value` pillar (margin-of-safety-derived) at 25% weight —
              titling it "Calidad del negocio" would misrepresent what it
              measures, even with the breakdown below limited to the 3
              business-merit pillars. Title/explanation now name the real
              blend honestly instead; the breakdown still surfaces only
              quality/trust/simplicity as sub-indicators of business merit
              specifically (the price/value dimension lives in its own
              "Precio vs. valor estimado" card below, not duplicated here). */}
          <GlowCard tint={GOLD}>
            <SectionTitle>Score Nuvos</SectionTitle>
            <p className="text-[11px] mb-3.5 leading-4" style={{ color: "var(--sub)" }}>
              Combina cuatro ejes en un solo número: rentabilidad y ventaja competitiva, solidez financiera, margen de seguridad frente al precio actual, y simplicidad del caso de inversión — no es exclusivamente una medida de calidad del negocio ni una recomendación.
            </p>
            <div className="flex items-center gap-4 mb-3.5">
              <RingGauge score={data.score} size={68} stroke={7}>
                <span className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>{data.score}</span>
              </RingGauge>
              <div className="min-w-0 flex flex-wrap gap-1.5">
                {data.badges.map((b) => <Pill key={b} label={b} color={GOLD} />)}
              </div>
            </div>
            {data.pillarScores && (
              <>
                <p className="text-[9.5px] uppercase tracking-wide mb-2 pt-3" style={{ color: "var(--sub)", borderTop: "1px solid var(--border)" }}>
                  Ejes de calidad del negocio (el margen de seguridad frente al precio se muestra abajo, por separado)
                </p>
                <div className="grid grid-cols-3 gap-2.5">
                  <PillarMini label="Calidad" value={data.pillarScores.quality} />
                  <PillarMini label="Confianza" value={data.pillarScores.trust} />
                  <PillarMini label="Simplicidad" value={data.pillarScores.simplicity} />
                </div>
              </>
            )}
          </GlowCard>

          {/* Precio vs. valor — eje 2, presentación neutral, sin veredicto dominante */}
          <GlowCard>
            <SectionTitle>Precio vs. valor estimado</SectionTitle>
            <p className="text-[11px] mb-3.5 leading-4" style={{ color: "var(--sub)" }}>
              Si el precio de hoy es atractivo frente a lo que cree nuestro modelo que vale el negocio.
            </p>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-[11px]" style={{ color: "var(--sub)" }}>Precio actual</span>
              <span className="text-[18px] font-black tabular-nums" style={{ color: "var(--text)" }}>
                {currentPrice != null ? fmtPrice(currentPrice) : "No disponible"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center mb-2 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
              {([
                ["Conservador", conservative, false],
                ["Base", baseFairValue, true],
                ["Optimista", optimistic, false],
              ] as const).map(([label, value, isBase]) => (
                <div key={label}>
                  <p className="text-[9px] uppercase tracking-wide" style={{ color: "var(--sub)" }}>{label}</p>
                  <p className="text-[14px] font-black tabular-nums" style={{ color: isBase ? GOLD : "var(--text)" }}>{value != null ? fmtPrice(value) : "N/D"}</p>
                </div>
              ))}
            </div>
            {status && (
              <div className="flex items-center justify-center gap-1 mt-1.5 mb-3">
                <DiffIcon className="w-3 h-3" style={{ color: diffColor }} />
                <span className="text-[11px] font-bold" style={{ color: diffColor }}>
                  {status.verdict === "overvalued" ? "-" : status.verdict === "undervalued" ? "+" : "±"}
                  {status.pct.toFixed(0)}% vs. escenario base
                </span>
              </div>
            )}
            <p className="text-[10px] leading-4" style={{ color: "var(--sub)" }}>
              Estimaciones de nuestro modelo, sujetas a los supuestos del cálculo —{" "}
              {data.valuationAsOf
                ? `cotización correspondiente al ${data.valuationAsOf}.`
                : "el precio corresponde a una cotización en vivo, con fecha verificable en la fuente de mercado."}
            </p>
            <button className="w-full mt-3.5 rounded-xl py-2.5 text-[11.5px] font-extrabold min-h-[44px]" style={{ background: "var(--raised)", color: "var(--sub)" }} disabled>
              Ver Valuación completa →
            </button>
          </GlowCard>

          {data.valuation.validationStatus === "under_review" && (
            <div className="rounded-[14px] px-3.5 py-3" style={{ background: "rgba(239,68,68,0.08)", borderLeft: "3px solid #ef4444" }}>
              <p className="text-[10px] font-extrabold uppercase mb-1" style={{ color: "#ef4444" }}>Valoración en revisión</p>
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>
                Estos números son reales y trazables, pero todavía no deben leerse como una conclusión validada.
              </p>
            </div>
          )}
          <button className="w-full rounded-xl py-2.5 text-[12.5px] font-extrabold min-h-[44px]" style={{ background: "var(--raised)", color: "var(--sub)" }} disabled>
            Ver todos los Riesgos →
          </button>
          <p className="text-[10.5px] text-center" style={{ color: "var(--sub)" }}>
            Las pestañas Valuación / Riesgos / Mi tesis aún reutilizan las pantallas existentes — este prototipo cubre solo Resumen.
          </p>
        </div>
      </div>
    </div>
  );
}
