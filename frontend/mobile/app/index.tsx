import React, { useState, useMemo, useEffect } from "react";
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

// Face ID no funciona en Expo Go — requiere build nativo
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApi, profileApi, syncApi, referralApi } from "../src/lib/api";
import { useTheme, Colors } from "../src/lib/ThemeContext";
import { useAppStore } from "../src/lib/profileStore";
import type { UserProfile } from "../src/lib/profileStore";
import { usePortfolioStore } from "../src/lib/portfolioStore";

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
import { usePaperStore } from "../src/lib/paperStore";
import { useSubscriptionStore } from "../src/lib/subscriptionStore";
import { useChatStore } from "../src/lib/chatStore";

const BIOMETRIC_EMAIL_KEY    = "biometric_email";
const BIOMETRIC_PASSWORD_KEY = "biometric_password";
const BIOMETRIC_ENABLED_KEY  = "biometric_enabled";

export default function AuthScreen() {
  const { colors, isDark, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

  // Forgot password
  const [forgotStep, setForgotStep]       = useState<"email" | "code" | "newpass">("email");
  const [forgotMethod, setForgotMethod]   = useState<"email" | "sms">("email");
  const [forgotEmail, setForgotEmail]     = useState("");
  const [forgotPhone, setForgotPhone]     = useState("");
  const [forgotCode, setForgotCode]       = useState("");
  const [forgotNewPass, setForgotNewPass] = useState("");
  const [forgotDone, setForgotDone]       = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Auto-dispara Face ID al cargar si ya hay credenciales guardadas
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
            name: p.name,
            birth_date: p.birth_date,
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
          if (d.portfolio?.positions?.length)
            usePortfolioStore.getState().restoreFromServer(d.portfolio.positions);
          if (d.paper)
            usePaperStore.getState().restoreFromServer({
              cash:           d.paper.cash,
              positions:      d.paper.positions,
              trades:         d.paper.trades,
              freeTradeMonth: d.paper.freeTradeMonth,
              freeTradeCount: d.paper.freeTradeCount,
            });
          if (d.maturity) {
            const local = useAppStore.getState().maturityScore;
            if (d.maturity.score >= local)
              useAppStore.setState({ maturityScore: d.maturity.score, maturityHistory: d.maturity.history });
          }
          if (d.trial?.trial_started_at)
            useSubscriptionStore.setState({ trialStartDate: d.trial.trial_started_at });
          // avatar_url also returned by sync/all as a convenience
          if (d.avatar_url && !useAppStore.getState().profile?.avatarUri) {
            useAppStore.setState((s) => ({
              profile: s.profile ? { ...s.profile, avatarUri: d.avatar_url } : s.profile,
            }));
          }
        }

        // Restore chat history from server in background
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
          name: p.name,
          birth_date: p.birth_date,
          monthly_income: p.monthly_income,
          monthly_contribution: p.monthly_contribution,
          risk_tolerance: p.risk_tolerance as UserProfile["risk_tolerance"],
          quiz_answers: p.quiz_answers as UserProfile["quiz_answers"],
          mentor: p.mentor ?? null,
          avatarUri: p.avatar_url ?? useAppStore.getState().profile?.avatarUri ?? null,
        });
      }

      if (syncRes.status === "fulfilled") {
        const d = syncRes.value.data;
        if (d.portfolio?.positions?.length)
          usePortfolioStore.getState().restoreFromServer(d.portfolio.positions);
        if (d.paper)
          usePaperStore.getState().restoreFromServer({
            cash:           d.paper.cash,
            positions:      d.paper.positions,
            trades:         d.paper.trades,
            freeTradeMonth: d.paper.freeTradeMonth,
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

      // Restore chat history from server (always — server is source of truth)
      useChatStore.getState().restoreFromServer().catch(() => {});

      const hasLocalProfile = !!useAppStore.getState().profile?.name;
      if (profileRes.status === "fulfilled") {
        router.replace(await getStartRoute() as any);
      } else {
        // Only send to onboarding if profile truly doesn't exist (new user, 404)
        // AND there's no local profile in the store (extra safety against sending
        // existing users to onboarding due to network errors or token timing).
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
    if (IS_EXPO_GO) return; // Face ID no disponible en Expo Go
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled    = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) return;

      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const hasFaceId = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
      const label = hasFaceId ? "Face ID" : "huella digital";

      Alert.alert(
        `Activar ${label}`,
        `¿Quieres usar ${label} para iniciar sesión la próxima vez sin escribir tu contraseña?`,
        [
          { text: "Ahora no", style: "cancel" },
          {
            text: "Activar",
            onPress: async () => {
              await SecureStore.setItemAsync(BIOMETRIC_EMAIL_KEY,    emailUsed);
              await SecureStore.setItemAsync(BIOMETRIC_PASSWORD_KEY, passwordUsed);
              await SecureStore.setItemAsync(BIOMETRIC_ENABLED_KEY,  "true");
            },
          },
        ]
      );
    } catch {}
  };

  // 30s resend countdown when code step is entered
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
      if (mode === "register" && refCode.trim()) {
        referralApi.applyCode(refCode.trim().toUpperCase()).catch(() => {});
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
      // Verify credentials still exist before even trying biometrics
      const savedEmail    = await SecureStore.getItemAsync(BIOMETRIC_EMAIL_KEY);
      const savedPassword = await SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY);
      if (!savedEmail || !savedPassword) {
        await SecureStore.deleteItemAsync(BIOMETRIC_ENABLED_KEY);
        setBiometricReady(false);
        Alert.alert(
          "Configura Face ID",
          "Ingresa con tu email y contraseña una vez. Al entrar te pediremos activar Face ID automáticamente.",
        );
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
        Alert.alert(
          "Face ID no funcionó",
          "Usa tu email y contraseña para entrar. Face ID se reactivará automáticamente.",
        );
        return;
      }

      const res = await authApi.login(savedEmail, savedPassword);
      await afterAuth(res.data.access_token, res.data.refresh_token, res.data.user_id);
    } catch {
      Alert.alert("Error", "No se pudo autenticar. Intenta con tu contraseña.");
    } finally {
      setBiometricLoading(false);
    }
  };

  if (checking) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.themeToggle} onPress={toggle}>
        <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={22} color={colors.textMuted} />
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.kav}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Image source={require("../assets/images/logo_new.png")} style={styles.logo} />
            <Text style={styles.title}>Nuvos AI</Text>
            <Text style={styles.subtitle}>Tu mentor de inversiones inteligente</Text>
            <Text style={styles.slogan}>Con Nuvos, construye tu futuro.</Text>
          </View>

          {/* Face ID button — always visible when hardware exists */}
          {biometricAvailable && mode === "login" && (
            <TouchableOpacity
              style={[styles.biometricBtn, biometricLoading && styles.buttonDisabled]}
              onPress={handleBiometric}
              disabled={biometricLoading}
              activeOpacity={0.82}
            >
              {biometricLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <Ionicons name="scan-circle-outline" size={30} color="white" />
                  <Text style={styles.biometricText}>
                    {biometricReady ? "Entrar con Face ID" : "Configurar Face ID"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Divider */}
          {biometricAvailable && mode === "login" && (
            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.textMuted }]}>o continúa con email</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>
          )}

          {/* Forgot password flow */}
          {mode === "forgot" ? (
            <View style={styles.form}>
              {forgotDone ? (
                <View style={{ alignItems: "center", gap: 12, paddingVertical: 16 }}>
                  <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(34,197,94,0.12)", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ fontSize: 24, color: "#22c55e" }}>✓</Text>
                  </View>
                  <Text style={[styles.buttonText, { color: colors.text, fontSize: 18 }]}>¡Contraseña actualizada!</Text>
                  <Text style={[styles.switchText, { textAlign: "center" }]}>Ya puedes iniciar sesión con tu nueva contraseña.</Text>
                  <TouchableOpacity style={styles.button} onPress={() => { setMode("login"); setForgotStep("email"); setForgotDone(false); }}>
                    <Text style={styles.buttonText}>Iniciar sesión</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity onPress={() => { setMode("login"); setForgotStep("email"); }} style={{ marginBottom: 20 }}>
                    <Text style={[styles.switchLink, { fontSize: 14 }]}>← Volver</Text>
                  </TouchableOpacity>

                  <Text style={[styles.label, { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 4 }]}>
                    {forgotStep === "email" ? "¿Olvidaste tu contraseña?" : forgotStep === "code" ? `Revisa tu ${forgotMethod === "sms" ? "teléfono" : "email"}` : "Nueva contraseña"}
                  </Text>
                  <Text style={[styles.switchText, { textAlign: "left", marginBottom: 20 }]}>
                    {forgotStep === "email"
                      ? "Elige cómo recibir tu código de verificación."
                      : forgotStep === "code"
                      ? `Ingresa el código enviado a ${forgotMethod === "sms" ? forgotPhone : forgotEmail}.`
                      : "Elige una contraseña segura (mínimo 6 caracteres)."}
                  </Text>

                  {forgotStep === "email" && (
                    <>
                      {/* Method selector */}
                      <View style={[styles.methodRow, { backgroundColor: colors.bg }]}>
                        {(["email", "sms"] as const).map((m) => (
                          <TouchableOpacity
                            key={m}
                            style={[styles.methodBtn, forgotMethod === m && { backgroundColor: colors.card }]}
                            onPress={() => setForgotMethod(m)}
                          >
                            <Text style={[styles.methodBtnText, { color: forgotMethod === m ? colors.text : colors.textMuted }]}>
                              {m === "email" ? "📧  Email" : "💬  SMS"}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>

                      <Text style={styles.label}>Correo electrónico</Text>
                      <TextInput
                        style={styles.input}
                        value={forgotEmail}
                        onChangeText={setForgotEmail}
                        placeholder="tu@email.com"
                        placeholderTextColor={colors.placeholder}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoFocus
                      />

                      {forgotMethod === "sms" && (
                        <>
                          <Text style={[styles.label, { marginTop: 12 }]}>Número de teléfono</Text>
                          <TextInput
                            style={styles.input}
                            value={forgotPhone}
                            onChangeText={setForgotPhone}
                            placeholder="+52 55 1234 5678"
                            placeholderTextColor={colors.placeholder}
                            keyboardType="phone-pad"
                          />
                          <Text style={[styles.switchText, { fontSize: 11, marginTop: 4, marginBottom: 0 }]}>
                            Incluye el código de país, ej: +52 para México
                          </Text>
                        </>
                      )}
                    </>
                  )}

                  {forgotStep === "code" && (
                    <>
                      <Text style={styles.label}>Código de verificación</Text>
                      <TextInput
                        style={[styles.input, { textAlign: "center", fontSize: 28, fontWeight: "900", letterSpacing: 12 }]}
                        value={forgotCode}
                        onChangeText={(t) => setForgotCode(t.replace(/\D/g, "").slice(0, 6))}
                        placeholder="000000"
                        placeholderTextColor={colors.placeholder}
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                      />
                      {/* Resend countdown */}
                      <View style={{ alignItems: "center", marginTop: 12 }}>
                        {resendCooldown > 0 ? (
                          <Text style={[styles.switchText, { marginBottom: 0 }]}>
                            Reenviar en{" "}
                            <Text style={{ fontWeight: "700", color: "#22c55e" }}>{resendCooldown}s</Text>
                          </Text>
                        ) : (
                          <TouchableOpacity
                            disabled={loading}
                            onPress={async () => {
                              setLoading(true);
                              try {
                                if (forgotMethod === "sms") {
                                  await authApi.forgotPasswordSms(forgotEmail.trim().toLowerCase(), forgotPhone.trim());
                                } else {
                                  await authApi.forgotPassword(forgotEmail.trim().toLowerCase());
                                }
                                setResendCooldown(30);
                              } catch {}
                              setLoading(false);
                            }}
                          >
                            <Text style={{ color: "#22c55e", fontWeight: "700", fontSize: 13 }}>
                              Reenviar código →
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </>
                  )}

                  {forgotStep === "newpass" && (
                    <>
                      <Text style={styles.label}>Nueva contraseña</Text>
                      <TextInput
                        style={styles.input}
                        value={forgotNewPass}
                        onChangeText={setForgotNewPass}
                        placeholder="Mínimo 6 caracteres"
                        placeholderTextColor={colors.placeholder}
                        secureTextEntry
                        autoFocus
                      />
                    </>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.button,
                      (loading
                        || (forgotStep === "email" && (!forgotEmail || (forgotMethod === "sms" && !forgotPhone)))
                        || (forgotStep === "code" && forgotCode.length < 6)
                        || (forgotStep === "newpass" && forgotNewPass.length < 6)
                      ) && styles.buttonDisabled,
                    ]}
                    onPress={handleForgotSubmit}
                    disabled={loading
                      || (forgotStep === "email" && (!forgotEmail || (forgotMethod === "sms" && !forgotPhone)))
                      || (forgotStep === "code" && forgotCode.length < 6)
                      || (forgotStep === "newpass" && forgotNewPass.length < 6)}
                  >
                    {loading ? <ActivityIndicator color="white" /> : (
                      <Text style={styles.buttonText}>
                        {forgotStep === "email" ? "Enviar código" : forgotStep === "code" ? "Verificar" : "Actualizar contraseña"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
          /* Email/password form */
          <View style={styles.form}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="tu@email.com"
              placeholderTextColor={colors.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, marginBottom: 6 }}>
              <Text style={styles.label}>Contraseña</Text>
              {mode === "login" && (
                <TouchableOpacity onPress={() => { setMode("forgot"); setForgotEmail(email); setForgotStep("email"); }}>
                  <Text style={[styles.switchLink, { fontSize: 12 }]}>¿Olvidaste tu contraseña?</Text>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.placeholder}
              secureTextEntry
            />

            {mode === "register" && (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>Código de referido (opcional)</Text>
                <TextInput
                  style={styles.input}
                  value={refCode}
                  onChangeText={(t) => setRefCode(t.toUpperCase())}
                  placeholder="Ej: AB3XY7Z2"
                  placeholderTextColor={colors.placeholder}
                  autoCapitalize="characters"
                  maxLength={8}
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>
                  {mode === "login" ? "Iniciar sesión" : "Crear cuenta"}
                </Text>
              )}
            </TouchableOpacity>


            <TouchableOpacity
              onPress={() => setMode(mode === "login" ? "register" : "login")}
              style={{ marginTop: 16 }}
            >
              <Text style={styles.switchText}>
                {mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
                <Text style={styles.switchLink}>
                  {mode === "login" ? "Crear una" : "Inicia sesión"}
                </Text>
              </Text>
            </TouchableOpacity>

            {/* Guest access */}
            <TouchableOpacity
              onPress={() => router.replace("/(tabs)/home")}
              style={styles.guestBtn}
              activeOpacity={0.6}
            >
              <Text style={styles.guestBtnText}>Explorar sin cuenta</Text>
            </TouchableOpacity>
          </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    themeToggle: { position: "absolute", top: 56, right: 24, zIndex: 10 },
    kav: { flex: 1 },
    content: { flexGrow: 1, justifyContent: "center", padding: 24, paddingTop: 72 },
    header: { alignItems: "center", marginBottom: 32 },
    logo: { width: 90, height: 90, borderRadius: 22, marginBottom: 16 },
    title: { fontSize: 24, fontWeight: "700", color: c.text, marginBottom: 8 },
    subtitle: { fontSize: 14, color: c.textMuted, textAlign: "center" },
    slogan: { fontSize: 13, fontWeight: "600", color: c.accentLight, textAlign: "center", marginTop: 6, letterSpacing: 0.3 },

    biometricBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      borderRadius: 14, paddingVertical: 16, marginBottom: 24,
      backgroundColor: "#16a34a",
      shadowColor: "#16a34a", shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
    },
    biometricText: { color: "white", fontSize: 16, fontWeight: "700" },

    form: {},
    label: { color: c.textSub, fontSize: 14, fontWeight: "500", marginBottom: 6 },
    input: {
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
      color: c.text, fontSize: 16,
    },
    button: {
      backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 16,
      alignItems: "center", marginTop: 24, marginBottom: 16,
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: "white", fontWeight: "600", fontSize: 16 },
    // Method selector (email / SMS)
    methodRow: { flexDirection: "row", borderRadius: 12, padding: 4, gap: 4, marginBottom: 16 },
    methodBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
    methodBtnText: { fontSize: 14, fontWeight: "600" },
    switchText: { color: c.textMuted, textAlign: "center", fontSize: 14 },
    switchLink: { color: "#22c55e", fontWeight: "500" },
    devSkip: { marginTop: 20, alignItems: "center", flexDirection: "row" },
    devSkipText: { color: c.textDim, fontSize: 12 },
    guestBtn: {
      marginTop: 8, alignItems: "center", paddingVertical: 14,
      borderWidth: 1, borderColor: c.border, borderRadius: 14,
      backgroundColor: "transparent",
    },
    guestBtnText: { color: c.textMuted, fontSize: 14, fontWeight: "600" },

    socialGroup: { gap: 10, marginBottom: 20 },
    appleBtn: { width: "100%", height: 52 },
    socialBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, paddingVertical: 14,
    },
    googleG: { fontSize: 16, fontWeight: "700", color: "#4285F4", width: 20, textAlign: "center" },
    socialBtnText: { color: c.text, fontSize: 15, fontWeight: "500" },
    facebookBtn: { backgroundColor: "#1877F2", borderColor: "#1877F2" },
    facebookBtnText: { color: "white" },
    divider: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
    dividerLine: { flex: 1, height: 1, backgroundColor: c.border },
    dividerText: { color: c.textMuted, fontSize: 13 },
  });
}
