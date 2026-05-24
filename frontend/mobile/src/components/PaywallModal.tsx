import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ActivityIndicator, Linking, Platform,
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

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Short description of what triggered the paywall, e.g. "Los mentores son exclusivos de Premium" */
  reason?: string;
}

export default function PaywallModal({ visible, onClose, reason }: Props) {
  const { colors } = useTheme();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleUpgrade = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await billingApi.createCheckout();
      const url: string = res.data.url;
      await Linking.openURL(url);
      // After returning from browser, refresh subscription status
      setTimeout(() => fetchStatus(), 3000);
    } catch {
      setError("No se pudo abrir el pago. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

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
          <Text style={[styles.price, { color: "#f59e0b" }]}>
            $11.99<Text style={[styles.pricePeriod, { color: colors.textMuted }]}>/mes</Text>
          </Text>

          {reason && (
            <View style={[styles.reasonBox, { backgroundColor: "#f59e0b12", borderColor: "#f59e0b30" }]}>
              <Ionicons name="lock-closed-outline" size={13} color="#f59e0b" />
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          )}

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

          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : null}

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
                <Text style={styles.ctaText}>Activar Premium</Text>
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
  title: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginBottom: 4 },
  price: { fontSize: 28, fontWeight: "900", letterSpacing: -1, marginBottom: 12 },
  pricePeriod: { fontSize: 15, fontWeight: "500" },
  reasonBox: {
    flexDirection: "row", alignItems: "center", gap: 7,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 12,
  },
  reasonText: { color: "#f59e0b", fontSize: 12, fontWeight: "600", flex: 1 },
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
  ctaText: { color: "white", fontWeight: "800", fontSize: 16 },
  disclaimer: { fontSize: 10, textAlign: "center", marginTop: 8 },
});
