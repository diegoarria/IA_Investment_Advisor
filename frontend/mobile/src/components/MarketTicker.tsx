import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, Animated, StyleSheet, Easing, Platform,
} from "react-native";
import { marketApi } from "../lib/api";
import { useTheme } from "../lib/ThemeContext";

interface IndexData {
  name: string;
  symbol: string;
  price: number | null;
  change: number;
  change_pct: number;
}

const SCROLL_SPEED = 55; // px per second
const ITEM_WIDTH   = 148;
const REFRESH_MS   = 60_000;

function TickerItem({ d, colors }: { d: IndexData; colors: ReturnType<typeof useTheme>["colors"] }) {
  const isVix = d.symbol === "^VIX";
  const up    = d.change >= 0;
  const color = isVix ? colors.textSub : up ? "#22c55e" : "#ef4444";
  const arrow = up ? "▲" : "▼";

  return (
    <View style={[styles.item, { borderRightColor: colors.border }]}>
      <Text style={[styles.name, { color: colors.textDim }]}>{d.name}</Text>
      {d.price !== null ? (
        <>
          <Text style={[styles.price, { color: colors.text }]}>
            {d.symbol === "^VIX"
              ? d.price.toFixed(2)
              : d.price >= 10_000
              ? d.price.toLocaleString("en-US", { maximumFractionDigits: 0 })
              : d.price.toFixed(2)}
          </Text>
          <Text style={[styles.change, { color }]}>
            {isVix ? "" : arrow + " "}
            {Math.abs(d.change_pct).toFixed(2)}%
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
  const [contentWidth, setContentWidth] = useState(0);
  const translateX = useRef(new Animated.Value(0)).current;
  const anim       = useRef<Animated.CompositeAnimation | null>(null);

  const fetch = useCallback(async () => {
    try {
      const res = await marketApi.getIndices();
      setData(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Start / restart the scroll animation whenever contentWidth is known
  useEffect(() => {
    if (contentWidth <= 0) return;
    anim.current?.stop();
    translateX.setValue(0);
    const duration = (contentWidth / 2 / SCROLL_SPEED) * 1000;
    anim.current = Animated.loop(
      Animated.timing(translateX, {
        toValue: -contentWidth / 2,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.current.start();
    return () => anim.current?.stop();
  }, [contentWidth]);

  if (data.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: isDark ? "#0d1117" : "#f8fafc", borderBottomColor: colors.border }]}>
        <Text style={[styles.loading, { color: colors.textDim }]}>Cargando mercados…</Text>
      </View>
    );
  }

  // Duplicate for seamless loop
  const doubled = [...data, ...data];

  return (
    <View
      style={[styles.container, { backgroundColor: isDark ? "#0d1117" : "#f8fafc", borderBottomColor: colors.border }]}
      // On web: allow pointer-events so ticker doesn't block interaction
      pointerEvents="none"
    >
      <Animated.View
        style={[styles.track, { transform: [{ translateX }] }]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w !== contentWidth) setContentWidth(w);
        }}
      >
        {doubled.map((d, i) => (
          <TickerItem key={`${d.symbol}-${i}`} d={d} colors={colors} />
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 38,
    borderBottomWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
  },
  track: {
    flexDirection: "row",
    alignItems: "center",
  },
  item: {
    width: ITEM_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  name:   { fontSize: 11, fontWeight: "600", flex: 0 },
  price:  { fontSize: 11, fontWeight: "700", flex: 0 },
  change: { fontSize: 10, flex: 0 },
  loading: { fontSize: 11, paddingHorizontal: 16 },
});
