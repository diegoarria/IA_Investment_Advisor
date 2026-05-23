import React from "react";
import { Tabs } from "expo-router";
import { TouchableOpacity, View, Text, Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import MarketTicker from "../../src/components/MarketTicker";

const isWeb = Platform.OS === "web";

// Custom mobile header: hamburger + title + market ticker strip
function MobileHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const openSidebar = useAppStore((s) => s.openSidebar);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border, paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={openSidebar} style={styles.hamburger}>
          <Ionicons name="menu-outline" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{title}</Text>
        <View style={{ width: 42 }} />
      </View>
      <MarketTicker />
    </View>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarStyle: isWeb
          ? { display: "none" }
          : { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accentLight,
        tabBarInactiveTintColor: colors.textDim,
        headerShown: !isWeb,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses-outline" size={22} color={color} />,
          title: "Chat",
          header: () => <MobileHeader title="IA Investment Advisor" />,
        }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="bar-chart-outline" size={22} color={color} />,
          title: "Portafolios",
          header: () => <MobileHeader title="Mi Portafolio" />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="person-circle-outline" size={22} color={color} />,
          title: "Perfil",
          header: () => <MobileHeader title="Mi Perfil" />,
        }}
      />
      <Tabs.Screen
        name="paper"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="game-controller-outline" size={22} color={color} />,
          title: "Virtual",
          header: () => <MobileHeader title="Paper Trading" />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="notifications-outline" size={22} color={color} />,
          title: "Alertas",
          header: () => <MobileHeader title="Notificaciones" />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="school-outline" size={22} color={color} />,
          title: "Aprender",
          header: () => <MobileHeader title="Aprendizaje" />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  header: {
    borderBottomWidth: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    paddingHorizontal: 4,
  },
  hamburger: {
    width: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
  },
});
