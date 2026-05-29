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
import { authApi, profileApi } from "../src/lib/api";
import { useTheme, Colors } from "../src/lib/ThemeContext";
import { useAppStore } from "../src/lib/profileStore";
import type { UserProfile } from "../src/lib/profileStore";

export default function AuthScreen() {
  const { colors, isDark, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const setProfile = useAppStore((s) => s.setProfile);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync("access_token");
        if (!token) { setChecking(false); return; }
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
        // Token inválido o expirado — mostrar pantalla de login
        await SecureStore.deleteItemAsync("access_token").catch(() => {});
        await SecureStore.deleteItemAsync("refresh_token").catch(() => {});
        setChecking(false);
      }
    })();
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

  const anyLoading = loading;

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
