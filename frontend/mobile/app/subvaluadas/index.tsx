import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { posthog } from "../../src/config/posthog";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import { useTheme } from "../../src/lib/ThemeContext";
import { screenerWeeklyApi, watchlistServerApi } from "../../src/lib/api";
import PaywallModal from "../../src/components/PaywallModal";
import StockAvatar from "../../src/components/StockAvatar";
import ExplainButton from "../../src/components/ExplainButton";
import { GeneratedAtNote, ActionButtons } from "../../src/components/subvaluadas/shared";
import { CompanyDiagnosticCard } from "../../src/components/subvaluadas/CompanyDiagnosticCard";
import type { CompanyDiagnosticData } from "../../src/lib/types/companyDiagnostic";

// Mobile "Oportunidades" screen — full port of web's /subvaluadas redesign
// (app/subvaluadas/page.tsx): CompanyDiagnosticCard is now the ONLY
// valuation panel, exactly like web (Diego, "siempre siempre siempre" — see
// web's valuationPanelMode.ts doc comment). The old GQV/DCF panel and its
// whole cascade (NIF dashboard, Sensitivity Heatmap, Reverse DCF, Level 3
// modal, mentor questions) are retired for good — never a fallback again.

const viColorsDark = {
  bg: "#0A0F1A", bgRaised: "#16223A", card: "#111A2B", cardElevated: "#16223A",
  border: "rgba(255,255,255,0.08)", borderStrong: "#1C2B47",
  text: "#EBEEF5", textSub: "#8C97AD", textMuted: "#5C6883", textDim: "#5C6883", placeholder: "#5C6883",
};
const viColorsLight = {
  bg: "#F4F7FB", bgRaised: "#EAEFF7", card: "#FFFFFF", cardElevated: "#F8FAFD",
  border: "#DCE5F0", borderStrong: "#C8D8EA",
  text: "#0A1628", textSub: "#304660", textMuted: "#5B7A96", textDim: "#9AB4CC", placeholder: "#9AB4CC",
};
function useViColors(isDark: boolean) {
  return useMemo(() => ({
    ...(isDark ? viColorsDark : viColorsLight),
    accent: "#D4A24C", accentLight: "#D4A24C", accentDark: "#A9793A",
    up: "#4FA695", down: "#DD6E63", info: "#4FA695",
  }), [isDark]);
}

const GOLD = "#D4A24C", TEAL = "#4FA695", CORAL = "#DD6E63";
const DEFAULT_TICKER = "AAPL";

interface QuickAnalysisResult {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  price: number | null;
  change_pct: number | null;
  exchange: string | null;
  generated_at: number;
}

type ValuationPanelMode = "diagnostic" | "loading" | "unavailable";
function resolveValuationPanelMode(hasCompanyDiagnostic: boolean, isDiagnosticLoading: boolean): ValuationPanelMode {
  if (hasCompanyDiagnostic) return "diagnostic";
  if (isDiagnosticLoading) return "loading";
  return "unavailable";
}

export default function SubvaluadasScreen() {
  const { t, i18n } = useTranslation();
  const subStore = useSubscriptionStore();
  const isPremium = hasPremiumAccess(subStore);
  const params = useLocalSearchParams<{ ticker?: string }>();
  const { isDark } = useTheme();
  const viColors = useViColors(isDark);

  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => { AsyncStorage.setItem("nuvos_opportunity_viewed", "1"); }, []);

  const [query, setQuery] = useState("");
  const [ticker, setTicker] = useState(() => (params.ticker || DEFAULT_TICKER).toUpperCase());
  const [data, setData] = useState<QuickAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [watchlisted, setWatchlisted] = useState(false);
  const [searchTriggered, setSearchTriggered] = useState(() => !!params.ticker);

  useEffect(() => {
    if (!isPremium && !searchTriggered) { setLoading(false); return; }
    let cancelled = false;
    const cacheKey = `vi_quick_analysis:${ticker}:${i18n.language}`;
    setLimitHit(false);

    const run = async () => {
      let hadCache = false;
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cached && !cancelled) {
          setData(JSON.parse(cached));
          setError(null);
          setLoading(false);
          hadCache = true;
        }
      } catch { /* ignore — fall through to network */ }

      if (!hadCache && !cancelled) { setLoading(true); setError(null); }

      const attempt = async (n: number): Promise<void> => {
        try {
          const res: any = await screenerWeeklyApi.quickAnalysis(ticker, i18n.language);
          if (cancelled) return;
          setData(res.data);
          setError(null);
          AsyncStorage.setItem(cacheKey, JSON.stringify(res.data)).catch(() => {});
        } catch (err: any) {
          const status = err?.response?.status;
          const isDefinitive = status !== undefined && status !== 503;
          if (!isDefinitive && n < 2) {
            await new Promise((r) => setTimeout(r, 800 * (n + 1)));
            return cancelled ? undefined : attempt(n + 1);
          }
          if (cancelled || hadCache) return;
          if (status === 429) {
            setLimitHit(true);
            setError(err?.response?.data?.detail?.message || t("subvaluadas.freeGate.limitDesc"));
            posthog.capture("dcf_limit_reached", { ticker });
            return;
          }
          const detail = err?.response?.data?.detail;
          setError(typeof detail === "string" ? detail : t("subvaluadas.search.error"));
        }
      };

      await attempt(0);
      if (!cancelled) setLoading(false);
    };

    run();
    return () => { cancelled = true; };
  }, [ticker, isPremium, searchTriggered, i18n.language, t]);

  // CompanyDiagnosticCard's real data — Premium-only, fetched in parallel
  // with quick-analysis. Mirror of web's page.tsx — see its own comment.
  const [companyDiagnostic, setCompanyDiagnostic] = useState<CompanyDiagnosticData | null>(null);
  const [companyDiagnosticLoading, setCompanyDiagnosticLoading] = useState(false);
  const [companyDiagnosticError, setCompanyDiagnosticError] = useState<{ status?: number; code?: string } | null>(null);

  useEffect(() => {
    if (!isPremium) { setCompanyDiagnostic(null); setCompanyDiagnosticError(null); setCompanyDiagnosticLoading(false); return; }
    let cancelled = false;
    setCompanyDiagnostic(null);
    setCompanyDiagnosticError(null);
    setCompanyDiagnosticLoading(true);
    screenerWeeklyApi.companyDiagnostic(ticker, i18n.language)
      .then((res: any) => { if (!cancelled) setCompanyDiagnostic(res.data); })
      .catch((err: any) => {
        if (cancelled) return;
        setCompanyDiagnostic(null);
        const status = err?.response?.status;
        const detail = err?.response?.data?.detail;
        const code = typeof detail === "object" ? detail?.code : undefined;
        setCompanyDiagnosticError({ status, code });
      })
      .finally(() => { if (!cancelled) setCompanyDiagnosticLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, isPremium, searchTriggered, i18n.language]);

  const valuationPanelMode = resolveValuationPanelMode(!!companyDiagnostic, companyDiagnosticLoading);

  const handleSearch = () => {
    if (!query.trim()) return;
    setWatchlisted(false);
    setSearchTriggered(true);
    setTicker(query.trim());
  };

  const handleFollow = async () => {
    if (!data || watchlisted) return;
    try { await watchlistServerApi.add(data.ticker, data.company_name || undefined); setWatchlisted(true); } catch { /* idempotent */ }
  };
  const handleAnalyze = () => router.push(`/chat?msg=${encodeURIComponent(t("subvaluadas.analyze.prompt", { ticker }))}&autosend=1` as any);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: viColors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={viColors.text} /></TouchableOpacity>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, paddingHorizontal: 12 }}>
          <Ionicons name="search" size={16} color={viColors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            placeholder={t("subvaluadas.search.placeholder")}
            placeholderTextColor={viColors.placeholder}
            style={{ flex: 1, paddingVertical: 10, fontSize: 13, color: viColors.text }}
          />
        </View>
        <TouchableOpacity onPress={handleSearch} disabled={!query.trim()}
                          style={{ backgroundColor: GOLD, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, opacity: !query.trim() ? 0.5 : 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "800", color: "#0A0F1A" }}>{t("subvaluadas.search.button")}</Text>
        </TouchableOpacity>
      </View>

      {!isPremium && (
        <TouchableOpacity onPress={() => setPaywallOpen(true)}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: "rgba(212,162,76,0.08)", borderWidth: 1, borderColor: "rgba(212,162,76,0.25)" }}>
          <Text style={{ fontSize: 11.5, color: viColors.textSub, flex: 1, marginRight: 8 }}>{t("subvaluadas.freeGate.banner")}</Text>
          <Text style={{ fontSize: 11.5, fontWeight: "800", color: GOLD }}>{t("subvaluadas.freeGate.bannerCta")}</Text>
        </TouchableOpacity>
      )}

      {!isPremium && !searchTriggered && !data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(212,162,76,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="search" size={26} color={GOLD} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "700", color: viColors.text, marginBottom: 6, textAlign: "center" }}>{t("subvaluadas.freeGate.title")}</Text>
          <Text style={{ fontSize: 13, color: viColors.textMuted, textAlign: "center", marginBottom: 18 }}>{t("subvaluadas.freeGate.desc")}</Text>
          <TouchableOpacity onPress={() => setPaywallOpen(true)} style={{ backgroundColor: GOLD, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "800", color: "#0A0F1A" }}>{t("subvaluadas.freeGate.cta")}</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      ) : limitHit ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: "rgba(212,162,76,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Ionicons name="lock-closed" size={26} color={GOLD} />
          </View>
          <Text style={{ fontSize: 15, fontWeight: "700", color: viColors.text, marginBottom: 6, textAlign: "center" }}>{t("subvaluadas.freeGate.limitTitle")}</Text>
          <Text style={{ fontSize: 13, color: viColors.textMuted, textAlign: "center", marginBottom: 18 }}>{error || t("subvaluadas.freeGate.limitDesc")}</Text>
          <TouchableOpacity onPress={() => setPaywallOpen(true)} style={{ backgroundColor: GOLD, paddingHorizontal: 22, paddingVertical: 11, borderRadius: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "800", color: "#0A0F1A" }}>{t("subvaluadas.freeGate.cta")}</Text>
          </TouchableOpacity>
        </View>
      ) : error || !data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ fontSize: 13, color: viColors.textMuted, textAlign: "center" }}>{error || t("subvaluadas.search.error")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <StockAvatar ticker={data.ticker} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: "600", color: viColors.text }} numberOfLines={1}>{data.company_name}</Text>
                <Text style={{ fontSize: 12, color: viColors.textSub, marginTop: 2 }} numberOfLines={1}>
                  {data.sector}{data.exchange ? ` · ${data.exchange}` : ""}
                </Text>
              </View>
            </View>
            {data.price !== null && (
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ fontSize: 20, fontWeight: "600", color: viColors.text }}>${data.price.toFixed(2)}</Text>
                {data.change_pct !== null && (
                  <Text style={{ fontSize: 12, color: data.change_pct >= 0 ? TEAL : CORAL }}>
                    {data.change_pct >= 0 ? "+" : ""}{data.change_pct.toFixed(2)}% {t("subvaluadas.detail.today")}
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* CompanyDiagnosticCard — LA ÚNICA tarjeta de valoración de esta
              pantalla, igual que web (Diego, "siempre siempre siempre"). */}
          {valuationPanelMode === "diagnostic" ? (
            <CompanyDiagnosticCard data={companyDiagnostic!} colors={viColors} />
          ) : valuationPanelMode === "loading" ? (
            <View style={{ borderRadius: 16, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator size="large" color={GOLD} />
            </View>
          ) : companyDiagnosticError?.status === 403 ? (
            <View style={{ borderRadius: 16, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, padding: 16, flexDirection: "row", gap: 10 }}>
              <Ionicons name="lock-closed-outline" size={18} color={GOLD} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: viColors.text }}>{t("subvaluadas.premiumGate.title")}</Text>
                <Text style={{ fontSize: 12, color: viColors.textSub, marginTop: 4 }}>{t("subvaluadas.premiumGate.desc")}</Text>
              </View>
            </View>
          ) : (
            <View style={{ borderRadius: 16, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, padding: 16, flexDirection: "row", gap: 10 }}>
              <Ionicons name="alert-circle-outline" size={18} color={viColors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: viColors.text }}>{t("subvaluadas.valuationUnavailable.title")}</Text>
                <Text style={{ fontSize: 12, color: viColors.textSub, marginTop: 4 }}>{t("subvaluadas.valuationUnavailable.subtitle")}</Text>
                {companyDiagnosticError && (
                  <Text style={{ fontSize: 10.5, color: viColors.textDim, marginTop: 6 }}>
                    {t("subvaluadas.valuationUnavailable.debug", {
                      status: companyDiagnosticError.status ?? "?",
                      code: companyDiagnosticError.code ?? "unknown",
                    })}
                  </Text>
                )}
              </View>
            </View>
          )}

          <View style={{ marginTop: 18, gap: 10 }}>
            <GeneratedAtNote generatedAt={data.generated_at} colors={viColors} />
          </View>
          <View style={{ marginTop: 14 }}>
            <ActionButtons watchlisted={watchlisted} onFollow={handleFollow} onAnalyze={handleAnalyze} colors={viColors} />
          </View>
        </ScrollView>
      )}

      <ExplainButton
        screen={data ? "oportunidades_resultado" : "oportunidades_intro"}
        context={
          data
            ? {
                ticker: data.ticker,
                company_name: data.company_name,
                price: data.price,
                score: companyDiagnostic?.score ?? null,
                fair_value: companyDiagnostic?.valuation?.baseFairValue ?? null,
              }
            : {
                screen_purpose:
                  "This screen shows a full company diagnostic — quality, financial trust, " +
                  "valuation (Bear/Base/Bull fair value scenarios), and the simplicity of the " +
                  "investment thesis — to help the user decide whether now looks like a good " +
                  "time to buy.",
              }
        }
      />

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("subvaluadas.premiumGate.paywallReason")} />
    </SafeAreaView>
  );
}
