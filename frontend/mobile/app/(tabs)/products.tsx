import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Linking, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { upsellsApi } from "../../src/lib/api";
import PricingModal from "../../src/components/PricingModal";

function getFreeFeatures(t: TFunction): string[] {
  return t("products.free.features", { returnObjects: true }) as string[];
}

function getPremiumFeatures(t: TFunction): string[] {
  return t("products.premium.features", { returnObjects: true }) as string[];
}

function getDuoPlanFeatures(t: TFunction): string[] {
  return t("products.duo.features", { returnObjects: true }) as string[];
}

type OneTimeItem = {
  emoji: string;
  title: string;
  features: string[];
  priceFree?: string;
  pricePremium?: string;
  note?: string;
  offer: string;
  variant: string;
};

function getOneTimeItems(t: TFunction): OneTimeItem[] {
  const items = t("products.oneTime.items", { returnObjects: true }) as {
    title: string; features: string[]; note?: string;
  }[];
  return [
    {
      emoji: "📊",
      title: items[0].title,
      features: items[0].features,
      priceFree: "$34.99 USD",
      pricePremium: "$19.99 USD",
      offer: "annual_report",
      variant: "default",
    },
    {
      emoji: "📱",
      title: items[1].title,
      features: items[1].features,
      priceFree: "$149 USD",
      pricePremium: "$99 USD",
      offer: "session",
      variant: "default",
    },
    {
      emoji: "📦",
      title: items[2].title,
      features: items[2].features,
      pricePremium: "$247 USD",
      note: items[2].note,
      offer: "session",
      variant: "bundle",
    },
    {
      emoji: "🔬",
      title: items[3].title,
      features: items[3].features,
      priceFree: "$19.99 USD",
      pricePremium: "$9.99 USD",
      offer: "deep_research",
      variant: "default",
    },
  ];
}

function getComingSoonItems(t: TFunction): { emoji: string; title: string; desc: string }[] {
  const items = t("products.comingSoon.items", { returnObjects: true }) as { title: string; desc: string }[];
  return [
    { emoji: "🔗", title: items[0].title, desc: items[0].desc },
    { emoji: "📈", title: items[1].title, desc: items[1].desc },
  ];
}

export default function ProductsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const [showPricing, setShowPricing] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  const FREE_FEATURES = getFreeFeatures(t);
  const PREMIUM_FEATURES = getPremiumFeatures(t);
  const DUO_PLAN_FEATURES = getDuoPlanFeatures(t);
  const ONE_TIME = getOneTimeItems(t);
  const COMING_SOON = getComingSoonItems(t);

  async function handleCheckout(offer: string, variant: string) {
    const key = offer + variant;
    setCheckoutLoading(key);
    try {
      const res = await upsellsApi.checkout(offer, variant, "products_page");
      const url = res?.data?.url;
      if (url) {
        await Linking.openURL(url);
      } else {
        Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
      }
    } catch {
      Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
    }
    setCheckoutLoading(null);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }} showsVerticalScrollIndicator={false}>

        {/* ── Suscripción ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>{t("products.subscriptionTitle")}</Text>

          <View style={{ gap: 12 }}>
            {/* Free */}
            <View style={{ borderRadius: 20, borderWidth: 1, padding: 16, backgroundColor: colors.card, borderColor: colors.border }}>
              <Text style={{ fontSize: 15, fontWeight: "900", color: colors.text, marginBottom: 2 }}>{t("products.free.name")}</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 10 }}>
                <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text }}>$0</Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>{t("products.free.priceUnit")}</Text>
              </View>
              {!isPremium && (
                <View style={{ borderRadius: 10, paddingVertical: 8, alignItems: "center", marginBottom: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textMuted }}>{t("products.free.currentPlan")}</Text>
                </View>
              )}
              {FREE_FEATURES.map((f, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                  <Ionicons name="checkmark" size={13} color={colors.textMuted} style={{ marginTop: 1 }} />
                  <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>{f}</Text>
                </View>
              ))}
            </View>

            {/* Premium */}
            <View style={{ borderRadius: 20, borderWidth: 1.5, padding: 16, backgroundColor: "#0a1a10", borderColor: "rgba(0,212,126,0.4)" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                <Text style={{ fontSize: 15, fontWeight: "900", color: "#fff" }}>{t("products.premium.name")}</Text>
                {isPremium && (
                  <View style={{ backgroundColor: "rgba(0,212,126,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: "900", color: "#00d47e" }}>{t("products.premium.yourPlan")}</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff" }}>$14.99</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{t("products.premium.priceUnit")}</Text>
              </View>
              <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>{t("products.premium.thenPrice")}</Text>

              {!isPremium ? (
                <TouchableOpacity
                  onPress={() => setShowPricing(true)}
                  style={{ backgroundColor: "#00d47e", borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 13, fontWeight: "900", color: "#000" }}>{t("products.premium.claimFree")}</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ borderRadius: 12, paddingVertical: 8, alignItems: "center", marginBottom: 14, backgroundColor: "rgba(0,212,126,0.1)", borderWidth: 1, borderColor: "rgba(0,212,126,0.3)" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#00d47e" }}>{t("products.premium.active")}</Text>
                </View>
              )}

              {PREMIUM_FEATURES.map((f, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                  <Ionicons name="checkmark" size={13} color="#00d47e" style={{ marginTop: 1 }} />
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", flex: 1 }}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* ── Duo Plan ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>{t("products.duo.title")}</Text>
          <View style={{ borderRadius: 20, borderWidth: 1.5, padding: 16, borderColor: "rgba(99,102,241,0.4)", backgroundColor: "#0d1020", overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <Text style={{ fontSize: 20 }}>🌍</Text>
              <Text style={{ fontSize: 15, fontWeight: "900", color: "#fff" }}>{t("products.duo.title")}</Text>
              <View style={{ backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: "900", color: "#818cf8" }}>{t("products.duo.new")}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 2 }}>
              <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff" }}>$23.99</Text>
              <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{t("products.duo.priceUnit")}</Text>
            </View>
            <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>{t("products.duo.annual")}</Text>

            <TouchableOpacity
              onPress={() => setShowPricing(true)}
              style={{ backgroundColor: "rgba(99,102,241,0.2)", borderWidth: 1, borderColor: "rgba(99,102,241,0.4)", borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 }}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 13, fontWeight: "900", color: "#818cf8" }}>{t("products.duo.cta")}</Text>
            </TouchableOpacity>

            {DUO_PLAN_FEATURES.map((f, i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                <Ionicons name="checkmark" size={13} color="#818cf8" style={{ marginTop: 1 }} />
                <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", flex: 1 }}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Pago único ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>{t("products.oneTime.title")}</Text>
          <View style={{ gap: 10 }}>
            {ONE_TIME.map((p, i) => (
              <View
                key={i}
                style={{ borderRadius: 18, borderWidth: 1, padding: 14, backgroundColor: colors.card, borderColor: colors.border }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={{ fontSize: 20 }}>{p.emoji}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text }}>{p.title}</Text>
                </View>

                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: p.note ? 2 : 4 }}>
                  {p.pricePremium && (
                    <Text style={{ fontSize: 22, fontWeight: "900", color: "#00d47e" }}>{p.pricePremium}</Text>
                  )}
                  {p.priceFree && (
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>{t("products.oneTime.freeLabel")} <Text style={{ fontWeight: "800", color: colors.textSub }}>{p.priceFree}</Text></Text>
                  )}
                </View>
                {p.note && (
                  <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(0,212,126,0.08)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 12 }}>
                    <Text style={{ fontSize: 9, fontWeight: "800", color: "#00d47e" }}>{p.note}</Text>
                  </View>
                )}

                <TouchableOpacity
                  onPress={() => p.offer === "deep_research" ? router.push("/research") : handleCheckout(p.offer, p.variant)}
                  disabled={checkoutLoading === p.offer + p.variant}
                  style={{ backgroundColor: "#00d47e", borderRadius: 12, paddingVertical: 10, alignItems: "center", marginBottom: 12, opacity: checkoutLoading === p.offer + p.variant ? 0.6 : 1 }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 12, fontWeight: "900", color: "#000" }}>
                    {checkoutLoading === p.offer + p.variant ? t("products.oneTime.opening") : t("products.oneTime.buy")}
                  </Text>
                </TouchableOpacity>

                {p.features.map((f, fi) => (
                  <View key={fi} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 7 }}>
                    <Ionicons name="checkmark" size={13} color="#00d47e" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>{f}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>

        {/* ── Próximamente ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>{t("products.comingSoon.title")}</Text>
          <View style={{ gap: 10 }}>
            {COMING_SOON.map((p, i) => (
              <View key={i} style={{ borderRadius: 18, borderWidth: 1, padding: 14, backgroundColor: colors.card, borderColor: colors.border, opacity: 0.55 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <Text style={{ fontSize: 22 }}>{p.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{p.title}</Text>
                      <View style={{ backgroundColor: "rgba(99,102,241,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, fontWeight: "800", color: "#818cf8" }}>{t("products.comingSoon.soon")}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.textMuted, lineHeight: 17 }}>{p.desc}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>

      <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />
    </View>
  );
}
