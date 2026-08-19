import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { savedValuationsApi } from "../lib/api";
import StockAvatar from "./StockAvatar";

interface SavedValuation {
  ticker: string;
  company_name: string | null;
  target_margin_of_safety_pct: number | null;
  margin_of_safety_pct: number | null;
  stale: boolean;
}

function MarginBadge({ pct }: { pct: number | null }) {
  const { t } = useTranslation();
  if (pct === null) {
    return <Text style={{ fontSize: 10, color: "#8892a0" }}>{t("profile.savedValuations.noData")}</Text>;
  }
  const positive = pct >= 0;
  return (
    <View style={{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: positive ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)" }}>
      <Text style={{ fontSize: 12, fontWeight: "900", color: positive ? "#22c55e" : "#ef4444" }}>
        {positive ? "+" : ""}{pct}%
      </Text>
    </View>
  );
}

export default function SavedValuationsSection() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [items, setItems] = useState<SavedValuation[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    savedValuationsApi.list()
      .then((res: any) => setItems(res.data || []))
      .catch(() => setItems([]));
  }, []);

  const handleDelete = async (ticker: string) => {
    setDeleting(ticker);
    try {
      await savedValuationsApi.remove(ticker);
      setItems((prev) => (prev || []).filter((i) => i.ticker !== ticker));
    } catch {
      // leave it — user can retry
    } finally {
      setDeleting(null);
    }
  };

  if (items === null || items.length === 0) return null;

  return (
    <View style={{ marginTop: 24, paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, color: colors.textMuted, marginBottom: 8 }}>
        {t("profile.savedValuations.title")}
      </Text>
      <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
        {items.map((item, i) => (
          <View key={item.ticker} style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border }}>
            <StockAvatar ticker={item.ticker} size={32} />
            <TouchableOpacity style={{ flex: 1, minWidth: 0 }} onPress={() => router.push(`/subvaluadas?ticker=${item.ticker}` as any)}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.text }} numberOfLines={1}>{item.ticker}</Text>
              <Text style={{ fontSize: 11, color: colors.textMuted }} numberOfLines={1}>
                {item.stale
                  ? `${item.company_name} · ${t("profile.savedValuations.stale")}`
                  : item.margin_of_safety_pct !== null && item.target_margin_of_safety_pct !== null
                    ? t("profile.savedValuations.currentVsTarget", { current: item.margin_of_safety_pct, target: item.target_margin_of_safety_pct })
                    : item.company_name}
              </Text>
            </TouchableOpacity>
            <MarginBadge pct={item.margin_of_safety_pct} />
            <TouchableOpacity onPress={() => handleDelete(item.ticker)} disabled={deleting === item.ticker} style={{ padding: 6, opacity: deleting === item.ticker ? 0.4 : 1 }}>
              <Ionicons name="trash-outline" size={15} color={colors.textDim} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 6 }}>{t("profile.savedValuations.footer")}</Text>
    </View>
  );
}
