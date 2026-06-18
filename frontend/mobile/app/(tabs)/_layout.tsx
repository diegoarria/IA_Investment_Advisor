import React, { useEffect, useRef } from "react";
import { Tabs } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Pressable, Image, AppState,
} from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useNavOrderStore, getTop5TabPaths, pathToRoute, ALL_NAV_ITEMS } from "../../src/lib/navOrderStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { getUserLevel, isAtLeast } from "../../src/lib/userLevel";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import MarketTicker from "../../src/components/MarketTicker";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// Icons mirror the web app's Lucide icons: BookOpen, PieChart, Eye, Users,
// Play, Bookmark, BarChart2, GraduationCap, Bell, Headphones, User
const TAB_CONFIG: Record<string, { icon: IoniconName; iconFilled: IoniconName; label: string }> = {
  chat:          { icon: "reader-outline",         iconFilled: "reader",        label: "Chat" },
  portfolio:     { icon: "pie-chart-outline",     iconFilled: "pie-chart",     label: "Portafolio" },
  watchlist:     { icon: "eye-outline",           iconFilled: "eye",           label: "Watchlist" },
  investors:     { icon: "people-outline",        iconFilled: "people",        label: "Inversores" },
  videos:        { icon: "play-outline",          iconFilled: "play",          label: "Videos" },
  learn:         { icon: "school-outline",        iconFilled: "school",        label: "Aprendizaje" },
  paper:         { icon: "bar-chart-outline",     iconFilled: "bar-chart",     label: "Simulador" },
  notifications: { icon: "notifications-outline", iconFilled: "notifications", label: "Notificaciones" },
  support:       { icon: "headset-outline",       iconFilled: "headset",       label: "Soporte" },
  profile:       { icon: "person-outline",        iconFilled: "person",        label: "Perfil" },
};

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

function CustomTabBar({ state, descriptors: _d, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navOrder = useNavOrderStore((s) => s.order);
  const profile = useAppStore((s) => s.profile);
  const userLevel = getUserLevel(profile);

  const top5RouteNames = getTop5TabPaths(navOrder).map(pathToRoute);
  const visibleRoutes = top5RouteNames
    .map((name) => state.routes.find((r) => r.name === name))
    .filter(Boolean) as typeof state.routes;

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

        const navItem = ALL_NAV_ITEMS.find((i) => i.path === `/${route.name}`);
        const locked = navItem ? !isAtLeast(userLevel, navItem.minLevel) : false;

        return (
          <Pressable
            key={route.key}
            style={[tabStyles.tab, locked && { opacity: 0.45 }]}
            onPress={() => {
              if (locked) { navigation.navigate("profile"); return; }
              if (focused) {
                // Emit tabPress so the active screen can listen and refresh
                navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              } else {
                navigation.navigate(route.name);
              }
            }}
            android_ripple={{ color: colors.accentGlow, borderless: true, radius: 28 }}
          >
            {/* Top glow line */}
            <View style={[
              tabStyles.topLine,
              focused && !locked && {
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
              focused && !locked && { backgroundColor: colors.accentGlow },
            ]}>
              <Ionicons
                name={locked ? "lock-closed-outline" : (focused ? cfg.iconFilled : cfg.icon)}
                size={21}
                color={focused && !locked ? colors.accentLight : colors.textDim}
              />
            </View>

            {/* Label */}
            <Text style={[
              tabStyles.label,
              { color: focused && !locked ? colors.accentLight : colors.textDim },
              focused && !locked && tabStyles.labelActive,
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
    fontSize: 10, fontFamily: "DMSans_500Medium", letterSpacing: 0.1,
  },
  labelActive: {
    fontFamily: "DMSans_700Bold",
  },
});

// ─── Mobile Header ────────────────────────────────────────────────────────────

function MobileHeader({ title }: { title: string }) {
  const { colors, isDark, toggle } = useTheme();
  const openSidebar = useAppStore((s) => s.openSidebar);
  const profile = useAppStore((s) => s.profile);
  const subStore = useSubscriptionStore();
  const isPremium = subStore.tier === "premium";
  const isTrialPremium = subStore.isTrialPremium;
  const trialDaysLeft = subStore.trialDaysLeftServer;
  const riskColor = profile?.risk_tolerance === "conservative"
    ? "#3b82f6"
    : profile?.risk_tolerance === "aggressive"
    ? "#f59e0b"
    : "#00d47e";
  const insets = useSafeAreaInsets();

  return (
    <View style={[
      headerStyles.wrapper,
      { backgroundColor: colors.card, paddingTop: insets.top, borderBottomColor: colors.border },
    ]}>
      {/* Strip — guest / trial / free */}
      {!profile ? (
        <TouchableOpacity onPress={() => router.navigate("/")} activeOpacity={0.7}
          style={{ height: 24, backgroundColor: "rgba(99,102,241,0.06)", borderBottomWidth: 0.5, borderBottomColor: "rgba(99,102,241,0.2)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text style={{ color: "#818cf8", fontSize: 10, fontWeight: "700" }}>Crear cuenta · Iniciar sesión</Text>
          <Text style={{ color: "#818cf8", fontSize: 10 }}>→</Text>
        </TouchableOpacity>
      ) : isPremium && isTrialPremium ? (
        <View style={{ height: 24, backgroundColor: "rgba(0,212,126,0.08)", borderBottomWidth: 0.5, borderBottomColor: "rgba(0,212,126,0.25)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "700" }}>✦ Premium Gratis</Text>
          <Text style={{ color: "#00d47e", fontSize: 10 }}>·</Text>
          <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "600" }}>{trialDaysLeft}d restantes</Text>
        </View>
      ) : !isPremium ? (
        <View style={{ height: 24, backgroundColor: "rgba(245,158,11,0.06)", borderBottomWidth: 0.5, borderBottomColor: "rgba(245,158,11,0.2)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text style={{ color: "#f59e0b", fontSize: 10, fontWeight: "700" }}>Activar Premium</Text>
          <Text style={{ color: "#f59e0b", fontSize: 10 }}>→</Text>
        </View>
      ) : null}

      <View style={[headerStyles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
        {/* Custom hamburger */}
        <TouchableOpacity onPress={openSidebar} style={headerStyles.menuBtn} activeOpacity={0.7}>
          <View style={[headerStyles.menuLine, { backgroundColor: colors.textSub }]} />
          <View style={[headerStyles.menuLine, headerStyles.menuLineShort, { backgroundColor: colors.accentLight }]} />
        </TouchableOpacity>

        {/* Title — absolutely centered so it sits in the true middle of the screen */}
        <View style={headerStyles.titleContainer} pointerEvents="none">
          <Text style={[headerStyles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
        </View>

        {/* Spacer pushes right-side icons to the edge */}
        <View style={{ flex: 1 }} />

        {/* Notification bell */}
        <TouchableOpacity
          style={headerStyles.bellBtn}
          onPress={() => router.navigate("/(tabs)/notifications")}
          activeOpacity={0.7}
        >
          <Ionicons name="notifications-outline" size={22} color={colors.textSub} />
        </TouchableOpacity>

        {/* Theme toggle */}
        <TouchableOpacity style={headerStyles.bellBtn} onPress={toggle} activeOpacity={0.7}>
          <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={colors.textSub} />
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
          <TouchableOpacity
            onPress={() => router.navigate("/")}
            style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: "rgba(99,102,241,0.3)", backgroundColor: "rgba(99,102,241,0.08)" }}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#818cf8" }}>Entrar</Text>
          </TouchableOpacity>
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
  titleContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  title: {
    fontSize: 16, fontFamily: "DMSans_700Bold", letterSpacing: -0.3,
    textAlign: "center",
  },
  bellBtn: { padding: 6 },
  avatar: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontFamily: "DMSans_800ExtraBold" },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
});

// ─── Root Tab Layout ──────────────────────────────────────────────────────────

export default function TabsLayout() {
  const isWeb = Platform.OS === "web";
  const loadOrder = useNavOrderStore((s) => s.loadOrder);
  const loadWatchlist = useWatchlistStore((s) => s.loadFromServer);
  const appState = useRef(AppState.currentState);
  const lastForegroundSync = useRef<number>(0);

  const syncAllFromServer = () => {
    const now = Date.now();
    // Throttle: don't re-sync more than once every 30 seconds
    if (now - lastForegroundSync.current < 30_000) return;
    lastForegroundSync.current = now;

    loadOrder();
    loadWatchlist();

    // Refresh portfolio, paper trading, and maturity from server
    import("../../src/lib/api").then(({ syncApi }) => {
      syncApi.getAll().then((res) => {
        const data = res.data;
        if (!data) return;

        // Portfolio
        if (data.portfolio?.positions) {
          import("../../src/lib/portfolioStore").then(({ usePortfolioStore }) => {
            usePortfolioStore.getState().restoreFromServer(data.portfolio.positions, data.portfolio.currency);
          }).catch(() => {});
        }

        // Paper trading
        if (data.paper) {
          import("../../src/lib/paperStore").then(({ usePaperStore }) => {
            usePaperStore.getState().restoreFromServer?.(data.paper);
          }).catch(() => {});
        }

        // Streak
        if (data.streak && data.streak.count > 0) {
          import("../../src/lib/learnStore").then(({ useLearnStore }) => {
            const store = useLearnStore.getState();
            if (data.streak.count >= store.streak) {
              store.setStreakFromServer?.(data.streak.count, data.streak.last_learn_date);
            }
          }).catch(() => {});
        }
      }).catch(() => {});
    }).catch(() => {});
  };

  useEffect(() => {
    syncAllFromServer();

    // Sync all data from server whenever app comes back to foreground
    // so changes made on web/another device are reflected immediately.
    const sub = AppState.addEventListener("change", (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === "active") {
        syncAllFromServer();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, []);

  return (
    <Tabs
      tabBar={isWeb ? undefined : (props) => <CustomTabBar {...props} />}
      screenOptions={{
        tabBarStyle: isWeb ? { display: "none" } : undefined,
        headerShown: !isWeb,
      }}
    >
      <Tabs.Screen name="chat"      options={{ title: "Chat",          header: () => <MobileHeader title="Nuvos AI" /> }} />
      <Tabs.Screen name="portfolio" options={{ title: "Portafolios",   header: () => <MobileHeader title="Mi Portafolio" /> }} />
      <Tabs.Screen name="watchlist" options={{ title: "Watchlist",     header: () => <MobileHeader title="Watchlist" /> }} />
      <Tabs.Screen name="learn"     options={{ title: "Aprender",      header: () => <MobileHeader title="Aprendizaje" /> }} />
      <Tabs.Screen name="paper"     options={{ title: "Simulador",     header: () => <MobileHeader title="Simulador" /> }} />
      <Tabs.Screen name="profile"   options={{ title: "Perfil",        header: () => <MobileHeader title="Mi Perfil" /> }} />
      <Tabs.Screen name="notifications" options={{ title: "Notificaciones", header: () => <MobileHeader title="Notificaciones" /> }} />
      <Tabs.Screen name="videos"    options={{ title: "Videos",   header: () => <MobileHeader title="Videos" /> }} />
      <Tabs.Screen name="investors"  options={{ title: "Inversores", header: () => <MobileHeader title="Inversores" /> }} />
      <Tabs.Screen name="explore"   options={{ href: null }} />
      <Tabs.Screen name="support"   options={{ title: "Soporte",  header: () => <MobileHeader title="Soporte" /> }} />
    </Tabs>
  );
}
