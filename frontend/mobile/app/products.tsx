import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../src/lib/subscriptionStore";
import PricingModal from "../src/components/PricingModal";

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

const ONE_TIME = [
  {
    emoji: "📊",
    title: "Reporte Anual de Inversiones",
    desc: "Análisis completo de tu año como inversor con IA. Retorno real, comparativa vs índices y plan para el año siguiente.",
    priceFree: "$34.99 USD",
    pricePremium: "$19.99 USD",
    route: "/(tabs)/portfolio",
  },
  {
    emoji: "📱",
    title: "Sesión 1:1 de Guía Personalizada",
    desc: "Sesión privada de 45 min donde te guiamos por la app, configuramos tu portafolio juntos y diseñamos tu ruta de aprendizaje según tus metas.",
    priceFree: "$149 USD",
    pricePremium: "$99 USD",
    route: "/(tabs)/support",
  },
  {
    emoji: "📦",
    title: "Pack 3 Sesiones de Seguimiento",
    desc: "Tres sesiones 1:1 de guía continua. Revisamos tu progreso, ajustamos tu ruta de aprendizaje y resolvemos dudas conforme avanzas como inversor.",
    pricePremium: "$247 USD",
    note: "Solo Premium",
    route: "/(tabs)/support",
  },
];

const COMING_SOON = [
  { emoji: "🔗", title: "Conectar Broker", desc: "Plaid, Fidelity, Schwab — sincroniza tu portafolio automáticamente." },
  { emoji: "📈", title: "Simulador de Opciones", desc: "Aprende calls y puts con dinero virtual y análisis IA de cada estrategia." },
];

export default function ProductsScreen() {
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const [showPricing, setShowPricing] = useState(false);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text }}>Productos y Servicios</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 24 }} showsVerticalScrollIndicator={false}>

        {/* ── Suscripción ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>Suscripción</Text>

          <View style={{ gap: 12 }}>
            {/* Free */}
            <View style={{ borderRadius: 20, borderWidth: 1, padding: 16, backgroundColor: colors.card, borderColor: colors.border }}>
              <Text style={{ fontSize: 15, fontWeight: "900", color: colors.text, marginBottom: 2 }}>Free</Text>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 10 }}>
                <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text }}>$0</Text>
                <Text style={{ fontSize: 11, color: colors.textMuted }}>USD / mes</Text>
              </View>
              {!isPremium && (
                <View style={{ borderRadius: 10, paddingVertical: 8, alignItems: "center", marginBottom: 12, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.textMuted }}>Tu plan actual</Text>
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
                <Text style={{ fontSize: 15, fontWeight: "900", color: "#fff" }}>Premium</Text>
                {isPremium && (
                  <View style={{ backgroundColor: "rgba(0,212,126,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 9, fontWeight: "900", color: "#00d47e" }}>TU PLAN ✓</Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
                <Text style={{ fontSize: 16, textDecorationLine: "line-through", color: "rgba(255,255,255,0.3)" }}>$12.99</Text>
                <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff" }}>$0</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>primer mes</Text>
              </View>
              <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>Luego $12.99/mes · Anual $125.99/año</Text>

              {!isPremium ? (
                <TouchableOpacity
                  onPress={() => setShowPricing(true)}
                  style={{ backgroundColor: "#00d47e", borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 13, fontWeight: "900", color: "#000" }}>Reclamar primer mes gratis →</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ borderRadius: 12, paddingVertical: 8, alignItems: "center", marginBottom: 14, backgroundColor: "rgba(0,212,126,0.1)", borderWidth: 1, borderColor: "rgba(0,212,126,0.3)" }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#00d47e" }}>Activo ✓</Text>
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
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>Duo Plan</Text>
          <View style={{ borderRadius: 20, borderWidth: 1.5, padding: 16, borderColor: "rgba(99,102,241,0.4)", backgroundColor: "#0d1020", overflow: "hidden" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Text style={{ fontSize: 20 }}>🌍</Text>
              <Text style={{ fontSize: 15, fontWeight: "900", color: "#fff" }}>Duo Plan</Text>
              <View style={{ backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: "900", color: "#818cf8" }}>NUEVO</Text>
              </View>
            </View>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 18, marginBottom: 10 }}>
              Comparte Premium con un familiar o pareja. Cada uno con su perfil y portafolio independiente. Ideal para aprender a invertir juntos.
            </Text>
            <Text style={{ fontSize: 13, fontWeight: "800", color: "#818cf8" }}>$19.99/mes · $199.99/año</Text>
          </View>
        </View>

        {/* ── Pago único ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>Productos de pago único</Text>
          <View style={{ gap: 10 }}>
            {ONE_TIME.map((p, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => router.push(p.route as any)}
                style={{ borderRadius: 18, borderWidth: 1, padding: 14, backgroundColor: colors.card, borderColor: colors.border }}
                activeOpacity={0.8}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <Text style={{ fontSize: 24 }}>{p.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text, marginBottom: 4 }}>{p.title}</Text>
                    <Text style={{ fontSize: 11, color: colors.textMuted, lineHeight: 17, marginBottom: 8 }}>{p.desc}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      {p.priceFree && (
                        <Text style={{ fontSize: 11, color: colors.textMuted }}>Free: <Text style={{ fontWeight: "800", color: colors.textSub }}>{p.priceFree}</Text></Text>
                      )}
                      {p.pricePremium && (
                        <Text style={{ fontSize: 11, color: colors.textMuted }}>Premium: <Text style={{ fontWeight: "800", color: "#00d47e" }}>{p.pricePremium}</Text></Text>
                      )}
                      {p.note && (
                        <View style={{ backgroundColor: "rgba(0,212,126,0.08)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 9, fontWeight: "800", color: "#00d47e" }}>{p.note}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textDim} style={{ marginTop: 2 }} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── Próximamente ── */}
        <View>
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>Próximamente</Text>
          <View style={{ gap: 10 }}>
            {COMING_SOON.map((p, i) => (
              <View key={i} style={{ borderRadius: 18, borderWidth: 1, padding: 14, backgroundColor: colors.card, borderColor: colors.border, opacity: 0.55 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <Text style={{ fontSize: 22 }}>{p.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{p.title}</Text>
                      <View style={{ backgroundColor: "rgba(99,102,241,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 9, fontWeight: "800", color: "#818cf8" }}>PRONTO</Text>
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
    </SafeAreaView>
  );
}
