import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { portfolioLeaderboardApi } from "../lib/api";

type Period = "ytd" | "1m" | "1w";

interface LeaderboardEntry {
  rank: number;
  display_name: string;
  is_me: boolean;
  return_pct: number;
  positions_count: number;
  best_ticker: string | null;
  best_ticker_return: number | null;
  win_rate: number;
  is_premium: boolean;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  period: string;
  my_rank: number | null;
  total_users: number;
}

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
}

const PERIOD_LABELS: Record<Period, string> = {
  ytd: "Este año",
  "1m": "Último mes",
  "1w": "Esta semana",
};

const TOOL_COLOR = "#f59e0b";

function RankLabel({ rank }: { rank: number }) {
  if (rank === 1) return <Text style={{ fontSize: 16 }}>🥇</Text>;
  if (rank === 2) return <Text style={{ fontSize: 16 }}>🥈</Text>;
  if (rank === 3) return <Text style={{ fontSize: 16 }}>🥉</Text>;
  return null;
}

export default function MobilePortfolioLeaderboard({ isPremium, onUpgrade }: Props) {
  const { colors } = useTheme();
  const [period, setPeriod] = useState<Period>("ytd");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isPremium) return;
    setLoading(true);
    portfolioLeaderboardApi
      .get(period)
      .then((res: any) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, isPremium]);

  if (!isPremium) {
    return (
      <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={s.lockRow}>
          <View style={[s.lockIcon, { backgroundColor: `${TOOL_COLOR}18` }]}>
            <Ionicons name="trophy-outline" size={22} color={TOOL_COLOR} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.lockTitle, { color: colors.text }]}>Ranking de Portafolios</Text>
            <Text style={[s.lockSub, { color: colors.textMuted }]}>
              Compara tu rendimiento con otros inversores
            </Text>
          </View>
          <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
        </View>
        <Text style={[s.lockDesc, { color: colors.textMuted }]}>
          Ranking semanal, mensual y anual de portafolios. Solo métricas porcentuales — sin valores monetarios.
        </Text>
        <TouchableOpacity style={[s.unlockBtn, { backgroundColor: TOOL_COLOR }]} onPress={onUpgrade}>
          <Ionicons name="flash" size={14} color="white" />
          <Text style={s.unlockText}>Desbloquear Premium</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={s.headerRow}>
        <Ionicons name="trophy" size={16} color={TOOL_COLOR} />
        <Text style={[s.title, { color: colors.text }]}>Ranking de Portafolios</Text>
        <View style={[s.premiumBadge, { backgroundColor: `${TOOL_COLOR}18` }]}>
          <Text style={[s.premiumBadgeText, { color: TOOL_COLOR }]}>PREMIUM</Text>
        </View>
      </View>

      {/* Period tabs */}
      <View style={[s.tabs, { backgroundColor: colors.background }]}>
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[
              s.tab,
              period === p && [s.tabActive, { backgroundColor: colors.card, borderColor: colors.border }],
            ]}
            onPress={() => setPeriod(p)}
          >
            <Text style={[s.tabText, { color: period === p ? colors.text : colors.textMuted }]}>
              {PERIOD_LABELS[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats */}
      {data && !loading && (
        <View style={s.statsRow}>
          <View style={[s.statBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[s.statLabel, { color: colors.textMuted }]}>Tu posición</Text>
            <Text style={[s.statValue, { color: colors.text }]}>
              {data.my_rank ? `#${data.my_rank}` : "—"}
            </Text>
          </View>
          <View style={[s.statBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Text style={[s.statLabel, { color: colors.textMuted }]}>Inversores</Text>
            <Text style={[s.statValue, { color: colors.text }]}>{data.total_users}</Text>
          </View>
        </View>
      )}

      {/* Loading */}
      {loading && (
        <View style={s.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {/* Empty */}
      {data && !loading && data.leaderboard.length === 0 && (
        <Text style={[s.empty, { color: colors.textMuted }]}>
          No hay datos suficientes para este período.
        </Text>
      )}

      {/* List */}
      {data && !loading && data.leaderboard.length > 0 &&
        data.leaderboard.map((entry) => (
          <View
            key={entry.rank}
            style={[
              s.row,
              {
                backgroundColor: entry.is_me ? "rgba(139,92,246,0.08)" : colors.background,
                borderColor: entry.is_me ? "rgba(139,92,246,0.3)" : colors.border,
              },
            ]}
          >
            {/* Rank */}
            <View style={s.rankCol}>
              {entry.rank <= 3 ? (
                <RankLabel rank={entry.rank} />
              ) : (
                <Text style={[s.rankNum, { color: colors.textMuted }]}>#{entry.rank}</Text>
              )}
            </View>

            {/* Info */}
            <View style={{ flex: 1 }}>
              <View style={s.nameRow}>
                <Text style={[s.name, { color: entry.is_me ? "#a78bfa" : colors.text }]}>
                  {entry.display_name}
                </Text>
                {entry.is_me && (
                  <View style={s.youBadge}>
                    <Text style={s.youText}>Tú</Text>
                  </View>
                )}
                {entry.is_premium && (
                  <Ionicons name="star" size={10} color={TOOL_COLOR} style={{ marginLeft: 2 }} />
                )}
              </View>
              <Text style={[s.meta, { color: colors.textMuted }]}>
                {entry.positions_count} acciones · {entry.win_rate}% ganadoras
                {entry.best_ticker ? ` · mejor: ${entry.best_ticker}` : ""}
              </Text>
            </View>

            {/* Return */}
            <View style={s.returnCol}>
              <Ionicons
                name={entry.return_pct >= 0 ? "trending-up" : "trending-down"}
                size={13}
                color={entry.return_pct >= 0 ? "#22c55e" : "#ef4444"}
              />
              <Text style={[s.returnPct, { color: entry.return_pct >= 0 ? "#22c55e" : "#ef4444" }]}>
                {entry.return_pct >= 0 ? "+" : ""}{entry.return_pct.toFixed(1)}%
              </Text>
            </View>
          </View>
        ))
      }

      <Text style={[s.disclaimer, { color: colors.textDim ?? colors.textMuted }]}>
        Rendimiento del período · Sin valores monetarios · Solo primeros nombres
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  title: { fontSize: 14, fontWeight: "700", flex: 1 },
  premiumBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  premiumBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  tabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 12, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: "center", borderWidth: 1, borderColor: "transparent" },
  tabActive: { borderWidth: 1 },
  tabText: { fontSize: 11, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  statBox: { flex: 1, borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1 },
  statLabel: { fontSize: 10, marginBottom: 2 },
  statValue: { fontSize: 18, fontWeight: "800" },
  center: { paddingVertical: 24, alignItems: "center" },
  empty: { textAlign: "center", fontSize: 12, paddingVertical: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, borderWidth: 1, marginBottom: 6 },
  rankCol: { width: 28, alignItems: "center" },
  rankNum: { fontSize: 11, fontWeight: "700" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  name: { fontSize: 13, fontWeight: "600" },
  youBadge: { backgroundColor: "rgba(139,92,246,0.15)", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  youText: { fontSize: 10, fontWeight: "700", color: "#a78bfa" },
  meta: { fontSize: 10 },
  returnCol: { flexDirection: "row", alignItems: "center", gap: 3 },
  returnPct: { fontSize: 13, fontWeight: "700" },
  disclaimer: { fontSize: 10, textAlign: "center", marginTop: 8 },
  // Locked state
  lockRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  lockIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  lockTitle: { fontSize: 14, fontWeight: "700" },
  lockSub: { fontSize: 11, marginTop: 1 },
  lockDesc: { fontSize: 12, lineHeight: 17, marginBottom: 14 },
  unlockBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, paddingVertical: 11 },
  unlockText: { color: "white", fontSize: 13, fontWeight: "700" },
});
