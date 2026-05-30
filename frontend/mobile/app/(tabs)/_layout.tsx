import React from "react";
import { Tabs } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Pressable, Image,
} from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import MarketTicker from "../../src/components/MarketTicker";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const TAB_CONFIG: Record<string, { icon: IoniconName; iconFilled: IoniconName; label: string }> = {
  chat:      { icon: "chatbubble-ellipses-outline", iconFilled: "chatbubble-ellipses", label: "Chat" },
  portfolio: { icon: "bar-chart-outline",           iconFilled: "bar-chart",           label: "Portafolio" },
  arena:     { icon: "trophy-outline",              iconFilled: "trophy",              label: "Arena" },
  learn:     { icon: "school-outline",              iconFilled: "school",              label: "Aprender" },
  paper:     { icon: "game-controller-outline",     iconFilled: "game-controller",     label: "Virtual" },
};

const HIDDEN_TABS = ["profile", "notifications"];

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

function CustomTabBar({ state, descriptors: _d, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const visibleRoutes = state.routes.filter((r) => !HIDDEN_TABS.includes(r.name));

  return (
    <View style={[
      tabStyles.bar,
      {
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        paddingBottom: Math.max(insets.bottom, 8),
      },
    ]}>
      {visibleRoutes.map((route) => {
        const realIndex = state.routes.findIndex((r) => r.key === route.key);
        const focused = state.index === realIndex;
        const cfg = TAB_CONFIG[route.name];
        if (!cfg) return null;

        return (
          <Pressable
            key={route.key}
            style={tabStyles.tab}
            onPress={() => { if (!focused) navigation.navigate(route.name); }}
            android_ripple={{ color: colors.accentGlow, borderless: true, radius: 28 }}
          >
            {/* Top glow line */}
            <View style={[
              tabStyles.topLine,
              focused && {
                backgroundColor: colors.accentLight,
                shadowColor: colors.accentLight,
                shadowOpacity: 0.8,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 0 },
              },
            ]} />

            {/* Icon container */}
            <View style={[
              tabStyles.iconBox,
              focused && { backgroundColor: colors.accentGlow },
            ]}>
              <Ionicons
                name={focused ? cfg.iconFilled : cfg.icon}
                size={21}
                color={focused ? colors.accentLight : colors.textDim}
              />
            </View>

            {/* Label */}
            <Text style={[
              tabStyles.label,
              { color: focused ? colors.accentLight : colors.textDim },
              focused && tabStyles.labelActive,
            ]}>
              {cfg.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  topLine: {
    width: 28, height: 2, borderRadius: 1,
    backgroundColor: "transparent",
    marginBottom: 4,
  },
  iconBox: {
    width: 40, height: 32, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  label: {
    fontSize: 10, fontWeight: "500", letterSpacing: 0.1,
  },
  labelActive: {
    fontWeight: "700",
  },
});

// ─── Mobile Header ────────────────────────────────────────────────────────────

function MobileHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const openSidebar = useAppStore((s) => s.openSidebar);
  const profile = useAppStore((s) => s.profile);
  const riskColor = profile?.risk_tolerance === "conservative"
    ? "#3b82f6"
    : profile?.risk_tolerance === "aggressive"
    ? "#f59e0b"
    : "#00d47e";
  const insets = useSafeAreaInsets();

  return (
    <View style={[
      headerStyles.wrapper,
      { backgroundColor: colors.bg, paddingTop: insets.top, borderBottomColor: colors.border },
    ]}>
      <View style={headerStyles.row}>
        {/* Custom hamburger */}
        <TouchableOpacity onPress={openSidebar} style={headerStyles.menuBtn} activeOpacity={0.7}>
          <View style={[headerStyles.menuLine, { backgroundColor: colors.textSub }]} />
          <View style={[headerStyles.menuLine, headerStyles.menuLineShort, { backgroundColor: colors.accentLight }]} />
        </TouchableOpacity>

        {/* Title */}
        <Text style={[headerStyles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>

        {/* Notification bell */}
        <TouchableOpacity
          style={headerStyles.bellBtn}
          onPress={() => router.navigate("/(tabs)/notifications")}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.textSub} />
        </TouchableOpacity>

        {/* Avatar / Profile */}
        {profile ? (
          <TouchableOpacity
            style={[headerStyles.avatar, { backgroundColor: riskColor + "22", borderColor: riskColor + "66" }]}
            activeOpacity={0.8}
            onPress={() => router.navigate("/(tabs)/profile")}
          >
            {profile.avatarUri ? (
              <Image source={{ uri: profile.avatarUri }} style={headerStyles.avatarImg} />
            ) : (
              <Text style={[headerStyles.avatarText, { color: riskColor }]}>
                {profile.name.charAt(0).toUpperCase()}
              </Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>
      <MarketTicker />
    </View>
  );
}

const headerStyles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    height: 52, paddingHorizontal: 14, gap: 4,
  },
  menuBtn: {
    width: 36, height: 36, justifyContent: "center", gap: 6,
  },
  menuLine: {
    height: 2, borderRadius: 1, width: 22,
  },
  menuLineShort: {
    width: 14,
  },
  title: {
    flex: 1, textAlign: "center",
    fontSize: 16, fontWeight: "700", letterSpacing: -0.3,
  },
  bellBtn: { padding: 6 },
  avatar: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontWeight: "800" },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
});

// ─── Root Tab Layout ──────────────────────────────────────────────────────────

export default function TabsLayout() {
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      tabBar={isWeb ? undefined : (props) => <CustomTabBar {...props} />}
      screenOptions={{
        tabBarStyle: isWeb ? { display: "none" } : undefined,
        headerShown: !isWeb,
      }}
    >
      <Tabs.Screen
        name="chat"
        options={{
          tabBarIcon: ({ color }) => <Ionicons name="chatbubble-ellipses-outline" size={22} color={color} />,
          title: "Chat",
          header: () => <MobileHeader title="Nuvos AI" />,
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
      <Tabs.Screen name="profile" options={{ href: null, header: () => <MobileHeader title="Mi Perfil" /> }} />
      <Tabs.Screen
        name="arena"
        options={{
          title: "Arena",
          header: () => <MobileHeader title="🏆 Arena" />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: "Aprender",
          header: () => <MobileHeader title="Aprendizaje" />,
        }}
      />
      <Tabs.Screen
        name="paper"
        options={{
          title: "Virtual",
          header: () => <MobileHeader title="Paper Trading" />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
          title: "Notificaciones",
          header: () => <MobileHeader title="Notificaciones" />,
        }}
      />
    </Tabs>
  );
}
