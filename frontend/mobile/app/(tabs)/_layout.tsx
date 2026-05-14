import { Tabs } from "expo-router";
import { TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";

const isWeb = Platform.OS === "web";

export default function TabsLayout() {
  const { colors } = useTheme();
  const openSidebar = useAppStore((s) => s.openSidebar);

  const hamburger = () => (
    <TouchableOpacity onPress={openSidebar} style={{ marginLeft: 16 }}>
      <Ionicons name="menu-outline" size={26} color={colors.text} />
    </TouchableOpacity>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: isWeb
          ? { display: "none" }
          : { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accentLight,
        tabBarInactiveTintColor: colors.textDim,
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
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses-outline" size={22} color={color} />,
          headerTitle: "IA Investment Advisor",
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          title: "Portafolios",
          tabBarIcon: ({ color }) => <Ionicons name="bar-chart-outline" size={22} color={color} />,
          headerTitle: "Mi Portafolio",
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "Alertas",
          tabBarIcon: ({ color }) => <Ionicons name="notifications-outline" size={22} color={color} />,
          headerTitle: "Notificaciones",
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Aprender",
          tabBarIcon: ({ color }) => <Ionicons name="school-outline" size={22} color={color} />,
          headerTitle: "Aprendizaje",
        }}
      />
    </Tabs>
  );
}
