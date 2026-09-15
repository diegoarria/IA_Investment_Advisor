import React from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../lib/ThemeContext";

export interface OneTimeProduct {
  emoji: string;
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
// session, session pack). Deep Research isn't routed through this modal —
// it already has its own full screen (app/research/index.tsx).
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
            <Text style={s.emoji}>{product.emoji}</Text>
            <Text style={[s.title, { color: colors.text }]}>{product.title}</Text>

            <View style={s.priceRow}>
              {product.pricePremium && <Text style={[s.price, { color: colors.text }]}>{product.pricePremium}</Text>}
              {product.priceFree && (
                <Text style={{ fontSize: 12, color: colors.textMuted }}>
                  {t("products.oneTime.freeLabel")} <Text style={{ fontWeight: "800", color: colors.textSub }}>{product.priceFree}</Text>
                </Text>
              )}
            </View>
            {product.note && (
              <View style={[s.noteBadge, { backgroundColor: "rgba(0,212,126,0.1)" }]}>
                <Text style={s.noteBadgeText}>{product.note}</Text>
              </View>
            )}

            <View style={[s.featuresCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {product.features.map((f, i) => (
                <View key={i} style={s.featRow}>
                  <Ionicons name="checkmark" size={15} color="#00d47e" style={{ marginTop: 1 }} />
                  <Text style={[s.featText, { color: colors.textSub ?? colors.text }]}>{f}</Text>
                </View>
              ))}
            </View>

            <View style={[s.ctaInfo, { backgroundColor: colors.bgRaised ?? colors.border }]}>
              <Text style={[s.ctaInfoText, { color: colors.textSub ?? colors.text }]}>
                {t("pricingModal.manageOnWeb")}
              </Text>
            </View>

            {isSession && (
              <View style={[s.calendlyNote, { borderColor: colors.border }]}>
                <Ionicons name="calendar-outline" size={14} color={colors.textMuted} />
                <Text style={[s.calendlyNoteText, { color: colors.textMuted }]}>
                  {t("products.oneTime.calendlyAfterPay")}
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: "88%", overflow: "hidden" },
  handleRow: { alignItems: "center", paddingTop: 12, paddingBottom: 4 },
  handle: { width: 36, height: 4, borderRadius: 2 },
  closeBtn: { position: "absolute", top: 14, right: 16, padding: 6, zIndex: 10 },
  scroll: { paddingHorizontal: 20, paddingBottom: 36, alignItems: "center" },

  emoji: { fontSize: 44, marginTop: 8, marginBottom: 10 },
  title: { fontSize: 19, fontWeight: "900", textAlign: "center", marginBottom: 12 },

  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 6 },
  price: { fontSize: 30, fontWeight: "900" },

  noteBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 16 },
  noteBadgeText: { fontSize: 11, fontWeight: "800", color: "#00d47e" },

  featuresCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 14, gap: 10 },
  featRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  featText: { fontSize: 13, lineHeight: 19, flex: 1 },

  ctaInfo: { width: "100%", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14, alignItems: "center", marginBottom: 12 },
  ctaInfoText: { fontSize: 13, fontWeight: "700", textAlign: "center" },

  calendlyNote: { width: "100%", flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  calendlyNoteText: { flex: 1, fontSize: 11.5, lineHeight: 17 },
});
