import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";
import { useTheme } from "../../lib/ThemeContext";
import type { Analyst } from "../../hooks/useStockDetail";

const { width: SCREEN_W } = Dimensions.get("window");
const RANGE_W = SCREEN_W - 32 - 32; // outer padding + card padding

// ─── Helpers ─────────────────────────────────────────────────────────────────

function consensusLabel(rec?: string | null): string {
  if (!rec) return "Sin datos";
  const r = rec.toLowerCase();
  if (r.includes("strong_buy") || r.includes("strongbuy"))   return "Compra Fuerte";
  if (r.includes("strong_sell") || r.includes("strongsell")) return "Venta Fuerte";
  if (r.includes("buy"))  return "Comprar";
  if (r.includes("sell")) return "Vender";
  return "Neutral";
}

function consensusColor(label: string, colors: ReturnType<typeof useTheme>["colors"]): string {
  if (label.includes("Fuerte")) return label.includes("Compra") ? colors.up : colors.down;
  if (label === "Comprar") return colors.up;
  if (label === "Vender")  return colors.down;
  return colors.warning;
}

function fmtPrice(p?: number | null): string {
  if (p == null) return "—";
  return p >= 1000 ? `$${p.toFixed(0)}` : `$${p.toFixed(2)}`;
}

// ─── Rating Bar ───────────────────────────────────────────────────────────────

function RatingBar({
  label,
  count,
  total,
  color,
  textColor,
  bgColor,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  textColor: string;
  bgColor: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={rb.row}>
      <Text style={[rb.label, { color: textColor }]}>{label}</Text>
      <View style={[rb.track, { backgroundColor: bgColor }]}>
        <View style={[rb.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={[rb.count, { color: textColor }]}>{count}</Text>
      <Text style={[rb.pct, { color: textColor, opacity: 0.6 }]}>
        {pct.toFixed(0)}%
      </Text>
    </View>
  );
}

const rb = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 5,
  },
  label: { fontSize: 12, fontWeight: "500", width: 88 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill:  { height: 6, borderRadius: 3 },
  count: { fontSize: 12, fontWeight: "700", width: 26, textAlign: "right" },
  pct:   { fontSize: 11, width: 32, textAlign: "right" },
});

// ─── Price Target SVG ────────────────────────────────────────────────────────

function PriceTargetBar({
  low,
  mean,
  high,
  current,
  colors,
}: {
  low: number;
  mean: number;
  high: number;
  current: number;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const range = high - low || 1;
  const toX = (p: number) => Math.max(0, Math.min(((p - low) / range) * RANGE_W, RANGE_W));

  const xLow  = toX(low);
  const xHigh = toX(high);
  const xMean = toX(mean);
  const xCur  = toX(current);

  const upside = current > 0 ? ((mean - current) / current) * 100 : 0;
  const isUp   = upside >= 0;

  return (
    <View>
      {/* Upside headline */}
      <View style={pt.headline}>
        <View>
          <Text style={[pt.targetPrice, { color: colors.text }]}>{fmtPrice(mean)}</Text>
          <Text style={[pt.targetLabel, { color: colors.textMuted }]}>Precio objetivo</Text>
        </View>
        <View style={[pt.upsidePill, { backgroundColor: isUp ? `${colors.up}20` : `${colors.down}20` }]}>
          <Text style={[pt.upsidePct, { color: isUp ? colors.up : colors.down }]}>
            {isUp ? "+" : ""}{upside.toFixed(1)}% potencial
          </Text>
        </View>
      </View>

      {/* SVG range bar */}
      <Svg width={RANGE_W} height={44} style={{ marginTop: 8 }}>
        {/* Gradient track from low to high */}
        <Rect x={xLow} y={18} width={xHigh - xLow} height={5} rx={2.5} fill={colors.border} />
        {/* Target zone: current → mean */}
        <Rect
          x={Math.min(xCur, xMean)}
          y={18}
          width={Math.abs(xMean - xCur)}
          height={5}
          rx={2.5}
          fill={isUp ? colors.up : colors.down}
          opacity={0.35}
        />

        {/* Low marker */}
        <Circle cx={xLow} cy={20.5} r={4} fill={colors.textMuted} opacity={0.6} />

        {/* High marker */}
        <Circle cx={xHigh} cy={20.5} r={4} fill={colors.textMuted} opacity={0.6} />

        {/* Current price marker */}
        <Circle cx={xCur} cy={20.5} r={6} fill={colors.card} stroke={colors.text} strokeWidth={2} />

        {/* Mean target marker */}
        <Circle cx={xMean} cy={20.5} r={6} fill={isUp ? colors.up : colors.down} />

        {/* Labels below */}
        {/* Low */}
        <SvgText x={xLow} y={42} textAnchor="middle" fontSize={9} fill={colors.textMuted} fontWeight="600">
          {fmtPrice(low)}
        </SvgText>
        {/* Current */}
        <SvgText x={xCur} y={42} textAnchor="middle" fontSize={9} fill={colors.text} fontWeight="700">
          {fmtPrice(current)}
        </SvgText>
        {/* Mean */}
        <SvgText
          x={xMean}
          y={42}
          textAnchor="middle"
          fontSize={9}
          fill={isUp ? colors.up : colors.down}
          fontWeight="700"
        >
          {fmtPrice(mean)}
        </SvgText>
        {/* High */}
        <SvgText x={xHigh} y={42} textAnchor="middle" fontSize={9} fill={colors.textMuted} fontWeight="600">
          {fmtPrice(high)}
        </SvgText>
      </Svg>

      {/* Legend */}
      <View style={pt.legend}>
        <View style={pt.legendItem}>
          <View style={[pt.legendDot, { backgroundColor: colors.text, borderWidth: 2, borderColor: colors.text }]} />
          <Text style={[pt.legendText, { color: colors.textMuted }]}>Actual</Text>
        </View>
        <View style={pt.legendItem}>
          <View style={[pt.legendDot, { backgroundColor: isUp ? colors.up : colors.down }]} />
          <Text style={[pt.legendText, { color: colors.textMuted }]}>Objetivo</Text>
        </View>
      </View>
    </View>
  );
}

const pt = StyleSheet.create({
  headline: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  targetPrice: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  targetLabel: { fontSize: 11, marginTop: 2 },
  upsidePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  upsidePct:  { fontSize: 13, fontWeight: "700" },
  legend: {
    flexDirection: "row",
    gap: 16,
    marginTop: 6,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11 },
});

// ─── Section Card ─────────────────────────────────────────────────────────────

function Card({ title, children, colors }: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={[card.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[card.title, { color: colors.textMuted }]}>{title}</Text>
      {children}
    </View>
  );
}

const card = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
});

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StockAnalysts({
  analyst,
  currentPrice,
}: {
  analyst: Analyst;
  currentPrice?: number;
}) {
  const { colors } = useTheme();

  const ratings = analyst.ratings ?? { strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0 };
  const total   = Object.values(ratings).reduce((s, v) => s + (v ?? 0), 0);

  const pt = analyst.price_target ?? {};
  const hasPriceTarget = pt.low != null && pt.mean != null && pt.high != null;
  const curPrice = currentPrice ?? pt.current ?? 0;

  const rec    = analyst.recommendation ?? "";
  const label  = consensusLabel(rec);
  const cColor = consensusColor(label, colors);

  return (
    <View style={{ paddingVertical: 12 }}>

      {/* ── Consenso ── */}
      <Card title="CONSENSO DE ANALISTAS" colors={colors}>
        {total === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>Sin datos de analistas</Text>
        ) : (
          <>
            {/* Headline pill */}
            <View style={s.consensusRow}>
              <View style={[s.consensusPill, { backgroundColor: `${cColor}20`, borderColor: `${cColor}40` }]}>
                <Text style={[s.consensusLabel, { color: cColor }]}>{label}</Text>
              </View>
              {analyst.n_analysts != null && (
                <Text style={[s.analystCount, { color: colors.textMuted }]}>
                  {analyst.n_analysts} analistas
                </Text>
              )}
            </View>

            {/* Rating bars */}
            <View style={{ marginTop: 12, gap: 0 }}>
              <RatingBar
                label="Compra Fuerte"
                count={ratings.strong_buy}
                total={total}
                color={colors.up}
                textColor={colors.textSub}
                bgColor={colors.bgRaised}
              />
              <RatingBar
                label="Comprar"
                count={ratings.buy}
                total={total}
                color={`${colors.up}99`}
                textColor={colors.textSub}
                bgColor={colors.bgRaised}
              />
              <RatingBar
                label="Neutral"
                count={ratings.hold}
                total={total}
                color={colors.warning}
                textColor={colors.textSub}
                bgColor={colors.bgRaised}
              />
              <RatingBar
                label="Vender"
                count={ratings.sell}
                total={total}
                color={`${colors.down}99`}
                textColor={colors.textSub}
                bgColor={colors.bgRaised}
              />
              <RatingBar
                label="Venta Fuerte"
                count={ratings.strong_sell}
                total={total}
                color={colors.down}
                textColor={colors.textSub}
                bgColor={colors.bgRaised}
              />
            </View>
          </>
        )}
      </Card>

      {/* ── Precio Objetivo ── */}
      {hasPriceTarget ? (
        <Card title="PRECIO OBJETIVO 12 MESES" colors={colors}>
          <PriceTargetBar
            low={pt.low!}
            mean={pt.mean!}
            high={pt.high!}
            current={curPrice}
            colors={colors}
          />

          {/* Min / Mean / Max table */}
          <View style={[s.ptTable, { borderTopColor: colors.border }]}>
            {[
              { label: "Mínimo",  value: pt.low!,  color: colors.textSub },
              { label: "Promedio", value: pt.mean!, color: colors.up },
              { label: "Máximo",  value: pt.high!, color: colors.textSub },
            ].map((item) => (
              <View key={item.label} style={s.ptCell}>
                <Text style={[s.ptCellLabel, { color: colors.textMuted }]}>{item.label}</Text>
                <Text style={[s.ptCellValue, { color: item.color }]}>{fmtPrice(item.value)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  consensusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  consensusPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  consensusLabel: { fontSize: 14, fontWeight: "800" },
  analystCount:   { fontSize: 12 },
  ptTable: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ptCell:      { alignItems: "center" },
  ptCellLabel: { fontSize: 10, fontWeight: "600", marginBottom: 3 },
  ptCellValue: { fontSize: 15, fontWeight: "800" },
});
