import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, Linking, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { billingApi } from "../lib/api";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { useTheme } from "../lib/ThemeContext";

const HERO_FEATURES: { icon: string; text: string }[] = [
  { icon: "people-outline",       text: "5 mentores IA: Buffett, Dalio, Burry, Lynch, Ackman" },
  { icon: "chatbubbles-outline",  text: "Mensajes ilimitados con tu mentor 24/7" },
  { icon: "trending-up-outline",  text: "Portafolio ilimitado con análisis en tiempo real" },
  { icon: "search-outline",       text: "Screener semanal personalizado a tu perfil" },
  { icon: "flash-outline",        text: "Stress test, What-If y Reporte mensual PDF" },
];

const ALL_FEATURES: { icon: string; text: string; detail: string }[] = [
  { icon: "chatbubbles-outline",    text: "Mensajes ilimitados",               detail: "Sin límite de 20 mensajes al día. Habla con tu mentor cuando quieras sin restricciones." },
  { icon: "people-outline",         text: "5 mentores de inversión",            detail: "Accede a Warren Buffett, Ray Dalio, Michael Burry, Bill Ackman y Peter Lynch. Cada uno responde desde su filosofía real." },
  { icon: "trending-up-outline",    text: "Portafolio ilimitado",               detail: "Agrega más de 10 posiciones y da seguimiento completo con rendimientos en tiempo real." },
  { icon: "search-outline",         text: "Screener semanal personalizado",     detail: "Cada lunes la IA selecciona 5 oportunidades del mercado adaptadas a tu perfil de riesgo y mentor." },
  { icon: "stats-chart-outline",    text: "Análisis de earnings automático",    detail: "Cuando una empresa de tu portafolio reporta, la IA analiza EPS, revenue y calcula el impacto al instante." },
  { icon: "flash-outline",          text: "Stress test de portafolio",          detail: "Simula crisis del 2008, COVID-19, subida de tasas y otros escenarios extremos sobre tu portafolio actual." },
  { icon: "git-branch-outline",     text: "Simulador What-If",                  detail: "¿Qué pasa si vendo X y compro Y? Proyecta swaps, aportes mensuales y eventos macro antes de ejecutarlos." },
  { icon: "journal-outline",        text: "Diario de decisiones + sesgos",      detail: "Registra operaciones, detecta FOMO y pánico, y recibe un score como inversor con retos semanales del mentor." },
  { icon: "document-text-outline",  text: "Reporte mensual PDF",                detail: "Análisis completo: rendimiento, Sharpe Ratio, comparativa S&P 500 y nota personalizada del mentor." },
  { icon: "analytics-outline",      text: "Análisis de riesgo avanzado",        detail: "Barra de riesgo en cada respuesta para entender tu exposición real por sector y ticker." },
  { icon: "newspaper-outline",      text: "Noticias + filtros por empresa",     detail: "Todas las noticias de tus posiciones en tiempo real, filtrables por ticker." },
  { icon: "game-controller-outline",text: "Arena: 50 simulaciones/día",         detail: "Niveles difícil e imposible desbloqueados. Plan gratis: 5/día." },
  { icon: "mic-outline",            text: "Debates con la IA · 20/día",         detail: "Defiende tu tesis ante la IA y descubre puntos ciegos antes de operar. Plan gratis: 2/día." },
  { icon: "mail-outline",           text: "Emails semanales personalizados",    detail: "Cada viernes recibes un resumen del mercado adaptado a tu perfil, conversaciones y portafolio." },
];

const PLANS = [
  { key: "yearly",  label: "Anual",   price: "$117.99", period: "/año",  sub: "$9.83/mes · Ahorra $25.89", badge: "MÁS POPULAR" },
  { key: "monthly", label: "Mensual", price: "$11.99",  period: "/mes",  sub: "Facturado mensualmente",    badge: null },
] as const;

type Plan = "monthly" | "yearly";

interface Props {
  visible: boolean;
  onClose: () => void;
  reason?: string;
}

export default function PaywallModal({ visible, onClose, reason }: Props) {
  const { colors } = useTheme();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const [selectedPlan, setSelectedPlan] = useState<Plan>("yearly");
  const [showAll, setShowAll] = useState(false);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleUpgrade = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await billingApi.createCheckout(selectedPlan);
      const url: string = res.data.url;
      await Linking.openURL(url);
      setTimeout(() => fetchStatus(), 3000);
    } catch {
      setError("No se pudo abrir el pago. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const active = PLANS.find((p) => p.key === selectedPlan)!;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: "rgba(0,212,126,0.25)" }]}>
          {/* Top accent bar */}
          <View style={s.accentBar} />

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={s.scroll}>
            {/* Hero */}
            <View style={[s.hero, { backgroundColor: "rgba(0,168,94,0.08)" }]}>
              {/* Close */}
              <TouchableOpacity style={s.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>

              {/* Badge */}
              <View style={[s.heroBadge, { backgroundColor: "rgba(0,212,126,0.15)", borderColor: "rgba(0,212,126,0.35)" }]}>
                <Ionicons name="star" size={12} color="#00d47e" />
                <Text style={s.heroBadgeText}>Nuvos AI Premium</Text>
              </View>

              {/* Headline */}
              <Text style={[s.headline, { color: colors.text }]}>
                Invierte como los{"\n"}
                <Text style={{ color: "#00d47e" }}>mejores del mundo</Text>
              </Text>
              <Text style={[s.subHeadline, { color: colors.textMuted }]}>
                Tu asesor de inversiones con IA, disponible 24/7
              </Text>

              {/* Social proof */}
              <View style={[s.socialProof, { backgroundColor: "rgba(0,168,94,0.08)", borderColor: "rgba(0,168,94,0.2)" }]}>
                <View style={s.avatarRow}>
                  {["#8b5cf6","#3b82f6","#f59e0b","#ef4444","#22c55e"].map((c, i) => (
                    <View key={i} style={[s.avatar, { backgroundColor: c, marginLeft: i === 0 ? 0 : -8 }]}>
                      <Text style={s.avatarLetter}>{String.fromCharCode(65 + i)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={[s.socialText, { color: colors.textSub }]}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>+2,400 inversores</Text> ya usan Premium
                </Text>
              </View>

              {reason && (
                <View style={[s.reasonBox, { backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }]}>
                  <Ionicons name="lock-closed-outline" size={13} color="#00d47e" />
                  <Text style={[s.reasonText, { color: colors.textSub }]}>{reason}</Text>
                </View>
              )}
            </View>

            <View style={s.body}>
              {/* Plan selector */}
              <View style={[s.planRow, { backgroundColor: colors.bg }]}>
                {PLANS.map((plan) => {
                  const isActive = selectedPlan === plan.key;
                  return (
                    <TouchableOpacity
                      key={plan.key}
                      style={[
                        s.planOption,
                        isActive
                          ? { backgroundColor: "#00a85e", borderColor: "#00d47e" }
                          : { backgroundColor: "transparent", borderColor: colors.border },
                      ]}
                      onPress={() => setSelectedPlan(plan.key)}
                    >
                      {plan.badge && (
                        <View style={s.planBadge}>
                          <Text style={s.planBadgeText}>{plan.badge}</Text>
                        </View>
                      )}
                      <Text style={[s.planLabel, { color: isActive ? "rgba(255,255,255,0.85)" : colors.textMuted }]}>
                        {plan.label}
                      </Text>
                      <Text style={[s.planPrice, { color: isActive ? "#fff" : colors.textSub }]}>
                        {plan.price}
                      </Text>
                      <Text style={[s.planPeriod, { color: isActive ? "rgba(255,255,255,0.7)" : colors.textDim }]}>
                        {plan.sub}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Hero features */}
              <View style={s.heroFeatures}>
                {HERO_FEATURES.map((f) => (
                  <View key={f.text} style={s.heroFeatureRow}>
                    <View style={[s.featureIcon, { backgroundColor: "rgba(0,212,126,0.12)" }]}>
                      <Ionicons name={f.icon as any} size={15} color="#00d47e" />
                    </View>
                    <Text style={[s.heroFeatureText, { color: colors.textSub }]}>{f.text}</Text>
                  </View>
                ))}
              </View>

              {/* Expand all */}
              <TouchableOpacity
                style={[s.expandBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}
                onPress={() => setShowAll((v) => !v)}
              >
                <Ionicons
                  name={showAll ? "chevron-up" : "chevron-down"}
                  size={14}
                  color={colors.textMuted}
                />
                <Text style={[s.expandText, { color: colors.textMuted }]}>
                  {showAll ? "Ver menos" : `Ver los ${ALL_FEATURES.length} beneficios`}
                </Text>
              </TouchableOpacity>

              {showAll && (
                <View style={[s.allFeaturesBox, { borderColor: colors.border }]}>
                  {ALL_FEATURES.map((f) => {
                    const isOpen = expandedFeature === f.text;
                    return (
                      <TouchableOpacity
                        key={f.text}
                        style={[s.featureRow, isOpen && { backgroundColor: "rgba(0,168,94,0.06)" }]}
                        onPress={() => setExpandedFeature(isOpen ? null : f.text)}
                        activeOpacity={0.75}
                      >
                        <View style={s.featureRowTop}>
                          <View style={[s.featureIcon, { backgroundColor: "rgba(0,212,126,0.1)" }]}>
                            <Ionicons name={f.icon as any} size={14} color="#00d47e" />
                          </View>
                          <Text style={[s.featureText, { color: colors.textSub }]}>{f.text}</Text>
                          <Ionicons
                            name={isOpen ? "chevron-up" : "chevron-down"}
                            size={13}
                            color={colors.textDim}
                          />
                        </View>
                        {isOpen && (
                          <Text style={[s.featureDetail, { color: colors.textMuted }]}>{f.detail}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {error ? <Text style={s.errorText}>{error}</Text> : null}
            </View>
          </ScrollView>

          {/* Sticky CTA */}
          <View style={[s.ctaFooter, { borderTopColor: "rgba(0,212,126,0.15)", backgroundColor: colors.card }]}>
            <TouchableOpacity
              style={[s.cta, loading && { opacity: 0.6 }]}
              onPress={handleUpgrade}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <>
                  <Text style={s.ctaText}>
                    Comenzar ahora · {active.price}{active.period}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color="white" />
                </>
              )}
            </TouchableOpacity>
            <View style={s.trustRow}>
              {["Cancela cuando quieras", "Stripe seguro", "7 días gratis"].map((t) => (
                <View key={t} style={s.trustItem}>
                  <Ionicons name="checkmark" size={10} color="#00d47e" />
                  <Text style={[s.trustText, { color: colors.textDim }]}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderWidth: 1, maxHeight: "92%",
    overflow: "hidden",
    shadowColor: "#00d47e", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 20, elevation: 20,
  },
  accentBar: {
    height: 4, backgroundColor: "#00d47e",
  },
  scroll: { flexGrow: 1 },

  // Hero
  hero: {
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20,
  },
  closeBtn: {
    position: "absolute", top: 16, right: 16, padding: 6, zIndex: 10,
  },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "center", borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 6, marginBottom: 14,
  },
  heroBadgeText: { color: "#00d47e", fontSize: 12, fontWeight: "700" },
  headline: {
    fontSize: 26, fontWeight: "900", letterSpacing: -0.5,
    textAlign: "center", marginBottom: 8,
  },
  subHeadline: { fontSize: 13, textAlign: "center", marginBottom: 16 },
  socialProof: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 12,
  },
  avatarRow: { flexDirection: "row" },
  avatar: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  avatarLetter: { color: "white", fontSize: 10, fontWeight: "800" },
  socialText: { fontSize: 12, flex: 1 },
  reasonBox: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    marginTop: 4,
  },
  reasonText: { fontSize: 12, fontWeight: "600", flex: 1 },

  // Body
  body: { paddingHorizontal: 16, paddingBottom: 8, gap: 14 },

  // Plan selector
  planRow: {
    flexDirection: "row", gap: 10,
    borderRadius: 16, padding: 6,
  },
  planOption: {
    flex: 1, borderWidth: 1.5, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 8,
    alignItems: "center", gap: 3,
  },
  planBadge: {
    backgroundColor: "#f59e0b", borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 2, marginBottom: 2,
  },
  planBadgeText: { color: "#000", fontSize: 9, fontWeight: "900" },
  planLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  planPrice: { fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  planPeriod: { fontSize: 10, textAlign: "center" },

  // Hero features
  heroFeatures: { gap: 10 },
  heroFeatureRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  featureIcon: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
    marginTop: 1,
  },
  heroFeatureText: { fontSize: 13, flex: 1, lineHeight: 18 },

  // Expand button
  expandBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 12, borderWidth: 1, paddingVertical: 10,
  },
  expandText: { fontSize: 12, fontWeight: "600" },

  // All features
  allFeaturesBox: { borderRadius: 12, borderWidth: 1, overflow: "hidden", gap: 2 },
  featureRow: { paddingHorizontal: 12, paddingVertical: 10 },
  featureRowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 13, fontWeight: "500", flex: 1 },
  featureDetail: { fontSize: 11, lineHeight: 17, marginTop: 6, paddingLeft: 38 },

  errorText: { color: "#ef4444", fontSize: 12, textAlign: "center" },

  // CTA
  ctaFooter: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, borderTopWidth: 1, gap: 10,
  },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#00a85e", borderRadius: 16, paddingVertical: 16,
    shadowColor: "#00a85e", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  ctaText: { color: "white", fontWeight: "900", fontSize: 15 },
  trustRow: { flexDirection: "row", justifyContent: "center", gap: 12 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  trustText: { fontSize: 10 },
});
