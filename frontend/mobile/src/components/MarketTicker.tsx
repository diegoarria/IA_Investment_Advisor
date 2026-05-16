import React, { useEffect, useRef, useState, useCallback } from "react";
import { View, Text, Animated, StyleSheet, Easing } from "react-native";
import { marketApi } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

interface IndexData {
  name: string;
  symbol: string;
  price: number | null;
  change: number;
  change_pct: number;
}

const SHORT: Record<string, string> = {
  "^GSPC": "S&P 500",
  "^IXIC": "Nasdaq",
  "^DJI":  "DOW",
  "^RUT":  "Russell",
  "^VIX":  "VIX",
};

const ITEM_W   = 172; // px — wide enough for "DOW 43,250 ▲0.12%"
const SPEED    = 60;  // px per second
const REFRESH  = 60_000;
const COPIES   = 3;   // repeat 3× so it always fills the screen

function fmt(price: number, symbol: string): string {
  if (symbol === "^VIX") return price.toFixed(2);
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TickerItem({ d, colors }: { d: IndexData; colors: ReturnType<typeof useTheme>["colors"] }) {
  const isVix = d.symbol === "^VIX";
  const up    = d.change >= 0;
  const color = isVix ? colors.textSub : up ? "#22c55e" : "#ef4444";

  return (
    <View style={[styles.item, { borderRightColor: colors.border }]}>
      <Text style={[styles.name, { color: colors.textMuted }]}>{SHORT[d.symbol] ?? d.name}</Text>
      {d.price !== null ? (
        <>
          <Text style={[styles.price, { color: colors.text }]}>{fmt(d.price, d.symbol)}</Text>
          <Text style={[styles.change, { color }]}>
            {isVix ? "" : (up ? "▲" : "▼")}{Math.abs(d.change_pct).toFixed(2)}%
          </Text>
        </>
      ) : (
        <Text style={[styles.price, { color: colors.textDim }]}>—</Text>
      )}
    </View>
  );
}

export default function MarketTicker() {
  const { colors, isDark } = useTheme();
  const [data, setData] = useState<IndexData[]>([]);
  const translateX = useRef(new Animated.Value(0)).current;
  const anim       = useRef<Animated.CompositeAnimation | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await marketApi.getIndices();
      setData(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH);
    return () => clearInterval(id);
  }, []);

  // Restart animation whenever data changes (or on first load)
  useEffect(() => {
    if (data.length === 0) return;
    const loopDist = ITEM_W * data.length; // scroll exactly one "copy" then loop
    const duration  = (loopDist / SPEED) * 1000;

    anim.current?.stop();
    translateX.setValue(0);

    anim.current = Animated.loop(
      Animated.timing(translateX, {
        toValue: -loopDist,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.current.start();
    return () => anim.current?.stop();
  }, [data.length]);

  const bg = isDark ? "#0a0e17" : "#f1f5f9";

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: bg, borderBottomColor: colors.border }]}>
        <Text style={[styles.loading, { color: colors.textDim }]}>Cargando mercados…</Text>
      </View>
    );
  }

  // Repeat COPIES times for seamless fill on any screen width
  const items = Array.from({ length: COPIES }, () => data).flat();

  return (
    <View
      style={[styles.container, { backgroundColor: bg, borderBottomColor: colors.border }]}
      pointerEvents="none"
    >
      <Animated.View style={[styles.track, { transform: [{ translateX }] }]}>
        {items.map((d, i) => (
          <TickerItem key={`${d.symbol}-${i}`} d={d} colors={colors} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
  },
  item: {
    width: ITEM_W,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: "100%",
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  name:    { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  price:   { fontSize: 11, fontWeight: "700" },
  change:  { fontSize: 10, fontWeight: "600" },
  loading: { fontSize: 11, paddingHorizontal: 16, lineHeight: 36 },
});
