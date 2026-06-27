import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { billingApi } from "../lib/api";

const FREE_FEATURES = [
  "Hasta 20 mensajes/día con el mentor IA",
  "Portafolio de hasta 10 acciones",
  "Watchlist de hasta 25 acciones",
  "Academia completa + quizzes",
  "Gráfico básico (5D y 1M)",
  "Noticias generales del mercado",
];

const PREMIUM_FEATURES = [
  "Mensajes ilimitados con el mentor 24/7",
  "Portafolio ilimitado — sin límite de acciones",
  "Importar portafolio desde PDF o screenshot",
  "Earnings Calendar con análisis IA por posición",
  "Stress Test con 5 escenarios históricos",
  "Análisis IA profundo de tu portafolio",
  "Screener semanal: 5 oportunidades cada lunes",
  "Noticias de TU portafolio con resumen IA",
  "Reporte mensual de performance vs S&P 500",
  "Aprende con tu portafolio (lecciones contextuales)",
  "Mentor proactivo — alertas móviles personalizadas",
  "Evaluación conductual BSCORE",
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function PricingModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const res = await billingApi.createCheckout(plan);
      const url = res?.data?.url;
      if (url) await Linking.openURL(url);
    } catch {}
    setLoading(false);
  }

  const regularPrice = plan === "monthly" ? "$12.99" : "$10.50";

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

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>

            <Text style={{ fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 4, color: colors.text }}>
              Prueba Premium gratis por 1 mes
            </Text>
            <Text style={{ fontSize: 12, textAlign: "center", marginBottom: 20, color: colors.textMuted }}>
              Cancela cuando quieras antes de que termine y no pagas nada
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
                    {p === "monthly" ? "Mensual" : "Anual −17%"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Cards */}
            <View style={{ gap: 12 }}>

              {/* Free card */}
              <View style={{ borderRadius: 20, borderWidth: 1, padding: 16, backgroundColor: colors.card, borderColor: colors.border }}>
                <Text style={{ fontSize: 16, fontWeight: "900", marginBottom: 2, color: colors.text }}>Free</Text>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                  <Text style={{ fontSize: 28, fontWeight: "900", color: colors.text }}>$0</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>USD / mes</Text>
                </View>
                <View style={{ borderRadius: 12, paddingVertical: 8, alignItems: "center", marginBottom: 14, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.textMuted }}>Tu plan actual</Text>
                </View>
                {FREE_FEATURES.map((f, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark" size={14} color={colors.textMuted} style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* Premium card */}
              <View style={{ borderRadius: 20, borderWidth: 1.5, padding: 16, borderColor: "rgba(0,212,126,0.4)", backgroundColor: "#0a1a10", overflow: "hidden" }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: "900", color: "#fff" }}>Premium</Text>
                  <View style={{ backgroundColor: "rgba(0,212,126,0.15)", borderWidth: 1, borderColor: "rgba(0,212,126,0.3)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: "900", color: "#00d47e" }}>TIEMPO LIMITADO</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                  <Text style={{ fontSize: 16, textDecorationLine: "line-through", color: "rgba(255,255,255,0.3)" }}>{regularPrice}</Text>
                  <Text style={{ fontSize: 28, fontWeight: "900", color: "#fff" }}>$0</Text>
                  <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>primer mes</Text>
                </View>
                <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>
                  Luego {regularPrice}/mes{plan === "yearly" ? " · facturado anual" : ""}
                </Text>

                <TouchableOpacity
                  onPress={handleUpgrade}
                  disabled={loading}
                  style={{ backgroundColor: loading ? "rgba(0,212,126,0.5)" : "#00d47e", borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>
                    {loading ? "Abriendo..." : "Reclamar oferta gratis"}
                  </Text>
                </TouchableOpacity>

                {PREMIUM_FEATURES.map((f, i) => (
                  <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                    <Ionicons name="checkmark" size={14} color="#00d47e" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.8)", flex: 1 }}>{f}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Text style={{ fontSize: 10, textAlign: "center", marginTop: 16, color: colors.textDim, lineHeight: 16 }}>
              Prueba gratis 30 días. Cancela antes de que termine y no se te cobra nada.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
