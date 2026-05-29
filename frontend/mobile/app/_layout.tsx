import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Platform } from "react-native";
import { useEffect } from "react";
import { ThemeProvider, useTheme } from "../src/lib/ThemeContext";
import Sidebar from "../src/components/Sidebar";
import { useSubscriptionStore } from "../src/lib/subscriptionStore";

const HIDE_SIDEBAR_ROUTES = ["/", "/onboarding"];

function AppStack() {
  const { colors, isDark } = useTheme();
  const pathname = usePathname();
  const startTrialIfNeeded = useSubscriptionStore((s) => s.startTrialIfNeeded);

  useEffect(() => {
    if (!HIDE_SIDEBAR_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
      startTrialIfNeeded();
    }
  }, [pathname]);
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
        // Hide header on web — sidebar provides navigation context
        headerShown: Platform.OS !== "web",
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
    // Desktop: full-width row — sidebar on left, content on right
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

  // Mobile: stack with absolute sliding sidebar on top
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.bg} />
      {stackScreens}
      {showSidebar && <Sidebar />}
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppStack />
    </ThemeProvider>
  );
}
