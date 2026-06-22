import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  ActivityIndicator, Linking, StyleSheet,
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
      "Los 3 sesgos que más afectaron tus decisiones este año",
      "Perfil de riesgo real vs. declarado al registrarte",
      "Recomendaciones de tu Mentor IA para el próximo año",
      "Certificado digital: «Inversor Informado — Nuvos AI»",
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
      "Una sola factura, perfiles y portafolios separados",
      "Seguimiento de sesgos independiente por cuenta",
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
      "Videollamada de 45 min con Diego Arria, fundador",
      "Revisión de tu historial de sesgos y madurez inversora",
      "Análisis de tu portafolio y estrategia de inversión",
      "3 próximos pasos concretos para tu situación",
      "Grabación entregada después de la llamada",
    ],
    ctaLabel: "Reservar sesión",
  },
};

export default function UpsellModal({ visible, offer, userTier, prices, triggerSource, onClose }: UpsellModalProps) {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [variant, setVariant] = useState<"default" | "bundle">("default");
  const [duoVariant, setDuoVariant] = useState<"monthly" | "yearly">("monthly");

  const meta = OFFER_META[offer];
  const isPremium = userTier === "premium";

  const displayPrice =
    offer === "family_plan"
      ? duoVariant === "monthly" ? `$${prices.monthly ?? 19.99}/mes` : `$${prices.yearly ?? 199.99}/año`
      : variant === "bundle" ? `$${prices.bundle ?? 247}`
      : isPremium ? `$${prices.premium ?? 0}`
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
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: meta.color + "35" }]}>
          {/* Color bar */}
          <View style={[s.bar, { backgroundColor: meta.color }]} />

          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={s.header}>
              <View style={[s.emojiBox, { backgroundColor: meta.color + "18" }]}>
                <Text style={s.emoji}>{meta.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={[s.badge, { backgroundColor: meta.color + "18" }]}>
                  <Text style={[s.badgeText, { color: meta.color }]}>{meta.badge}</Text>
                </View>
                <Text style={[s.title, { color: colors.text }]}>{meta.title}</Text>
                <Text style={[s.subtitle, { color: colors.textMuted }]}>{meta.subtitle}</Text>
              </View>
              <TouchableOpacity onPress={handleDismiss} style={s.closeBtn}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Features */}
            {meta.features.map((f) => (
              <View key={f} style={s.feature}>
                <View style={[s.check, { backgroundColor: meta.color + "18" }]}>
                  <Ionicons name="checkmark" size={12} color={meta.color} />
                </View>
                <Text style={[s.featureText, { color: colors.textSub }]}>{f}</Text>
              </View>
            ))}

            {/* Bundle picker (session + premium only) */}
            {offer === "session" && isPremium && (
              <View style={[s.picker, { backgroundColor: colors.bgRaised }]}>
                {(["default", "bundle"] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setVariant(v)}
                    style={[s.pickerOption, variant === v && { backgroundColor: meta.color }]}
                  >
                    <Text style={[s.pickerLabel, { color: variant === v ? "#fff" : colors.textMuted }]}>
                      {v === "default" ? "1 sesión" : "Pack 3 sesiones"}
                    </Text>
                    <Text style={[s.pickerPrice, { color: variant === v ? "#fff" : colors.textSub }]}>
                      {v === "default" ? `$${prices.premium ?? 99}` : `$${prices.bundle ?? 247}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Duo plan billing picker */}
            {offer === "family_plan" && (
              <View style={[s.picker, { backgroundColor: colors.bgRaised }]}>
                {(["monthly", "yearly"] as const).map((v) => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setDuoVariant(v)}
                    style={[s.pickerOption, duoVariant === v && { backgroundColor: meta.color }]}
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

            {/* Price callout */}
            <View style={[s.callout, { backgroundColor: meta.color + "0d", borderColor: meta.color + "25" }]}>
              <Text style={[s.mainPrice, { color: colors.text }]}>{displayPrice}</Text>
              {isPremium && (
                <View style={s.premiumBadge}>
                  <Ionicons name="star" size={10} color={meta.color} />
                  <Text style={[s.premiumText, { color: meta.color }]}>Precio exclusivo Premium</Text>
                </View>
              )}
            </View>

            {!isPremium && (
              <Text style={[s.nudge, { color: colors.textDim }]}>
                ¿Aún no eres Premium? Suscríbete y obtén precio especial.
              </Text>
            )}
          </ScrollView>

          {/* CTA */}
          <View style={[s.footer, { borderTopColor: meta.color + "15" }]}>
            <TouchableOpacity
              onPress={handlePurchase}
              disabled={loading}
              style={[s.ctaBtn, { backgroundColor: meta.color }]}
              activeOpacity={0.85}
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
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:      { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.75)" },
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, maxHeight: "92%", overflow: "hidden" },
  bar:          { height: 4 },
  content:      { padding: 20, gap: 12, paddingBottom: 8 },
  header:       { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  emojiBox:     { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  emoji:        { fontSize: 24 },
  badge:        { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginBottom: 4 },
  badgeText:    { fontSize: 10, fontWeight: "800" },
  title:        { fontSize: 15, fontWeight: "900", lineHeight: 20 },
  subtitle:     { fontSize: 12, marginTop: 2 },
  closeBtn:     { padding: 6 },
  feature:      { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  check:        { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", marginTop: 1 },
  featureText:  { flex: 1, fontSize: 13, lineHeight: 18 },
  picker:       { flexDirection: "row", borderRadius: 12, padding: 4, gap: 4 },
  pickerOption: { flex: 1, borderRadius: 10, padding: 10, alignItems: "center" },
  pickerLabel:  { fontSize: 12, fontWeight: "700" },
  pickerPrice:  { fontSize: 14, fontWeight: "900", marginTop: 2 },
  pickerSave:   { fontSize: 10, marginTop: 2 },
  callout:      { borderRadius: 14, borderWidth: 1, padding: 12 },
  savingsText:  { fontSize: 12, marginBottom: 4 },
  mainPrice:    { fontSize: 26, fontWeight: "900" },
  premiumBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  premiumText:  { fontSize: 11, fontWeight: "700" },
  nudge:        { fontSize: 11, textAlign: "center" },
  footer:       { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1, gap: 8 },
  ctaBtn:       { borderRadius: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  ctaText:      { color: "#fff", fontSize: 15, fontWeight: "900" },
  laterBtn:     { alignItems: "center", paddingVertical: 6 },
  laterText:    { fontSize: 12 },
});
