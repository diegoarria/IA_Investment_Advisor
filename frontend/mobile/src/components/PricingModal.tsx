import React from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Alert, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../lib/subscriptionStore";
import { useSubscribeCheckout } from "../lib/useSubscribeCheckout";
import { isRevenueCatSupported, restorePurchases } from "../lib/revenuecat";
import { usePaywallModalGuard } from "../lib/paywallModalGuard";

function getFreeFeatures(t: TFunction): string[] {
  return t("pricingModal.freeFeatures", { returnObjects: true }) as string[];
}

function getPremiumFeatures(t: TFunction): string[] {
  return t("pricingModal.premiumFeatures", { returnObjects: true }) as string[];
}

function getDuoFeatures(t: TFunction): string[] {
  return t("pricingModal.duoFeatures", { returnObjects: true }) as string[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function PricingModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [plan, setPlan] = React.useState<"monthly" | "yearly">("monthly");
  // Diego, 2026-10-28: real purchase restored — Apple 3.1.1 (IAP-only
  // digital subscriptions) still applies once this build goes through App
  // Review, but for now this opens the same Stripe Checkout the web app
  // uses in an in-app browser. Swap for react-native-iap once that's wired
  // up. Duo stays informational (manageOnWeb) — out of scope for now.
  const { subscribe, subscribing, subscribeDuo, subscribingDuo } = useSubscribeCheckout();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const [restoring, setRestoring] = React.useState(false);

  // See paywallModalGuard.ts — claim while presented so the global
  // TrialExpiredModal defers itself instead of stacking a second native
  // Modal on top of this one.
  React.useEffect(() => {
    if (!visible) return;
    usePaywallModalGuard.getState().claim();
    return () => usePaywallModalGuard.getState().release();
  }, [visible]);

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.status === "error") {
        Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
      } else if (result.status === "ok") {
        await fetchStatus();
        Alert.alert(t("pricingModal.restoreDoneTitle"), t("pricingModal.restoreDoneBody"));
      }
    } finally {
      setRestoring(false);
    }
  };

  const FREE_FEATURES = getFreeFeatures(t);
  const PREMIUM_FEATURES = getPremiumFeatures(t);
  const DUO_FEATURES = getDuoFeatures(t);

  // Yearly billing is always shown as its monthly-equivalent price up top
  // (what the user actually compares against the monthly plan), with the
  // real annual charge + savings called out just below — never the annual
  // total as the headline number.
  const regularPrice = plan === "monthly" ? "$14.99" : "$12.08";
  const duoPrice  = plan === "monthly" ? "$23.99" : "$18.75";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.75)" }}>
        <View style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden", maxHeight: "92%", backgroundColor: colors.bg, borderTopWidth: 1, borderColor: colors.border }}>

          {/* Handle + close */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>
          <TouchableOpacity onPress={onClose} style={{ position: "absolute", top: 14, right: 16, padding: 6 }}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          {/* Diego, 2026-10-28: `flex: 1` here (parent only has maxHeight,
              no definite height) made Yoga resolve the ScrollView's
              flexBasis to 0 — the whole sheet collapsed to nothing,
              leaving just the dark backdrop. PaywallModal.tsx already had
              the correct fix: flexShrink: 1 sizes to content and only
              shrinks against the maxHeight cap, without the flex:1
              ambiguity. */}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

            <Text style={{ fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 4, color: colors.text }}>
              {t("pricingModal.title")}
            </Text>
            <Text style={{ fontSize: 12, textAlign: "center", marginBottom: 20, color: colors.textMuted }}>
              {t("pricingModal.subtitle")}
            </Text>

            {/* Plan toggle */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 20 }}>
              {(["monthly", "yearly"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setPlan(p)}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: plan === p ? colors.accent : "transparent",
                    borderWidth: 1,
                    borderColor: plan === p ? colors.accent : colors.border,
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 11, fontWeight: "800", color: plan === p ? "#000" : colors.textMuted }}>
                    {p === "monthly" ? t("pricingModal.monthly") : t("pricingModal.yearlyDiscount")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Cards */}
            <View style={{ gap: 12 }}>

              {/* Free card */}
              <View style={{ borderRadius: 20, borderWidth: 1, padding: 16, backgroundColor: colors.card, borderColor: colors.border }}>
                <Text style={{ fontSize: 16, fontWeight: "900", marginBottom: 2, color: colors.text }}>{t("pricingModal.free")}</Text>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                  <Text style={{ fontSize: 28, fontWeight: "900", color: colors.text }}>$0</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{t("pricingModal.perMonth")}</Text>
                </View>
                {!isPremium && (
                <View style={{ borderRadius: 12, paddingVertical: 8, alignItems: "center", marginBottom: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted }}>{t("pricingModal.currentPlan")}</Text>
                </View>
                )}
                {FREE_FEATURES.map((f, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark" size={14} color={colors.textMuted} style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* Premium card */}
              <View style={{ borderRadius: 20, borderWidth: 1.5, padding: 16, borderColor: "rgba(0,212,126,0.4)", backgroundColor: "#0a1a10", overflow: "hidden" }}>
                <Text style={{ fontSize: 16, fontWeight: "900", color: "#fff", marginBottom: 2 }}>{t("pricingModal.premium")}</Text>

                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                  <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff" }}>{regularPrice}</Text>
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{t("pricingModal.perMonthShort")}</Text>
                </View>
                {plan === "yearly" ? (
                  <>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                      {t("pricingModal.billedAnnuallyAmount", { amount: "$144.99" })}
                    </Text>
                    <Text style={{ fontSize: 10, color: "#00d47e", marginBottom: 14 }}>{t("pricingModal.premiumSavings")}</Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
                    {t("pricingModal.billedMonthly")}
                  </Text>
                )}

                {isPremium ? (
                  <View style={{ borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14, backgroundColor: "rgba(0,212,126,0.12)", borderWidth: 1, borderColor: "rgba(0,212,126,0.35)" }}>
                    <Text style={{ fontSize: 14, fontWeight: "900", color: "#00d47e" }}>{t("pricingModal.currentPlan")}</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => subscribe(plan)}
                    disabled={!!subscribing}
                    activeOpacity={0.85}
                    style={{ borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: "center", marginBottom: 14, backgroundColor: "#00d47e", flexDirection: "row", justifyContent: "center", gap: 8, opacity: subscribing ? 0.7 : 1 }}
                  >
                    {subscribing === plan && <ActivityIndicator size="small" color="#06120D" />}
                    <Text style={{ fontSize: 14, fontWeight: "900", color: "#06120D" }}>
                      {subscribing === plan ? t("pricingModal.opening") : t("pricingModal.subscribeNow")}
                    </Text>
                  </TouchableOpacity>
                )}

                {PREMIUM_FEATURES.map((f, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark" size={14} color="#00d47e" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", flex: 1 }}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* Duo card */}
              <View style={{ borderRadius: 20, borderWidth: 1.5, padding: 16, borderColor: "rgba(99,102,241,0.4)", backgroundColor: "#0d1020", overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={{ fontSize: 18 }}>👫</Text>
                  <Text style={{ fontSize: 16, fontWeight: "900", color: "#fff" }}>{t("pricingModal.duoPlan")}</Text>
                  <View style={{ backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: "900", color: "#818cf8" }}>{t("pricingModal.new")}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 2 }}>
                  <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff" }}>{duoPrice}</Text>
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{t("pricingModal.usdPeriod", { period: t("pricingModal.perMonthShort") })}</Text>
                </View>
                {plan === "yearly" ? (
                  <>
                    <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                      {t("pricingModal.billedAnnuallyAmount", { amount: "$224.99" })}
                    </Text>
                    <Text style={{ fontSize: 10, color: "#818cf8", marginBottom: 14 }}>{t("pricingModal.duoSavings")}</Text>
                  </>
                ) : (
                  <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
                    {t("pricingModal.billedMonthly")}
                  </Text>
                )}

                <TouchableOpacity
                  onPress={() => subscribeDuo(plan)}
                  disabled={!!subscribingDuo}
                  activeOpacity={0.85}
                  style={{ borderRadius: 14, paddingVertical: 12, paddingHorizontal: 10, alignItems: "center", marginBottom: 14, backgroundColor: "#818cf8", flexDirection: "row", justifyContent: "center", gap: 8, opacity: subscribingDuo ? 0.7 : 1 }}
                >
                  {subscribingDuo === plan && <ActivityIndicator size="small" color="#0B0E22" />}
                  <Text style={{ fontSize: 14, fontWeight: "900", color: "#0B0E22" }}>
                    {subscribingDuo === plan ? t("pricingModal.opening") : t("pricingModal.subscribeNow")}
                  </Text>
                </TouchableOpacity>

                {DUO_FEATURES.map((f, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark" size={14} color="#818cf8" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", flex: 1 }}>{f}</Text>
                  </View>
                ))}
              </View>
            </View>

            {isRevenueCatSupported() && (
              <TouchableOpacity onPress={handleRestore} disabled={restoring} style={{ marginTop: 14, alignItems: "center", paddingVertical: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textSub, textDecorationLine: "underline" }}>
                  {restoring ? t("pricingModal.restoring") : t("pricingModal.restorePurchases")}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={{ fontSize: 10, textAlign: "center", marginTop: 16, color: colors.textDim, lineHeight: 16 }}>
              {t("pricingModal.footerNote")}
            </Text>

            {/* Apple 3.1.2(c): functional links to Privacy Policy + Terms of
                Use (EULA) must be reachable from the subscription purchase
                screen itself, not just elsewhere in the app. */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 10 }}>
              <TouchableOpacity onPress={() => Linking.openURL("https://nuvosai.com/privacy")}>
                <Text style={{ fontSize: 10, color: colors.textDim, textDecorationLine: "underline" }}>
                  {t("profile.bottom.privacyPolicy")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Linking.openURL("https://nuvosai.com/terms")}>
                <Text style={{ fontSize: 10, color: colors.textDim, textDecorationLine: "underline" }}>
                  {t("profile.bottom.termsOfUse")}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
