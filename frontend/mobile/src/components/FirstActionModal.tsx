import React from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../lib/ThemeContext";
import { useAppStore } from "../lib/profileStore";

const ACTIONS = [
  {
    icon:  "bar-chart-outline" as const,
    color: "#22c55e",
    title: "Importa tu portafolio",
    desc:  "Sube una captura de pantalla y analiza tu cartera con IA",
    route: "/(tabs)/portfolio" as const,
  },
  {
    icon:  "time-outline" as const,
    color: "#8b5cf6",
    title: "Prueba el Simulador",
    desc:  "Toma decisiones en crisis históricas reales",
    route: "/(tabs)/arena" as const,
  },
  {
    icon:  "chatbubble-ellipses-outline" as const,
    color: "#0ea5e9",
    title: "Pregúntale a la IA",
    desc:  "Tu mentor de inversiones está listo para ayudarte",
    route: null,
  },
] as const;

export default function FirstActionModal() {
  const { colors } = useTheme();
  const profile           = useAppStore((s) => s.profile);
  const hasSeenFirstAction = useAppStore((s) => s.hasSeenFirstAction);
  const markFirstActionSeen = useAppStore((s) => s.markFirstActionSeen);

  const visible = !!profile && !hasSeenFirstAction;
  if (!visible) return null;

  const firstName = profile.name.split(" ")[0];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={markFirstActionSeen}>
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Header */}
          <View style={s.header}>
            <Text style={s.emoji}>👋</Text>
            <Text style={[s.title, { color: colors.text }]}>Hola, {firstName}</Text>
            <Text style={[s.subtitle, { color: colors.textMuted }]}>
              ¿Por dónde quieres empezar?
            </Text>
          </View>

          {/* Action buttons */}
          <View style={s.actions}>
            {ACTIONS.map((a) => (
              <TouchableOpacity
                key={a.title}
                style={[s.actionBtn, { backgroundColor: a.color + "12", borderColor: a.color + "40" }]}
                activeOpacity={0.75}
                onPress={() => {
                  markFirstActionSeen();
                  if (a.route) router.navigate(a.route);
                }}
              >
                <View style={[s.iconBox, { backgroundColor: a.color + "20" }]}>
                  <Ionicons name={a.icon} size={22} color={a.color} />
                </View>
                <View style={s.actionText}>
                  <Text style={[s.actionTitle, { color: colors.text }]}>{a.title}</Text>
                  <Text style={[s.actionDesc,  { color: colors.textMuted }]}>{a.desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={markFirstActionSeen} style={s.skip}>
            <Text style={[s.skipText, { color: colors.textDim }]}>Explorar por mi cuenta</Text>
          </TouchableOpacity>

        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
    gap: 20,
  },
  header:   { alignItems: "center", gap: 6 },
  emoji:    { fontSize: 40 },
  title:    { fontSize: 24, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, textAlign: "center" },

  actions: { gap: 10 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  iconBox: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  actionText: { flex: 1, gap: 2 },
  actionTitle: { fontSize: 14, fontWeight: "700" },
  actionDesc:  { fontSize: 12, lineHeight: 17 },

  skip:     { alignItems: "center", paddingTop: 4 },
  skipText: { fontSize: 13 },
});
