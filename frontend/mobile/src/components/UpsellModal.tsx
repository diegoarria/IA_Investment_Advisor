import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, Linking, StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

const OFFER_META = {
  annual_report: {
    emoji: "📊",
    title: "Reporte Anual de Madurez Inversora",
    subtitle: "Tu evolución como inversor, documentada",
    color: "#8b5cf6",
    badge: "Edición anual",
    features: [
      "Evolución mes a mes de tu Puntuación de Madurez (1-100)",
      "Análisis de tu perfil de riesgo y comportamiento inversor",
      "Perfil de riesgo real vs. declarado al registrarte",
      "Recomendaciones de tu Mentor IA para el próximo año",
      'Certificado digital: "Inversor Informado — Nuvos AI"',
    ],
    ctaLabel: "Obtener mi reporte",
  },
  family_plan: {
    emoji: "👫",
    title: "Plan Dúo",
    subtitle: "Dos cuentas Premium, una sola factura",
    color: "#3b82f6",
    badge: "Disponible",
    features: [
      "Todo lo de Premium para dos cuentas independientes",
      "Una sola factura, perfiles separados",
      "Portafolios independientes con análisis separado",
      "Privacidad total — sin datos compartidos entre cuentas",
    ],
    ctaLabel: "Activar Plan Dúo",
  },
  session: {
    emoji: "🎯",
    title: "Sesión 1:1 con Diego",
    subtitle: "45 minutos con el fundador de Nuvos AI",
    color: "#00d47e",
    badge: "Agenda disponible",
    features: [
      "Videollamada de 45 min con Diego Arria, fundador de Nuvos AI",
      "Revisión de tu puntuación de madurez inversora",
      "Análisis de tu portafolio y estrategia de inversión",
      "3 próximos pasos concretos para tu situación específica",
      "Grabación de la sesión entregada después de la llamada",
    ],
    ctaLabel: "Reservar sesión",
  },
};

export default function UpsellModal({
  visible, offer, userTier, prices, triggerSource, onClose,
}: UpsellModalProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<"default" | "bundle">("default");
  const [duoVariant, setDuoVariant] = useState<"monthly" | "yearly">("monthly");

  const meta = OFFER_META[offer];
  const isPremium = userTier === "premium";
  const c = meta.color;

  const displayPrice =
    offer === "family_plan"
      ? duoVariant === "monthly"
        ? `$${prices.monthly ?? 19.99}/mes`
        : `$${prices.yearly ?? 199.99}/año`
      : isPremium
      ? `$${variant === "bundle" ? (prices.bundle ?? 247) : (prices.premium ?? 0)}`
      : `$${prices.free ?? 0}`;

  const handlePurchase = async () => {
    setLoading(true);
    try {
      const res = await api.post("/api/upsells/checkout", {
        offer,
        variant: offer === "family_plan" ? duoVariant : variant === "bundle" ? "bundle" : userTier,
        trigger_source: triggerSource,
      });
      if (res.data?.url) Linking.openURL(res.data.url);
    } catch {}
    setLoading(false);
  };

  const handleDismiss = async () => {
    try {
      await api.post("/api/upsells/dismiss", {
        offer_type: offer,
        user_tier: userTier,
        trigger_source: triggerSource,
      });
    } catch {}
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleDismiss}>
      {/* Backdrop */}
      <Pressable style={s.backdrop} onPress={handleDismiss}>
        <Pressable style={[s.sheet, { backgroundColor: colors.card, borderColor: c + "35" }]} onPress={() => {}}>

          {/* Top accent bar — gradient simulated with solid */}
          <View style={[s.accentBar, { backgroundColor: c }]} />

          <ScrollView
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
                      {v === "default" ? "1 sesión" : "Pack 3 sesiones"}
                    </Text>
                    <Text style={[s.pickerPrice, { color: variant === v ? "#fff" : colors.textSub }]}>
                      {v === "default" ? `$${prices.premium ?? 99}` : `$${prices.bundle ?? 247}`}
                    </Text>
                    {v === "bundle" && (
                      <Text style={[s.pickerSave, { color: variant === v ? "rgba(255,255,255,0.75)" : colors.textDim }]}>
                        Ahorra ${Math.round(((prices.premium ?? 99) * 3) - (prices.bundle ?? 247))}
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
                      {v === "monthly" ? "Mensual" : "Anual"}
                    </Text>
                    <Text style={[s.pickerPrice, { color: duoVariant === v ? "#fff" : colors.textSub }]}>
                      {v === "monthly" ? `$${prices.monthly ?? 19.99}/mes` : `$${prices.yearly ?? 199.99}/año`}
                    </Text>
                    {v === "yearly" && (
                      <Text style={[s.pickerSave, { color: duoVariant === v ? "rgba(255,255,255,0.75)" : colors.textDim }]}>
                        Ahorra ${Math.round(((prices.monthly ?? 19.99) * 12) - (prices.yearly ?? 199.99))}
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
                    {isPremium ? "· Precio exclusivo Premium" : "pago único"}
                  </Text>
                )}
              </View>
              {isPremium && (
                <View style={s.premiumBadgeRow}>
                  <Ionicons name="star" size={11} color={c} />
                  <Text style={[s.premiumBadgeText, { color: c }]}>Precio exclusivo Premium</Text>
                </View>
              )}
            </View>

            {/* ── Free nudge ─────────────────────────────── */}
            {!isPremium && (
              <Text style={[s.nudge, { color: colors.textDim }]}>
                ¿Aún no eres Premium? Suscríbete y obtén precio especial.
              </Text>
            )}
          </ScrollView>

          {/* ── CTA footer ─────────────────────────────────── */}
          <View style={[s.footer, { borderTopColor: c + "15" }]}>
            <TouchableOpacity
              onPress={handlePurchase}
              disabled={loading}
              activeOpacity={0.85}
              style={[s.ctaBtn, { backgroundColor: c, shadowColor: c, opacity: loading ? 0.6 : 1 }]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Text style={s.ctaText}>{meta.ctaLabel}</Text>
                  <Ionicons name="arrow-forward" size={16} color="#fff" />
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDismiss} style={s.laterBtn}>
              <Text style={[s.laterText, { color: colors.textDim }]}>Quizás más adelante</Text>
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
  laterBtn:       { alignItems: "center", paddingVertical: 6 },
  laterText:      { fontSize: 13 },
});
