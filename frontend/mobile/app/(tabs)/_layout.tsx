import { Tabs } from "expo-router";
import { Text, TouchableOpacity } from "react-native";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";

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
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accentLight,
        tabBarInactiveTintColor: colors.textDim,
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
          headerTitle: "Simulador de Portafolios",
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
