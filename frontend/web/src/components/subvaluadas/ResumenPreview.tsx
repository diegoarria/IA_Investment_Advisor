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
import { useRouter } from "next/navigation";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, ChevronDown, ChevronUp, ExternalLink,
  Package, UserCircle, Swords, Target, Search,
} from "lucide-react";
import { IconSquare, GOLD } from "@/components/subvaluadas/radarUi";
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

// Minimal real-field shapes for the journey-teaser grid below — only the
// fields actually read for a one-line teaser, never the full fixture
// shape (that stays owned by each phase's own file). Optional/nullable
// throughout: every non-GOOGL ticker (and GOOGL itself before these load)
// legitimately has neither of these yet.
interface LeadershipTeaserData { ceo?: { name?: string } }
interface IndustryTeaserData { competitors?: { segment?: string; rivals?: string[] }[] }

/** $ formatting consistent with every other phase file's own local copy of
 * this exact helper (Fase 2/3/4) — never a new convention. */
function fmtMoneyTeaser(value: number | null | undefined): string {
  if (value == null) return "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(abs / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`;
  return `$${Math.round(abs / 1e6).toLocaleString("en-US")}M`;
}

/** Diego, 2026-11-15 ("resumas todo lo que contienen las 6 fases... buen
 * diseño gráfico... sin mucho texto"): a compact, clickable 6-tile teaser
 * grid. Round 2 ("lo de abajo quitarlo y meterlo dentro de lo nuevo"):
 * each tile now absorbs the real content that used to live in its own
 * separate card further down the page (business opener + revenue split +
 * top moat for "negocio"; price/scenarios/Score Nuvos for "valuación"; a
 * 2nd risk headline for "riesgos") — "un poco más extenso pero resumido",
 * never the full depth each phase's own screen already shows. Every line
 * is derived from the SAME real data/editorial content each phase itself
 * already displays for this ticker — never a new fact, never fabricated
 * for a ticker that lacks the real source. Icons reuse each phase's own
 * established choice for visual continuity with the phases themselves.
 *
 * Score Nuvos placement: folded into the "Valuación" tile rather than
 * given its own 7th tile or a separate card — it's the one piece that
 * doesn't map to a single phase (it blends quality/trust/value/simplicity
 * across 4 axes), but its "value" axis is specifically the margin-of-
 * safety-vs-price dimension, the closest real conceptual home among the
 * 6 phases. Same real `data.score`/`data.badges` fields, never recomputed. */
function JourneyTeaserGrid({
  data, editorial, leadership, industry, status, topRisks, deferredRiskCount, opener,
}: {
  data: FullCompanyDiagnosticData;
  editorial: QualitativeContentDraft | null;
  leadership: LeadershipTeaserData | null;
  industry: IndustryTeaserData | null;
  status: ReturnType<typeof _valuationStatus>;
  topRisks: { risk: QualitativeRisk; index: number }[];
  deferredRiskCount: number;
  opener: string;
}) {
  const sortedRevenue = [...data.revenueBreakdown].sort((a, b) => b.percentage - a.percentage);
  const topRevenue = sortedRevenue[0];
  const ft = data.financialTrends;
  const firstYear = ft?.years?.[0];
  const lastIdx = ft ? ft.years.length - 1 : -1;
  const lastYear = ft?.years?.[lastIdx];
  const firstRevenue = ft?.revenue?.[0];
  const lastRevenue = ft?.revenue?.[lastIdx];
  const hasRevenueTrend = ft && firstYear && lastYear && firstYear !== lastYear && firstRevenue != null && lastRevenue != null;
  const topCompetitorRow = industry?.competitors?.[industry.competitors.length - 1] ?? industry?.competitors?.[0];
  const topMoat = editorial && editorial.moat.length > 0 ? editorial.moat[0] : null;
  const risk1 = topRisks[0]?.risk ?? null;
  const risk2 = topRisks[1]?.risk ?? null;
  const { conservative, baseFairValue, optimistic, currentPrice, validationStatus } = data.valuation;
  const diffColor = status ? _VERDICT_COLOR[status.verdict] : "var(--sub)";
  const DiffIcon = status?.verdict === "undervalued" ? TrendingUp : status?.verdict === "overvalued" ? TrendingDown : Minus;

  const tiles: { key: string; label: string; href: string; icon: ReactNode; body: ReactNode }[] = [
    {
      key: "negocio",
      label: "Entender el negocio",
      href: `/subvaluadas/resumen-preview/${data.ticker}/entender-negocio`,
      icon: <Package className="w-4 h-4" style={{ color: GOLD }} />,
      body: (
        <>
          <p className="text-[15.5px] leading-4" style={{ color: "var(--sub)" }}>
            {topRevenue ? `Lo más importante: ${topRevenue.category} (${topRevenue.percentage.toFixed(0)}% de sus ingresos)` : "Qué vende y cómo gana dinero."}
          </p>
          {opener && <p className="text-[14px] leading-4 mt-1.5" style={{ color: "var(--sub)" }}>{headlineFrom(opener, 95)}</p>}
          {sortedRevenue.length > 0 && (
            <div className="mt-2 space-y-1">
              {sortedRevenue.slice(0, 2).map((row) => (
                <div key={row.category}>
                  <div className="flex justify-between text-[11px]">
                    <span style={{ color: "var(--sub)" }}>{row.category}</span>
                    <span className="font-bold" style={{ color: "var(--text)" }}>{row.percentage.toFixed(0)}%</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.14)" }}>
                    <div className="h-full rounded-full" style={{ width: `${row.percentage}%`, background: GOLD }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {topMoat && (
            <p className="text-[14px] leading-4 mt-2" style={{ color: "var(--sub)" }}>
              <strong style={{ color: "var(--text)" }}>Ventaja:</strong> {headlineFrom(topMoat.explanation, 70)}
            </p>
          )}
        </>
      ),
    },
    {
      key: "finanzas",
      label: "Entender las finanzas",
      href: `/subvaluadas/resumen-preview/${data.ticker}/entender-finanzas`,
      icon: <TrendingUp className="w-4 h-4" style={{ color: "#5B9BD5" }} />,
      body: (
        <>
          <p className="text-[15.5px] leading-5" style={{ color: "var(--sub)" }}>
            {hasRevenueTrend
              ? `Ingresos de ${fmtMoneyTeaser(firstRevenue)} (${firstYear}) a ${fmtMoneyTeaser(lastRevenue)} (${lastYear})`
              : "Si está vendiendo más, ganando dinero y generando efectivo."}
          </p>
          {hasRevenueTrend && firstRevenue != null && lastRevenue != null && (
            <div className="mt-2 flex items-end gap-1.5" style={{ height: 28 }}>
              {[firstRevenue, lastRevenue].map((v, i) => {
                const max = Math.max(firstRevenue, lastRevenue) || 1;
                const h = Math.max(6, Math.round((Math.max(v, 0) / max) * 28));
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end">
                    <div className="rounded-sm" style={{ height: h, background: i === 1 ? GOLD : "rgba(212,162,76,0.35)" }} />
                  </div>
                );
              })}
            </div>
          )}
          {(() => {
            const lastReal = (arr?: (number | null)[]) => {
              if (!arr) return null;
              for (let i = arr.length - 1; i >= 0; i--) {
                if (arr[i] != null) return arr[i] as number;
              }
              return null;
            };
            const lastNetMargin = lastReal(ft?.netMargin);
            const lastFcf = lastReal(ft?.fcfReported);
            if (lastNetMargin == null && lastFcf == null) return null;
            return (
              <p className="text-[14px] leading-5 mt-2" style={{ color: "var(--sub)" }}>
                {lastNetMargin != null && (
                  <>De cada $100 que vende, conserva <strong style={{ color: "var(--text)" }}>${lastNetMargin.toFixed(0)}</strong> como ganancia. </>
                )}
                {lastFcf != null && (
                  <>Efectivo libre reportado: <strong style={{ color: "var(--text)" }}>{fmtMoneyTeaser(lastFcf)}</strong>.</>
                )}
              </p>
            );
          })()}
        </>
      ),
    },
    {
      key: "lideres",
      label: "Conocer a sus líderes",
      href: `/subvaluadas/resumen-preview/${data.ticker}/conocer-liderazgo`,
      icon: <UserCircle className="w-4 h-4" style={{ color: "#8C97AD" }} />,
      body: (
        <p className="text-[15.5px] leading-4" style={{ color: "var(--sub)" }}>
          {leadership?.ceo?.name ? `${leadership.ceo.name} dirige la empresa y sus decisiones de capital.` : "Quién dirige la empresa y qué hace con el dinero."}
        </p>
      ),
    },
    {
      key: "industria",
      label: "Entender la industria",
      href: `/subvaluadas/resumen-preview/${data.ticker}/entender-industria`,
      icon: <Swords className="w-4 h-4" style={{ color: "#C97B63" }} />,
      body: (
        <p className="text-[15.5px] leading-4" style={{ color: "var(--sub)" }}>
          {topCompetitorRow?.rivals?.length
            ? `Compite con ${topCompetitorRow.rivals.slice(0, 2).join(" y ")} en ${(topCompetitorRow.segment ?? "su mercado").toLowerCase()}.`
            : "Contra quién compite y qué podría cambiar su mercado."}
        </p>
      ),
    },
    {
      key: "valuacion",
      label: "Valuación",
      href: `/subvaluadas/resumen-preview/${data.ticker}/entender-valuacion`,
      icon: <Target className="w-4 h-4" style={{ color: GOLD }} />,
      body: (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-[11.5px]" style={{ color: "var(--sub)" }}>Precio actual</span>
            <span className="text-[15px] font-black tabular-nums" style={{ color: "var(--text)" }}>
              {currentPrice != null ? fmtPrice(currentPrice) : "N/D"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center mt-1.5">
            {([["Cons.", conservative], ["Base", baseFairValue], ["Optim.", optimistic]] as const).map(([label, value], i) => (
              <div key={label}>
                <p className="text-[9.5px] uppercase tracking-wide" style={{ color: "var(--sub)" }}>{label}</p>
                <p className="text-[14px] font-black tabular-nums" style={{ color: i === 1 ? GOLD : "var(--text)" }}>{value != null ? fmtPrice(value) : "N/D"}</p>
              </div>
            ))}
          </div>
          {status && (
            <div className="flex items-center justify-center gap-1 mt-1.5">
              <DiffIcon className="w-3 h-3" style={{ color: diffColor }} />
              <span className="text-[14px] font-bold" style={{ color: diffColor }}>
                {status.pct.toFixed(0)}% {status.verdict === "overvalued" ? "sobre" : status.verdict === "undervalued" ? "bajo" : "cerca de"} el valor estimado
              </span>
            </div>
          )}
          <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-[11.5px]" style={{ color: "var(--sub)" }}>Score Nuvos</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-black tabular-nums" style={{ color: "var(--text)" }}>{data.score}</span>
              {data.badges[0] && <Pill label={data.badges[0]} color={GOLD} />}
            </div>
          </div>
          {validationStatus === "under_review" && (
            <p className="text-[11px] leading-3.5 mt-1.5" style={{ color: "#ef4444" }}>
              Valoración en revisión — números reales, aún sin validar.
            </p>
          )}
        </>
      ),
    },
    {
      key: "riesgos",
      label: "Riesgos",
      href: `/subvaluadas/resumen-preview/${data.ticker}/riesgos-a-vigilar`,
      icon: <AlertTriangle className="w-4 h-4" style={{ color: "#f59e0b" }} />,
      body: (
        <>
          <p className="text-[15.5px] leading-4" style={{ color: "var(--sub)" }}>
            {risk1 ? headlineFrom(risk1.explanation, 70) : "Qué podría salir mal y qué vigilar."}
          </p>
          {risk2 && <p className="text-[14px] leading-4 mt-1.5" style={{ color: "var(--sub)" }}>{headlineFrom(risk2.explanation, 70)}</p>}
          {deferredRiskCount > 0 && (
            <p className="text-[11.5px] mt-1.5" style={{ color: "var(--sub)" }}>+{deferredRiskCount} más en la pestaña completa</p>
          )}
        </>
      ),
    },
  ];

  return (
    <div className="mb-5">
      <SectionTitle>El recorrido guiado de Nuvos Radar</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {tiles.map((t) => (
          <a
            key={t.key}
            href={t.href}
            className="rounded-2xl p-3.5 flex flex-col gap-2 transition-colors hover:brightness-110"
            style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center gap-2">
              <IconSquare size={30} color={GOLD}>{t.icon}</IconSquare>
              <span className="text-[14.5px] font-extrabold" style={{ color: "var(--text)" }}>{t.label}</span>
            </div>
            <div>{t.body}</div>
          </a>
        ))}
      </div>
    </div>
  );
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

// Nav bar integrated into the header. Diego, 2026-11-15 ("las 7 fases
// reemplazan estos botones"): replaced the old 4-tab Resumen/Valuación/
// Riesgos/Mi-tesis bar with direct access to the 7 guided-journey phases —
// the full Valuación/Riesgos/Mi-tesis tabs still exist and still work,
// they're just reached from inside the phases ("profundizar" links) instead
// of a top-level button here. `active` keeps its old prop type/call sites
// untouched (Resumen/Valuación/Riesgos/Mi-tesis all still pass "resumen"/
// "valuacion"/"riesgos"/"tesis" unmodified) — none of those match a phase
// key, so no pill highlights on those 4 screens, which is correct: none of
// them *is* one of the 7 phases. Horizontal scroll on narrow screens
// (flex-nowrap + overflow-x-auto) instead of cramming 7 pills into one row.
// Exported (round 6 — Valuación tab) so other screens can render the same
// nav slot instead of forking a second copy.
export function TabNav({ active, ticker }: { active: "resumen" | "valuacion" | "riesgos" | "tesis"; ticker: string }) {
  void active; // kept for call-site compatibility; see note above
  const phases: { key: string; label: string; href: string }[] = [
    { key: "negocio", label: "Entender el negocio", href: `/subvaluadas/resumen-preview/${ticker}/entender-negocio` },
    { key: "finanzas", label: "Entender las finanzas", href: `/subvaluadas/resumen-preview/${ticker}/entender-finanzas` },
    { key: "lideres", label: "Conocer a sus líderes", href: `/subvaluadas/resumen-preview/${ticker}/conocer-liderazgo` },
    { key: "industria", label: "Entender la industria", href: `/subvaluadas/resumen-preview/${ticker}/entender-industria` },
    { key: "valuacion", label: "Valuación", href: `/subvaluadas/resumen-preview/${ticker}/entender-valuacion` },
    { key: "riesgos", label: "Riesgos", href: `/subvaluadas/resumen-preview/${ticker}/riesgos-a-vigilar` },
    { key: "tesis", label: "Mi tesis", href: `/subvaluadas/resumen-preview/${ticker}/construir-tesis` },
  ];
  return (
    <div
      className="flex gap-1 p-1 rounded-xl w-full overflow-x-auto"
      style={{ background: "var(--raised)", border: "1px solid var(--border)", scrollbarWidth: "none" }}
    >
      {phases.map((p) => (
        <a key={p.key} href={p.href} className="shrink-0">
          <span
            className="px-3.5 py-2 rounded-lg text-[12.5px] font-extrabold transition-colors flex items-center justify-center min-h-[40px] whitespace-nowrap"
            style={{ color: "var(--sub)" }}
          >
            {p.label}
          </span>
        </a>
      ))}
    </div>
  );
}

// Diego, 2026-11-16: "una barra de búsqueda arriba para buscar más
// empresas" — "arriba a la izquierda". The real app's own ticker-search
// endpoint (`/api/market/search`, `screenerApi.searchTickers`) requires a
// real logged-in session (`get_current_user_id`, no guest fallback) —
// wrong fit for this public/no-login preview tree, where every other
// screen deliberately works without auth. Rather than calling an endpoint
// that would 401 for a guest, or fabricating a fake ticker list for
// autocomplete, this is a simple direct-entry box: type a real ticker,
// press Enter, navigate straight to its real Resumen preview. No ticker
// data invented — it just jumps to `/subvaluadas/resumen-preview/{TICKER}`,
// the same real route every other screen already uses; that page itself
// honestly shows real data or an honest empty state depending on what
// exists for that ticker, exactly as it already does today.
function TickerSearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");

  const go = () => {
    const ticker = value.trim().toUpperCase();
    if (!ticker) return;
    router.push(`/subvaluadas/resumen-preview/${encodeURIComponent(ticker)}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="flex items-center gap-2 rounded-full pl-3 pr-1.5 py-1.5 mb-4 w-fit"
      style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
    >
      <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--sub)" }} />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Buscar otra empresa o ticker…"
        className="text-[12.5px] bg-transparent outline-none w-44 sm:w-56"
        style={{ color: "var(--text)" }}
      />
      <button
        type="submit"
        className="text-[11px] font-bold rounded-full px-3 py-1 shrink-0"
        style={{ background: "rgba(212,162,76,0.15)", color: GOLD }}
      >
        Ir
      </button>
    </form>
  );
}

export function ResumenPreview({ data, editorial, leadership = null, industry = null }: {
  data: FullCompanyDiagnosticData;
  editorial: QualitativeContentDraft | null;
  leadership?: LeadershipTeaserData | null;
  industry?: IndustryTeaserData | null;
}) {
  const { baseFairValue, currentPrice } = data.valuation;
  const status = _valuationStatus(baseFairValue, currentPrice);
  const { opener } = editorial ? splitBusinessSummary(editorial.business_model_summary) : { opener: "" };
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

      <TickerSearchBar />

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

      {/* Diego, 2026-11-15 ("resumas todo lo que contienen las 6 fases...
          buen diseño gráfico... sin mucho texto"): reemplaza el banner de
          un solo enlace por una grilla compacta de las 6 fases (hasta
          Riesgos — Mi tesis, Fase 7, queda fuera de este resumen a
          propósito), cada una con su propio dato real como adelanto. */}
      <JourneyTeaserGrid
        data={data}
        editorial={editorial}
        leadership={leadership}
        industry={industry}
        status={status}
        topRisks={topRisks}
        deferredRiskCount={deferredCount}
        opener={opener}
      />
    </div>
  );
}
