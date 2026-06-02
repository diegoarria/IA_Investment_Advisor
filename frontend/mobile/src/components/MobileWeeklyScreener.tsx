import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ActivityIndicator, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { screenerWeeklyApi } from "../lib/api";

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
  existingTickers?: string[];
}

export default function MobileWeeklyScreener({ isPremium, onUpgrade, existingTickers = [] }: Props) {
  const { colors } = useTheme();
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const s = styles(colors);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    screenerWeeklyApi.getWeekly(existingTickers)
      .then((res: any) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium]);

  if (!isPremium) {
    return (
      <View style={[s.card, { borderColor: colors.border }]}>
        <View style={s.row}>
          <Ionicons name="search-outline" size={16} color={colors.accent} />
          <Text style={[s.title, { color: colors.text }]}>Screener Semanal</Text>
          <View style={[s.badge, { backgroundColor: colors.accent + "20" }]}>
            <Text style={[s.badgeText, { color: colors.accent }]}>PREMIUM</Text>
          </View>
        </View>
        <Text style={[s.desc, { color: colors.textMuted }]}>
          5 oportunidades personalizadas cada lunes según tu perfil y mentor.
        </Text>
        <TouchableOpacity style={[s.btn, { backgroundColor: colors.accent }]} onPress={onUpgrade}>
          <Text style={s.btnText}>Activar Premium</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.card, { borderColor: colors.border }]}>
      <View style={[s.row, { marginBottom: 10 }]}>
        <Ionicons name="search-outline" size={16} color={colors.accent} />
        <Text style={[s.title, { color: colors.text }]}>Screener Semanal</Text>
        {data?.week_theme && (
          <View style={[s.badge, { backgroundColor: colors.accent + "15", marginLeft: 4 }]}>
            <Text style={[s.badgeText, { color: colors.accent }]}>{data.week_theme}</Text>
          </View>
        )}
        {loading && <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: "auto" }} />}
      </View>

      {!loading && data?.picks?.map((pick: any, i: number) => (
        <View key={pick.ticker} style={[s.pickRow, { borderTopColor: colors.border }]}>
          <Text style={[s.rank, { color: colors.textDim }]}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[s.ticker, { color: colors.text }]}>{pick.ticker}</Text>
              <Text style={[s.sector, { color: colors.textMuted }]}>{pick.sector}</Text>
            </View>
            <Text style={[s.why, { color: colors.textSub }]} numberOfLines={2}>{pick.why}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[s.price, { color: colors.text }]}>${pick.price?.toFixed(2) ?? "—"}</Text>
            <Text style={[s.change, { color: (pick.change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }]}>
              {(pick.change_pct ?? 0) >= 0 ? "+" : ""}{pick.change_pct?.toFixed(1) ?? 0}%
            </Text>
          </View>
        </View>
      ))}

      {!loading && !data && (
        <Text style={[s.empty, { color: colors.textMuted }]}>No hay picks disponibles aún.</Text>
      )}
    </View>
  );
}

const styles = (c: any) => StyleSheet.create({
  card:    { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
  row:     { flexDirection: "row", alignItems: "center", gap: 8 },
  title:   { fontSize: 14, fontWeight: "700" },
  desc:    { fontSize: 12, lineHeight: 18, marginVertical: 8 },
  btn:     { borderRadius: 12, paddingVertical: 10, alignItems: "center", marginTop: 4 },
  btnText: { color: "white", fontWeight: "700", fontSize: 13 },
  badge:     { borderRadius: 20, paddingHorizontal: 7, paddingVertical: 2, marginLeft: "auto" },
  badgeText: { fontSize: 9, fontWeight: "800" },
  pickRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  rank:    { fontSize: 11, fontWeight: "800", width: 14, textAlign: "center" },
  ticker:  { fontSize: 14, fontWeight: "800" },
  sector:  { fontSize: 10 },
  why:     { fontSize: 11, marginTop: 2, lineHeight: 15 },
  price:   { fontSize: 13, fontWeight: "700" },
  change:  { fontSize: 10, fontWeight: "700" },
  empty:   { fontSize: 12, textAlign: "center", paddingVertical: 8 },
});
