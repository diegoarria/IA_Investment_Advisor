import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { billingApi, type UsageSummary } from "../lib/api";

// Uso extra (Diego, 2026-09-29) — mobile mirror of web's UsageMeterCard.
// Shows the plan-usage meter and uso-extra status; the app never charges
// (Apple rules), so turning uso extra ON is web-only — here the user can
// only keep economy mode, which costs nothing. `variant="banner"` is the
// compact version shown in Arthur's chat while the choice is pending.

function money(minor: number, currency: string) {
  const v = minor / 100;
  return currency === "mxn" ? `$${Math.round(v).toLocaleString("en-US")} MXN` : `$${v.toFixed(2)} USD`;
}

export default function UsageMeterCard({ variant = "card", refreshKey }: { variant?: "card" | "banner"; refreshKey?: number }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const [u, setU] = useState<UsageSummary | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    billingApi.getUsage().then((r) => setU(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!u) return null;
  if (variant === "banner" && !(u.reached_included && !u.decided)) return null;

  const date = new Date(u.resets_at).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" });
  const price = money(u.block_price, u.currency);
  const pctBar = Math.min(100, u.pct_used);
  const barColor = u.pct_used >= 90 ? "#f59e0b" : colors.accentLight;

  const keepEconomy = async () => {
    setSaving(true);
    try { const r = await billingApi.setOverage(false, u.cap_blocks); setU(r.data); } catch {} finally { setSaving(false); }
  };

  const choice = (
    <View style={{ gap: 10, marginTop: 14 }}>
      <TouchableOpacity activeOpacity={0.85} onPress={keepEconomy} disabled={saving}
        style={[s.option, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <View style={s.optionTitleRow}>
          <Ionicons name="leaf-outline" size={16} color={colors.accentLight} />
          <Text style={[s.optionTitle, { color: colors.text }]}>{t("usage.optionEconomy")}</Text>
        </View>
        <Text style={[s.optionDesc, { color: colors.textSub }]}>{t("usage.optionEconomyDesc", { date })}</Text>
      </TouchableOpacity>
      {u.can_opt_in && (
        <View style={[s.option, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "40" }]}>
          <View style={s.optionTitleRow}>
            <Ionicons name="flash-outline" size={16} color={colors.accentLight} />
            <Text style={[s.optionTitle, { color: colors.accentLight }]}>{t("usage.optionOverage")}</Text>
          </View>
          <Text style={[s.optionDesc, { color: colors.textSub }]}>{t("usage.optionOverageDesc", { price, cap: u.cap_blocks })}</Text>
          <Text style={[s.optionDesc, { color: colors.text, fontWeight: "700", marginTop: 6 }]}>{t("usage.activateOnWeb")}</Text>
        </View>
      )}
      {saving && <ActivityIndicator size="small" color={colors.accentLight} />}
    </View>
  );

  if (variant === "banner") {
    return (
      <View style={[s.banner, { backgroundColor: colors.card, borderColor: "rgba(245,158,11,0.4)" }]}>
        <Text style={[s.title, { color: colors.text }]}>{t("usage.reachedTitle")}</Text>
        <Text style={[s.desc, { color: colors.textSub }]}>{t("usage.reachedDesc")}</Text>
        {choice}
      </View>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={[s.icon, { backgroundColor: colors.accent + "1A" }]}>
          <Ionicons name="speedometer-outline" size={20} color={colors.accentLight} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.text }]}>{t("usage.percentUsed", { pct: u.pct_used })}</Text>
          <Text style={[s.small, { color: colors.textMuted }]}>{t("usage.resets", { date })}</Text>
        </View>
      </View>
      <View style={[s.track, { backgroundColor: colors.border }]}>
        <View style={{ width: `${pctBar}%` as any, height: "100%", borderRadius: 5, backgroundColor: barColor }} />
      </View>

      {u.mode === "included" && <Text style={[s.desc, { color: colors.textSub, marginTop: 12 }]}>{t("usage.includedDesc")}</Text>}

      {u.reached_included && !u.decided && (
        <>
          <Text style={[s.title, { color: colors.text, marginTop: 16 }]}>{t("usage.reachedTitle")}</Text>
          <Text style={[s.desc, { color: colors.textSub }]}>{t("usage.reachedDesc")}</Text>
          {choice}
        </>
      )}

      {u.opted_in && (
        <View style={[s.status, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "40" }]}>
          <View style={s.optionTitleRow}>
            <Ionicons name="checkmark-circle" size={16} color={colors.accentLight} />
            <Text style={[s.optionTitle, { color: colors.accentLight }]}>{t("usage.overageActive")}</Text>
          </View>
          <Text style={[s.optionDesc, { color: colors.textSub }]}>
            {u.blocks_used > 0
              ? t("usage.overageBlocks", { count: u.blocks_used, cap: u.cap_blocks, amount: money(u.extra_charge, u.currency) })
              : t("usage.overageBlocksNone")}
          </Text>
          {u.mode === "economy" && <Text style={[s.optionDesc, { color: "#f59e0b" }]}>{t("usage.capReached", { date })}</Text>}
        </View>
      )}

      {u.declined && u.reached_included && (
        <View style={[s.status, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <View style={s.optionTitleRow}>
            <Ionicons name="leaf-outline" size={16} color={colors.accentLight} />
            <Text style={[s.optionTitle, { color: colors.text }]}>{t("usage.economyActive")}</Text>
          </View>
          <Text style={[s.optionDesc, { color: colors.textSub }]}>{t("usage.economyDesc", { date })}</Text>
          {u.can_opt_in && <Text style={[s.optionDesc, { color: colors.text, fontWeight: "700", marginTop: 6 }]}>{t("usage.activateOnWeb")}</Text>}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  banner: { borderRadius: 20, borderWidth: 1, padding: 16, marginHorizontal: 12, marginBottom: 8 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15.5, fontWeight: "800", letterSpacing: -0.2 },
  small: { fontSize: 12, marginTop: 2 },
  desc: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  track: { height: 10, borderRadius: 5, overflow: "hidden", marginTop: 14 },
  option: { borderRadius: 16, borderWidth: 1, padding: 14 },
  optionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionTitle: { fontSize: 14, fontWeight: "800" },
  optionDesc: { fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  status: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
});
