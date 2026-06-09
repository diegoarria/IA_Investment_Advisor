import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "../../lib/ThemeContext";
import { useStockDetail } from "../../hooks/useStockDetail";
import StockHeader from "./StockHeader";
import StockChart from "../StockChart";
import StockOverview from "./StockOverview";
import StockFinancials from "./StockFinancials";
import StockAnalysts from "./StockAnalysts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "overview" | "financials" | "analysts";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview",   label: "Resumen"     },
  { key: "financials", label: "Financieros" },
  { key: "analysts",   label: "Analistas"   },
];

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

function TabBar({
  tab,
  onTabChange,
  colors,
}: {
  tab: Tab;
  onTabChange: (t: Tab) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={[tb.bar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {TABS.map((t) => {
        const active = t.key === tab;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onTabChange(t.key)}
            style={tb.btn}
            activeOpacity={0.7}
          >
            <Text style={[tb.label, { color: active ? colors.accentLight : colors.textMuted }]}>
              {t.label}
            </Text>
            {active && (
              <View style={[tb.indicator, { backgroundColor: colors.accentLight }]} />
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tb = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    position: "relative",
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  indicator: {
    position: "absolute",
    bottom: 0,
    left: "20%",
    right: "20%",
    height: 2,
    borderRadius: 1,
  },
});

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props {
  ticker: string;
}

export default function StockDetailScreen({ ticker }: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  const { data, loading, error, refetch } = useStockDetail(ticker);
  const [tab, setTab] = useState<Tab>("overview");

  const profile    = data?.profile;
  const financials = data?.financials;
  const analyst    = data?.analyst;

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.bg }]}>

      {/* ── Fixed header: price + back ── */}
      <StockHeader
        ticker={ticker}
        profile={profile}
        loading={loading}
        onBack={() => router.back()}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Chart ── */}
        <View style={[s.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <StockChart ticker={ticker} />
        </View>

        {/* ── Tab bar (scrolls with content, not sticky) ── */}
        <TabBar tab={tab} onTabChange={setTab} colors={colors} />

        {/* ── Tab content ── */}
        {loading && !data ? (
          <View style={s.centered}>
            <ActivityIndicator color={colors.accentLight} />
            <Text style={[s.loadingText, { color: colors.textMuted }]}>Cargando análisis…</Text>
          </View>
        ) : error ? (
          <View style={s.centered}>
            <Text style={[s.errorText, { color: colors.textMuted }]}>
              No se pudieron cargar los datos
            </Text>
            <TouchableOpacity
              onPress={refetch}
              style={[s.retryBtn, { backgroundColor: colors.accentGlow, borderColor: colors.accentLight }]}
            >
              <Text style={[s.retryText, { color: colors.accentLight }]}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {tab === "overview"   && profile    && <StockOverview   profile={profile} />}
            {tab === "financials" && financials  && <StockFinancials financials={financials} />}
            {tab === "analysts"   && analyst     && (
              <StockAnalysts analyst={analyst} currentPrice={profile?.current_price} />
            )}
            {!profile && !loading && (
              <View style={s.centered}>
                <Text style={{ color: colors.textMuted }}>Sin datos disponibles</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
  },
  chartCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  centered: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    marginTop: 4,
  },
  errorText: {
    fontSize: 14,
    fontWeight: "500",
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
  },
  retryText: {
    fontSize: 13,
    fontWeight: "700",
  },
});
