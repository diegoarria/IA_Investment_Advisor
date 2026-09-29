import React from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";

export interface OneTimeProduct {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  features: string[];
  priceFree?: string;
  pricePremium?: string;
  note?: string;
  offer: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  product: OneTimeProduct | null;
}

// Diego, 2026-09-15: "quiero que les crees su paywall como el de las
// suscripciones y como el de ChatGPT" — same visual language as
// PaywallModal (hero emoji, feature checklist, trust-building framing)
// instead of the compact inline card, for the one-time products (1:1
// session, session pack).
//
// Payment flow, per Diego: card entry is web-only (Apple 3.1.1 — no
// purchase CTA on mobile at all, see pricingModal.manageOnWeb elsewhere
// in the app), and the Calendly booking link is only ever handed out
// AFTER that web purchase completes (frontend/web's /upsell-success
// page gates it on a verified payment). So this modal must never itself
// link to Calendly — only tell the user it's coming once they've paid
// on the web.
export default function OneTimeProductModal({ visible, onClose, product }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  if (!product) return null;
  const isSession = product.offer === "session";

  // Redesign 2026-09-28 — same look as the Products screen: an emerald
  // gradient hero (icon, title, price) over a clean features card. Still no
  // purchase CTA on mobile (see above).
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.bg, borderColor: colors.accent + "40" }]}>
          <ScrollView style={s.scrollFlex} contentContainerStyle={{ paddingBottom: 36 }} showsVerticalScrollIndicator={false} bounces={false}>

            {/* Hero */}
            <View style={s.hero}>
              <LinearGradient
                colors={["#0F3326", "#0A1C1D", "#080E16"]}
                locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={[s.glow, { backgroundColor: "rgba(0,232,135,0.18)" }]} />
              <View style={s.handleRow}>
                <View style={s.handle} />
              </View>
              <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>

              <View style={s.iconWrap}>
                <Ionicons name={product.icon} size={28} color="#06120D" />
              </View>
              <Text style={s.title}>{product.title}</Text>

              <View style={s.priceRow}>
                {product.pricePremium && <Text style={s.price}>{product.pricePremium}</Text>}
              </View>
              {product.priceFree && (
                <Text style={s.priceFree}>
                  {t("products.oneTime.freeLabel")} <Text style={{ fontWeight: "800", color: "#fff" }}>{product.priceFree}</Text>
                </Text>
              )}
              {product.note && (
                <View style={s.noteBadge}>
                  <Ionicons name="pricetag" size={11} color="#00D47E" />
                  <Text style={s.noteBadgeText}>{product.note}</Text>
                </View>
              )}
            </View>

            <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
              {/* Features */}
              <View style={[s.featuresCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {product.features.map((f, i) => (
                  <View key={i} style={s.featRow}>
                    <View style={[s.featCheck, { backgroundColor: colors.accent + "26" }]}>
                      <Ionicons name="checkmark" size={12} color={colors.accentLight} />
                    </View>
                    <Text style={[s.featText, { color: colors.text }]}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* How to get it (web only — no purchase CTA on mobile) */}
              <View style={[s.ctaInfo, { backgroundColor: colors.accent + "14", borderColor: colors.accent + "40" }]}>
                <View style={[s.ctaIcon, { backgroundColor: colors.accent }]}>
                  <Ionicons name="globe-outline" size={16} color="#fff" />
                </View>
                <Text style={[s.ctaInfoText, { color: colors.text }]}>
                  {isSession || product.offer === "broker_call" ? t("products.oneTime.bookOnWeb") : t("pricingModal.manageOnWeb")}
                </Text>
              </View>

              {isSession && (
                <View style={[s.calendlyNote, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Ionicons name="calendar-outline" size={16} color={colors.accentLight} />
                  <Text style={[s.calendlyNoteText, { color: colors.textSub }]}>
                    {t("products.oneTime.calendlyAfterPay")}
                  </Text>
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: "90%", overflow: "hidden" },
  scrollFlex: { flexShrink: 1 },

  hero: { alignItems: "center", paddingHorizontal: 22, paddingBottom: 26, overflow: "hidden" },
  glow: { position: "absolute", top: -90, right: -70, width: 240, height: 240, borderRadius: 120 },
  handleRow: { alignItems: "center", paddingTop: 12, paddingBottom: 6, alignSelf: "stretch" },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  closeBtn: {
    position: "absolute", top: 14, right: 16, zIndex: 10, width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
  },
  iconWrap: {
    width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "#00D47E", marginTop: 14, marginBottom: 14,
    shadowColor: "#00D47E", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
  },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, textAlign: "center", color: "#fff" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 12 },
  price: { fontSize: 38, fontWeight: "800", letterSpacing: -1.3, color: "#fff" },
  priceFree: { fontSize: 13, color: "rgba(255,255,255,0.65)", marginTop: 4 },
  noteBadge: {
    flexDirection: "row", alignItems: "center", gap: 5, marginTop: 12,
    borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5,
    backgroundColor: "rgba(0,212,126,0.14)", borderColor: "rgba(0,212,126,0.4)",
  },
  noteBadgeText: { fontSize: 11.5, fontWeight: "800", color: "#00D47E" },

  featuresCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 14, gap: 13 },
  featRow: { flexDirection: "row", alignItems: "flex-start", gap: 11 },
  featCheck: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 0.5 },
  featText: { fontSize: 14.5, lineHeight: 21, flex: 1 },

  ctaInfo: {
    width: "100%", flexDirection: "row", alignItems: "center", gap: 12,
    borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 12,
  },
  ctaIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  ctaInfoText: { flex: 1, fontSize: 14, fontWeight: "700", lineHeight: 20 },

  calendlyNote: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderRadius: 16, padding: 14 },
  calendlyNoteText: { flex: 1, fontSize: 13, lineHeight: 19 },
});
