"use client";

// Nuvos Plus — Fase 4B: "Mi distribución" tab inside Mi Portafolio.
// Fase 4D (2026-11): reorganized into three sub-views — Resumen,
// Entender mi portafolio (with a Posiciones/Sectores/Geografía
// selector), and Antes de invertir — per Diego's explicit "una pregunta
// principal por vista, una conclusión importante primero, los detalles
// solamente cuando el usuario quiera profundizar." No new routes, no
// new backend calls per view switch: everything here still reads the
// ONE `data` object fetched once below.
//
// Admin-gated by the backend (GET /api/portfolio-exposure/{id} returns 403
// for non-admin accounts). Self-contained — portfolio/page.tsx only renders
// <PortfolioDistribution portfolioId={activePortfolioId} /> inside its
// existing tab switcher, nothing else about that 4,800-line file changes.
//
// Reuses the exact same visual components and honesty patterns already
// approved in Nuvos ETF (radarUi.tsx, InsightCard-style "Lo que debes
// entender", WeightBar-style single-series bars): a position/sector/
// country value that couldn't be verified is shown as "No disponible" or
// in a separate list, NEVER as a silent zero or a dropped row.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Loader2, AlertTriangle, PieChart, Globe2, ListTree, ChevronDown, Info,
  Layers, ShieldAlert, ArrowLeft, ArrowRight, TrendingUp, Compass,
} from "lucide-react";
import { GlowCard, IconSquare, RaisedTile } from "@/components/subvaluadas/radarUi";
// Fase 7.2 (Diego, captura real): el acento dorado de Radar no debe
// usarse aquí — el usuario pidió explícitamente el verde consistente
// con el resto de la plataforma (Mi portafolio, "En la nube", etc.). Se
// mantiene el nombre `GOLD` solo para no tocar las ~20 referencias ya
// existentes en este archivo; su valor es `--accent-l` (verde de marca)
// como hex literal — no `var(--accent-l)` directamente porque varias
// líneas de este archivo ya concatenan un sufijo de alfa al final
// (`${GOLD}2b`), que exige un hex de 6 dígitos, no una función CSS.
const GOLD = "#00e887";
import StockAvatar from "@/components/StockAvatar";
import ExplainButton from "@/components/ExplainButton";
import { portfolioExposureApi } from "@/lib/api";
import { selectPrimaryInsight, buildObservationCopy } from "@/lib/primaryInsight";
import { selectResumenObservation, buildPulseObservationCopy, type PulseCompareResult, type PulseCompareAvailable } from "@/lib/pulseObservation";
import { buildPositionsSummary } from "@/lib/positionsSummary";
import { describeSectorHeadline, describeSectorShare, describeContributorsExplanation, type SectorContributor } from "@/lib/sectorExposureSummary";

type Position = {
  ticker: string; name: string | null; asset_class: "equity" | "etf" | "unknown";
  shares: number; avg_price: number; cost_basis: number;
  market_value: number | null; verifiable: boolean; unverifiable_reason: string | null;
  quote_currency: string | null; sector: string | null; country: string | null;
  weight_pct: number | null;
};
type SectorRow = { sector: string; value: number; pct_of_verified_total: number | null };
type CountryRow = { country: string; value: number; pct_of_asset_class_value: number | null; asset_class_total_value: number; methodology: "equity_domicile" | "etf_underlying" };
type Insight = { category: string; text: string; supporting_data: Record<string, unknown> };

type ExposureResponse = {
  portfolio_id: string; portfolio_name: string | null; currency: string;
  valuation: {
    total_value_verified: number | null; total_cost_basis_all_positions: number;
    position_count: number; verified_position_count: number; unverifiable_position_count: number;
    valuation_coverage_pct: number | null;
  };
  positions: Position[];
  composition: { equity_value: number; equity_pct: number | null; etf_value: number; etf_pct: number | null; unknown_asset_value_cost_basis: number };
  sector_exposure: { by_sector: SectorRow[]; coverage_pct: number | null; unclassified_value: number; non_equity_style_value: number; eligible_for_sector_value: number };
  geographic_exposure: { by_country: CountryRow[]; equity_domicile_coverage_pct: number | null; etf_underlying_coverage_pct: number | null; etf_non_applicable_value: number; note_es: string };
  concentration: { top_positions: { ticker: string; name: string | null; weight_pct: number }[]; largest_single_position_pct: number | null };
  insights: Insight[];
  unverifiable_positions: { ticker: string; reason: string | null }[];
};

type Dimension = "posiciones" | "sectores" | "geografia";
// Fase 7: "Antes de invertir" se promovió a hermano de nivel superior
// de "Distribución" dentro de la página de Portafolio (ya no es una
// tercera vista interna de este componente) — ver portfolio/page.tsx.
// Mantener "simular" aquí habría creado dos niveles de navegación
// contradictorios que repiten "Antes de invertir", exactamente lo que
// Diego pidió evitar.
type View = "resumen" | "entender";

const INSIGHT_ICON: Record<string, typeof PieChart> = {
  composition: Layers, top_holdings: PieChart, dominant_sector: PieChart,
  single_position_concentration: ShieldAlert, coverage_gap: AlertTriangle,
};

// Diego, 2026-11 (Mi distribución visual refinement #2): Intl's
// `style: "currency"` alone hides the currency code for some locale/
// currency combinations (e.g. a plain "$" gives no clue whether it's
// USD or MXN) — the portfolio's real base currency must always be
// explicit, never assumed. `currency` always comes from the portfolio's
// own stored value (never guessed here), so this only ever displays a
// confirmed currency, formatted as "MXN $16,389".
function fmtMoney(n: number | null | undefined, currency: string, na: string): string {
  if (n === null || n === undefined) return na;
  const amount = n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return `${currency} $${amount}`;
}

function fmtPct(n: number | null | undefined, na: string, digits = 1): string {
  if (n === null || n === undefined) return na;
  return `${n.toFixed(digits)}%`;
}

function SingleBar({ label, pct, value, currency, na, avatarTicker }: { label: string; pct: number | null; value: number; currency: string; na: string; avatarTicker?: string }) {
  const widthPct = pct !== null ? Math.max(2, pct) : 0;
  return (
    <div className="py-2 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 min-w-0">
          {avatarTicker && <StockAvatar ticker={avatarTicker} size="sm" />}
          <span className="text-[13px] font-semibold min-w-0 truncate" style={{ color: "var(--text)" }}>{label}</span>
        </span>
        <span className="text-[13px] font-bold shrink-0" style={{ color: "var(--text)" }}>{fmtPct(pct, na)}</span>
      </div>
      <div className="w-full h-[7px] rounded-full overflow-hidden mb-1" style={{ background: "var(--raised)" }}>
        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: GOLD }} />
      </div>
      <span className="text-[11px]" style={{ color: "var(--sub)" }}>{fmtMoney(value, currency, na)}</span>
    </div>
  );
}

// "Sectores" refinement (2026-11): a contributor row has NO dollar value
// in the backend contract (`contributors[].contribution_pct_points` is
// the only figure available) — only a percentage-points share of the
// whole verified portfolio, so this renders a bar without the
// `fmtMoney` line SingleBar always shows. Never fabricates a dollar
// amount to fill that gap.
function ContributionBar({ ticker, name, pctPoints }: { ticker: string; name?: string | null; pctPoints: number }) {
  const widthPct = Math.max(2, pctPoints);
  return (
    <div className="py-2 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <StockAvatar ticker={ticker} size="sm" />
          <span className="text-[13px] font-semibold min-w-0 truncate" style={{ color: "var(--text)" }}>{name || ticker}</span>
        </span>
        <span className="text-[13px] font-bold shrink-0" style={{ color: "var(--text)" }}>{pctPoints.toFixed(1)}pp</span>
      </div>
      <div className="w-full h-[7px] rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: GOLD }} />
      </div>
    </div>
  );
}

// Diego, 2026-11 (Fase 4D, point 3): a segmented bar — not a pie/ring —
// for the one composition split (acciones vs. ETFs) worth visualizing
// as "composición", reusing composition.equity_pct/etf_pct verbatim,
// never recomputed here.
function SegmentedBar({ equityPct, etfPct, equityValue, etfValue, currency, na, t }: {
  equityPct: number | null; etfPct: number | null; equityValue: number; etfValue: number; currency: string; na: string; t: TFunction;
}) {
  const ep = equityPct ?? 0;
  const tp = etfPct ?? 0;
  return (
    <div className="mb-3">
      <div className="w-full h-[10px] rounded-full overflow-hidden flex" style={{ background: "var(--raised)" }}>
        {ep > 0 && <div style={{ width: `${ep}%`, background: GOLD }} />}
        {tp > 0 && <div style={{ width: `${tp}%`, background: "var(--muted)" }} />}
      </div>
      <div className="flex flex-wrap justify-between gap-2 mt-1.5 text-[11px]" style={{ color: "var(--sub)" }}>
        <span>{t("portfolio.distribution.positions.equityLabel")}: {fmtPct(equityPct, na)} · {fmtMoney(equityValue, currency, na)}</span>
        <span>{t("portfolio.distribution.positions.etfLabel")}: {fmtPct(etfPct, na)} · {fmtMoney(etfValue, currency, na)}</span>
      </div>
    </div>
  );
}

function DimensionSelector({ dimension, onChange, t }: { dimension: Dimension; onChange: (d: Dimension) => void; t: TFunction }) {
  const options: { key: Dimension; label: string }[] = [
    { key: "posiciones", label: t("portfolio.distribution.dimensionSelector.positions") },
    { key: "sectores", label: t("portfolio.distribution.dimensionSelector.sectors") },
    { key: "geografia", label: t("portfolio.distribution.dimensionSelector.geography") },
  ];
  return (
    <div className="flex gap-2 mb-4 overflow-x-auto" role="tablist" aria-label={t("portfolio.distribution.dimensionSelector.ariaLabel")}>
      {options.map((o) => (
        <button
          key={o.key}
          role="tab"
          aria-selected={dimension === o.key}
          onClick={() => onChange(o.key)}
          className="px-3.5 py-1.5 rounded-full text-[12.5px] font-bold whitespace-nowrap"
          style={{
            background: dimension === o.key ? GOLD : "var(--raised)",
            color: dimension === o.key ? "#1A1A1A" : "var(--sub)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BackToSummaryButton({ onBack, t }: { onBack: () => void; t: TFunction }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1.5 mb-4 text-[12.5px] font-semibold" style={{ color: "var(--sub)" }}>
      <ArrowLeft className="w-3.5 h-3.5" />{t("portfolio.distribution.nav.backToSummary")}
    </button>
  );
}

// Fase 4E, point 1 ("Conclusión → Explicación → Evidencia"): the headline
// is a short, qualitative restatement of the real number (never a new
// one), the explanation names the real cause in one line, and the exact
// backend sentence + raw supporting_data stay available on demand — not
// lost, just no longer the first thing shown.
function InsightCard({ insight, t, lang }: { insight: Insight; t: TFunction; lang: "es" | "en" }) {
  const [showData, setShowData] = useState(false);
  const Icon = INSIGHT_ICON[insight.category] || Info;
  const copy = buildObservationCopy(insight, lang);
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "var(--raised)", border: `1px solid ${GOLD}2b` }}>
      <div className="flex items-start gap-2 mb-1">
        <IconSquare color={GOLD} size={24}><Icon className="w-3 h-3" style={{ color: GOLD }} /></IconSquare>
        <p className="text-[14px] font-extrabold leading-snug" style={{ color: "var(--text)" }}>{copy.headline}</p>
      </div>
      {copy.explanation && (
        <p className="text-[13px] leading-relaxed ml-8" style={{ color: "var(--sub)" }}>{copy.explanation}</p>
      )}
      <button onClick={() => setShowData((v) => !v)} className="flex items-center gap-1 mt-2 ml-8 text-[11px] font-semibold" style={{ color: "var(--sub)" }}>
        <ChevronDown className={`w-3 h-3 transition-transform ${showData ? "rotate-180" : ""}`} />
        {t("portfolio.distribution.summary.seeBreakdown")}
      </button>
      {showData && (
        <div className="mt-1.5 ml-8 text-[11.5px] font-mono rounded-lg p-2" style={{ background: "var(--card)", color: "var(--sub)" }}>
          {copy.detailText && <div className="mb-1" style={{ color: "var(--text)" }}>{copy.detailText}</div>}
          {Object.entries(insight.supporting_data).map(([k, v]) => (
            <div key={k}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Fase 6D — Nuvos Pulse dentro de Resumen. Ocupa EXACTAMENTE el mismo
// espacio visual que InsightCard (nunca una segunda tarjeta) cuando
// `selectResumenObservation` decidió que Pulse es la observación de
// turno. Muestra las fechas reales de ambas fotografías (nunca "este
// mes"/"cierre mensual" si el motor no confirmó que son cierres
// verificados) y, bajo demanda, la cobertura/limitaciones — nunca
// saturando la tarjeta por defecto.
// Fase 6E §1: el destino y la etiqueta del CTA dependen del dato que
// realmente se muestra — nunca "Explorar sectores" fijo para un cambio
// que en realidad es de composición acciones/ETFs o de concentración
// por posición (ambos viven en la vista Posiciones, no en Sectores).
function pulseExploreTarget(category: "sector" | "composition" | "concentration"): { dimension: Dimension; labelKey: string } {
  return category === "sector"
    ? { dimension: "sectores", labelKey: "portfolio.distribution.summary.pulse.exploreSectors" }
    : { dimension: "posiciones", labelKey: "portfolio.distribution.summary.pulse.explorePositions" };
}

function PulseObservationCard({ pulse, t, lang, onExplore }: { pulse: PulseCompareAvailable; t: TFunction; lang: "es" | "en"; onExplore: (dimension: Dimension) => void }) {
  const [showDetails, setShowDetails] = useState(false);
  const copy = buildPulseObservationCopy(pulse, lang);
  if (!copy || !pulse.primary_change) return null;
  const { dimension: exploreDimension, labelKey: exploreLabelKey } = pulseExploreTarget(pulse.primary_change.category);
  const fmtDate = (iso: string) => iso.slice(0, 10);
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "var(--raised)", border: `1px solid ${GOLD}2b` }}>
      <div className="flex items-start gap-2 mb-1">
        <IconSquare color={GOLD} size={24}><TrendingUp className="w-3 h-3" style={{ color: GOLD }} /></IconSquare>
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.summary.pulse.title")}</p>
          <p className="text-[14px] font-extrabold leading-snug" style={{ color: "var(--text)" }}>{copy.headline}</p>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed ml-8" style={{ color: "var(--sub)" }}>{copy.explanation}</p>
      <div className="ml-8 mt-1.5 flex items-center gap-3 text-[12px]" style={{ color: "var(--text)" }}>
        <span>{t("portfolio.distribution.summary.pulse.before")}: <b>{copy.before_pct.toFixed(1)}%</b></span>
        <ArrowRight className="w-3 h-3" style={{ color: "var(--sub)" }} />
        <span>{t("portfolio.distribution.summary.pulse.after")}: <b>{copy.after_pct.toFixed(1)}%</b></span>
        <span className="font-bold" style={{ color: GOLD }}>{copy.delta_pp >= 0 ? "+" : ""}{copy.delta_pp.toFixed(1)}pp</span>
      </div>
      <p className="text-[12px] leading-relaxed ml-8 mt-1.5" style={{ color: "var(--sub)" }}>{copy.causalityNote}</p>

      <button onClick={() => setShowDetails((v) => !v)} className="flex items-center gap-1 mt-2 ml-8 text-[11px] font-semibold" style={{ color: "var(--sub)" }}>
        <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? "rotate-180" : ""}`} />
        {t("portfolio.distribution.summary.pulse.seeDates")}
      </button>
      {showDetails && (
        <div className="mt-1.5 ml-8 text-[11.5px] rounded-lg p-2" style={{ background: "var(--card)", color: "var(--sub)" }}>
          <div>{t("portfolio.distribution.summary.pulse.comparedDates", { before: fmtDate(pulse.snapshot_before.observed_at), after: fmtDate(pulse.snapshot_after.observed_at) })}</div>
          {pulse.comparability.status === "partial" && <div className="mt-1">{t("portfolio.distribution.summary.pulse.partialCoverage")}</div>}
        </div>
      )}

      <button onClick={() => onExplore(exploreDimension)} className="flex items-center gap-1.5 mt-2.5 ml-8 text-[12px] font-bold" style={{ color: GOLD }}>
        {t(exploreLabelKey)}<ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─── Vista A — Resumen ──────────────────────────────────────────────────────
// Fase 4E, point 2: compacted value block (A), headline-first primary
// observation with a minimal visual backing it (B/C), and two action
// buttons each with a one-line benefit description (D) — no new buttons.
function SummaryView({
  data, currency, na, t, lang, primaryInsight, pulseResult, onUnderstand, onNavigateToSimulate, onPulseExplore,
}: {
  data: ExposureResponse; currency: string; na: string; t: TFunction; lang: "es" | "en";
  primaryInsight: Insight | null; pulseResult: PulseCompareResult | null;
  onUnderstand: () => void; onNavigateToSimulate: () => void; onPulseExplore: (dimension: Dimension) => void;
}) {
  const { valuation, unverifiable_positions } = data;
  const isEmpty = valuation.position_count === 0;
  const topSector = data.sector_exposure.by_sector[0] ?? null;
  // Fase 6D §4: un único selector determinista decide cuál observación
  // ocupa el espacio — Pulse (un cambio real entre dos fotografías) o la
  // estática de siempre. Nunca ambas, nunca una tarjeta nueva.
  const resumenObservation = selectResumenObservation(data.insights, pulseResult);

  return (
    <div className="space-y-3">
      <GlowCard tint={GOLD} strong>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <p className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
            {valuation.total_value_verified !== null ? fmtMoney(valuation.total_value_verified, currency, na) : na}
          </p>
          <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>
            {t("portfolio.distribution.summary.positionsCount", { count: valuation.position_count })}
          </p>
        </div>

        {isEmpty && (
          <p className="text-[12.5px] mt-1.5 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t("portfolio.distribution.summary.emptyPortfolio")}
          </p>
        )}
        {!isEmpty && valuation.total_value_verified === null && (
          <p className="text-[12.5px] mt-1.5 flex items-start gap-1.5" style={{ color: "#E0A030" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t("portfolio.distribution.summary.noVerifiedValue")}
          </p>
        )}
        {!isEmpty && unverifiable_positions.length > 0 && (
          <p className="text-[12.5px] mt-1.5 flex items-start gap-1.5" style={{ color: "#E0A030" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {t("portfolio.distribution.summary.unverifiableNote", { count: unverifiable_positions.length })}
          </p>
        )}
      </GlowCard>

      {!isEmpty && (
        <GlowCard tint={GOLD}>
          <div className="flex items-center justify-between gap-2.5 mb-2.5 flex-wrap">
            <div className="flex items-center gap-2">
              <IconSquare color={GOLD} size={30}><ListTree className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
              <span className="text-[14px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("portfolio.distribution.understand.title")}</span>
            </div>
            <ExplainButton
              inline
              screen="portfolio_distribution"
              context={{
                total_value_verified: valuation.total_value_verified,
                currency,
                equity_pct: data.composition.equity_pct,
                etf_pct: data.composition.etf_pct,
                top_sector: topSector?.sector ?? null,
                top_sector_pct: topSector?.pct_of_verified_total ?? null,
                sector_coverage_pct: data.sector_exposure.coverage_pct,
                largest_position_pct: data.concentration.largest_single_position_pct,
                primary_insight_category: primaryInsight?.category ?? null,
              }}
            />
          </div>
          {resumenObservation.source === "pulse" ? (
            <PulseObservationCard pulse={resumenObservation.pulse} t={t} lang={lang} onExplore={onPulseExplore} />
          ) : resumenObservation.source === "static" && resumenObservation.insight ? (
            <>
              <InsightCard insight={resumenObservation.insight} t={t} lang={lang} />
              {/* Minimal visual backing — only when the primary observation
                  IS the dominant sector, since that's the one case with an
                  obvious single-series share to show; never a gauge/ring
                  that could read as a verdict (Fase 4D/4E point 3). */}
              {resumenObservation.insight.category === "dominant_sector" && topSector && (
                <div className="mt-2">
                  <SingleBar label={topSector.sector} pct={topSector.pct_of_verified_total} value={topSector.value} currency={currency} na={na} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.summary.noPrimaryInsight")}</p>
          )}
        </GlowCard>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={onUnderstand} className="rounded-2xl p-4 text-left flex items-start gap-2.5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <IconSquare color={GOLD} size={32}><Compass className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
          <span>
            <span className="block text-[14px] font-bold" style={{ color: "var(--text)" }}>{t("portfolio.distribution.summary.actionUnderstand")}</span>
            <span className="block text-[12px] mt-0.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.summary.actionUnderstandHint")}</span>
          </span>
        </button>
        <button onClick={onNavigateToSimulate} className="rounded-2xl p-4 text-left flex items-start gap-2.5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <IconSquare color={GOLD} size={32}><TrendingUp className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
          <span>
            <span className="block text-[14px] font-bold" style={{ color: "var(--text)" }}>{t("portfolio.distribution.summary.actionSimulate")}</span>
            <span className="block text-[12px] mt-0.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.summary.actionSimulateHint")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}

// ─── Vista B — Entender mi portafolio ───────────────────────────────────────
function UnderstandView({
  data, dimension, onDimensionChange, currency, na, t, lang, router, primaryInsight, onBack,
}: {
  data: ExposureResponse; dimension: Dimension; onDimensionChange: (d: Dimension) => void;
  currency: string; na: string; t: TFunction; lang: "es" | "en"; router: ReturnType<typeof useRouter>;
  primaryInsight: Insight | null; onBack: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [allSectorsOpen, setAllSectorsOpen] = useState(false);
  const { composition, sector_exposure, geographic_exposure, unverifiable_positions } = data;
  const positionsSorted = [...data.positions].sort((a, b) => (b.weight_pct ?? -1) - (a.weight_pct ?? -1));
  const equityCountries = geographic_exposure.by_country.filter((r) => r.methodology === "equity_domicile");
  const etfCountries = geographic_exposure.by_country.filter((r) => r.methodology === "etf_underlying");
  const topEtfCountry = [...etfCountries].sort((a, b) => b.value - a.value)[0] ?? null;
  const topEquityCountry = [...equityCountries].sort((a, b) => b.value - a.value)[0] ?? null;
  const topSector = sector_exposure.by_sector[0] ?? null;
  const otherSectors = sector_exposure.by_sector.slice(1);

  return (
    <div>
      <BackToSummaryButton onBack={onBack} t={t} />
      <p className="text-[15px] font-extrabold tracking-tight mb-3" style={{ color: "var(--text)" }}>{t("portfolio.distribution.understand.exploreTitle")}</p>
      <DimensionSelector dimension={dimension} onChange={onDimensionChange} t={t} />

      {dimension === "posiciones" && (() => {
        // Fase 4E-2 (2026-11): editorial restructure of "Posiciones" —
        // conclusión (concentración + posición más grande) antes de la
        // lista completa, que pasa a ser una sección secundaria. Todo a
        // partir de `weight_pct` ya calculado por el backend, nunca una
        // cifra nueva.
        const positionsSummary = buildPositionsSummary(data.positions, lang);
        const verifiablePositions = positionsSorted.filter((p) => p.verifiable);
        return (
          <GlowCard>
            <div className="flex items-center gap-2.5 mb-1">
              <IconSquare color={GOLD} size={30}><Layers className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
              <span className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("portfolio.distribution.positions.title")}</span>
            </div>
            <p className="text-[12.5px] mb-3" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.positions.subtitle")}</p>

            <SegmentedBar
              equityPct={composition.equity_pct} etfPct={composition.etf_pct}
              equityValue={composition.equity_value} etfValue={composition.etf_value}
              currency={currency} na={na} t={t}
            />
            {/* Fase 4D, point 3B: plain-language reading of the same split
                shown above — only when BOTH shares are real numbers, never
                fabricated when one side couldn't be computed. */}
            {composition.equity_pct !== null && composition.etf_pct !== null && (
              <p className="text-[12.5px] mb-3" style={{ color: "var(--text)" }}>
                {t("portfolio.distribution.positions.compositionNote", {
                  etf: Math.round(composition.etf_pct), equity: Math.round(composition.equity_pct),
                })}
              </p>
            )}

            {/* Conclusión de concentración — primero la interpretación,
                luego los números exactos que la respaldan. */}
            {positionsSummary.concentrationHeadline && (
              <p className="text-[13.5px] font-semibold mb-0.5" style={{ color: "var(--text)" }}>{positionsSummary.concentrationHeadline}</p>
            )}
            {positionsSummary.concentrationDetail && (
              <p className="text-[12.5px] mb-3" style={{ color: "var(--sub)" }}>{positionsSummary.concentrationDetail}</p>
            )}

            {/* Posición más grande, destacada antes de la lista completa. */}
            {positionsSummary.largestHeadline && (
              <RaisedTile className="mb-3">
                <div className="flex items-start gap-2.5">
                  {positionsSummary.largestTicker && <StockAvatar ticker={positionsSummary.largestTicker} size="sm" />}
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>{positionsSummary.largestHeadline}</p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--sub)" }}>{positionsSummary.largestDetail}</p>
                  </div>
                </div>
              </RaisedTile>
            )}

            {composition.unknown_asset_value_cost_basis > 0 && (
              <p className="text-[12px] mb-3 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                {t("portfolio.distribution.positions.unknownAssetNote", { amount: fmtMoney(composition.unknown_asset_value_cost_basis, currency, na) })}
              </p>
            )}

            {/* Lista completa — sección secundaria, después de la
                conclusión y del destaque. Estructura lista para un futuro
                "Ver todas las posiciones" si la lista crece mucho; no se
                implementa un truncado todavía porque no hace falta. */}
            {verifiablePositions.length > 0 && (
              <>
                <p className="text-[11px] font-black uppercase tracking-wide mb-1.5 mt-1" style={{ color: "var(--sub)" }}>
                  {t("portfolio.distribution.positions.allPositionsTitle")}
                </p>
                {verifiablePositions.map((p) => (
                  <button key={p.ticker} onClick={() => router.push(`/stock/${p.ticker}`)} className="w-full text-left">
                    <SingleBar label={p.name || p.ticker} pct={p.weight_pct} value={p.market_value ?? 0} currency={currency} na={na} avatarTicker={p.ticker} />
                  </button>
                ))}
              </>
            )}

            {/* Puente hacia la siguiente dimensión. */}
            <button
              onClick={() => onDimensionChange("sectores")}
              className="w-full flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 mt-4 text-left"
              style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
            >
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--text)" }}>{t("portfolio.distribution.positions.bridgeToSectors")}</span>
              <span className="flex items-center gap-1 text-[12.5px] font-bold shrink-0" style={{ color: GOLD }}>
                {t("portfolio.distribution.positions.bridgeToSectorsCta")}
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </button>
          </GlowCard>
        );
      })()}

      {dimension === "sectores" && (() => {
        // "Sectores" refinement (2026-11): "Conclusión → Explicación →
        // Evidencia → Exploración." The contributor breakdown is ONLY
        // ever shown when the backend itself produced a `dominant_sector`
        // insight (its own >=30% threshold + verified contributors) —
        // looked up independently of Resumen's own priority pick, since
        // this view is specifically about sectors and shouldn't depend on
        // which category happened to win there. When that insight isn't
        // present, we show an honest "no breakdown available" message
        // instead of inferring one.
        const sectorInsight = data.insights.find((i) => i.category === "dominant_sector") ?? null;
        const contributors = (sectorInsight?.supporting_data.contributors as SectorContributor[] | undefined) ?? [];
        const contributorsExplanation = topSector ? describeContributorsExplanation(topSector.sector, contributors, data.positions, lang) : null;

        return (
          <GlowCard>
            <div className="flex items-center gap-2.5 mb-1">
              <IconSquare color={GOLD} size={30}><PieChart className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
              <span className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("portfolio.distribution.sectors.title")}</span>
            </div>
            <p className="text-[12.5px] mb-3" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.sectors.subtitle")}</p>

            {topSector ? (
              <>
                {topSector.pct_of_verified_total !== null ? (
                  <>
                    <p className="text-[14px] font-extrabold leading-snug mb-2" style={{ color: "var(--text)" }}>
                      {describeSectorHeadline(topSector.sector, topSector.pct_of_verified_total, lang)}
                    </p>
                    <SingleBar label={topSector.sector} pct={topSector.pct_of_verified_total} value={topSector.value} currency={currency} na={na} />
                    <p className="text-[12.5px] mt-2 mb-3" style={{ color: "var(--sub)" }}>
                      {describeSectorShare(topSector.sector, topSector.pct_of_verified_total, lang)}
                    </p>

                    {/* "Mostrar de dónde proviene esa exposición" — el
                        cambio más importante de este refinamiento. Nunca
                        infiere holdings de un ETF ni asume qué posiciones
                        contribuyen cuando el backend no lo calculó. */}
                    {contributors.length > 0 ? (
                      <div className="mb-3">
                        <p className="text-[13px] font-bold mb-2" style={{ color: "var(--text)" }}>
                          {t("portfolio.distribution.sectors.contributorsTitle", { sector: topSector.sector })}
                        </p>
                        {contributors.map((c) => (
                          <ContributionBar key={c.ticker} ticker={c.ticker} name={c.name} pctPoints={c.contribution_pct_points} />
                        ))}
                        <p className="text-[11.5px] mt-1.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.sectors.contributorsClarification")}</p>
                        {contributorsExplanation && (
                          <p className="text-[12.5px] mt-2 leading-relaxed" style={{ color: "var(--text)" }}>{contributorsExplanation}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12.5px] mb-3 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t("portfolio.distribution.sectors.contributorsUnavailable")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] mb-3" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.sectors.noDominantSector")}</p>
                )}

                <p className="text-[12px] mb-1" style={{ color: "var(--sub)" }}>
                  {t("portfolio.distribution.sectors.verifiedUniverseNote", { pct: fmtPct(sector_exposure.coverage_pct, na) })}
                </p>

                {otherSectors.length > 0 && (
                  <>
                    <button
                      onClick={() => setAllSectorsOpen((v) => !v)}
                      className="w-full flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 mt-2 text-[12.5px] font-bold"
                      style={{ background: "var(--raised)", color: "var(--sub)" }}
                      aria-expanded={allSectorsOpen}
                    >
                      {t("portfolio.distribution.sectors.seeAllSectors")}
                      <ChevronDown className={`w-4 h-4 transition-transform ${allSectorsOpen ? "rotate-180" : ""}`} />
                    </button>
                    {allSectorsOpen && (
                      <div className="mt-2">
                        {/* Nunca truncar — un sector pequeño debe seguir
                            visible aquí (Fase 4D/4E: "nunca ocultar el
                            porcentaje de sectores pequeños si el usuario
                            decide consultar el detalle completo"). */}
                        {otherSectors.map((row) => (
                          <SingleBar key={row.sector} label={row.sector} pct={row.pct_of_verified_total} value={row.value} currency={currency} na={na} />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.sectors.empty")}</p>
            )}
          </GlowCard>
        );
      })()}

      {dimension === "geografia" && (
        <GlowCard>
          <div className="flex items-center gap-2.5 mb-3">
            <IconSquare color={GOLD} size={30}><Globe2 className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
            <span className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("portfolio.distribution.geography.title")}</span>
          </div>
          <p className="text-[12px] mb-3 leading-relaxed" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.geography.methodologyNote")}</p>
          {(topEtfCountry || topEquityCountry) && (
            <p className="text-[12.5px] mb-3" style={{ color: "var(--text)" }}>
              {topEtfCountry && t("portfolio.distribution.geography.topEtfCountry", { country: topEtfCountry.country, pct: fmtPct(topEtfCountry.pct_of_asset_class_value, na) })}
              {topEtfCountry && topEquityCountry ? " " : ""}
              {topEquityCountry && t("portfolio.distribution.geography.topEquityCountry", { country: topEquityCountry.country, pct: fmtPct(topEquityCountry.pct_of_asset_class_value, na) })}
            </p>
          )}

          <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>
            {t("portfolio.distribution.geography.etfUnderlying")} · {fmtPct(geographic_exposure.etf_underlying_coverage_pct, na)}
          </p>
          {etfCountries.length === 0 ? (
            <p className="text-[12.5px] mb-3" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.geography.empty")}</p>
          ) : etfCountries.map((row) => (
            <SingleBar key={`etf-${row.country}`} label={row.country} pct={row.pct_of_asset_class_value} value={row.value} currency={currency} na={na} />
          ))}

          <p className="text-[11px] font-black uppercase tracking-wide mb-1.5 mt-4" style={{ color: "var(--sub)" }}>
            {t("portfolio.distribution.geography.equityDomicile")} · {fmtPct(geographic_exposure.equity_domicile_coverage_pct, na)}
          </p>
          {equityCountries.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.geography.empty")}</p>
          ) : equityCountries.map((row) => (
            <SingleBar key={`eq-${row.country}`} label={row.country} pct={row.pct_of_asset_class_value} value={row.value} currency={currency} na={na} />
          ))}
          {geographic_exposure.etf_non_applicable_value > 0 && (
            <p className="text-[12px] mt-3 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("portfolio.distribution.geography.nonApplicableNote", { amount: fmtMoney(geographic_exposure.etf_non_applicable_value, currency, na) })}
            </p>
          )}
        </GlowCard>
      )}

      {/* Detalles, fuentes, cobertura y posiciones no verificables — bajo
          demanda (Fase 4D, punto 2 de la arquitectura aprobada), nunca
          ocultos permanentemente, solo colapsados por defecto. */}
      <button
        onClick={() => setDetailsOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 mt-4 text-[12.5px] font-bold"
        style={{ background: "var(--raised)", color: "var(--sub)" }}
        aria-expanded={detailsOpen}
      >
        {t("portfolio.distribution.detailsToggle")}
        <ChevronDown className={`w-4 h-4 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
      </button>

      {detailsOpen && (
        <div className="space-y-3 mt-3">
          {sector_exposure.unclassified_value > 0 && (
            <p className="text-[12px] flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("portfolio.distribution.sectors.unclassifiedNote", { amount: fmtMoney(sector_exposure.unclassified_value, currency, na) })}
            </p>
          )}
          {sector_exposure.non_equity_style_value > 0 && (
            <p className="text-[12px] flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("portfolio.distribution.sectors.nonEquityStyleNote", { amount: fmtMoney(sector_exposure.non_equity_style_value, currency, na) })}
            </p>
          )}
          {unverifiable_positions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[12.5px] font-bold" style={{ color: "var(--text)" }}>{t("portfolio.distribution.unverifiable.title")}</p>
              {unverifiable_positions.map((u) => (
                <p key={u.ticker} className="text-[13px]" style={{ color: "var(--text)" }}>
                  {u.ticker} — {t(`portfolio.distribution.unverifiable.reason.${u.reason}`, u.reason || "")}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PortfolioDistribution({ portfolioId, onNavigateToSimulate }: { portfolioId: string; onNavigateToSimulate: () => void }) {
  const { t, i18n } = useTranslation();
  const lang: "es" | "en" = i18n.language?.startsWith("en") ? "en" : "es";
  const router = useRouter();
  const na = t("etf.detail.notAvailable");

  const [data, setData] = useState<ExposureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [view, setView] = useState<View>("resumen");
  const [dimension, setDimension] = useState<Dimension>("posiciones");
  const [pulseResult, setPulseResult] = useState<PulseCompareResult | null>(null);

  // Fase 6D §8: Pulse se consulta una vez por portafolio, nunca bloquea
  // Resumen (sin estado de carga propio visible — si tarda o falla,
  // Resumen simplemente conserva la observación estática), y se
  // invalida de inmediato al cambiar de portafolio para nunca mostrar
  // una respuesta obsoleta de otro portafolio.
  useEffect(() => {
    let cancelled = false;
    setPulseResult(null);
    portfolioExposureApi.getPulse(portfolioId || "default", "month_end")
      .then((res) => { if (!cancelled) setPulseResult(res.data); })
      .catch(() => { if (!cancelled) setPulseResult(null); });
    return () => { cancelled = true; };
  }, [portfolioId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setView("resumen");
    setDimension("posiciones");
    portfolioExposureApi.get(portfolioId || "default")
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status ?? 0;
        // Fase 8C: this route no longer has a commercial/admin gate — any
        // authenticated user reaches it — so a 403 here would mean a real,
        // unexpected backend regression, not "needs Nuvos Plus." Falls
        // into the generic bucket rather than claiming something false.
        const message =
          status === 404 ? t("portfolio.distribution.error.notFound")
          // 401 means the shared axios interceptor already tried refreshing
          // the session and still couldn't get a valid one — a real, distinct
          // state from "we couldn't compute the exposure," so it needs its
          // own message rather than falling into the generic bucket.
          : status === 401 ? t("portfolio.distribution.error.sessionExpired")
          : t("portfolio.distribution.error.generic");
        setError({ status, message });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // `t` is intentionally excluded — it's only used to build an error
    // message inside the catch handler, never to decide WHEN to fetch.
    // Including it here would re-run this effect (re-fetching, and — once
    // the Fase 4D view/dimension reset was added — bouncing back to
    // Resumen) on every render where `t`'s reference changes, which is an
    // implementation detail of the i18n library, not a real signal that
    // the portfolio changed. Fase 4D, point 5: "no repetir solicitudes
    // innecesarias al backend."
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolioId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-7 h-7 animate-spin" style={{ color: GOLD }} />
        <p className="text-sm" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.loading")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <GlowCard tint="#E05252" className="text-center py-10 max-w-[560px] mx-auto">
        <AlertTriangle className="w-8 h-8 mx-auto mb-3" style={{ color: "#E05252" }} />
        <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--sub)" }}>{error.message}</p>
      </GlowCard>
    );
  }

  if (!data) return null;

  const { currency } = data;
  const primaryInsight = selectPrimaryInsight(data.insights);

  return (
    <div className="space-y-5 pb-8">
      {view === "resumen" && (
        <SummaryView
          data={data} currency={currency} na={na} t={t} lang={lang}
          primaryInsight={primaryInsight} pulseResult={pulseResult}
          onUnderstand={() => setView("entender")}
          onNavigateToSimulate={onNavigateToSimulate}
          onPulseExplore={(dim) => { setDimension(dim); setView("entender"); }}
        />
      )}
      {view === "entender" && (
        <UnderstandView
          data={data} dimension={dimension} onDimensionChange={setDimension}
          currency={currency} na={na} t={t} lang={lang} router={router}
          primaryInsight={primaryInsight}
          onBack={() => setView("resumen")}
        />
      )}
    </div>
  );
}
