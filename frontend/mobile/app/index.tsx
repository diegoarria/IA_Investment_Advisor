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
import { authApi, profileApi, syncApi, referralApi } from "../src/lib/api";
import { useTheme, Colors } from "../src/lib/ThemeContext";
import { useAppStore } from "../src/lib/profileStore";
import type { UserProfile } from "../src/lib/profileStore";
import { usePortfolioStore } from "../src/lib/portfolioStore";
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

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [refCode, setRefCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [biometricReady, setBiometricReady] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

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
            if (d.maturity.score > local)
              useAppStore.setState({ maturityScore: d.maturity.score, maturityHistory: d.maturity.history });
          }
          if (d.trial?.trial_started_at)
            useSubscriptionStore.setState({ trialStartDate: d.trial.trial_started_at });
        }

        router.replace("/(tabs)/chat");
      } catch {
        await SecureStore.deleteItemAsync("access_token").catch(() => {});
        await SecureStore.deleteItemAsync("refresh_token").catch(() => {});
        await _checkBiometricAvailability();
        setChecking(false);
      }
    })();
  }, []);

  const _checkBiometricAvailability = async () => {
    if (IS_EXPO_GO) return; // Face ID no disponible en Expo Go
    try {
      const enabled    = await SecureStore.getItemAsync(BIOMETRIC_ENABLED_KEY);
      const savedEmail = await SecureStore.getItemAsync(BIOMETRIC_EMAIL_KEY);
      const savedPass  = await SecureStore.getItemAsync(BIOMETRIC_PASSWORD_KEY);
      if (enabled !== "true" || !savedEmail || !savedPass) return;
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled    = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && enrolled) setBiometricReady(true);
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
        const p = profileRes.value.data as UserProfile;
        setProfile({
          name: p.name,
          birth_date: p.birth_date,
          monthly_income: p.monthly_income,
          monthly_contribution: p.monthly_contribution,
          risk_tolerance: p.risk_tolerance as UserProfile["risk_tolerance"],
          quiz_answers: p.quiz_answers as UserProfile["quiz_answers"],
          mentor: p.mentor ?? null,
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
          if (d.maturity.score > local)
            useAppStore.setState({ maturityScore: d.maturity.score, maturityHistory: d.maturity.history });
        }
        if (d.trial?.trial_started_at)
          useSubscriptionStore.setState({ trialStartDate: d.trial.trial_started_at });
      }

      router.replace(profileRes.status === "fulfilled" ? "/(tabs)/chat" : "/onboarding");
    } catch {
      router.replace("/onboarding");
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
          </View>

          {/* Face ID / Biometric button — shown when credentials are saved */}
          {biometricReady && mode === "login" && (
            <TouchableOpacity
              style={[styles.biometricBtn, biometricLoading && styles.buttonDisabled]}
              onPress={handleBiometric}
              disabled={biometricLoading}
            >
              {biometricLoading ? (
                <ActivityIndicator color="#16a34a" />
              ) : (
                <>
                  <Ionicons name="scan-outline" size={26} color="#16a34a" />
                  <Text style={styles.biometricText}>Entrar con Face ID</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Email/password form */}
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

            <Text style={[styles.label, { marginTop: 16 }]}>Contraseña</Text>
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

            <TouchableOpacity onPress={() => setMode(mode === "login" ? "register" : "login")}>
              <Text style={styles.switchText}>
                {mode === "login" ? "¿No tienes cuenta? " : "¿Ya tienes cuenta? "}
                <Text style={styles.switchLink}>
                  {mode === "login" ? "Crear una" : "Inicia sesión"}
                </Text>
              </Text>
            </TouchableOpacity>

            {/* Demo account for App Store review */}
            {mode === "login" && (
              <View style={styles.demoBox}>
                <Text style={styles.demoTitle}>Cuenta de demostración</Text>
                <Text style={styles.demoCredential}>
                  demo@nuvosai.app{"\n"}Demo1234!
                </Text>
                <TouchableOpacity
                  style={styles.demoBtn}
                  onPress={() => {
                    setEmail("demo@nuvosai.app");
                    setPassword("Demo1234!");
                  }}
                >
                  <Text style={styles.demoBtnText}>Usar cuenta demo</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
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

    biometricBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
      borderWidth: 2, borderColor: "#16a34a", borderRadius: 14,
      paddingVertical: 16, marginBottom: 24,
      backgroundColor: "rgba(22,163,74,0.06)",
    },
    biometricText: { color: "#16a34a", fontSize: 16, fontWeight: "700" },

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
    switchText: { color: c.textMuted, textAlign: "center", fontSize: 14 },
    switchLink: { color: "#22c55e", fontWeight: "500" },
    devSkip: { marginTop: 20, alignItems: "center", flexDirection: "row" },
    devSkipText: { color: c.textDim, fontSize: 12 },
    demoBox: {
      marginTop: 24, borderWidth: 1, borderColor: c.border,
      borderRadius: 12, padding: 14, alignItems: "center", gap: 6,
      backgroundColor: c.card,
    },
    demoTitle: { color: c.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
    demoCredential: { color: c.textSub, fontSize: 12, textAlign: "center", lineHeight: 20 },
    demoBtn: {
      marginTop: 4, backgroundColor: c.border, borderRadius: 8,
      paddingHorizontal: 16, paddingVertical: 8,
    },
    demoBtnText: { color: c.textSub, fontSize: 12, fontWeight: "700" },

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
