import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: { backgroundColor: "#1a1d27", borderTopColor: "#2a2d3a" },
        tabBarActiveTintColor: "#22c55e",
        tabBarInactiveTintColor: "#6b7280",
        headerStyle: { backgroundColor: "#1a1d27" },
        headerTintColor: "white",
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
    </Tabs>
  );
}
