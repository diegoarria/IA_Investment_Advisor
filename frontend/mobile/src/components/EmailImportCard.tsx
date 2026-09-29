import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Share, Linking } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { importsApi } from "../lib/api";

// Importación automática por correo (2026-09-29) — mobile mirror of web's
// EmailImportCard: the user's private forwarding address + 3 steps.
export default function EmailImportCard() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    importsApi.getEmailAlias().then((r) => setAddress(r.data.address)).catch(() => setError(true));
  }, []);

  const copy = async () => {
    if (!address) return;
    try { await Clipboard.setStringAsync(address); } catch { Share.share({ message: address }); }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.accent + "4D" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={[s.icon, { backgroundColor: colors.accent }]}>
          <Ionicons name="mail" size={19} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.text }]}>{t("emailImport.title")}</Text>
          <Text style={[s.sub, { color: colors.textMuted }]}>{t("emailImport.subtitle")}</Text>
        </View>
      </View>
      <Text style={[s.label, { color: colors.textMuted }]}>{t("emailImport.yourAddress")}</Text>
      <View style={[s.addr, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <Text style={[s.addrText, { color: colors.text }]} numberOfLines={1}>
          {address ?? (error ? t("emailImport.error") : t("emailImport.loading"))}
        </Text>
        {address && (
          <TouchableOpacity onPress={copy} style={s.copyBtn} activeOpacity={0.8}>
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={13} color="#06120D" />
            <Text style={s.copyText}>{copied ? t("emailImport.copied") : t("emailImport.copy")}</Text>
          </TouchableOpacity>
        )}
      </View>
      {[t("emailImport.step1"), t("emailImport.step2"), t("emailImport.step3")].map((step, i) => (
        <View key={i} style={s.step}>
          <View style={[s.num, { backgroundColor: colors.accent + "24" }]}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.accentLight }}>{i + 1}</Text>
          </View>
          <Text style={[s.stepText, { color: colors.textSub }]}>{step}</Text>
        </View>
      ))}
      <TouchableOpacity onPress={() => Linking.openURL("https://support.google.com/mail/answer/6579")}>
        <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.accentLight, marginTop: 10 }}>{t("emailImport.gmailHelp")} →</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
        <Ionicons name="shield-checkmark-outline" size={14} color={colors.textMuted} />
        <Text style={{ flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 17 }}>{t("emailImport.privacy")}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15.5, fontWeight: "800", letterSpacing: -0.2 },
  sub: { fontSize: 12, marginTop: 2 },
  label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 16, marginBottom: 6 },
  addr: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  addrText: { flex: 1, fontSize: 13.5, fontFamily: "Menlo" },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#00D47E", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  copyText: { fontSize: 12, fontWeight: "800", color: "#06120D" },
  step: { flexDirection: "row", gap: 10, marginTop: 12 },
  num: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
