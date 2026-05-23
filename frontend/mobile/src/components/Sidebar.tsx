import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, Animated, Dimensions,
  StyleSheet, Pressable, Platform, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, RISK_CONFIG, getAge, maturityLabel } from "../lib/profileStore";
import { usePortfolioStore } from "../lib/portfolioStore";
import { useChatStore } from "../lib/chatStore";
import { useTheme } from "../lib/ThemeContext";
import MarketTicker from "./MarketTicker";

const SIDEBAR_WIDTH = Math.min(Dimensions.get("window").width * 0.78, 300);
const WEB_EXPANDED = 260;
const WEB_COLLAPSED = 62;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const NAV_ITEMS: { icon: IoniconName; label: string; path: string }[] = [
  { icon: "chatbubble-ellipses-outline", label: "Chat IA",       path: "/chat" },
  { icon: "bar-chart-outline",           label: "Portafolios",   path: "/portfolio" },
  { icon: "person-circle-outline",       label: "Mi Perfil",     path: "/profile" },
  { icon: "game-controller-outline",     label: "Paper Trading", path: "/paper" },
  { icon: "notifications-outline",       label: "Alertas",       path: "/notifications" },
  { icon: "school-outline",              label: "Aprendizaje",   path: "/learn" },
];

// ─── Profile card ─────────────────────────────────────────────────────────────

function ProfileCard({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  const { profile, maturityScore, maturityHistory } = useAppStore();
  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const pct = riskCfg ? Math.round(riskCfg.pct * 100) : 0;
  const ml = maturityLabel(maturityScore);
  if (!profile) return null;

  const recentEvents = maturityHistory.slice(-10);
  const trend = recentEvents.reduce((acc, e) => acc + e.delta, 0);
  const trendText = trend > 0 ? `+${trend} pts` : trend < 0 ? `${trend} pts` : "estable";
  const trendColor = trend > 0 ? "#22c55e" : trend < 0 ? "#ef4444" : colors.textDim;

  return (
    <View style={[styles.profileCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <View style={styles.profileHeader}>
        <View style={[styles.avatar, { backgroundColor: riskCfg?.color ?? "#16a34a" }]}>
          <Text style={styles.avatarText}>{profile.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
            {profile.name}
          </Text>
          {riskCfg && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Ionicons name={riskCfg.icon} size={12} color={riskCfg.color} />
              <Text style={[styles.profileTypeBadge, { color: riskCfg.color }]}>{riskCfg.label}</Text>
            </View>
          )}
        </View>
      </View>
      {riskCfg && (
        <>
          <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
            {pct < 100 && <View style={{ flex: 100 - pct }} />}
          </View>
          <View style={[styles.barLabels, { marginBottom: 10 }]}>
            <Text style={[styles.barLabel, { color: colors.textDim }]}>Bajo riesgo</Text>
            <Text style={[styles.barLabel, { color: colors.textDim }]}>Alto riesgo</Text>
          </View>
        </>
      )}
      <View style={[styles.statsGrid, { borderTopColor: colors.border }]}>
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Edad</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>{getAge(profile.birth_date)} años</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Ingresos</Text>
          <Text style={[styles.statValue, { color: colors.text }]}>
            ${Number(profile.monthly_income).toLocaleString()}/mes
          </Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Aportación</Text>
          <Text style={[styles.statValue, { color: colors.accentLight }]}>
            ${Number(profile.monthly_contribution).toLocaleString()}/mes
          </Text>
        </View>
      </View>

      <View style={[styles.maturitySection, { borderTopColor: colors.border }]}>
        <View style={styles.maturityRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="trophy-outline" size={12} color={ml.color} />
            <Text style={[styles.maturityLabel, { color: colors.textMuted }]}>Madurez Inversora</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.maturityTrend, { color: trendColor }]}>{trendText}</Text>
            <View style={[styles.maturityBadge, { backgroundColor: ml.color + "22", borderColor: ml.color + "55" }]}>
              <Text style={[styles.maturityBadgeText, { color: ml.color }]}>{ml.label}</Text>
            </View>
          </View>
        </View>
        <View style={[styles.barTrack, { backgroundColor: colors.border, marginBottom: 0 }]}>
          <View style={[styles.barFill, { flex: maturityScore, backgroundColor: ml.color }]} />
          {maturityScore < 100 && <View style={{ flex: 100 - maturityScore }} />}
        </View>
        <View style={styles.maturityScoreRow}>
          <Text style={[styles.maturityScore, { color: ml.color }]}>{maturityScore}</Text>
          <Text style={[styles.maturityScoreMax, { color: colors.textDim }]}>/100</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Nav items ────────────────────────────────────────────────────────────────

function NavItems({
  colors, pathname, onPress, collapsed = false,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  pathname: string;
  onPress: (path: string) => void;
  collapsed?: boolean;
}) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname.includes(item.path.replace("/", ""));
        return (
          <TouchableOpacity
            key={item.path}
            style={[
              collapsed ? styles.navItemCollapsed : styles.navItem,
              isActive && { backgroundColor: "rgba(34,197,94,0.1)", borderRadius: 12 },
            ]}
            onPress={() => onPress(item.path)}
          >
            <Ionicons name={item.icon} size={20} color={isActive ? "#22c55e" : colors.textSub} />
            {!collapsed && (
              <>
                <Text style={[styles.navLabel, { color: isActive ? "#22c55e" : colors.textSub }]}>
                  {item.label}
                </Text>
                {isActive && <View style={styles.activeDot} />}
              </>
            )}
          </TouchableOpacity>
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
  const clearPortfolio = usePortfolioStore((s) => s.clearPortfolio);
  return () => {
    clearPortfolio();
    logout();
    router.replace("/");
  };
}

// ─── Web: collapsible sidebar ─────────────────────────────────────────────────

function WebSidebar() {
  const { colors, isDark, toggle } = useTheme();
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
            <View style={styles.logoBox}>
              <Ionicons name="trending-up" size={20} color="white" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.appName, { color: colors.text }]}>Finzo</Text>
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
            <TouchableOpacity
              style={styles.navItemCollapsed}
              onPress={() => router.push("/profile/edit" as any)}
            >
              <Ionicons name="create-outline" size={20} color={colors.textSub} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItemCollapsed} onPress={toggle}>
              <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={colors.textSub} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItemCollapsed} onPress={handleLogout}>
              <Ionicons name="log-out-outline" size={20} color="#ef4444" />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.navItem} onPress={() => router.push("/profile/edit" as any)}>
              <Ionicons name="create-outline" size={20} color={colors.textSub} />
              <Text style={[styles.navLabel, { color: colors.textSub }]}>Editar perfil</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.navItem} onPress={toggle}>
              <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={colors.textSub} />
              <Text style={[styles.navLabel, { color: colors.textSub }]}>
                {isDark ? "Modo claro" : "Modo oscuro"}
              </Text>
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
  const { colors, isDark, toggle } = useTheme();
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
          <View style={styles.logoBox}>
            <Ionicons name="trending-up" size={20} color="white" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.appName, { color: colors.text }]}>Finzo</Text>
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
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => { closeSidebar(); router.push("/profile/edit" as any); }}
          >
            <Ionicons name="create-outline" size={20} color={colors.textSub} />
            <Text style={[styles.navLabel, { color: colors.textSub }]}>Editar perfil</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem} onPress={toggle}>
            <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={20} color={colors.textSub} />
            <Text style={[styles.navLabel, { color: colors.textSub }]}>
              {isDark ? "Modo claro" : "Modo oscuro"}
            </Text>
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
    width: 40, height: 40, backgroundColor: "#16a34a",
    borderRadius: 10, alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  appName: { fontSize: 15, fontWeight: "700" },
  appSub: { fontSize: 12 },
  // Collapse / close buttons
  collapseBtn: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  closeBtn: {
    width: 30, height: 30, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  // Profile card
  profileCard: {
    marginHorizontal: 12, marginBottom: 8,
    borderRadius: 12, borderWidth: 1, padding: 12,
  },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontSize: 16, fontWeight: "700" },
  profileName: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  profileTypeBadge: { fontSize: 11, fontWeight: "600" },
  barTrack: { height: 7, borderRadius: 4, overflow: "hidden", flexDirection: "row", marginBottom: 5 },
  barFill: { height: "100%", borderRadius: 4 },
  barLabels: { flexDirection: "row", justifyContent: "space-between" },
  barLabel: { fontSize: 10 },
  statsGrid: { flexDirection: "row", borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  statItem: { flex: 1, alignItems: "center" },
  statLabel: { fontSize: 10, marginBottom: 2 },
  statValue: { fontSize: 11, fontWeight: "600", textAlign: "center" },
  statDivider: { width: 1, marginVertical: 2 },
  // Nav
  navSection: { paddingHorizontal: 12, paddingTop: 4, gap: 2 },
  navSectionCollapsed: { paddingHorizontal: 6, alignItems: "center" },
  navItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  navItemCollapsed: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    marginVertical: 2, alignSelf: "center",
  },
  navLabel: { fontSize: 15, fontWeight: "500", flex: 1 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },
  footer: { paddingHorizontal: 12, borderTopWidth: 1 },
  // Recent chats
  recentSection: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  recentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  recentHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  recentTitle: { fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, flex: 1 },
  newChatBadge: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  recentEmpty: { fontSize: 12, paddingVertical: 8, paddingLeft: 4 },
  recentItem: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingVertical: 9 },
  recentItemText: { fontSize: 13, flex: 1 },
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
