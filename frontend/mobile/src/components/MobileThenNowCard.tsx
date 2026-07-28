import React from "react";
import { View, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";

type GraphNode = {
  event_type: string;
  occurred_at: string;
  payload: Record<string, any>;
};

export type ThenNowData = {
  ticker: string;
  then: GraphNode;
  now: GraphNode;
  reversal_detected: boolean;
  reversal_reason: "sign_flip" | "decision_without_new_thesis" | null;
  days_holding: number | null;
};

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function nodeText(node: GraphNode, t: (k: string, o?: any) => string): string {
  const p = node.payload || {};
  if (node.event_type === "thesis") {
    const parts: string[] = [];
    if (p.margin_of_safety_pct != null) parts.push(t("thenNow.marginOfSafety", { pct: p.margin_of_safety_pct > 0 ? `+${p.margin_of_safety_pct}` : p.margin_of_safety_pct }));
    if (p.price != null) parts.push(t("thenNow.priceThen", { price: p.price }));
    return parts.join(" · ") || t("thenNow.thesisViewed");
  }
  const actionKey = p.action === "buy" ? "thenNow.decisionBuy" : p.action === "sell" ? "thenNow.decisionSell" : "thenNow.decisionOther";
  const parts = [t(actionKey)];
  if (p.price_at_action != null) parts.push(t("thenNow.priceThen", { price: p.price_at_action }));
  return parts.join(" · ");
}

export default function MobileThenNowCard({ data, style }: { data: ThenNowData; style?: any }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();

  return (
    <View style={[{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 16 }, style]}>
      <Text style={{ fontSize: 10.5, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", color: colors.textMuted, marginBottom: 12 }}>
        {t("thenNow.title")}
      </Text>

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: "#f59e0b" }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10.5, fontWeight: "700", color: colors.textDim }}>
            {fmtDate(data.then.occurred_at, i18n.language)} · {t("thenNow.then")}
          </Text>
          <Text style={{ fontSize: 13, marginTop: 2, color: colors.textSub }}>{nodeText(data.then, t)}</Text>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: colors.border, marginBottom: 12 }} />

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: colors.accent }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10.5, fontWeight: "700", color: colors.textDim }}>
            {fmtDate(data.now.occurred_at, i18n.language)} · {t("thenNow.now")}
          </Text>
          <Text style={{ fontSize: 13, marginTop: 2, color: colors.textSub }}>{nodeText(data.now, t)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {data.reversal_detected && (
          <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.35)" }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#f59e0b" }}>
              ⚠ {data.reversal_reason === "sign_flip" ? t("thenNow.reversalSignFlip") : t("thenNow.reversalNoNewThesis")}
            </Text>
          </View>
        )}
        {data.days_holding != null && (
          <View style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textSub }}>
              {t("thenNow.daysHolding", { count: data.days_holding })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
