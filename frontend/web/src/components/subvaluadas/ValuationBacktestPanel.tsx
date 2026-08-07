"use client";

import { useTranslation } from "react-i18next";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { screenerApi } from "@/lib/api";
import { Calculator } from "lucide-react";
import StockAvatar from "@/components/StockAvatar";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { _SCENARIO_COLOR } from "./shared";

// Real brand teal/coral (same as everywhere else this screen uses
// bull/bear) — this card used to hardcode its own slightly-off values
// (#2DD4B0/#E8837A), a real identity leak against the rest of /subvaluadas.
const TEAL = _SCENARIO_COLOR.bull;
const CORAL = _SCENARIO_COLOR.bear;
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
const CHART_H = 420;
const PAD_TOP = 24;
const PAD_BOTTOM = 24;
const PAD_RIGHT = 40; // room for the line to breathe before the floating badges

function _pointsFor(series: number[], min: number, max: number): { x: number; y: number }[] {
  const range = max - min || 1;
  const usableH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const usableW = CHART_W - PAD_RIGHT;
  return series.map((v, i) => ({
    x: series.length > 1 ? (i / (series.length - 1)) * usableW : 0,
    y: PAD_TOP + usableH - ((v - min) / range) * usableH,
  }));
}

// Catmull-Rom -> cubic Bézier conversion, so the real monthly data points
// (still real, still exactly where they should be) render as a smooth
// curve instead of a jagged polyline — purely a rendering choice, the
// underlying values are untouched.
function _smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function fmtMoney(v: number): string {
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
}

// Pushes overlapping badge y-positions apart (min vertical gap) while
// keeping them as close as possible to each line's real end point —
// otherwise two lines ending near the same value render overlapping pills.
function _spreadBadgeY(rows: { y: number }[], minGap: number): number[] {
  const order = rows.map((r, i) => i).sort((a, b) => rows[a].y - rows[b].y);
  const ys = rows.map((r) => r.y);
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (ys[cur] - ys[prev] < minGap) ys[cur] = ys[prev] + minGap;
  }
  return ys;
}

// "What $10,000 became" — a real 5-year equal-weighted-basket comparison
// (see backend/app/services/valuation_backtest_service.py's module
// docstring). Deliberately NOT called a "backtest" anywhere in the copy —
// it applies TODAY's real Nuvos classification to 5 real years of prices,
// which is a different (weaker, hindsight-prone) claim than "this signal
// worked 5 years ago," and the disclaimer says so explicitly.
export function ValuationBacktestPanel() {
  const { t, i18n } = useTranslation();
  const { data } = useCachedFetch<ValuationBacktestData>({
    key: "valuation_backtest_v1",
    fetcher: async () => (await screenerApi.getValuationBacktest()).data,
    isEmpty: (d) => !d || !d.months || d.months.length === 0,
  });

  if (!data || data.months.length === 0) return null;

  const all = [...data.undervalued_series, ...data.overvalued_series, ...data.sp500_series];
  const min = Math.min(...all) * 0.92;
  const max = Math.max(...all) * 1.08;

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

  const usableH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const usableW = CHART_W - PAD_RIGHT;
  const baselineY = PAD_TOP + usableH - ((10000 - min) / (max - min || 1)) * usableH;
  const rowPoints = rows.map((row) => _pointsFor(row.series, min, max));
  const rawEndY = rowPoints.map((pts) => pts[pts.length - 1].y);
  const badgeY = _spreadBadgeY(
    rows.map((_, i) => ({ y: rawEndY[i] })),
    36,
  );

  return (
    <div className="mt-8">
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: "rgba(255,255,255,0.08)", background: "linear-gradient(160deg, #0A0F1A 0%, #0D1420 55%, #10241F 100%)" }}
      >
        <div className="p-5 pb-3">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#8891A8" }}>
            {t("subvaluadas.backtest.eyebrow")}
          </p>
          <p className="text-lg font-bold mt-1" style={{ color: "#F5F7FA" }}>{t("subvaluadas.backtest.title")}</p>
        </div>

        <div className="px-2 sm:px-5 pb-4 relative">
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" style={{ overflow: "visible" }}>
            <line x1="0" y1={baselineY} x2={usableW} y2={baselineY} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 5" strokeWidth="1" />
            {rows.map((row, i) => (
              <path
                key={row.key}
                d={_smoothPath(rowPoints[i])}
                fill="none"
                stroke={row.color}
                strokeWidth="3.5"
                strokeDasharray={row.dashed ? "7 6" : undefined}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {rows.map((row, i) => (
              <circle key={`dot-${row.key}`} cx={rowPoints[i][rowPoints[i].length - 1].x} cy={rawEndY[i]} r="4" fill={row.color} />
            ))}
            {/* Floating badges — dot + label + value + return %, anchored near
                each line's real endpoint, nudged apart only enough to avoid
                overlapping (see _spreadBadgeY). Every segment's width is
                measured from its own text length — a long translated label
                (e.g. Spanish "Comprando infravaloradas") must never overlap
                the value/percent that follow it. */}
            {rows.map((row, i) => {
              const endX = rowPoints[i][rowPoints[i].length - 1].x;
              const label = t(`subvaluadas.backtest.legend.${row.key}`);
              const valueText = fmtMoney(row.series[row.series.length - 1]);
              const pctText = fmtPct(row.returnPct);
              const labelX = 28;
              const labelW = label.length * 7.1;
              const valueX = labelX + labelW + 10;
              const valueW = valueText.length * 8.4;
              const pctX = valueX + valueW + 10;
              const pctW = 52;
              const badgeW = pctX + pctW + 14;
              return (
                <g key={`badge-${row.key}`} transform={`translate(${Math.min(endX + 14, usableW - badgeW)}, ${badgeY[i] - 15})`}>
                  <rect x="0" y="0" width={badgeW} height="30" rx="15" fill="rgba(10,15,26,0.85)" stroke="rgba(255,255,255,0.12)" />
                  <circle cx="16" cy="15" r="4" fill={row.color} />
                  <text x={labelX} y="19.5" fontSize="12.5" fontWeight="700" fill="#C7CDDB">{label}</text>
                  <text x={valueX} y="19.5" fontSize="13.5" fontWeight="900" fill="#F5F7FA">{valueText}</text>
                  <rect x={pctX} y="6" width={pctW} height="18" rx="9" fill={`${row.color}2e`} />
                  <text x={pctX + pctW / 2} y="18.5" fontSize="11" fontWeight="700" fill={row.color} textAnchor="middle">{pctText}</text>
                </g>
              );
            })}
          </svg>

          <p className="text-[10px] text-right mt-1" style={{ color: "#5C6478" }}>{lastMonthLabel}</p>
        </div>
      </div>

      <p className="text-[10.5px] leading-relaxed mt-3 px-1" style={{ color: "var(--muted)" }}>
        {t("subvaluadas.backtest.disclaimer")}
      </p>

      {data.discover_more?.length > 0 && <DiscoverMorePanel candidates={data.discover_more} />}
    </div>
  );
}

function _verdictStyle(verdict: DiscoverCandidate["verdict"]): { bg: string; fg: string } {
  if (verdict === "undervalued") return { bg: "rgba(34,197,94,0.12)", fg: "#16803d" };
  if (verdict === "overvalued") return { bg: "rgba(232,131,122,0.18)", fg: "#b3462f" };
  return { bg: "var(--raised)", fg: "var(--sub)" };
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
    <div className="mt-8">
      <SectionHeader title={t("subvaluadas.backtest.discoverMore")} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
        {candidates.slice(0, 4).map((c) => {
          const { bg, fg } = _verdictStyle(c.verdict);
          return (
            <button key={c.ticker} onClick={() => goToTicker(c.ticker)} className="text-left transition-all duration-200 hover:opacity-90">
              <Card padding="p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: "var(--text)" }}>{c.ticker}</p>
                    <p className="text-[10.5px] truncate" style={{ color: "var(--muted)" }}>{c.company_name ?? c.ticker}</p>
                  </div>
                  <div className="shrink-0"><StockAvatar ticker={c.ticker} size="sm" /></div>
                </div>
                <div className="flex items-center gap-1.5 pt-3 border-t mb-3" style={{ borderColor: "var(--border)" }}>
                  <Calculator className="w-3 h-3 shrink-0" style={{ color: "var(--muted)" }} />
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.backtest.dcfValue")}</span>
                  <span className="text-[12.5px] font-bold tabular-nums ml-auto" style={{ color: "var(--text)" }}>${c.fair_value.toFixed(2)}</span>
                </div>
                <div className="text-center text-[11px] font-bold rounded-lg px-2 py-2" style={{ background: bg, color: fg }}>
                  {t(`subvaluadas.backtest.verdict.${c.verdict}`, { pct: c.pct.toFixed(0) })}
                </div>
              </Card>
            </button>
          );
        })}
      </div>
    </div>
  );
}
