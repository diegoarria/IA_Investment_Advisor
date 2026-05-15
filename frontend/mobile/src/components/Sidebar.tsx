import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, TouchableOpacity, Animated, Dimensions,
  StyleSheet, Pressable, Platform, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, RISK_CONFIG, getAge } from "../lib/profileStore";
import { usePortfolioStore } from "../lib/portfolioStore";
import { useChatStore } from "../lib/chatStore";
import { useTheme } from "../lib/ThemeContext";

const SIDEBAR_WIDTH = Math.min(Dimensions.get("window").width * 0.78, 300);
const WEB_SIDEBAR_WIDTH = 260;

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const NAV_ITEMS: { icon: IoniconName; label: string; path: string }[] = [
  { icon: "chatbubble-ellipses-outline", label: "Chat IA",     path: "/chat" },
  { icon: "bar-chart-outline",           label: "Portafolios", path: "/portfolio" },
  { icon: "school-outline",              label: "Aprendizaje", path: "/learn" },
  { icon: "notifications-outline",       label: "Alertas",     path: "/notifications" },
];

// ─── Shared content blocks ────────────────────────────────────────────────────

function ProfileCard({ colors }: { colors: ReturnType<typeof useTheme>["colors"] }) {
  const { profile } = useAppStore();
  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const pct = riskCfg ? Math.round(riskCfg.pct * 100) : 0;
  if (!profile) return null;

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
    </View>
  );
}

function NavItems({
  colors, pathname, onPress,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  pathname: string;
  onPress: (path: string) => void;
}) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname.includes(item.path.replace("/", ""));
        return (
          <TouchableOpacity
            key={item.path}
            style={[
              styles.navItem,
              isActive && { backgroundColor: "rgba(34,197,94,0.1)", borderRadius: 12 },
            ]}
            onPress={() => onPress(item.path)}
          >
            <Ionicons name={item.icon} size={20} color={isActive ? "#22c55e" : colors.textSub} />
            <Text style={[styles.navLabel, { color: isActive ? "#22c55e" : colors.textSub }]}>
              {item.label}
            </Text>
            {isActive && <View style={styles.activeDot} />}
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
      {/* Section header */}
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

// ─── Web: permanent sidebar ───────────────────────────────────────────────────

function useLogout() {
  const logout = useAppStore((s) => s.logout);
  const clearPortfolio = usePortfolioStore((s) => s.clearPortfolio);
  return () => {
    clearPortfolio();
    logout();
    router.replace("/");
  };
}

function WebSidebar() {
  const { colors, isDark, toggle } = useTheme();
  const pathname = usePathname();
  const handleLogout = useLogout();

  return (
    <View style={[styles.webPanel, { backgroundColor: colors.card, borderRightColor: colors.border }]}>
      {/* Logo */}
      <View style={[styles.logoRow, { borderBottomColor: colors.border }]}>
        <View style={styles.logoBox}>
          <Ionicons name="trending-up" size={20} color="white" />
        </View>
        <View>
          <Text style={[styles.appName, { color: colors.text }]}>IA Investment</Text>
          <Text style={[styles.appSub, { color: colors.textMuted }]}>Advisor</Text>
        </View>
      </View>

      {/* Scrollable: profile + nav + recent chats */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <ProfileCard colors={colors} />
        <View style={styles.navSection}>
          <NavItems
            colors={colors}
            pathname={pathname}
            onPress={(path) => router.push(path as any)}
          />
        </View>
        <RecentChats colors={colors} onNavigate={() => {}} />
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: 16 }]}>
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
      </View>
    </View>
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
        {/* Logo */}
        <View style={[styles.logoRow, { borderBottomColor: colors.border }]}>
          <View style={styles.logoBox}>
            <Ionicons name="trending-up" size={20} color="white" />
          </View>
          <View>
            <Text style={[styles.appName, { color: colors.text }]}>IA Investment</Text>
            <Text style={[styles.appSub, { color: colors.textMuted }]}>Advisor</Text>
          </View>
        </View>

        <ProfileCard colors={colors} />

        <View style={styles.navSection}>
          <NavItems
            colors={colors}
            pathname={pathname}
            onPress={(path) => { closeSidebar(); router.push(path as any); }}
          />
        </View>
        <RecentChats colors={colors} onNavigate={closeSidebar} />

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

// ─── Export: auto-selects by platform ─────────────────────────────────────────

export default function Sidebar() {
  return Platform.OS === "web" ? <WebSidebar /> : <MobileSidebar />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Web permanent panel
  webPanel: {
    width: WEB_SIDEBAR_WIDTH,
    borderRightWidth: 1,
    paddingTop: 20,
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
    paddingHorizontal: 20, paddingBottom: 16,
    borderBottomWidth: 1, marginBottom: 8,
  },
  logoBox: {
    width: 40, height: 40, backgroundColor: "#16a34a",
    borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  appName: { fontSize: 15, fontWeight: "700" },
  appSub: { fontSize: 12 },
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
  navSection: { paddingHorizontal: 12, paddingTop: 4, gap: 2 },
  navItem: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
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
});
