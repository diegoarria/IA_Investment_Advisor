"use client";

import { useEffect, useState, useRef } from "react";
import {
  X, TrendingUp, TrendingDown, Globe, Users, Building2,
  Target, BarChart3, Loader2, ChevronRight,
} from "lucide-react";
import { market as marketApi } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  name: string; sector?: string; industry?: string; description?: string;
  employees?: number; website?: string; country?: string; city?: string;
  market_cap?: number; current_price?: number; currency?: string;
  pe_ratio?: number; forward_pe?: number; eps?: number; forward_eps?: number;
  dividend_yield?: number; beta?: number; week_52_high?: number; week_52_low?: number;
  avg_volume?: number; target_mean?: number; target_low?: number; target_high?: number;
  recommendation?: string; number_of_analysts?: number;
  revenue_growth?: number; earnings_growth?: number; profit_margins?: number;
  gross_margins?: number; ebitda_margins?: number; return_on_equity?: number;
  debt_to_equity?: number; price_to_book?: number;
}

interface FinancialPeriod { period: string; [key: string]: number | null | string }

interface Ratings { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number }

interface Estimate { period: string; avg?: number | null; low?: number | null; high?: number | null; growth?: number | null }

interface StockData {
  profile: Profile;
  financials: {
    income:   { annual: FinancialPeriod[]; quarterly: FinancialPeriod[] };
    balance:  { annual: FinancialPeriod[]; quarterly: FinancialPeriod[] };
    cashflow: { annual: FinancialPeriod[]; quarterly: FinancialPeriod[] };
  };
  analyst: {
    ratings: Ratings;
    price_target: { mean?: number | null; low?: number | null; high?: number | null; current?: number | null };
    eps_estimates: Estimate[];
    revenue_estimates: Estimate[];
  };
}

interface ChartData { prices: number[]; timestamps: string[]; change_pct: number }

interface Props {
  ticker: string;
  onClose: () => void;
}

type Tab = "chart" | "financials" | "analyst" | "company";
type FTab = "income" | "balance" | "cashflow";
type Period = "annual" | "quarterly";
type ChartPeriod = "1d" | "5d" | "1m" | "6m" | "1y" | "5y";

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBig(v?: number | null) {
  if (v == null) return "—";
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toLocaleString()}`;
}

function fmtPct(v?: number | null, suffix = "%") {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}${suffix}`;
}

function fmtNum(v?: number | null, decimals = 2) {
  if (v == null) return "—";
  return v.toFixed(decimals);
}

function fmtK(v?: number | null) {
  if (v == null) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function recColor(r?: string) {
  if (!r) return "var(--muted)";
  const rl = r.toLowerCase();
  if (rl.includes("strong_buy") || rl === "strongbuy") return "#22c55e";
  if (rl.includes("buy")) return "#4ade80";
  if (rl.includes("hold") || rl.includes("neutral")) return "#f59e0b";
  if (rl.includes("sell")) return "#ef4444";
  return "var(--muted)";
}

function recLabel(r?: string) {
  if (!r) return "—";
  const map: Record<string, string> = {
    strong_buy: "Compra Fuerte", strongbuy: "Compra Fuerte",
    buy: "Compra", hold: "Mantener", neutral: "Neutral",
    sell: "Vender", strong_sell: "Venta Fuerte",
  };
  return map[r.toLowerCase()] ?? r;
}

// ─── SVG Sparkline chart ──────────────────────────────────────────────────────

function SparkChart({ prices, isUp }: { prices: number[]; isUp: boolean }) {
  const W = 800, H = 200, PAD = 20;
  if (!prices.length) return null;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const pts = prices.map((p, i) => ({
    x: PAD + (i / (prices.length - 1)) * (W - PAD * 2),
    y: H - PAD - ((p - min) / range) * (H - PAD * 2),
  }));

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;

  const color = isUp ? "#22c55e" : "#ef4444";
  const gradId = `grad-${isUp ? "up" : "dn"}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* First and last dot */}
      <circle cx={pts[0].x} cy={pts[0].y} r="4" fill={color} opacity="0.6" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="5" fill={color} />
    </svg>
  );
}

// ─── Financial table ──────────────────────────────────────────────────────────

const IS_LABELS: Record<string, string> = {
  "Total Revenue": "Ingresos Totales",
  "Gross Profit": "Utilidad Bruta",
  "Operating Income": "Utilidad Operativa",
  "EBITDA": "EBITDA",
  "Net Income": "Utilidad Neta",
  "Diluted EPS": "EPS Diluido",
};
const BS_LABELS: Record<string, string> = {
  "Total Assets": "Activos Totales",
  "Current Assets": "Activos Corrientes",
  "Cash And Cash Equivalents": "Efectivo y Equiv.",
  "Total Debt": "Deuda Total",
  "Total Liabilities Net Minority Interest": "Pasivos Totales",
  "Stockholders Equity": "Patrimonio",
};
const CF_LABELS: Record<string, string> = {
  "Operating Cash Flow": "Flujo Operativo",
  "Capital Expenditure": "CapEx",
  "Free Cash Flow": "Flujo Libre",
  "Dividends Paid": "Dividendos Pagados",
};

function FinTable({ data, labels }: { data: FinancialPeriod[]; labels: Record<string, string> }) {
  if (!data.length) return (
    <p className="text-xs text-center py-6" style={{ color: "var(--muted)" }}>
      Sin datos disponibles
    </p>
  );

  const keys = Object.keys(labels);
  const periods = data.map((d) => d.period);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse min-w-[500px]">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 font-semibold sticky left-0 z-10"
                style={{ color: "var(--muted)", background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
              Métrica
            </th>
            {periods.map((p) => (
              <th key={p} className="text-right px-3 py-2 font-semibold whitespace-nowrap"
                  style={{ color: "var(--muted)", background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
                {p.slice(0, 7)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key, ki) => (
            <tr key={key} style={{ borderBottom: "1px solid var(--border)", background: ki % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}>
              <td className="px-3 py-2 font-semibold sticky left-0 z-10 whitespace-nowrap"
                  style={{ color: "var(--sub)", background: ki % 2 === 0 ? "var(--card)" : "rgba(255,255,255,0.015)" }}>
                {labels[key]}
              </td>
              {data.map((d) => {
                const v = d[key] as number | null;
                const isEps = key.includes("EPS");
                const formatted = v == null ? "—" : isEps ? `$${v.toFixed(2)}` : fmtBig(v);
                return (
                  <td key={d.period} className="px-3 py-2 text-right tabular-nums"
                      style={{ color: v == null ? "var(--dim)" : "var(--text)" }}>
                    {formatted}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Ratings bar ──────────────────────────────────────────────────────────────

function RatingsBar({ ratings }: { ratings: Ratings }) {
  const total = ratings.strong_buy + ratings.buy + ratings.hold + ratings.sell + ratings.strong_sell;
  if (!total) return <p className="text-xs" style={{ color: "var(--muted)" }}>Sin datos de analistas</p>;

  const segments = [
    { label: "Compra Fuerte", value: ratings.strong_buy,  color: "#16a34a" },
    { label: "Compra",        value: ratings.buy,          color: "#22c55e" },
    { label: "Mantener",      value: ratings.hold,         color: "#f59e0b" },
    { label: "Vender",        value: ratings.sell,         color: "#f97316" },
    { label: "Venta Fuerte",  value: ratings.strong_sell,  color: "#ef4444" },
  ];

  return (
    <div>
      {/* Bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {segments.map((s) => s.value > 0 && (
          <div key={s.label}
               style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
               title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>{s.label}</span>
            <span className="text-[10px] font-bold" style={{ color: "var(--text)" }}>{s.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] mt-2" style={{ color: "var(--dim)" }}>{total} analistas</p>
    </div>
  );
}

// ─── Price target gauge ───────────────────────────────────────────────────────

function PriceTargetGauge({ current, low, mean, high }: {
  current?: number | null; low?: number | null; mean?: number | null; high?: number | null;
}) {
  if (!low || !mean || !high || !current) return null;
  const range = high - low || 1;
  const curPct  = Math.min(Math.max((current - low) / range * 100, 0), 100);
  const meanPct = Math.min(Math.max((mean    - low) / range * 100, 0), 100);
  const upside  = ((mean - current) / current * 100).toFixed(1);
  const isUp    = mean >= current;

  return (
    <div className="p-4 rounded-2xl" style={{ background: "var(--raised)" }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold" style={{ color: "var(--muted)" }}>Precio objetivo (12 meses)</span>
        <span className="text-sm font-black" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
          {isUp ? "+" : ""}{upside}% potencial
        </span>
      </div>
      <div className="text-2xl font-black mb-3" style={{ color: "var(--text)" }}>
        ${mean?.toFixed(2)}
        <span className="text-xs font-normal ml-2" style={{ color: "var(--muted)" }}>precio medio objetivo</span>
      </div>
      {/* Track */}
      <div className="relative h-2 rounded-full mb-3" style={{ background: "var(--border)" }}>
        {/* Target range fill */}
        <div className="absolute h-full rounded-full"
             style={{
               left: `${(low - low) / range * 100}%`,
               width: `${(high - low) / range * 100}%`,
               background: "rgba(0,168,94,0.25)",
             }} />
        {/* Mean marker */}
        <div className="absolute w-0.5 h-4 -top-1 rounded"
             style={{ left: `${meanPct}%`, transform: "translateX(-50%)", background: "#22c55e" }} />
        {/* Current price marker */}
        <div className="absolute w-3 h-3 rounded-full border-2 -top-0.5"
             style={{ left: `${curPct}%`, transform: "translateX(-50%)", background: "var(--card)", borderColor: "var(--text)" }} />
      </div>
      <div className="flex justify-between text-[10px]" style={{ color: "var(--muted)" }}>
        <span>Mín ${low?.toFixed(2)}</span>
        <span>Actual ${current?.toFixed(2)}</span>
        <span>Máx ${high?.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ ticker }: { ticker: string }) {
  const clean = ticker.replace(".", "-");
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://financialmodelingprep.com/image-stock/${clean}.png`}
        alt={ticker}
        className="w-10 h-10 rounded-full object-contain p-1 shrink-0"
        style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0"
         style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)" }}>
      {ticker.slice(0, 2)}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

const CHART_PERIODS: { label: string; value: ChartPeriod }[] = [
  { label: "1D", value: "1d" }, { label: "1S", value: "5d" },
  { label: "1M", value: "1m" }, { label: "6M", value: "6m" },
  { label: "1A", value: "1y" }, { label: "5A", value: "5y" },
];

export default function StockDetailModal({ ticker, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("chart");
  const [ftab, setFtab] = useState<FTab>("income");
  const [period, setPeriod] = useState<Period>("annual");
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("1y");

  const [data, setData] = useState<StockData | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  const [chart, setChart] = useState<ChartData | null>(null);
  const [loadingChart, setLoadingChart] = useState(true);

  const panelRef = useRef<HTMLDivElement>(null);

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch stock detail
  useEffect(() => {
    setLoadingData(true);
    marketApi.getStockDetail(ticker)
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoadingData(false));
  }, [ticker]);

  // Fetch chart
  useEffect(() => {
    setLoadingChart(true);
    marketApi.getChart(ticker, chartPeriod)
      .then((res) => setChart(res.data))
      .catch(() => {})
      .finally(() => setLoadingChart(false));
  }, [ticker, chartPeriod]);

  const profile = data?.profile;
  const isUp = (chart?.change_pct ?? 0) >= 0;
  const priceColor = isUp ? "#22c55e" : "#ef4444";

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={handleBackdrop}
    >
      <div
        ref={panelRef}
        className="flex flex-col h-full overflow-hidden"
        style={{
          width: "min(680px, 100vw)",
          background: "var(--card)",
          borderLeft: "1px solid var(--border)",
          boxShadow: "-8px 0 40px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
             style={{ borderColor: "var(--border)" }}>
          <Avatar ticker={ticker} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-base font-black" style={{ color: "var(--text)" }}>{ticker}</span>
              {profile?.sector && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                  {profile.sector}
                </span>
              )}
            </div>
            <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
              {profile?.name ?? ticker}
            </p>
          </div>
          <div className="text-right shrink-0">
            {profile?.current_price != null && (
              <>
                <p className="text-lg font-black" style={{ color: "var(--text)" }}>
                  ${profile.current_price.toFixed(2)}
                </p>
                {chart?.change_pct != null && (
                  <p className="text-xs font-bold flex items-center gap-1 justify-end" style={{ color: priceColor }}>
                    {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {fmtPct(chart.change_pct, "%")}
                  </p>
                )}
              </>
            )}
          </div>
          <button onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0"
                  style={{ color: "var(--muted)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          {([
            { key: "chart",      label: "Gráfica" },
            { key: "financials", label: "Financieros" },
            { key: "analyst",    label: "Analistas" },
            { key: "company",    label: "Empresa" },
          ] as { key: Tab; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="flex-1 py-3 text-xs font-bold transition-colors"
              style={{
                color: tab === key ? "var(--accent-l)" : "var(--muted)",
                borderBottom: tab === key ? "2px solid var(--accent-l)" : "2px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">

          {/* ── GRÁFICA ── */}
          {tab === "chart" && (
            <div>
              {/* Period selector */}
              <div className="flex gap-1 mb-4">
                {CHART_PERIODS.map((cp) => (
                  <button
                    key={cp.value}
                    onClick={() => setChartPeriod(cp.value)}
                    className="flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-colors"
                    style={{
                      background: chartPeriod === cp.value ? "var(--accent)" : "var(--raised)",
                      color: chartPeriod === cp.value ? "#fff" : "var(--muted)",
                    }}
                  >
                    {cp.label}
                  </button>
                ))}
              </div>

              {loadingChart ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : chart?.prices.length ? (
                <>
                  <div className="rounded-2xl overflow-hidden mb-4" style={{ background: "var(--raised)" }}>
                    <SparkChart prices={chart.prices} isUp={isUp} />
                  </div>
                  <div className="flex gap-4 flex-wrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>Apertura período</span>
                      <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                        ${chart.prices[0]?.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>Actual</span>
                      <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                        ${chart.prices[chart.prices.length - 1]?.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px]" style={{ color: "var(--muted)" }}>Variación período</span>
                      <span className="text-sm font-bold" style={{ color: priceColor }}>
                        {fmtPct(chart.change_pct, "%")}
                      </span>
                    </div>
                    {profile?.week_52_high && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px]" style={{ color: "var(--muted)" }}>Máx 52 sem</span>
                        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                          ${profile.week_52_high.toFixed(2)}
                        </span>
                      </div>
                    )}
                    {profile?.week_52_low && (
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px]" style={{ color: "var(--muted)" }}>Mín 52 sem</span>
                        <span className="text-sm font-bold" style={{ color: "var(--text)" }}>
                          ${profile.week_52_low.toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-center py-10" style={{ color: "var(--muted)" }}>Sin datos de gráfica</p>
              )}
            </div>
          )}

          {/* ── FINANCIEROS ── */}
          {tab === "financials" && (
            <div>
              {loadingData ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : (
                <>
                  {/* Sub-tabs */}
                  <div className="flex gap-1 mb-3">
                    {([
                      { key: "income", label: "Resultados" },
                      { key: "balance", label: "Balance" },
                      { key: "cashflow", label: "Flujo Caja" },
                    ] as { key: FTab; label: string }[]).map(({ key, label }) => (
                      <button key={key} onClick={() => setFtab(key)}
                              className="flex-1 py-1.5 text-[11px] font-bold rounded-lg transition-colors"
                              style={{ background: ftab === key ? "var(--accent)" : "var(--raised)", color: ftab === key ? "#fff" : "var(--muted)" }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Period toggle */}
                  <div className="flex gap-1 mb-4">
                    {(["annual", "quarterly"] as Period[]).map((p) => (
                      <button key={p} onClick={() => setPeriod(p)}
                              className="px-3 py-1 text-[10px] font-bold rounded-lg transition-colors"
                              style={{ background: period === p ? "rgba(0,168,94,0.15)" : "var(--raised)", color: period === p ? "var(--accent-l)" : "var(--muted)" }}>
                        {p === "annual" ? "Anual" : "Trimestral"}
                      </button>
                    ))}
                  </div>

                  {ftab === "income" && (
                    <FinTable
                      data={data?.financials.income[period] ?? []}
                      labels={IS_LABELS}
                    />
                  )}
                  {ftab === "balance" && (
                    <FinTable
                      data={data?.financials.balance[period] ?? []}
                      labels={BS_LABELS}
                    />
                  )}
                  {ftab === "cashflow" && (
                    <FinTable
                      data={data?.financials.cashflow[period] ?? []}
                      labels={CF_LABELS}
                    />
                  )}

                  <p className="text-[9px] mt-4 text-center" style={{ color: "var(--dim)" }}>
                    Fuente: Yahoo Finance · Reportes SEC
                  </p>
                </>
              )}
            </div>
          )}

          {/* ── ANALISTAS ── */}
          {tab === "analyst" && (
            <div className="space-y-5">
              {loadingData ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : (
                <>
                  {/* Consensus */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>Consenso de Analistas</h3>
                      {profile?.recommendation && (
                        <span className="text-xs font-black px-2.5 py-1 rounded-full"
                              style={{ background: `${recColor(profile.recommendation)}20`, color: recColor(profile.recommendation) }}>
                          {recLabel(profile.recommendation)}
                        </span>
                      )}
                    </div>
                    <RatingsBar ratings={data?.analyst.ratings ?? { strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0 }} />
                  </div>

                  {/* Price target */}
                  {data?.analyst.price_target && (
                    <div>
                      <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
                        <Target className="w-4 h-4 inline mr-1" />
                        Precio Objetivo
                      </h3>
                      <PriceTargetGauge
                        current={data.analyst.price_target.current}
                        low={data.analyst.price_target.low}
                        mean={data.analyst.price_target.mean}
                        high={data.analyst.price_target.high}
                      />
                    </div>
                  )}

                  {/* EPS estimates */}
                  {(data?.analyst.eps_estimates.length ?? 0) > 0 && (
                    <div>
                      <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>
                        <BarChart3 className="w-4 h-4 inline mr-1" />
                        Estimaciones EPS
                      </h3>
                      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr style={{ background: "var(--raised)" }}>
                              {["Período", "EPS Promedio", "EPS Mín", "EPS Máx", "Crecimiento"].map((h) => (
                                <th key={h} className="px-3 py-2 text-right first:text-left font-semibold"
                                    style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data!.analyst.eps_estimates.map((e, i) => (
                              <tr key={e.period} style={{ borderBottom: i < data!.analyst.eps_estimates.length - 1 ? "1px solid var(--border)" : "none" }}>
                                <td className="px-3 py-2 font-semibold" style={{ color: "var(--sub)" }}>{e.period}</td>
                                <td className="px-3 py-2 text-right font-bold" style={{ color: "var(--text)" }}>${fmtNum(e.avg)}</td>
                                <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>${fmtNum(e.low)}</td>
                                <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>${fmtNum(e.high)}</td>
                                <td className="px-3 py-2 text-right font-semibold"
                                    style={{ color: (e.growth ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {fmtPct(e.growth)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Revenue estimates */}
                  {(data?.analyst.revenue_estimates.length ?? 0) > 0 && (
                    <div>
                      <h3 className="text-sm font-bold mb-3" style={{ color: "var(--text)" }}>Estimaciones Revenue</h3>
                      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr style={{ background: "var(--raised)" }}>
                              {["Período", "Promedio", "Mínimo", "Máximo", "Crecimiento"].map((h) => (
                                <th key={h} className="px-3 py-2 text-right first:text-left font-semibold"
                                    style={{ color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data!.analyst.revenue_estimates.map((e, i) => (
                              <tr key={e.period} style={{ borderBottom: i < data!.analyst.revenue_estimates.length - 1 ? "1px solid var(--border)" : "none" }}>
                                <td className="px-3 py-2 font-semibold" style={{ color: "var(--sub)" }}>{e.period}</td>
                                <td className="px-3 py-2 text-right font-bold" style={{ color: "var(--text)" }}>{fmtBig(e.avg)}</td>
                                <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>{fmtBig(e.low)}</td>
                                <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>{fmtBig(e.high)}</td>
                                <td className="px-3 py-2 text-right font-semibold"
                                    style={{ color: (e.growth ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {fmtPct(e.growth)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── EMPRESA ── */}
          {tab === "company" && (
            <div className="space-y-5">
              {loadingData ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : profile ? (
                <>
                  {/* Key stats grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { label: "Cap. Mercado",    value: fmtBig(profile.market_cap) },
                      { label: "P/E (TTM)",        value: fmtNum(profile.pe_ratio) },
                      { label: "P/E Forward",      value: fmtNum(profile.forward_pe) },
                      { label: "EPS (TTM)",        value: profile.eps != null ? `$${profile.eps.toFixed(2)}` : "—" },
                      { label: "EPS Forward",      value: profile.forward_eps != null ? `$${profile.forward_eps.toFixed(2)}` : "—" },
                      { label: "Beta",             value: fmtNum(profile.beta) },
                      { label: "Rendimiento div.", value: profile.dividend_yield != null && profile.dividend_yield > 0 ? `${profile.dividend_yield.toFixed(2)}%` : "—" },
                      { label: "P/Book",           value: fmtNum(profile.price_to_book) },
                      { label: "Deuda/Capital",    value: fmtNum(profile.debt_to_equity) },
                      { label: "Margen bruto",     value: profile.gross_margins != null ? `${profile.gross_margins.toFixed(1)}%` : "—" },
                      { label: "Margen neto",      value: profile.profit_margins != null ? `${profile.profit_margins.toFixed(1)}%` : "—" },
                      { label: "ROE",              value: profile.return_on_equity != null ? `${profile.return_on_equity.toFixed(1)}%` : "—" },
                      { label: "Crec. ingresos",   value: fmtPct(profile.revenue_growth) },
                      { label: "Crec. ganancias",  value: fmtPct(profile.earnings_growth) },
                      { label: "Volumen prom.",    value: fmtK(profile.avg_volume) },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl p-3" style={{ background: "var(--raised)" }}>
                        <p className="text-[9px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--dim)" }}>{label}</p>
                        <p className="text-sm font-black" style={{ color: "var(--text)" }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Info pills */}
                  <div className="flex flex-wrap gap-2">
                    {profile.sector && (
                      <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                            style={{ background: "rgba(0,168,94,0.1)", color: "var(--accent-l)" }}>
                        <Building2 className="w-3 h-3" /> {profile.sector}
                      </span>
                    )}
                    {profile.industry && (
                      <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                            style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        {profile.industry}
                      </span>
                    )}
                    {profile.country && (
                      <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                            style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        <Globe className="w-3 h-3" /> {profile.city ? `${profile.city}, ` : ""}{profile.country}
                      </span>
                    )}
                    {profile.employees && (
                      <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                            style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        <Users className="w-3 h-3" /> {fmtK(profile.employees)} empleados
                      </span>
                    )}
                  </div>

                  {/* Description */}
                  {profile.description && (
                    <div>
                      <h3 className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>Descripción</h3>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                        {profile.description}
                      </p>
                    </div>
                  )}

                  {/* Website */}
                  {profile.website && (
                    <a href={profile.website} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-2 text-xs font-semibold hover:opacity-80 transition-opacity"
                       style={{ color: "var(--accent-l)" }}>
                      <Globe className="w-3.5 h-3.5" />
                      {profile.website.replace(/^https?:\/\//, "")}
                      <ChevronRight className="w-3.5 h-3.5 ml-auto" />
                    </a>
                  )}
                </>
              ) : (
                <p className="text-xs text-center py-10" style={{ color: "var(--muted)" }}>Sin datos de empresa</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
