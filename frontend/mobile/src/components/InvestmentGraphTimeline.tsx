import React from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";

export interface GraphEvent {
  id?: string;
  ticker: string;
  event_type: "question" | "thesis" | "watchlist_add" | "watchlist_remove" | "market_event" | "decision";
  payload?: Record<string, any>;
  occurred_at: string;
}

const EVENT_META: Record<string, { icon: string; color: string }> = {
  question:         { icon: "chatbubble-outline",   color: "#38bdf8" },
  thesis:           { icon: "bar-chart-outline",    color: "#f59e0b" },
  watchlist_add:    { icon: "add-circle-outline",   color: "#a78bfa" },
  watchlist_remove: { icon: "trash-outline",        color: "#a78bfa" },
  market_event:     { icon: "newspaper-outline",    color: "#ef4444" },
  decision:         { icon: "trending-up-outline",  color: "#22c55e" },
};

function EventLine({ ev, showTicker }: { ev: GraphEvent; showTicker?: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const meta = EVENT_META[ev.event_type] ?? EVENT_META.question;
  const payload = ev.payload || {};
  const iconName = ev.event_type === "decision" && payload.action === "sell" ? "trending-down-outline" : meta.icon;

  let title = "";
  let detail = "";
  switch (ev.event_type) {
    case "question":
      title = t("investmentGraph.event.question");
      detail = payload.question || "";
      break;
    case "thesis":
      title = t("investmentGraph.event.thesis");
      detail = payload.margin_of_safety_pct != null
        ? t("investmentGraph.event.thesisDetail", { mos: payload.margin_of_safety_pct, score: payload.composite_score ?? "—" })
        : "";
      break;
    case "watchlist_add":
      title = t("investmentGraph.event.watchlistAdd");
      break;
    case "watchlist_remove":
      title = t("investmentGraph.event.watchlistRemove");
      break;
    case "market_event":
      title = payload.kind === "earnings"
        ? (payload.beat_eps ? t("investmentGraph.event.earningsBeat") : t("investmentGraph.event.earningsMiss"))
        : t("investmentGraph.event.marketEvent");
      break;
    case "decision":
      title = payload.action === "buy" ? t("investmentGraph.event.decisionBuy") : payload.action === "sell" ? t("investmentGraph.event.decisionSell") : t("investmentGraph.event.decisionOther");
      detail = payload.notes || "";
      break;
  }

  return (
    <View style={[s.row, { borderBottomColor: colors.border }]}>
      <View style={[s.iconBox, { backgroundColor: meta.color + "18" }]}>
        <Ionicons name={iconName as any} size={15} color={meta.color} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Text style={[s.title, { color: colors.text }]}>{title}</Text>
          {showTicker && (
            <View style={[s.tickerBadge, { backgroundColor: colors.bgRaised }]}>
              <Text style={[s.tickerBadgeText, { color: colors.textMuted }]}>{ev.ticker}</Text>
            </View>
          )}
        </View>
        {!!detail && <Text style={[s.detail, { color: colors.textSub }]} numberOfLines={1}>{detail}</Text>}
      </View>
      <Text style={[s.date, { color: colors.textDim }]}>
        {ev.occurred_at ? new Date(ev.occurred_at).toLocaleDateString("es-MX") : ""}
      </Text>
    </View>
  );
}

interface Props {
  events: GraphEvent[];
  loading?: boolean;
  showTicker?: boolean;
  emptyLabel?: string;
}

export default function InvestmentGraphTimeline({ events, loading, showTicker, emptyLabel }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (loading) {
    return (
      <View style={{ paddingVertical: 24, alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (!events.length) {
    return (
      <Text style={{ fontSize: 12, textAlign: "center", paddingVertical: 24, color: colors.textMuted }}>
        {emptyLabel ?? t("investmentGraph.empty")}
      </Text>
    );
  }
  return (
    <View>
      {events.map((ev, i) => (
        <EventLine key={ev.id ?? i} ev={ev} showTicker={showTicker} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBox: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  title: { fontSize: 13, fontWeight: "700" },
  tickerBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tickerBadgeText: { fontSize: 9, fontWeight: "700" },
  detail: { fontSize: 11, marginTop: 2 },
  date:  { fontSize: 10, flexShrink: 0 },
});
