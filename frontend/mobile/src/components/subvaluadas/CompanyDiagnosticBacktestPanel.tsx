import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import Svg, { Path, Line, Circle, Rect, Text as SvgText, G } from "react-native-svg";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { screenerWeeklyApi } from "../../lib/api";
import { SCENARIO_COLOR } from "../../lib/types/companyDiagnostic";

// Mobile mirror of web's ValuationBacktestPanel.tsx ("What $10,000
// became") — same real 5-year equal-weighted-basket data from
// GET /api/market/screener/valuation-backtest, same SVG chart math
// (Catmull-Rom smoothing, badge-collision spreading), rendered with
// react-native-svg instead of a raw <svg>. Ticker-independent — shown
// unconditionally at the bottom of the Oportunidades screen, same as web,
// regardless of loading/error/premium state above it.

const TEAL = SCENARIO_COLOR.bull;
const CORAL = SCENARIO_COLOR.bear;
const MUTED_LINE = "#8891A8";

interface ValuationBacktestData {
  generated_at: number;
  months: string[];
  undervalued_series: number[];
  overvalued_series: number[];
  sp500_series: number[];
  undervalued_return_pct: number;
  overvalued_return_pct: number;
  sp500_return_pct: number;
}

const CHART_W = 1000;
const CHART_H = 420;
const PAD_TOP = 24;
const PAD_BOTTOM = 24;
const PAD_RIGHT = 40;

function pointsFor(series: number[], min: number, max: number): { x: number; y: number }[] {
  const range = max - min || 1;
  const usableH = CHART_H - PAD_TOP - PAD_BOTTOM;
  const usableW = CHART_W - PAD_RIGHT;
  return series.map((v, i) => ({
    x: series.length > 1 ? (i / (series.length - 1)) * usableW : 0,
    y: PAD_TOP + usableH - ((v - min) / range) * usableH,
  }));
}

function smoothPath(points: { x: number; y: number }[]): string {
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
// keeping them as close as possible to each line's real end point.
function spreadBadgeY(rows: { y: number }[], minGap: number): number[] {
  const order = rows.map((r, i) => i).sort((a, b) => rows[a].y - rows[b].y);
  const ys = rows.map((r) => r.y);
  for (let k = 1; k < order.length; k++) {
    const prev = order[k - 1];
    const cur = order[k];
    if (ys[cur] - ys[prev] < minGap) ys[cur] = ys[prev] + minGap;
  }
  return ys;
}

const CACHE_KEY = "valuation_backtest_v1";

export function CompanyDiagnosticBacktestPanel({ colors }: { colors: any }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<ValuationBacktestData | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CACHE_KEY)
      .then((cached) => {
        if (!cached || cancelled) return;
        const parsed = JSON.parse(cached);
        if (parsed?.months?.length > 0) setData(parsed);
      })
      .catch(() => {});
    screenerWeeklyApi.getValuationBacktest()
      .then((res: any) => {
        if (cancelled) return;
        // The endpoint returns {} (never a fabricated placeholder) when the
        // weekly worker hasn't populated the cache yet — never adopt that
        // as `data` (data.months would be undefined) and never persist it
        // over a real cached payload from a previous visit.
        if (res.data?.months?.length > 0) {
          setData(res.data);
          AsyncStorage.setItem(CACHE_KEY, JSON.stringify(res.data)).catch(() => {});
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!data || !data.months || data.months.length === 0) return null;

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
  const rowPoints = rows.map((row) => pointsFor(row.series, min, max));
  const rawEndY = rowPoints.map((pts) => pts[pts.length - 1].y);
  const badgeY = spreadBadgeY(rows.map((_, i) => ({ y: rawEndY[i] })), 36);

  return (
    <View style={{ marginTop: 26 }}>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden", backgroundColor: "#0D1420" }}>
        <View style={{ padding: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, color: "#8891A8" }}>
            {t("subvaluadas.backtest.eyebrow")}
          </Text>
          <Text style={{ fontSize: 16.5, fontWeight: "800", color: "#F5F7FA", marginTop: 3 }}>{t("subvaluadas.backtest.title")}</Text>
        </View>

        <View style={{ paddingHorizontal: 6, paddingBottom: 12 }}>
          <View style={{ width: "100%", aspectRatio: CHART_W / CHART_H }}>
            <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              <Line x1="0" y1={baselineY} x2={usableW} y2={baselineY} stroke="rgba(255,255,255,0.14)" strokeDasharray="4 5" strokeWidth="1" />
              {rows.map((row, i) => (
                <Path
                  key={row.key}
                  d={smoothPath(rowPoints[i])}
                  fill="none"
                  stroke={row.color}
                  strokeWidth="3.5"
                  strokeDasharray={row.dashed ? "7 6" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {rows.map((row, i) => (
                <Circle key={`dot-${row.key}`} cx={rowPoints[i][rowPoints[i].length - 1].x} cy={rawEndY[i]} r="4" fill={row.color} />
              ))}
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
                const tx = Math.min(endX + 14, usableW - badgeW);
                const ty = badgeY[i] - 15;
                return (
                  <G key={`badge-${row.key}`} transform={`translate(${tx}, ${ty})`}>
                    <Rect x="0" y="0" width={badgeW} height="30" rx="15" fill="rgba(10,15,26,0.85)" stroke="rgba(255,255,255,0.12)" />
                    <Circle cx="16" cy="15" r="4" fill={row.color} />
                    <SvgText x={labelX} y="19.5" fontSize="12.5" fontWeight="700" fill="#C7CDDB">{label}</SvgText>
                    <SvgText x={valueX} y="19.5" fontSize="13.5" fontWeight="900" fill="#F5F7FA">{valueText}</SvgText>
                    <Rect x={pctX} y="6" width={pctW} height="18" rx="9" fill={`${row.color}2e`} />
                    <SvgText x={pctX + pctW / 2} y="18.5" fontSize="11" fontWeight="700" fill={row.color} textAnchor="middle">{pctText}</SvgText>
                  </G>
                );
              })}
            </Svg>
          </View>
          <Text style={{ fontSize: 10, textAlign: "right", marginTop: 2, color: "#5C6478" }}>{lastMonthLabel}</Text>
        </View>
      </View>

      <Text style={{ fontSize: 11, lineHeight: 16, marginTop: 10, color: colors.textMuted }}>
        {t("subvaluadas.backtest.disclaimer")}
      </Text>
    </View>
  );
}
