import React, { useState, useRef } from "react";
import { View, Text, PanResponder } from "react-native";
import Svg, { Path, Line, Circle, Polygon, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { fmtPrice } from "../../lib/types/companyDiagnostic";
import type { CompanyDiagnosticData } from "../../lib/types/companyDiagnostic";

// Mobile mirror of web's FairValueLineChart (CompanyDiagnosticValuationTabs.tsx)
// — same real "Precio real vs. valor razonable" data (data.valuation.
// fairValueChart), same draggable cursor/tooltip UX, just built with
// react-native-svg + PanResponder instead of DOM mouse events (mobile has
// no ValuationTabs screen yet, so this renders as its own standalone card
// — see CompanyDiagnosticCard.tsx). See company_diagnostic_service.py /
// price_history_context_service.compute_fair_value_chart_series for how
// the real fair-value line is reconstructed day by day.

const _GOLD = "#D4A24C";
const _CHART_W = 1000;
const _CHART_H = 260;
const _CHART_PAD_TOP = 14;
const _CHART_PAD_BOTTOM = 26;
const _SCENARIO_BULL = "#4FA695";
const _SCENARIO_BEAR = "#DD6E63";

function _chartPointsFor(values: number[], min: number, max: number): { x: number; y: number }[] {
  const range = max - min || 1;
  const usableH = _CHART_H - _CHART_PAD_TOP - _CHART_PAD_BOTTOM;
  return values.map((v, i) => ({
    x: values.length > 1 ? (i / (values.length - 1)) * _CHART_W : 0,
    y: _CHART_PAD_TOP + usableH - ((v - min) / range) * usableH,
  }));
}

function _chartSmoothPath(points: { x: number; y: number }[]): string {
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

const _MONTH_ABBR: Record<"es" | "en", string[]> = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
};

function _monthYearLabel(dateStr: string, lang: string): string {
  const [y, m] = dateStr.split("-");
  const abbr = _MONTH_ABBR[lang.startsWith("en") ? "en" : "es"][Number(m) - 1];
  return `${abbr} '${y.slice(2)}`;
}

function _fullDateLabel(dateStr: string, lang: string): string {
  const [y, m, d] = dateStr.split("-");
  const abbr = _MONTH_ABBR[lang.startsWith("en") ? "en" : "es"][Number(m) - 1];
  return lang.startsWith("en") ? `${abbr} ${Number(d)}, '${y.slice(2)}` : `${Number(d)} ${abbr} '${y.slice(2)}`;
}

export function CompanyDiagnosticFairValueChart({ data, colors }: { data: CompanyDiagnosticData; colors: any }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const chart = data.valuation.fairValueChart;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const layoutWidthRef = useRef(0);

  const points = chart?.points ?? [];

  if (!chart || points.length < 2) return null;

  const prices = points.map((p) => p.price);
  const fairValues = points.map((p) => p.fairValue);
  const all = [...prices, ...fairValues];
  const min = Math.min(...all) * 0.94;
  const max = Math.max(...all) * 1.06;

  const pricePts = _chartPointsFor(prices, min, max);
  const fairPts = _chartPointsFor(fairValues, min, max);

  const segmentCheap = points.slice(0, -1).map((_, i) => (prices[i] + prices[i + 1]) / 2 < (fairValues[i] + fairValues[i + 1]) / 2);
  const segments: { pointsAttr: string; color: string; key: number }[] = [];
  let runStart = 0;
  for (let i = 1; i <= segmentCheap.length; i++) {
    if (i === segmentCheap.length || segmentCheap[i] !== segmentCheap[runStart]) {
      const runEnd = i;
      const top = pricePts.slice(runStart, runEnd + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      const bottom = fairPts.slice(runStart, runEnd + 1).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).reverse();
      segments.push({ pointsAttr: [...top, ...bottom].join(" "), color: segmentCheap[runStart] ? _SCENARIO_BULL : _SCENARIO_BEAR, key: runStart });
      runStart = i;
    }
  }

  const tickCount = Math.min(6, points.length);
  const tickIdx = Array.from({ length: tickCount }, (_, i) => Math.round((i / (tickCount - 1)) * (points.length - 1)));

  const todayX = pricePts[pricePts.length - 1].x;
  const todayY = pricePts[pricePts.length - 1].y;

  const updateHoverFromLocalX = (localX: number) => {
    const w = layoutWidthRef.current;
    if (!w) return;
    const xFrac = Math.min(1, Math.max(0, localX / w));
    setHoverIdx(Math.round(xFrac * (points.length - 1)));
  };

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => updateHoverFromLocalX(evt.nativeEvent.locationX),
    onPanResponderMove: (evt) => updateHoverFromLocalX(evt.nativeEvent.locationX),
    onPanResponderRelease: () => setHoverIdx(null),
    onPanResponderTerminate: () => setHoverIdx(null),
  });

  const hover = hoverIdx !== null ? points[hoverIdx] : null;
  const hoverPricePt = hoverIdx !== null ? pricePts[hoverIdx] : null;
  const hoverPct = hover ? ((hover.fairValue - hover.price) / hover.fairValue) * 100 : 0;
  const hoverUndervalued = hoverPct >= 0;
  const hoverColor = hoverUndervalued ? _SCENARIO_BULL : _SCENARIO_BEAR;

  // Tooltip x position clamped so it never overflows the card — mirrors
  // web's `Math.min(Math.max(pct, 18), 82)` clamp, in pixel space here.
  const tooltipLeftFrac = hoverPricePt ? Math.min(Math.max(hoverPricePt.x / _CHART_W, 0.18), 0.82) : 0.5;

  return (
    <View style={{ borderRadius: 18, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: 14 }}>
      <Text style={{ fontSize: 10.5, fontWeight: "900", textTransform: "uppercase", color: colors.textMuted, marginBottom: 8 }}>
        {t("companyDiagnostic.priceHistory.chartTitle")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 14, height: 2, backgroundColor: colors.text }} />
          <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textSub }}>{t("companyDiagnostic.priceHistory.legendPrice")}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Svg width={14} height={4}>
            <Line x1="0" y1="2" x2="14" y2="2" stroke={_GOLD} strokeWidth="2" strokeDasharray="3 2.5" />
          </Svg>
          <Text style={{ fontSize: 10, fontWeight: "800", color: colors.textSub }}>{t("companyDiagnostic.priceHistory.legendFairValue")}</Text>
        </View>
      </View>

      <View
        style={{ borderRadius: 14, padding: 6, backgroundColor: colors.bgRaised }}
        onLayout={(e) => {
          layoutWidthRef.current = e.nativeEvent.layout.width;
        }}
        {...responder.panHandlers}
      >
        <Svg width="100%" height={180} viewBox={`0 0 ${_CHART_W} ${_CHART_H}`}>
          {segments.map((s) => (
            <Polygon key={s.key} points={s.pointsAttr} fill={s.color} opacity={0.14} />
          ))}
          <Path d={_chartSmoothPath(fairPts)} fill="none" stroke={_GOLD} strokeWidth={2.5} strokeDasharray="7 5" strokeLinecap="round" />
          <Path d={_chartSmoothPath(pricePts)} fill="none" stroke={colors.text} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <Circle cx={todayX} cy={todayY} r={4} fill={colors.text} />
          {tickIdx.map((idx) => (
            <SvgText
              key={idx}
              x={(idx / (points.length - 1)) * _CHART_W}
              y={_CHART_H - 6}
              fontSize={11}
              fontWeight="700"
              fill={colors.textDim}
              textAnchor={idx === 0 ? "start" : idx === points.length - 1 ? "end" : "middle"}
            >
              {_monthYearLabel(points[idx].date, lang)}
            </SvgText>
          ))}
          {hoverIdx !== null && hoverPricePt && (
            <>
              <Line x1={hoverPricePt.x} y1={_CHART_PAD_TOP} x2={hoverPricePt.x} y2={_CHART_H - _CHART_PAD_BOTTOM} stroke={colors.textDim} strokeWidth={1.5} />
              <Circle cx={hoverPricePt.x} cy={hoverPricePt.y} r={5} fill={hoverColor} stroke={colors.bgRaised} strokeWidth={2} />
            </>
          )}
        </Svg>

        {hoverIdx === null && (
          <View style={{ position: "absolute", top: 10, right: 10, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: colors.text }}>
            <Text style={{ fontSize: 10, fontWeight: "800", color: colors.bg ?? "#0a0f1a" }}>{t("companyDiagnostic.priceHistory.today")}</Text>
          </View>
        )}

        {hoverIdx !== null && hover && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 8,
              left: `${tooltipLeftFrac * 100}%`,
              transform: [{ translateX: -70 }],
              width: 140,
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              shadowColor: "#000",
              shadowOpacity: 0.28,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 6,
            }}
          >
            <Text style={{ fontSize: 10.5, fontWeight: "900", color: colors.text }}>
              {_fullDateLabel(hover.date, lang)}
            </Text>
            <Text style={{ fontSize: 10.5, fontWeight: "900", color: hoverColor, marginTop: 1 }}>
              {Math.abs(Math.round(hoverPct))}% {t(hoverUndervalued ? "companyDiagnostic.priceHistory.hoverUndervalued" : "companyDiagnostic.priceHistory.hoverOvervalued")}
            </Text>
            <Text style={{ fontSize: 9.5, color: colors.textSub, marginTop: 3 }}>
              {t("companyDiagnostic.priceHistory.hoverPrice")} {fmtPrice(hover.price)} · {t("companyDiagnostic.priceHistory.hoverFairValue")} {fmtPrice(hover.fairValue)}
            </Text>
          </View>
        )}
      </View>

      <Text style={{ fontSize: 10, lineHeight: 14.5, color: colors.textDim, marginTop: 8 }}>
        {t("companyDiagnostic.priceHistory.chartDisclaimer", {
          ticker: data.ticker,
          multiple: chart.effectiveMultiple.toFixed(1),
          fairValue: fmtPrice(fairValues[fairValues.length - 1]),
        })}
      </Text>
    </View>
  );
}
