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
  "Chatea sin límites con tu mentor de IA, a cualquier hora",
  "Agrega todas las acciones que quieras, sin límite",
  "Sube una foto o PDF de tu cuenta y la IA arma tu portafolio",
  "Te avisamos antes de que tus empresas reporten ganancias",
  "Mira cómo le hubiera ido a tu dinero en crisis pasadas (2008, COVID...)",
  "La IA revisa tu portafolio y te dice qué mejorar",
  "Cada lunes, 5 ideas de inversión seleccionadas para ti",
  "Noticias de tus acciones, resumidas por IA en segundos",
  "Cada mes te decimos si le ganaste al mercado o no",
  "Lecciones pensadas para las acciones que ya tienes",
  "Te avisamos cuando pasa algo importante con tu dinero",
  "Descubre tu estilo como inversor y cómo mejorar",
];

const DUO_PLAN_FEATURES = [
  "Todo lo de Premium, para ambos",
  "Perfil y portafolio independientes para cada persona",
  "Comparte con un familiar o pareja",
  "Ideal para aprender a invertir juntos",
];

const ONE_TIME = [
  {
    emoji: "📊",
    title: "Reporte Anual de Inversiones",
    features: [
      "Retorno real de todo tu año como inversor",
      "Comparativa vs índices (S&P 500 y más)",
      "Lecciones aprendidas generadas por IA",
      "Plan personalizado para el año siguiente",
    ],
    priceFree: "$34.99 USD",
    pricePremium: "$19.99 USD",
    route: "/(tabs)/portfolio",
  },
  {
    emoji: "📱",
    title: "Sesión 1:1 de Guía Personalizada",
    features: [
      "45 minutos en vivo con un guía",
      "Configuramos tu portafolio juntos",
      "Ruta de aprendizaje personalizada según tus metas",
    ],
    priceFree: "$149 USD",
    pricePremium: "$99 USD",
    route: "/(tabs)/support",
  },
  {
    emoji: "📦",
    title: "Pack 3 Sesiones de Seguimiento",
    features: [
      "3 sesiones 1:1 de seguimiento continuo",
      "Revisamos tu progreso en la app",
      "Ajustamos tu ruta de aprendizaje",
      "Resolvemos dudas conforme avanzas",
    ],
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <Text style={{ fontSize: 20 }}>🌍</Text>
              <Text style={{ fontSize: 15, fontWeight: "900", color: "#fff" }}>Duo Plan</Text>
              <View style={{ backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Text style={{ fontSize: 9, fontWeight: "900", color: "#818cf8" }}>NUEVO</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginBottom: 2 }}>
              <Text style={{ fontSize: 24, fontWeight: "900", color: "#fff" }}>$19.99</Text>
              <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>/ mes</Text>
            </View>
            <Text style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 14 }}>Anual $199.99/año</Text>

            <TouchableOpacity
              onPress={() => setShowPricing(true)}
              style={{ backgroundColor: "rgba(99,102,241,0.2)", borderWidth: 1, borderColor: "rgba(99,102,241,0.4)", borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 14 }}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 13, fontWeight: "900", color: "#818cf8" }}>Contratar Duo Plan →</Text>
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
          <Text style={{ fontSize: 13, fontWeight: "900", color: colors.text, marginBottom: 12 }}>Productos de pago único</Text>
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
                    <Text style={{ fontSize: 11, color: colors.textMuted }}>Free: <Text style={{ fontWeight: "800", color: colors.textSub }}>{p.priceFree}</Text></Text>
                  )}
                </View>
                {p.note && (
                  <View style={{ alignSelf: "flex-start", backgroundColor: "rgba(0,212,126,0.08)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 12 }}>
                    <Text style={{ fontSize: 9, fontWeight: "800", color: "#00d47e" }}>{p.note}</Text>
                  </View>
                )}

                <TouchableOpacity
                  onPress={() => router.push(p.route as any)}
                  style={{ backgroundColor: "#00d47e", borderRadius: 12, paddingVertical: 10, alignItems: "center", marginBottom: 12 }}
                  activeOpacity={0.85}
                >
                  <Text style={{ fontSize: 12, fontWeight: "900", color: "#000" }}>Ver detalles →</Text>
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
