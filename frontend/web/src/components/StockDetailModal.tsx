"use client";

import { useEffect, useState, useRef } from "react";
import {
  X, TrendingUp, TrendingDown, Globe, Users, Building2,
  BarChart3, Loader2, ChevronRight, Activity,
  ArrowUpRight, ArrowDownRight, DollarSign,
} from "lucide-react";
import { market as marketApi } from "@/lib/api";
import IncomeStatementTab from "@/components/IncomeStatementTab";
import BalanceSheetTab from "@/components/BalanceSheetTab";
import CashFlowTab from "@/components/CashFlowTab";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  name: string; sector?: string; industry?: string; description?: string;
  employees?: number; website?: string; country?: string; city?: string; exchange?: string;
  market_cap?: number; current_price?: number; currency?: string;
  open?: number; day_high?: number; day_low?: number; prev_close?: number; volume?: number;
  pe_ratio?: number; forward_pe?: number; peg_ratio?: number; ps_ratio?: number; pb_ratio?: number;
  ev_to_ebitda?: number; ev_to_revenue?: number;
  eps?: number; forward_eps?: number; book_value?: number;
  dividend_yield?: number; dividend_rate?: number; ex_dividend_date?: string; payout_ratio?: number;
  beta?: number; week_52_high?: number; week_52_low?: number;
  sma_50?: number; sma_200?: number;
  avg_volume?: number; avg_volume_10d?: number; float_shares?: number; shares_outstanding?: number;
  short_ratio?: number; short_pct_float?: number;
  target_mean?: number; target_low?: number; target_high?: number;
  recommendation?: string; number_of_analysts?: number;
  revenue_growth?: number; earnings_growth?: number; revenue_quarterly_growth?: number;
  profit_margins?: number; gross_margins?: number; operating_margins?: number;
  ebitda_margins?: number; return_on_assets?: number; return_on_equity?: number;
  debt_to_equity?: number; current_ratio?: number; quick_ratio?: number;
  total_cash?: number; total_debt?: number; free_cashflow?: number; operating_cashflow?: number;
  revenue_ttm?: number; ebitda_ttm?: number; enterprise_value?: number;
}

interface Ratings { strong_buy: number; buy: number; hold: number; sell: number; strong_sell: number }
interface Estimate { period: string; avg?: number | null; low?: number | null; high?: number | null; growth?: number | null }
interface EpsSurprise { period: string; actual?: number | null; estimate?: number | null; surprise?: number | null; surprise_pct?: number | null }

interface StockData {
  profile: Profile;
  financials: {
    income:   { annual: Record<string, unknown>[]; quarterly: Record<string, unknown>[] };
    balance:  { annual: Record<string, unknown>[]; quarterly: Record<string, unknown>[] };
    cashflow: { annual: Record<string, unknown>[]; quarterly: Record<string, unknown>[] };
    source?: string;
  };
  analyst: {
    ratings: Ratings;
    price_target: { mean?: number | null; low?: number | null; high?: number | null; current?: number | null };
    n_analysts?: number;
    eps_estimates: Estimate[];
    revenue_estimates: Estimate[];
    eps_surprises: EpsSurprise[];
  };
  holders?: {
    institutional: Array<{ holder: string; shares: number; value?: number | null; pct_held?: number | null }>;
    major: Record<string, number>;
  };
  insiders?: Array<{
    name: string; title?: string; transaction: string; shares: number;
    value?: number | null; price?: number | null; date?: string;
  }>;
  dividends?: Array<{ date: string; amount?: number | null }>;
  sources?: Record<string, string>;
}

interface ScoreTrendPoint { year: string; value?: number; debt?: number; equity?: number }
interface ScoreMetric {
  name: string; value: string; score: number | null;
  label: string; trend: ScoreTrendPoint[]; chart_type: string; lower_is_better: boolean;
}
interface ScoreCategory { key: string; name: string; score: number; metrics: ScoreMetric[] }
interface EntryRange {
  label: string; signal: string; color: string;
  min: number | null; max: number | null; is_current: boolean;
}
interface EntryRangesMeta { fair_value: number; fair_value_src: string; current_price: number; }
interface ScoreData {
  overall_score: number; grade: string; signal: string;
  verdict_short: string; verdict_long: string;
  entry_ranges?: EntryRange[];
  entry_ranges_meta?: EntryRangesMeta | null;
  categories: ScoreCategory[];
}

interface Peer { ticker: string; name: string; price: number | null; change_pct: number | null }

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtBig(v?: number | null) {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPct(v?: number | null) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtNum(v?: number | null, dec = 2) {
  if (v == null) return "—";
  return v.toFixed(dec);
}

function fmtK(v?: number | null) {
  if (v == null) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

function recColor(r?: string) {
  if (!r) return "var(--muted)";
  const rl = r.toLowerCase();
  if (rl.includes("strong_buy") || rl === "strongbuy") return "#16a34a";
  if (rl.includes("buy")) return "#22c55e";
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function Avatar({ ticker, glowColor }: { ticker: string; glowColor?: string }) {
  const clean = ticker.replace(".", "-");
  const [failed, setFailed] = useState(false);
  const ring = glowColor ?? "var(--accent-l)";
  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`https://financialmodelingprep.com/image-stock/${clean}.png`}
        alt={ticker}
        className="w-14 h-14 rounded-full object-contain p-1 shrink-0"
        style={{
          background: "var(--raised)",
          border: `2px solid ${ring}`,
          boxShadow: `0 0 12px ${ring}44`,
        }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="w-14 h-14 rounded-full flex items-center justify-center text-base font-black shrink-0"
         style={{
           background: "rgba(0,168,94,0.14)",
           color: "var(--accent-l)",
           border: `2px solid ${ring}`,
           boxShadow: `0 0 12px ${ring}44`,
         }}>
      {ticker.slice(0, 2)}
    </div>
  );
}

function MiniAvatar({ ticker }: { ticker: string }) {
  const clean = ticker.replace(".", "-");
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`https://financialmodelingprep.com/image-stock/${clean}.png`} alt={ticker}
           className="w-8 h-8 rounded-full object-contain p-0.5 shrink-0"
           style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
           onError={() => setFailed(true)} />
    );
  }
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
         style={{ background: "rgba(0,168,94,0.14)", color: "var(--accent-l)", border: "1px solid var(--border)" }}>
      {ticker.slice(0, 2)}
    </div>
  );
}

function StatCard({ label, value, color }: {
  label: string; value: string; color?: string;
}) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--dim)" }}>
        {label}
      </span>
      <span className="text-2xl font-black leading-tight" style={{ color: color ?? "var(--text)" }}>
        {value}
      </span>
    </div>
  );
}

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
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {segments.map((s) => s.value > 0 && (
          <div key={s.label}
               style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
               title={`${s.label}: ${s.value}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-[10px]" style={{ color: "var(--muted)" }}>{s.label}</span>
            <span className="text-[10px] font-bold" style={{ color: "var(--text)" }}>{s.value}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] mt-1.5" style={{ color: "var(--dim)" }}>{total} analistas en total</p>
    </div>
  );
}

function EpsSurpriseRow({ item }: { item: EpsSurprise }) {
  const beat = (item.surprise ?? 0) >= 0;
  return (
    <div className="flex items-center gap-3 py-2 border-b" style={{ borderColor: "var(--border)" }}>
      <span className="text-[10px] font-semibold w-20 shrink-0" style={{ color: "var(--muted)" }}>
        {item.period?.slice(0, 7)}
      </span>
      <span className="text-xs font-bold w-14 text-right tabular-nums" style={{ color: "var(--text)" }}>
        {item.actual != null ? `$${item.actual.toFixed(2)}` : "—"}
      </span>
      <span className="text-xs w-14 text-right tabular-nums" style={{ color: "var(--muted)" }}>
        {item.estimate != null ? `$${item.estimate.toFixed(2)}` : "—"}
      </span>
      <div className="flex items-center gap-1 ml-auto">
        {beat
          ? <ArrowUpRight className="w-3 h-3" style={{ color: "#22c55e" }} />
          : <ArrowDownRight className="w-3 h-3" style={{ color: "#ef4444" }} />
        }
        <span className="text-[10px] font-bold" style={{ color: beat ? "#22c55e" : "#ef4444" }}>
          {item.surprise_pct != null ? `${beat ? "+" : ""}${item.surprise_pct.toFixed(1)}%` : "—"}
        </span>
      </div>
    </div>
  );
}

// ─── MetricCard (score card with mini SVG chart) ─────────────────────────────

function MiniLineChart({ data, color }: { data: { year: string; value: number }[]; color: string }) {
  if (data.length < 2) return null;
  const W = 120, H = 36;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((d.value - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  const last = data[data.length - 1];
  const lastX = W;
  const lastY = H - ((last.value - min) / range) * (H - 4) - 2;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  );
}

function MiniBarChart({ data, color }: { data: { year: string; value: number }[]; color: string }) {
  if (!data.length) return null;
  const W = 120, H = 36;
  const vals = data.map((d) => d.value);
  const max = Math.max(...vals.map(Math.abs), 0.01);
  const bw = W / data.length - 3;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {data.map((d, i) => {
        const barH = Math.max((Math.abs(d.value) / max) * (H - 4), 2);
        const x = i * (W / data.length) + 1;
        const y = H - barH;
        return (
          <rect key={i} x={x} y={y} width={bw} height={barH}
                rx="2" fill={d.value >= 0 ? color : "#ef4444"} opacity="0.85" />
        );
      })}
    </svg>
  );
}

function MiniStackedBar({ data }: { data: { year: string; debt: number; equity: number }[] }) {
  if (!data.length) return null;
  const W = 120, H = 36;
  const maxTotal = Math.max(...data.map((d) => Math.abs(d.debt) + Math.abs(d.equity)), 0.01);
  const bw = W / data.length - 3;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {data.map((d, i) => {
        const total = Math.abs(d.debt) + Math.abs(d.equity);
        const totalH = Math.max((total / maxTotal) * (H - 4), 2);
        const debtH = (Math.abs(d.debt) / total) * totalH;
        const eqH   = totalH - debtH;
        const x = i * (W / data.length) + 1;
        return (
          <g key={i}>
            <rect x={x} y={H - totalH} width={bw} height={eqH}  rx="0" fill="#22c55e" opacity="0.8" />
            <rect x={x} y={H - debtH}  width={bw} height={debtH} rx="0" fill="#ef4444" opacity="0.8" />
          </g>
        );
      })}
    </svg>
  );
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return null;
  const color = score >= 75 ? "#22c55e" : score >= 55 ? "#f59e0b" : "#ef4444";
  return (
    <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md tabular-nums"
          style={{ background: `${color}22`, color }}>
      {score}/100
    </span>
  );
}

function MetricCard({ metric }: { metric: ScoreMetric }) {
  const color = (metric.score ?? 50) >= 75 ? "#22c55e" : (metric.score ?? 50) >= 55 ? "#f59e0b" : "#ef4444";
  const hasTrend = metric.trend.length >= 2;

  const lineData  = metric.chart_type !== "stacked_bar"
    ? (metric.trend as { year: string; value: number }[]).filter((d) => d.value != null)
    : [];
  const stackData = metric.chart_type === "stacked_bar"
    ? (metric.trend as { year: string; debt: number; equity: number }[])
    : [];

  return (
    <div className="rounded-xl p-3 flex flex-col gap-1.5"
         style={{ background: "var(--raised)", border: "1px solid var(--border)", borderLeft: `2px solid ${color}` }}>
      <div className="flex items-start justify-between gap-1">
        <span className="text-[10px] font-semibold leading-tight" style={{ color: "var(--sub)" }}>
          {metric.name}
        </span>
        <ScoreBadge score={metric.score} />
      </div>
      <div className="text-xl font-black leading-tight" style={{ color: "var(--text)" }}>
        {metric.value}
      </div>
      {hasTrend && (
        <div className="mt-1">
          {metric.chart_type === "stacked_bar" && stackData.length >= 2 ? (
            <MiniStackedBar data={stackData} />
          ) : metric.chart_type === "bar" ? (
            <MiniBarChart data={lineData} color={color} />
          ) : (
            <MiniLineChart data={lineData} color={color} />
          )}
          <div className="flex justify-between mt-0.5">
            <span className="text-[8px]" style={{ color: "var(--dim)" }}>{lineData[0]?.year ?? stackData[0]?.year}</span>
            <span className="text-[8px]" style={{ color: "var(--dim)" }}>{lineData[lineData.length-1]?.year ?? stackData[stackData.length-1]?.year}</span>
          </div>
        </div>
      )}
      <p className="text-[9px] leading-snug" style={{ color: "var(--dim)" }}>{metric.label}</p>
    </div>
  );
}

// ─── Google Finance-style chart ──────────────────────────────────────────────

const PERIODS = [
  { label: "1D", key: "1d" }, { label: "5D", key: "5d" }, { label: "1M", key: "1m" },
  { label: "3M", key: "3m" }, { label: "6M", key: "6m" }, { label: "1A", key: "1y" },
  { label: "5A", key: "5y" }, { label: "Máx", key: "max" },
];

function fmtChartDate(ts: string | undefined, intraday: boolean) {
  if (!ts) return "";
  try {
    if (intraday) return new Date(ts).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
    return new Date(ts + "T12:00:00").toLocaleDateString("es", { month: "short", year: "2-digit" });
  } catch { return ts.slice(0, 7); }
}

function PeriodBar({ period, onChange }: { period: string; onChange: (p: string) => void }) {
  return (
    <div className="flex gap-0.5 px-4 pt-3 pb-1 flex-wrap">
      {PERIODS.map(({ label, key }) => (
        <button key={key} onClick={() => onChange(key)}
                className="px-2.5 py-1 text-xs font-bold rounded-lg transition-colors"
                style={{
                  color: period === key ? "var(--accent-l)" : "var(--muted)",
                  background: period === key ? "rgba(0,168,94,0.12)" : "transparent",
                  borderBottom: period === key ? "2px solid var(--accent-l)" : "2px solid transparent",
                }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function GoogleFinanceChart({ prices, timestamps, changePct, loading, period, onPeriodChange }: {
  prices: number[]; timestamps: string[]; changePct: number;
  loading: boolean; period: string; onPeriodChange: (p: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const intraday = period === "1d" || period === "5d";
  const isUp = changePct >= 0;
  const lineColor = isUp ? "#1a9641" : "#d7191c";

  const W = 640, H = 320, PL = 8, PR = 56, PT = 10, PB = 26;
  const cW = W - PL - PR, cH = H - PT - PB;

  const handleMM = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !prices.length) return;
    const rx = (e.clientX - rect.left) * (W / rect.width) - PL;
    const idx = Math.max(0, Math.min(prices.length - 1, Math.round(rx / cW * (prices.length - 1))));
    setHovered(idx);
  };

  return (
    <div>
      <PeriodBar period={period} onChange={onPeriodChange} />
      <div className="px-5 h-7 flex items-center gap-3 mb-1">
        {hovered !== null && prices[hovered] != null ? (
          <>
            <span className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>
              ${prices[hovered].toFixed(2)}
            </span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {fmtChartDate(timestamps[hovered], intraday)}
            </span>
          </>
        ) : (
          <span className="text-xs" style={{ color: isUp ? "#22c55e" : "#ef4444" }}>
            {isUp ? "+" : ""}{changePct.toFixed(2)}%
            <span className="ml-2" style={{ color: "var(--dim)" }}>
              {period === "1d" ? "hoy" : "período seleccionado"}
            </span>
          </span>
        )}
      </div>
      <div className="px-1">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: H }}>
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
          </div>
        ) : !prices.length ? (
          <div className="flex items-center justify-center" style={{ height: H }}>
            <p className="text-xs" style={{ color: "var(--muted)" }}>Sin datos</p>
          </div>
        ) : (() => {
          const min = Math.min(...prices), max = Math.max(...prices);
          const pad = (max - min) * 0.06 || max * 0.01;
          const minP = min - pad, maxP = max + pad, rng = maxP - minP;
          const sx = (i: number) => PL + (i / (prices.length - 1)) * cW;
          const sy = (p: number) => PT + cH - ((p - minP) / rng) * cH;
          const line = prices.map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p).toFixed(1)}`).join(" ");
          const area = `${line} L${sx(prices.length - 1).toFixed(1)},${(PT + cH).toFixed(1)} L${PL},${(PT + cH).toFixed(1)} Z`;
          const hi = hovered ?? prices.length - 1;
          const hx = sx(hi), hy = sy(prices[hi]);
          const yLvls = Array.from({ length: 5 }, (_, i) => minP + (rng * i / 4));
          const xIdxs = [0, Math.floor(prices.length * 0.25), Math.floor(prices.length * 0.5), Math.floor(prices.length * 0.75), prices.length - 1];
          return (
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
                 style={{ width: "100%", height: "auto", cursor: "crosshair", display: "block" }}
                 onMouseMove={handleMM} onMouseLeave={() => setHovered(null)}>
              <defs>
                <linearGradient id="gf-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
                  <stop offset="90%" stopColor={lineColor} stopOpacity="0.02" />
                </linearGradient>
                <clipPath id="gf-clip">
                  <rect x={PL} y={PT} width={cW} height={cH} />
                </clipPath>
              </defs>
              {yLvls.map((v, i) => (
                <line key={i} x1={PL} y1={sy(v)} x2={W - PR} y2={sy(v)} stroke="var(--border)" strokeWidth="0.5" />
              ))}
              <path d={area} fill="url(#gf-fill)" clipPath="url(#gf-clip)" />
              <path d={line} fill="none" stroke={lineColor} strokeWidth="1.8" strokeLinejoin="round" clipPath="url(#gf-clip)" />
              {hovered !== null && (
                <line x1={hx} y1={PT} x2={hx} y2={PT + cH} stroke="var(--muted)" strokeWidth="0.8" strokeDasharray="3,2" />
              )}
              <circle cx={hx} cy={hy} r="3.5" fill={lineColor} stroke="var(--card)" strokeWidth="2" />
              {yLvls.map((v, i) => (
                <text key={i} x={W - PR + 6} y={sy(v) + 3.5} fontSize="9.5" fill="var(--muted)" textAnchor="start" fontFamily="monospace">
                  {v >= 10000 ? `${(v / 1000).toFixed(0)}K` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(v < 10 ? 2 : 0)}
                </text>
              ))}
              {xIdxs.map((idx) => (
                <text key={idx} x={sx(idx)} y={H - 4} fontSize="9" fill="var(--muted)" textAnchor="middle">
                  {fmtChartDate(timestamps[idx], intraday)}
                </text>
              ))}
            </svg>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Speedometer gauge ────────────────────────────────────────────────────────

function signalToAngle(signal?: string): number {
  if (!signal) return 90;
  const s = signal.toLowerCase();
  if (s.includes("fuerte") && s.includes("compra")) return 162;
  if (s.includes("compra")) return 126;
  if (s.includes("mantener") || s.includes("neutral")) return 90;
  if (s.includes("fuerte") && (s.includes("vent") || s.includes("sell"))) return 18;
  if (s.includes("vend") || s.includes("sell")) return 54;
  return 90;
}

function gaugeArcPath(cx: number, cy: number, R: number, r: number, t1: number, t2: number): string {
  const p = (θ: number, rad: number) => ({
    x: +(cx - rad * Math.cos(θ * Math.PI / 180)).toFixed(2),
    y: +(cy - rad * Math.sin(θ * Math.PI / 180)).toFixed(2),
  });
  const o1 = p(t1, R), o2 = p(t2, R), i2 = p(t2, r), i1 = p(t1, r);
  const lg = (t2 - t1) > 180 ? 1 : 0;
  return `M${o1.x} ${o1.y} A${R} ${R} 0 ${lg} 0 ${o2.x} ${o2.y} L${i2.x} ${i2.y} A${r} ${r} 0 ${lg} 1 ${i1.x} ${i1.y}Z`;
}

function SpeedometerGauge({ signal }: { signal?: string }) {
  const CX = 100, CY = 92, R = 72, r = 50;
  const SEGS = [
    { t1: 0,   t2: 36,  color: "#dc2626" },
    { t1: 37,  t2: 72,  color: "#f97316" },
    { t1: 73,  t2: 107, color: "#eab308" },
    { t1: 108, t2: 143, color: "#84cc16" },
    { t1: 144, t2: 180, color: "#16a34a" },
  ];
  const θ = signalToAngle(signal);
  const θr = θ * Math.PI / 180;
  const nx = +(CX - R * 0.7 * Math.cos(θr)).toFixed(2);
  const ny = +(CY - R * 0.7 * Math.sin(θr)).toFixed(2);
  return (
    <svg viewBox="0 0 200 100" style={{ width: "100%", maxWidth: 200, height: "auto" }}>
      {SEGS.map((s) => <path key={s.t1} d={gaugeArcPath(CX, CY, R, r, s.t1, s.t2)} fill={s.color} />)}
      <line x1={CX} y1={CY} x2={nx} y2={ny} stroke="var(--text)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={CX} cy={CY} r="5" fill="var(--text)" />
      <circle cx={CX} cy={CY} r="2.5" fill="var(--card)" />
    </svg>
  );
}

// ─── Forecast fan chart ───────────────────────────────────────────────────────

function ForecastChart({ prices, current, targetLow, targetMean, targetHigh }: {
  prices: number[]; current: number;
  targetLow?: number | null; targetMean?: number | null; targetHigh?: number | null;
}) {
  const W = 500, H = 180, PL = 8, PR = 76, PT = 24, PB = 22;
  const cW = W - PL - PR, cH = H - PT - PB;
  const hist = prices.slice(-60);
  const HFRAC = 0.62;
  const histW = cW * HFRAC, foreW = cW - histW;

  const targets = [targetLow, targetMean, targetHigh].filter((v): v is number => v != null);
  const allVals = [...hist, ...targets, current];
  const minP = Math.min(...allVals) * 0.97, maxP = Math.max(...allVals) * 1.03;
  const rng = maxP - minP || 1;

  const sy  = (p: number) => PT + cH - ((p - minP) / rng) * cH;
  const shx = (i: number) => PL + (i / (hist.length - 1)) * histW;
  const fX  = PL + histW, fEndX = PL + cW;
  const lastY = sy(current);

  const linePts = hist.map((p, i) => `${i === 0 ? "M" : "L"}${shx(i).toFixed(1)},${sy(p).toFixed(1)}`).join(" ");
  const area = `${linePts} L${shx(hist.length - 1).toFixed(1)},${(PT + cH).toFixed(1)} L${PL},${(PT + cH).toFixed(1)} Z`;

  const foreLines = [
    { target: targetHigh, color: "#16a34a", label: "Alto" },
    { target: targetMean, color: "#6b7280", label: "Prom." },
    { target: targetLow,  color: "#dc2626", label: "Bajo" },
  ].filter((f): f is typeof f & { target: number } => f.target != null);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
      <defs>
        <linearGradient id="fc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#ef4444" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {/* Labels */}
      <text x={PL + histW / 2} y={PT - 6} fontSize="8.5" fill="var(--muted)" textAnchor="middle">Últimos 12 meses</text>
      <text x={PL + histW + foreW / 2} y={PT - 6} fontSize="8.5" fill="var(--muted)" textAnchor="middle">Pronóstico 12m</text>
      {/* Separator */}
      <line x1={fX} y1={PT - 10} x2={fX} y2={PT + cH} stroke="var(--border)" strokeWidth="1" strokeDasharray="3,3" />
      {/* Area + line */}
      <path d={area} fill="url(#fc-area)" />
      <path d={linePts} fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinejoin="round" />
      {/* Forecast fan */}
      {foreLines.map((f) => {
        const fy = sy(f.target);
        const upside = current > 0 ? ((f.target - current) / current * 100) : 0;
        return (
          <g key={f.label}>
            <line x1={fX} y1={lastY} x2={fEndX} y2={fy} stroke={f.color} strokeWidth="1.5" strokeDasharray="6,3" />
            <text x={fEndX + 4} y={fy - 2} fontSize="8.5" fill={f.color} textAnchor="start" fontWeight="bold">{f.label}</text>
            <text x={fEndX + 4} y={fy + 9} fontSize="8.5" fill={f.color} textAnchor="start">${f.target.toFixed(0)}</text>
            <text x={fEndX + 4} y={fy + 19} fontSize="7.5" fill={f.color} textAnchor="start" opacity="0.8">
              {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
            </text>
          </g>
        );
      })}
      {/* Dot at current */}
      <circle cx={fX} cy={lastY} r="3" fill="#ef4444" stroke="var(--card)" strokeWidth="1.5" />
      {/* X labels */}
      <text x={PL} y={H - 4} fontSize="8.5" fill="var(--muted)" textAnchor="start">hace 1 año</text>
      <text x={fX} y={H - 4} fontSize="8.5" fill="var(--muted)" textAnchor="middle">hoy</text>
      <text x={fEndX} y={H - 4} fontSize="8.5" fill="var(--muted)" textAnchor="end">+12 meses</text>
    </svg>
  );
}



// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = "verdict" | "chart" | "financials" | "analyst" | "company";

const TABS: { key: Tab; label: string }[] = [
  { key: "verdict",    label: "Veredicto" },
  { key: "chart",      label: "Gráfica" },
  { key: "financials", label: "Financieros" },
  { key: "analyst",    label: "Analistas" },
  { key: "company",    label: "Empresa" },
];

// ─── Main Modal ───────────────────────────────────────────────────────────────

interface Props { ticker: string; onClose: () => void }

export default function StockDetailModal({ ticker, onClose }: Props) {
  useEffect(() => {
    document.documentElement.setAttribute("data-stock-modal", "1");
    return () => document.documentElement.removeAttribute("data-stock-modal");
  }, []);

  const [tab, setTab] = useState<Tab>("chart");
  const [finPeriod, setFinPeriod] = useState<"annual" | "quarterly">("annual");
  const [finSection, setFinSection] = useState<"income" | "balance" | "cashflow">("income");
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState(false);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [loadingScore, setLoadingScore] = useState(true);
  const [period, setPeriod] = useState("1y");
  const [chartData, setChartData] = useState<{ prices: number[]; timestamps: string[]; change_pct: number } | null>(null);
  const [loadingChart, setLoadingChart] = useState(true);
  const [chartError, setChartError] = useState(false);
  const [incomeAnalysis, setIncomeAnalysis] = useState<string>("");
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // Rich financials from /api/stocks/{ticker}/financials (uses income_stmt, not quoteSummary)
  type RichFinancials = {
    incomeStatement: { annual: Record<string, unknown>[]; quarterly: Record<string, unknown>[] };
    balanceSheet:    { annual: Record<string, unknown>[]; quarterly: Record<string, unknown>[] };
    cashFlow:        { annual: Record<string, unknown>[]; quarterly: Record<string, unknown>[] };
    provider: string;
  };
  const [richFin, setRichFin] = useState<RichFinancials | null>(null);

  const [peers, setPeers] = useState<Peer[]>([]);
  const [loadingPeers, setLoadingPeers] = useState(false);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [onClose]);

  // Fetch detail + score in one call (eliminates double yfinance hit on cache miss)
  useEffect(() => {
    setLoading(true);
    setLoadingScore(true);
    setData(null);
    setScore(null);
    setDataError(false);
    setRichFin(null);  // reset on every ticker change
    marketApi.getStockDetail(ticker, true)
      .then((r) => {
        const d = r.data;
        if (d?.profile) {
          setData(d);
          if (d.score?.overall_score != null) setScore(d.score);
        } else setDataError(true);
      })
      .catch(() => setDataError(true))
      .finally(() => { setLoading(false); setLoadingScore(false); });

    // Peers load in background — non-blocking
    setLoadingPeers(true);
    setPeers([]);
    marketApi.getPeers(ticker)
      .then((r) => setPeers(r.data ?? []))
      .catch(() => setPeers([]))
      .finally(() => setLoadingPeers(false));
  }, [ticker]); // eslint-disable-line

  useEffect(() => {
    setLoadingChart(true);
    setChartData(null);
    setChartError(false);
    marketApi.getChart(ticker, period)
      .then((r) => {
        const d = r.data;
        if (d?.prices?.length > 0) setChartData(d);
        else setChartError(true);
      })
      .catch(() => setChartError(true))
      .finally(() => setLoadingChart(false));
  }, [ticker, period]); // eslint-disable-line

  // Lazy-load rich financials (income_stmt source) when financials tab opens
  useEffect(() => {
    if (tab !== "financials" || richFin) return;
    marketApi.getFinancials(ticker, 5)
      .then((r) => setRichFin(r.data as RichFinancials))
      .catch(() => {});
  }, [tab, ticker]); // eslint-disable-line

  // Lazy-load AI income analysis when financials tab is opened
  useEffect(() => {
    if (tab !== "financials" || incomeAnalysis || loadingAnalysis) return;
    setLoadingAnalysis(true);
    marketApi.getIncomeAnalysis(ticker)
      .then((r) => setIncomeAnalysis(r.data?.analysis ?? ""))
      .catch(() => {})
      .finally(() => setLoadingAnalysis(false));
  }, [tab, ticker]); // eslint-disable-line

  const profile = data?.profile;
  const analyst = data?.analyst;

  const priceChange = profile?.current_price != null && profile?.prev_close != null
    ? profile.current_price - profile.prev_close : null;
  const pricePct = priceChange != null && profile?.prev_close
    ? (priceChange / profile.prev_close) * 100 : null;
  const isUp = (pricePct ?? 0) >= 0;
  const priceColor = isUp ? "#22c55e" : "#ef4444";

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch"
      style={{ background: "var(--card)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col w-full h-full overflow-hidden"
        style={{ background: "var(--card)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-5 pt-4 pb-3 border-b shrink-0" style={{ borderColor: "var(--border)", background: score ? `linear-gradient(180deg, ${score.signal.includes("COMPRA") ? "#22c55e" : score.signal.includes("VEND") ? "#ef4444" : "#f59e0b"}08 0%, var(--card) 100%)` : "var(--card)" }}>
          {/* Top row: avatar + name/ticker + close */}
          <div className="flex items-start gap-3 mb-3">
            <Avatar ticker={ticker} glowColor={recColor(profile?.recommendation)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-black" style={{ color: "var(--text)" }}>{ticker}</span>
                {profile?.exchange && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                        style={{ background: "var(--raised)", color: "var(--muted)" }}>
                    {profile.exchange}
                  </span>
                )}
                {profile?.sector && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
                    {profile.sector}
                  </span>
                )}
              </div>
              <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                {profile?.name ?? ticker}
              </p>
            </div>
            <button onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0 mt-0.5"
                    style={{ color: "var(--muted)" }}>
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Price row */}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              {loading ? (
                <div className="space-y-2">
                  <div className="animate-pulse h-9 w-36 rounded-lg" style={{ background: "var(--raised)" }} />
                  <div className="animate-pulse h-4 w-28 rounded" style={{ background: "var(--raised)" }} />
                </div>
              ) : profile?.current_price != null ? (
                <>
                  <p className="text-4xl font-black leading-none" style={{ color: "var(--text)" }}>
                    ${profile.current_price < 1 ? profile.current_price.toFixed(4) : profile.current_price.toFixed(2)}
                  </p>
                  {pricePct != null && priceChange != null && (
                    <p className="text-sm font-bold flex items-center gap-1 mt-1" style={{ color: priceColor }}>
                      {isUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)} ({fmtPct(pricePct)}) hoy
                    </p>
                  )}
                </>
              ) : dataError ? (
                <p className="text-sm font-bold" style={{ color: "#ef4444" }}>Sin datos</p>
              ) : null}
            </div>
            {/* AI signal badge */}
            <div className="shrink-0 mb-1">
              {loadingScore ? (
                <div className="animate-pulse h-8 w-24 rounded-full" style={{ background: "var(--raised)" }} />
              ) : score ? (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                     style={{
                       background: score.signal.includes("COMPRA") ? "rgba(34,197,94,0.15)" : score.signal.includes("VEND") ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
                       border: `1px solid ${score.signal.includes("COMPRA") ? "rgba(34,197,94,0.3)" : score.signal.includes("VEND") ? "rgba(239,68,68,0.3)" : "rgba(245,158,11,0.3)"}`,
                     }}>
                  <span className="text-lg font-black leading-none"
                        style={{ color: score.signal.includes("COMPRA") ? "#22c55e" : score.signal.includes("VEND") ? "#ef4444" : "#f59e0b" }}>
                    {score.overall_score}
                  </span>
                  <div>
                    <p className="text-[8px] font-black leading-none"
                       style={{ color: score.signal.includes("COMPRA") ? "#22c55e" : score.signal.includes("VEND") ? "#ef4444" : "#f59e0b" }}>
                      {score.signal}
                    </p>
                    <p className="text-[8px] leading-none mt-0.5" style={{ color: "var(--dim)" }}>AI Score</p>
                  </div>
                </div>
              ) : profile?.recommendation ? (
                <span className="text-xs font-bold px-3 py-1.5 rounded-full"
                      style={{ background: `${recColor(profile.recommendation)}18`, color: recColor(profile.recommendation), border: `1px solid ${recColor(profile.recommendation)}30` }}>
                  {recLabel(profile.recommendation)}
                </span>
              ) : null}
            </div>
          </div>

          {/* 52-week range bar */}
          {profile?.week_52_low != null && profile?.week_52_high != null && profile?.current_price != null && (() => {
            const low52 = profile.week_52_low!;
            const high52 = profile.week_52_high!;
            const cur = profile.current_price!;
            const pct = Math.max(0, Math.min(100, ((cur - low52) / (high52 - low52)) * 100));
            return (
              <div className="mt-3 px-1">
                <div className="flex justify-between mb-1">
                  <span className="text-[9px] font-semibold" style={{ color: "var(--dim)" }}>52s Mín ${low52.toFixed(0)}</span>
                  <span className="text-[9px] font-semibold" style={{ color: "var(--dim)" }}>52s Máx ${high52.toFixed(0)}</span>
                </div>
                <div className="relative h-1.5 rounded-full" style={{ background: "var(--border)" }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, #22c55e, ${recColor(profile.recommendation)})` }} />
                  <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white"
                       style={{ left: `calc(${pct}% - 6px)`, background: recColor(profile.recommendation) }} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── Tab bar ── */}
        <div className="shrink-0" style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 6, padding: "10px 16px", overflowX: "auto" }}>
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className="rounded-full whitespace-nowrap transition-all"
                style={{
                  padding: "6px 16px", fontSize: 12, flexShrink: 0,
                  fontWeight: tab === key ? 900 : 600,
                  color: tab === key ? "var(--accent-l)" : "var(--muted)",
                  background: tab === key ? "rgba(0,168,94,0.14)" : "var(--raised)",
                  border: tab === key ? "1px solid rgba(0,168,94,0.3)" : "1px solid var(--border)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-3xl mx-auto w-full">

          {/* ── VEREDICTO ── */}
          {tab === "verdict" && (
            <div className="px-5 py-4 space-y-4">
              {loadingScore ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--accent-l)" }} />
                  <p className="text-xs" style={{ color: "var(--muted)" }}>Analizando el negocio…</p>
                </div>
              ) : score ? (
                <>
                  {/* ── Score Hero ── */}
                  {(() => {
                    const sc = score.overall_score;
                    const scoreColor = sc >= 75 ? "#22c55e" : sc >= 55 ? "#f59e0b" : "#ef4444";
                    const signalColor = score.signal.includes("COMPRA") ? "#22c55e" : score.signal.includes("VEND") ? "#ef4444" : "#f59e0b";
                    const R = 48, CX = 60, CY = 60;
                    const circ = 2 * Math.PI * R;
                    const dash = (sc / 100) * circ;
                    return (
                      <div className="rounded-3xl overflow-hidden relative"
                           style={{ background: `linear-gradient(135deg, ${scoreColor}14 0%, var(--raised) 60%)`,
                                    border: `1px solid ${scoreColor}25` }}>
                        <div className="absolute -top-8 -right-6 w-44 h-44 rounded-full pointer-events-none"
                             style={{ background: scoreColor + "0C" }} />
                        <div className="absolute -bottom-10 -left-4 w-32 h-32 rounded-full pointer-events-none"
                             style={{ background: scoreColor + "08" }} />
                        <div className="relative z-10 flex items-center gap-5 p-5">
                          <div className="relative shrink-0" style={{ width: 120, height: 120 }}>
                            <svg width="120" height="120" viewBox="0 0 120 120">
                              <circle cx={CX} cy={CY} r={R} fill="none" stroke={scoreColor + "22"} strokeWidth="10" />
                              <circle cx={CX} cy={CY} r={R} fill="none" stroke={scoreColor} strokeWidth="10"
                                strokeLinecap="round"
                                strokeDasharray={`${dash} ${circ}`}
                                strokeDashoffset={circ * 0.25}
                                transform={`rotate(-90 ${CX} ${CY})`}
                                style={{ transition: "stroke-dasharray 0.6s" }}
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-4xl font-black leading-none" style={{ color: "var(--text)" }}>{sc}</span>
                              <span className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--muted)" }}>/ 100</span>
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2.5 mb-2 flex-wrap">
                              {score.grade && (
                                <span className="text-5xl font-black leading-none" style={{ color: scoreColor }}>{score.grade}</span>
                              )}
                              <span className="text-xs font-black px-3 py-1.5 rounded-full tracking-wider"
                                    style={{ background: signalColor + "1A", color: signalColor, border: `1px solid ${signalColor}40` }}>
                                {score.signal}
                              </span>
                            </div>
                            <p className="text-sm font-semibold leading-snug" style={{ color: "var(--sub)" }}>
                              {score.verdict_short}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── CORTO / LARGO outlook ── */}
                  {(() => {
                    const text = score.verdict_long;
                    const cortoIdx = text.indexOf("**CORTO:**");
                    const largoIdx = text.indexOf("**LARGO:**");
                    let preText = "", cortoText = "", largoText = "";
                    if (cortoIdx !== -1 || largoIdx !== -1) {
                      const markers = [
                        cortoIdx !== -1 ? { key: "corto", idx: cortoIdx, marker: "**CORTO:**" } : null,
                        largoIdx !== -1 ? { key: "largo", idx: largoIdx, marker: "**LARGO:**" } : null,
                      ].filter(Boolean).sort((a, b) => a!.idx - b!.idx) as { key: string; idx: number; marker: string }[];
                      preText = text.slice(0, markers[0].idx).trim();
                      markers.forEach((m, i) => {
                        const start = m.idx + m.marker.length;
                        const end = i < markers.length - 1 ? markers[i + 1].idx : text.length;
                        const content = text.slice(start, end).trim();
                        if (m.key === "corto") cortoText = content;
                        else largoText = content;
                      });
                    } else { preText = text; }
                    return (
                      <div className={`grid gap-3 ${cortoText && largoText ? "grid-cols-2" : "grid-cols-1"}`}>
                        {preText && !cortoText && !largoText && (
                          <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{preText}</p>
                        )}
                        {cortoText && (
                          <div className="rounded-2xl p-4"
                               style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#f59e0b" }} />
                              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>Corto plazo</span>
                            </div>
                            <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{cortoText}</p>
                          </div>
                        )}
                        {largoText && (
                          <div className="rounded-2xl p-4"
                               style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}>
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: "#22c55e" }} />
                              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#22c55e" }}>Largo plazo</span>
                            </div>
                            <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{largoText}</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Entry Range ── */}
                  {score.entry_ranges && score.entry_ranges.length > 0 && score.entry_ranges_meta && (
                    <div className="rounded-3xl p-5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>
                          ¿Cuándo entrar?
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: "var(--border)", color: "var(--muted)" }}>
                          Valor justo ${score.entry_ranges_meta.fair_value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · {score.entry_ranges_meta.fair_value_src}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        {score.entry_ranges.map((range) => {
                          const rangeLabel = range.min !== null && range.max !== null
                            ? `$${range.min.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} – $${range.max.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : range.min !== null
                            ? `> $${range.min.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `< $${range.max!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                          return (
                            <div key={range.signal}
                                 className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-all"
                                 style={{
                                   background: range.is_current ? range.color + "18" : "transparent",
                                   border: range.is_current ? `1.5px solid ${range.color}50` : "1px solid transparent",
                                 }}>
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: range.color, opacity: range.is_current ? 1 : 0.35 }} />
                              <div className="flex-1 flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold" style={{ color: range.is_current ? range.color : "var(--sub)", opacity: range.is_current ? 1 : 0.6 }}>
                                  {range.label}
                                </span>
                                <span className="text-[11px] font-mono" style={{ color: range.is_current ? "var(--text)" : "var(--muted)", opacity: range.is_current ? 1 : 0.6 }}>
                                  {rangeLabel}
                                </span>
                              </div>
                              {range.is_current && (
                                <span className="text-[9px] font-black px-2 py-0.5 rounded-full shrink-0"
                                      style={{ background: range.color + "30", color: range.color }}>
                                  AHORA
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* ── Category grid ── */}
                  <div className="grid grid-cols-4 gap-2">
                    {score.categories.map((cat) => {
                      const catColor = cat.score >= 75 ? "#22c55e" : cat.score >= 55 ? "#f59e0b" : "#ef4444";
                      return (
                        <div key={cat.key} className="rounded-2xl p-4 flex flex-col gap-3"
                             style={{ background: "var(--raised)", border: `1px solid ${catColor}30` }}>
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[9px] font-bold uppercase tracking-wide leading-tight"
                                  style={{ color: "var(--muted)" }}>{cat.name}</span>
                            <span className="text-sm font-black shrink-0" style={{ color: catColor }}>{cat.score}</span>
                          </div>
                          <div className="h-1.5 rounded-full" style={{ background: "var(--border)" }}>
                            <div className="h-1.5 rounded-full" style={{ width: `${cat.score}%`, background: catColor }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Metric cards */}
                  {score.categories.map((cat) => (
                    <div key={cat.key} className="pt-2">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-4 rounded-full shrink-0" style={{ background: cat.score >= 75 ? "#22c55e" : cat.score >= 55 ? "#f59e0b" : "#ef4444" }} />
                        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>{cat.name}</span>
                        <span className="ml-auto text-xs font-black" style={{ color: cat.score >= 75 ? "#22c55e" : cat.score >= 55 ? "#f59e0b" : "#ef4444" }}>
                          {cat.score}/100
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {cat.metrics.map((m) => (
                          <MetricCard key={m.name} metric={m} />
                        ))}
                      </div>
                    </div>
                  ))}

                  <p className="text-[9px] text-center pt-1" style={{ color: "var(--dim)" }}>
                    Score calculado sobre datos SEC / Yahoo Finance · Análisis por IA · No es asesoramiento financiero
                  </p>
                </>
              ) : (
                <p className="text-xs text-center py-10" style={{ color: "var(--muted)" }}>
                  No se pudo calcular el score
                </p>
              )}
            </div>
          )}

          {/* ── GRÁFICA ── */}
          {tab === "chart" && (
            chartError && !loadingChart ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 px-6 text-center">
                <p className="text-sm font-bold" style={{ color: "#ef4444" }}>No se pudieron cargar los datos</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Intenta con otro período o vuelve a intentarlo más tarde
                </p>
              </div>
            ) : (
              <GoogleFinanceChart
                prices={chartData?.prices ?? []}
                timestamps={chartData?.timestamps ?? []}
                changePct={chartData?.change_pct ?? 0}
                loading={loadingChart}
                period={period}
                onPeriodChange={setPeriod}
              />
            )
          )}

          {/* ── FINANCIEROS ── */}
          {tab === "financials" && (
            <div className="py-4 space-y-0">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : (() => {
                const src = finPeriod === "annual" ? "annual" : "quarterly";
                // richFin already comes oldest→newest from /financials endpoint
                // Legacy stock-detail data comes newest→oldest and needs .reverse()
                const income   = richFin?.incomeStatement?.[src]
                  ? [...richFin.incomeStatement[src]]
                  : (data?.financials?.income?.[src]   ?? []).slice().reverse();
                const balance  = richFin?.balanceSheet?.[src]
                  ? [...richFin.balanceSheet[src]]
                  : (data?.financials?.balance?.[src]  ?? []).slice().reverse();
                const cashflow = richFin?.cashFlow?.[src]
                  ? [...richFin.cashFlow[src]]
                  : (data?.financials?.cashflow?.[src] ?? []).slice().reverse();

                if (!income.length && !balance.length && !cashflow.length) {
                  return <p className="text-xs text-center py-10" style={{ color: "var(--muted)" }}>Sin datos financieros</p>;
                }


                const FIN_TABS: { key: "income" | "balance" | "cashflow"; label: string }[] = [
                  { key: "income",   label: "Est. Resultados" },
                  { key: "balance",  label: "Balance General" },
                  { key: "cashflow", label: "Flujo de Caja"   },
                ];

                return (
                  <>
                    {/* Annual / Quarterly toggle */}
                    <div className="flex items-center gap-2 px-5 pb-3">
                      {(["annual", "quarterly"] as const).map((p) => (
                        <button key={p} onClick={() => setFinPeriod(p)}
                                className="px-3 py-1.5 text-xs font-bold rounded-full transition-colors"
                                style={{
                                  background: finPeriod === p ? "rgba(0,168,94,0.14)" : "var(--raised)",
                                  color: finPeriod === p ? "var(--accent-l)" : "var(--muted)",
                                  border: `1px solid ${finPeriod === p ? "rgba(0,168,94,0.3)" : "var(--border)"}`,
                                }}>
                          {p === "annual" ? "Anual" : "Trimestral"}
                        </button>
                      ))}
                      <span className="ml-auto text-[9px]" style={{ color: "var(--dim)" }}>
                        {richFin?.provider === "fiscal_ai" ? "Fiscal.ai" : richFin?.provider === "fmp" ? "Financial Modeling Prep" : "Yahoo Finance"}
                      </span>
                    </div>

                    {/* Section sub-tabs */}
                    <div className="flex gap-2 px-5 pb-3">
                      {FIN_TABS.map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setFinSection(key)}
                          className="px-3 py-1.5 text-[11px] font-bold rounded-full transition-colors"
                          style={{
                            background: finSection === key ? "rgba(0,168,94,0.14)" : "var(--raised)",
                            color: finSection === key ? "var(--accent-l)" : "var(--muted)",
                            border: `1px solid ${finSection === key ? "rgba(0,168,94,0.3)" : "var(--border)"}`,
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>

                    {finSection === "income" && (
                      <IncomeStatementTab
                        income={income}
                        grossMarginPct={profile?.gross_margins ?? undefined}
                        operatingMarginPct={profile?.operating_margins ?? undefined}
                        netMarginPct={profile?.profit_margins ?? undefined}
                      />
                    )}

                    {finSection === "balance" && <BalanceSheetTab balance={balance} />}

                    {finSection === "cashflow" && <CashFlowTab cashflow={cashflow} />}
                  </>
                );
              })()}
            </div>
          )}

          {/* ── ANALISTAS — StockAnalysis.com style ── */}
          {tab === "analyst" && (
            <div className="px-5 py-4 space-y-5">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : (() => {
                const pt = analyst?.price_target;
                const cur = profile?.current_price ?? pt?.current;
                const mean = pt?.mean, low = pt?.low, high = pt?.high;
                const r = analyst?.ratings ?? { strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0 };
                const total = r.strong_buy + r.buy + r.hold + r.sell + r.strong_sell;
                const bullPct = total > 0 ? (r.strong_buy + r.buy) / total : 0;
                const bearPct = total > 0 ? (r.sell + r.strong_sell) / total : 0;
                const consensusText = total === 0 ? "Sin datos"
                  : bullPct > 0.7 ? "Compra Fuerte"
                  : bullPct > 0.5 ? "Compra"
                  : r.hold / total > 0.5 ? "Mantener"
                  : bearPct > 0.5 ? "Vender" : "Mantener";
                const cColor = consensusText.includes("Compra") ? "#22c55e" : consensusText === "Mantener" ? "#f59e0b" : "#ef4444";
                const upside = mean && cur ? ((mean - cur) / cur * 100) : null;

                return (
                  <>
                    {/* ── Forecast hero: gauge left + chart right ── */}
                    <div>
                      <h2 className="text-base font-black mb-3" style={{ color: "var(--text)" }}>
                        Pronóstico y Consenso de Analistas
                      </h2>

                      <div className="flex gap-4 items-start">
                        {/* Left panel */}
                        <div className="w-44 shrink-0 space-y-2">
                          {total > 0 && cur && (
                            <p className="text-[10px] leading-relaxed" style={{ color: "var(--sub)" }}>
                              Según <span className="font-bold">{analyst?.n_analysts ?? total}</span> analistas,{" "}
                              consenso de{" "}
                              <span className="font-bold" style={{ color: cColor }}>"{consensusText}"</span>.
                              {mean && upside != null && (
                                <> Precio objetivo <span className="font-bold" style={{ color: "var(--text)" }}>${mean.toFixed(2)}</span>{" "}
                                (<span style={{ color: upside >= 0 ? "#22c55e" : "#ef4444" }}>
                                  {upside >= 0 ? "+" : ""}{upside.toFixed(2)}%
                                </span>).</>
                              )}
                            </p>
                          )}

                          {mean && cur && upside != null && (
                            <div>
                              <p className="text-[9px] font-semibold mb-0.5" style={{ color: "var(--muted)" }}>
                                Precio Objetivo:
                              </p>
                              <p className="text-xl font-black leading-tight" style={{ color: cColor }}>
                                ${mean.toFixed(2)}
                              </p>
                              <p className="text-sm font-bold" style={{ color: upside >= 0 ? "#22c55e" : "#ef4444" }}>
                                ({upside >= 0 ? "+" : ""}{upside.toFixed(2)}%)
                              </p>
                            </div>
                          )}

                          <div className="flex flex-col items-center -mx-2">
                            <SpeedometerGauge signal={consensusText} />
                            <p className="text-xs font-black -mt-1" style={{ color: cColor }}>
                              {consensusText}
                            </p>
                          </div>
                        </div>

                        {/* Right: forecast chart */}
                        <div className="flex-1 min-w-0">
                          {(chartData?.prices?.length ?? 0) > 10 ? (
                            <ForecastChart
                              prices={chartData!.prices}
                              current={cur ?? chartData!.prices[chartData!.prices.length - 1]}
                              targetLow={low}
                              targetMean={mean}
                              targetHigh={high}
                            />
                          ) : (
                            <div className="flex items-center justify-center" style={{ height: 180 }}>
                              <p className="text-xs" style={{ color: "var(--muted)" }}>Cargando gráfica…</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Price target table ── */}
                    {mean && low && high && cur && (
                      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
                              {["Objetivo", "Mínimo", "Promedio", "Máximo"].map((h) => (
                                <th key={h} className="px-3 py-2 text-right first:text-left font-semibold"
                                    style={{ color: "var(--muted)" }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr style={{ borderBottom: "1px solid var(--border)" }}>
                              <td className="px-3 py-2 font-semibold" style={{ color: "var(--sub)" }}>Precio</td>
                              <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: "var(--text)" }}>${low.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: "#22c55e" }}>${mean.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-bold tabular-nums" style={{ color: "var(--text)" }}>${high.toFixed(2)}</td>
                            </tr>
                            <tr>
                              <td className="px-3 py-2 font-semibold" style={{ color: "var(--sub)" }}>Potencial</td>
                              {[low, mean, high].map((t, i) => {
                                const pct = ((t - cur) / cur * 100);
                                return (
                                  <td key={i} className="px-3 py-2 text-right font-semibold tabular-nums"
                                      style={{ color: pct >= 0 ? "#22c55e" : "#ef4444" }}>
                                    {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
                                  </td>
                                );
                              })}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ── Ratings bar ── */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>
                          Distribución de Recomendaciones
                        </h3>
                        {analyst?.n_analysts ? (
                          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                            {analyst.n_analysts} analistas
                          </span>
                        ) : null}
                      </div>
                      <RatingsBar ratings={r} />
                    </div>

                    {/* ── EPS surprises ── */}
                    {(analyst?.eps_surprises?.length ?? 0) > 0 && (
                      <div>
                        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>
                          <Activity className="w-4 h-4 inline mr-1.5" />
                          Sorpresas EPS
                        </h3>
                        <div className="flex items-center gap-4 text-[10px] mb-1 px-0.5" style={{ color: "var(--dim)" }}>
                          <span className="w-20">Período</span>
                          <span className="w-14 text-right">Real</span>
                          <span className="w-14 text-right">Estimado</span>
                          <span className="ml-auto">Sorpresa</span>
                        </div>
                        {analyst!.eps_surprises.map((s) => <EpsSurpriseRow key={s.period} item={s} />)}
                      </div>
                    )}

                    {/* ── EPS estimates ── */}
                    {(analyst?.eps_estimates?.length ?? 0) > 0 && (
                      <div>
                        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>
                          <BarChart3 className="w-4 h-4 inline mr-1.5" />
                          Estimaciones EPS Futuras
                        </h3>
                        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                          <table className="w-full text-xs">
                            <thead>
                              <tr style={{ background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
                                {["Período", "Prom.", "Mín", "Máx", "Crecim."].map((h) => (
                                  <th key={h} className="px-3 py-2 text-right first:text-left font-semibold"
                                      style={{ color: "var(--muted)" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {analyst!.eps_estimates.map((e, i) => (
                                <tr key={e.period} style={{ borderBottom: i < analyst!.eps_estimates.length - 1 ? "1px solid var(--border)" : "none" }}>
                                  <td className="px-3 py-2 font-semibold" style={{ color: "var(--sub)" }}>{e.period}</td>
                                  <td className="px-3 py-2 text-right font-bold" style={{ color: "var(--text)" }}>${fmtNum(e.avg)}</td>
                                  <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>${fmtNum(e.low)}</td>
                                  <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>${fmtNum(e.high)}</td>
                                  <td className="px-3 py-2 text-right font-semibold" style={{ color: (e.growth ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                                    {fmtPct(e.growth)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* ── Revenue estimates ── */}
                    {(analyst?.revenue_estimates?.length ?? 0) > 0 && (
                      <div>
                        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>
                          <DollarSign className="w-4 h-4 inline mr-1.5" />
                          Estimaciones de Ingresos
                        </h3>
                        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                          <table className="w-full text-xs">
                            <thead>
                              <tr style={{ background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
                                {["Período", "Prom.", "Mín", "Máx", "Crecim."].map((h) => (
                                  <th key={h} className="px-3 py-2 text-right first:text-left font-semibold"
                                      style={{ color: "var(--muted)" }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {analyst!.revenue_estimates.map((e, i) => (
                                <tr key={e.period} style={{ borderBottom: i < analyst!.revenue_estimates.length - 1 ? "1px solid var(--border)" : "none" }}>
                                  <td className="px-3 py-2 font-semibold" style={{ color: "var(--sub)" }}>{e.period}</td>
                                  <td className="px-3 py-2 text-right font-bold" style={{ color: "var(--text)" }}>{fmtBig(e.avg)}</td>
                                  <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>{fmtBig(e.low)}</td>
                                  <td className="px-3 py-2 text-right" style={{ color: "var(--muted)" }}>{fmtBig(e.high)}</td>
                                  <td className="px-3 py-2 text-right font-semibold" style={{ color: (e.growth ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                                    {fmtPct(e.growth)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <p className="text-[9px] text-center" style={{ color: "var(--dim)" }}>
                      Fuente: {data?.sources?.analyst === "finnhub" ? "Finnhub" : data?.sources?.analyst === "fmp" ? "Financial Modeling Prep" : "Yahoo Finance"} · Wall Street
                    </p>
                  </>
                );
              })()}
            </div>
          )}

          {/* ── EMPRESA ── */}
          {tab === "company" && (
            <div className="px-5 py-4 space-y-5">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--accent-l)" }} />
                </div>
              ) : profile ? (
                <>
                  {/* Valoración */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>💰 Valoración</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <StatCard label="Cap. Mkt"   value={fmtBig(profile.market_cap)} />
                      <StatCard label="EV"          value={fmtBig(profile.enterprise_value)} />
                      <StatCard label="P/E (TTM)"   value={fmtNum(profile.pe_ratio)} />
                      <StatCard label="P/E Fwd"     value={fmtNum(profile.forward_pe)} />
                      <StatCard label="PEG"         value={fmtNum(profile.peg_ratio)} />
                      <StatCard label="P/S"         value={fmtNum(profile.ps_ratio)} />
                      <StatCard label="P/B"         value={fmtNum(profile.pb_ratio)} />
                      <StatCard label="EV/EBITDA"   value={fmtNum(profile.ev_to_ebitda)} />
                      <StatCard label="EV/Revenue"  value={fmtNum(profile.ev_to_revenue)} />
                    </div>
                  </div>

                  {/* Rentabilidad */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>📊 Rentabilidad &amp; Márgenes</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <StatCard label="Margen Bruto"  value={profile.gross_margins != null ? `${profile.gross_margins.toFixed(1)}%` : "—"} />
                      <StatCard label="Margen Op."    value={profile.operating_margins != null ? `${profile.operating_margins.toFixed(1)}%` : "—"} />
                      <StatCard label="Margen Neto"   value={profile.profit_margins != null ? `${profile.profit_margins.toFixed(1)}%` : "—"} />
                      <StatCard label="EBITDA %"      value={profile.ebitda_margins != null ? `${profile.ebitda_margins.toFixed(1)}%` : "—"} />
                      <StatCard label="ROE"           value={profile.return_on_equity != null ? `${profile.return_on_equity.toFixed(1)}%` : "—"} />
                      <StatCard label="ROA"           value={profile.return_on_assets != null ? `${profile.return_on_assets.toFixed(1)}%` : "—"} />
                      <StatCard label="Crec. Rev."    value={fmtPct(profile.revenue_growth)} color={profile.revenue_growth != null ? (profile.revenue_growth >= 0 ? "#22c55e" : "#ef4444") : undefined} />
                      <StatCard label="Crec. Ganancias" value={fmtPct(profile.earnings_growth)} color={profile.earnings_growth != null ? (profile.earnings_growth >= 0 ? "#22c55e" : "#ef4444") : undefined} />
                      <StatCard label="Flujo Libre"   value={fmtBig(profile.free_cashflow)} />
                    </div>
                  </div>

                  {/* Balance */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>🏛️ Balance &amp; Liquidez</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <StatCard label="Deuda/Capital"   value={fmtNum(profile.debt_to_equity)} />
                      <StatCard label="Ratio Corriente"  value={fmtNum(profile.current_ratio)} />
                      <StatCard label="Ratio Rápido"     value={fmtNum(profile.quick_ratio)} />
                      <StatCard label="Efectivo"         value={fmtBig(profile.total_cash)} />
                      <StatCard label="Deuda Total"      value={fmtBig(profile.total_debt)} />
                      <StatCard label="Book Value"       value={profile.book_value != null ? `$${profile.book_value.toFixed(2)}` : "—"} />
                    </div>
                  </div>

                  {/* Precio & Volumen */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                      <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>📈 Precio &amp; Volumen</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <StatCard label="SMA 50"      value={profile.sma_50 ? `$${profile.sma_50.toFixed(2)}` : "—"} />
                      <StatCard label="SMA 200"     value={profile.sma_200 ? `$${profile.sma_200.toFixed(2)}` : "—"} />
                      <StatCard label="Beta"        value={fmtNum(profile.beta)} />
                      <StatCard label="Short %"     value={profile.short_pct_float != null ? `${profile.short_pct_float.toFixed(1)}%` : "—"} />
                      <StatCard label="Short Ratio" value={fmtNum(profile.short_ratio)} />
                      <StatCard label="Acciones"    value={fmtK(profile.shares_outstanding)} />
                    </div>
                  </div>

                  {/* Dividends */}
                  {(data?.dividends?.length ?? 0) > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>💵 Historial de Dividendos</span>
                        {profile.dividend_yield != null && profile.dividend_yield > 0 && (
                          <span className="ml-2 font-bold" style={{ color: "var(--accent-l)" }}>
                            {profile.dividend_yield.toFixed(2)}% yield
                          </span>
                        )}
                      </div>
                      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
                              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted)" }}>Fecha</th>
                              <th className="px-3 py-2 text-right font-semibold" style={{ color: "var(--muted)" }}>Dividendo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data!.dividends!.slice(0, 8).map((d, i) => (
                              <tr key={d.date}
                                  style={{ borderBottom: i < Math.min(data!.dividends!.length, 8) - 1 ? "1px solid var(--border)" : "none" }}>
                                <td className="px-3 py-2" style={{ color: "var(--sub)" }}>{d.date}</td>
                                <td className="px-3 py-2 text-right font-bold" style={{ color: "#22c55e" }}>
                                  {d.amount != null ? `$${d.amount.toFixed(4)}` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Institutional holders */}
                  {(data?.holders?.institutional?.length ?? 0) > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>🏦 Tenedores Institucionales</span>
                      </div>
                      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                        <table className="w-full text-xs">
                          <thead>
                            <tr style={{ background: "var(--raised)", borderBottom: "1px solid var(--border)" }}>
                              <th className="px-3 py-2 text-left font-semibold" style={{ color: "var(--muted)" }}>Institución</th>
                              <th className="px-3 py-2 text-right font-semibold" style={{ color: "var(--muted)" }}>Acciones</th>
                              <th className="px-3 py-2 text-right font-semibold" style={{ color: "var(--muted)" }}>Valor</th>
                              <th className="px-3 py-2 text-right font-semibold" style={{ color: "var(--muted)" }}>% Float</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data!.holders!.institutional.slice(0, 10).map((h, i) => (
                              <tr key={h.holder}
                                  style={{ borderBottom: i < Math.min(data!.holders!.institutional.length, 10) - 1 ? "1px solid var(--border)" : "none" }}>
                                <td className="px-3 py-2 font-semibold max-w-[180px] truncate" style={{ color: "var(--sub)" }}>{h.holder}</td>
                                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--text)" }}>{fmtK(h.shares)}</td>
                                <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--muted)" }}>{fmtBig(h.value)}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: "var(--accent-l)" }}>
                                  {h.pct_held != null ? `${(h.pct_held * 100).toFixed(2)}%` : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Insider transactions */}
                  {(data?.insiders?.length ?? 0) > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>🔍 Transacciones de Insiders</span>
                        <span className="text-[10px]" style={{ color: "var(--dim)" }}>directivos y directores</span>
                      </div>
                      <div className="space-y-1.5">
                        {data!.insiders!.slice(0, 10).map((ins, i) => {
                          const isBuy = ["P", "A", "Buy"].includes(ins.transaction?.slice(0, 1) ?? "");
                          return (
                            <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                                 style={{ background: "var(--raised)" }}>
                              <div className="w-1.5 h-8 rounded-full shrink-0"
                                   style={{ background: isBuy ? "#22c55e" : "#ef4444" }} />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{ins.name}</p>
                                <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{ins.title}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-xs font-bold" style={{ color: isBuy ? "#22c55e" : "#ef4444" }}>
                                  {isBuy ? "Compra" : "Venta"} · {fmtK(ins.shares)}
                                </p>
                                <p className="text-[10px]" style={{ color: "var(--muted)" }}>
                                  {ins.value ? fmtBig(ins.value) : (ins.price ? `@ $${ins.price.toFixed(2)}` : "")}
                                  {ins.date ? ` · ${ins.date.slice(0, 7)}` : ""}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-[9px] mt-2 text-center" style={{ color: "var(--dim)" }}>
                        Fuente: {data?.sources?.insiders === "finnhub" ? "Finnhub" : "SEC EDGAR via Yahoo Finance"}
                      </p>
                    </div>
                  )}

                  {/* Company info */}
                  <div>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {profile.sector && (
                        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                              style={{ background: "rgba(0,168,94,0.1)", color: "var(--accent-l)" }}>
                          <Building2 className="w-3 h-3" /> {profile.sector}
                        </span>
                      )}
                      {profile.industry && (
                        <span className="text-xs px-3 py-1.5 rounded-full"
                              style={{ background: "var(--raised)", color: "var(--sub)" }}>
                          {profile.industry}
                        </span>
                      )}
                      {profile.country && (
                        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                              style={{ background: "var(--raised)", color: "var(--sub)" }}>
                          <Globe className="w-3 h-3" />
                          {profile.city ? `${profile.city}, ` : ""}{profile.country}
                        </span>
                      )}
                      {profile.employees && (
                        <span className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full"
                              style={{ background: "var(--raised)", color: "var(--sub)" }}>
                          <Users className="w-3 h-3" /> {fmtK(profile.employees)} empleados
                        </span>
                      )}
                    </div>

                    {profile.description && (
                      <div className="mb-3" style={{ background: "var(--raised)", border: "1px solid var(--border)", borderRadius: 16, padding: 16 }}>
                        <p style={{ fontSize: 13, color: "var(--sub)", lineHeight: 1.6, margin: 0 }}>
                          {profile.description}
                        </p>
                      </div>
                    )}

                    {profile.website && (
                      <a href={profile.website} target="_blank" rel="noopener noreferrer"
                         className="flex items-center gap-2 text-xs font-semibold hover:opacity-80 transition-opacity"
                         style={{ color: "var(--accent-l)" }}>
                        <Globe className="w-3.5 h-3.5" />
                        {profile.website.replace(/^https?:\/\//, "")}
                        <ChevronRight className="w-3.5 h-3.5 ml-auto" />
                      </a>
                    )}
                  </div>

                  {/* Competitors */}
                  {(loadingPeers || peers.length > 0) && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-1 h-4 rounded-full shrink-0" style={{ background: "var(--accent-l)" }} />
                        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "var(--muted)" }}>🔎 Empresas Similares</span>
                      </div>
                      {loadingPeers ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--accent-l)" }} />
                        </div>
                      ) : (
                        <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--border)" }}>
                          {peers.map((peer, i) => {
                            const isUp = (peer.change_pct ?? 0) >= 0;
                            const pColor = isUp ? "#22c55e" : "#ef4444";
                            return (
                              <div key={peer.ticker} className="flex items-center gap-3 px-3 py-2.5"
                                   style={{ borderBottom: i < peers.length - 1 ? "1px solid var(--border)" : "none" }}>
                                <MiniAvatar ticker={peer.ticker} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{peer.ticker}</p>
                                  <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>{peer.name}</p>
                                </div>
                                {peer.price != null && (
                                  <div className="text-right shrink-0">
                                    <p className="text-xs font-bold tabular-nums" style={{ color: "var(--text)" }}>
                                      {peer.price >= 1000
                                        ? `$${peer.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
                                        : `$${peer.price.toFixed(2)}`}
                                    </p>
                                    {peer.change_pct != null && (
                                      <p className="text-[10px] font-semibold" style={{ color: pColor }}>
                                        {isUp ? "+" : ""}{peer.change_pct.toFixed(2)}%
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-center py-10" style={{ color: "var(--muted)" }}>Sin datos de empresa</p>
              )}
            </div>
          )}
          </div>{/* end max-w-3xl */}
        </div>
      </div>
    </div>
  );
}
