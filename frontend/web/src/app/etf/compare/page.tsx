"use client";

// Nuvos ETF — comparador educativo (Fase 3A, Etapa 2, 2026-11).
//
// Admin-gated por el backend. Reutiliza AppSidebar/MarketTickerBar y el
// sistema visual de radarUi.tsx — nada nuevo inventado. Consume
// GET /api/etf/compare (comparison.py), que ya normaliza/alinea sectores
// y países y genera hasta 3 observaciones deterministas.
//
// Reglas de precisión que esta pantalla respeta porque el backend ya las
// garantiza, nunca las "arregla" en el cliente:
//  - Un valor de sector/país puede ser `null` ("No disponible") en vez de
//    0% — nunca se renderiza como una barra vacía igual a un cero real.
//  - El rendimiento histórico se muestra por ETF, nunca comparado
//    directamente (no hay una barra o número "ganador").
//  - Si `comparison_ready` es false, esta pantalla NO renderiza la
//    comparación como si estuviera terminada — muestra el estado
//    incompleto explícitamente.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  Search, Loader2, AlertTriangle, X, Plus, Scale, PieChart, Globe2,
  DollarSign, TrendingUp, ListTree, ChevronDown, ExternalLink, Info,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import { GlowCard, Eyebrow, IconSquare, RaisedTile } from "@/components/subvaluadas/radarUi";
// Fase 7.2 (Diego, captura real): verde de marca, no el dorado de
// Radar — mismo criterio en toda la sección "Explorar ETFs".
const GOLD = "#00e887";
import { etfApi } from "@/lib/api";

type SearchResult = { symbol: string; name: string };
type WeightRow = { name: string; [ticker: string]: string | number | null };
type ComparisonInsight = { category: string; text: string; supporting_data: Record<string, unknown> };

type EtfSummary = {
  ticker: string;
  identification: {
    name: string | null; etf_company: string | null; description: string | null;
    has_editorial_description: boolean; inception_date: string | null; domicile: string | null;
    exchange: string | null; isin: string | null;
  };
  costs: { expense_ratio_pct: number | null; cost_tier: string | null; aum_usd: number | null; nav: number | null; nav_currency: string | null };
  exposure: {
    sector_weightings: { name: string; weight_pct: number }[];
    sector_weight_sum_in_expected_range: boolean | null;
    country_weightings: { name: string; weight_pct: number }[];
    country_weight_sum_in_expected_range: boolean | null;
    holdings_count: number | null;
  };
  diversification: {
    by_sector: { top1_name: string | null; top1_weight_pct: number | null; bucket_count: number };
    by_country: { top1_name: string | null; top1_weight_pct: number | null; bucket_count: number };
  };
  performance: { since_earliest_available_pct: number | null; days_of_history: number | null };
  data_quality: { missing_fields: string[]; provider_errors: Record<string, string>; structural_fetched_at: number; price_fetched_at: number };
};

type CompareResponse = {
  tickers: string[];
  etfs: EtfSummary[];
  unavailable: { ticker: string; reason: string }[];
  comparison_ready: boolean;
  exposure_comparison: { sectors: WeightRow[]; countries: WeightRow[] };
  comparison_summary: string | null;
  comparison_insights: ComparisonInsight[];
  performance_note: string | null;
};

const MAX_TICKERS = 3;
const MIN_TICKERS = 2;
const DEBOUNCE_MS = 350;
const TICKER_COLORS = [GOLD, "#6EA8FE", "#8FD7C4"];

const INSIGHT_ICON: Record<string, typeof PieChart> = {
  sector_exposure_difference: PieChart,
  concentration_difference: PieChart,
  cost_difference: DollarSign,
  geographic_similarity: Globe2,
  geographic_difference: Globe2,
};

function fmtPct(n: number | null | undefined, na: string, digits = 1): string {
  if (n === null || n === undefined) return na;
  return `${n.toFixed(digits)}%`;
}

function fmtUsd(n: number | null, na: string): string {
  if (n === null || n === undefined) return na;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toLocaleString()}`;
}

function colorFor(ticker: string, tickers: string[]): string {
  const idx = tickers.indexOf(ticker);
  return TICKER_COLORS[idx >= 0 ? idx % TICKER_COLORS.length : 0];
}

// Each bar reflects a real value or is explicitly marked "No disponible" —
// never drawn as an empty/zero bar when the underlying value is null.
function CompareRow({ row, tickers, na }: { row: WeightRow; tickers: string[]; na: string }) {
  const max = Math.max(0, ...tickers.map((t) => (typeof row[t] === "number" ? (row[t] as number) : 0)));
  return (
    <div className="py-2.5 border-b last:border-0" style={{ borderColor: "var(--border)" }}>
      <p className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--text)" }}>{row.name}</p>
      <div className="space-y-1.5">
        {tickers.map((t) => {
          const val = row[t];
          const known = typeof val === "number";
          const widthPct = known && max > 0 ? Math.max(2, ((val as number) / max) * 100) : 0;
          return (
            <div key={t} className="flex items-center gap-2">
              <span className="text-[11px] font-bold w-10 shrink-0" style={{ color: colorFor(t, tickers) }}>{t}</span>
              <div className="flex-1 h-[7px] rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
                {known && <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: colorFor(t, tickers) }} />}
              </div>
              <span className="text-[12px] font-semibold w-16 text-right shrink-0" style={{ color: known ? "var(--text)" : "var(--muted)" }}>
                {known ? fmtPct(val as number, na) : na}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Diego, 2026-11 Etapa-2 ajuste #3: con 3 ETFs es fácil perder de vista
// qué color corresponde a qué ticker fila por fila — una leyenda fija al
// inicio de cada sección resuelve esto sin tocar el ancho/columnas.
function TickerLegend({ tickers }: { tickers: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 pb-3" style={{ borderBottom: "1px solid var(--border)" }}>
      {tickers.map((t) => (
        <span key={t} className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: colorFor(t, tickers) }}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(t, tickers) }} />
          {t}
        </span>
      ))}
    </div>
  );
}

function CompareDistributionSection({ title, rows, tickers, emptyLabel, na }: { title: string; rows: WeightRow[]; tickers: string[]; emptyLabel: string; na: string }) {
  const [expanded, setExpanded] = useState(false);
  const visibleCount = 8;
  const shown = expanded ? rows : rows.slice(0, visibleCount);
  return (
    <GlowCard>
      <div className="flex items-center gap-2.5 mb-3">
        <IconSquare color={GOLD} size={30}><PieChart className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
        <span className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{title}</span>
      </div>
      {rows.length > 0 && tickers.length > 2 && <TickerLegend tickers={tickers} />}
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--sub)" }}>{emptyLabel}</p>
      ) : (
        <>
          {shown.map((row) => <CompareRow key={row.name} row={row} tickers={tickers} na={na} />)}
          {rows.length > visibleCount && (
            <button onClick={() => setExpanded((v) => !v)} className="flex items-center gap-1 mt-2 text-[12px] font-semibold" style={{ color: GOLD }}>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
              {expanded ? "—" : `+${rows.length - visibleCount}`}
            </button>
          )}
        </>
      )}
    </GlowCard>
  );
}

function CompareInsightCard({ insight }: { insight: ComparisonInsight }) {
  const { t } = useTranslation();
  const [showData, setShowData] = useState(false);
  const Icon = INSIGHT_ICON[insight.category] || Info;
  const title = t(`etf.compare.understand.categoryTitles.${insight.category}`, insight.category);
  return (
    <div className="rounded-2xl p-3.5" style={{ background: "var(--raised)", border: `1px solid ${GOLD}2b` }}>
      <div className="flex items-center gap-2 mb-1.5">
        <IconSquare color={GOLD} size={24}><Icon className="w-3 h-3" style={{ color: GOLD }} /></IconSquare>
        <p className="text-[12.5px] font-black uppercase tracking-wide" style={{ color: GOLD }}>{title}</p>
      </div>
      <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--text)" }}>{insight.text}</p>
      <button onClick={() => setShowData((v) => !v)} className="flex items-center gap-1 mt-2 text-[11px] font-semibold" style={{ color: "var(--sub)" }}>
        <ChevronDown className={`w-3 h-3 transition-transform ${showData ? "rotate-180" : ""}`} />
        {t("etf.detail.understand.seeData")}
      </button>
      {showData && (
        <div className="mt-1.5 text-[11.5px] font-mono rounded-lg p-2" style={{ background: "var(--card)", color: "var(--sub)" }}>
          {Object.entries(insight.supporting_data).map(([k, v]) => (
            <div key={k}>{k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function EtfSummaryCard({ etf, tickers, na, locale }: { etf: EtfSummary; tickers: string[]; na: string; locale: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const color = colorFor(etf.ticker, tickers);
  return (
    <GlowCard tint={color} className="h-full flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[15px] font-black tracking-tight truncate" style={{ color: "var(--text)" }}>{etf.identification.name || etf.ticker}</p>
          <p className="text-[12px] font-semibold" style={{ color }}>{etf.ticker}{etf.identification.etf_company ? ` · ${etf.identification.etf_company}` : ""}</p>
        </div>
        <button onClick={() => router.push(`/etf/${etf.ticker}`)} className="shrink-0 flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--sub)" }}>
          {t("etf.compare.viewFicha")} <ExternalLink className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <RaisedTile>
          <p className="text-[10.5px] font-semibold mb-0.5" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.expenseRatio")}</p>
          <p className="text-[15px] font-black" style={{ color: "var(--text)" }}>{fmtPct(etf.costs.expense_ratio_pct, na, 2)}</p>
        </RaisedTile>
        <RaisedTile>
          <p className="text-[10.5px] font-semibold mb-0.5" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.holdingsCount")}</p>
          <p className="text-[15px] font-black" style={{ color: "var(--text)" }}>{etf.exposure.holdings_count ?? na}</p>
        </RaisedTile>
        <RaisedTile>
          <p className="text-[10.5px] font-semibold mb-0.5" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.dominantSector")}</p>
          <p className="text-[13px] font-black truncate" style={{ color: "var(--text)" }}>{etf.diversification.by_sector.top1_name || na}</p>
        </RaisedTile>
        <RaisedTile>
          <p className="text-[10.5px] font-semibold mb-0.5" style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.dominantCountry")}</p>
          <p className="text-[13px] font-black truncate" style={{ color: "var(--text)" }}>{etf.diversification.by_country.top1_name || na}</p>
        </RaisedTile>
      </div>
      <p className="text-[10px] mt-auto pt-2" style={{ color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
        {t("etf.detail.footer.structuralUpdated", { date: new Date(etf.data_quality.structural_fetched_at * 1000).toLocaleString(locale) })}
      </p>
    </GlowCard>
  );
}

export default function EtfComparePage() {
  return (
    <Suspense fallback={null}>
      <EtfCompareContent />
    </Suspense>
  );
}

function EtfCompareContent() {
  const { t, i18n } = useTranslation();
  const searchParams = useSearchParams();
  const locale = i18n.language?.startsWith("en") ? "en-US" : "es-MX";
  const lang = i18n.language?.startsWith("en") ? "en" : "es";
  const na = t("etf.detail.notAvailable");

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const initialTickers = useMemo(() => {
    const raw = searchParams?.get("tickers") || "";
    const parsed = raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    return Array.from(new Set(parsed)).slice(0, MAX_TICKERS);
  }, [searchParams]);

  const [selected, setSelected] = useState<string[]>(initialTickers);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [data, setData] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [performanceOpen, setPerformanceOpen] = useState(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) { setResults(null); return; }
    debounceRef.current = setTimeout(() => {
      setSearching(true);
      etfApi.search(q, 10)
        .then((res) => setResults(res.data?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const addTicker = (ticker: string) => {
    const upper = ticker.toUpperCase();
    if (selected.includes(upper)) { setNotice(t("etf.compare.alreadyAdded", { ticker: upper })); return; }
    if (selected.length >= MAX_TICKERS) { setNotice(t("etf.compare.maxReached")); return; }
    setNotice(null);
    setSelected((prev) => [...prev, upper]);
    setQuery("");
    setResults(null);
  };

  const removeTicker = (ticker: string) => {
    setSelected((prev) => prev.filter((t2) => t2 !== ticker));
    setData(null);
  };

  const runComparison = () => {
    if (selected.length < MIN_TICKERS) { setNotice(t("etf.compare.minRequired")); return; }
    setNotice(null);
    setLoading(true);
    setError(null);
    setPerformanceOpen(false);
    etfApi.compare(selected, lang)
      .then((res) => setData(res.data))
      .catch((err) => {
        const status = err?.response?.status ?? 0;
        const message = status === 403 ? t("etf.compare.notAdmin") : t("etf.compare.error");
        setError({ status, message });
      })
      .finally(() => setLoading(false));
  };

  // Auto-run once if the page was opened with a pre-filled selection
  // (e.g. "Comparar con otro ETF" from the ficha individual) and already
  // has the minimum of 2 — same loading/error handling as a manual run,
  // so this entry point isn't silently different.
  useEffect(() => {
    if (initialTickers.length >= MIN_TICKERS) {
      setLoading(true);
      etfApi.compare(initialTickers, lang)
        .then((res) => setData(res.data))
        .catch((err) => {
          const status = err?.response?.status ?? 0;
          const message = status === 403 ? t("etf.compare.notAdmin") : t("etf.compare.error");
          setError({ status, message });
        })
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tickers = data?.etfs.map((e) => e.ticker) ?? selected;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-[1150px] mx-auto px-5 sm:px-6 py-8">

            <Eyebrow color={GOLD}>{t("etf.compare.title")}</Eyebrow>
            <h1 className="text-2xl font-black tracking-tight mb-1 flex items-center gap-2" style={{ color: "var(--text)" }}>
              <Scale className="w-5 h-5" style={{ color: GOLD }} />{t("etf.compare.title")}
            </h1>
            <p className="text-sm mb-6 max-w-xl" style={{ color: "var(--sub)" }}>{t("etf.compare.subtitle")}</p>

            {/* Selector */}
            <GlowCard className="mb-5">
              <p className="text-[12px] font-black uppercase tracking-wide mb-2" style={{ color: "var(--sub)" }}>
                {t("etf.compare.selectorLabel")} · {t("etf.compare.selectedCount", { count: selected.length })}
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                {selected.map((ticker) => (
                  <span key={ticker} className="flex items-center gap-1.5 rounded-full pl-3 pr-2 py-1.5 text-[13px] font-bold"
                        style={{ background: "var(--raised)", color: colorFor(ticker, selected), border: `1px solid ${colorFor(ticker, selected)}55` }}>
                    {ticker}
                    <button onClick={() => removeTicker(ticker)} aria-label={t("etf.compare.remove", { ticker })}>
                      <X className="w-3.5 h-3.5" style={{ color: "var(--sub)" }} />
                    </button>
                  </span>
                ))}
                {selected.length === 0 && <span className="text-sm" style={{ color: "var(--muted)" }}>{t("etf.compare.minRequired")}</span>}
              </div>

              {selected.length < MAX_TICKERS && (
                <div className="relative mb-2">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted)" }} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("etf.compare.selectorPlaceholder")}
                    className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none"
                    style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                  {query.trim() && (
                    <div className="absolute z-10 mt-1 w-full rounded-xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      {searching && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5"><Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: GOLD }} /></div>
                      )}
                      {!searching && results && results.length === 0 && (
                        <p className="px-3.5 py-2.5 text-[13px]" style={{ color: "var(--sub)" }}>{t("etf.explorer.searchEmpty", { query })}</p>
                      )}
                      {!searching && results && results.slice(0, 6).map((r) => (
                        <button key={r.symbol} onClick={() => addTicker(r.symbol)}
                                className="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--raised)]">
                          <span className="min-w-0">
                            <span className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{r.symbol}</span>
                            <span className="text-[12px] ml-2 truncate" style={{ color: "var(--sub)" }}>{r.name}</span>
                          </span>
                          <Plus className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {notice && <p className="text-[12.5px] mb-2" style={{ color: "#E0A030" }}>{notice}</p>}

              <button
                onClick={runComparison}
                disabled={loading || selected.length < MIN_TICKERS}
                className="w-full sm:w-auto rounded-xl px-5 py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ background: GOLD, color: "#1A1A1A" }}
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t("etf.compare.comparing")}</> : t("etf.compare.compareButton")}
              </button>
            </GlowCard>

            {error && (
              <GlowCard tint="#E05252" className="text-center py-8 mb-5">
                <AlertTriangle className="w-7 h-7 mx-auto mb-2" style={{ color: "#E05252" }} />
                <p className="text-sm" style={{ color: "var(--sub)" }}>{error.message}</p>
              </GlowCard>
            )}

            {data && data.unavailable.length > 0 && (
              <GlowCard tint="#E0A030" className="mb-5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#E0A030" }} />
                  <div className="space-y-1">
                    {data.unavailable.map((u) => (
                      <p key={u.ticker} className="text-[13px]" style={{ color: "var(--text)" }}>
                        {t(`etf.compare.unavailableReason.${u.reason}`, t("etf.compare.unavailableNote", { ticker: u.ticker }), { ticker: u.ticker })}
                      </p>
                    ))}
                  </div>
                </div>
              </GlowCard>
            )}

            {data && !data.comparison_ready && (
              <GlowCard tint="#E05252" className="text-center py-8 mb-5">
                <AlertTriangle className="w-7 h-7 mx-auto mb-2" style={{ color: "#E05252" }} />
                <p className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>{t("etf.compare.notReadyTitle")}</p>
                <p className="text-sm max-w-sm mx-auto" style={{ color: "var(--sub)" }}>{t("etf.compare.notReadyBody")}</p>
              </GlowCard>
            )}

            {data && data.comparison_ready && (
              <div className="space-y-5">
                {/* Identificación + métricas por ETF */}
                <div className={`grid grid-cols-1 ${data.etfs.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"} gap-3`}>
                  {data.etfs.map((etf) => <EtfSummaryCard key={etf.ticker} etf={etf} tickers={tickers} na={na} locale={locale} />)}
                </div>

                {/* Síntesis breve — nombra únicamente EN QUÉ dimensiones hay
                    diferencias relevantes (sector/país/comisión), generada
                    por reglas deterministas en el backend a partir de las
                    mismas observaciones de abajo. Nunca repite el texto
                    detallado ni emite una recomendación. */}
                {data.comparison_summary && (
                  <div className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                    <ListTree className="w-3.5 h-3.5 shrink-0" style={{ color: GOLD }} />
                    <p className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>{data.comparison_summary}</p>
                  </div>
                )}

                {/* Lo que debes entender */}
                <GlowCard tint={GOLD}>
                  <div className="flex items-center gap-2.5 mb-3.5">
                    <IconSquare color={GOLD} size={34}><ListTree className="w-4 h-4" style={{ color: GOLD }} /></IconSquare>
                    <span className="text-base font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("etf.compare.understand.title")}</span>
                  </div>
                  {data.comparison_insights.length === 0 ? (
                    <p className="text-sm" style={{ color: "var(--sub)" }}>{t("etf.compare.understand.empty")}</p>
                  ) : (
                    <div className="space-y-2.5">
                      {data.comparison_insights.map((insight, i) => <CompareInsightCard key={i} insight={insight} />)}
                    </div>
                  )}
                  <p className="text-[11px] mt-3.5 pt-3 leading-relaxed" style={{ color: "var(--sub)", borderTop: "1px solid var(--border)" }}>
                    {t("etf.compare.understand.disclaimer")}
                  </p>
                </GlowCard>

                {/* Distribución sectorial */}
                <CompareDistributionSection title={t("etf.compare.sectors.title")} rows={data.exposure_comparison.sectors} tickers={tickers} emptyLabel={t("etf.compare.sectors.empty")} na={na} />

                {/* Distribución geográfica */}
                <CompareDistributionSection title={t("etf.compare.countries.title")} rows={data.exposure_comparison.countries} tickers={tickers} emptyLabel={t("etf.compare.countries.empty")} na={na} />

                {/* Costos y posiciones */}
                <GlowCard>
                  <div className="flex items-center gap-2.5 mb-3">
                    <IconSquare color={GOLD} size={30}><DollarSign className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
                    <span className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("etf.compare.costsAndPositions.title")}</span>
                  </div>
                  <div className={`grid grid-cols-1 ${data.etfs.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"} gap-3`}>
                    {data.etfs.map((etf) => (
                      <RaisedTile key={etf.ticker}>
                        <p className="text-[11px] font-bold mb-2" style={{ color: colorFor(etf.ticker, tickers) }}>{etf.ticker}</p>
                        <div className="space-y-1.5 text-[12.5px]" style={{ color: "var(--text)" }}>
                          <div className="flex justify-between"><span style={{ color: "var(--sub)" }}>{t("etf.detail.costs.expenseRatio")}</span><b>{fmtPct(etf.costs.expense_ratio_pct, na, 2)}</b></div>
                          <div className="flex justify-between"><span style={{ color: "var(--sub)" }}>{t("etf.detail.costs.aum")}</span><b>{fmtUsd(etf.costs.aum_usd, na)}</b></div>
                          <div className="flex justify-between"><span style={{ color: "var(--sub)" }}>{t("etf.detail.metrics.holdingsCount")}</span><b>{etf.exposure.holdings_count ?? na}</b></div>
                        </div>
                      </RaisedTile>
                    ))}
                  </div>
                </GlowCard>

                {/* Rendimiento histórico — sección secundaria, colapsada por
                    defecto. Diego, 2026-11 Etapa-2 ajuste #1: al estar
                    oculta hasta que el usuario la abre explícitamente, deja
                    de leerse como "la métrica principal a comparar" — nunca
                    se compara directamente entre ETFs, cada uno muestra su
                    propio periodo disponible. */}
                <GlowCard>
                  <button
                    onClick={() => setPerformanceOpen((v) => !v)}
                    className="w-full flex items-center justify-between gap-2.5"
                    aria-expanded={performanceOpen}
                  >
                    <span className="flex items-center gap-2.5">
                      <IconSquare color={GOLD} size={30}><TrendingUp className="w-3.5 h-3.5" style={{ color: GOLD }} /></IconSquare>
                      <span className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("etf.compare.performance.title")}</span>
                    </span>
                    <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${performanceOpen ? "rotate-180" : ""}`} style={{ color: "var(--sub)" }} />
                  </button>
                  {performanceOpen && (
                    <div className="mt-3">
                      {data.performance_note && (
                        <p className="text-[12px] flex items-start gap-1.5 mb-3" style={{ color: "var(--sub)" }}>
                          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{data.performance_note}
                        </p>
                      )}
                      <div className={`grid grid-cols-1 ${data.etfs.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"} gap-3`}>
                        {data.etfs.map((etf) => (
                          <RaisedTile key={etf.ticker}>
                            <p className="text-[11px] font-bold mb-1" style={{ color: colorFor(etf.ticker, tickers) }}>{etf.ticker}</p>
                            <p className="text-[11px] font-semibold mb-0.5" style={{ color: "var(--sub)" }}>
                              {t("etf.detail.performance.priceChange", { days: etf.performance.days_of_history ?? 0 })}
                            </p>
                            <p className="text-lg font-black" style={{ color: (etf.performance.since_earliest_available_pct ?? 0) >= 0 ? "#4CAF50" : "#E05252" }}>
                              {fmtPct(etf.performance.since_earliest_available_pct, na, 2)}
                            </p>
                          </RaisedTile>
                        ))}
                      </div>
                    </div>
                  )}
                </GlowCard>

                {/* Fuentes */}
                <div className="text-center text-[11px] pt-2 space-y-0.5" style={{ color: "var(--sub)" }}>
                  {data.etfs.map((etf) => (
                    <p key={etf.ticker}>
                      {etf.ticker} — {t("etf.detail.footer.structuralUpdated", { date: new Date(etf.data_quality.structural_fetched_at * 1000).toLocaleString(locale) })}
                      {" · "}{t("etf.detail.footer.priceUpdated", { date: new Date(etf.data_quality.price_fetched_at * 1000).toLocaleString(locale) })}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
