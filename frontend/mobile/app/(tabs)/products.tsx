import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

type OneTimeItem = {
  icon: IoniconName;
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
      icon: "phone-portrait-outline",
      title: items[0].title,
      features: items[0].features,
      priceFree: sessMxn ? `${fmtMxn(pr.session_free!)} MXN` : "$149 USD",
      pricePremium: sessMxn ? `${fmtMxn(pr.session_premium!)} MXN` : "$99 USD",
      offer: "session",
      variant: "default",
    },
    {
      icon: "cube-outline",
      title: items[1].title,
      features: items[1].features,
      pricePremium: sessMxn ? `${fmtMxn(pr.session_bundle!)} MXN` : "$247 USD",
      note: items[1].note,
      offer: "session",
      variant: "bundle",
    },
    {
      icon: "call-outline",
      title: items[2].title,
      features: items[2].features,
      pricePremium: pr.currency === "mxn" && pr.broker_call != null ? `${fmtMxn(pr.broker_call)} MXN` : "$20 USD",
      offer: "broker_call",
      variant: "default",
    },
  ];
}

function getComingSoonItems(t: TFunction): { icon: IoniconName; title: string; desc: string }[] {
  const items = t("products.comingSoon.items", { returnObjects: true }) as { title: string; desc: string }[];
  return [
    { icon: "link-outline", title: items[0].title, desc: items[0].desc },
    { icon: "trending-up-outline", title: items[1].title, desc: items[1].desc },
  ];
}

// Products — redesigned 2026-09-28 (Diego: "más atractivo, más llamativo,
// manteniendo estándar de marca"). Same copy, prices and flows; line icons
// instead of emoji, gradient plan cards, Premium featured first.
function SectionTitle({ icon, title, colors }: { icon: IoniconName; title: string; colors: any }) {
  return (
    <View style={ss.sectionRow}>
      <View style={[ss.sectionIcon, { backgroundColor: colors.accent + "1A" }]}>
        <Ionicons name={icon} size={15} color={colors.accentLight} />
      </View>
      <Text style={[ss.sectionTitle, { color: colors.text }]}>{title}</Text>
    </View>
  );
}

function Feature({ text, tint, textColor, muted }: { text: string; tint: string; textColor: string; muted?: boolean }) {
  return (
    <View style={ss.feature}>
      <View style={[ss.featureCheck, { backgroundColor: muted ? "transparent" : tint + "26", borderColor: muted ? tint + "55" : "transparent" }]}>
        <Ionicons name="checkmark" size={11} color={tint} />
      </View>
      <Text style={[ss.featureText, { color: textColor }]}>{text}</Text>
    </View>
  );
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
      <ScrollView contentContainerStyle={ss.content} showsVerticalScrollIndicator={false}>

        {/* ── Intro hero ── */}
        <View style={[ss.hero, { borderColor: colors.accent + "40" }]}>
          <LinearGradient
            colors={[colors.accent + "33", colors.accent + "0D", colors.card]}
            locations={[0, 0.5, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={[ss.glow, { backgroundColor: colors.accentLight + "1A" }]} />
          <View style={[ss.heroIcon, { backgroundColor: colors.accent }]}>
            <Ionicons name="sparkles" size={20} color="#fff" />
          </View>
          <Text style={[ss.heroTitle, { color: colors.text }]}>{t("products.heroTitle")}</Text>
          <Text style={[ss.heroSub, { color: colors.textSub }]}>{t("products.heroSubtitle")}</Text>
        </View>

        {/* ── Suscripción ── */}
        <View>
          <SectionTitle icon="ribbon-outline" title={t("products.subscriptionTitle")} colors={colors} />

          <View style={{ gap: 14 }}>
            {/* Premium — featured first */}
            <View style={[ss.planCard, ss.premiumCard]}>
              <LinearGradient
                colors={["#0F3326", "#0A1C1D", "#080E16"]}
                locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={[ss.glow, { backgroundColor: "rgba(0,232,135,0.16)" }]} />

              <View style={ss.planTop}>
                <View style={[ss.planIcon, { backgroundColor: "#00D47E" }]}>
                  <Ionicons name="diamond" size={18} color="#06120D" />
                </View>
                <Text style={[ss.planName, { color: "#fff", flex: 1 }]}>{t("products.premium.name")}</Text>
                {isPremium && (
                  <View style={[ss.pill, { backgroundColor: "rgba(0,212,126,0.18)", borderColor: "rgba(0,212,126,0.45)" }]}>
                    <Ionicons name="checkmark-circle" size={12} color="#00D47E" />
                    <Text style={[ss.pillText, { color: "#00D47E" }]}>{t("products.premium.yourPlan")}</Text>
                  </View>
                )}
              </View>

              <View style={ss.priceRow}>
                <Text style={[ss.price, { color: "#fff" }]}>{mxnPremium ? fmtMxn(pricing.monthly!) : "$14.99"}</Text>
                <Text style={[ss.priceUnit, { color: "rgba(255,255,255,0.6)" }]}>{t("products.premium.priceUnit")}</Text>
              </View>
              <Text style={[ss.priceNote, { color: "rgba(255,255,255,0.55)" }]}>
                {mxnPremium ? t("products.premium.thenPriceMxn", { monthly: fmtMxn(pricing.monthly!), yearly: fmtMxn(pricing.yearly!) }) : t("products.premium.thenPrice")}
              </Text>

              {!isPremium ? (
                // Diego, 2026-09-15: no purchase wording on mobile (Apple IAP
                // rules, "tal como lo hace Spotify") — non-actionable info box.
                <View style={[ss.infoBox, { backgroundColor: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.14)" }]}>
                  <Ionicons name="globe-outline" size={15} color="rgba(255,255,255,0.85)" />
                  <Text style={[ss.infoText, { color: "rgba(255,255,255,0.85)" }]}>{t("pricingModal.manageOnWeb")}</Text>
                </View>
              ) : (
                <View style={[ss.infoBox, { backgroundColor: "rgba(0,212,126,0.12)", borderColor: "rgba(0,212,126,0.35)" }]}>
                  <Ionicons name="shield-checkmark" size={15} color="#00D47E" />
                  <Text style={[ss.infoText, { color: "#00D47E" }]}>{t("products.premium.active")}</Text>
                </View>
              )}

              <View style={[ss.divider, { backgroundColor: "rgba(255,255,255,0.1)" }]} />
              {PREMIUM_FEATURES.map((f, i) => (
                <Feature key={i} text={f} tint="#00D47E" textColor="rgba(255,255,255,0.88)" />
              ))}
            </View>

            {/* Free */}
            <View style={[ss.planCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={ss.planTop}>
                <View style={[ss.planIcon, { backgroundColor: colors.accent + "1A" }]}>
                  <Ionicons name="leaf-outline" size={18} color={colors.accentLight} />
                </View>
                <Text style={[ss.planName, { color: colors.text, flex: 1 }]}>{t("products.free.name")}</Text>
                {!isPremium && (
                  <View style={[ss.pill, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                    <Text style={[ss.pillText, { color: colors.textSub }]}>{t("products.free.currentPlan")}</Text>
                  </View>
                )}
              </View>
              <View style={ss.priceRow}>
                <Text style={[ss.price, { color: colors.text }]}>$0</Text>
                <Text style={[ss.priceUnit, { color: colors.textMuted }]}>{t("products.free.priceUnit")}</Text>
              </View>
              <View style={[ss.divider, { backgroundColor: colors.border }]} />
              {FREE_FEATURES.map((f, i) => (
                <Feature key={i} text={f} tint={colors.textSub} textColor={colors.textSub} muted />
              ))}
            </View>
          </View>
        </View>

        {/* ── Duo Plan ── */}
        <View>
          <SectionTitle icon="people-outline" title={t("products.duo.title")} colors={colors} />
          <View style={[ss.planCard, { borderColor: "rgba(129,140,248,0.45)", backgroundColor: "#0B0E22" }]}>
            <LinearGradient
              colors={["#1E2256", "#11142E", "#0A0C1C"]}
              locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={[ss.glow, { backgroundColor: "rgba(129,140,248,0.18)" }]} />
            <View style={ss.planTop}>
              <View style={[ss.planIcon, { backgroundColor: "#818CF8" }]}>
                <Ionicons name="people" size={18} color="#0B0E22" />
              </View>
              <Text style={[ss.planName, { color: "#fff", flex: 1 }]}>{t("products.duo.title")}</Text>
              <View style={[ss.pill, { backgroundColor: "rgba(129,140,248,0.18)", borderColor: "rgba(129,140,248,0.45)" }]}>
                <Text style={[ss.pillText, { color: "#A5B4FC" }]}>{t("products.duo.new")}</Text>
              </View>
            </View>
            <View style={ss.priceRow}>
              <Text style={[ss.price, { color: "#fff" }]}>{mxnDuo ? fmtMxn(pricing.duo_monthly!) : "$23.99"}</Text>
              <Text style={[ss.priceUnit, { color: "rgba(255,255,255,0.6)" }]}>{t("products.duo.priceUnit")}</Text>
            </View>
            <Text style={[ss.priceNote, { color: "rgba(255,255,255,0.55)" }]}>
              {mxnDuo ? t("products.duo.annualMxn", { yearly: fmtMxn(pricing.duo_yearly!) }) : t("products.duo.annual")}
            </Text>
            {/* Diego, 2026-09-15: same non-actionable info box as Premium. */}
            <View style={[ss.infoBox, { backgroundColor: "rgba(129,140,248,0.14)", borderColor: "rgba(129,140,248,0.4)" }]}>
              <Ionicons name="globe-outline" size={15} color="#A5B4FC" />
              <Text style={[ss.infoText, { color: "#A5B4FC" }]}>{t("pricingModal.manageOnWeb")}</Text>
            </View>
            <View style={[ss.divider, { backgroundColor: "rgba(255,255,255,0.1)" }]} />
            {DUO_PLAN_FEATURES.map((f, i) => (
              <Feature key={i} text={f} tint="#A5B4FC" textColor="rgba(255,255,255,0.88)" />
            ))}
          </View>
        </View>

        {/* ── Pago único ── */}
        <View>
          <SectionTitle icon="flash-outline" title={t("products.oneTime.title")} colors={colors} />
          <View style={{ gap: 12 }}>
            {ONE_TIME.map((p, i) => (
              <TouchableOpacity
                key={i}
                activeOpacity={0.88}
                onPress={() => setSelectedKey(`${p.offer}:${p.variant}`)}
                style={[ss.otCard, { backgroundColor: colors.card, borderColor: p.variant === "bundle" ? colors.accent + "59" : colors.border }]}
              >
                {p.variant === "bundle" && (
                  <LinearGradient
                    colors={[colors.accent + "1F", colors.card]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                )}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={[ss.otIcon, { backgroundColor: colors.accent + "1A", borderColor: colors.accent + "33" }]}>
                    <Ionicons name={p.icon} size={21} color={colors.accentLight} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[ss.otTitle, { color: colors.text }]} numberOfLines={2}>{p.title}</Text>
                    <Text style={[ss.otTeaser, { color: colors.textSub }]} numberOfLines={1}>{p.features[0]}</Text>
                  </View>
                  <View style={[ss.otChevron, { backgroundColor: colors.accent }]}>
                    <Ionicons name="arrow-forward" size={15} color="#fff" />
                  </View>
                </View>

                <View style={[ss.otPriceRow, { borderTopColor: colors.border }]}>
                  {p.pricePremium && (
                    <Text style={[ss.otPrice, { color: colors.accentLight }]}>{p.pricePremium}</Text>
                  )}
                  {p.priceFree && (
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>
                      {t("products.oneTime.freeLabel")} <Text style={{ fontWeight: "800", color: colors.textSub }}>{p.priceFree}</Text>
                    </Text>
                  )}
                  {p.note && (
                    <View style={[ss.pill, { backgroundColor: colors.accent + "1A", borderColor: colors.accent + "40", marginLeft: "auto" }]}>
                      <Ionicons name="pricetag" size={11} color={colors.accentLight} />
                      <Text style={[ss.pillText, { color: colors.accentLight }]}>{p.note}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Próximamente ── */}
        <View>
          <SectionTitle icon="time-outline" title={t("products.comingSoon.title")} colors={colors} />
          <View style={{ gap: 10 }}>
            {COMING_SOON.map((p, i) => (
              <View key={i} style={[ss.soonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[ss.otIcon, { backgroundColor: "rgba(129,140,248,0.12)", borderColor: "rgba(129,140,248,0.3)" }]}>
                  <Ionicons name={p.icon} size={20} color="#818CF8" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text, letterSpacing: -0.2 }}>{p.title}</Text>
                    <View style={[ss.pill, { backgroundColor: "rgba(129,140,248,0.12)", borderColor: "rgba(129,140,248,0.35)" }]}>
                      <Text style={[ss.pillText, { color: "#818CF8" }]}>{t("products.comingSoon.soon")}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 13, color: colors.textSub, lineHeight: 19 }}>{p.desc}</Text>
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

const ss = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 30 },

  hero: { borderRadius: 24, borderWidth: 1, padding: 22, overflow: "hidden" },
  glow: { position: "absolute", top: -90, right: -70, width: 220, height: 220, borderRadius: 110 },
  heroIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  heroTitle: { fontSize: 24, fontWeight: "800", letterSpacing: -0.6, lineHeight: 29 },
  heroSub: { fontSize: 14, lineHeight: 20, marginTop: 6 },

  sectionRow: { flexDirection: "row", alignItems: "center", gap: 9, marginBottom: 14 },
  sectionIcon: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 19, fontWeight: "800", letterSpacing: -0.4 },

  planCard: { borderRadius: 24, borderWidth: 1, padding: 20, overflow: "hidden" },
  premiumCard: {
    borderColor: "rgba(0,212,126,0.45)", backgroundColor: "#080E16",
    shadowColor: "#00D47E", shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  planTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  planIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  planName: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.4 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 18 },
  price: { fontSize: 38, fontWeight: "800", letterSpacing: -1.3 },
  priceUnit: { fontSize: 13, fontWeight: "600" },
  priceNote: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  infoBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 12, marginTop: 16,
  },
  infoText: { fontSize: 13, fontWeight: "700", textAlign: "center", flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 18 },
  feature: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 11 },
  featureCheck: { width: 19, height: 19, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 0.5 },
  featureText: { fontSize: 14, lineHeight: 20, flex: 1 },

  otCard: { borderRadius: 20, borderWidth: 1, padding: 16, overflow: "hidden" },
  otIcon: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  otTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  otTeaser: { fontSize: 12.5, marginTop: 3 },
  otChevron: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  otPriceRow: {
    flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 10,
    marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth,
  },
  otPrice: { fontSize: 24, fontWeight: "800", letterSpacing: -0.6 },

  soonCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 13,
    borderRadius: 20, borderWidth: 1, borderStyle: "dashed", padding: 16,
  },
});
