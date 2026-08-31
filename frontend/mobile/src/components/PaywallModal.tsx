import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, Linking, ScrollView, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { billingApi, upsellsApi } from "../lib/api";
import { posthog } from "../config/posthog";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { useTheme } from "../lib/ThemeContext";

const getHeroFeatures = (t: TFunction): string[] => [
  t("paywallModal.heroFeature1"),
  t("paywallModal.heroFeature2"),
  t("paywallModal.heroFeature3"),
  t("paywallModal.heroFeature4"),
  t("paywallModal.heroFeature5"),
];

const getDuoFeatures = (t: TFunction): string[] =>
  t("pricingModal.duoFeatures", { returnObjects: true }) as string[];

interface Props { visible: boolean; onClose: () => void; reason?: string }

// Diego, 2026-08-30: rewritten to match PricingModal's (Productos) design
// language almost exactly — same plan toggle, same card styling — instead
// of its own single-plan hero layout. Two differences from PricingModal on
// purpose: (1) no Free card here, since whoever sees this modal is already
// on Free — showing "Free · tu plan actual" would just be wasted space on
// their own tier; (2) Premium's feature list is 5 curated high-value
// bullets + a closing "y muchas funcionalidades más" line instead of
// PricingModal's full checklist — this modal interrupts a locked feature,
// it isn't the place someone goes to compare every included feature (that
// stays PricingModal's job, unchanged).
export default function PaywallModal({ visible, onClose, reason }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);
  const [duoLoading, setDuoLoading] = useState(false);

  const HERO_FEATURES = getHeroFeatures(t);
  const DUO_FEATURES = getDuoFeatures(t);

  useEffect(() => {
    if (visible) posthog.capture("paywall_viewed", { reason: reason ?? null });
  }, [visible]);

  const regularPrice = plan === "monthly" ? "$14.99" : "$12.08";
  const duoPrice = plan === "monthly" ? "$23.99" : "$18.75";

  async function handleUpgrade() {
    posthog.capture("premium_upgrade_initiated", { plan, price: regularPrice });
    setLoading(true);
    try {
      const res = await billingApi.createCheckout(plan);
      const url = res?.data?.url;
      if (url) {
        await Linking.openURL(url);
        setTimeout(fetchStatus, 3000);
      } else {
        Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
      }
    } catch {
      Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
    }
    setLoading(false);
  }

  async function handleDuoCheckout() {
    posthog.capture("premium_upgrade_initiated", { plan: "duo", price: duoPrice });
    setDuoLoading(true);
    try {
      const res = await upsellsApi.checkout("family_plan", plan, "paywall_modal");
      const url = res?.data?.url;
      if (url) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
      }
    } catch {
      Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
    }
    setDuoLoading(false);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>

          <View style={s.handleRow}>
            <View style={[s.handle, { backgroundColor: colors.border }]} />
          </View>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>

          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            <Text style={[s.title, { color: colors.text }]}>{t("paywallModal.premiumBadge")}</Text>

            {reason ? (
              <View style={[s.reasonBox, { backgroundColor: "rgba(0,168,94,0.08)", borderColor: "rgba(0,168,94,0.25)" }]}>
                <Text style={[s.reasonText, { color: colors.textSub }]}>🔒 {reason}</Text>
              </View>
            ) : null}

            {/* Plan toggle */}
            <View style={s.toggleRow}>
              {(["monthly", "yearly"] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setPlan(p)}
                  style={[
                    s.toggleBtn,
                    { backgroundColor: plan === p ? colors.accent : "transparent", borderColor: plan === p ? colors.accent : colors.border },
                  ]}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 11, fontWeight: "800", color: plan === p ? "#000" : colors.textMuted }}>
                    {p === "monthly" ? t("pricingModal.monthly") : t("pricingModal.yearlyDiscount")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Premium card */}
            <View style={[s.card, { borderColor: "rgba(0,212,126,0.4)", backgroundColor: "#0a1a10" }]}>
              <View style={s.mostPopular}>
                <Text style={s.mostPopularText}>{t("paywallModal.planYearlyBadge")}</Text>
              </View>
              <Text style={s.cardTitleLight}>{t("pricingModal.premium")}</Text>
              <View style={s.priceRow}>
                <Text style={s.priceLight}>{regularPrice}</Text>
                <Text style={s.priceUnitLight}>{t("pricingModal.perMonthShort")}</Text>
              </View>
              {plan === "yearly" ? (
                <>
                  <Text style={s.billedLine}>{t("pricingModal.billedAnnuallyAmount", { amount: "$144.99" })}</Text>
                  <Text style={[s.savingsLine, { color: "#00d47e" }]}>{t("pricingModal.premiumSavings")}</Text>
                </>
              ) : <View style={{ marginBottom: 14 }} />}

              <TouchableOpacity
                onPress={handleUpgrade}
                disabled={loading}
                style={[s.ctaSolid, { backgroundColor: loading ? "rgba(0,212,126,0.5)" : "#00d47e" }]}
                activeOpacity={0.85}
              >
                {loading
                  ? <ActivityIndicator color="#000" size="small" />
                  : <Text style={s.ctaSolidText}>{t("paywallModal.startNow")}</Text>}
              </TouchableOpacity>

              {HERO_FEATURES.map((f) => (
                <View key={f} style={s.featRow}>
                  <Ionicons name="checkmark" size={14} color="#00d47e" style={{ marginTop: 1 }} />
                  <Text style={s.featTextLight}>{f}</Text>
                </View>
              ))}
              <Text style={s.moreLine}>{t("paywallModal.moreFeatures")}</Text>
            </View>

            {/* Duo card */}
            <View style={[s.card, { borderColor: "rgba(99,102,241,0.4)", backgroundColor: "#0d1020" }]}>
              <View style={s.duoHeader}>
                <Text style={{ fontSize: 18 }}>👫</Text>
                <Text style={s.cardTitleLight}>{t("pricingModal.duoPlan")}</Text>
                <View style={s.newBadge}>
                  <Text style={s.newBadgeText}>{t("pricingModal.new")}</Text>
                </View>
              </View>
              <View style={s.priceRow}>
                <Text style={s.priceLight}>{duoPrice}</Text>
                <Text style={s.priceUnitLight}>{t("pricingModal.usdPeriod", { period: t("pricingModal.perMonthShort") })}</Text>
              </View>
              {plan === "yearly" ? (
                <>
                  <Text style={s.billedLine}>{t("pricingModal.billedAnnuallyAmount", { amount: "$224.99" })}</Text>
                  <Text style={[s.savingsLine, { color: "#818cf8" }]}>{t("pricingModal.duoSavings")}</Text>
                </>
              ) : (
                <Text style={[s.savingsLine, { color: "rgba(255,255,255,0.4)" }]}>{t("pricingModal.billedMonthly")}</Text>
              )}

              <TouchableOpacity
                onPress={handleDuoCheckout}
                disabled={duoLoading}
                style={[s.ctaOutline, duoLoading && { backgroundColor: "rgba(99,102,241,0.4)" }]}
                activeOpacity={0.85}
              >
                {duoLoading
                  ? <ActivityIndicator color="#818cf8" size="small" />
                  : <Text style={s.ctaOutlineText}>{t("pricingModal.hireDuoPlan")}</Text>}
              </TouchableOpacity>

              {DUO_FEATURES.map((f, i) => (
                <View key={i} style={s.featRow}>
                  <Ionicons name="checkmark" size={14} color="#818cf8" style={{ marginTop: 1 }} />
                  <Text style={s.featTextDuo}>{f}</Text>
                </View>
              ))}
            </View>

            {/* Trust row */}
            <View style={s.trustRow}>
              {[t("paywallModal.trust1"), t("paywallModal.trust2"), t("paywallModal.trust3")].map((item) => (
                <View key={item} style={s.trustItem}>
                  <Ionicons name="checkmark" size={10} color="#00d47e" />
                  <Text style={[s.trustText, { color: colors.textDim }]}>{item}</Text>
                </View>
              ))}
            </View>

            {/* 1:1 coaching link */}
            <TouchableOpacity
              style={[s.coachingRow, { backgroundColor: colors.bgRaised }]}
              onPress={() => Linking.openURL("https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai")}
              activeOpacity={0.7}
            >
              <Text style={s.coachingEmoji}>📅</Text>
              <Text style={[s.coachingText, { color: colors.textMuted }]}>{t("paywallModal.coachingCta")}</Text>
              <Ionicons name="chevron-forward" size={13} color={colors.textDim} />
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: "92%", overflow: "hidden" },
  handleRow: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  closeBtn: { position: "absolute", top: 14, right: 16, padding: 6, zIndex: 10 },
  scroll: { paddingHorizontal: 20, paddingBottom: 36 },

  title: { fontSize: 19, fontWeight: "900", textAlign: "center", marginBottom: 12 },

  reasonBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 14 },
  reasonText: { fontSize: 12, textAlign: "center" },

  toggleRow: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 16 },
  toggleBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },

  card: { borderRadius: 20, borderWidth: 1.5, padding: 16, marginBottom: 12, overflow: "hidden", position: "relative" },
  mostPopular: { position: "absolute", top: 0, left: "50%", transform: [{ translateX: -50 }], backgroundColor: "#f59e0b", paddingHorizontal: 10, paddingVertical: 3, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  mostPopularText: { fontSize: 9, fontWeight: "900", color: "#000" },
  cardTitleLight: { fontSize: 16, fontWeight: "900", color: "#fff", marginBottom: 2, marginTop: 12 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 },
  priceLight: { fontSize: 28, fontWeight: "900", color: "#fff" },
  priceUnitLight: { fontSize: 12, color: "rgba(255,255,255,0.5)" },
  billedLine: { fontSize: 11, color: "rgba(255,255,255,0.55)" },
  savingsLine: { fontSize: 10, marginBottom: 14 },

  ctaSolid: { borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 },
  ctaSolidText: { fontSize: 14, fontWeight: "900", color: "#000" },
  ctaOutline: { borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14, backgroundColor: "rgba(99,102,241,0.2)", borderWidth: 1, borderColor: "rgba(99,102,241,0.4)" },
  ctaOutlineText: { fontSize: 14, fontWeight: "900", color: "#818cf8" },

  featRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 },
  featTextLight: { fontSize: 12, color: "rgba(255,255,255,0.8)", flex: 1 },
  featTextDuo: { fontSize: 12, color: "rgba(255,255,255,0.75)", flex: 1 },
  moreLine: { fontSize: 10.5, fontStyle: "italic", color: "rgba(255,255,255,0.45)", marginTop: 2, paddingTop: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)", borderStyle: "dashed" },

  duoHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  newBadge: { backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  newBadgeText: { fontSize: 9, fontWeight: "900", color: "#818cf8" },

  trustRow: { flexDirection: "row", justifyContent: "center", gap: 14, flexWrap: "wrap", marginBottom: 12 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  trustText: { fontSize: 10 },

  coachingRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  coachingEmoji: { fontSize: 14 },
  coachingText: { flex: 1, fontSize: 12, fontWeight: "500" },
});
