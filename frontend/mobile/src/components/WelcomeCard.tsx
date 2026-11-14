import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Path, Polyline } from "react-native-svg";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { readOnboardingGoal } from "../lib/onboardingAnalytics";

// Diego, 2026-09-16: shows exactly once, right after onboarding, announcing
// the 30-day free Premium trial. hasSeenWelcomeCard is server-persisted
// (migration 098) — never AsyncStorage-only — so it genuinely never shows
// again on any other device/reinstall once dismissed. Gated purely on
// trialStartDate (not tier/isTrialPremium — the backend already folds an
// active trial into tier:"premium", which would wrongly exclude the exact
// users this card is for).
//
// Stage E (mobile parity, 2026-11): this was a full-screen bottom-sheet
// Modal with a dark backdrop, mounted unconditionally at the root layout —
// it could cover a brand-new user's very first real Radar/ETF/Portfolio
// result the instant they landed on it out of /onboarding/quick. Same fix
// as web's Stage D: a small, non-blocking corner card instead — nothing
// behind it is dimmed or blocked. CTA label is contextual to whichever
// Ruta sent the user here, read from the same onboarding-goal store the
// rest of the Stage A-E flow already uses.
export default function WelcomeCard() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { trialStartDate, hasFetchedStatus, hasSeenWelcomeCard, markWelcomeCardSeen } = useSubscriptionStore();

  const visible = hasFetchedStatus && trialStartDate !== null && !hasSeenWelcomeCard;
  if (!visible) return null;

  const goal = readOnboardingGoal();
  const ctaLabel =
    goal === "company" ? t("welcomePremiumCard.ctaCompany") :
    goal === "etf"      ? t("welcomePremiumCard.ctaEtf") :
    goal === "portfolio" ? t("welcomePremiumCard.ctaPortfolio") :
    t("welcomePremiumCard.continue");

  const FEATURES = [
    t("paywallModal.heroFeature1"),
    t("paywallModal.heroFeature2"),
    t("paywallModal.heroFeature3"),
  ];

  return (
    <SafeAreaView pointerEvents="box-none" style={s.anchor}>
      <View style={[s.card, { backgroundColor: colors.bg, borderColor: colors.border }]}>
        <TouchableOpacity onPress={markWelcomeCardSeen} style={s.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={s.headerRow}>
          <View style={[s.iconBox, { backgroundColor: colors.accent }]}>
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.bg} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 2 L19 6 L19 13 C19 18 15.5 21.5 12 22.5 C8.5 21.5 5 18 5 13 L5 6 Z" />
            </Svg>
          </View>
          <Text style={[s.title, { color: colors.text }]}>{t("welcomePremiumCard.title")}</Text>
        </View>
        <Text style={[s.subtitle, { color: colors.textSub }]}>{t("welcomePremiumCard.subtitle")}</Text>

        <View style={s.featuresBlock}>
          {FEATURES.map((f) => (
            <View key={f} style={s.featureRow}>
              <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={colors.accentLight} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <Polyline points="20 6 9 17 4 12" />
              </Svg>
              <Text style={[s.featureText, { color: colors.text }]}>{f}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[s.cta, { backgroundColor: colors.accent }]}
          onPress={markWelcomeCardSeen}
          activeOpacity={0.85}
        >
          <Text style={[s.ctaText, { color: colors.bg }]}>{ctaLabel}</Text>
        </TouchableOpacity>
        <Text style={[s.footnote, { color: colors.textMuted }]}>{t("welcomePremiumCard.noCardRequired")}</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // Anchored near the TOP (not bottom) so it never collides with the
  // bottom tab bar on Home/Portfolio/etc. — pointerEvents box-none lets
  // touches reach the real screen everywhere outside the card's own bounds.
  anchor: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 9000, alignItems: "flex-end", paddingTop: 8 },
  card: { width: "90%", maxWidth: 340, borderRadius: 20, borderWidth: 1, padding: 16, marginRight: 12 },
  closeBtn: { position: "absolute", top: 10, right: 10, width: 24, height: 24, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6, paddingRight: 20 },
  iconBox: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  title: { fontWeight: "900", fontSize: 14, flex: 1 },
  subtitle: { fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  featuresBlock: { gap: 6, marginBottom: 12 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  featureText: { fontSize: 12, lineHeight: 17, flex: 1 },
  cta: { width: "100%", paddingVertical: 11, borderRadius: 14, alignItems: "center" },
  ctaText: { fontWeight: "900", fontSize: 13 },
  footnote: { textAlign: "center", fontSize: 10.5, marginTop: 8 },
});
