import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Platform, Modal, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useEffect, useState } from "react";
import { useFonts } from "expo-font";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  DMSans_800ExtraBold,
} from "@expo-google-fonts/dm-sans";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { ThemeProvider, useTheme } from "../src/lib/ThemeContext";
import Sidebar from "../src/components/Sidebar";
import { useSubscriptionStore, isTrialActive, hasPremiumAccess } from "../src/lib/subscriptionStore";
import PaywallModal from "../src/components/PaywallModal";
import * as Notifications from "expo-notifications";

const HIDE_SIDEBAR_ROUTES = ["/", "/onboarding"];

function TrialExpiredModal() {
  const { colors } = useTheme();
  const subStore = useSubscriptionStore();
  const [visible, setVisible] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  useEffect(() => {
    const trialStarted = subStore.trialStartDate !== null;
    const expired = trialStarted && !isTrialActive(subStore) && !hasPremiumAccess(subStore);
    if (expired) setVisible(true);
  }, [subStore.trialStartDate, subStore.tier]);

  if (!visible) return null;

  return (
    <>
      <Modal visible={visible && !paywallOpen} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>⏰</Text>
            <Text style={[s.title, { color: colors.text }]}>Tu prueba Premium terminó</Text>
            <Text style={[s.body, { color: colors.textMuted }]}>
              Tuviste 7 días de acceso completo. Activa Premium para seguir usando el Simulador avanzado, Simulador ilimitado, Stress Test completo y más.
            </Text>
            <TouchableOpacity
              style={[s.btn, { backgroundColor: "#f59e0b" }]}
              onPress={() => { setVisible(false); setPaywallOpen(true); }}
            >
              <Text style={{ color: "white", fontWeight: "800", fontSize: 15 }}>Activar Premium</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setVisible(false)} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.textDim, fontSize: 13 }}>Ahora no</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Activa Premium para acceso ilimitado a todas las funciones."
      />
    </>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 28 },
  card: { borderRadius: 20, borderWidth: 1, padding: 24, width: "100%", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "800", textAlign: "center", marginBottom: 10 },
  body: { fontSize: 14, textAlign: "center", lineHeight: 21, marginBottom: 20 },
  btn: { borderRadius: 14, paddingHorizontal: 32, paddingVertical: 14, width: "100%", alignItems: "center" },
});

function AppStack() {
  const { colors, isDark } = useTheme();
  const pathname = usePathname();
  const startTrialIfNeeded = useSubscriptionStore((s) => s.startTrialIfNeeded);

  useEffect(() => {
    const inApp = !HIDE_SIDEBAR_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
    if (inApp) {
      startTrialIfNeeded();
      registerPushToken();
    }
  }, [pathname]);

  const registerPushToken = async () => {
    if (Platform.OS === "web") return;
    try {
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;

      if (existing !== "granted") {
        if (existing === "undetermined") {
          // Show rationale before triggering the system dialog
          await new Promise<void>((resolve) => {
            Alert.alert(
              "Mantente informado",
              "Activa las notificaciones para recibir alertas de tus posiciones, oportunidades de mercado y mensajes de tu mentor.",
              [
                { text: "Ahora no", style: "cancel", onPress: () => resolve() },
                {
                  text: "Activar",
                  onPress: async () => {
                    const { status } = await Notifications.requestPermissionsAsync();
                    finalStatus = status;
                    resolve();
                  },
                },
              ]
            );
          });
        } else {
          return; // already denied — don't ask again
        }
      }

      if (finalStatus !== "granted") return;
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: "11c4956f-5fff-4fb2-9128-210b504a43b5",
      });
      const { default: api } = await import("../src/lib/api");
      await api.post("/api/sync/push-token", { token: tokenData.data });
    } catch {}
  };

  const showSidebar = !HIDE_SIDEBAR_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  const stackScreens = (
    <Stack
      initialRouteName="index"
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
        headerShown: Platform.OS !== "web",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="stock/[ticker]" options={{ headerShown: false }} />
      <Stack.Screen
        name="profile/edit"
        options={{
          headerTitle: "Editar perfil",
          headerShown: true,
          presentation: "modal",
        }}
      />
    </Stack>
  );

  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1, flexDirection: showSidebar ? "row" : "column", backgroundColor: colors.bg }}>
        <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.bg} />
        {showSidebar && <Sidebar />}
        <View style={{ flex: 1, overflow: "hidden" }}>
          {stackScreens}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.bg} />
      {stackScreens}
      {showSidebar && <Sidebar />}
      <TrialExpiredModal />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      // @ts-ignore
      Text.defaultProps = Text.defaultProps ?? {};
      // @ts-ignore
      Text.defaultProps.style = [{ fontFamily: "DMSans_400Regular" }];
    }
  }, [fontsLoaded]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AppStack />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
