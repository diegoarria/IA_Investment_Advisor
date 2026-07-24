import React, { useEffect, useRef } from "react";
import { Tabs } from "expo-router";
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, Pressable, Image, AppState,
} from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useTheme } from "../../src/lib/ThemeContext";
import { useAppStore } from "../../src/lib/profileStore";
import { useNavOrderStore } from "../../src/lib/navOrderStore";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import { useWatchlistStore } from "../../src/lib/watchlistStore";
import MarketTicker from "../../src/components/MarketTicker";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

function getTabConfig(t: TFunction): Record<string, { icon: IoniconName; iconFilled: IoniconName; label: string }> {
  return {
    // ── 4 main tabs ──
    home:          { icon: "home-outline",            iconFilled: "home",            label: t("tabsLayout.tabs.home") },
    chat:          { icon: "sparkles-outline",        iconFilled: "sparkles",        label: t("tabsLayout.tabs.chat") },
    patrimonio:    { icon: "wallet-outline",          iconFilled: "wallet",          label: t("tabsLayout.tabs.patrimonio") },
    academy:       { icon: "school-outline",          iconFilled: "school",          label: t("tabsLayout.tabs.academy") },
    // ── Secondary screens (accessible from hub screens) ──
    portfolio:     { icon: "pie-chart-outline",       iconFilled: "pie-chart",       label: t("tabsLayout.tabs.portfolio") },
    watchlist:     { icon: "pulse-outline",           iconFilled: "pulse",           label: t("tabsLayout.tabs.watchlist") },
    paper:         { icon: "bar-chart-outline",       iconFilled: "bar-chart",       label: t("tabsLayout.tabs.paper") },
    learn:         { icon: "book-outline",            iconFilled: "book",            label: t("tabsLayout.tabs.learn") },
    videos:        { icon: "play-outline",            iconFilled: "play",            label: t("tabsLayout.tabs.videos") },
    investors:     { icon: "people-outline",          iconFilled: "people",          label: t("tabsLayout.tabs.investors") },
    notifications: { icon: "notifications-outline",   iconFilled: "notifications",   label: t("tabsLayout.tabs.notifications") },
    support:       { icon: "headset-outline",         iconFilled: "headset",         label: t("tabsLayout.tabs.support") },
    profile:       { icon: "person-outline",          iconFilled: "person",          label: t("tabsLayout.tabs.profile") },
    products:      { icon: "bag-outline",             iconFilled: "bag",             label: t("tabsLayout.tabs.products") },
  };
}

const FIXED_TABS = ["home", "chat", "patrimonio", "academy"] as const;

function getGoalMap(t: TFunction): Record<string, { label: string; emoji: string }> {
  return {
    house:             { label: t("profileEdit.goals.house"),             emoji: "🏠" },
    car:               { label: t("profileEdit.goals.car"),               emoji: "🚗" },
    passive_income:    { label: t("profileEdit.goals.passive_income"),    emoji: "💸" },
    retirement:        { label: t("profileEdit.goals.retirement"),        emoji: "👴" },
    financial_freedom: { label: t("profileEdit.goals.financial_freedom"), emoji: "🦅" },
    long_term_wealth:  { label: t("profileEdit.goals.long_term_wealth"),  emoji: "🏛️" },
  };
}

// ─── Custom Tab Bar ───────────────────────────────────────────────────────────

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const TAB_CONFIG = getTabConfig(t);
  const insets = useSafeAreaInsets();

  const visibleRoutes = FIXED_TABS
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

        return (
          <Pressable
            key={route.key}
            style={tabStyles.tab}
            onPress={() => {
              if (focused) {
                navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              } else {
                navigation.navigate(route.name);
              }
            }}
            android_ripple={{ color: colors.accentGlow, borderless: true, radius: 28 }}
          >
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
            <View style={[tabStyles.iconBox, focused && { backgroundColor: colors.accentGlow }]}>
              <Ionicons
                name={focused ? cfg.iconFilled : cfg.icon}
                size={21}
                color={focused ? colors.accentLight : colors.textDim}
              />
            </View>
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
    fontSize: 10, fontFamily: "DMSans_500Medium", letterSpacing: 0.1,
  },
  labelActive: {
    fontFamily: "DMSans_700Bold",
  },
});

// ─── Mobile Header ────────────────────────────────────────────────────────────

function MobileHeader({ title }: { title: string }) {
  const { colors, isDark, toggle } = useTheme();
  const { t } = useTranslation();
  const GOAL_MAP = getGoalMap(t);
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
      {/* Strip — guest / trial / free / goal */}
      {!profile ? (
        <TouchableOpacity onPress={() => router.navigate("/")} activeOpacity={0.7}
          style={{ height: 24, backgroundColor: "rgba(99,102,241,0.06)", borderBottomWidth: 0.5, borderBottomColor: "rgba(99,102,241,0.2)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text style={{ color: "#818cf8", fontSize: 10, fontWeight: "700" }}>{t("tabsLayout.createAccountLogin")}</Text>
          <Text style={{ color: "#818cf8", fontSize: 10 }}>→</Text>
        </TouchableOpacity>
      ) : isPremium && isTrialPremium ? (
        <View style={{ height: 24, backgroundColor: "rgba(0,212,126,0.08)", borderBottomWidth: 0.5, borderBottomColor: "rgba(0,212,126,0.25)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "700" }}>✦ {t("tabsLayout.premiumFree")}</Text>
          <Text style={{ color: "#00d47e", fontSize: 10 }}>·</Text>
          <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "600" }}>{t("tabsLayout.daysLeft", { days: trialDaysLeft })}</Text>
        </View>
      ) : !isPremium ? (
        <View style={{ height: 24, backgroundColor: "rgba(245,158,11,0.06)", borderBottomWidth: 0.5, borderBottomColor: "rgba(245,158,11,0.2)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
          <Text style={{ color: "#f59e0b", fontSize: 10, fontWeight: "700" }}>{t("tabsLayout.activatePremium")}</Text>
          <Text style={{ color: "#f59e0b", fontSize: 10 }}>→</Text>
        </View>
      ) : profile.investment_goal ? (
        /* Premium non-trial: show the user's permanent financial goal */
        <View style={{ height: 26, backgroundColor: "rgba(0,212,126,0.06)", borderBottomWidth: 0.5, borderBottomColor: "rgba(0,212,126,0.18)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <Text style={{ fontSize: 12 }}>{GOAL_MAP[profile.investment_goal]?.emoji ?? "🎯"}</Text>
          <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "700" }}>
            {GOAL_MAP[profile.investment_goal]?.label ?? t("tabsLayout.myGoal")}
          </Text>
          {!!profile.investment_goal_amount && (
            <Text style={{ color: "#00d47e", fontSize: 10, fontWeight: "600" }}>
              · ${Number(profile.investment_goal_amount).toLocaleString("en-US")} USD
            </Text>
          )}
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

        {/* Notification bell + theme toggle — kept tight together */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <TouchableOpacity
            style={headerStyles.bellBtn}
            onPress={() => router.navigate("/(tabs)/notifications")}
            activeOpacity={0.7}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.textSub} />
          </TouchableOpacity>

          <TouchableOpacity style={headerStyles.bellBtn} onPress={toggle} activeOpacity={0.7}>
            <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={colors.textSub} />
          </TouchableOpacity>
        </View>

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
            <Text style={{ fontSize: 11, fontWeight: "700", color: "#818cf8" }}>{t("tabsLayout.login")}</Text>
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
  bellBtn: { paddingVertical: 6, paddingHorizontal: 3 },
  avatar: {
    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { fontSize: 14, fontFamily: "DMSans_800ExtraBold" },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
});

// ─── Root Tab Layout ──────────────────────────────────────────────────────────

export default function TabsLayout() {
  const { t } = useTranslation();
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

    // Portfolio has its own store method for this: it fetches every portfolio by
    // its real id (not just "default", which /sync/all always returns regardless
    // of which portfolio is actually active on this device), and skips the pull
    // entirely while a local edit is still pending so it can never overwrite a
    // more recent local change with a stale server snapshot.
    import("../../src/lib/portfolioStore").then(({ usePortfolioStore }) => {
      usePortfolioStore.getState().loadFromServer();
    }).catch(() => {});

    // Refresh paper trading and maturity from server
    import("../../src/lib/api").then(({ syncApi }) => {
      syncApi.getAll().then((res) => {
        const data = res.data;
        if (!data) return;

        // Paper trading
        if (data.paper) {
          import("../../src/lib/paperStore").then(({ usePaperStore }) => {
            usePaperStore.getState().restoreFromServer?.(data.paper);
          }).catch(() => {});
        }

        // Streak + completed topics
        import("../../src/lib/learnStore").then(({ useLearnStore }) => {
          const store = useLearnStore.getState();
          if (data.streak?.count > 0 && data.streak.count >= store.streak) {
            store.setStreakFromServer?.(data.streak.count, data.streak.last_learn_date);
          }
          if (Array.isArray(data.completed_topic_ids) && data.completed_topic_ids.length > 0) {
            store.setCompletedTopicIds(data.completed_topic_ids);
          }
        }).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});
  };

  useEffect(() => {
    syncAllFromServer();

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
      initialRouteName="home"
      tabBar={isWeb ? undefined : (props) => <CustomTabBar {...props} />}
      screenOptions={{
        tabBarStyle: isWeb ? { display: "none" } : undefined,
        headerShown: !isWeb,
      }}
    >
      {/* ── 4 primary hub tabs ────────────────────────────────────────── */}
      <Tabs.Screen name="home"       options={{ headerShown: false }} />
      <Tabs.Screen name="chat"       options={{ title: t("tabsLayout.tabs.chat"),      header: () => <MobileHeader title={t("tabsLayout.tabs.chat")} /> }} />
      <Tabs.Screen name="patrimonio" options={{ headerShown: false }} />
      <Tabs.Screen name="academy"    options={{ headerShown: false }} />
      {/* ── Secondary screens (accessible from hub pages) ─────────────── */}
      <Tabs.Screen name="portfolio"     options={{ title: t("tabsLayout.tabs.portfolio"),    header: () => <MobileHeader title={t("tabsLayout.myPortfolio")} /> }} />
      <Tabs.Screen name="watchlist"     options={{ title: t("tabsLayout.tabs.watchlist"),     header: () => <MobileHeader title={t("tabsLayout.tabs.watchlist")} /> }} />
      <Tabs.Screen name="paper"         options={{ href: null, title: t("tabsLayout.simulator"), header: () => <MobileHeader title={t("tabsLayout.simulator")} /> }} />
      <Tabs.Screen name="learn"         options={{ title: t("tabsLayout.tabs.learn"),   header: () => <MobileHeader title={t("tabsLayout.tabs.learn")} /> }} />
      <Tabs.Screen name="videos"        options={{ title: t("tabsLayout.tabs.videos"),        header: () => <MobileHeader title={t("tabsLayout.tabs.videos")} /> }} />
      <Tabs.Screen name="investors"     options={{ title: t("tabsLayout.tabs.investors"),    header: () => <MobileHeader title={t("tabsLayout.tabs.investors")} /> }} />
      <Tabs.Screen name="notifications" options={{ title: t("tabsLayout.tabs.notifications"), header: () => <MobileHeader title={t("tabsLayout.tabs.notifications")} /> }} />
      <Tabs.Screen name="profile"       options={{ title: t("tabsLayout.tabs.profile"),        header: () => <MobileHeader title={t("tabsLayout.myProfile")} /> }} />
      <Tabs.Screen name="products"      options={{ title: t("tabsLayout.tabs.products"),     header: () => <MobileHeader title={t("tabsLayout.productsAndServices")} /> }} />
      <Tabs.Screen name="support"       options={{ title: t("tabsLayout.tabs.support"),       header: () => <MobileHeader title={t("tabsLayout.tabs.support")} /> }} />
      <Tabs.Screen name="explore"       options={{ href: null }} />
    </Tabs>
  );
}
