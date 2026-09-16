import React from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView } from "react-native";
import Svg, { Path, Polyline } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { useAppStore } from "../lib/profileStore";

// Diego, 2026-09-16: shows exactly once, right after onboarding, announcing
// the 30-day free Premium trial. hasSeenWelcomeCard is server-persisted
// (migration 098) — never AsyncStorage-only — so it genuinely never shows
// again on any other device/reinstall once "Continuar" is tapped. Gated
// purely on trialStartDate (not tier/isTrialPremium — the backend already
// folds an active trial into tier:"premium", which would wrongly exclude
// the exact users this card is for).
export default function WelcomeCard() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const profile = useAppStore((s) => s.profile);
  const { trialStartDate, trialDaysLeftServer, hasFetchedStatus, hasSeenWelcomeCard, markWelcomeCardSeen } = useSubscriptionStore();

  const visible = hasFetchedStatus && trialStartDate !== null && !hasSeenWelcomeCard;
  if (!visible) return null;

  const trialEndDate = new Date(Date.now() + trialDaysLeftServer * 86_400_000);
  const trialEndLabel = new Intl.DateTimeFormat(i18n.language === "en" ? "en-US" : "es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(trialEndDate);

  const FEATURES = [
    t("paywallModal.heroFeature1"),
    t("paywallModal.heroFeature2"),
    t("paywallModal.heroFeature3"),
    t("paywallModal.heroFeature4"),
    t("paywallModal.heroFeature5"),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <ScrollView style={s.scrollFlex} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

            <View style={s.header}>
              <View style={[s.iconBox, { backgroundColor: colors.accent, shadowColor: colors.accent }]}>
                <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={colors.bg} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M12 2 L19 6 L19 13 C19 18 15.5 21.5 12 22.5 C8.5 21.5 5 18 5 13 L5 6 Z" />
                </Svg>
              </View>
              <Text style={[s.title, { color: colors.text }]}>{t("welcomePremiumCard.title", { name: profile?.name || "" })}</Text>
              <Text style={[s.subtitle, { color: colors.textSub }]}>{t("welcomePremiumCard.subtitle")}</Text>
            </View>

            <View style={[s.trialBanner, { backgroundColor: colors.accentGlow, borderColor: colors.accent + "4d" }]}>
              <Text style={[s.trialLabel, { color: colors.accentLight }]}>{t("welcomePremiumCard.trialLabel")}</Text>
              <Text style={[s.trialLine, { color: colors.textSub }]}>
                {t("welcomePremiumCard.trialEndsPrefix")} <Text style={{ color: colors.text, fontWeight: "700" }}>{trialEndLabel}</Text>
              </Text>
            </View>

            <View style={s.featuresBlock}>
              <Text style={[s.featuresLabel, { color: colors.textMuted }]}>{t("welcomePremiumCard.featuresLabel")}</Text>
              {FEATURES.map((f) => (
                <View key={f} style={s.featureRow}>
                  <View style={[s.checkCircle, { backgroundColor: colors.accentGlow }]}>
                    <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={colors.accentLight} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                      <Polyline points="20 6 9 17 4 12" />
                    </Svg>
                  </View>
                  <Text style={[s.featureText, { color: colors.text }]}>{f}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[s.cta, { backgroundColor: colors.accent, shadowColor: colors.accent }]}
              onPress={markWelcomeCardSeen}
              activeOpacity={0.85}
            >
              <Text style={[s.ctaText, { color: colors.bg }]}>{t("welcomePremiumCard.continue")}</Text>
            </TouchableOpacity>
            <Text style={[s.footnote, { color: colors.textMuted }]}>{t("welcomePremiumCard.noCardRequired")}</Text>

          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: "92%", overflow: "hidden" },
  scrollFlex: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 32 },
  header: { alignItems: "center", gap: 6, marginBottom: 20 },
  iconBox: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, marginBottom: 4 },
  title: { fontWeight: "900", fontSize: 21, textAlign: "center", letterSpacing: -0.3 },
  subtitle: { fontSize: 13.5, textAlign: "center", lineHeight: 19, maxWidth: 300 },
  trialBanner: { borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 20 },
  trialLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  trialLine: { fontSize: 12.5 },
  featuresBlock: { gap: 11, marginBottom: 24 },
  featuresLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkCircle: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  featureText: { fontSize: 13.5, lineHeight: 19, flex: 1 },
  cta: { width: "100%", paddingVertical: 15, borderRadius: 16, alignItems: "center", shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
  ctaText: { fontWeight: "900", fontSize: 15 },
  footnote: { textAlign: "center", fontSize: 11, marginTop: 10 },
});
