import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../lib/ThemeContext";
import api from "../lib/api";
import type { UpsellOffer } from "../lib/upsellStore";

interface UpsellModalProps {
  visible: boolean;
  offer: UpsellOffer;
  userTier: "free" | "premium";
  prices: Record<string, number>;
  triggerSource?: string;
  onClose: () => void;
}

function getOfferMeta(t: TFunction) {
  return {
    family_plan: {
      emoji: "👫",
      title: t("upsellModal.offers.familyPlan.title"),
      subtitle: t("upsellModal.offers.familyPlan.subtitle"),
      color: "#3b82f6",
      badge: t("upsellModal.offers.familyPlan.badge"),
      features: t("upsellModal.offers.familyPlan.features", { returnObjects: true }) as string[],
      ctaLabel: t("upsellModal.offers.familyPlan.ctaLabel"),
    },
    session: {
      emoji: "🎯",
      title: t("upsellModal.offers.session.title"),
      subtitle: t("upsellModal.offers.session.subtitle"),
      color: "#00d47e",
      badge: t("upsellModal.offers.session.badge"),
      features: t("upsellModal.offers.session.features", { returnObjects: true }) as string[],
      ctaLabel: t("upsellModal.offers.session.ctaLabel"),
    },
  };
}

export default function UpsellModal({
  visible, offer, userTier, prices, triggerSource, onClose,
}: UpsellModalProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [variant, setVariant] = useState<"default" | "bundle">("default");
  const [duoVariant, setDuoVariant] = useState<"monthly" | "yearly">("monthly");

  const OFFER_META = getOfferMeta(t);
  const meta = OFFER_META[offer];
  const isPremium = userTier === "premium";
  const c = meta.color;

  const displayPrice =
    offer === "family_plan"
      ? duoVariant === "monthly"
        ? `$${prices.monthly ?? 23.99}${t("upsellModal.perMonth")}`
        : `$${prices.yearly ?? 224.99}${t("upsellModal.perYear")}`
      : isPremium
      ? `$${variant === "bundle" ? (prices.bundle ?? 247) : (prices.premium ?? 0)}`
      : `$${prices.free ?? 0}`;

  // Diego, 2026-09-15: closing must never wait on the network — this used
  // to `await` the dismiss-tracking call before calling onClose(), so a
  // slow/unreachable backend (this call has no timeout) left the modal
  // stuck open with no way out, since the CTA-removal for Apple IAP
  // compliance made "Ahora no" / X / the backdrop the ONLY ways to leave
  // this modal. Close immediately; track the dismissal in the background.
  const handleDismiss = () => {
    onClose();
    api.post("/api/upsells/dismiss", {
      offer_type: offer,
      user_tier: userTier,
      trigger_source: triggerSource,
    }).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={handleDismiss}>
        <Pressable style={[s.sheet, { backgroundColor: colors.card, borderColor: c + "35" }]} onPress={() => {}}>

          {/* Top accent bar — gradient simulated with solid */}
          <View style={[s.accentBar, { backgroundColor: c }]} />

          {/* Same fix as PaywallModal.tsx (2026-09-15): `sheet` caps height
              with maxHeight + overflow:"hidden", but without
              style={{ flex: 1 }} here the ScrollView renders at full
              content height and never becomes scrollable. */}
          <ScrollView
            style={s.scrollFlex}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ── Header ─────────────────────────────────── */}
            <View style={s.header}>
              <View style={s.headerLeft}>
                {/* Emoji box */}
                <View style={[s.emojiBox, { backgroundColor: c + "18" }]}>
                  <Text style={s.emoji}>{meta.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  {/* Badge */}
                  <View style={[s.badge, { backgroundColor: c + "18" }]}>
                    <Text style={[s.badgeText, { color: c }]}>{meta.badge}</Text>
                  </View>
                  <Text style={[s.title, { color: colors.text }]} numberOfLines={2}>{meta.title}</Text>
                  <Text style={[s.subtitle, { color: colors.textMuted }]}>{meta.subtitle}</Text>
                </View>
              </View>
              {/* Close */}
              <TouchableOpacity onPress={handleDismiss} style={s.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* ── Features ───────────────────────────────── */}
            <View style={s.featuresBlock}>
              {meta.features.map((f) => (
                <View key={f} style={s.featureRow}>
                  <View style={[s.checkCircle, { backgroundColor: c + "18" }]}>
                    <Ionicons name="checkmark" size={11} color={c} />
                  </View>
                  <Text style={[s.featureText, { color: colors.textSub }]}>{f}</Text>
                </View>
              ))}
            </View>

            {/* ── Bundle picker (session + premium) ──────── */}
            {offer === "session" && isPremium && (
              <View style={[s.picker, { backgroundColor: colors.bgRaised }]}>
                {(["default", "bundle"] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setVariant(v)}
                    activeOpacity={0.8}
                    style={[
                      s.pickerOption,
                      variant === v && { backgroundColor: c, shadowColor: c, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
                    ]}
                  >
                    <Text style={[s.pickerLabel, { color: variant === v ? "#fff" : colors.textMuted }]}>
                      {v === "default" ? t("upsellModal.sessionVariant.single") : t("upsellModal.sessionVariant.bundle")}
                    </Text>
                    <Text style={[s.pickerPrice, { color: variant === v ? "#fff" : colors.textSub }]}>
                      {v === "default" ? `$${prices.premium ?? 99}` : `$${prices.bundle ?? 247}`}
                    </Text>
                    {v === "bundle" && (
                      <Text style={[s.pickerSave, { color: variant === v ? "rgba(255,255,255,0.75)" : colors.textDim }]}>
                        {t("upsellModal.sessionVariant.save", { amount: Math.round(((prices.premium ?? 99) * 3) - (prices.bundle ?? 247)) })}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Duo picker ─────────────────────────────── */}
            {offer === "family_plan" && (
              <View style={[s.picker, { backgroundColor: colors.bgRaised }]}>
                {(["monthly", "yearly"] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setDuoVariant(v)}
                    activeOpacity={0.8}
                    style={[
                      s.pickerOption,
                      duoVariant === v && { backgroundColor: c, shadowColor: c, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
                    ]}
                  >
                    <Text style={[s.pickerLabel, { color: duoVariant === v ? "#fff" : colors.textMuted }]}>
                      {v === "monthly" ? t("upsellModal.duoVariant.monthly") : t("upsellModal.duoVariant.yearly")}
                    </Text>
                    <Text style={[s.pickerPrice, { color: duoVariant === v ? "#fff" : colors.textSub }]}>
                      {v === "monthly" ? `$${prices.monthly ?? 23.99}${t("upsellModal.perMonth")}` : `$${prices.yearly ?? 224.99}${t("upsellModal.perYear")}`}
                    </Text>
                    {v === "yearly" && (
                      <Text style={[s.pickerSave, { color: duoVariant === v ? "rgba(255,255,255,0.75)" : colors.textDim }]}>
                        {t("upsellModal.duoVariant.save", { amount: Math.round(((prices.monthly ?? 23.99) * 12) - (prices.yearly ?? 224.99)) })}
                      </Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Price callout ──────────────────────────── */}
            <View style={[s.priceCallout, { backgroundColor: c + "0d", borderColor: c + "25" }]}>
              <View style={s.priceRow}>
                <Text style={[s.priceMain, { color: colors.text }]}>{displayPrice}</Text>
                {offer !== "family_plan" && (
                  <Text style={[s.priceSub, { color: colors.textMuted }]}>
                    {isPremium ? t("upsellModal.premiumExclusivePrice") : t("upsellModal.oneTimePayment")}
                  </Text>
                )}
              </View>
              {isPremium && (
                <View style={s.premiumBadgeRow}>
                  <Ionicons name="star" size={11} color={c} />
                  <Text style={[s.premiumBadgeText, { color: c }]}>{t("upsellModal.premiumBadge")}</Text>
                </View>
              )}
            </View>

            {/* ── Free nudge ─────────────────────────────── */}
            {!isPremium && (
              <Text style={[s.nudge, { color: colors.textDim }]}>
                {t("upsellModal.freeNudge")}
              </Text>
            )}
          </ScrollView>

          {/* ── CTA footer ─────────────────────────────────── */}
          <View style={[s.footer, { borderTopColor: c + "15" }]}>
            <View style={[s.ctaInfo, { borderColor: c + "35" }]}>
              <Text style={[s.ctaInfoText, { color: colors.textSub }]}>{t("pricingModal.manageOnWeb")}</Text>
            </View>
            <TouchableOpacity onPress={handleDismiss} style={s.laterBtn}>
              <Text style={[s.laterText, { color: colors.textDim }]}>{t("upsellModal.maybeLater")}</Text>
            </TouchableOpacity>
          </View>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop:       { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.75)" },
  sheet:          { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: "92%", overflow: "hidden", width: "100%" },
  accentBar:      { height: 4 },

  scrollFlex:     { flex: 1 },
  scrollContent:  { padding: 20, paddingBottom: 8, gap: 16 },

  // Header
  header:         { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  headerLeft:     { flexDirection: "row", alignItems: "flex-start", gap: 12, flex: 1 },
  emojiBox:       { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  emoji:          { fontSize: 24 },
  badge:          { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginBottom: 4 },
  badgeText:      { fontSize: 10, fontWeight: "800" },
  title:          { fontSize: 15, fontWeight: "900", lineHeight: 20 },
  subtitle:       { fontSize: 12, marginTop: 2 },
  closeBtn:       { padding: 6, borderRadius: 10, marginTop: 2 },

  // Features
  featuresBlock:  { gap: 10 },
  featureRow:     { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkCircle:    { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0 },
  featureText:    { flex: 1, fontSize: 13, lineHeight: 18 },

  // Pickers
  picker:         { flexDirection: "row", borderRadius: 14, padding: 4, gap: 4 },
  pickerOption:   { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center" },
  pickerLabel:    { fontSize: 12, fontWeight: "700" },
  pickerPrice:    { fontSize: 14, fontWeight: "900", marginTop: 2 },
  pickerSave:     { fontSize: 10, marginTop: 2 },

  // Price callout
  priceCallout:   { borderRadius: 14, borderWidth: 1, padding: 14 },
  priceRow:       { flexDirection: "row", alignItems: "baseline", gap: 6 },
  priceMain:      { fontSize: 26, fontWeight: "900" },
  priceSub:       { fontSize: 12 },
  premiumBadgeRow:{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  premiumBadgeText:{ fontSize: 12, fontWeight: "600" },

  nudge:          { fontSize: 12, textAlign: "center" },

  // Footer
  footer:         { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, borderTopWidth: 1, gap: 8 },
  ctaBtn:         { borderRadius: 18, paddingVertical: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  ctaText:        { color: "#fff", fontSize: 15, fontWeight: "900" },
  ctaInfo:        { borderRadius: 18, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 12, alignItems: "center" },
  ctaInfoText:    { fontSize: 13, fontWeight: "700", textAlign: "center" },
  laterBtn:       { alignItems: "center", paddingVertical: 6 },
  laterText:      { fontSize: 13 },
});
