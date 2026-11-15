import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, Linking, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { profileApi, marketApi } from "../../src/lib/api";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../../src/lib/LanguageContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { useChatStore } from "../../src/lib/chatStore";
import { usePortfolioStore } from "../../src/lib/portfolioStore";
import EmailImportCard from "../../src/components/EmailImportCard";
import MobileBrokerConnectModal from "../../src/components/MobileBrokerConnectModal";
import {
  readOnboardingGoal, clearOnboardingGoal, checkOnboardingActivation,
} from "../../src/lib/onboardingAnalytics";

// Stage E (mobile parity, 2026-11): the one mandatory screen between
// "account created" and the product — same scope cut Web's Stage C shipped:
// name, phone, investment goal and market perception all become optional
// personalization collected later, never part of the required path. Only
// birth date (18+ gate) and the legal consent checkboxes stay mandatory.
//
// 2026-11-15 (Diego): added the same 3 sub-steps Web just shipped —
// ¿tienes portafolio?, conectarlo (si aplica, reusing the exact real
// mechanisms Portfolio already has: MobileBrokerConnectModal,
// EmailImportCard, marketApi.analyzeScreenshot), horizonte de inversión.
//
// Backend caveat (documented, not fixed here): none of this is enforced
// server-side. POST /profile accepts birth_date and
// terms_accepted_at/terms_version as plain optional fields with no
// validation at all. This screen is the only real gate today.

const TERMS_VERSION = "2026-11-quick-mobile";
const PORTFOLIO_TUTORIAL_VIDEO_URL = "https://youtu.be/IMVv5gdsdh4";

type QuickSub = "basics" | "portfolioQ" | "brokerConnect" | "horizonQ" | "legal";
const SUB_ORDER: QuickSub[] = ["basics", "portfolioQ", "brokerConnect", "horizonQ", "legal"];

type ExtractedPos = { ticker: string; name: string; shares: number | null; avg_price: number };

export default function OnboardingQuickScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const setProfile = useAppStore((s) => s.setProfile);
  const addPosition = usePortfolioStore((s) => s.addPosition);

  const [sub, setSub] = useState<QuickSub>("basics");
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [horizon, setHorizon] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPos[] | null>(null);
  const [screenshotMsg, setScreenshotMsg] = useState("");
  const [connectedCount, setConnectedCount] = useState(0);

  const birthDateValid = (() => {
    const d = parseInt(day), m = parseInt(month), y = parseInt(year);
    if (!d || !m || !y || y < 1920 || y > new Date().getFullYear()) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    return Date.now() - dt.getTime() >= 18 * 365.25 * 86_400_000;
  })();
  const birthDateStr = birthDateValid ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
  const canSubmit = birthDateValid && acceptedTerms && acceptedDisclaimer && !loading;

  const destinationForGoal = (goal: ReturnType<typeof readOnboardingGoal>): string => {
    if (goal === "company") return "/(tabs)/oportunidades";
    if (goal === "etf") return "/etf";
    if (goal === "portfolio") return "/(tabs)/patrimonio";
    return "/(tabs)/home";
  };

  const handlePickScreenshot = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;

    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.6 });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    if (!asset.base64) return;

    setScreenshotAnalyzing(true);
    setScreenshotPreview(null);
    setScreenshotMsg("");
    try {
      const res = await marketApi.analyzeScreenshot(asset.base64, asset.mimeType || "image/jpeg");
      const positions: ExtractedPos[] = res.data.positions || [];
      if (!positions.length) {
        setScreenshotMsg(t("onboardingQuick.importNoneFound"));
      } else {
        setScreenshotPreview(positions);
      }
    } catch {
      setScreenshotMsg(t("onboardingQuick.importScanError"));
    } finally {
      setScreenshotAnalyzing(false);
    }
  }, [t]);

  const confirmImportedPositions = () => {
    if (!screenshotPreview) return;
    screenshotPreview.forEach((p) => {
      if (p.shares && p.shares > 0) {
        addPosition({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price || 0 });
      }
    });
    setConnectedCount((c) => c + screenshotPreview.length);
    setScreenshotPreview(null);
    setHasPortfolio(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true); setError("");

    const payload: Record<string, unknown> = {
      ...(name.trim() ? { name: name.trim() } : {}),
      birth_date: birthDateStr,
      mentor: null,
      language,
      terms_accepted_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
    };
    if (horizon) payload.investment_horizon = horizon;
    if (hasPortfolio) { payload.has_broker = true; payload.has_investments = true; }

    const attempt = async (n: number): Promise<void> => {
      try {
        await profileApi.create(payload);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const isDefinitive = status !== undefined && status !== 503 && status !== 429;
        if (!isDefinitive && n < 2) {
          await new Promise((r) => setTimeout(r, 800 * (n + 1)));
          return attempt(n + 1);
        }
        throw err;
      }
    };

    try {
      await attempt(0);
      setProfile(payload as unknown as import("../../src/lib/profileStore").UserProfile);
      useSubscriptionStore.getState().fetchStatus().catch(() => {});

      const genericName = language === "en" ? "Investor" : "Inversor";
      const welcomeMsg = t("onboarding.welcome.messageNoGoal", { name: name.trim() || genericName });
      const chat = useChatStore.getState();
      chat.createSession();
      chat.setMessages([{ role: "assistant", content: welcomeMsg, timestamp: Date.now() }]);

      checkOnboardingActivation();

      const goal = readOnboardingGoal();
      const destination = connectedCount > 0 ? "/(tabs)/patrimonio" : destinationForGoal(goal);
      clearOnboardingGoal();
      router.replace(destination as any);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d: { msg?: string }) => d?.msg ?? String(d)).join(", ")
        : typeof detail === "string" ? detail : null;
      setError(msg || t("onboarding.saveProfileError"));
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const subDots = (
    <View style={{ flexDirection: "row", gap: 6, marginBottom: 20 }}>
      {SUB_ORDER.map((s, i) => {
        const curIdx = SUB_ORDER.indexOf(sub);
        return <View key={s} style={{ height: 3, flex: 1, borderRadius: 2, backgroundColor: i === curIdx ? "#00d47e" : i < curIdx ? "rgba(0,212,126,0.35)" : "#1a1d27" }} />;
      })}
    </View>
  );

  return (
    <View style={S.screen}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {subDots}

            {sub === "basics" && (
              <>
                <Text style={S.title}>{t("onboardingQuick.title")}</Text>
                <Text style={S.subtitle}>{t("onboardingQuick.subtitle")}</Text>

                <View style={{ marginTop: 24 }}>
                  <Text style={S.label}>{t("onboardingQuick.nameLabel")}</Text>
                  <TextInput
                    style={S.input}
                    value={name}
                    onChangeText={setName}
                    placeholder={t("onboardingQuick.namePlaceholder")}
                    placeholderTextColor="#374151"
                    autoCapitalize="words"
                  />
                </View>

                <View style={{ marginTop: 20 }}>
                  <Text style={S.label}>{t("onboarding.step0.birthDate")}</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TextInput
                      style={[S.input, { flex: 1, textAlign: "center" }]}
                      value={day} onChangeText={(v) => setDay(v.replace(/[^0-9]/g, "").slice(0, 2))}
                      placeholder="DD" placeholderTextColor="#374151" keyboardType="numeric" maxLength={2} autoFocus
                    />
                    <TextInput
                      style={[S.input, { flex: 1, textAlign: "center" }]}
                      value={month} onChangeText={(v) => setMonth(v.replace(/[^0-9]/g, "").slice(0, 2))}
                      placeholder="MM" placeholderTextColor="#374151" keyboardType="numeric" maxLength={2}
                    />
                    <TextInput
                      style={[S.input, { flex: 1.3, textAlign: "center" }]}
                      value={year} onChangeText={(v) => setYear(v.replace(/[^0-9]/g, "").slice(0, 4))}
                      placeholder="AAAA" placeholderTextColor="#374151" keyboardType="numeric" maxLength={4}
                    />
                  </View>
                  <Text style={S.hint}>{t("onboarding.step0.ageHint")}</Text>
                </View>

                <TouchableOpacity
                  style={[S.submitBtn, !birthDateValid && S.submitBtnDisabled]}
                  onPress={() => setSub("portfolioQ")}
                  disabled={!birthDateValid}
                  activeOpacity={0.85}
                >
                  <Text style={S.submitText}>{t("onboardingQuick.continueButton")}</Text>
                </TouchableOpacity>
              </>
            )}

            {sub === "portfolioQ" && (
              <>
                <Text style={S.title}>{t("onboardingQuick.portfolioQTitle")}</Text>
                <Text style={S.subtitle}>{t("onboardingQuick.portfolioQSubtitle")}</Text>
                <View style={{ marginTop: 20, gap: 10 }}>
                  <TouchableOpacity style={S.choiceCard} activeOpacity={0.8} onPress={() => { setHasPortfolio(true); setSub("brokerConnect"); }}>
                    <Text style={S.choiceTitle}>{t("onboardingQuick.portfolioYes")}</Text>
                    <Text style={S.choiceHint}>{t("onboardingQuick.portfolioYesHint")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={S.choiceCard} activeOpacity={0.8} onPress={() => { setHasPortfolio(false); setSub("horizonQ"); }}>
                    <Text style={S.choiceTitle}>{t("onboardingQuick.portfolioNo")}</Text>
                    <Text style={S.choiceHint}>{t("onboardingQuick.portfolioNoHint")}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {sub === "brokerConnect" && (
              <>
                <TouchableOpacity onPress={() => setSub("portfolioQ")}>
                  <Text style={S.backLink}>{t("onboardingQuick.back")}</Text>
                </TouchableOpacity>
                <Text style={S.title}>{t("onboardingQuick.brokerConnectTitle")}</Text>
                <Text style={S.subtitle}>{t("onboardingQuick.brokerConnectSubtitle")}</Text>

                {connectedCount > 0 && (
                  <View style={S.importedBox}>
                    <Text style={{ color: "#00d47e", fontSize: 13, fontWeight: "700" }}>
                      ✓ {t("onboardingQuick.importedCount", { count: connectedCount })}
                    </Text>
                  </View>
                )}

                {screenshotPreview ? (
                  <View style={[S.legalBox, { marginTop: 18, borderColor: "#1a1d27", backgroundColor: "#111318" }]}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13, marginBottom: 10 }}>
                      {t("onboardingQuick.importFoundCount", { count: screenshotPreview.length })}
                    </Text>
                    {screenshotPreview.map((p, i) => (
                      <View key={`${p.ticker}-${i}`} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                        <Text style={{ color: "#fff", fontSize: 13 }}>{p.ticker} · {p.shares ?? "?"} acc.</Text>
                        <Text style={{ color: "#9ca3af", fontSize: 13 }}>${(p.avg_price || 0).toFixed(2)}</Text>
                      </View>
                    ))}
                    <TouchableOpacity style={[S.submitBtn, { marginTop: 10 }]} onPress={confirmImportedPositions} activeOpacity={0.85}>
                      <Text style={S.submitText}>{t("onboardingQuick.confirmImport", { count: screenshotPreview.length })}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[S.submitBtn, { marginTop: 18, flexDirection: "row", justifyContent: "center", gap: 8 }]}
                      onPress={handlePickScreenshot}
                      disabled={screenshotAnalyzing}
                      activeOpacity={0.85}
                    >
                      {screenshotAnalyzing ? <ActivityIndicator color="#000" /> : (
                        <>
                          <Ionicons name="cloud-upload-outline" size={18} color="#000" />
                          <Text style={S.submitText}>{t("portfolio.buttons.importScreenshot")}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    {screenshotMsg && <Text style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>{screenshotMsg}</Text>}

                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, marginBottom: 18 }}
                      onPress={() => Linking.openURL(PORTFOLIO_TUTORIAL_VIDEO_URL)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="play-circle-outline" size={16} color="#00d47e" />
                      <Text style={{ fontSize: 12, fontWeight: "700", color: "#00d47e" }}>{t("portfolio.buttons.watchTutorial")}</Text>
                    </TouchableOpacity>

                    <EmailImportCard />

                    <Text style={S.orLabel}>{t("onboardingQuick.orConnectDirect")}</Text>
                    <TouchableOpacity
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 16, backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27" }}
                      onPress={() => setBrokerModalOpen(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={{ fontSize: 16 }}>🔗</Text>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>{t("portfolio.buttons.connectBroker")}</Text>
                    </TouchableOpacity>
                  </>
                )}

                <TouchableOpacity style={{ paddingVertical: 14, alignItems: "center" }} onPress={() => setSub("horizonQ")}>
                  <Text style={{ color: "#4b5563", fontSize: 12, fontWeight: "600" }}>{t("onboardingQuick.skipForNow")}</Text>
                </TouchableOpacity>
              </>
            )}

            {sub === "horizonQ" && (
              <>
                <Text style={S.title}>{t("onboardingQuick.horizonTitle")}</Text>
                <Text style={S.subtitle}>{t("onboardingQuick.horizonSubtitle")}</Text>
                <View style={{ marginTop: 20, gap: 10 }}>
                  {[
                    { v: "0.5", label: t("onboardingQuick.horizonShort") },
                    { v: "3", label: t("onboardingQuick.horizonMedium") },
                    { v: "10", label: t("onboardingQuick.horizonLong") },
                  ].map((o) => (
                    <TouchableOpacity key={o.v} style={S.choiceCard} activeOpacity={0.8} onPress={() => { setHorizon(o.v); setSub("legal"); }}>
                      <Text style={S.choiceTitle}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {sub === "legal" && (
              <>
                <Text style={S.title}>{t("onboardingQuick.title")}</Text>

                <View style={[S.legalBox, { marginTop: 20 }]}>
                  <Text style={S.legalBadge}>{t("onboarding.step9.legalBadge")}</Text>
                  <Text style={S.legalBody}>
                    {t("onboarding.step9.legalBodyPart1")}{" "}
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.legalBodyBold1")}</Text>.
                    {" "}{t("onboarding.step9.legalBodyPart2")}{" "}
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.legalBodyBold2")}</Text>{" "}
                    {t("onboarding.step9.legalBodyPart3")}
                  </Text>
                  <Text style={[S.legalBody, { marginTop: 8 }]}>
                    {t("onboarding.step9.legalBodyPart4")}{" "}
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.legalBodyBold3")}</Text>
                  </Text>
                </View>

                <TouchableOpacity style={[S.checkRow, { marginTop: 16 }]} onPress={() => setAcceptedTerms((v) => !v)} activeOpacity={0.7}>
                  <View style={[S.checkbox, acceptedTerms && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
                    {acceptedTerms && <Ionicons name="checkmark" size={12} color="white" />}
                  </View>
                  <Text style={S.checkLabel}>
                    {t("onboarding.step9.termsPrefix")}{" "}
                    <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}
                          onPress={(e) => { e.stopPropagation(); Linking.openURL("https://nuvosai.com/terms"); }}>
                      {t("onboarding.step9.termsOfUse")}
                    </Text>
                    {" "}{t("onboarding.step9.and")}{" "}
                    <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}
                          onPress={(e) => { e.stopPropagation(); Linking.openURL("https://nuvosai.com/privacy"); }}>
                      {t("onboarding.step9.privacyPolicy")}
                    </Text>.
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={[S.checkRow, { marginTop: 14 }]} onPress={() => setAcceptedDisclaimer((v) => !v)} activeOpacity={0.7}>
                  <View style={[S.checkbox, acceptedDisclaimer && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
                    {acceptedDisclaimer && <Ionicons name="checkmark" size={12} color="white" />}
                  </View>
                  <Text style={S.checkLabel}>
                    {t("onboarding.step9.understandPrefix")}{" "}
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{t("onboarding.step9.understandBold")}</Text>.
                    {" "}{t("onboarding.step9.understandSuffix")}
                  </Text>
                </TouchableOpacity>

                {error && (
                  <View style={S.errorBox}>
                    <Text style={{ color: "#f87171", fontSize: 13 }}>{error}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[S.submitBtn, !canSubmit && S.submitBtnDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                  activeOpacity={0.85}
                >
                  {loading ? <ActivityIndicator color="#000" /> : (
                    <Text style={S.submitText}>{t("onboardingQuick.continueButton")}</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <MobileBrokerConnectModal
        visible={brokerModalOpen}
        onClose={() => setBrokerModalOpen(false)}
        onPositionsImported={(positions) => {
          positions.forEach((p) => {
            if (p.shares > 0) addPosition({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avgPrice });
          });
          setConnectedCount((c) => c + positions.length);
          setBrokerModalOpen(false);
        }}
      />
    </View>
  );
}

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0d12" },
  title: { fontSize: 26, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 32, marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#6b7280", lineHeight: 21 },
  label: { color: "#9ca3af", fontSize: 13, fontWeight: "600", letterSpacing: 0.2, marginBottom: 9 },
  hint: { color: "#4b5563", fontSize: 11, marginTop: 6, lineHeight: 16 },
  backLink: { color: "#9ca3af", fontSize: 12, fontWeight: "700", marginBottom: 14 },
  orLabel: { color: "#4b5563", fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: 18, marginBottom: 10 },
  input: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16,
    color: "#fff", fontSize: 16,
  },
  choiceCard: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
    borderRadius: 16, padding: 16,
  },
  choiceTitle: { color: "#fff", fontSize: 14, fontWeight: "700" },
  choiceHint: { color: "#9ca3af", fontSize: 12, marginTop: 3 },
  importedBox: {
    marginTop: 14, borderWidth: 1, borderColor: "rgba(0,212,126,0.25)",
    backgroundColor: "rgba(0,212,126,0.08)", borderRadius: 14, padding: 12,
  },
  legalBox: { borderWidth: 1, borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 16, padding: 18 },
  legalBadge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, color: "#f59e0b", marginBottom: 10 },
  legalBody: { fontSize: 12, color: "#9ca3af", lineHeight: 19 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#2a2d3a",
    alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0,
  },
  checkLabel: { flex: 1, fontSize: 13, color: "#9ca3af", lineHeight: 20 },
  errorBox: { marginTop: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 14 },
  submitBtn: {
    marginTop: 24, backgroundColor: "#00d47e", borderRadius: 16,
    paddingVertical: 17, alignItems: "center", justifyContent: "center",
    shadowColor: "#00d47e", shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitText: { color: "#000", fontWeight: "900", fontSize: 16, letterSpacing: 0.1 },
});
