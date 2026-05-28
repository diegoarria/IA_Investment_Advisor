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
import * as WebBrowser from "expo-web-browser";
import { authApi, profileApi } from "../src/lib/api";
import { supabase } from "../src/lib/supabase";
import { useTheme, Colors } from "../src/lib/ThemeContext";
import { useAppStore } from "../src/lib/profileStore";
import type { UserProfile } from "../src/lib/profileStore";

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = "nuvo://";

export default function AuthScreen() {
  const { colors, isDark, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const setProfile = useAppStore((s) => s.setProfile);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setChecking(false);
  }, []);

  const afterAuth = async (accessToken: string, refreshToken: string, userId: string) => {
    await SecureStore.setItemAsync("access_token", accessToken);
    await SecureStore.setItemAsync("user_id", userId);
    if (refreshToken) await SecureStore.setItemAsync("refresh_token", refreshToken);
    try {
      const profileRes = await profileApi.get();
      const p = profileRes.data as UserProfile;
      setProfile({
        name: p.name,
        birth_date: p.birth_date,
        monthly_income: p.monthly_income,
        monthly_contribution: p.monthly_contribution,
        risk_tolerance: p.risk_tolerance as UserProfile["risk_tolerance"],
        quiz_answers: p.quiz_answers as UserProfile["quiz_answers"],
        mentor: p.mentor ?? null,
      });
      router.replace("/(tabs)/chat");
    } catch {
      router.replace("/onboarding");
    }
  };

  const handleSubmit = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      const fn = mode === "login" ? authApi.login : authApi.register;
      const res = await fn(email.trim().toLowerCase(), password);
      await afterAuth(res.data.access_token, res.data.refresh_token, res.data.user_id);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      Alert.alert("Error", msg || (mode === "login" ? "Credenciales inválidas" : "No se pudo crear la cuenta"));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: "google") => {
    setSocialLoading(provider);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: REDIRECT_URL,
          skipBrowserRedirect: true,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error || !data.url) throw error ?? new Error("No OAuth URL");

      const result = await WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL);
      if (result.type !== "success") return;

      const hash = result.url.split("#")[1] ?? result.url.split("?")[1] ?? "";
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (access_token && refresh_token) {
        const { data: sessionData } = await supabase.auth.setSession({ access_token, refresh_token });
        if (sessionData.session && sessionData.user) {
          await afterAuth(access_token, refresh_token, sessionData.user.id);
        }
      }
    } catch {
      Alert.alert("Error", `No se pudo iniciar sesión con ${provider === "google" ? "Google" : "Facebook"}`);
    } finally {
      setSocialLoading(null);
    }
  };

  const anyLoading = loading || socialLoading !== null;

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

          {/* Social buttons */}
          <View style={styles.socialGroup}>
            <TouchableOpacity
              style={styles.socialBtn}
              onPress={() => handleOAuthLogin("google")}
              disabled={anyLoading}
            >
              {socialLoading === "google" ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <>
                  <Text style={styles.googleG}>G</Text>
                  <Text style={styles.socialBtnText}>Continuar con Google</Text>
                </>
              )}
            </TouchableOpacity>

          </View>

          {/* Divider */}
          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>o con email</Text>
            <View style={styles.dividerLine} />
          </View>

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

            <TouchableOpacity
              style={[styles.button, anyLoading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={anyLoading}
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
  });
}
