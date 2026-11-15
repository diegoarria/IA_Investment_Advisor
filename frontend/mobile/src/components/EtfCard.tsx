// Fase 9C §3: tarjeta de ETF reutilizada en Explorador (búsqueda,
// categorías, descubrimiento) y como resumen en el Comparador — mismo
// contrato que frontend/web/src/components/etf/EtfCard.tsx
// (GET /api/etf/cards). Una tarjeta "no disponible" se muestra
// atenuada con su propio mensaje, nunca desaparece de la lista
// (backend/app/api/routes/etf.py nunca elimina un ticker pedido).
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import StockAvatar from "./StockAvatar";
import { costTierColor, formatWeightPct } from "../lib/etfFormat";
import { useTheme, type Colors } from "../lib/ThemeContext";

export type EtfCardData = {
  ticker: string;
  name?: string | null;
  short_description?: string | null;
  has_editorial_description?: boolean;
  dominant_sector?: string | null;
  expense_ratio_pct?: number | null;
  cost_tier?: string | null;
  etf_company?: string | null;
  unavailable_fields?: string[];
  available?: boolean;
};

export function EtfCardSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.5 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border }} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ width: "40%", height: 12, borderRadius: 4, backgroundColor: colors.border }} />
          <View style={{ width: "70%", height: 10, borderRadius: 4, backgroundColor: colors.border }} />
        </View>
      </View>
    </View>
  );
}

export default function EtfCard({ card, onPress }: { card: EtfCardData; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const na = t("etf.detail.notAvailable");

  if (card.available === false) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.55 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <StockAvatar ticker={card.ticker} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.text }}>{card.ticker}</Text>
            <Text style={{ fontSize: 11.5, color: colors.textMuted }} numberOfLines={2}>
              {t("etf.explorer.cardUnavailable")}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <StockAvatar ticker={card.ticker} size={36} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "800", color: colors.text }}>{card.ticker}</Text>
            {!!card.cost_tier && (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: `${costTierColor(card.cost_tier)}22` }}>
                <Text style={{ fontSize: 9.5, fontWeight: "700", color: costTierColor(card.cost_tier) }}>
                  {t(`etf.detail.costs.tier.${card.cost_tier}`)}
                </Text>
              </View>
            )}
          </View>
          {/* Paridad Web (2026-11): hasta 2 líneas, nunca 1 — un nombre
              largo como "Vanguard Total International Stock..." ya no se
              corta a mitad de palabra. */}
          {!!card.name && <Text style={{ fontSize: 11.5, color: colors.textSub, marginTop: 1 }} numberOfLines={2}>{card.name}</Text>}
          {card.has_editorial_description && !!card.short_description && (
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }} numberOfLines={2}>{card.short_description}</Text>
          )}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 5 }}>
            <Text style={{ fontSize: 10.5, color: colors.textMuted }}>
              {t("etf.explorer.dominantSectorLabel")}: {card.dominant_sector ?? na}
            </Text>
            <Text style={{ fontSize: 10.5, color: colors.textMuted }}>
              {t("etf.explorer.expenseRatioLabel")}: {formatWeightPct(card.expense_ratio_pct, na)}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 12, borderWidth: 1 },
});
