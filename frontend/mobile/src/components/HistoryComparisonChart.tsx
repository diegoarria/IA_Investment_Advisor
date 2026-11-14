// Nuvos Plus — Fase 9B: la visualización nativa de "Historia" dentro de
// Antes de invertir — dos curvas normalizadas (composición actual vs.
// hipotética), mismo calendario, mismo valor inicial de 100. Reutiliza
// react-native-svg (ya es una dependencia existente, usada en portfolio.tsx
// para su propio gráfico de evolución) — ninguna librería nueva instalada,
// consistente con "priorizar una solución liviana y mantenible". Nunca
// recalcula nada: solo dibuja los puntos REALES que el backend ya
// devolvió, reducidos visualmente por historyChartDownsample.ts (el mismo
// algoritmo puro ya portado de la web, nunca una segunda implementación).
import React, { useState } from "react";
import { View, Text, type LayoutChangeEvent } from "react-native";
import Svg, { Polyline, Line as SvgLine, Text as SvgText } from "react-native-svg";
import { buildDisplaySeries, type HistoryPoint } from "../lib/historyChartDownsample";
import { maxPointsForWidth } from "../lib/chartResolution";
import type { Colors } from "../lib/ThemeContext";

const MUTED = "#8fa3c0"; // composición actual — neutral, nunca verde/rojo de ganancia-pérdida
const GOLD = "#00e887";  // composición hipotética — mismo verde de marca que el resto de la app

const _Y_AXIS_TICK_COUNT = 4;

function buildYAxisTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

export default function HistoryComparisonChart({
  seriesA, seriesB, labelA, labelB, colors, height = 160,
}: {
  seriesA: HistoryPoint[]; seriesB: HistoryPoint[]; labelA: string; labelB: string; colors: Colors; height?: number;
}) {
  const n = Math.min(seriesA.length, seriesB.length);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const onLayout = (e: LayoutChangeEvent) => setMeasuredWidth(e.nativeEvent.layout.width);
  if (n < 2) return null;

  const width = 320; // viewBox lógico — el SVG se escala a measuredWidth vía width="100%"
  const { a, b } = buildDisplaySeries(seriesA, seriesB, maxPointsForWidth(measuredWidth ?? width));
  const leftMargin = 34;
  const plotWidth = width - leftMargin;
  const topMargin = 10;
  const plotHeight = height - topMargin - 20;

  const allValues = [...a.map((p) => p.value), ...b.map((p) => p.value)];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const xFor = (i: number, len: number) => leftMargin + (i / (len - 1)) * plotWidth;
  const yFor = (v: number) => topMargin + plotHeight - ((v - min) / range) * plotHeight;

  const pointsA = a.map((p, i) => `${xFor(i, a.length)},${yFor(p.value)}`).join(" ");
  const pointsB = b.map((p, i) => `${xFor(i, b.length)},${yFor(p.value)}`).join(" ");
  const ticks = buildYAxisTicks(min, max, _Y_AXIS_TICK_COUNT);

  return (
    <View onLayout={onLayout}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((tick, i) => (
          <React.Fragment key={i}>
            <SvgLine x1={leftMargin} x2={width} y1={yFor(tick)} y2={yFor(tick)} stroke={colors.border} strokeWidth={1} />
            <SvgText x={2} y={yFor(tick) + 3} fontSize={8} fill={colors.textMuted}>{tick.toFixed(0)}</SvgText>
          </React.Fragment>
        ))}
        <Polyline points={pointsA} fill="none" stroke={MUTED} strokeWidth={2} />
        <Polyline points={pointsB} fill="none" stroke={GOLD} strokeWidth={2} />
      </Svg>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 6, justifyContent: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 2, backgroundColor: MUTED }} />
          <Text style={{ fontSize: 11, color: colors.textSub }}>{labelA}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <View style={{ width: 10, height: 2, backgroundColor: GOLD }} />
          <Text style={{ fontSize: 11, color: colors.textSub }}>{labelB}</Text>
        </View>
      </View>
    </View>
  );
}
