import React, { useEffect, useCallback, useState } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
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
  "^DJI":  "Dow Jones",
  "^RUT":  "Russell 2000",
  "^VIX":  "VIX",
};

const REFRESH = 60_000;

function fmt(price: number, symbol: string): string {
  if (symbol === "^VIX") return price.toFixed(2);
  return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function IndexChip({
  d,
  colors,
  isLast,
}: {
  d: IndexData;
  colors: ReturnType<typeof useTheme>["colors"];
  isLast: boolean;
}) {
  const isVix = d.symbol === "^VIX";
  const up    = d.change >= 0;
  const color = isVix ? colors.textSub : up ? "#22c55e" : "#ef4444";
  const bg    = isVix
    ? "transparent"
    : up
    ? "rgba(34,197,94,0.08)"
    : "rgba(239,68,68,0.08)";

  return (
    <View style={[styles.chip, { borderColor: colors.border, marginRight: isLast ? 0 : 8, backgroundColor: bg }]}>
      <Text style={[styles.chipName, { color: colors.textMuted }]}>{SHORT[d.symbol] ?? d.name}</Text>
      {d.price !== null ? (
        <View style={styles.chipRight}>
          <Text style={[styles.chipPrice, { color: colors.text }]}>{fmt(d.price, d.symbol)}</Text>
          <Text style={[styles.chipChange, { color }]}>
            {!isVix && (up ? "▲" : "▼")}{Math.abs(d.change_pct).toFixed(2)}%
          </Text>
        </View>
      ) : (
        <Text style={[styles.chipPrice, { color: colors.textDim }]}>—</Text>
      )}
    </View>
  );
}

export default function MarketTicker() {
  const { colors, isDark } = useTheme();
  const [data, setData]       = useState<IndexData[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await marketApi.getIndices();
      setData(res.data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH);
    return () => clearInterval(id);
  }, []);

  const bg = isDark ? "#0a0e17" : "#f1f5f9";

  return (
    <View style={[styles.container, { backgroundColor: bg, borderBottomColor: colors.border }]}>
      {loading || data.length === 0 ? (
        <Text style={[styles.placeholder, { color: colors.textDim }]}>Cargando mercados…</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          bounces={false}
        >
          {data.map((d, i) => (
            <IndexChip key={d.symbol} d={d} colors={colors} isLast={i === data.length - 1} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
  },
  scroll: {
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipName: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  chipRight: {
    alignItems: "flex-end",
    gap: 1,
  },
  chipPrice: {
    fontSize: 12,
    fontWeight: "700",
  },
  chipChange: {
    fontSize: 10,
    fontWeight: "600",
  },
  placeholder: {
    fontSize: 11,
    paddingHorizontal: 16,
  },
});
