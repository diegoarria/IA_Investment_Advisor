import React, { useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert,
  ActivityIndicator, Image, ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
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

export default function AuthScreen() {
  const setProfile = useAppStore((s) => s.setProfile);

  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      const t = setTimeout(() => handleBiometric(), 300);
      return () => clearTimeout(t);
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
    await useChatStore.persist.rehydrate();
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
      const label = hasFaceId ? "Face ID" : "huella digital";
      Alert.alert(
        `Activar ${label}`,
        `¿Quieres usar ${label} para iniciar sesión más rápido?`,
        [
          { text: "Ahora no", style: "cancel" },
          { text: "Activar", onPress: async () => {
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
      Alert.alert("Error", typeof detail === "string" ? detail : "Ocurrió un error. Inténtalo de nuevo.");
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
      Alert.alert("Error", msg || (mode === "login" ? "Credenciales inválidas" : "No se pudo crear la cuenta"));
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
        Alert.alert("Configura Face ID", "Ingresa con tu email y contraseña una vez. Al entrar te pediremos activar Face ID.");
        return;
      }
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceId = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: hasFaceId ? "Usa Face ID para entrar a Nuvos AI" : "Usa tu huella para entrar a Nuvos AI",
        cancelLabel: "Cancelar",
        disableDeviceFallback: true,
      });
      if (!result.success) {
        const err = (result as { error?: string }).error ?? "";
        if (err === "user_cancel" || err === "app_cancel" || err === "system_cancel") return;
        Alert.alert("Face ID no funcionó", "Usa tu email y contraseña para entrar.");
        return;
      }
      const res = await authApi.login(savedEmail, savedPassword);
      await afterAuth(res.data.access_token, res.data.refresh_token, res.data.user_id);
      posthog.capture("user_logged_in", { method: "biometric", biometric_type: hasFaceId ? "face_id" : "fingerprint" });
    } catch {
      Alert.alert("Error", "No se pudo autenticar. Intenta con tu contraseña.");
    } finally {
      setBiometricLoading(false);
    }
  };

  // ─── Loading splash ───────────────────────────────────────────────────────────
  if (checking) {
    return (
      <View style={S.screen}>
        <View style={S.glowOrb} />
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={S.splashLogoShell}>
            <Image source={require("../assets/images/logo_new.png")} style={S.splashLogo} />
          </View>
          <Text style={S.brandName}>Nuvos AI</Text>
          <ActivityIndicator size="small" color="#00d47e" style={{ marginTop: 32 }} />
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
      <View style={S.glowOrb} />
      <SafeAreaView style={{ flex: 1 }}>
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
              <Text style={S.tagline}>Con Nuvos, construye tu futuro.</Text>
              <View style={S.pill}>
                <Text style={S.pillText}>La plataforma que conoce tu portafolio y transforma la información financiera compleja en explicaciones claras y personalizadas para ayudarte a invertir con confianza.</Text>
              </View>
            </View>

            {/* ── Face ID ── */}
            {biometricAvailable && mode === "login" && (
              <TouchableOpacity
                style={[S.biometricCard, biometricLoading && { opacity: 0.6 }]}
                onPress={handleBiometric}
                disabled={biometricLoading}
                activeOpacity={0.8}
              >
                {biometricLoading ? (
                  <ActivityIndicator color="#00d47e" size="small" style={{ margin: 4 }} />
                ) : (
                  <>
                    <View style={S.biometricIcon}>
                      <Ionicons name="scan-circle-outline" size={26} color="#00d47e" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={S.biometricTitle}>
                        {biometricReady ? "Continuar con Face ID" : "Configurar Face ID"}
                      </Text>
                      <Text style={S.biometricSub}>
                        {biometricReady ? "Toca para autenticarte" : "Ingresa una vez con email"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#374151" />
                  </>
                )}
              </TouchableOpacity>
            )}

            {biometricAvailable && mode === "login" && (
              <View style={S.divider}>
                <View style={S.dividerLine} />
                <Text style={S.dividerLabel}>o continúa con email</Text>
                <View style={S.dividerLine} />
              </View>
            )}

            {/* ── Forgot password flow ── */}
            {mode === "forgot" ? (
              <View>
                {forgotDone ? (
                  <View style={{ alignItems: "center", paddingVertical: 32 }}>
                    <View style={S.successIcon}>
                      <Ionicons name="checkmark-circle" size={40} color="#00d47e" />
                    </View>
                    <Text style={[S.sectionTitle, { marginTop: 16, marginBottom: 8 }]}>¡Contraseña actualizada!</Text>
                    <Text style={[S.sectionSub, { textAlign: "center", marginBottom: 28 }]}>
                      Ya puedes iniciar sesión con tu nueva contraseña.
                    </Text>
                    <TouchableOpacity
                      style={S.submitBtn}
                      onPress={() => { setMode("login"); setForgotStep("email"); setForgotDone(false); }}
                    >
                      <Text style={S.submitText}>Iniciar sesión</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      onPress={() => { setMode("login"); setForgotStep("email"); }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 28 }}
                    >
                      <Ionicons name="arrow-back" size={18} color="#00d47e" />
                      <Text style={{ color: "#00d47e", fontSize: 14, fontWeight: "600" }}>Volver al login</Text>
                    </TouchableOpacity>

                    <Text style={S.sectionTitle}>
                      {forgotStep === "email" ? "¿Olvidaste tu contraseña?" :
                       forgotStep === "code"  ? `Revisa tu ${forgotMethod === "sms" ? "teléfono" : "email"}` :
                       "Nueva contraseña"}
                    </Text>
                    <Text style={[S.sectionSub, { marginBottom: 24 }]}>
                      {forgotStep === "email"
                        ? "Elige cómo recibir tu código de verificación."
                        : forgotStep === "code"
                        ? `Ingresa el código enviado a ${forgotMethod === "sms" ? forgotPhone : forgotEmail}.`
                        : "Elige una contraseña segura (mínimo 6 caracteres)."}
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
                              <Text style={[S.methodTabText, forgotMethod === m && { color: "#fff" }]}>
                                {m === "email" ? "📧  Email" : "💬  SMS"}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={S.inputLabel}>Correo electrónico</Text>
                        <TextInput
                          style={S.input} value={forgotEmail} onChangeText={setForgotEmail}
                          placeholder="tu@email.com" placeholderTextColor="#374151"
                          keyboardType="email-address" autoCapitalize="none" autoFocus
                        />
                        {forgotMethod === "sms" && (
                          <>
                            <Text style={[S.inputLabel, { marginTop: 16 }]}>Número de teléfono</Text>
                            <TextInput
                              style={S.input} value={forgotPhone} onChangeText={setForgotPhone}
                              placeholder="+52 55 1234 5678" placeholderTextColor="#374151"
                              keyboardType="phone-pad"
                            />
                            <Text style={S.hint}>Incluye el código de país, ej: +52 para México</Text>
                          </>
                        )}
                      </>
                    )}

                    {forgotStep === "code" && (
                      <>
                        <TextInput
                          style={[S.input, { textAlign: "center", fontSize: 32, fontWeight: "900", letterSpacing: 14 }]}
                          value={forgotCode}
                          onChangeText={(t) => setForgotCode(t.replace(/\D/g, "").slice(0, 6))}
                          placeholder="000000" placeholderTextColor="#374151"
                          keyboardType="number-pad" maxLength={6} autoFocus
                        />
                        <View style={{ alignItems: "center", marginTop: 16 }}>
                          {resendCooldown > 0 ? (
                            <Text style={{ color: "#4b5563", fontSize: 13 }}>
                              Reenviar en <Text style={{ color: "#00d47e", fontWeight: "700" }}>{resendCooldown}s</Text>
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
                              <Text style={{ color: "#00d47e", fontWeight: "700", fontSize: 13 }}>Reenviar código →</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </>
                    )}

                    {forgotStep === "newpass" && (
                      <>
                        <Text style={S.inputLabel}>Nueva contraseña</Text>
                        <TextInput
                          style={S.input} value={forgotNewPass} onChangeText={setForgotNewPass}
                          placeholder="Mínimo 6 caracteres" placeholderTextColor="#374151"
                          secureTextEntry autoFocus
                        />
                      </>
                    )}

                    <TouchableOpacity
                      style={[S.submitBtn, { marginTop: 24 }, forgotDisabled && S.submitDisabled]}
                      onPress={handleForgotSubmit}
                      disabled={forgotDisabled}
                    >
                      {loading ? <ActivityIndicator color="#000" /> : (
                        <Text style={S.submitText}>
                          {forgotStep === "email" ? "Enviar código" : forgotStep === "code" ? "Verificar" : "Actualizar contraseña"}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            ) : (
              /* ── Email / password form ── */
              <View>
                <View style={S.inputGroup}>
                  <Text style={S.inputLabel}>Email</Text>
                  <TextInput
                    style={S.input} value={email} onChangeText={setEmail}
                    placeholder="tu@email.com" placeholderTextColor="#374151"
                    keyboardType="email-address" autoCapitalize="none"
                  />
                </View>

                <View style={S.inputGroup}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <Text style={S.inputLabel}>Contraseña</Text>
                    {mode === "login" && (
                      <TouchableOpacity onPress={() => { setMode("forgot"); setForgotEmail(email); setForgotStep("email"); }}>
                        <Text style={{ color: "#00d47e", fontSize: 13, fontWeight: "600" }}>¿Olvidaste?</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <TextInput
                    style={S.input} value={password} onChangeText={setPassword}
                    placeholder="••••••••" placeholderTextColor="#374151" secureTextEntry
                  />
                </View>

                {mode === "register" && (
                  <View style={S.inputGroup}>
                    <Text style={S.inputLabel}>Código de referido (opcional)</Text>
                    <TextInput
                      style={S.input} value={refCode}
                      onChangeText={(t) => setRefCode(t.toUpperCase())}
                      placeholder="Ej: AB3XY7Z2" placeholderTextColor="#374151"
                      autoCapitalize="characters" maxLength={8}
                    />
                  </View>
                )}

                <TouchableOpacity
                  style={[S.submitBtn, loading && S.submitDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={S.submitText}>{mode === "login" ? "Iniciar sesión" : "Crear cuenta"}</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setMode(mode === "login" ? "register" : "login")}
                  style={{ marginTop: 22, alignItems: "center" }}
                >
                  <Text style={{ color: "#6b7280", fontSize: 14, textAlign: "center" }}>
                    {mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
                    <Text style={{ color: "#00d47e", fontWeight: "700" }}>
                      {mode === "login" ? "Crear una" : "Inicia sesión"}
                    </Text>
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.replace("/(tabs)/home")}
                  style={S.guestBtn}
                  activeOpacity={0.6}
                >
                  <Text style={S.guestText}>Explorar sin cuenta</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─── Styles — always dark, like Spotify ──────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0d12" },

  // Subtle green atmospheric glow at top
  glowOrb: {
    position: "absolute", top: -120, alignSelf: "center",
    width: 340, height: 340, borderRadius: 170,
    backgroundColor: "rgba(0,212,126,0.055)",
  },

  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48 },

  // ── Splash / loading ──
  splashLogoShell: {
    shadowColor: "#00d47e", shadowRadius: 32, shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 }, marginBottom: 20,
  },
  splashLogo: { width: 80, height: 80, borderRadius: 20 },

  // ── Hero ──
  hero: { alignItems: "center", paddingTop: 28, marginBottom: 44 },
  logoShell: {
    shadowColor: "#00d47e", shadowRadius: 28, shadowOpacity: 0.45,
    shadowOffset: { width: 0, height: 0 }, marginBottom: 22,
  },
  logo: { width: 88, height: 88, borderRadius: 22 },
  brandName: { fontSize: 38, fontWeight: "900", color: "#fff", letterSpacing: -1.2, marginBottom: 10 },
  tagline: { fontSize: 17, fontWeight: "800", color: "#fff", textAlign: "center", lineHeight: 24, marginBottom: 12 },
  pill: {
    backgroundColor: "rgba(255,255,255,0.04)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)", borderRadius: 14,
    paddingHorizontal: 18, paddingVertical: 10, marginHorizontal: 8,
  },
  pillText: { color: "#9ca3af", fontSize: 13, lineHeight: 20, textAlign: "center" },

  // ── Face ID card ──
  biometricCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#111318", borderWidth: 1,
    borderColor: "rgba(0,212,126,0.28)", borderRadius: 18,
    padding: 18, marginBottom: 20,
  },
  biometricIcon: {
    width: 46, height: 46, borderRadius: 13,
    backgroundColor: "rgba(0,212,126,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  biometricTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 3 },
  biometricSub: { color: "#6b7280", fontSize: 12 },

  // ── Divider ──
  divider: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 26 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "#1f2330" },
  dividerLabel: { color: "#374151", fontSize: 12, fontWeight: "500" },

  // ── Form ──
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: "#9ca3af", fontSize: 13, fontWeight: "600", letterSpacing: 0.2, marginBottom: 9 },
  input: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16,
    color: "#fff", fontSize: 16,
  },
  hint: { color: "#4b5563", fontSize: 11, marginTop: 6, lineHeight: 16 },

  // ── Primary CTA ──
  submitBtn: {
    backgroundColor: "#00d47e", borderRadius: 16, paddingVertical: 17,
    alignItems: "center", marginTop: 8,
    shadowColor: "#00d47e", shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 18, elevation: 8,
  },
  submitDisabled: { opacity: 0.45 },
  submitText: { color: "#000", fontSize: 16, fontWeight: "900", letterSpacing: 0.2 },

  // ── Ghost CTA ──
  guestBtn: {
    marginTop: 14, alignItems: "center", paddingVertical: 16,
    borderWidth: 1, borderColor: "#1a1d27", borderRadius: 16,
  },
  guestText: { color: "#374151", fontSize: 14, fontWeight: "600" },

  // ── Forgot flow ──
  sectionTitle: { fontSize: 24, fontWeight: "900", color: "#fff", letterSpacing: -0.5, marginBottom: 6 },
  sectionSub: { color: "#6b7280", fontSize: 14, lineHeight: 20 },
  successIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: "rgba(0,212,126,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  methodPicker: {
    flexDirection: "row", backgroundColor: "#0d1117", borderRadius: 12,
    padding: 4, marginBottom: 20, borderWidth: 1, borderColor: "#1a1d27",
  },
  methodTab: { flex: 1, paddingVertical: 11, borderRadius: 9, alignItems: "center" },
  methodTabActive: { backgroundColor: "#1f2330" },
  methodTabText: { color: "#6b7280", fontSize: 14, fontWeight: "600" },
});
