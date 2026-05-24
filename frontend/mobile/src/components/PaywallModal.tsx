import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { billingApi } from "../lib/api";
import { useSubscriptionStore } from "../lib/subscriptionStore";
import { useTheme } from "../lib/ThemeContext";

const PREMIUM_FEATURES = [
  { icon: "chatbubbles-outline",  text: "Mensajes ilimitados" },
  { icon: "people-outline",       text: "5 mentores: Buffett, Dalio, Burry, Ackman, Lynch" },
  { icon: "flash-outline",        text: "Stress Test de portafolio" },
  { icon: "trending-up-outline",  text: "Paper Trading completo" },
  { icon: "newspaper-outline",    text: "Noticias ilimitadas en tiempo real" },
];

const PLANS = [
  { key: "monthly", label: "Mensual", price: "$11.99", period: "/mes", badge: null },
  { key: "yearly",  label: "Anual",   price: "$99.99", period: "/año", badge: "2 meses gratis" },
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
  const [selectedPlan, setSelectedPlan] = useState<Plan>("monthly");
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: "#1a2d42" }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.crownBox}>
              <Ionicons name="star" size={22} color="#f59e0b" />
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Nuvo Premium</Text>

          {reason && (
            <View style={[styles.reasonBox, { backgroundColor: "#f59e0b12", borderColor: "#f59e0b30" }]}>
              <Ionicons name="lock-closed-outline" size={13} color="#f59e0b" />
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          )}

          {/* Plan selector */}
          <View style={styles.planRow}>
            {PLANS.map((plan) => {
              const isSelected = selectedPlan === plan.key;
              return (
                <TouchableOpacity
                  key={plan.key}
                  style={[
                    styles.planOption,
                    isSelected
                      ? { borderColor: "#f59e0b", backgroundColor: "#f59e0b12" }
                      : { borderColor: "#1a2d42", backgroundColor: "transparent" },
                  ]}
                  onPress={() => setSelectedPlan(plan.key)}
                >
                  {plan.badge && (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{plan.badge}</Text>
                    </View>
                  )}
                  <Text style={[styles.planLabel, { color: isSelected ? "#f59e0b" : colors.textMuted }]}>
                    {plan.label}
                  </Text>
                  <Text style={[styles.planPrice, { color: isSelected ? colors.text : colors.textSub }]}>
                    {plan.price}
                  </Text>
                  <Text style={[styles.planPeriod, { color: colors.textDim }]}>{plan.period}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Features list */}
          <View style={styles.features}>
            {PREMIUM_FEATURES.map((f) => (
              <View key={f.text} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon as any} size={15} color="#22c55e" />
                </View>
                <Text style={[styles.featureText, { color: colors.textSub }]}>{f.text}</Text>
              </View>
            ))}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* CTA */}
          <TouchableOpacity
            style={[styles.cta, loading && { opacity: 0.6 }]}
            onPress={handleUpgrade}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <>
                <Ionicons name="star" size={16} color="white" />
                <Text style={styles.ctaText}>
                  Activar Premium · {active.price}{active.period}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={[styles.disclaimer, { color: colors.textDim }]}>
            Cancela cuando quieras · Sin permanencia
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center", padding: 24,
  },
  sheet: {
    width: "100%", maxWidth: 360, borderRadius: 24, borderWidth: 1,
    padding: 24, gap: 4,
  },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12,
  },
  crownBox: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: "#f59e0b18", borderWidth: 1, borderColor: "#f59e0b33",
    alignItems: "center", justifyContent: "center",
  },
  closeBtn: { padding: 4 },
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginBottom: 12 },
  reasonBox: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 12,
  },
  reasonText: { color: "#f59e0b", fontSize: 12, fontWeight: "600", flex: 1 },

  // Plan selector
  planRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  planOption: {
    flex: 1, borderWidth: 1.5, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 10,
    alignItems: "center", gap: 2,
  },
  planBadge: {
    backgroundColor: "#22c55e", borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 2, marginBottom: 4,
  },
  planBadgeText: { color: "white", fontSize: 9, fontWeight: "800" },
  planLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  planPrice: { fontSize: 20, fontWeight: "900", letterSpacing: -0.5 },
  planPeriod: { fontSize: 11 },

  features: { gap: 10, marginVertical: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureIcon: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: "#22c55e14", alignItems: "center", justifyContent: "center",
  },
  featureText: { fontSize: 13, fontWeight: "500", flex: 1 },
  errorText: { color: "#ef4444", fontSize: 12, textAlign: "center", marginTop: 4 },
  cta: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#f59e0b", borderRadius: 14, paddingVertical: 16, marginTop: 12,
  },
  ctaText: { color: "white", fontWeight: "800", fontSize: 15 },
  disclaimer: { fontSize: 10, textAlign: "center", marginTop: 8 },
});
