"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { market as marketApi } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface IndexData {
  symbol: string;
  name:   string;
  price:  number | null;
  change: number;
  change_pct: number;
}

type Period = "1d" | "5d" | "6m" | "ytd" | "1y" | "5y" | "max";

interface Props {
  indices:     IndexData[];
  lastRefresh?: Date | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const CW = 280, CH = 68;
function getPeriods(t: TFunction): { key: Period; label: string }[] {
  return [
    { key: "1d",  label: "1D"  },
    { key: "5d",  label: "5D"  },
    { key: "6m",  label: "6M"  },
    { key: "ytd", label: "YTD" },
    { key: "1y",  label: t("homeMarketOverview.periods.oneYear")  },
    { key: "5y",  label: t("homeMarketOverview.periods.fiveYears")  },
    { key: "max", label: t("homeMarketOverview.periods.max") },
  ];
}

// ─── SVG helpers ───────────────────────────────────────────────────────────────
function buildLine(prices: number[], w = CW, h = CH): string {
  if (prices.length < 2) return "";
  const min = Math.min(...prices), max = Math.max(...prices);
  const rng = max - min || 1;
  const p   = 3;
  return prices.map((v, i) => {
    const x = p + (i / (prices.length - 1)) * (w - p * 2);
    const y = p + (h - p * 2) - ((v - min) / rng) * (h - p * 2);
    return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ");
}

function buildArea(prices: number[], w = CW, h = CH): string {
  const line = buildLine(prices, w, h);
  if (!line) return "";
  return `${line} L ${(w - 3).toFixed(1)} ${h} L 3 ${h} Z`;
}

// ─── Formatting helpers ─────────────────────────────────────────────────────────
function fmtPrice(price: number, symbol: string): string {
  if (symbol === "^VIX")  return price.toFixed(2);
  if (price >= 10_000)    return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (price >= 1_000)     return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return price.toFixed(2);
}

function fmtChange(change: number): string {
  const abs = Math.abs(change);
  const val = abs >= 0.01 ? change.toFixed(2) : change.toFixed(4);
  return change >= 0 ? `+${val}` : val;
}

function timeAgo(d: Date, t: TFunction): string {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 5)  return t("homeMarketOverview.timeAgo.now");
  if (s < 60) return t("homeMarketOverview.timeAgo.secondsAgo", { count: s });
  return t("homeMarketOverview.timeAgo.minutesAgo", { count: Math.round(s / 60) });
}

// ─── VIX sentiment ──────────────────────────────────────────────────────────────
function vixSentiment(price: number | null, t: TFunction): { label: string; desc: string; color: string; bar: number } {
  if (price == null) return { label: "—",               desc: "",                               color: "var(--muted)", bar: 0 };
  if (price < 15)    return { label: t("homeMarketOverview.vix.calmLabel"),            desc: t("homeMarketOverview.vix.calmDesc"),     color: "#22c55e",      bar: 15 };
  if (price < 20)    return { label: t("homeMarketOverview.vix.normalLabel"),           desc: t("homeMarketOverview.vix.normalDesc"),  color: "#84cc16",      bar: 35 };
  if (price < 30)    return { label: t("homeMarketOverview.vix.cautiousLabel"),        desc: t("homeMarketOverview.vix.cautiousDesc"), color: "#f59e0b",      bar: 65 };
  return                    { label: t("homeMarketOverview.vix.highVolLabel"), desc: t("homeMarketOverview.vix.highVolDesc"),color: "#ef4444",      bar: 100 };
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="flex-shrink-0 rounded-2xl border overflow-hidden animate-pulse"
         style={{ minWidth: 160, background: "var(--card)", borderColor: "var(--border)" }}>
      <div className="p-3 space-y-2">
        <div className="h-2.5 w-16 rounded" style={{ background: "var(--raised)" }} />
        <div className="h-5 w-20 rounded" style={{ background: "var(--raised)" }} />
        <div className="h-4 w-12 rounded" style={{ background: "var(--raised)" }} />
      </div>
      <div className="h-14 w-full" style={{ background: "var(--raised)" }} />
    </div>
  );
}

// Compute period return from a price array: (last - first) / first * 100
function calcPeriodReturn(prices: number[]): number | null {
  if (prices.length < 2 || prices[0] === 0) return null;
  return ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
}

// ─── Single index card ─────────────────────────────────────────────────────────
function IndexCard({ idx, prices, loading, isBest, period, periods, t }: {
  idx:     IndexData;
  prices:  number[];
  loading: boolean;
  isBest:  boolean;
  period:  Period;
  periods: { key: Period; label: string }[];
  t:       TFunction;
}) {
  const isHistorical = period !== "1d" && period !== "5d";
  const periodReturn = isHistorical ? calcPeriodReturn(prices) : null;
  const displayPct   = periodReturn ?? idx.change_pct;
  const up    = displayPct >= 0;
  const col   = up ? "#22c55e" : "#ef4444";
  const gradId = `hmo-grad-${idx.symbol.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <div className="flex-shrink-0 rounded-2xl border flex flex-col overflow-hidden transition-all hover:scale-[1.02]"
         style={{ minWidth: 165, background: "var(--card)", borderColor: `${col}30`, position: "relative" }}>

      {/* Best performer badge */}
      {isBest && (
        <div className="absolute top-0 right-0 text-[9px] font-black px-2 py-0.5 rounded-bl-xl z-10"
             style={{ background: "#f59e0b", color: "#000", letterSpacing: 0.3 }}>
          ★ {t("homeMarketOverview.best")}
        </div>
      )}

      {/* Top section */}
      <div className="px-3 pt-3 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "var(--muted)" }}>
          {idx.name}
        </p>
        <p className="text-[17px] font-black leading-none tracking-tight"
           style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {idx.price != null ? fmtPrice(idx.price, idx.symbol) : "—"}
        </p>

        {/* Period return or day change */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[12px] font-black px-1.5 py-0.5 rounded-md"
                style={{ background: `${col}15`, color: col }}>
            {up ? "▲" : "▼"} {Math.abs(displayPct).toFixed(2)}%
          </span>
          {isHistorical && periodReturn != null ? (
            <span className="text-[9px] font-semibold" style={{ color: "var(--dim)" }}>
              {periods.find(p => p.key === period)?.label}
            </span>
          ) : idx.change !== 0 && (
            <span className="text-[10px]" style={{ color: "var(--dim)", fontVariantNumeric: "tabular-nums" }}>
              {fmtChange(idx.change)}
            </span>
          )}
        </div>

        {/* Secondary: 1D change shown when viewing historical period */}
        {isHistorical && (
          <p className="text-[9px] mt-0.5" style={{ color: "var(--dim)" }}>
            {t("homeMarketOverview.today")}: <span style={{ color: idx.change_pct >= 0 ? "#22c55e" : "#ef4444" }}>
              {idx.change_pct >= 0 ? "+" : ""}{idx.change_pct.toFixed(2)}%
            </span>
          </p>
        )}
      </div>

      {/* Sparkline */}
      <div style={{ height: 56, overflow: "hidden" }}>
        {loading && prices.length === 0 ? (
          <div className="w-full h-full animate-pulse" style={{ background: `${col}08` }} />
        ) : prices.length > 1 ? (
          <svg viewBox={`0 0 ${CW} ${CH}`} style={{ width: "100%", height: 56 }} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={col} stopOpacity="0.22" />
                <stop offset="100%" stopColor={col} stopOpacity="0"    />
              </linearGradient>
            </defs>
            <path d={buildArea(prices)} fill={`url(#${gradId})`} />
            <path d={buildLine(prices)} stroke={col} strokeWidth="1.8"
                  fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <div className="w-full h-full" style={{ background: `${col}06` }} />
        )}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function HomeMarketOverview({ indices, lastRefresh }: Props) {
  const { t } = useTranslation();
  const PERIODS = getPeriods(t);
  const [period, setPeriod]         = useState<Period>("1d");
  const [charts, setCharts]         = useState<Record<string, number[]>>({});
  const [chartLoading, setLoading]  = useState(false);
  const cache = useRef<Record<string, Partial<Record<Period, number[]>>>>({});

  // Fetch charts when period changes or indices first arrive
  const fetchCharts = useCallback(async (p: Period, syms: string[]) => {
    if (!syms.length) return;
    const allCached = syms.every(s => cache.current[s]?.[p]);
    if (allCached) {
      const hit: Record<string, number[]> = {};
      syms.forEach(s => { hit[s] = cache.current[s]![p]!; });
      setCharts(hit);
      return;
    }
    setLoading(true);
    const results = await Promise.allSettled(
      syms.map(async s => {
        if (cache.current[s]?.[p]) return { s, prices: cache.current[s]![p]! };
        const res: any = await marketApi.getChart(s, p);
        const prices: number[] = res?.data?.prices ?? [];
        if (!cache.current[s]) cache.current[s] = {};
        cache.current[s][p] = prices;
        return { s, prices };
      })
    );
    const next: Record<string, number[]> = {};
    results.forEach(r => { if (r.status === "fulfilled") next[r.value.s] = r.value.prices; });
    setCharts(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (indices.length) fetchCharts(period, indices.map(i => i.symbol));
  }, [period, indices.length, fetchCharts]);

  // ── Derived values ───────────────────────────────────────────────────────────
  const isHistorical = period !== "1d" && period !== "5d";
  const vixIdx  = indices.find(i => i.symbol === "^VIX");
  const nonVix  = indices.filter(i => i.symbol !== "^VIX");
  const best    = nonVix.length
    ? nonVix.reduce((a, b) => {
        const ra = isHistorical ? (calcPeriodReturn(charts[a.symbol] ?? []) ?? a.change_pct) : a.change_pct;
        const rb = isHistorical ? (calcPeriodReturn(charts[b.symbol] ?? []) ?? b.change_pct) : b.change_pct;
        return rb > ra ? b : a;
      }, nonVix[0])
    : null;
  const sentiment = vixSentiment(vixIdx?.price ?? null, t);
  const updLabel  = lastRefresh ? timeAgo(lastRefresh, t) : null;

  if (!indices.length) return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>{t("homeMarketOverview.markets")}</p>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
        {[1,2,3,4,5].map(i => <SkeletonCard key={i} />)}
      </div>
    </div>
  );

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            {t("homeMarketOverview.markets")}
          </p>
          {updLabel && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{ background: "var(--raised)", color: "var(--dim)" }}>
              {updLabel}
            </span>
          )}
        </div>

        {/* Period toggle */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ background: "var(--raised)" }}>
          {PERIODS.map(({ key, label }) => (
            <button key={key} onClick={() => setPeriod(key)}
                    className="px-2.5 py-1 rounded-md text-[10px] font-bold transition-all"
                    style={{
                      background: period === key ? "var(--card)" : "transparent",
                      color:      period === key ? "var(--text)" : "var(--dim)",
                      boxShadow:  period === key ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
                    }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cards ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none" style={{ scrollSnapType: "x mandatory" }}>
        {indices.map(idx => (
          <IndexCard
            key={idx.symbol}
            idx={idx}
            prices={charts[idx.symbol] ?? []}
            loading={chartLoading}
            isBest={best?.symbol === idx.symbol}
            period={period}
            periods={PERIODS}
            t={t}
          />
        ))}
      </div>

      {/* ── VIX Sentiment ──────────────────────────────────────────────────── */}
      {vixIdx?.price != null && (
        <div className="mt-2.5 px-3 py-2 rounded-xl flex items-center gap-3"
             style={{ background: `${sentiment.color}0d`, border: `1px solid ${sentiment.color}25` }}>
          <div className="shrink-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              {t("homeMarketOverview.sentiment")}
            </p>
            <p className="text-xs font-black mt-0.5" style={{ color: sentiment.color }}>
              {sentiment.label}
            </p>
          </div>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
            <div className="h-full rounded-full transition-all duration-500"
                 style={{ width: `${sentiment.bar}%`, background: sentiment.color }} />
          </div>
          <p className="text-[10px] shrink-0" style={{ color: "var(--dim)", maxWidth: 160, textAlign: "right" }}>
            VIX {vixIdx.price.toFixed(2)} · {sentiment.desc}
          </p>
        </div>
      )}
    </div>
  );
}
