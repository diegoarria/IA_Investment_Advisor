import React from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
import Svg, { Circle, Rect, Text as SvgText } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Analyst } from "../../hooks/useStockDetail";

const { width: SCREEN_W } = Dimensions.get("window");
const RANGE_W = SCREEN_W - 32 - 36;

const D = {
  bg:     "#0a0d12",
  card:   "#111318",
  raised: "#1a1d27",
  border: "#1f2330",
  text:   "#fff",
  sub:    "#9ca3af",
  muted:  "#6b7280",
  dim:    "#4b5563",
  green:  "#00d47e",
  red:    "#ef4444",
  amber:  "#f59e0b",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

type ConsensusKey = "strongBuy" | "strongSell" | "buy" | "sell" | "neutral" | "noData";

function consensusKey(rec?: string | null): ConsensusKey {
  if (!rec) return "noData";
  const r = rec.toLowerCase();
  if (r.includes("strong_buy") || r.includes("strongbuy"))   return "strongBuy";
  if (r.includes("strong_sell") || r.includes("strongsell")) return "strongSell";
  if (r.includes("buy"))  return "buy";
  if (r.includes("sell")) return "sell";
  return "neutral";
}

function consensusColor(key: ConsensusKey): string {
  if (key === "strongBuy")  return D.green;
  if (key === "buy")        return "#22c55e";
  if (key === "strongSell") return D.red;
  if (key === "sell")       return "#f97316";
  return D.amber;
}

function fmtPrice(p?: number | null): string {
  if (p == null) return "—";
  return p >= 1000 ? `$${p.toFixed(0)}` : `$${p.toFixed(2)}`;
}

// ─── Rating Row ───────────────────────────────────────────────────────────────

function RatingRow({
  label, count, total, color, isTop = false,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  isTop?: boolean;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <View style={rr.row}>
      <Text style={rr.label}>{label}</Text>
      <View style={rr.barTrack}>
        <View style={[rr.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[rr.count, { color: count > 0 ? D.sub : D.dim }]}>{count}</Text>
      {pct > 0 && (
        <View style={[rr.pctBadge, { backgroundColor: color + "18" }]}>
          <Text style={[rr.pctText, { color }]}>{pct.toFixed(0)}%</Text>
        </View>
      )}
    </View>
  );
}

const rr = StyleSheet.create({
  row:      { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
  label:    { fontSize: 12, fontFamily: "DMSans_500Medium", color: D.sub, width: 90 },
  barTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: D.border, overflow: "hidden" },
  barFill:  { height: 7, borderRadius: 4 },
  count:    { fontSize: 13, fontFamily: "DMSans_700Bold", width: 22, textAlign: "right" },
  pctBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, minWidth: 36, alignItems: "center" },
  pctText:  { fontSize: 10, fontFamily: "DMSans_700Bold" },
});

// ─── Price Target SVG ────────────────────────────────────────────────────────

function PriceTargetBar({
  low, mean, high, current,
}: {
  low: number; mean: number; high: number; current: number;
}) {
  const { t } = useTranslation();
  const range = high - low || 1;
  const toX = (p: number) => Math.max(0, Math.min(((p - low) / range) * RANGE_W, RANGE_W));

  const xLow  = toX(low);
  const xHigh = toX(high);
  const xMean = toX(mean);
  const xCur  = toX(current);

  const upside = current > 0 ? ((mean - current) / current) * 100 : 0;
  const isUp   = upside >= 0;
  const col    = isUp ? "#22c55e" : D.red;

  return (
    <View>
      <View style={pt.headline}>
        <View>
          <Text style={pt.targetPrice}>{fmtPrice(mean)}</Text>
          <Text style={pt.targetLabel}>{t("stockAnalysts.targetPriceLabel")}</Text>
        </View>
        <View style={[pt.upsidePill, { backgroundColor: col + "18", borderColor: col + "30" }]}>
          <Text style={[pt.upsidePct, { color: col }]}>
            {isUp ? "+" : ""}{upside.toFixed(1)}%
          </Text>
          <Text style={[pt.upsideLabel, { color: col, opacity: 0.7 }]}>{t("stockAnalysts.potential")}</Text>
        </View>
      </View>

      <Svg width={RANGE_W} height={48} style={{ marginTop: 12 }}>
        {/* Track */}
        <Rect x={xLow} y={20} width={xHigh - xLow} height={5} rx={2.5} fill={D.border} />
        {/* Highlighted zone */}
        <Rect
          x={Math.min(xCur, xMean)} y={20}
          width={Math.abs(xMean - xCur)} height={5}
          rx={2.5} fill={col} opacity={0.3}
        />
        {/* Low dot */}
        <Circle cx={xLow} cy={22.5} r={4} fill={D.dim} />
        {/* High dot */}
        <Circle cx={xHigh} cy={22.5} r={4} fill={D.dim} />
        {/* Current */}
        <Circle cx={xCur} cy={22.5} r={7} fill={D.card} stroke={D.text} strokeWidth={2} />
        {/* Mean target */}
        <Circle cx={xMean} cy={22.5} r={7} fill={col} />
        {/* Labels */}
        <SvgText x={xLow} y={46} textAnchor="middle" fontSize={9} fill={D.dim} fontWeight="600">{fmtPrice(low)}</SvgText>
        <SvgText x={xCur} y={46} textAnchor="middle" fontSize={9} fill={D.text} fontWeight="700">{fmtPrice(current)}</SvgText>
        <SvgText x={xMean} y={46} textAnchor="middle" fontSize={9} fill={col} fontWeight="700">{fmtPrice(mean)}</SvgText>
        <SvgText x={xHigh} y={46} textAnchor="middle" fontSize={9} fill={D.dim} fontWeight="600">{fmtPrice(high)}</SvgText>
      </Svg>

      <View style={pt.legend}>
        <View style={pt.legendItem}>
          <View style={[pt.dot, { backgroundColor: D.card, borderWidth: 2, borderColor: D.text }]} />
          <Text style={pt.legendText}>{t("stockAnalysts.legend.current")}</Text>
        </View>
        <View style={pt.legendItem}>
          <View style={[pt.dot, { backgroundColor: col }]} />
          <Text style={pt.legendText}>{t("stockAnalysts.legend.analystTarget")}</Text>
        </View>
      </View>

      <View style={pt.statsRow}>
        {[
          { label: t("stockAnalysts.stats.low"),    value: fmtPrice(low),  color: D.sub },
          { label: t("stockAnalysts.stats.target"), value: fmtPrice(mean), color: col },
          { label: t("stockAnalysts.stats.high"),   value: fmtPrice(high), color: D.sub },
        ].map((item) => (
          <View key={item.label} style={pt.statCell}>
            <Text style={pt.statLabel}>{item.label}</Text>
            <Text style={[pt.statValue, { color: item.color }]}>{item.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const pt = StyleSheet.create({
  headline:    { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  targetPrice: { fontSize: 26, fontFamily: "DMSans_800ExtraBold", color: D.text, letterSpacing: -0.5 },
  targetLabel: { fontSize: 11, fontFamily: "DMSans_500Medium", color: D.muted, marginTop: 2 },
  upsidePill:  { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, alignItems: "center" },
  upsidePct:   { fontSize: 16, fontFamily: "DMSans_800ExtraBold" },
  upsideLabel: { fontSize: 9, fontFamily: "DMSans_600SemiBold", marginTop: 1 },
  legend:      { flexDirection: "row", gap: 16, marginTop: 10 },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 6 },
  dot:         { width: 9, height: 9, borderRadius: 5 },
  legendText:  { fontSize: 11, fontFamily: "DMSans_500Medium", color: D.muted },
  statsRow:    { flexDirection: "row", justifyContent: "space-around", marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: D.border },
  statCell:    { alignItems: "center", gap: 4 },
  statLabel:   { fontSize: 10, fontFamily: "DMSans_600SemiBold", color: D.muted, textTransform: "uppercase", letterSpacing: 0.3 },
  statValue:   { fontSize: 16, fontFamily: "DMSans_800ExtraBold" },
});

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={c.wrap}>
      <Text style={c.title}>{title}</Text>
      {children}
    </View>
  );
}

const c = StyleSheet.create({
  wrap:  { borderRadius: 20, borderWidth: 1, borderColor: D.border, padding: 18, marginHorizontal: 16, marginBottom: 12, backgroundColor: D.card },
  title: { fontSize: 9, fontFamily: "DMSans_800ExtraBold", letterSpacing: 1, textTransform: "uppercase", color: D.green, marginBottom: 16 },
});

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StockAnalysts({
  analyst,
  currentPrice,
}: {
  analyst: Analyst;
  currentPrice?: number;
}) {
  const { t } = useTranslation();
  const ratings = analyst.ratings ?? { strong_buy: 0, buy: 0, hold: 0, sell: 0, strong_sell: 0 };
  const total   = Object.values(ratings).reduce((s, v) => s + (v ?? 0), 0);

  const priceTarget = analyst.price_target ?? {};
  const hasPriceTarget = priceTarget.low != null && priceTarget.mean != null && priceTarget.high != null;
  const curPrice = currentPrice ?? priceTarget.current ?? 0;

  const cKey   = consensusKey(analyst.recommendation);
  const label  = t(`stockAnalysts.consensus.${cKey}`);
  const cColor = consensusColor(cKey);

  const bullCount = (ratings.strong_buy ?? 0) + (ratings.buy ?? 0);
  const bearCount = (ratings.sell ?? 0) + (ratings.strong_sell ?? 0);
  const bullPct = total > 0 ? Math.round((bullCount / total) * 100) : 0;

  return (
    <View style={{ paddingVertical: 16, gap: 0 }}>

      {/* ── Consenso ── */}
      <Card title={t("stockAnalysts.cardTitle")}>
        {total === 0 ? (
          <Text style={{ color: D.muted, fontSize: 13 }}>{t("stockAnalysts.noAnalystData")}</Text>
        ) : (
          <>
            {/* Hero consensus row */}
            <View style={s.consensusHero}>
              <View style={[s.consensusPill, { backgroundColor: cColor + "18", borderColor: cColor + "35" }]}>
                <View style={[s.consensusDot, { backgroundColor: cColor }]} />
                <Text style={[s.consensusLabel, { color: cColor }]}>{label}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {analyst.n_analysts != null && (
                  <Text style={s.analystCount}>{t("stockAnalysts.analystCount", { count: analyst.n_analysts })}</Text>
                )}
                <Text style={[s.bullPct, { color: cColor }]}>{t("stockAnalysts.bullPct", { pct: bullPct })}</Text>
              </View>
            </View>

            {/* Bull/bear mini bar */}
            <View style={s.bbTrack}>
              <View style={[s.bbBull, { flex: bullPct }]} />
              <View style={[s.bbBear, { flex: 100 - bullPct }]} />
            </View>
            <View style={s.bbLabels}>
              <Text style={{ fontSize: 10, color: D.green, fontFamily: "DMSans_600SemiBold" }}>{t("stockAnalysts.bullLabel", { count: bullCount })}</Text>
              <Text style={{ fontSize: 10, color: D.red, fontFamily: "DMSans_600SemiBold" }}>{t("stockAnalysts.bearLabel", { count: bearCount })}</Text>
            </View>

            <View style={s.barsSection}>
              <RatingRow label={t("stockAnalysts.consensus.strongBuy")}  count={ratings.strong_buy}  total={total} color={D.green} />
              <RatingRow label={t("stockAnalysts.consensus.buy")}        count={ratings.buy}         total={total} color="#22c55e" />
              <RatingRow label={t("stockAnalysts.consensus.neutral")}    count={ratings.hold}        total={total} color={D.amber} />
              <RatingRow label={t("stockAnalysts.consensus.sell")}       count={ratings.sell}        total={total} color="#f97316" />
              <RatingRow label={t("stockAnalysts.consensus.strongSell")} count={ratings.strong_sell} total={total} color={D.red} />
            </View>
          </>
        )}
      </Card>

      {/* ── Precio Objetivo ── */}
      {hasPriceTarget && (
        <Card title={t("stockAnalysts.priceTargetCardTitle")}>
          <PriceTargetBar
            low={priceTarget.low!}
            mean={priceTarget.mean!}
            high={priceTarget.high!}
            current={curPrice}
          />
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  consensusHero:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  consensusPill:  { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  consensusDot:   { width: 7, height: 7, borderRadius: 4 },
  consensusLabel: { fontSize: 15, fontFamily: "DMSans_800ExtraBold" },
  analystCount:   { fontSize: 11, fontFamily: "DMSans_500Medium", color: D.muted },
  bullPct:        { fontSize: 13, fontFamily: "DMSans_700Bold", marginTop: 2 },
  bbTrack:        { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
  bbBull:         { backgroundColor: D.green },
  bbBear:         { backgroundColor: D.red },
  bbLabels:       { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  barsSection:    { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: D.border, paddingTop: 12, gap: 0 },
});
