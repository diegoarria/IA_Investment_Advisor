import { Tabs } from "expo-router";
import { Text, TouchableOpacity, Platform } from "react-native";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";

const isWeb = Platform.OS === "web";

export default function TabsLayout() {
  const { colors } = useTheme();
  const openSidebar = useAppStore((s) => s.openSidebar);

  const hamburger = () => (
    <TouchableOpacity onPress={openSidebar} style={{ marginLeft: 16 }}>
      <Text style={{ fontSize: 22, color: colors.text }}>☰</Text>
    </TouchableOpacity>
  );

  return (
    <Tabs
      screenOptions={{
        // Web: no tab bar — sidebar handles navigation
        tabBarStyle: isWeb
          ? { display: "none" }
          : { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accentLight,
        tabBarInactiveTintColor: colors.textDim,
        // Web: no header — sidebar provides context; Mobile: show header with hamburger
        headerShown: !isWeb,
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        headerLeft: hamburger,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💬</Text>,
          headerTitle: "IA Investment Advisor",
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portafolios",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>📊</Text>,
          headerTitle: "Mi Portafolio",
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alertas",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🔔</Text>,
          headerTitle: "Notificaciones",
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Aprender",
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>🎓</Text>,
          headerTitle: "Aprendizaje",
        }}
      />
    </Tabs>
  );
}
