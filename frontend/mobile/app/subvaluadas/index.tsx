import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator, TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
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
    // Platform brand green (same values as ThemeContext's real accent/
    // accentLight) — kept separate from `accent` above, which this screen
    // deliberately overrides to gold as its own brand identity. Primary CTA
    // buttons (Buscar, Analizar con Arthur, Guardar en mi Diario de
    // Decisiones, Actualizar alerta) must always read as the platform's
    // real green regardless of that override (Diego: "cambiarles el color
    // al verde de la plataforma... manteniendo estandar de marca").
    brandGreen: isDark ? "#00b96d" : "#009958",
    brandGreenLight: isDark ? "#00e887" : "#00b96d",
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
    let cancelled = false;
    const cacheKey = `vi_quick_analysis:${ticker}:${i18n.language}`;
    setLimitHit(false);
    // Apple is always the free default view (Diego: "si o si, tal como web
    // app") — exempt from the weekly free-search counter server-side via
    // is_default_view, so it must load unconditionally, Premium or not.
    // Only an explicit user search (searchTriggered) ever counts against
    // that counter.
    const isDefaultView = !searchTriggered;

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
          const res: any = await screenerWeeklyApi.quickAnalysis(ticker, i18n.language, isDefaultView);
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
      {/* Ambient gold glow behind the header + company hero (redesign v2). */}
      <LinearGradient
        colors={["rgba(212,162,76,0.22)", "rgba(212,162,76,0.06)", "rgba(212,162,76,0)"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 380 }}
        pointerEvents="none"
      />
      {/* Header — round back button + one search field with "Buscar" built
          in (Nuvos Radar redesign, 2026-09-27). */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 }}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home" as any))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: viColors.card, borderWidth: 1, borderColor: viColors.border }}
        >
          <Ionicons name="chevron-back" size={20} color={viColors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, height: 46, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 23, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, paddingLeft: 14, paddingRight: 5 }}>
          <Ionicons name="search" size={17} color={viColors.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            placeholder={t("subvaluadas.search.placeholder")}
            placeholderTextColor={viColors.placeholder}
            style={{ flex: 1, fontSize: 14, color: viColors.text }}
          />
          <TouchableOpacity onPress={handleSearch} disabled={!query.trim()}
                            style={{ backgroundColor: viColors.brandGreen, paddingHorizontal: 14, height: 36, justifyContent: "center", borderRadius: 18, opacity: !query.trim() ? 0.45 : 1 }}>
            <Text style={{ fontSize: 12.5, fontWeight: "800", color: "#0A0F1A" }}>{t("subvaluadas.search.button")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {!isPremium && (
        <TouchableOpacity onPress={() => setPaywallOpen(true)}
          activeOpacity={0.85}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 16, backgroundColor: "rgba(212,162,76,0.08)", borderWidth: 1, borderColor: "rgba(212,162,76,0.25)" }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(212,162,76,0.16)" }}>
            <Ionicons name="lock-closed" size={14} color={GOLD} />
          </View>
          <Text style={{ fontSize: 12, lineHeight: 17, color: viColors.textSub, flex: 1 }}>{t("subvaluadas.freeGate.banner")}</Text>
          <Text style={{ fontSize: 12, fontWeight: "800", color: GOLD }}>{t("subvaluadas.freeGate.bannerCta")}</Text>
        </TouchableOpacity>
      )}

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {loading ? (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 60 }}>
            <ActivityIndicator size="large" color={GOLD} />
          </View>
        ) : limitHit ? (
          <View style={{ alignItems: "center", justifyContent: "center", padding: 24 }}>
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
          <View style={{ alignItems: "center", justifyContent: "center", padding: 24 }}>
            <Text style={{ fontSize: 13, color: viColors.textMuted, textAlign: "center" }}>{error || t("subvaluadas.search.error")}</Text>
          </View>
        ) : (
          <>
            {/* Company hero — no box: big logo with a glowing ring, name,
                sector · exchange, and the price as the headline number. The
                diagnostic below no longer repeats name/sector. */}
            <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 24 }}>
              <View style={{ padding: 4, borderRadius: 44, backgroundColor: "rgba(212,162,76,0.18)", borderWidth: 1, borderColor: "rgba(212,162,76,0.45)", marginBottom: 14 }}>
                <StockAvatar ticker={data.ticker} size={72} />
              </View>
              <Text style={{ fontSize: 24, fontWeight: "900", color: viColors.text, letterSpacing: -0.6, textAlign: "center" }} numberOfLines={2}>{data.company_name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(212,162,76,0.16)" }}>
                  <Text style={{ fontSize: 12, fontWeight: "900", color: GOLD, letterSpacing: 0.5 }}>{data.ticker}</Text>
                </View>
                <Text style={{ fontSize: 13, color: viColors.textSub }} numberOfLines={1}>
                  {data.sector}{data.exchange ? ` · ${data.exchange}` : ""}
                </Text>
              </View>
              {data.price !== null && (
                <View style={{ alignItems: "center", marginTop: 18 }}>
                  <Text style={{ fontSize: 44, lineHeight: 50, fontWeight: "900", color: viColors.text, letterSpacing: -1.5, fontVariant: ["tabular-nums"] }}>${data.price.toFixed(2)}</Text>
                  {data.change_pct !== null && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: data.change_pct >= 0 ? "rgba(79,166,149,0.18)" : "rgba(221,110,99,0.18)" }}>
                      <Ionicons name={data.change_pct >= 0 ? "arrow-up" : "arrow-down"} size={13} color={data.change_pct >= 0 ? TEAL : CORAL} />
                      <Text style={{ fontSize: 13, fontWeight: "800", color: data.change_pct >= 0 ? TEAL : CORAL, fontVariant: ["tabular-nums"] }}>
                        {data.change_pct >= 0 ? "+" : ""}{data.change_pct.toFixed(2)}% {t("subvaluadas.detail.today")}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* CompanyDiagnosticCard — LA ÚNICA tarjeta de valoración de esta
                pantalla, igual que web (Diego, "siempre siempre siempre"). */}
            {valuationPanelMode === "diagnostic" ? (
            <CompanyDiagnosticCard
              data={companyDiagnostic!}
              colors={viColors}
              locked={!!companyDiagnostic!.locked}
              onUnlock={() => setPaywallOpen(true)}
            />
          ) : valuationPanelMode === "loading" ? (
            <View style={{ borderRadius: 22, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, paddingVertical: 48, alignItems: "center" }}>
              <ActivityIndicator size="large" color={GOLD} />
            </View>
          ) : companyDiagnosticError?.status === 403 ? (
            <View style={{ borderRadius: 22, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, padding: 18, flexDirection: "row", gap: 12 }}>
              <Ionicons name="lock-closed-outline" size={18} color={GOLD} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontWeight: "800", color: viColors.text }}>{t("subvaluadas.premiumGate.title")}</Text>
                <Text style={{ fontSize: 12, color: viColors.textSub, marginTop: 4 }}>{t("subvaluadas.premiumGate.desc")}</Text>
              </View>
            </View>
          ) : (
            <View style={{ borderRadius: 22, borderWidth: 1, borderColor: viColors.border, backgroundColor: viColors.card, padding: 18, flexDirection: "row", gap: 12 }}>
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

            <View style={{ marginTop: 20, alignItems: "center" }}>
              <GeneratedAtNote generatedAt={data.generated_at} colors={viColors} />
            </View>
            <View style={{ marginTop: 12 }}>
              <ActionButtons watchlisted={watchlisted} onFollow={handleFollow} onAnalyze={handleAnalyze} colors={viColors} />
            </View>
          </>
        )}
      </ScrollView>

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
