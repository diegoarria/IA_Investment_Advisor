import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { ThemeProvider, useTheme } from "../src/lib/ThemeContext";
import Sidebar from "../src/components/Sidebar";

function AppStack() {
  const { colors, isDark } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={isDark ? "light" : "dark"} backgroundColor={colors.bg} />
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
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AppStack />
    </ThemeProvider>
  );
}
