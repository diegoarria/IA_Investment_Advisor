import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, ActivityIndicator,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { journalApi } from "../../src/lib/api";

interface Thesis {
  id: string;
  ticker: string;
  company_name: string | null;
  price_at_creation: number | null;
  intrinsic_value_base: number | null;
  created_at: string;
  thesis_text: string;
}

interface Review {
  price_then: number | null;
  price_now: number | null;
  intrinsic_then: number | null;
  intrinsic_now: number | null;
  review_text: string;
}

export default function JournalThesisScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const markdownStyles = useMemo(() => ({
    body: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
    paragraph: { marginVertical: 2 },
    strong: { color: colors.text, fontWeight: "700" as const },
    bullet_list: { marginVertical: 3 },
    list_item: { color: colors.textSub, fontSize: 13, lineHeight: 20 },
  }), [colors]);

  useEffect(() => {
    if (!id) return;
    journalApi.getOne(id).then((res) => setThesis(res.data)).catch(() => setThesis(null)).finally(() => setLoading(false));
  }, [id]);

  const handleReview = async () => {
    if (!id) return;
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await journalApi.review(id);
      setReview(res.data);
    } catch {
      setReviewError("No se pudo revisar la tesis en este momento. Intenta de nuevo.");
    }
    setReviewing(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {thesis ? `${thesis.ticker}${thesis.company_name ? " · " + thesis.company_name : ""}` : "Tesis"}
        </Text>
        <View style={{ width: 30 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.accentLight} /></View>
      ) : !thesis ? (
        <View style={styles.center}><Text style={{ color: colors.textMuted }}>Tesis no encontrada.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 16 }}>
            Guardada el {new Date(thesis.created_at).toLocaleDateString()} · Precio entonces ${thesis.price_at_creation ?? "N/D"} · Valor intrínseco base entonces ${thesis.intrinsic_value_base ?? "N/D"}
          </Text>

          <TouchableOpacity onPress={handleReview} disabled={reviewing}
                            style={[styles.reviewBtn, { backgroundColor: colors.accent, opacity: reviewing ? 0.5 : 1 }]}>
            {reviewing ? <ActivityIndicator color="#000" /> : <Ionicons name="refresh" size={16} color="#000" />}
            <Text style={styles.reviewBtnText}>Revisar tesis ahora</Text>
          </TouchableOpacity>

          {reviewError && <Text style={{ fontSize: 12, color: "#ef4444", marginBottom: 12 }}>{reviewError}</Text>}

          {review && (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5, color: colors.accentLight, marginBottom: 8 }}>
                Revisión de tesis
              </Text>
              <Text style={{ fontSize: 11, color: colors.textDim, marginBottom: 10 }}>
                Precio: ${review.price_then ?? "N/D"} → ${review.price_now ?? "N/D"} · Valor intrínseco: ${review.intrinsic_then ?? "N/D"} → ${review.intrinsic_now ?? "N/D"}
              </Text>
              <Markdown style={markdownStyles}>{review.review_text}</Markdown>
            </View>
          )}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 12, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5, color: colors.accentLight, marginBottom: 8 }}>
              Tesis original
            </Text>
            <Markdown style={markdownStyles}>{thesis.thesis_text}</Markdown>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8 },
  backBtn: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 14, fontWeight: "800", textAlign: "center", marginHorizontal: 8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  reviewBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 16, marginBottom: 16 },
  reviewBtnText: { fontSize: 13, fontWeight: "900", color: "#000" },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
});
