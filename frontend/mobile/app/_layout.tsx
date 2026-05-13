import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Platform } from "react-native";
import { ThemeProvider, useTheme } from "../src/lib/ThemeContext";
import Sidebar from "../src/components/Sidebar";

function AppStack() {
  const { colors, isDark } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: Platform.OS === "web" ? "#0a0a0a" : colors.bg }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.bg} />
      {/* On web: center a phone-width column */}
      <View
        style={
          Platform.OS === "web"
            ? {
                flex: 1,
                maxWidth: 430,
                width: "100%",
                alignSelf: "center",
                overflow: "hidden",
                shadowColor: "#000",
                shadowOpacity: 0.4,
                shadowRadius: 32,
                shadowOffset: { width: 0, height: 0 },
              }
            : { flex: 1 }
        }
      >
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="profile/edit"
            options={{ headerTitle: "Editar perfil", presentation: "modal" }}
          />
        </Stack>
        <Sidebar />
      </View>
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
