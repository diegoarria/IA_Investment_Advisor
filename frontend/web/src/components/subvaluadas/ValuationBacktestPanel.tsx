"use client";

import { useTranslation } from "react-i18next";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { screenerApi } from "@/lib/api";

const TEAL = "#4FA695";
const CORAL = "#DD6E63";
const MUTED_LINE = "#8891A8";

interface DiscoverCandidate {
  ticker: string;
  company_name: string | null;
  price: number;
  fair_value: number;
  pct: number;
  verdict: "undervalued" | "overvalued" | "fair";
}

interface ValuationBacktestData {
  generated_at: number;
  months: string[];
  undervalued_series: number[];
  overvalued_series: number[];
  sp500_series: number[];
  undervalued_return_pct: number;
  overvalued_return_pct: number;
  sp500_return_pct: number;
  discover_more: DiscoverCandidate[];
}

const CHART_W = 1000;
const CHART_H = 320;
const PAD_TOP = 16;
const PAD_BOTTOM = 16;

function _buildPoints(series: number[], min: number, max: number): string {
  const range = max - min || 1;
  const usableH = CHART_H - PAD_TOP - PAD_BOTTOM;
  return series
    .map((v, i) => {
      const x = series.length > 1 ? (i / (series.length - 1)) * CHART_W : 0;
      const y = PAD_TOP + usableH - ((v - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function fmtMoney(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

// "What $10,000 became" — a real 5-year equal-weighted-basket comparison
// (see backend/app/services/valuation_backtest_service.py's module
// docstring). Deliberately NOT called a "backtest" anywhere in the copy —
// it applies TODAY's real Nuvos classification to 5 real years of prices,
// which is a different (weaker, hindsight-prone) claim than "this signal
// worked 5 years ago," and the disclaimer below says so explicitly.
export function ValuationBacktestPanel() {
  const { t, i18n } = useTranslation();
  const { data } = useCachedFetch<ValuationBacktestData>({
    key: "valuation_backtest_v1",
    fetcher: async () => (await screenerApi.getValuationBacktest()).data,
    isEmpty: (d) => !d || !d.months || d.months.length === 0,
  });

  if (!data || data.months.length === 0) return null;

  const all = [...data.undervalued_series, ...data.overvalued_series, ...data.sp500_series];
  const min = Math.min(...all) * 0.95;
  const max = Math.max(...all) * 1.05;

  const lastMonth = data.months[data.months.length - 1];
  const [y, m] = lastMonth.split("-").map(Number);
  const lastMonthLabel = new Date(y, m - 1, 1).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", {
    month: "long", year: "numeric",
  });

  const rows: { key: "undervalued" | "sp500" | "overvalued"; color: string; dashed?: boolean; series: number[]; returnPct: number }[] = [
    { key: "undervalued", color: TEAL, series: data.undervalued_series, returnPct: data.undervalued_return_pct },
    { key: "sp500", color: MUTED_LINE, dashed: true, series: data.sp500_series, returnPct: data.sp500_return_pct },
    { key: "overvalued", color: CORAL, series: data.overvalued_series, returnPct: data.overvalued_return_pct },
  ];

  return (
    <div className="rounded-2xl border overflow-hidden mt-8" style={{ borderColor: "rgba(255,255,255,0.08)", background: "#0A0F1A" }}>
      <div className="p-5 pb-3">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#8891A8" }}>
          {t("subvaluadas.backtest.eyebrow")}
        </p>
        <p className="text-lg font-bold mt-1" style={{ color: "#F5F7FA" }}>{t("subvaluadas.backtest.title")}</p>
      </div>

      <div className="px-2 sm:px-5 pb-2 relative">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" preserveAspectRatio="none">
          <line x1="0" y1={CHART_H - PAD_BOTTOM - ((10000 - min) / (max - min || 1)) * (CHART_H - PAD_TOP - PAD_BOTTOM)}
                x2={CHART_W} y2={CHART_H - PAD_BOTTOM - ((10000 - min) / (max - min || 1)) * (CHART_H - PAD_TOP - PAD_BOTTOM)}
                stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" strokeWidth="1" />
          {rows.map((row) => (
            <polyline
              key={row.key}
              points={_buildPoints(row.series, min, max)}
              fill="none"
              stroke={row.color}
              strokeWidth="3"
              strokeDasharray={row.dashed ? "6 6" : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        <div className="flex flex-col gap-1.5 mt-2 mb-1">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: row.color }} />
              <span className="text-[11.5px] font-semibold" style={{ color: "#C7CDDB" }}>
                {t(`subvaluadas.backtest.legend.${row.key}`)}
              </span>
              <span className="text-[12.5px] font-black tabular-nums" style={{ color: "#F5F7FA" }}>
                {fmtMoney(row.series[row.series.length - 1])}
              </span>
              <span
                className="text-[10.5px] font-bold rounded-full px-2 py-0.5 tabular-nums"
                style={{ background: `${row.color}26`, color: row.color }}
              >
                {fmtPct(row.returnPct)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-right pb-2" style={{ color: "#5C6478" }}>{lastMonthLabel}</p>
      </div>

      <p className="px-5 pb-5 text-[10.5px] leading-relaxed" style={{ color: "#7A8296" }}>
        {t("subvaluadas.backtest.disclaimer")}
      </p>

      {data.discover_more?.length > 0 && <DiscoverMorePanel candidates={data.discover_more} />}
    </div>
  );
}

function _verdictColor(verdict: DiscoverCandidate["verdict"]): { bg: string; fg: string } {
  if (verdict === "undervalued") return { bg: "rgba(79,166,149,0.12)", fg: TEAL };
  if (verdict === "overvalued") return { bg: "rgba(221,110,99,0.12)", fg: CORAL };
  return { bg: "rgba(255,255,255,0.06)", fg: "#C7CDDB" };
}

function DiscoverMorePanel({ candidates }: { candidates: DiscoverCandidate[] }) {
  const { t } = useTranslation();

  // Full navigation, not router.push — /subvaluadas only reads its
  // `?ticker=` search param once, at mount (see page.tsx), so pushing a new
  // value while already on this page would silently leave the old ticker
  // displayed. A hard navigation is the simple, correct fix for this one
  // same-page-to-same-page link, without touching that page's existing
  // (separately tested) search-param-handling logic.
  const goToTicker = (ticker: string) => {
    window.location.href = `/subvaluadas?ticker=${encodeURIComponent(ticker)}`;
  };

  return (
    <div className="px-5 pb-5 pt-1 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
      <p className="text-[12px] font-bold mb-3 mt-4" style={{ color: "#F5F7FA" }}>{t("subvaluadas.backtest.discoverMore")}</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {candidates.slice(0, 4).map((c) => {
          const { bg, fg } = _verdictColor(c.verdict);
          return (
            <button
              key={c.ticker}
              onClick={() => goToTicker(c.ticker)}
              className="text-left rounded-xl p-3 transition-colors"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-[13px] font-black" style={{ color: "#F5F7FA" }}>{c.ticker}</p>
              <p className="text-[10px] truncate mb-2" style={{ color: "#7A8296" }}>{c.company_name ?? c.ticker}</p>
              <p className="text-[9.5px]" style={{ color: "#5C6478" }}>{t("subvaluadas.backtest.dcfValue")}</p>
              <p className="text-[12px] font-bold tabular-nums mb-2" style={{ color: "#F5F7FA" }}>${c.fair_value.toFixed(2)}</p>
              <span className="inline-block text-[10px] font-bold rounded-full px-2 py-1" style={{ background: bg, color: fg }}>
                {t(`subvaluadas.backtest.verdict.${c.verdict}`, { pct: c.pct.toFixed(0) })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
