import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Line,
  Circle,
  ClipPath,
  Rect,
  G,
} from "react-native-svg";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { marketApi } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

// ─── Animated SVG ─────────────────────────────────────────────────────────────
const AnimatedRect = Animated.createAnimatedComponent(Rect);

// ─── Constants ────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get("window");
const H_PAD   = 16;
const CHART_W = SCREEN_W - H_PAD * 2;
const CHART_H = 160;
const PAD_T   = 10;
const PAD_B   = 6;
const DRAW_H  = CHART_H - PAD_T - PAD_B;

const PERIODS = [
  { key: "1d",  label: "1D" },
  { key: "5d",  label: "1S" },
  { key: "1m",  label: "1M" },
  { key: "6m",  label: "6M" },
  { key: "1y",  label: "1A" },
  { key: "5y",  label: "5A" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toY(price: number, minP: number, maxP: number): number {
  const range = maxP - minP || 1;
  return PAD_T + DRAW_H - ((price - minP) / range) * DRAW_H;
}

function buildPaths(prices: number[], minP: number, maxP: number) {
  if (prices.length < 2) return { linePath: "", areaPath: "" };

  const pts = prices.map((p, i) => ({
    x: (i / (prices.length - 1)) * CHART_W,
    y: toY(p, minP, maxP),
  }));

  const linePath = pts
    .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`)
    .join(" ");

  const bottomY = (CHART_H - PAD_B).toFixed(1);
  const areaPath = `${linePath} L${CHART_W.toFixed(1)},${bottomY} L0,${bottomY} Z`;

  return { linePath, areaPath };
}

function fmtDate(ts: string, periodKey: PeriodKey): string {
  try {
    const d = new Date(ts);
    if (periodKey === "1d")
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (periodKey === "5d")
      return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    if (periodKey === "1m" || periodKey === "6m")
      return d.toLocaleDateString([], { month: "short", day: "numeric" });
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return ts;
  }
}

function fmtPrice(p: number): string {
  return p >= 1000 ? `$${p.toFixed(0)}` : `$${p.toFixed(2)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StockChart({ ticker }: { ticker: string }) {
  const { colors } = useTheme();

  const [period, setPeriod]   = useState<PeriodKey>("1y");
  const [prices, setPrices]   = useState<number[]>([]);
  const [timestamps, setTimestamps] = useState<string[]>([]);
  const [livePrice, setLivePrice]   = useState<number | null>(null);
  const [changePct, setChangePct]   = useState<number>(0);
  const [name, setName]       = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  const [tooltip, setTooltip] = useState<{
    price: number; ts: string; x: number; y: number;
  } | null>(null);

  // ── Fetch chart data ──
  const load = useCallback(
    async (p: PeriodKey) => {
      setLoading(true);
      setError(false);
      try {
        const res = await marketApi.getChart(ticker, p);
        const d = res.data;
        if (d?.prices?.length > 1) {
          setPrices(d.prices);
          setTimestamps(d.timestamps ?? []);
          setLivePrice(d.current_price ?? null);
          setChangePct(d.change_pct ?? 0);
          setName(d.name ?? "");
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [ticker],
  );

  useEffect(() => { load(period); }, [ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived values ──
  const minP = useMemo(() => (prices.length ? Math.min(...prices) : 0), [prices]);
  const maxP = useMemo(() => (prices.length ? Math.max(...prices) : 1), [prices]);
  const { linePath, areaPath } = useMemo(() => buildPaths(prices, minP, maxP), [prices, minP, maxP]);

  const openPrice  = prices[0] ?? 0;
  const lastPrice  = livePrice ?? prices[prices.length - 1] ?? 0;
  const isPositive = (tooltip?.price ?? lastPrice) >= openPrice;
  const lineColor  = isPositive ? "#22c55e" : "#ef4444";

  // ── Line-draw animation ──
  const clipW = useSharedValue(0);

  useEffect(() => {
    if (prices.length < 2 || loading) return;
    clipW.value = 0;
    clipW.value = withTiming(CHART_W + 20, {
      duration: 700,
      easing: Easing.out(Easing.cubic),
    });
  }, [prices, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const animatedClipProps = useAnimatedProps(() => ({
    width: clipW.value,
  }));

  // ── Pan gesture (crosshair tooltip) ──
  const updateTooltip = useCallback(
    (rawX: number) => {
      if (prices.length < 2) return;
      const x    = Math.max(0, Math.min(rawX, CHART_W));
      const idx  = Math.round((x / CHART_W) * (prices.length - 1));
      const safe = Math.max(0, Math.min(idx, prices.length - 1));
      setTooltip({
        price: prices[safe],
        ts:    timestamps[safe] ?? "",
        x,
        y:     toY(prices[safe], minP, maxP),
      });
    },
    [prices, timestamps, minP, maxP],
  );

  const clearTooltip = useCallback(() => setTooltip(null), []);

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e)  => runOnJS(updateTooltip)(e.x))
    .onUpdate((e) => runOnJS(updateTooltip)(e.x))
    .onEnd(()     => runOnJS(clearTooltip)())
    .onFinalize(() => runOnJS(clearTooltip)());

  // ── Display values ──
  const displayPrice  = tooltip?.price ?? lastPrice;
  const displayChange = openPrice > 0 ? displayPrice - openPrice : 0;
  const displayPct    = openPrice > 0 ? (displayChange / openPrice) * 100 : changePct;
  const displayIsPos  = displayChange >= 0;
  const displayColor  = displayIsPos ? "#22c55e" : "#ef4444";

  const hasData = !loading && !error && prices.length >= 2;

  const TOOLTIP_BOX_W  = 108;
  const tooltipBoxLeft = tooltip
    ? Math.max(0, Math.min(tooltip.x - TOOLTIP_BOX_W / 2, CHART_W - TOOLTIP_BOX_W))
    : 0;
  const tooltipBoxTop  = tooltip ? Math.max(2, tooltip.y - 44) : 0;

  const safeId = ticker.replace(/[^a-zA-Z0-9]/g, "_");

  const handlePeriodChange = (p: PeriodKey) => {
    setPeriod(p);
    load(p);
  };

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={[s.ticker, { color: colors.text }]}>{ticker}</Text>
          {name ? (
            <Text style={[s.name, { color: colors.textMuted }]} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </View>
        <View style={s.headerRight}>
          <Text style={[s.price, { color: colors.text }]}>
            {fmtPrice(displayPrice)}
          </Text>
          <View style={s.changeRow}>
            <Text style={[s.changeText, { color: displayColor }]}>
              {displayIsPos ? "+" : "−"}${Math.abs(displayChange).toFixed(2)}
            </Text>
            <Text style={[s.changeText, { color: displayColor }]}>
              {"  "}{displayIsPos ? "+" : ""}{displayPct.toFixed(2)}%
            </Text>
          </View>
          {tooltip ? (
            <Text style={[s.dateLabel, { color: colors.textMuted }]}>
              {fmtDate(tooltip.ts, period)}
            </Text>
          ) : (
            <Text style={[s.dateLabel, { color: "transparent" }]}>{"​"}</Text>
          )}
        </View>
      </View>

      {/* ── Chart ── */}
      <View style={s.chartWrap}>
        {!hasData ? (
          <View style={s.centered}>
            {loading ? (
              <ActivityIndicator color={lineColor} size="small" />
            ) : (
              <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                {error ? "No se pudieron cargar los datos" : "Sin datos"}
              </Text>
            )}
          </View>
        ) : (
          <GestureDetector gesture={gesture}>
            <Animated.View>
              <Svg width={CHART_W} height={CHART_H}>
                <Defs>
                  <LinearGradient id={`grad_${safeId}`} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0%"   stopColor={lineColor} stopOpacity="0.28" />
                    <Stop offset="100%" stopColor={lineColor} stopOpacity="0.00" />
                  </LinearGradient>
                  <ClipPath id={`clip_${safeId}`}>
                    <AnimatedRect
                      animatedProps={animatedClipProps}
                      x="0"
                      y="-10"
                      height={CHART_H + 20}
                    />
                  </ClipPath>
                </Defs>

                <G clipPath={`url(#clip_${safeId})`}>
                  <Path d={areaPath} fill={`url(#grad_${safeId})`} />
                  <Path
                    d={linePath}
                    stroke={lineColor}
                    strokeWidth={1.8}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </G>

                {tooltip && (
                  <>
                    <Line
                      x1={tooltip.x} y1={0}
                      x2={tooltip.x} y2={CHART_H}
                      stroke={colors.textMuted}
                      strokeWidth={1}
                      strokeDasharray="4 3"
                      opacity={0.5}
                    />
                    <Circle cx={tooltip.x} cy={tooltip.y} r={9}   fill={lineColor} opacity={0.2} />
                    <Circle cx={tooltip.x} cy={tooltip.y} r={4.5} fill={lineColor} />
                  </>
                )}
              </Svg>

              {tooltip && (
                <View
                  style={[
                    s.tooltipCard,
                    { backgroundColor: "#1c2128", left: tooltipBoxLeft, top: tooltipBoxTop },
                  ]}
                >
                  <Text style={s.tooltipPrice}>{fmtPrice(tooltip.price)}</Text>
                  <Text style={s.tooltipDate}>{fmtDate(tooltip.ts, period)}</Text>
                </View>
              )}
            </Animated.View>
          </GestureDetector>
        )}
      </View>

      {/* ── Period Selector ── */}
      <View style={[s.periodRow, { borderTopColor: colors.border }]}>
        {PERIODS.map((p) => {
          const active = p.key === period;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => handlePeriodChange(p.key)}
              style={[s.periodBtn, active && { backgroundColor: lineColor + "22" }]}
              activeOpacity={0.7}
            >
              <Text style={[s.periodText, { color: active ? lineColor : colors.textMuted }]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingTop: 14,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: H_PAD,
    paddingBottom: 10,
  },
  headerLeft:  { flex: 1, minWidth: 0 },
  headerRight: { alignItems: "flex-end" },
  ticker: { fontSize: 16, fontWeight: "800" },
  name:   { fontSize: 11, marginTop: 2 },
  price:  { fontSize: 22, fontWeight: "700", letterSpacing: -0.5 },
  changeRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  changeText: { fontSize: 13, fontWeight: "600" },
  dateLabel:  { fontSize: 11, marginTop: 2 },
  chartWrap: {
    paddingHorizontal: H_PAD,
    height: CHART_H,
    overflow: "visible",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  tooltipCard: {
    position: "absolute",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    width: 108,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 7,
  },
  tooltipPrice: { color: "#ffffff", fontSize: 13, fontWeight: "700" },
  tooltipDate:  { color: "#9ca3af", fontSize: 11, marginTop: 1 },
  periodRow: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 8,
    paddingHorizontal: H_PAD,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  periodBtn:  { flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 8 },
  periodText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
});
