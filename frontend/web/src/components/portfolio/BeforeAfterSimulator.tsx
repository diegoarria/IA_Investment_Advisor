"use client";

// Nuvos Plus — Fase 4C-2: "Antes de invertir", nested inside "Mi
// distribución" (never a separate tab/app — Diego, 2026-11: "debe
// sentirse como una extensión natural de Mi distribución").
//
// Strictly a thin presentation layer over POST /api/portfolio-exposure/
// {portfolioId}/simulate and (Fase 5C) /simulate-history — every
// percentage, delta, curve point, volatility and drawdown figure shown
// here is read verbatim from those responses. Nothing here recomputes a
// percentage, a points delta, or a financial metric (see src/lib/
// simulationInsights.ts's own docstring for the same rule applied to the
// educational panel, and src/lib/historyChartDownsample.ts's for the
// chart's display-only point reduction).

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Search, Loader2, AlertTriangle, X, TrendingUp, ListTree, ChevronDown,
  Sparkles, RotateCcw, Info, LineChart as LineChartIcon, PieChart,
} from "lucide-react";
import { GlowCard, IconSquare, RaisedTile } from "@/components/subvaluadas/radarUi";
import { ExpandableSection } from "@/components/ui/ExpandableSection";
// Fase 7.2 (Diego, captura real): verde de marca, no el dorado de Radar
// — ver el mismo comentario en PortfolioDistribution.tsx. Hex literal
// (no `var(--accent-l)`) porque este archivo también concatena un
// sufijo de alfa (`${GOLD}55`).
const GOLD = "#00e887";
import StockAvatar from "@/components/StockAvatar";
import { AssetIdentity } from "@/components/portfolio/AssetIdentity";
import type { TFunction } from "i18next";
import { portfolioExposureApi, market as marketApi } from "@/lib/api";
import { buildSimulationInsights, describeHypotheticalWeight, type SimulationResult, type SimulationInsight } from "@/lib/simulationInsights";
import { HistoryComparisonChart } from "@/components/portfolio/HistoryComparisonChart";
import { buildDisplaySeries, type HistoryPoint } from "@/lib/historyChartDownsample";

type SearchResult = { ticker: string; name?: string };
type HistoryPeriod = "1y" | "3y" | "5y";

type HistoryMetric = { value: number | null; observations?: number; reason?: string } | null;
type HistoryDrawdown = { value: number | null; peak_date?: string; trough_date?: string; reason?: string } | null;

interface HistoryAvailable {
  available: true;
  period_requested: HistoryPeriod;
  window_status: "full" | "partial";
  start_date: string;
  end_date: string;
  observations: number;
  index_before: HistoryPoint[];
  index_after: HistoryPoint[];
  volatility_before: HistoryMetric;
  volatility_after: HistoryMetric;
  max_drawdown_before: HistoryDrawdown;
  max_drawdown_after: HistoryDrawdown;
  sources: string[];
  methodology_es: string;
  methodology_en?: string;
}
interface HistoryUnavailable {
  available: false;
  reason: string;
  detail?: Record<string, unknown>;
}
type HistoryResult = HistoryAvailable | HistoryUnavailable;

const DEBOUNCE_MS = 350;
const HISTORY_PERIODS: HistoryPeriod[] = ["1y", "3y", "5y"];

function fmtMoney(n: number | null | undefined, currency: string, na: string): string {
  if (n === null || n === undefined) return na;
  return `${currency} $${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined, na: string, digits = 1): string {
  if (n === null || n === undefined) return na;
  return `${n.toFixed(digits)}%`;
}

function fmtSignedPct(n: number | null | undefined, na: string, digits = 1): string {
  if (n === null || n === undefined) return na;
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

// A before/after pair for one metric — neutral styling, now actually
// enforced (Diego, 2026-11, rediseño: el bug real era que GOLD se
// aplicaba sin condición alguna de signo, pintando todo aumento de
// concentración en el mismo verde de "ganancia" — ver auditoría previa).
// Un aumento o disminución de peso/concentración NUNCA es inherentemente
// positivo o negativo, así que ambas barras y el delta usan colores
// neutrales (--muted/--text), nunca --up/--down/GOLD. Esos colores
// financieros se reservan exclusivamente para rendimientos reales
// (Historia), nunca para esto.
function BeforeAfterRow({ label, beforePct, afterPct, na }: { label: string; beforePct: number | null; afterPct: number | null; na: string }) {
  const delta = beforePct !== null && afterPct !== null ? Math.round((afterPct - beforePct) * 10) / 10 : null;
  const sign = delta !== null && delta >= 0 ? "+" : "";
  return (
    <div className="py-2.5 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
      <p className="font-semibold mb-1.5" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>{label}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="w-full h-[6px] rounded-full overflow-hidden mb-1" style={{ background: "var(--raised)" }}>
            <div className="h-full rounded-full" style={{ width: `${beforePct !== null ? Math.max(2, beforePct) : 0}%`, background: "var(--muted)" }} />
          </div>
          <span style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{fmtPct(beforePct, na)}</span>
        </div>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 -rotate-90" style={{ color: "var(--muted)" }} />
        <div className="flex-1">
          <div className="w-full h-[6px] rounded-full overflow-hidden mb-1" style={{ background: "var(--raised)" }}>
            <div className="h-full rounded-full" style={{ width: `${afterPct !== null ? Math.max(2, afterPct) : 0}%`, background: "var(--text)" }} />
          </div>
          <span className="font-semibold" style={{ color: "var(--text)", fontSize: "var(--fs-label)" }}>{fmtPct(afterPct, na)}</span>
        </div>
        {delta !== null && (
          <span className="font-bold shrink-0 w-14 text-right" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>{sign}{delta.toFixed(1)}pp</span>
        )}
      </div>
    </div>
  );
}

// Diego, 2026-11 (rediseño): sin caja propia, mismo tratamiento que
// InsightCard — baja un nivel de anidamiento donde esta tarjeta ya
// vivía dentro de otra con fondo propio.
function SimInsightCard({ insight, t }: { insight: SimulationInsight; t: TFunction }) {
  const detailEntries = Object.entries(insight.supporting_data).filter(([k]) => k !== "meaning");
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <IconSquare color={GOLD} size={24}><Sparkles className="w-3 h-3" style={{ color: GOLD }} /></IconSquare>
        <p className="font-black uppercase tracking-wide" style={{ color: GOLD, fontSize: "var(--fs-label)" }}>
          {t(`portfolio.distribution.simulate.understand.categoryTitles.${insight.category}`, insight.category)}
        </p>
      </div>
      <p className="leading-relaxed" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>{insight.text}</p>
      {detailEntries.length > 0 && (
        <div className="mt-2">
          <ExpandableSection title={t("etf.detail.understand.seeData")}>
            {detailEntries.map(([k, v]) => (
              <p key={k} className="font-mono" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</p>
            ))}
          </ExpandableSection>
        </div>
      )}
    </div>
  );
}

// Fase 5C: the three perspectives. "distribution" and "exposure" simply
// re-present data the component already had (same simResult, zero new
// fetch) — only "history" triggers the new /simulate-history call, and
// only once it's actually selected.
function PerspectiveTabs({ value, onChange, t }: { value: "distribution" | "exposure" | "history"; onChange: (v: "distribution" | "exposure" | "history") => void; t: TFunction }) {
  const tabs: { key: "distribution" | "exposure" | "history"; icon: React.ReactNode }[] = [
    { key: "distribution", icon: <ListTree className="w-3.5 h-3.5" /> },
    { key: "exposure", icon: <PieChart className="w-3.5 h-3.5" /> },
    { key: "history", icon: <LineChartIcon className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex gap-1.5 p-1 rounded-xl" style={{ background: "var(--raised)" }} role="tablist">
      {tabs.map(({ key, icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 rounded-lg px-1.5 sm:px-2.5 py-1.5 sm:py-2 text-[11px] sm:text-[12.5px] font-bold transition-colors min-w-0"
            style={active ? { background: GOLD, color: "#1A1A1A" } : { background: "transparent", color: "var(--sub)" }}
          >
            {icon}
            <span className="truncate">{t(`portfolio.distribution.simulate.perspective.${key}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

function HistoryUnavailablePanel({ result, t }: { result: HistoryUnavailable; t: TFunction }) {
  const message = t(`portfolio.distribution.simulate.history.unavailable.${result.reason}`, t("portfolio.distribution.simulate.history.unavailable.generic"));
  return (
    <div className="flex items-start gap-2 rounded-xl p-3.5" style={{ background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)" }}>
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#E05252" }} />
      <div>
        <p className="text-[13px] font-bold mb-0.5" style={{ color: "var(--text)" }}>{t("portfolio.distribution.simulate.history.unavailableTitle")}</p>
        <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>{message}</p>
      </div>
    </div>
  );
}

function HistoryPerspective({
  loading, error, result, period, onPeriodChange, hypotheticalTicker, t,
}: {
  loading: boolean;
  error: string | null;
  result: HistoryResult | null;
  period: HistoryPeriod;
  onPeriodChange: (p: HistoryPeriod) => void;
  hypotheticalTicker: string;
  t: TFunction;
}) {
  return (
    <div className="space-y-3.5">
      <div>
        <p className="font-black leading-snug" style={{ color: "var(--text)", fontSize: "var(--fs-h2)" }}>{t("portfolio.distribution.simulate.history.title")}</p>
        <p className="mt-0.5" style={{ color: "var(--sub)", fontSize: "var(--fs-body-sm)" }}>{t("portfolio.distribution.simulate.history.subtitle")}</p>
      </div>

      <div className="flex gap-1.5">
        {HISTORY_PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriodChange(p)}
            className="rounded-lg px-3 py-1.5 text-[12px] font-bold"
            style={p === period ? { background: GOLD, color: "#1A1A1A" } : { background: "var(--raised)", color: "var(--sub)" }}
          >
            {t(`portfolio.distribution.simulate.history.period.${p}`)}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: GOLD }} />
          <span className="text-[12.5px]" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.history.loading")}</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 rounded-xl p-3.5" style={{ background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#E05252" }} />
          <p className="text-[12.5px]" style={{ color: "var(--text)" }}>{error}</p>
        </div>
      )}

      {!loading && !error && result && !result.available && (
        <HistoryUnavailablePanel result={result} t={t} />
      )}

      {!loading && !error && result && result.available && (
        <>
          {result.window_status === "partial" && (
            <p className="text-[11.5px] flex items-start gap-1.5" style={{ color: "#E0A030" }}>
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("portfolio.distribution.simulate.history.windowPartial", {
                start: result.start_date,
                requested: t(`portfolio.distribution.simulate.history.period.${result.period_requested}`),
              })}
            </p>
          )}

          {(() => {
            const forceDates = [
              result.max_drawdown_before?.peak_date, result.max_drawdown_before?.trough_date,
              result.max_drawdown_after?.peak_date, result.max_drawdown_after?.trough_date,
            ].filter((d): d is string => !!d);
            const { a, b } = buildDisplaySeries(result.index_before, result.index_after, 180, forceDates);
            return (
              <HistoryComparisonChart
                seriesA={a}
                seriesB={b}
                labelA={t("portfolio.distribution.simulate.history.legendBefore")}
                labelB={`${t("portfolio.distribution.simulate.history.legendAfter")} (+${hypotheticalTicker})`}
                logoTickerB={hypotheticalTicker}
                formatValue={(v) => v.toFixed(1)}
              />
            );
          })()}

          <p className="text-[11px]" style={{ color: "var(--sub)" }}>
            <span>{t("portfolio.distribution.simulate.history.startingValue")}</span>{" "}
            <span>
              {t("portfolio.distribution.simulate.history.dateRange", {
                start: result.start_date, end: result.end_date, observations: result.observations,
              })}
            </span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <RaisedTile>
              <p className="font-semibold mb-1.5" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{t("portfolio.distribution.simulate.history.volatilityTitle")}</p>
              <div className="flex items-center gap-2" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--muted)" }} />{fmtPct(result.volatility_before?.value ?? null, "—")}
              </div>
              <div className="flex items-center gap-2 mt-1" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GOLD }} />{fmtPct(result.volatility_after?.value ?? null, "—")}
              </div>
              <p className="mt-1.5 leading-relaxed" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{t("portfolio.distribution.simulate.history.volatilityExplain")}</p>
            </RaisedTile>
            <RaisedTile>
              <p className="font-semibold mb-1.5" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{t("portfolio.distribution.simulate.history.drawdownTitle")}</p>
              <div className="flex items-center gap-2" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--muted)" }} />{fmtSignedPct(result.max_drawdown_before?.value ?? null, "—")}
              </div>
              {result.max_drawdown_before?.peak_date && result.max_drawdown_before?.trough_date && (
                <p className="pl-4" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>
                  {t("portfolio.distribution.simulate.history.drawdownDetail", {
                    peakDate: result.max_drawdown_before.peak_date, troughDate: result.max_drawdown_before.trough_date,
                  })}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1.5" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GOLD }} />{fmtSignedPct(result.max_drawdown_after?.value ?? null, "—")}
              </div>
              {result.max_drawdown_after?.peak_date && result.max_drawdown_after?.trough_date && (
                <p className="pl-4" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>
                  {t("portfolio.distribution.simulate.history.drawdownDetail", {
                    peakDate: result.max_drawdown_after.peak_date, troughDate: result.max_drawdown_after.trough_date,
                  })}
                </p>
              )}
              <p className="mt-1.5 leading-relaxed" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{t("portfolio.distribution.simulate.history.drawdownExplain")}</p>
            </RaisedTile>
          </div>

          <p className="leading-relaxed rounded-xl p-2.5" style={{ color: "var(--sub)", background: "var(--raised)", fontSize: "var(--fs-body-sm)" }}>
            {t("portfolio.distribution.simulate.history.disclaimer")}
          </p>

          <ExpandableSection title={t("portfolio.distribution.simulate.history.methodologyToggle")}>
            <p style={{ color: "var(--sub)", fontSize: "var(--fs-body-sm)" }}>{result.methodology_es}</p>
            {result.sources?.length > 0 && (
              <>
                <p className="font-semibold mt-2" style={{ color: "var(--text)", fontSize: "var(--fs-body-sm)" }}>{t("portfolio.distribution.simulate.history.sourcesTitle")}</p>
                <ul className="list-disc pl-4" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>
                  {result.sources.map((s) => <li key={s}>{s}</li>)}
                </ul>
              </>
            )}
          </ExpandableSection>
        </>
      )}
    </div>
  );
}

export default function BeforeAfterSimulator({ portfolioId, currency, na }: { portfolioId: string; currency: string; na: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "es";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [amountInput, setAmountInput] = useState("");

  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  // Which (ticker, amount) the current simResult actually corresponds to
  // — used to invalidate a stale result the instant the user changes
  // either input, per Diego's explicit "el resultado antiguo se invalide
  // cuando cambian los parámetros."
  const [simulatedFor, setSimulatedFor] = useState<{ ticker: string; amount: string } | null>(null);

  // Fase 5C: the three-perspective selector + the Historia tab's own state.
  const [perspective, setPerspective] = useState<"distribution" | "exposure" | "history">("distribution");
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriod>("1y");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyResult, setHistoryResult] = useState<HistoryResult | null>(null);
  // Local cache keyed by portfolio+ticker+amount+period — switching
  // periods back and forth, or reopening the Historia tab, never
  // re-fetches a combination already answered. Never shared across a
  // portfolioId change (cleared below).
  const historyCacheRef = useRef<Map<string, HistoryResult>>(new Map());
  // Ignore a response that's no longer the latest request (e.g. the user
  // switched periods again before the first one came back).
  const historyReqIdRef = useRef(0);

  const clearHistoryState = () => {
    setHistoryResult(null);
    setHistoryError(null);
    setHistoryLoading(false);
    historyReqIdRef.current += 1; // invalidate any in-flight request
  };

  // Changing portfolio (switching tabs between portfolios) must never
  // carry over a previous simulation or a previous historical cache.
  useEffect(() => {
    setSelected(null);
    setAmountInput("");
    setSimResult(null);
    setSimError(null);
    setSimulatedFor(null);
    setQuery("");
    setResults(null);
    setPerspective("distribution");
    historyCacheRef.current.clear();
    clearHistoryState();
  }, [portfolioId]);

  // Stale-result invalidation: any change to ticker or amount after a
  // result exists immediately clears it — the user must re-run "Simular"
  // rather than see a result that no longer matches their inputs. The
  // historical comparison is tied to the exact same (ticker, amount), so
  // it's invalidated the same way.
  useEffect(() => {
    if (!simulatedFor) return;
    const ticker = selected?.ticker ?? null;
    if (ticker !== simulatedFor.ticker || amountInput !== simulatedFor.amount) {
      setSimResult(null);
      setSimulatedFor(null);
      clearHistoryState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, amountInput]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults(null); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      marketApi.searchTickers(q)
        .then((res) => setResults(res.data?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const amountNum = parseFloat(amountInput.replace(",", "."));
  const amountValid = amountInput.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;
  const amountError = amountInput.trim() !== "" && !amountValid ? t("portfolio.distribution.simulate.amountInvalid") : null;

  const runSimulation = () => {
    if (!selected || !amountValid) return;
    setSimLoading(true);
    setSimError(null);
    setPerspective("distribution");
    clearHistoryState();
    portfolioExposureApi.simulate(portfolioId || "default", selected.ticker, amountNum)
      .then((res) => {
        setSimResult(res.data);
        setSimulatedFor({ ticker: selected.ticker, amount: amountInput });
      })
      .catch((err) => {
        const status = err?.response?.status ?? 0;
        const detail = err?.response?.data?.detail;
        // Fase 8C: no commercial/admin gate left on this route — a 403
        // here would be an unexpected backend regression, not "needs
        // Nuvos Plus," so it falls into the generic bucket.
        const message =
          status === 422 ? (typeof detail === "string" ? detail : t("portfolio.distribution.simulate.error.invalid"))
          : status === 404 ? t("portfolio.distribution.error.notFound")
          : t("portfolio.distribution.simulate.error.generic");
        setSimError(message);
      })
      .finally(() => setSimLoading(false));
  };

  const discard = () => {
    setSelected(null);
    setAmountInput("");
    setSimResult(null);
    setSimError(null);
    setSimulatedFor(null);
    setPerspective("distribution");
    clearHistoryState();
  };

  // Fase 5C: fetch the historical comparison on-demand — only when the
  // user is actually looking at the Historia tab, only the ONE period
  // selected (never all three), and only for the (ticker, amount) pair
  // the current simResult was actually produced for (never a stale
  // combination). A local cache makes switching periods/tabs back and
  // forth free after the first real fetch.
  useEffect(() => {
    if (perspective !== "history" || !simulatedFor) return;
    const amt = parseFloat(simulatedFor.amount.replace(",", "."));
    if (!Number.isFinite(amt) || amt <= 0) return;
    const cacheKey = `${portfolioId || "default"}|${simulatedFor.ticker}|${amt}|${historyPeriod}`;
    const cached = historyCacheRef.current.get(cacheKey);
    if (cached) {
      setHistoryResult(cached);
      setHistoryError(null);
      return;
    }
    const reqId = ++historyReqIdRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    portfolioExposureApi.simulateHistory(portfolioId || "default", simulatedFor.ticker, amt, historyPeriod)
      .then((res) => {
        if (reqId !== historyReqIdRef.current) return; // a newer request superseded this one — ignore
        const history: HistoryResult = res.data.history;
        historyCacheRef.current.set(cacheKey, history);
        setHistoryResult(history);
      })
      .catch((err) => {
        if (reqId !== historyReqIdRef.current) return;
        const status = err?.response?.status ?? 0;
        const message =
          status === 404 ? t("portfolio.distribution.error.notFound")
          : t("portfolio.distribution.simulate.history.errorGeneric");
        setHistoryError(message);
      })
      .finally(() => {
        if (reqId === historyReqIdRef.current) setHistoryLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perspective, historyPeriod, simulatedFor, portfolioId]);

  const insights = simResult && selected ? buildSimulationInsights(simResult, selected.ticker, lang) : [];
  const primaryInsight = insights[0] ?? null;
  const secondaryInsights = insights.slice(1);
  // Diego, 2026-11 (rediseño): "position_weight" ahora se muestra SIEMPRE
  // arriba (junto con su nueva frase de significado), sin importar la
  // pestaña — mostrarlo otra vez en "Exposición" sería la misma
  // duplicación que el slice(1) de abajo ya evita para sectores.
  const exposurePrimaryInsight = primaryInsight?.category === "position_weight" ? (insights[1] ?? null) : primaryInsight;
  const exposureSecondaryInsights = primaryInsight?.category === "position_weight" ? insights.slice(2) : secondaryInsights;
  const topSectorDeltas = simResult ? simResult.sector_deltas.slice(0, 4) : [];
  const mostRelevantSectorDelta = topSectorDeltas[0] ?? null;
  const beforeTop = simResult?.before.concentration.top_positions[0] ?? null;
  const afterTop = simResult?.after.concentration.top_positions[0] ?? null;
  const beforeTickerWeight = simResult && selected ? simResult.before.positions.find((p) => p.ticker === selected.ticker)?.weight_pct ?? 0 : null;
  const afterTickerWeight = simResult && selected ? simResult.after.positions.find((p) => p.ticker === selected.ticker)?.weight_pct ?? null : null;
  const hypotheticalWeightSentence = selected ? describeHypotheticalWeight(selected.ticker, afterTickerWeight, lang) : null;
  // Fase 5D: the backend-verified name (from the real simulation result)
  // always wins over the plain search result's name — it's the same
  // ticker either way, but `after.positions` is the one that actually
  // went through company/fund-name resolution.
  const simulatedPosition = simResult && selected ? simResult.after.positions.find((p) => p.ticker === selected.ticker) : null;
  const simulatedName = simulatedPosition?.name ?? selected?.name ?? null;
  const simulatedEtfCompany = simulatedPosition?.etf_company ?? null;

  return (
    <GlowCard tint={GOLD}>
      <div className="flex items-center gap-2.5 mb-1">
        <IconSquare color={GOLD} size={34}><TrendingUp className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
        <span className="text-base font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("portfolio.distribution.simulate.title")}</span>
      </div>
      <p className="text-[12.5px] mb-3" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.subtitle")}</p>

      {/* Fase 4E, point 4A: both steps side by side on desktop, stacked on
          mobile — same fields, same validation, less vertical space to
          scroll before reaching "Simular". */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
        <div>
          <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.step1")}</p>
          {selected ? (
            <span className="inline-flex items-center gap-2 rounded-full pl-2 pr-2 py-1 text-[13px] font-bold"
                  style={{ background: "var(--raised)", color: GOLD, border: `1px solid ${GOLD}55` }}>
              <StockAvatar ticker={selected.ticker} size="sm" />
              {selected.ticker}{selected.name ? ` · ${selected.name}` : ""}
              <button onClick={() => setSelected(null)} aria-label={t("portfolio.distribution.simulate.removeTicker")}>
                <X className="w-3.5 h-3.5" style={{ color: "var(--sub)" }} />
              </button>
            </span>
          ) : (
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("portfolio.distribution.simulate.searchPlaceholder")}
                className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none"
                style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
              {query.trim() && (
                <div className="absolute z-10 mt-1 w-full rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  {searching && <div className="flex items-center gap-2 px-3.5 py-2.5"><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GOLD }} /></div>}
                  {!searching && results && results.length === 0 && (
                    <p className="px-3.5 py-2.5 text-[13px]" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.searchEmpty")}</p>
                  )}
                  {!searching && results && results.slice(0, 6).map((r) => (
                    <button key={r.ticker} onClick={() => { setSelected(r); setQuery(""); setResults(null); }}
                            className="w-full text-left px-3.5 py-2.5 flex items-center gap-2.5 hover:bg-[var(--raised)]">
                      <StockAvatar ticker={r.ticker} size="sm" />
                      <span className="min-w-0">
                        <span className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{r.ticker}</span>
                        {r.name && <span className="text-[12px] ml-2 truncate" style={{ color: "var(--sub)" }}>{r.name}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.step2")}</p>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] font-bold" style={{ color: "var(--sub)" }}>{currency} $</span>
            <input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl pl-16 pr-4 py-2.5 text-sm outline-none"
              style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          {amountError && <p className="text-[12px] mt-1" style={{ color: "#E05252" }}>{amountError}</p>}
        </div>
      </div>

      <p className="text-[11.5px] mb-3 flex items-start gap-1.5" style={{ color: "var(--sub)" }}>
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t("portfolio.distribution.simulate.amountNote")}
      </p>

      <button
        onClick={runSimulation}
        disabled={!selected || !amountValid || simLoading}
        className="w-full sm:w-auto rounded-xl px-5 py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: GOLD, color: "#1A1A1A" }}
      >
        {simLoading ? <><Loader2 className="w-4 h-4 animate-spin" />{t("portfolio.distribution.simulate.simulating")}</> : t("portfolio.distribution.simulate.simulateButton")}
      </button>

      {simError && (
        <div className="flex items-start gap-2 mt-4 rounded-xl p-3" style={{ background: "rgba(224,82,82,0.08)", border: "1px solid rgba(224,82,82,0.3)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#E05252" }} />
          <p className="text-[13px]" style={{ color: "var(--text)" }}>{simError}</p>
        </div>
      )}

      {/* Paso 3 — resultado. Fase 4C, punto 4: resumen breve primero
          (inversión, monto, peso antes/después); Fase 5C añade un
          selector de tres perspectivas (Distribución/Exposición/
          Historia) justo debajo, cada una reutilizando los mismos datos
          ya obtenidos (o, para Historia, el único fetch nuevo de esta
          fase). */}
      {simResult && selected && (
        <div className="mt-5 pt-5 space-y-4" style={{ borderTop: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold" style={{ background: "var(--raised)", color: GOLD }}>
              <Sparkles className="w-3.5 h-3.5" />{t("portfolio.distribution.simulate.hypotheticalBadge")}
            </span>
            <button onClick={discard} className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: "var(--sub)" }}>
              <RotateCcw className="w-3.5 h-3.5" />{t("portfolio.distribution.simulate.discard")}
            </button>
          </div>

          {simResult.before_had_no_verified_positions && (
            <p className="text-[12.5px] flex items-start gap-1.5" style={{ color: "#E0A030" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{t("portfolio.distribution.simulate.noBeforeVerified")}
            </p>
          )}

          {/* Fase 4E, point 4B: absolute priority on the result — this is
              the very first thing after the hypothetical badge, right
              next to the form, and shown regardless of which perspective
              is selected below. Fase 5D: now leads into the asset's real
              identity (logo + ticker + name) instead of naming the
              ticker inline in the sentence itself. */}
          {/* Diego, 2026-11 (rediseño): jerarquía "decisión → cambio
              principal → significado → detalle" — el cambio principal
              (peso antes/después del ticker simulado) y su significado
              ya no viven detrás de la pestaña "Distribución", se ven
              SIEMPRE, sin importar qué perspectiva esté seleccionada
              abajo, exactamente como pide el rediseño aprobado. */}
          <div>
            <p className="font-black leading-snug mb-2" style={{ color: "var(--text)", fontSize: "var(--fs-h2)" }}>
              {t("portfolio.distribution.simulate.resultIntro", { amount: fmtMoney(simResult.amount, currency, na) })}
            </p>
            <AssetIdentity
              ticker={selected.ticker}
              name={simulatedName}
              etfCompany={simulatedEtfCompany}
              size="md"
              tickerClassName="text-[16px]"
              nameClassName="text-[12.5px]"
            />
          </div>

          {afterTickerWeight !== null && (
            <RaisedTile>
              <div className="mt-0.5">
                <BeforeAfterRow label={t("portfolio.distribution.simulate.positionWeightTitle")} beforePct={beforeTickerWeight} afterPct={afterTickerWeight} na={na} />
              </div>
            </RaisedTile>
          )}
          {hypotheticalWeightSentence && (
            <p className="leading-relaxed" style={{ color: "var(--sub)", fontSize: "var(--fs-body)" }}>{hypotheticalWeightSentence}</p>
          )}
          {/* "Qué significa para ti" — la consecuencia educativa, nunca
              una predicción sobre si la inversión será buena o mala,
              basada únicamente en la dirección real del cambio de peso. */}
          {primaryInsight?.category === "position_weight" && typeof primaryInsight.supporting_data.meaning === "string" && (
            <p className="leading-relaxed" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>
              {primaryInsight.supporting_data.meaning as string}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <RaisedTile>
              <p className="mb-1" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{t("portfolio.distribution.simulate.valueBefore")}</p>
              <p className="font-black" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>{fmtMoney(simResult.before.valuation.total_value_verified, currency, na)}</p>
            </RaisedTile>
            <RaisedTile>
              <p className="mb-1" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>{t("portfolio.distribution.simulate.valueAfter")}</p>
              {/* Diego, 2026-11 (rediseño): neutral, no GOLD — este
                  aumento es por el capital agregado en la simulación,
                  nunca un rendimiento (ver nota justo debajo). */}
              <p className="font-black" style={{ color: "var(--text)", fontSize: "var(--fs-body)" }}>{fmtMoney(simResult.after.valuation.total_value_verified, currency, na)}</p>
            </RaisedTile>
          </div>
          {/* Fase 5D, §5C: discreet clarification, not a new big card —
              the value increase is the hypothetical contribution
              itself, never a projected return. */}
          <p className="flex items-start gap-1.5" style={{ color: "var(--sub)", fontSize: "var(--fs-label)" }}>
            <Info className="w-3 h-3 shrink-0 mt-0.5" />
            {t("portfolio.distribution.simulate.valueIncreaseNote", { amount: fmtMoney(simResult.amount, currency, na) })}
          </p>

          <PerspectiveTabs value={perspective} onChange={setPerspective} t={t} />

          {perspective === "distribution" && (
            <div className="space-y-4">
              {afterTop && (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>
                    {t("portfolio.distribution.simulate.concentrationTitle", { ticker: afterTop.ticker })}
                  </p>
                  <BeforeAfterRow
                    label={t("portfolio.distribution.simulate.concentrationChangeLabel")}
                    beforePct={beforeTop ? beforeTop.weight_pct : 0}
                    afterPct={afterTop.weight_pct}
                    na={na}
                  />
                </div>
              )}
            </div>
          )}

          {perspective === "exposure" && (
            <div className="space-y-4">
              {mostRelevantSectorDelta && (
                <RaisedTile>
                  <p className="text-[10.5px] font-semibold mb-1" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.mostRelevantChange")}</p>
                  <BeforeAfterRow label={mostRelevantSectorDelta.sector} beforePct={mostRelevantSectorDelta.pct_before} afterPct={mostRelevantSectorDelta.pct_after} na={na} />
                </RaisedTile>
              )}

              {exposurePrimaryInsight && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <IconSquare color={GOLD} size={24}><ListTree className="w-3 h-3" style={{ color: GOLD }} /></IconSquare>
                    <span className="text-[13px] font-extrabold" style={{ color: "var(--text)" }}>{t("portfolio.distribution.simulate.understand.title")}</span>
                  </div>
                  <SimInsightCard insight={exposurePrimaryInsight} t={t} />
                </div>
              )}
              {!exposurePrimaryInsight && (
                <p className="text-[12.5px]" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.understand.empty")}</p>
              )}

              {/* slice(1): the #1 sector change is already shown in the
                  highlight tile right above — repeating it here would be
                  the exact duplication Fase 5C.1's QA pass flagged. */}
              {topSectorDeltas.slice(1).length > 0 && (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.sectorTitle")}</p>
                  {topSectorDeltas.slice(1).map((d) => (
                    <BeforeAfterRow key={d.sector} label={d.sector} beforePct={d.pct_before} afterPct={d.pct_after} na={na} />
                  ))}
                </div>
              )}

              {/* Geografía — solo si hay datos compatibles; cada fila deja
                  explícito de qué universo es el porcentaje (ETFs o
                  acciones, nunca del portafolio completo). */}
              {simResult.country_deltas && simResult.country_deltas.length > 0 && (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.geographyTitle")}</p>
                  {simResult.country_deltas.slice(0, 3).map((d) => (
                    <BeforeAfterRow key={`${d.country}-${d.methodology}`} label={`${d.country} (${d.methodology === "etf_underlying" ? t("portfolio.distribution.geography.etfUnderlyingLabel") : t("portfolio.distribution.geography.equityDomicileLabel")})`} beforePct={d.pct_before} afterPct={d.pct_after} na={na} />
                  ))}
                </div>
              )}

              <div className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
                <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.coverageTitle")}</p>
                <p className="text-[12.5px]" style={{ color: "var(--text)" }}>
                  {t("portfolio.distribution.simulate.coverageNote", {
                    before: fmtPct(simResult.before.sector_exposure.coverage_pct, na),
                    after: fmtPct(simResult.after.sector_exposure.coverage_pct, na),
                  })}
                </p>
              </div>

              {exposureSecondaryInsights.length > 0 && (
                <div>
                  <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: "var(--sub)" }}>{t("portfolio.distribution.simulate.otherChanges")}</p>
                  <div className="space-y-2">
                    {exposureSecondaryInsights.map((insight, i) => <SimInsightCard key={i} insight={insight} t={t} />)}
                  </div>
                </div>
              )}
            </div>
          )}

          {perspective === "history" && (
            <HistoryPerspective
              loading={historyLoading}
              error={historyError}
              result={historyResult}
              period={historyPeriod}
              onPeriodChange={setHistoryPeriod}
              hypotheticalTicker={selected.ticker}
              t={t}
            />
          )}

          <p className="text-[11px] leading-relaxed pt-3" style={{ color: "var(--sub)", borderTop: "1px solid var(--border)" }}>
            {t("portfolio.distribution.simulate.disclaimer")}
          </p>
        </div>
      )}
    </GlowCard>
  );
}
