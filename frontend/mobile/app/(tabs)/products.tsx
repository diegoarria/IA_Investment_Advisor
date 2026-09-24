import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useBillingPricing, fmtMxn, type BillingPricing } from "../../src/lib/billingPricing";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import OneTimeProductModal, { type OneTimeProduct } from "../../src/components/OneTimeProductModal";

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

function getOneTimeItems(t: TFunction, pr: BillingPricing): OneTimeItem[] {
  const sessMxn = pr.currency === "mxn" && pr.session_free != null && pr.session_premium != null && pr.session_bundle != null;
  const items = t("products.oneTime.items", { returnObjects: true }) as {
    title: string; features: string[]; note?: string;
  }[];
  return [
    {
      emoji: "📱",
      title: items[0].title,
      features: items[0].features,
      priceFree: sessMxn ? `${fmtMxn(pr.session_free!)} MXN` : "$149 USD",
      pricePremium: sessMxn ? `${fmtMxn(pr.session_premium!)} MXN` : "$99 USD",
      offer: "session",
      variant: "default",
    },
    {
      emoji: "📦",
      title: items[1].title,
      features: items[1].features,
      pricePremium: sessMxn ? `${fmtMxn(pr.session_bundle!)} MXN` : "$247 USD",
      note: items[1].note,
      offer: "session",
      variant: "bundle",
    },
    {
      emoji: "📞",
      title: items[2].title,
      features: items[2].features,
      pricePremium: pr.currency === "mxn" && pr.broker_call != null ? `${fmtMxn(pr.broker_call)} MXN` : "$20 USD",
      offer: "broker_call",
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
  // Keyed (not the item itself) so the open sheet always reflects the current
  // price — MXN amounts arrive async after the sheet may already be open.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { open } = useLocalSearchParams<{ open?: string }>();

  const FREE_FEATURES = getFreeFeatures(t);
  const PREMIUM_FEATURES = getPremiumFeatures(t);
  const DUO_PLAN_FEATURES = getDuoPlanFeatures(t);
  const pricing = useBillingPricing();
  const mxnPremium = pricing.currency === "mxn" && pricing.monthly != null && pricing.yearly != null;
  const mxnDuo = pricing.currency === "mxn" && pricing.duo_monthly != null && pricing.duo_yearly != null;
  const ONE_TIME = getOneTimeItems(t, pricing);
  const COMING_SOON = getComingSoonItems(t);
  const selectedProduct: OneTimeProduct | null = ONE_TIME.find((p) => `${p.offer}:${p.variant}` === selectedKey) ?? null;

  // Sidebar "Sesión 1:1" lands here with ?open=session — same as tapping that
  // product's card, then clear the param so going back/reopening works normally.
  useEffect(() => {
    if (open === "session") {
      setSelectedKey("session:default");
      router.setParams({ open: undefined } as any);
    }
  }, [open]);

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
                <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff" }}>{mxnPremium ? fmtMxn(pricing.monthly!) : "$14.99"}</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{t("products.premium.priceUnit")}</Text>
              </View>
              <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>{mxnPremium ? t("products.premium.thenPriceMxn", { monthly: fmtMxn(pricing.monthly!), yearly: fmtMxn(pricing.yearly!) }) : t("products.premium.thenPrice")}</Text>

              {!isPremium ? (
                // Diego, 2026-09-15: "evitarme lo de Apple IAP... tal como
                // lo hace Spotify" — "Hazte Premium →" read as a subscribe
                // CTA even though it only opened PricingModal (which itself
                // has no purchase path). Same non-actionable info box used
                // everywhere else, no wording that implies a purchase flow.
                <View style={{ borderRadius: 12, paddingVertical: 10, alignItems: "center", marginBottom: 14, backgroundColor: "rgba(255,255,255,0.06)" }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "rgba(255,255,255,0.75)", textAlign: "center" }}>
                    {t("pricingModal.manageOnWeb")}
                  </Text>
                </View>
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
              <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff" }}>{mxnDuo ? fmtMxn(pricing.duo_monthly!) : "$23.99"}</Text>
              <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{t("products.duo.priceUnit")}</Text>
            </View>
            <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>{mxnDuo ? t("products.duo.annualMxn", { yearly: fmtMxn(pricing.duo_yearly!) }) : t("products.duo.annual")}</Text>

            {/* Diego, 2026-09-15: "Contratar Duo Plan →" was the same kind
                of subscribe CTA as the Premium button above — replaced
                with the same non-actionable info box. */}
            <View style={{ backgroundColor: "rgba(99,102,241,0.15)", borderWidth: 1, borderColor: "rgba(99,102,241,0.35)", borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: "#818cf8", textAlign: "center" }}>
                {t("pricingModal.manageOnWeb")}
              </Text>
            </View>

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
              <TouchableOpacity
                key={i}
                activeOpacity={0.85}
                onPress={() => setSelectedKey(`${p.offer}:${p.variant}`)}
                style={{ borderRadius: 18, borderWidth: 1, padding: 14, backgroundColor: colors.card, borderColor: colors.border }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <Text style={{ fontSize: 20 }}>{p.emoji}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text, flex: 1 }}>{p.title}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim ?? colors.textMuted} />
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
                  <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(0,212,126,0.08)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 }}>
                    <Text style={{ fontSize: 9, fontWeight: "800", color: "#00d47e" }}>{p.note}</Text>
                  </View>
                )}

                {/* First feature as a teaser — full list + the paywall
                    (price recap, "pay on web" info, Calendly-after-pay
                    note for sessions) lives in OneTimeProductModal, tapped
                    open from anywhere on this card. */}
                <Text style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 4 }} numberOfLines={1}>
                  {p.features[0]}
                </Text>
              </TouchableOpacity>
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

      <OneTimeProductModal
        visible={!!selectedProduct}
        onClose={() => setSelectedKey(null)}
        product={selectedProduct}
      />
    </View>
  );
}
