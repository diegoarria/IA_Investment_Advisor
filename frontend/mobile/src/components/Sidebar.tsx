import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, Animated, Dimensions,
  StyleSheet, Pressable, Platform, ScrollView, Image, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, getAge } from "../lib/profileStore";
import { usePortfolioStore } from "../lib/portfolioStore";
import { useChatStore } from "../lib/chatStore";
import { useTheme } from "../lib/ThemeContext";
import MarketTicker from "./MarketTicker";
import { ALL_NAV_ITEMS, useNavOrderStore, getTop5TabPaths } from "../lib/navOrderStore";
import { getUserLevel, useUserLevel, isAtLeast, LEVEL_LABEL, LEVEL_COLOR } from "../lib/userLevel";

const SIDEBAR_WIDTH = Math.min(Dimensions.get("window").width * 0.78, 300);
const WEB_EXPANDED = 260;
const WEB_COLLAPSED = 62;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Risk segments (same 8 levels as web) ────────────────────────────────────

const RISK_SEGMENTS = [
  { key: "conservative",           color: "#00d47e", pct: 8  },
  { key: "conservative_moderate",  color: "#3ecf8e", pct: 18 },
  { key: "moderate",               color: "#8bd44e", pct: 30 },
  { key: "moderate_growth",        color: "#c5d43c", pct: 42 },
  { key: "growth",                 color: "#f5c842", pct: 55 },
  { key: "aggressive",             color: "#f5973a", pct: 68 },
  { key: "aggressive_speculative", color: "#f5613a", pct: 82 },
  { key: "speculative",            color: "#ff2d3b", pct: 100 },
];

const RISK_LABEL: Record<string, string> = {
  conservative: "Conservador",
  conservative_moderate: "Cons-Moderado",
  moderate: "Moderado",
  moderate_growth: "Mod-Growth",
  growth: "Growth",
  aggressive: "Agresivo",
  aggressive_speculative: "Agr-Especulativo",
  speculative: "Especulativo",
};

// ─── Profile card ─────────────────────────────────────────────────────────────

function ProfileCard({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  const { profile } = useAppStore();
  if (!profile) return null;

  const seg = RISK_SEGMENTS.find((s) => s.key === profile.risk_tolerance);
  const level = getUserLevel(profile);
  const levelColor = LEVEL_COLOR[level];
  const isPremium = (profile as any).subscription_tier === "premium";

  return (
    <View style={[styles.profileCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      {/* Avatar + name + level badges */}
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          {profile.avatarUri ? (
            <Image source={{ uri: profile.avatarUri }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarText}>{profile.name.charAt(0).toUpperCase()}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {profile.name}
          </Text>
          <View style={styles.profileBadgesRow}>
            <View style={[styles.levelBadge, { borderColor: levelColor + "55", backgroundColor: levelColor + "18" }]}>
              <Text style={[styles.levelBadgeText, { color: levelColor }]}>{LEVEL_LABEL[level]}</Text>
            </View>
            <View style={[styles.subBadge, { borderColor: colors.border }]}>
              <Text style={[styles.subBadgeText, { color: isPremium ? "#00d47e" : colors.textDim }]}>
                {isPremium ? "Premium" : "Free"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Stats grid: Edad · Ingresos · Inversión */}
      <View style={styles.statsGrid}>
        {[
          { label: "Edad",      value: String(getAge(profile.birth_date ?? "")), sub: "años" },
          { label: "Ingresos",  value: `$${Number(profile.monthly_income ?? 0).toLocaleString()}`, sub: "/mes" },
          { label: "Inversión", value: `$${Number(profile.monthly_contribution).toLocaleString()}`, sub: "/mes" },
        ].map(({ label, value, sub }) => (
          <View key={label} style={[styles.statBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.statLabel, { color: colors.textDim }]}>{label}</Text>
            <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
            <Text style={[styles.statSub, { color: colors.textMuted }]}>{sub}</Text>
          </View>
        ))}
      </View>

      {/* Risk bar */}
      {seg && (
        <View>
          <View style={styles.riskRow}>
            <Text style={[styles.riskLabel, { color: seg.color }]}>
              {RISK_LABEL[profile.risk_tolerance] ?? profile.risk_tolerance}
            </Text>
            <Text style={[styles.riskPct, { color: seg.color }]}>{seg.pct}%</Text>
          </View>
          <View style={[styles.riskBarTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.riskBarFill, { width: `${seg.pct}%` as any, backgroundColor: seg.color }]} />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Goal card ────────────────────────────────────────────────────────────────

const GOAL_MAP: Record<string, { label: string; emoji: string }> = {
  house:             { label: "Comprar una casa",         emoji: "🏠" },
  car:               { label: "Comprar un carro",         emoji: "🚗" },
  passive_income:    { label: "Vivir de mis inversiones", emoji: "💸" },
  retirement:        { label: "Retiro / pensión",         emoji: "👴" },
  financial_freedom: { label: "Libertad financiera",      emoji: "🦅" },
  long_term_wealth:  { label: "Patrimonio a largo plazo", emoji: "🏛️" },
};

function GoalCard({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  const { profile } = useAppStore();
  if (!profile?.investment_goal) return null;
  const goal = GOAL_MAP[profile.investment_goal] ?? { label: profile.investment_goal, emoji: "🎯" };
  const amount = profile.investment_goal_amount ? Number(profile.investment_goal_amount) : null;
  return (
    <View style={[goalStyles.card, { borderColor: "rgba(0,212,126,0.25)", backgroundColor: "rgba(0,212,126,0.07)" }]}>
      <Text style={goalStyles.emoji}>{goal.emoji}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[goalStyles.label, { color: "rgba(0,212,126,0.6)" }]}>MI META</Text>
        <Text style={[goalStyles.name, { color: "#00d47e" }]} numberOfLines={1}>{goal.label}</Text>
        {amount ? (
          <Text style={[goalStyles.amount, { color: colors.text }]}>
            ${amount.toLocaleString("en-US")} USD
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const goalStyles = StyleSheet.create({
  card: {
    marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 9,
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  emoji: { fontSize: 22 },
  label: { fontSize: 8, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 1 },
  name:  { fontSize: 12, fontWeight: "700", letterSpacing: -0.1 },
  amount: { fontSize: 11, fontWeight: "600", marginTop: 1 },
});

// ─── Nav items ────────────────────────────────────────────────────────────────

function NavItems({
  colors, pathname, onPress, collapsed = false,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  pathname: string;
  onPress: (path: string) => void;
  collapsed?: boolean;
}) {
  const { order, setOrder } = useNavOrderStore();
  const userLevel = useUserLevel();
  const [editMode, setEditMode] = useState(false);
  const [liftedPath, setLiftedPath] = useState<string | null>(null);

  const items = order
    .map((path) => ALL_NAV_ITEMS.find((i) => i.path === path))
    .filter(Boolean) as typeof ALL_NAV_ITEMS;

  const top5Paths = new Set(getTop5TabPaths(order));

  const moveItem = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    [next[index], next[to]] = [next[to], next[index]];
    setOrder(next);
  };

  if (collapsed) {
    return (
      <>
        {items
          .filter((item) => item.path !== "/investors")
          .map((item) => {
          const isActive = pathname.includes(item.path.replace("/", ""));
          const locked = !isAtLeast(userLevel, item.minLevel);
          return (
            <TouchableOpacity
              key={item.path}
              style={[
                styles.navItemCollapsed,
                isActive && { backgroundColor: "rgba(34,197,94,0.1)", borderRadius: 12 },
                locked && { opacity: 0.4 },
              ]}
              onPress={() => locked ? onPress("/profile") : onPress(item.path)}
            >
              <Ionicons name={item.icon as IoniconName} size={20} color={isActive ? "#22c55e" : colors.textSub} />
            </TouchableOpacity>
          );
        })}
      </>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.editModeToggle, { borderColor: colors.border }]}
        onPress={() => { setEditMode((v) => !v); setLiftedPath(null); }}
      >
        <Ionicons
          name={editMode ? "checkmark-circle" : "reorder-three-outline"}
          size={15}
          color={editMode ? "#22c55e" : colors.textDim}
        />
        <Text style={[styles.editModeText, { color: editMode ? "#22c55e" : colors.textDim }]}>
          {editMode ? "Listo" : "Reordenar"}
        </Text>
      </TouchableOpacity>

      {/* Hint text shown in edit mode */}
      {editMode && (
        <Text style={[styles.tabHintText, { color: colors.textDim }]}>
          Los primeros 5 aparecen en la barra inferior
        </Text>
      )}

      {items
        .filter((item) => item.path !== "/investors")
        .map((item, index, filteredItems) => {
        const isActive = pathname.includes(item.path.replace("/", ""));
        const isLifted = liftedPath === item.path;
        const isInTab = top5Paths.has(item.path);
        const locked = !isAtLeast(userLevel, item.minLevel);
        const realIndex = order.indexOf(item.path);
        return (
          <React.Fragment key={item.path}>
            <View
              style={[
                styles.navItemRow,
                isLifted && styles.navItemLifted,
                locked && { opacity: 0.45 },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.navItem,
                  { flex: 1, borderRadius: 12 },
                  isActive && !locked && { backgroundColor: "rgba(34,197,94,0.1)" },
                  isLifted && { backgroundColor: "rgba(34,197,94,0.08)" },
                ]}
                onPress={() => {
                  if (editMode) { setLiftedPath(null); return; }
                  if (locked) { onPress("/profile"); return; }
                  onPress(item.path);
                }}
                onLongPress={() => {
                  if (locked) return;
                  setEditMode(true);
                  setLiftedPath(item.path);
                }}
                delayLongPress={400}
              >
                <Ionicons
                  name={locked ? "lock-closed-outline" : item.icon as IoniconName}
                  size={20}
                  color={isActive && !locked ? "#22c55e" : colors.textSub}
                />
                <Text style={[styles.navLabel, { color: isActive && !locked ? "#22c55e" : colors.textSub }]}>
                  {item.label}
                </Text>
                {locked && !editMode && (
                  <Text style={[styles.lockLevelText, { color: colors.textDim }]}>
                    Requiere {LEVEL_LABEL[item.minLevel]}
                  </Text>
                )}
                {isActive && !editMode && !locked && <View style={styles.activeDot} />}
                {/* Tab badge: shown for unlocked tab-capable items */}
                {!editMode && !locked && item.tabCapable && (
                  <View style={[
                    styles.tabBadge,
                    { borderColor: isInTab ? "#22c55e44" : colors.border },
                  ]}>
                    <Text style={[styles.tabBadgeText, { color: isInTab ? "#22c55e" : colors.textDim }]}>
                      TAB
                    </Text>
                  </View>
                )}
                {editMode && !locked && (
                  <Ionicons
                    name="reorder-two-outline"
                    size={18}
                    color={isLifted ? "#22c55e" : colors.textDim}
                  />
                )}
              </TouchableOpacity>

              {editMode && !locked && (
                <View style={styles.arrowGroup}>
                  <TouchableOpacity
                    onPress={() => moveItem(realIndex, -1)}
                    disabled={realIndex === 0}
                    hitSlop={{ top: 6, bottom: 3, left: 6, right: 6 }}
                  >
                    <Ionicons
                      name="chevron-up"
                      size={16}
                      color={realIndex === 0 ? colors.border : colors.textSub}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => moveItem(realIndex, 1)}
                    disabled={realIndex === order.length - 1}
                    hitSlop={{ top: 3, bottom: 6, left: 6, right: 6 }}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={16}
                      color={realIndex === order.length - 1 ? colors.border : colors.textSub}
                    />
                  </TouchableOpacity>
                </View>
              )}
            </View>

          </React.Fragment>
        );
      })}

    </>
  );
}

// ─── Recent chats ─────────────────────────────────────────────────────────────

function RecentChats({
  colors, onNavigate,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  onNavigate: () => void;
}) {
  const { sessions, currentId, loadSession, deleteSession, createSession } = useChatStore();
  const [expanded, setExpanded] = useState(true);
  const recent = sessions.slice(0, 12);

  const handleNew = () => {
    createSession();
    router.push("/chat" as any);
    onNavigate();
  };

  const handleLoad = (id: string) => {
    loadSession(id);
    router.push("/chat" as any);
    onNavigate();
  };

  return (
    <View style={styles.recentSection}>
      <View style={styles.recentHeader}>
        <TouchableOpacity style={styles.recentHeaderLeft} onPress={() => setExpanded((v) => !v)}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.recentTitle, { color: colors.textMuted }]}>Chats recientes</Text>
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={12}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.newChatBadge, { borderColor: colors.border }]} onPress={handleNew}>
          <Ionicons name="add" size={14} color={colors.textSub} />
        </TouchableOpacity>
      </View>

      {expanded && (
        <>
          {recent.length === 0 ? (
            <Text style={[styles.recentEmpty, { color: colors.textDim }]}>Sin chats guardados</Text>
          ) : (
            recent.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[
                  styles.recentItem,
                  s.id === currentId && { backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 8 },
                ]}
                onPress={() => handleLoad(s.id)}
              >
                <Ionicons name="chatbubble-outline" size={13} color={colors.textDim} style={{ marginTop: 1 }} />
                <Text
                  style={[styles.recentItemText, { color: s.id === currentId ? "#22c55e" : colors.textSub }]}
                  numberOfLines={1}
                >
                  {s.title}
                </Text>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close" size={13} color={colors.textDim} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          )}
        </>
      )}
    </View>
  );
}

// ─── Logout hook ──────────────────────────────────────────────────────────────

function useLogout() {
  const logout = useAppStore((s) => s.logout);
  return () => {
    // Do NOT clear portfolio or watchlist — data belongs to the user and must
    // survive logout. Server sync on next login will restore the correct state.
    logout();
    router.replace("/");
    SecureStore.deleteItemAsync("access_token").catch(() => {});
    SecureStore.deleteItemAsync("refresh_token").catch(() => {});
    SecureStore.deleteItemAsync("user_id").catch(() => {});
  };
}

// ─── Web: collapsible sidebar ─────────────────────────────────────────────────

function WebSidebar() {
  const { colors } = useTheme();
  const pathname = usePathname();
  const handleLogout = useLogout();
  const [collapsed, setCollapsed] = useState(false);
  const widthAnim = useRef(new Animated.Value(WEB_EXPANDED)).current;

  const toggleCollapse = () => {
    Animated.timing(widthAnim, {
      toValue: collapsed ? WEB_EXPANDED : WEB_COLLAPSED,
      duration: 220,
      useNativeDriver: false,
    }).start();
    setCollapsed((v) => !v);
  };

  return (
    <Animated.View style={[styles.webPanel, { width: widthAnim, backgroundColor: colors.card, borderRightColor: colors.border }]}>
      {/* Logo row */}
      <View style={[styles.logoRow, { borderBottomColor: colors.border, justifyContent: collapsed ? "center" : "flex-start" }]}>
        {!collapsed && (
          <>
            <Image source={require("../../assets/images/logo_new.png")} style={styles.logoBox} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.appName, { color: colors.text }]}>Nuvos AI</Text>
              <Text style={[styles.appSub, { color: colors.textMuted }]}>Tu asesor IA</Text>
            </View>
          </>
        )}
        <TouchableOpacity
          onPress={toggleCollapse}
          style={[styles.collapseBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}
        >
          <Ionicons
            name={collapsed ? "chevron-forward" : "chevron-back"}
            size={16}
            color={colors.textSub}
          />
        </TouchableOpacity>
      </View>

      {!collapsed && <MarketTicker />}

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {!collapsed && <ProfileCard colors={colors} />}
        {!collapsed && <GoalCard colors={colors} />}
        <View style={[styles.navSection, collapsed && styles.navSectionCollapsed]}>
          <NavItems
            colors={colors}
            pathname={pathname}
            onPress={(path) => router.push(path as any)}
            collapsed={collapsed}
          />
        </View>
        {!collapsed && <RecentChats colors={colors} onNavigate={() => {}} />}
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: 16 }]}>
        {collapsed ? (
          <>
            <TouchableOpacity style={styles.navItemCollapsed} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* 1:1 coaching CTA */}
            <TouchableOpacity
              style={[styles.coachingBtn, { backgroundColor: "rgba(0,168,94,0.08)", borderColor: "rgba(0,212,126,0.25)" }]}
              onPress={() => Linking.openURL("https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai")}
              activeOpacity={0.75}
            >
              <View style={[styles.coachingIcon, { backgroundColor: "rgba(0,212,126,0.15)" }]}>
                <Ionicons name="calendar-outline" size={16} color="#00d47e" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.coachingTitle, { color: colors.text }]}>Sesión 1:1 con Diego</Text>
                <Text style={[styles.coachingSub, { color: colors.textMuted }]}>Guía personalizada · 45 min</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.navItem} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
              <Text style={[styles.navLabel, { color: "#ef4444" }]}>Cerrar sesión</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Animated.View>
  );
}

// ─── Mobile: sliding overlay sidebar ─────────────────────────────────────────

function MobileSidebar() {
  const { colors } = useTheme();
  const { sidebarOpen, closeSidebar } = useAppStore();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const handleLogout = useLogout();

  const translateX = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: sidebarOpen ? 0 : -SIDEBAR_WIDTH,
        duration: sidebarOpen ? 250 : 200,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: sidebarOpen ? 0.55 : 0,
        duration: sidebarOpen ? 250 : 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [sidebarOpen]);

  return (
    <>
      <Animated.View
        style={[styles.overlay, { opacity: overlayOpacity }]}
        pointerEvents={sidebarOpen ? "auto" : "none"}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeSidebar} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: SIDEBAR_WIDTH,
            backgroundColor: colors.card,
            borderRightColor: colors.border,
            paddingTop: insets.top + (Platform.OS === "android" ? 16 : 8),
            transform: [{ translateX }],
          },
        ]}
      >
        {/* Logo row with close button */}
        <View style={[styles.logoRow, { borderBottomColor: colors.border }]}>
          <Image source={require("../../assets/images/logo_new.png")} style={styles.logoBox} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.appName, { color: colors.text }]}>Nuvos AI</Text>
            <Text style={[styles.appSub, { color: colors.textMuted }]}>Tu asesor IA</Text>
          </View>
          <TouchableOpacity
            onPress={closeSidebar}
            style={[styles.closeBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close" size={18} color={colors.textSub} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <ProfileCard colors={colors} />
          <GoalCard colors={colors} />
          <View style={styles.navSection}>
            <NavItems
              colors={colors}
              pathname={pathname}
              onPress={(path) => { closeSidebar(); router.push(path as any); }}
            />
          </View>
          <RecentChats colors={colors} onNavigate={closeSidebar} />
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
          {/* 1:1 coaching CTA */}
          <TouchableOpacity
            style={[styles.coachingBtn, { backgroundColor: "rgba(0,168,94,0.08)", borderColor: "rgba(0,212,126,0.25)" }]}
            onPress={() => { closeSidebar(); Linking.openURL("https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai"); }}
            activeOpacity={0.75}
          >
            <View style={[styles.coachingIcon, { backgroundColor: "rgba(0,212,126,0.15)" }]}>
              <Ionicons name="calendar-outline" size={16} color="#00d47e" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.coachingTitle, { color: colors.text }]}>Sesión 1:1 con Diego</Text>
              <Text style={[styles.coachingSub, { color: colors.textMuted }]}>Guía personalizada · 45 min</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={colors.textDim} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={() => { closeSidebar(); handleLogout(); }}>
            <Ionicons name="log-out-outline" size={20} color="#ef4444" />
            <Text style={[styles.navLabel, { color: "#ef4444" }]}>Cerrar sesión</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  return Platform.OS === "web" ? <WebSidebar /> : <MobileSidebar />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Web permanent panel
  webPanel: {
    borderRightWidth: 1,
    paddingTop: 20,
    overflow: "hidden",
  },
  // Mobile overlay
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "black",
    zIndex: 100,
  },
  panel: {
    position: "absolute",
    top: 0, left: 0, bottom: 0,
    borderRightWidth: 1,
    zIndex: 101,
  },
  // Shared
  logoRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingBottom: 16,
    borderBottomWidth: 1, marginBottom: 8,
  },
  logoBox: {
    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
  },
  appName: { fontSize: 15, fontFamily: "DMSans_700Bold" },
  appSub: { fontSize: 12, fontFamily: "DMSans_400Regular" },
  // Collapse / close buttons
  collapseBtn: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  closeBtn: {
    width: 30, height: 30, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  // Profile card — identical to web AppSidebar
  profileCard: {
    marginHorizontal: 12, marginBottom: 8,
    borderRadius: 16, borderWidth: 1, padding: 12,
  },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  avatar: {
    width: 36, height: 36, borderRadius: 18, flexShrink: 0,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#00a85e",
  },
  avatarText: { color: "white", fontSize: 14, fontFamily: "DMSans_800ExtraBold" },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
  profileName: { fontSize: 12, fontFamily: "DMSans_700Bold", marginBottom: 2 },
  profileSub: { fontSize: 10, fontFamily: "DMSans_400Regular" },
  profileBadgesRow: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  levelBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  levelBadgeText: { fontSize: 8, fontFamily: "DMSans_700Bold", letterSpacing: 0.3 },
  subBadge: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  subBadgeText: { fontSize: 8, fontFamily: "DMSans_500Medium", letterSpacing: 0.2 },
  lockLevelText: { fontSize: 9, fontFamily: "DMSans_400Regular" },
  // Stats grid: 3 equal columns with individual boxes
  statsGrid: { flexDirection: "row", gap: 6, marginBottom: 12 },
  statBox: { flex: 1, borderRadius: 12, padding: 8, alignItems: "center" },
  statLabel: { fontSize: 9, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 },
  statValue: { fontSize: 11, fontFamily: "DMSans_800ExtraBold", lineHeight: 13 },
  statSub: { fontSize: 9, fontFamily: "DMSans_400Regular", marginTop: 2 },
  // Risk bar
  riskRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  riskLabel: { fontSize: 10, fontFamily: "DMSans_600SemiBold" },
  riskPct: { fontSize: 11, fontFamily: "DMSans_800ExtraBold" },
  riskBarTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  riskBarFill: { height: "100%", borderRadius: 3 },
  // Nav
  navSection: { paddingHorizontal: 12, paddingTop: 4, gap: 2 },
  navSectionCollapsed: { paddingHorizontal: 6, alignItems: "center" },
  navItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  navItemCollapsed: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    marginVertical: 2, alignSelf: "center",
  },
  navLabel: { fontSize: 13, fontFamily: "DMSans_500Medium", flex: 1 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },
  footer: { paddingHorizontal: 12, borderTopWidth: 1 },
  coachingBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 4, marginBottom: 4, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 14, borderWidth: 1,
  },
  coachingIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  coachingTitle: { fontSize: 12, fontFamily: "DMSans_700Bold" },
  coachingSub:   { fontSize: 10, fontFamily: "DMSans_400Regular", marginTop: 1 },
  // Recent chats
  recentSection: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  recentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  recentHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  recentTitle: { fontSize: 11, fontFamily: "DMSans_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  newChatBadge: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  recentEmpty: { fontSize: 12, fontFamily: "DMSans_400Regular", paddingVertical: 8, paddingLeft: 4 },
  recentItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 9 },
  recentItemText: { fontSize: 13, fontFamily: "DMSans_400Regular", flex: 1 },
  // Reorder mode
  editModeToggle: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 10, paddingVertical: 5, marginBottom: 4,
    borderRadius: 8, borderWidth: 1, alignSelf: "flex-start",
  },
  editModeText: { fontSize: 11, fontFamily: "DMSans_600SemiBold" },
  tabHintText: { fontSize: 10, fontFamily: "DMSans_400Regular", paddingHorizontal: 10, marginBottom: 6, fontStyle: "italic" },
  tabBadge: {
    borderWidth: 1, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2,
  },
  tabBadgeText: { fontSize: 8, fontFamily: "DMSans_800ExtraBold", letterSpacing: 0.5 },
  navItemRow: { flexDirection: "row", alignItems: "center" },
  navItemLifted: {
    elevation: 4, shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 4,
  },
  arrowGroup: { flexDirection: "column", paddingRight: 12, alignItems: "center", gap: 2 },
  // Maturity
  maturitySection: { borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  maturityRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  maturityLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  maturityTrend: { fontSize: 10, fontWeight: "600" },
  maturityBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  maturityBadgeText: { fontSize: 9, fontWeight: "700" },
  maturityScoreRow: { flexDirection: "row", alignItems: "baseline", marginTop: 4 },
  maturityScore: { fontSize: 20, fontWeight: "800" },
  maturityScoreMax: { fontSize: 11, marginLeft: 2 },
});
