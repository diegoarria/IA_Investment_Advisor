import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import Svg, { Path, Defs, LinearGradient, Stop } from "react-native-svg";
import { marketApi } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

const PERIODS = [
  { key: "1d",  label: "1D"  },
  { key: "5d",  label: "5D"  },
  { key: "1m",  label: "1M"  },
  { key: "6m",  label: "6M"  },
  { key: "ytd", label: "YTD" },
  { key: "1y",  label: "1A"  },
  { key: "5y",  label: "5A"  },
  { key: "max", label: "MÁX" },
];

const H = 130;
const PAD = 6;

interface ChartData {
  ticker: string;
  name: string;
  prices: number[];
  current_price: number;
  change_pct: number;
}

function buildPaths(prices: number[], w: number): { line: string; fill: string } {
  if (prices.length < 2) return { line: "", fill: "" };
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => ({
    x: PAD + (i / (prices.length - 1)) * (w - PAD * 2),
    y: PAD + (1 - (p - min) / range) * (H - PAD * 2),
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fill = `${line} L${pts.at(-1)!.x.toFixed(1)},${(H + 2).toFixed(1)} L${pts[0].x.toFixed(1)},${(H + 2).toFixed(1)} Z`;
  return { line, fill };
}

export default function StockChart({ ticker }: { ticker: string }) {
  const { colors } = useTheme();
  const [period, setPeriod]   = useState("1y");
  const [data,   setData]     = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [width,   setWidth]   = useState(320);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await marketApi.getChart(ticker, p);
      if (!res.data.error) setData(res.data);
    } catch {}
    setLoading(false);
  }, [ticker]);

  useEffect(() => { load(period); }, []);

  const handlePeriod = (p: string) => {
    setPeriod(p);
    load(p);
  };

  const isUp    = (data?.change_pct ?? 0) >= 0;
  const accent  = isUp ? "#22c55e" : "#ef4444";
  const gradId  = `grad_${ticker}`;
  const { line, fill } = data ? buildPaths(data.prices, width) : { line: "", fill: "" };

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={[s.tickerLabel, { color: colors.text }]}>{ticker}</Text>
          {data && <Text style={[s.name, { color: colors.textMuted }]} numberOfLines={1}>{data.name}</Text>}
        </View>
        {data && (
          <View style={s.priceBlock}>
            <Text style={[s.price, { color: colors.text }]}>
              ${data.current_price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
            <Text style={[s.change, { color: accent }]}>
              {isUp ? "▲" : "▼"} {Math.abs(data.change_pct).toFixed(2)}%
            </Text>
          </View>
        )}
      </View>

      {/* Chart area */}
      <View
        style={{ height: H }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {loading ? (
          <ActivityIndicator color={accent} style={{ flex: 1 }} />
        ) : data && data.prices.length > 1 ? (
          <Svg width={width} height={H}>
            <Defs>
              <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0"   stopColor={accent} stopOpacity={0.35} />
                <Stop offset="0.7" stopColor={accent} stopOpacity={0.05} />
                <Stop offset="1"   stopColor={accent} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={fill} fill={`url(#${gradId})`} />
            <Path d={line} stroke={accent} strokeWidth={1.8} fill="none" strokeLinejoin="round" />
          </Svg>
        ) : (
          <Text style={[s.noData, { color: colors.textDim }]}>Sin datos</Text>
        )}
      </View>

      {/* Period selector */}
      <View style={[s.periods, { borderTopColor: colors.border }]}>
        {PERIODS.map((p) => {
          const active = period === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => handlePeriod(p.key)}
              style={[s.periodBtn, active && { backgroundColor: accent + "20" }]}
            >
              <Text style={[s.periodText, { color: active ? accent : colors.textMuted }]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: 16, borderWidth: 1,
    padding: 14, marginTop: 10, overflow: "hidden",
  },
  header: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "flex-start", marginBottom: 10,
  },
  tickerLabel: { fontSize: 16, fontWeight: "800" },
  name:  { fontSize: 11, marginTop: 2, maxWidth: 160 },
  priceBlock: { alignItems: "flex-end" },
  price:  { fontSize: 20, fontWeight: "700" },
  change: { fontSize: 13, fontWeight: "600", marginTop: 2 },
  noData: { textAlign: "center", marginTop: 40, fontSize: 13 },
  periods: {
    flexDirection: "row", justifyContent: "space-between",
    marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth,
  },
  periodBtn:  { flex: 1, alignItems: "center", paddingVertical: 5, borderRadius: 6 },
  periodText: { fontSize: 11, fontWeight: "700" },
});
