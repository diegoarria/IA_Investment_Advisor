import React, { useEffect, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/lib/ThemeContext";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { progressApi } from "../../src/lib/api";
import PricingModal from "../../src/components/PricingModal";

interface ProgressSummary {
  days_using_nuvos?: number;
  days_since_first_investment?: number;
  total_operations?: number;
  capital_invested?: number;
  max_patrimonio?: number;
  cumulative_return_pct?: number;
  best_year?: { year: number; pct: number };
  worst_year?: { year: number; pct: number };
  consecutive_months_contributing?: number;
}

interface Milestone {
  title: string;
  description?: string;
  occurred_at: string;
  milestone_key: string;
}

interface DecisionThatHelped {
  key: string;
  title: string;
  description: string;
}

const fmtUSD = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export default function ProgressScreen() {
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);

  const [showPricing, setShowPricing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ProgressSummary>({});
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [decisions, setDecisions] = useState<DecisionThatHelped[]>([]);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    Promise.all([
      progressApi.getSummary(),
      progressApi.getMilestones(),
      progressApi.getDecisionsThatHelped(),
    ])
      .then(([s, m, d]: any[]) => {
        setSummary(s.data.summary || {});
        setMilestones(m.data.milestones || []);
        setDecisions(d.data.decisions || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isPremium]);

  const metrics: { label: string; value: string }[] = [];
  if (summary.days_since_first_investment !== undefined) {
    metrics.push({ label: "Desde tu primera inversión", value: `${summary.days_since_first_investment} días` });
  }
  if (summary.days_using_nuvos !== undefined) {
    metrics.push({ label: "Tiempo usando Nuvos", value: `${summary.days_using_nuvos} días` });
  }
  if (summary.total_operations !== undefined) {
    metrics.push({ label: "Operaciones realizadas", value: `${summary.total_operations}` });
  }
  if (summary.capital_invested !== undefined) {
    metrics.push({ label: "Capital invertido", value: fmtUSD(summary.capital_invested) });
  }
  if (summary.max_patrimonio !== undefined) {
    metrics.push({ label: "Máximo patrimonio alcanzado", value: fmtUSD(summary.max_patrimonio) });
  }
  if (summary.cumulative_return_pct !== undefined) {
    const sign = summary.cumulative_return_pct >= 0 ? "+" : "";
    metrics.push({ label: "Retorno acumulado", value: `${sign}${summary.cumulative_return_pct}%` });
  }
  if (summary.best_year) {
    metrics.push({ label: `Mejor año (${summary.best_year.year})`, value: `+${summary.best_year.pct}%` });
  }
  if (summary.worst_year) {
    const sign = summary.worst_year.pct >= 0 ? "+" : "";
    metrics.push({ label: `Año más difícil (${summary.worst_year.year})`, value: `${sign}${summary.worst_year.pct}%` });
  }
  if (summary.consecutive_months_contributing !== undefined) {
    metrics.push({ label: "Meses seguidos aportando", value: `${summary.consecutive_months_contributing}` });
  }

  const hasAnyData = metrics.length > 0 || milestones.length > 0 || decisions.length > 0;

  if (!isPremium) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,168,94,0.1)", marginBottom: 16 }}>
          <Ionicons name="lock-closed" size={28} color={colors.accentLight} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: "900", color: colors.text, marginBottom: 8, textAlign: "center" }}>
          Tu evolución como inversionista
        </Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center", marginBottom: 20, maxWidth: 280 }}>
          Nuvos guarda tu historia completa como inversor — hitos, patrimonio, decisiones que evitaron errores. Entre más tiempo te quedes, más vale.
        </Text>
        <TouchableOpacity
          onPress={() => setShowPricing(true)}
          style={{ backgroundColor: "#00d47e", borderRadius: 14, paddingVertical: 12, paddingHorizontal: 28 }}
          activeOpacity={0.85}
        >
          <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>Activar Premium</Text>
        </TouchableOpacity>
        <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 20 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accentLight} style={{ marginTop: 40 }} />
        ) : !hasAnyData ? (
          <View style={{ alignItems: "center", paddingVertical: 60 }}>
            <Ionicons name="trending-up-outline" size={36} color={colors.textDim} style={{ marginBottom: 10 }} />
            <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center" }}>Aún estamos construyendo tu historial.</Text>
            <Text style={{ fontSize: 11, color: colors.textDim, textAlign: "center", marginTop: 4 }}>Sigue invirtiendo y usando Nuvos — tu evolución aparecerá aquí.</Text>
          </View>
        ) : (
          <>
            {metrics.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {metrics.map((m) => (
                  <View key={m.label} style={{ width: "47%", borderRadius: 14, borderWidth: 1, padding: 12, backgroundColor: colors.card, borderColor: colors.border }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textMuted, marginBottom: 4 }}>{m.label}</Text>
                    <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text }}>{m.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {milestones.length > 0 && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="trophy" size={13} color="#f59e0b" />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>HITOS</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {milestones.map((ms) => (
                    <View key={ms.milestone_key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(245,158,11,0.06)", borderColor: "rgba(245,158,11,0.2)" }}>
                      <Ionicons name="trophy" size={16} color="#f59e0b" style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{ms.title}</Text>
                        {!!ms.description && (
                          <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{ms.description}</Text>
                        )}
                        <Text style={{ fontSize: 10, color: colors.textDim, marginTop: 4 }}>
                          {new Date(ms.occurred_at).toLocaleDateString("es-MX")}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {decisions.length > 0 && (
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Ionicons name="shield-checkmark" size={13} color="#22c55e" />
                  <Text style={{ fontSize: 11, fontWeight: "800", color: colors.textMuted }}>DECISIONES QUE EVITARON ERRORES COSTOSOS</Text>
                </View>
                <View style={{ gap: 8 }}>
                  {decisions.map((d) => (
                    <View key={d.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, backgroundColor: "rgba(34,197,94,0.06)", borderColor: "rgba(34,197,94,0.2)" }}>
                      <Ionicons name="shield-checkmark" size={16} color="#22c55e" style={{ marginTop: 1 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>{d.title}</Text>
                        <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{d.description}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
