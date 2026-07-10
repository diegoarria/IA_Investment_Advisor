import React, { useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, Image, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { dark as colors } from "../src/lib/ThemeContext";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import Constants, { ExecutionEnvironment } from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApi, profileApi, syncApi, referralApi } from "../src/lib/api";
import { posthog } from "../src/config/posthog";
import { useAppStore } from "../src/lib/profileStore";
import type { UserProfile } from "../src/lib/profileStore";
import { usePortfolioStore } from "../src/lib/portfolioStore";
import { usePaperStore } from "../src/lib/paperStore";
import { useSubscriptionStore } from "../src/lib/subscriptionStore";
import { useChatStore } from "../src/lib/chatStore";
import { useWatchlistStore } from "../src/lib/watchlistStore";
import { useLearnStore } from "../src/lib/learnStore";
import { useLanguage } from "../src/lib/LanguageContext";
import { useTranslation } from "react-i18next";

const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const HOME_SCREEN_KEY = "nuvos_home_screen";
const SCREEN_ROUTES: Record<string, string> = {
  home:          "/(tabs)/home",
  chat:          "/(tabs)/chat",
  patrimonio:    "/(tabs)/patrimonio",
  notifications: "/(tabs)/notifications",
  academy:       "/(tabs)/academy",
};
async function getStartRoute(): Promise<string> {
  try {
    const key = await AsyncStorage.getItem(HOME_SCREEN_KEY);
    return (key && SCREEN_ROUTES[key]) ? SCREEN_ROUTES[key] : "/(tabs)/home";
  } catch {
    return "/(tabs)/home";
  }
}

const BIOMETRIC_EMAIL_KEY    = "biometric_email";
const BIOMETRIC_PASSWORD_KEY = "biometric_password";
const BIOMETRIC_ENABLED_KEY  = "biometric_enabled";

// Mirrors the web app's `.btn-primary` — a diagonal accent→accent-light
// gradient (web: `--grad-green`), instead of the flat single-color button
// this screen used before.
function GradientButton({
  onPress, disabled, style, children,
}: { onPress: () => void; disabled?: boolean; style?: any; children: React.ReactNode }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.85} style={style}>
      <LinearGradient
        colors={disabled ? [colors.textDim, colors.textDim] : [colors.accent, colors.accentLight]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={S.submitBtn}
      >
        {children}
      </LinearGradient>
    </TouchableOpacity>
  );
}

export default function AuthScreen() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguage();
  const setProfile = useAppStore((s) => s.setProfile);

  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [refCode, setRefCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  const [forgotStep, setForgotStep]       = useState<"email" | "code" | "newpass">("email");
  const [forgotMethod, setForgotMethod]   = useState<"email" | "sms">("email");
  const [forgotEmail, setForgotEmail]     = useState("");
  const [forgotPhone, setForgotPhone]     = useState("");
  const [forgotCode, setForgotCode]       = useState("");
  const [forgotNewPass, setForgotNewPass] = useState("");
  const [forgotDone, setForgotDone]       = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (biometricReady && mode === "login" && !checking) {
      const timer = setTimeout(() => handleBiometric(), 300);
      return () => clearTimeout(timer);
    }
  }, [biometricReady, checking]);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync("access_token");
        if (!token) {
          await _checkBiometricAvailability();
          setChecking(false);
          return;
        }
        const [profileRes, syncRes] = await Promise.allSettled([
          profileApi.get(),
          syncApi.getAll(),
        ]);
        if (profileRes.status === "fulfilled") {
          const p = profileRes.value.data as UserProfile & { avatar_url?: string };
          const existingAvatar = useAppStore.getState().profile?.avatarUri;
          setProfile({
            name: p.name, birth_date: p.birth_date,
            monthly_income: p.monthly_income,
            monthly_contribution: p.monthly_contribution,
            risk_tolerance: p.risk_tolerance as UserProfile["risk_tolerance"],
            quiz_answers: p.quiz_answers as UserProfile["quiz_answers"],
            mentor: p.mentor ?? null,
            avatarUri: p.avatar_url ?? existingAvatar ?? null,
          });
        } else {
          throw new Error("profile fetch failed");
        }
        if (syncRes.status === "fulfilled") {
          const d = syncRes.value.data;
          if (d.paper)
            usePaperStore.getState().restoreFromServer({
              cash: d.paper.cash, positions: d.paper.positions,
              trades: d.paper.trades, freeTradeMonth: d.paper.freeTradeMonth,
              freeTradeCount: d.paper.freeTradeCount,
            });
          if (d.maturity) {
            const local = useAppStore.getState().maturityScore;
            if (d.maturity.score >= local)
              useAppStore.setState({ maturityScore: d.maturity.score, maturityHistory: d.maturity.history });
          }
          if (d.trial?.trial_started_at)
            useSubscriptionStore.setState({ trialStartDate: d.trial.trial_started_at });
          if (d.avatar_url && !useAppStore.getState().profile?.avatarUri) {
            useAppStore.setState((s) => ({
              profile: s.profile ? { ...s.profile, avatarUri: d.avatar_url } : s.profile,
            }));
          }
        }
        // Portfolio uses its own store method, not the /sync/all "default" snapshot
        // above — that shape ignores which portfolio is actually active on this
        // device and has no guard against overwriting a pending local edit.
        usePortfolioStore.getState().loadFromServer().catch(() => {});
        useChatStore.getState().restoreFromServer().catch(() => {});
        router.replace(await getStartRoute() as any);
      } catch {
        await SecureStore.deleteItemAsync("access_token").catch(() => {});
        await SecureStore.deleteItemAsync("refresh_token").catch(() => {});
        await _checkBiometricAvailability();
        setChecking(false);
      }
    })();
  }, []);

  const _checkBiometricAvailability = async () => {
    if (IS_EXPO_GO) return;
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled    = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) return;
      setBiometricAvailable(true);
      const enabled    = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      const savedEmail = await SecureStore.getItemAsync(BIOMETRIC_EMAIL_KEY);
      const savedPass  = await SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY);
      if (enabled === "true" && savedEmail && savedPass) setBiometricReady(true);
    } catch {}
  };

  const afterAuth = async (accessToken: string, refreshToken: string, userId: string) => {
    await SecureStore.setItemAsync("access_token", accessToken);
    await SecureStore.setItemAsync("user_id", userId);
    if (refreshToken) await SecureStore.setItemAsync("refresh_token", refreshToken);
    // Re-hydrate every persisted store from THIS account's scoped storage keys —
    // without this, switching accounts on the same device kept the previous
    // account's in-memory state until the server sync happened to overwrite it
    // (and some of that sync logic is "max wins", so it sometimes never did).
    await Promise.all([
      useChatStore.persist.rehydrate(),
      useAppStore.persist.rehydrate(),
      usePortfolioStore.persist.rehydrate(),
      usePaperStore.persist.rehydrate(),
      useSubscriptionStore.persist.rehydrate(),
      useWatchlistStore.persist.rehydrate(),
      useLearnStore.persist.rehydrate(),
    ]);
    try {
      const [profileRes, syncRes] = await Promise.allSettled([
        profileApi.get(),
        syncApi.getAll(),
      ]);
      if (profileRes.status === "fulfilled") {
        const p = profileRes.value.data as UserProfile & { avatar_url?: string };
        setProfile({
          name: p.name, birth_date: p.birth_date,
          monthly_income: p.monthly_income,
          monthly_contribution: p.monthly_contribution,
          risk_tolerance: p.risk_tolerance as UserProfile["risk_tolerance"],
          quiz_answers: p.quiz_answers as UserProfile["quiz_answers"],
          mentor: p.mentor ?? null,
          avatarUri: p.avatar_url ?? useAppStore.getState().profile?.avatarUri ?? null,
        });
        posthog.identify(userId, {
          $set: { name: p.name, risk_tolerance: p.risk_tolerance as string, knowledge_level: (p.knowledge_level as string) ?? null },
          $set_once: { first_seen: new Date().toISOString() },
        });
      }
      if (syncRes.status === "fulfilled") {
        const d = syncRes.value.data;
        if (d.paper)
          usePaperStore.getState().restoreFromServer({
            cash: d.paper.cash, positions: d.paper.positions,
            trades: d.paper.trades, freeTradeMonth: d.paper.freeTradeMonth,
            freeTradeCount: d.paper.freeTradeCount,
          });
        if (d.maturity) {
          const local = useAppStore.getState().maturityScore;
          if (d.maturity.score >= local)
            useAppStore.setState({ maturityScore: d.maturity.score, maturityHistory: d.maturity.history });
        }
        if (d.trial?.trial_started_at)
          useSubscriptionStore.setState({ trialStartDate: d.trial.trial_started_at });
      }
      // Portfolio uses its own store method — see comment at the other call site
      // in this file for why the /sync/all "default" snapshot isn't safe here.
      usePortfolioStore.getState().loadFromServer().catch(() => {});
      useChatStore.getState().restoreFromServer().catch(() => {});
      const hasLocalProfile = !!useAppStore.getState().profile?.name;
      if (profileRes.status === "fulfilled") {
        router.replace(await getStartRoute() as any);
      } else {
        const status = (profileRes as PromiseRejectedResult).reason?.response?.status;
        const isNewUser = status === 404 && !hasLocalProfile;
        router.replace(isNewUser ? "/onboarding" : await getStartRoute() as any);
      }
    } catch (err: any) {
      const hasLocalProfile = !!useAppStore.getState().profile?.name;
      const status = err?.response?.status;
      const isNewUser = status === 404 && !hasLocalProfile;
      router.replace(isNewUser ? "/onboarding" : await getStartRoute() as any);
    }
  };

  const _offerBiometricSetup = async (emailUsed: string, passwordUsed: string) => {
    if (IS_EXPO_GO) return;
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled    = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) return;
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceId = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const label = hasFaceId ? "Face ID" : t("index.fingerprint");
      Alert.alert(
        t("index.activateBiometric", { label }),
        t("index.activateBiometricPrompt", { label }),
        [
          { text: t("index.notNow"), style: "cancel" },
          { text: t("index.activate"), onPress: async () => {
            await SecureStore.setItemAsync(BIOMETRIC_EMAIL_KEY,    emailUsed);
            await SecureStore.setItemAsync(BIOMETRIC_PASSWORD_KEY, passwordUsed);
            await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY,  "true");
          }},
        ]
      );
    } catch {}
  };

  useEffect(() => {
    if (forgotStep !== "code") return;
    setResendCooldown(30);
    const id = setInterval(() => setResendCooldown((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [forgotStep]);

  const handleForgotSubmit = async () => {
    setLoading(true);
    try {
      if (forgotStep === "email") {
        if (forgotMethod === "sms") {
          await authApi.forgotPasswordSms(forgotEmail.trim().toLowerCase(), forgotPhone.trim());
        } else {
          await authApi.forgotPassword(forgotEmail.trim().toLowerCase());
        }
        setForgotStep("code");
      } else if (forgotStep === "code") {
        setForgotStep("newpass");
      } else {
        await authApi.resetPassword(
          forgotEmail.trim().toLowerCase(), forgotCode, forgotNewPass,
          forgotMethod === "sms" ? forgotPhone.trim() : undefined,
        );
        setForgotDone(true);
      }
    } catch (err: unknown) {
      const detail = (err as any)?.response?.data?.detail;
      Alert.alert(t("index.error"), typeof detail === "string" ? detail : t("index.genericError"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const fn = mode === "login" ? authApi.login : authApi.register;
      const res = await fn(trimmedEmail, password);
      await afterAuth(res.data.access_token, res.data.refresh_token, res.data.user_id);
      if (mode === "register") {
        posthog.capture("user_signed_up", { method: "email", has_referral_code: !!refCode.trim() });
        if (refCode.trim()) referralApi.applyCode(refCode.trim().toUpperCase()).catch(() => {});
      } else {
        posthog.capture("user_logged_in", { method: "email" });
      }
      if (mode === "login") {
        const isEnabled = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
        const hasCreds  = await SecureStore.getItemAsync(BIOMETRIC_EMAIL_KEY);
        if (isEnabled !== "true" || !hasCreds) {
          await _offerBiometricSetup(trimmedEmail, password);
        }
      }
    } catch (err: unknown) {
      const detail = (err as any)?.response?.data?.detail;
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => d.msg ?? String(d)).join(", ")
        : typeof detail === "string" ? detail : null;
      Alert.alert(t("index.error"), msg || (mode === "login" ? t("index.invalidCredentials") : t("index.registerFailed")));
    } finally {
      setLoading(false);
    }
  };

  const handleBiometric = async () => {
    setBiometricLoading(true);
    try {
      const savedEmail    = await SecureStore.getItemAsync(BIOMETRIC_EMAIL_KEY);
      const savedPassword = await SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY);
      if (!savedEmail || !savedPassword) {
        await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
        setBiometricReady(false);
        Alert.alert(t("index.setUpFaceId"), t("index.setUpFaceIdBody"));
        return;
      }
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceId = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: hasFaceId ? t("index.useFaceId") : t("index.useFingerprint"),
        cancelLabel: t("common.cancel"),
        disableDeviceFallback: true,
      });
      if (!result.success) {
        const err = (result as { error?: string }).error ?? "";
        if (err === "user_cancel" || err === "app_cancel" || err === "system_cancel") return;
        Alert.alert(t("index.faceIdFailed"), t("index.faceIdFailedBody"));
        return;
      }
      const res = await authApi.login(savedEmail, savedPassword);
      await afterAuth(res.data.access_token, res.data.refresh_token, res.data.user_id);
      posthog.capture("user_logged_in", { method: "biometric", biometric_type: hasFaceId ? "face_id" : "fingerprint" });
    } catch {
      Alert.alert(t("index.error"), t("index.authFailed"));
    } finally {
      setBiometricLoading(false);
    }
  };

  // ─── Loading splash ───────────────────────────────────────────────────────────
  if (checking) {
    return (
      <View style={S.screen}>
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={S.splashLogoShell}>
            <Image source={require("../assets/images/logo_new.png")} style={S.splashLogo} />
          </View>
          <Text style={S.brandName}>Nuvos AI</Text>
          <ActivityIndicator size="small" color={colors.accentLight} style={{ marginTop: 32 }} />
        </SafeAreaView>
      </View>
    );
  }

  const forgotDisabled =
    loading ||
    (forgotStep === "email" && (!forgotEmail || (forgotMethod === "sms" && !forgotPhone))) ||
    (forgotStep === "code" && forgotCode.length < 6) ||
    (forgotStep === "newpass" && forgotNewPass.length < 6);

  // ─── Main render ──────────────────────────────────────────────────────────────
  return (
    <View style={S.screen}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={S.langToggle}>
          <TouchableOpacity
            onPress={() => setLanguage("en")}
            style={[S.langBtn, language === "en" && S.langBtnActive]}
            activeOpacity={0.8}
          >
            <Text style={[S.langBtnText, language === "en" && S.langBtnTextActive]}>EN🇺🇸</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setLanguage("es")}
            style={[S.langBtn, language === "es" && S.langBtnActive]}
            activeOpacity={0.8}
          >
            <Text style={[S.langBtnText, language === "es" && S.langBtnTextActive]}>ES🇪🇸</Text>
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={S.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Hero ── */}
            <View style={S.hero}>
              <View style={S.logoShell}>
                <Image source={require("../assets/images/logo_new.png")} style={S.logo} />
              </View>
              <Text style={S.brandName}>Nuvos AI</Text>
              <Text style={S.tagline}>{t("index.tagline")}</Text>
              <Text style={S.pillText}>{t("index.pillText")}</Text>
            </View>

            {/* ── Auth card — mirrors the web app's glass login card ── */}
            <View style={S.authCard}>

            {/* ── Face ID ── */}
            {biometricAvailable && mode === "login" && (
              <TouchableOpacity
                style={[S.biometricCard, biometricLoading && { opacity: 0.6 }]}
                onPress={handleBiometric}
                disabled={biometricLoading}
                activeOpacity={0.8}
              >
                {biometricLoading ? (
                  <ActivityIndicator color={colors.accentLight} size="small" style={{ margin: 4 }} />
                ) : (
                  <>
                    <View style={S.biometricIcon}>
                      <Ionicons name="scan-circle-outline" size={26} color={colors.accentLight} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.biometricTitle}>
                        {biometricReady ? t("index.continueWithFaceId") : t("index.setUpFaceIdShort")}
                      </Text>
                      <Text style={S.biometricSub}>
                        {biometricReady ? t("index.tapToAuthenticate") : t("index.enterOnceWithEmail")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </>
                )}
              </TouchableOpacity>
            )}

            {biometricAvailable && mode === "login" && (
              <View style={S.divider}>
                <View style={S.dividerLine} />
                <Text style={S.dividerLabel}>{t("index.orContinueWithEmail")}</Text>
                <View style={S.dividerLine} />
              </View>
            )}

            {/* ── Forgot password flow ── */}
            {mode === "forgot" ? (
              <View>
                {forgotDone ? (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <View style={S.successIcon}>
                      <Ionicons name="checkmark-circle" size={40} color={colors.accentLight} />
                    </View>
                    <Text style={[S.sectionTitle, { marginTop: 16, marginBottom: 8 }]}>{t("index.passwordUpdated")}</Text>
                    <Text style={[S.sectionSub, { textAlign: "center", marginBottom: 28 }]}>
                      {t("index.passwordUpdatedBody")}
                    </Text>
                    <GradientButton
                      onPress={() => { setMode("login"); setForgotStep("email"); setForgotDone(false); }}
                    >
                      <Text style={S.submitText}>{t("index.login")}</Text>
                    </GradientButton>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={() => { setMode("login"); setForgotStep("email"); }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 28 }}
                    >
                      <Ionicons name="arrow-back" size={18} color={colors.accentLight} />
                      <Text style={{ color: colors.accentLight, fontSize: 14, fontWeight: "600" }}>{t("index.backToLogin")}</Text>
                    </TouchableOpacity>

                    <Text style={S.sectionTitle}>
                      {forgotStep === "email" ? t("index.forgotPasswordTitle") :
                       forgotStep === "code"  ? t("index.checkYour", { channel: forgotMethod === "sms" ? t("index.phone") : t("index.email") }) :
                       t("index.newPassword")}
                    </Text>
                    <Text style={[S.sectionSub, { marginBottom: 24 }]}>
                      {forgotStep === "email"
                        ? t("index.chooseVerificationMethod")
                        : forgotStep === "code"
                        ? t("index.codeSentTo", { destination: forgotMethod === "sms" ? forgotPhone : forgotEmail })
                        : t("index.choosePassword")}
                    </Text>

                    {forgotStep === "email" && (
                      <>
                        <View style={S.methodPicker}>
                          {(["email", "sms"] as const).map((m) => (
                            <TouchableOpacity
                              key={m}
                              style={[S.methodTab, forgotMethod === m && S.methodTabActive]}
                              onPress={() => setForgotMethod(m)}
                            >
                              <Text style={[S.methodTabText, forgotMethod === m && { color: colors.text }]}>
                                {m === "email" ? t("index.emailOption") : t("index.smsOption")}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={S.inputLabel}>{t("index.emailLabel")}</Text>
                        <TextInput
                          style={S.input} value={forgotEmail} onChangeText={setForgotEmail}
                          placeholder="tu@email.com" placeholderTextColor={colors.placeholder}
                          keyboardType="email-address" autoCapitalize="none" autoFocus
                        />
                        {forgotMethod === "sms" && (
                          <>
                            <Text style={[S.inputLabel, { marginTop: 16 }]}>{t("index.phoneLabel")}</Text>
                            <TextInput
                              style={S.input} value={forgotPhone} onChangeText={setForgotPhone}
                              placeholder="+52 55 1234 5678" placeholderTextColor={colors.placeholder}
                              keyboardType="phone-pad"
                            />
                            <Text style={S.hint}>{t("index.countryCodeHint")}</Text>
                          </>
                        )}
                      </>
                    )}

                    {forgotStep === "code" && (
                      <>
                        <TextInput
                          style={[S.input, { textAlign: "center", fontSize: 32, fontWeight: "900", letterSpacing: 14 }]}
                          value={forgotCode}
                          onChangeText={(v) => setForgotCode(v.replace(/\D/g, "").slice(0, 6))}
                          placeholder="000000" placeholderTextColor={colors.placeholder}
                          keyboardType="number-pad" maxLength={6} autoFocus
                        />
                        <View style={{ alignItems: "center", marginTop: 16 }}>
                          {resendCooldown > 0 ? (
                            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                              {t("index.resendIn")} <Text style={{ color: colors.accentLight, fontWeight: "700" }}>{resendCooldown}s</Text>
                            </Text>
                          ) : (
                            <TouchableOpacity
                              disabled={loading}
                              onPress={async () => {
                                setLoading(true);
                                try {
                                  if (forgotMethod === "sms") await authApi.forgotPasswordSms(forgotEmail.trim().toLowerCase(), forgotPhone.trim());
                                  else await authApi.forgotPassword(forgotEmail.trim().toLowerCase());
                                  setResendCooldown(30);
                                } catch {}
                                setLoading(false);
                              }}
                            >
                              <Text style={{ color: colors.accentLight, fontWeight: "700", fontSize: 13 }}>{t("index.resendCode")}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}

                    {forgotStep === "newpass" && (
                      <>
                        <Text style={S.inputLabel}>{t("index.newPasswordLabel")}</Text>
                        <TextInput
                          style={S.input} value={forgotNewPass} onChangeText={setForgotNewPass}
                          placeholder={t("index.min6Chars")} placeholderTextColor={colors.placeholder}
                          secureTextEntry autoFocus
                        />
                      </>
                    )}

                    <GradientButton
                      style={{ marginTop: 24 }}
                      onPress={handleForgotSubmit}
                      disabled={forgotDisabled}
                    >
                      {loading ? <ActivityIndicator color="#000" /> : (
                        <Text style={S.submitText}>
                          {forgotStep === "email" ? t("index.sendCode") : forgotStep === "code" ? t("index.verify") : t("index.updatePassword")}
                        </Text>
                      )}
                    </GradientButton>
                  </>
                )}
              </View>
            ) : (
              /* ── Email / password form ── */
              <View>
                <View style={S.inputGroup}>
                  <Text style={S.inputLabel}>{t("index.emailLabel")}</Text>
                  <TextInput
                    style={[S.input, focusedField === "email" && S.inputFocused]}
                    value={email} onChangeText={setEmail}
                    onFocus={() => setFocusedField("email")} onBlur={() => setFocusedField(null)}
                    placeholder="tu@email.com" placeholderTextColor={colors.placeholder}
                    keyboardType="email-address" autoCapitalize="none"
                  />
                </View>

                <View style={S.inputGroup}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={S.inputLabel}>{t("index.passwordLabel")}</Text>
                    {mode === "login" && (
                      <TouchableOpacity onPress={() => { setMode("forgot"); setForgotEmail(email); setForgotStep("email"); }}>
                        <Text style={{ color: colors.accentLight, fontSize: 13, fontWeight: "600" }}>{t("index.forgot")}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={{ position: "relative", justifyContent: "center" }}>
                    <TextInput
                      style={[S.input, { paddingRight: 48 }, focusedField === "password" && S.inputFocused]}
                      value={password} onChangeText={setPassword}
                      onFocus={() => setFocusedField("password")} onBlur={() => setFocusedField(null)}
                      placeholder="••••••••" placeholderTextColor={colors.placeholder} secureTextEntry={!showPassword}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword((v) => !v)}
                      style={S.eyeToggle}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>
                </View>

                {mode === "register" && (
                  <View style={S.inputGroup}>
                    <Text style={S.inputLabel}>{t("index.referralCodeLabel")}</Text>
                    <TextInput
                      style={S.input} value={refCode}
                      onChangeText={(v) => setRefCode(v.toUpperCase())}
                      placeholder={t("index.referralPlaceholder")} placeholderTextColor={colors.placeholder}
                      autoCapitalize="characters" maxLength={8}
                    />
                  </View>
                )}

                <GradientButton onPress={handleSubmit} disabled={loading}>
                  {loading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={S.submitText}>{mode === "login" ? t("index.login") : t("index.createAccount")}</Text>
                  )}
                </GradientButton>

                <TouchableOpacity
                  onPress={() => setMode(mode === "login" ? "register" : "login")}
                  style={{ marginTop: 22, alignItems: "center" }}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 14, textAlign: "center" }}>
                    {mode === "login" ? t("index.noAccount") : t("index.hasAccount")}
                    <Text style={{ color: colors.accentLight, fontWeight: "700" }}>
                      {mode === "login" ? t("index.createOne") : t("index.login")}
                    </Text>
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.replace("/(tabs)/home")}
                  style={S.guestBtn}
                  activeOpacity={0.6}
                >
                  <Text style={S.guestText}>{t("index.exploreWithoutAccount")}</Text>
                </TouchableOpacity>
              </View>
            )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles — always dark, like Spotify ──────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48 },

  // ── Auth card — the web login page's "glass" card translated to a solid
  // card + hairline border (no backdrop-blur equivalent used here, to avoid
  // adding a new native dependency for one screen) ──
  authCard: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 28, padding: 22,
  },

  // ── Language toggle ──
  langToggle: {
    flexDirection: "row", alignSelf: "flex-end", gap: 4,
    marginTop: 8, marginRight: 20,
    backgroundColor: colors.bgRaised, borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 3,
  },
  langBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9 },
  langBtnActive: { backgroundColor: colors.accentLight },
  langBtnText: { fontSize: 11, fontWeight: "700", color: colors.textSub },
  langBtnTextActive: { color: colors.bg },

  // ── Splash / loading ──
  splashLogoShell: {
    shadowColor: colors.accentLight, shadowRadius: 32, shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 }, marginBottom: 20,
  },
  splashLogo: { width: 80, height: 80, borderRadius: 20 },

  // ── Hero ──
  hero: { alignItems: "center", paddingTop: 28, marginBottom: 44 },
  logoShell: {
    shadowColor: colors.accentLight, shadowRadius: 28, shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 }, marginBottom: 22,
  },
  logo: { width: 88, height: 88, borderRadius: 22 },
  brandName: { fontSize: 38, fontWeight: "900", color: colors.text, letterSpacing: -1.2, marginBottom: 10 },
  tagline: { fontSize: 17, fontWeight: "800", color: colors.text, textAlign: "center", lineHeight: 24, marginBottom: 12 },
  pillText: { color: colors.textSub, fontSize: 13, lineHeight: 20, textAlign: "center", paddingHorizontal: 12 },

  // ── Face ID card ──
  biometricCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: colors.bgRaised, borderWidth: 1,
    borderColor: "rgba(0,212,126,0.28)", borderRadius: 18,
    padding: 18, marginBottom: 20,
  },
  biometricIcon: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: "rgba(0,212,126,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  biometricTitle: { color: colors.text, fontSize: 15, fontWeight: "700", marginBottom: 3 },
  biometricSub: { color: colors.textMuted, fontSize: 12 },

  // ── Divider ──
  divider: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 26 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  dividerLabel: { color: colors.placeholder, fontSize: 12, fontWeight: "500" },

  // ── Form ──
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: colors.textSub, fontSize: 13, fontWeight: "600", letterSpacing: 0.2, marginBottom: 9 },
  input: {
    backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16,
    color: colors.text, fontSize: 16,
  },
  // Mirrors the web login page's `.input-premium` focus state — accent
  // border + a soft glow ring — instead of no focus feedback at all.
  inputFocused: {
    borderColor: colors.accent,
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5, shadowRadius: 6, elevation: 3,
  },
  eyeToggle: { position: "absolute", right: 16 },
  hint: { color: colors.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 },

  // ── Primary CTA — gradient fill supplied by <GradientButton>, this just
  // shapes the container it renders into ──
  submitBtn: {
    borderRadius: 16, paddingVertical: 17,
    alignItems: "center", marginTop: 8,
    shadowColor: colors.accentLight, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 18, elevation: 8,
  },
  submitText: { color: "#000", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },

  // ── Ghost CTA ──
  guestBtn: {
    marginTop: 14, alignItems: "center", paddingVertical: 16,
    borderWidth: 1, borderColor: colors.border, borderRadius: 16,
  },
  guestText: { color: colors.placeholder, fontSize: 14, fontWeight: "600" },

  // ── Forgot flow ──
  sectionTitle: { fontSize: 24, fontWeight: "900", color: colors.text, letterSpacing: -0.5, marginBottom: 6 },
  sectionSub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(0,212,126,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  methodPicker: {
    flexDirection: "row", backgroundColor: colors.bg, borderRadius: 12,
    padding: 4, marginBottom: 20, borderWidth: 1, borderColor: colors.border,
  },
  methodTab: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: "center" },
  methodTabActive: { backgroundColor: colors.borderStrong },
  methodTabText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
});
