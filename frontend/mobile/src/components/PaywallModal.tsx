import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, Linking, ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { billingApi } from "../lib/api";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { useTheme } from "../lib/ThemeContext";

const PLANS = [
  {
    key: "yearly"  as const,
    label:  "Anual",
    price:  "$125.99",
    period: "/año",
    sub:    "$10.50/mes · Ahorra $29.89",
    badge:  "MÁS POPULAR",
  },
  {
    key: "monthly" as const,
    label:  "Mensual",
    price:  "$12.99",
    period: "/mes",
    sub:    "Facturado mensualmente",
    badge:  null,
  },
];

const HERO_FEATURES = [
  { icon: "people-outline"      as const, text: "5 mentores IA: Buffett, Dalio, Burry, Lynch, Ackman" },
  { icon: "chatbubbles-outline" as const, text: "Mensajes ilimitados con tu mentor 24/7" },
  { icon: "trending-up-outline" as const, text: "Portafolio ilimitado con análisis en tiempo real" },
  { icon: "search-outline"      as const, text: "Screener semanal personalizado a tu perfil" },
  { icon: "flash-outline"       as const, text: "Stress test, Simulador What-If y Reporte mensual PDF" },
];

const ALL_FEATURES = [
  { text: "Mensajes ilimitados",             detail: "Sin límite de 20 mensajes al día. Habla con tu mentor cuando quieras sin restricciones." },
  { text: "5 mentores de inversión",         detail: "Elige entre Warren Buffett, Ray Dalio, Michael Burry, Bill Ackman y Peter Lynch. Cada uno responde desde su filosofía real." },
  { text: "Portafolio ilimitado",            detail: "Agrega más de 10 posiciones y da seguimiento completo con rendimientos en tiempo real." },
  { text: "Screener semanal personalizado",  detail: "Cada lunes la IA selecciona 5 oportunidades del mercado adaptadas a tu perfil de riesgo y mentor." },
  { text: "Análisis de earnings automático", detail: "Cuando una empresa de tu portafolio reporta resultados, la IA los analiza al instante y calcula el impacto en tu inversión." },
  { text: "Stress test de portafolio",       detail: "Simula crisis del 2008, COVID-19, subida de tasas y otros escenarios extremos sobre tu portafolio actual." },
  { text: "Simulador What-If",               detail: "¿Qué pasa si vendo X y compro Y? Proyecta swaps, aportes mensuales y eventos macroeconómicos antes de ejecutarlos." },
  { text: "Diario de decisiones + sesgos",   detail: "Registra cada operación, detecta sesgos como FOMO y pánico, y recibe un score como inversor con retos semanales del mentor." },
  { text: "Reporte mensual PDF",             detail: "Descarga un análisis completo con rendimiento, Sharpe Ratio, comparativa vs S&P 500 y nota personalizada del mentor." },
  { text: "Análisis de riesgo avanzado",     detail: "Barra de riesgo detallada en cada respuesta para entender tu exposición real por sector y ticker." },
  { text: "Noticias + filtros por empresa",  detail: "Todas las noticias de tus posiciones en tiempo real, filtrables por ticker para enfocarte en lo que importa." },
  { text: "Simulador sin límites",           detail: "Practica estrategias con capital virtual sin restricciones de cantidad ni frecuencia." },
  { text: "Emails semanales personalizados", detail: "Cada viernes recibes un resumen del mercado adaptado a tu perfil, tus conversaciones y tu portafolio." },
];

const AVATAR_COLORS = ["#8b5cf6", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e"];
const TRUST_ITEMS  = ["Cancela cuando quieras", "Pago seguro con Stripe", "7 días gratis"];

interface Props { visible: boolean; onClose: () => void; reason?: string }

export default function PaywallModal({ visible, onClose, reason }: Props) {
  const { colors } = useTheme();
  const fetchStatus  = useSubscriptionStore((s) => s.fetchStatus);
  const [plan, setPlan]             = useState<"monthly" | "yearly">("yearly");
  const [showAll, setShowAll]       = useState(false);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  const active = PLANS.find((p) => p.key === plan)!;

  const handleUpgrade = async () => {
    setLoading(true); setError("");
    try {
      const res = await billingApi.createCheckout(plan);
      await Linking.openURL(res.data.url);
      setTimeout(fetchStatus, 3000);
    } catch { setError("No se pudo abrir el pago. Intenta de nuevo."); }
    finally   { setLoading(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.sheet, { backgroundColor: colors.card, borderColor: "rgba(0,212,126,0.25)" }]}>

          {/* ── Gradient top bar ─────────────────────────────────────── */}
          <LinearGradient
            colors={["#00a85e", "#00d47e", "#3ecf8e"]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={s.accentBar}
          />

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={s.scroll}
          >
            {/* ── Hero ─────────────────────────────────────────────────── */}
            <View style={[s.hero, { backgroundColor: "rgba(0,168,94,0.08)" }]}>
              <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>

              {/* Badge */}
              <View style={s.heroBadgeRow}>
                <View style={s.heroBadge}>
                  <Ionicons name="star" size={11} color="#00d47e" />
                  <Text style={s.heroBadgeText}>Nuvos AI Premium</Text>
                </View>
              </View>

              {/* Headline */}
              <Text style={[s.headline, { color: colors.text }]}>
                Invierte como los{"\n"}
                <Text style={s.headlineGreen}>mejores del mundo</Text>
              </Text>
              <Text style={[s.subHeadline, { color: colors.textMuted }]}>
                Tu asesor de inversiones con IA, disponible 24/7
              </Text>

              {/* Social proof */}
              <View style={[s.socialProof, { backgroundColor: "rgba(0,168,94,0.08)", borderColor: "rgba(0,168,94,0.2)" }]}>
                <View style={s.avatarRow}>
                  {AVATAR_COLORS.map((c, i) => (
                    <View key={i} style={[s.avatar, { backgroundColor: c, marginLeft: i === 0 ? 0 : -8 }]}>
                      <Text style={s.avatarLetter}>{String.fromCharCode(65 + i)}</Text>
                    </View>
                  ))}
                </View>
                <Text style={[s.socialText, { color: colors.textSub }]}>
                  <Text style={{ fontWeight: "700", color: colors.text }}>+2,400 inversores</Text>
                  {" "}ya usan Premium
                </Text>
              </View>

              {reason ? (
                <View style={[s.reasonBox, { backgroundColor: "rgba(0,168,94,0.06)", borderColor: "rgba(0,168,94,0.25)" }]}>
                  <Text style={[s.reasonText, { color: colors.textSub }]}>{reason}</Text>
                </View>
              ) : null}
            </View>

            {/* ── Body ─────────────────────────────────────────────────── */}
            <View style={s.body}>

              {/* Plan selector — exact copy of web: p-1 rounded-2xl bg-raised, no borders on options */}
              <View style={[s.planRow, { backgroundColor: colors.bgRaised }]}>
                {PLANS.map((p) => {
                  const isActive = plan === p.key;
                  return isActive ? (
                    <TouchableOpacity key={p.key} style={s.planOptionWrap} onPress={() => setPlan(p.key)} activeOpacity={0.9}>
                      <LinearGradient
                        colors={["#00a85e", "#00d47e"]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={s.planOptionActive}
                      >
                        {p.badge ? (
                          <View style={s.planBadge}>
                            <Text style={s.planBadgeText}>{p.badge}</Text>
                          </View>
                        ) : null}
                        <Text style={[s.planLabel, { color: "rgba(255,255,255,0.85)" }]}>{p.label}</Text>
                        <Text style={[s.planPrice, { color: "#fff" }]}>{p.price}</Text>
                        <Text style={[s.planSub, { color: "rgba(255,255,255,0.72)" }]}>{p.sub}</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity key={p.key} style={[s.planOptionWrap, s.planOptionInactive]} onPress={() => setPlan(p.key)} activeOpacity={0.7}>
                      <Text style={[s.planLabel, { color: colors.textMuted }]}>{p.label}</Text>
                      <Text style={[s.planPrice, { color: colors.textSub }]}>{p.price}</Text>
                      <Text style={[s.planSub, { color: colors.textDim }]}>{p.sub}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Hero features */}
              <View style={s.heroFeatures}>
                {HERO_FEATURES.map((f) => (
                  <View key={f.text} style={s.heroFeatureRow}>
                    <View style={s.featureIconBox}>
                      <Ionicons name={f.icon} size={14} color="#00d47e" />
                    </View>
                    <Text style={[s.heroFeatureText, { color: colors.textSub }]}>{f.text}</Text>
                  </View>
                ))}
              </View>

              {/* Expand all features */}
              <TouchableOpacity
                style={[s.expandBtn, { backgroundColor: colors.bgRaised }]}
                onPress={() => setShowAll((v) => !v)}
              >
                <Ionicons name={showAll ? "chevron-up" : "chevron-down"} size={14} color={colors.textMuted} />
                <Text style={[s.expandText, { color: colors.textMuted }]}>
                  {showAll ? "Ver menos" : `Ver los ${ALL_FEATURES.length} beneficios`}
                </Text>
              </TouchableOpacity>

              {showAll ? (
                <View style={[s.allFeaturesBox, { borderColor: colors.border }]}>
                  {ALL_FEATURES.map((f, idx) => {
                    const isOpen = expanded === f.text;
                    return (
                      <View key={f.text} style={idx > 0 && [s.featureRowBorder, { borderTopColor: colors.border }]}>
                        <TouchableOpacity
                          style={[s.featureRow, isOpen && { backgroundColor: "rgba(0,168,94,0.06)" }]}
                          onPress={() => setExpanded(isOpen ? null : f.text)}
                          activeOpacity={0.7}
                        >
                          <Ionicons name="checkmark" size={14} color="#00d47e" />
                          <Text style={[s.featureText, { color: colors.textSub }]}>{f.text}</Text>
                          <Ionicons name={isOpen ? "chevron-up" : "chevron-down"} size={12} color={colors.textDim} />
                        </TouchableOpacity>
                        {isOpen ? (
                          <Text style={[s.featureDetail, { color: colors.textMuted }]}>{f.detail}</Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {error ? <Text style={s.errorText}>{error}</Text> : null}
            </View>
          </ScrollView>

          {/* ── Sticky CTA ───────────────────────────────────────────── */}
          <View style={[s.ctaFooter, { borderTopColor: "rgba(0,212,126,0.15)", backgroundColor: colors.card }]}>
            <TouchableOpacity onPress={handleUpgrade} disabled={loading} activeOpacity={0.9}>
              <LinearGradient
                colors={["#00a85e", "#00d47e"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={[s.cta, loading && s.ctaDisabled]}
              >
                {loading
                  ? <ActivityIndicator color="white" size="small" />
                  : <>
                      <Text style={s.ctaText}>Comenzar ahora · {active.price}{active.period}</Text>
                      <Ionicons name="arrow-forward" size={16} color="white" />
                    </>
                }
              </LinearGradient>
            </TouchableOpacity>

            <View style={s.trustRow}>
              {TRUST_ITEMS.map((t) => (
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
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    maxHeight: "92%",
    overflow: "hidden",
    shadowColor: "#00d47e",
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 20,
  },
  accentBar: { height: 4 },
  scroll: { flexGrow: 1 },

  // ── Hero
  hero: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 20,
  },
  closeBtn: {
    position: "absolute",
    top: 14, right: 14,
    width: 30, height: 30,
    borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    zIndex: 10,
  },
  heroBadgeRow: { alignItems: "center", marginBottom: 14 },
  heroBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,212,126,0.15)",
    borderWidth: 1, borderColor: "rgba(0,212,126,0.35)",
    borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  heroBadgeText: { color: "#00d47e", fontSize: 12, fontWeight: "700" },
  headline: {
    fontSize: 26, fontWeight: "900", letterSpacing: -0.5,
    textAlign: "center", marginBottom: 8,
  },
  headlineGreen: { color: "#00d47e" },
  subHeadline: { fontSize: 13, textAlign: "center", marginBottom: 16, lineHeight: 19 },
  socialProof: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 10,
    marginBottom: 10,
  },
  avatarRow: { flexDirection: "row" },
  avatar: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  avatarLetter: { color: "white", fontSize: 9, fontWeight: "800" },
  socialText: { fontSize: 12, flex: 1 },
  reasonBox: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    marginTop: 6,
  },
  reasonText: { fontSize: 12, textAlign: "center" },

  // ── Body
  body: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 14,
  },

  // ── Plan selector
  planRow: {
    flexDirection: "row",
    gap: 8,
    borderRadius: 16,
    padding: 4,
  },
  planOptionWrap: { flex: 1 },
  planOptionActive: {
    borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 10,
    alignItems: "center", gap: 4,
    shadowColor: "#00a85e",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 12,
    elevation: 6,
  },
  planOptionInactive: {
    borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 10,
    alignItems: "center", gap: 4,
  },
  planBadge: {
    backgroundColor: "#f59e0b",
    borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 2,
    marginBottom: 4,
  },
  planBadgeText: { color: "#000", fontSize: 9, fontWeight: "900" },
  planLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  planPrice: { fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  planSub: { fontSize: 10, textAlign: "center" },

  // ── Hero features
  heroFeatures: { gap: 10, paddingTop: 2 },
  heroFeatureRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  featureIconBox: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: "rgba(0,212,126,0.12)",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0, marginTop: 1,
  },
  heroFeatureText: { fontSize: 13, flex: 1, lineHeight: 19 },

  // ── Expand
  expandBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 12, paddingVertical: 10,
  },
  expandText: { fontSize: 12, fontWeight: "600" },

  // ── All features accordion
  allFeaturesBox: {
    borderRadius: 12, borderWidth: 1, overflow: "hidden",
  },
  featureRowBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  featureRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 11,
    gap: 8,
  },
  featureText: { fontSize: 12, fontWeight: "500", flex: 1 },
  featureDetail: {
    fontSize: 11, lineHeight: 17,
    paddingHorizontal: 12, paddingBottom: 10, paddingTop: 2,
    paddingLeft: 34,
  },
  errorText: { color: "#ef4444", fontSize: 12, textAlign: "center" },

  // ── CTA
  ctaFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 30,
    borderTopWidth: 1,
    gap: 10,
  },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 16, paddingVertical: 17,
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: "white", fontWeight: "900", fontSize: 16 },
  trustRow: {
    flexDirection: "row", justifyContent: "center",
    gap: 14, flexWrap: "wrap",
  },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  trustText: { fontSize: 10 },
});
