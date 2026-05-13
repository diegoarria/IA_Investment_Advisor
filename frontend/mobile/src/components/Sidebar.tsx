import React, { useEffect, useRef } from "react";
import {
  View, Text, TouchableOpacity, Animated, Dimensions,
  StyleSheet, Pressable, Platform
} from "react-native";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, RISK_CONFIG, getAge } from "../lib/profileStore";
import { useTheme } from "../lib/ThemeContext";

const SIDEBAR_WIDTH = Math.min(Dimensions.get("window").width * 0.78, 300);

const NAV_ITEMS = [
  { icon: "💬", label: "Chat IA",      path: "/chat" },
  { icon: "📊", label: "Portafolios",  path: "/portfolio" },
  { icon: "🔔", label: "Alertas",      path: "/notifications" },
  { icon: "🎓", label: "Aprendizaje",  path: "/learn" },
];

export default function Sidebar() {
  const { colors, isDark, toggle } = useTheme();
  const { sidebarOpen, closeSidebar, profile } = useAppStore();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

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

  const riskCfg = profile?.risk_tolerance ? RISK_CONFIG[profile.risk_tolerance] : null;
  const pct = riskCfg ? Math.round(riskCfg.pct * 100) : 0;

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
            <Text style={{ fontSize: 18 }}>📈</Text>
          </View>
          <View>
            <Text style={[styles.appName, { color: colors.text }]}>IA Investment</Text>
            <Text style={[styles.appSub, { color: colors.textMuted }]}>Advisor</Text>
          </View>
        </View>

        {/* Perfil de inversionista */}
        {profile && (
          <View style={[styles.profileCard, { backgroundColor: colors.bg, borderColor: colors.border }]}>
            {/* Avatar + nombre */}
            <View style={styles.profileHeader}>
              <View style={[styles.avatar, { backgroundColor: riskCfg?.color ?? "#16a34a" }]}>
                <Text style={styles.avatarText}>
                  {profile.name ? profile.name.charAt(0).toUpperCase() : "?"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileName, { color: colors.text }]} numberOfLines={1}>
                  {profile.name}
                </Text>
                {riskCfg && (
                  <Text style={[styles.profileTypeBadge, { color: riskCfg.color }]}>
                    {riskCfg.icon} {riskCfg.label}
                  </Text>
                )}
              </View>
            </View>

            {/* Barra de riesgo */}
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

            {/* Datos financieros */}
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
        )}

        {/* Navegación */}
        <View style={styles.navSection}>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.includes(item.path.replace("/", ""));
            return (
              <TouchableOpacity
                key={item.path}
                style={[
                  styles.navItem,
                  isActive && { backgroundColor: "rgba(34,197,94,0.1)", borderRadius: 12 },
                ]}
                onPress={() => { closeSidebar(); router.push(item.path as any); }}
              >
                <Text style={styles.navIcon}>{item.icon}</Text>
                <Text style={[styles.navLabel, { color: isActive ? "#22c55e" : colors.textSub }]}>
                  {item.label}
                </Text>
                {isActive && <View style={styles.activeDot} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Footer: editar perfil + toggle de tema */}
        <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => { closeSidebar(); router.push("/profile/edit" as any); }}
          >
            <Text style={styles.navIcon}>✏️</Text>
            <Text style={[styles.navLabel, { color: colors.textSub }]}>Editar perfil</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem} onPress={toggle}>
            <Text style={styles.navIcon}>{isDark ? "☀️" : "🌙"}</Text>
            <Text style={[styles.navLabel, { color: colors.textSub }]}>
              {isDark ? "Modo claro" : "Modo oscuro"}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "black",
    zIndex: 100,
  },
  panel: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    borderRightWidth: 1,
    zIndex: 101,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  logoBox: {
    width: 40, height: 40,
    backgroundColor: "#16a34a",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: { fontSize: 15, fontWeight: "700" },
  appSub: { fontSize: 12 },
  profileCard: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  profileTitle: { fontSize: 13, fontWeight: "600", marginBottom: 10 },
  barTrack: {
    height: 7,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row",
    marginBottom: 5,
  },
  barFill: { height: "100%", borderRadius: 4 },
  barLabels: { flexDirection: "row", justifyContent: "space-between" },
  barLabel: { fontSize: 10 },
  profileHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "white", fontSize: 16, fontWeight: "700" },
  profileName: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
  profileTypeBadge: { fontSize: 11, fontWeight: "600" },
  statsGrid: { flexDirection: "row", borderTopWidth: 1, paddingTop: 10, marginTop: 2 },
  statItem: { flex: 1, alignItems: "center" },
  statLabel: { fontSize: 10, marginBottom: 2 },
  statValue: { fontSize: 11, fontWeight: "600", textAlign: "center" },
  statDivider: { width: 1, marginVertical: 2 },
  navSection: { flex: 1, paddingHorizontal: 12, paddingTop: 4, gap: 2 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  navIcon: { fontSize: 18 },
  navLabel: { fontSize: 15, fontWeight: "500", flex: 1 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#22c55e" },
  footer: { paddingHorizontal: 12, borderTopWidth: 1 },
});
