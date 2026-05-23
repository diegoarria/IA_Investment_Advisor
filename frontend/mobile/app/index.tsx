import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { authApi, profileApi } from "../src/lib/api";
import { useTheme, Colors } from "../src/lib/ThemeContext";

export default function AuthScreen() {
  const { colors, isDark, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      const fn = mode === "login" ? authApi.login : authApi.register;
      const res = await fn(email, password);
      await SecureStore.setItemAsync("access_token", res.data.access_token);
      await SecureStore.setItemAsync("user_id", res.data.user_id);
      try {
        await profileApi.get();
        router.replace("/(tabs)/chat");
      } catch {
        router.replace("/onboarding");
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      Alert.alert("Error", msg || "Credenciales inválidas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.themeToggle} onPress={toggle}>
        <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={22} color={colors.textMuted} />
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.content}
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Ionicons name="trending-up" size={28} color="white" />
          </View>
          <Text style={styles.title}>Finzo</Text>
          <Text style={styles.subtitle}>Tu mentor de inversiones inteligente</Text>
        </View>

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

          <TouchableOpacity style={styles.devSkip} onPress={() => router.replace("/onboarding")}>
            <Ionicons name="settings-outline" size={12} color={colors.textDim} />
            <Text style={styles.devSkipText}> Saltar al onboarding (dev)</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    themeToggle: { position: "absolute", top: 56, right: 24, zIndex: 10 },
    content: { flex: 1, justifyContent: "center", padding: 24 },
    header: { alignItems: "center", marginBottom: 48 },
    logo: {
      width: 64, height: 64, backgroundColor: "#16a34a",
      borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 16,
    },
    title: { fontSize: 24, fontWeight: "700", color: c.text, marginBottom: 8 },
    subtitle: { fontSize: 14, color: c.textMuted, textAlign: "center" },
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
