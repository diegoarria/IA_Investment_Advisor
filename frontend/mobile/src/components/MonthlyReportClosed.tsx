import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { posthog } from "../config/posthog";

// Monthly Report closed-window screen (days 4-31). Redesigned 2026-09-27
// (Diego: "mejorar ese diseño y agregar un botón para mandar notificación
// al usuario por push y email"): a real page instead of a lock emoji and
// two lines — when it opens, what's inside, and an "Avísame" opt-in
// (POST /api/monthly-report/notify-me) that gets a push + email on the 1st
// of every month (worker.py job_monthly_report_notify_available).

// Same fixed palette as the report itself (monthly-report.tsx's WT).
const C = {
  bg: "#03060e", card: "#090f1f", card2: "#0d1526",
  border: "#162035", text: "#eef2ff", sub: "#8fa3c0", muted: "#546b85",
  accent: "#00b96d", accentL: "#00e887",
};

const INCLUDES: { icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
  { icon: "pie-chart-outline", key: "portfolio" },
  { icon: "git-branch-outline", key: "decisions" },
  { icon: "search-outline", key: "research" },
  { icon: "wallet-outline", key: "wealth" },
  { icon: "flame-outline", key: "habits" },
  { icon: "trophy-outline", key: "achievements" },
];

function todayET(): Date {
  const s = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return new Date(`${s}T00:00:00`);
}

export default function MonthlyReportClosed() {
  const { t, i18n } = useTranslation();
  const [opensOn, setOpensOn] = useState<Date | null>(null);
  const [optedIn, setOptedIn] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    api.get("/api/monthly-report/notify-me")
      .then((r) => {
        setOptedIn(!!r.data?.opted_in);
        if (r.data?.opens_on) setOpensOn(new Date(`${r.data.opens_on}T00:00:00`));
      })
      .catch(() => {})
      .finally(() => setStatusLoaded(true));
  }, []);

  // Fallback if the status call failed: the 1st of next month.
  const openDate = opensOn ?? (() => { const d = todayET(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); })();
  const daysLeft = Math.max(0, Math.round((openDate.getTime() - todayET().getTime()) / 86400000));
  const locale = i18n.language === "en" ? "en-US" : "es-MX";
  const monthShort = openDate.toLocaleDateString(locale, { month: "short" }).replace(".", "").toUpperCase();
  const dateLabel = openDate.toLocaleDateString(locale, { day: "numeric", month: "long" });

  const toggle = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      if (optedIn) {
        await api.delete("/api/monthly-report/notify-me");
        setOptedIn(false);
        posthog.capture("monthly_report_notify_off");
      } else {
        await api.post("/api/monthly-report/notify-me");
        setOptedIn(true);
        posthog.capture("monthly_report_notify_on");
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as any));

  return (
    <SafeAreaView style={st.container} edges={["top", "bottom"]}>
      <View style={st.topBar}>
        <TouchableOpacity onPress={goBack} style={st.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel={t("monthlyReport.back")}>
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>
        <Text style={st.topTitle}>Monthly Report</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={st.content}>
        {/* Calendar tile */}
        <View style={st.heroWrap}>
          <View style={st.glow} />
          <View style={st.calendar}>
            <View style={st.calendarTop}><Text style={st.calendarMonth}>{monthShort}</Text></View>
            <Text style={st.calendarDay}>{openDate.getDate()}</Text>
          </View>
        </View>

        <Text style={st.title}>{t("monthlyReport.closed.title", { date: dateLabel })}</Text>
        <Text style={st.body}>{t("monthlyReport.closed.body")}</Text>

        <View style={st.pills}>
          <View style={st.pill}>
            <Ionicons name="time-outline" size={13} color={C.accentL} />
            <Text style={st.pillText}>
              {daysLeft === 1 ? t("monthlyReport.closed.oneDayLeft") : t("monthlyReport.closed.daysLeft", { count: daysLeft })}
            </Text>
          </View>
          <View style={st.pill}>
            <Ionicons name="calendar-outline" size={13} color={C.accentL} />
            <Text style={st.pillText}>{t("monthlyReport.closed.window")}</Text>
          </View>
        </View>

        {/* Notify me */}
        <View style={[st.notifyCard, optedIn && st.notifyCardOn]}>
          <View style={st.notifyHeader}>
            <View style={[st.notifyIcon, optedIn && { backgroundColor: C.accent }]}>
              <Ionicons name={optedIn ? "checkmark" : "notifications-outline"} size={18} color={optedIn ? "#000" : C.accentL} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.notifyTitle}>
                {optedIn ? t("monthlyReport.closed.notifyOnTitle") : t("monthlyReport.closed.notifyTitle")}
              </Text>
              <Text style={st.notifySub}>
                {optedIn
                  ? t("monthlyReport.closed.notifyOnBody", { date: dateLabel })
                  : t("monthlyReport.closed.notifyBody", { date: dateLabel })}
              </Text>
            </View>
          </View>

          <View style={st.channels}>
            {(["push", "email"] as const).map((ch) => (
              <View key={ch} style={st.channel}>
                <Ionicons name={ch === "push" ? "phone-portrait-outline" : "mail-outline"} size={13} color={C.sub} />
                <Text style={st.channelText}>{t(`monthlyReport.closed.channel_${ch}`)}</Text>
              </View>
            ))}
          </View>

          {!statusLoaded ? (
            <ActivityIndicator color={C.accentL} style={{ marginTop: 6 }} />
          ) : optedIn ? (
            <TouchableOpacity onPress={toggle} disabled={saving} style={st.secondaryBtn}>
              {saving ? <ActivityIndicator color={C.sub} size="small" /> : <Text style={st.secondaryText}>{t("monthlyReport.closed.notifyOff")}</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={toggle} disabled={saving} style={st.primaryBtn} activeOpacity={0.85}>
              {saving
                ? <ActivityIndicator color="#000" size="small" />
                : <>
                    <Ionicons name="notifications" size={16} color="#000" />
                    <Text style={st.primaryText}>{t("monthlyReport.closed.notifyCta")}</Text>
                  </>}
            </TouchableOpacity>
          )}
          {saveError && <Text style={st.errorText}>{t("monthlyReport.closed.notifyError")}</Text>}
        </View>

        {/* What's inside */}
        <Text style={st.sectionTitle}>{t("monthlyReport.closed.includesTitle")}</Text>
        <View style={st.grid}>
          {INCLUDES.map((item) => (
            <View key={item.key} style={st.gridItem}>
              <Ionicons name={item.icon} size={18} color={C.accentL} />
              <Text style={st.gridText}>{t(`monthlyReport.closed.includes.${item.key}`)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  topTitle: { flex: 1, textAlign: "center", color: C.text, fontSize: 15, fontWeight: "800" },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  heroWrap: { alignItems: "center", justifyContent: "center", marginTop: 18, marginBottom: 22 },
  glow: { position: "absolute", width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(0,232,135,0.08)" },
  calendar: { width: 112, borderRadius: 24, overflow: "hidden", backgroundColor: C.card2, borderWidth: 1, borderColor: "rgba(0,232,135,0.3)" },
  calendarTop: { backgroundColor: C.accent, paddingVertical: 7, alignItems: "center" },
  calendarMonth: { color: "#000", fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  calendarDay: { color: C.text, fontSize: 52, fontWeight: "900", textAlign: "center", paddingVertical: 6 },

  title: { color: C.text, fontSize: 24, fontWeight: "900", textAlign: "center", letterSpacing: -0.5, lineHeight: 29 },
  body: { color: C.sub, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10, paddingHorizontal: 6 },

  pills: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 16 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  pillText: { color: C.sub, fontSize: 12, fontWeight: "700" },

  notifyCard: { marginTop: 24, borderRadius: 22, padding: 16, gap: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  notifyCardOn: { borderColor: "rgba(0,232,135,0.35)", backgroundColor: "rgba(0,185,109,0.07)" },
  notifyHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  notifyIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,232,135,0.12)" },
  notifyTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  notifySub: { color: C.sub, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  channels: { flexDirection: "row", gap: 8 },
  channel: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: C.card2 },
  channelText: { color: C.sub, fontSize: 11.5, fontWeight: "600" },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: C.accentL, borderRadius: 16, paddingVertical: 14 },
  primaryText: { color: "#000", fontSize: 14, fontWeight: "900" },
  secondaryBtn: { alignItems: "center", paddingVertical: 8 },
  secondaryText: { color: C.muted, fontSize: 12.5, fontWeight: "700" },
  errorText: { color: "#f87171", fontSize: 12, textAlign: "center" },

  sectionTitle: { color: C.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginTop: 28, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridItem: { width: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 13, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  gridText: { flex: 1, color: C.text, fontSize: 13, fontWeight: "700" },
});
