import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";

export const HOME_SCREEN_KEY = "nuvos_home_screen";

const OPTIONS = [
  { key: "home",          label: "Inicio",         sub: "Dashboard y resumen diario",        icon: "home-outline" as const,               color: "#00d47e", route: "/(tabs)/home" },
  { key: "patrimonio",    label: "Patrimonio",      sub: "Tu patrimonio y portafolio",         icon: "wallet-outline" as const,             color: "#3b82f6", route: "/(tabs)/patrimonio" },
  { key: "chat",          label: "Mentor IA",       sub: "Pregúntale lo que quieras",          icon: "chatbubble-ellipses-outline" as const, color: "#8b5cf6", route: "/(tabs)/chat" },
  { key: "notifications", label: "Notificaciones",  sub: "Lo más importante de tus activos",   icon: "notifications-outline" as const,      color: "#ef4444", route: "/(tabs)/notifications" },
  { key: "academy",       label: "Academy",         sub: "Aprende a invertir cada día",        icon: "school-outline" as const,             color: "#f59e0b", route: "/(tabs)/academy" },
];

export type HomeScreenKey = (typeof OPTIONS)[number]["key"];

interface Props {
  visible: boolean;
  onDone: (route: string) => void;
}

export default function MobileHomeScreenPickerModal({ visible, onDone }: Props) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<HomeScreenKey | null>(null);

  const handleConfirm = () => {
    if (!selected) return;
    const opt = OPTIONS.find((o) => o.key === selected)!;
    onDone(opt.route);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Header */}
          <Text style={s.emoji}>🎉</Text>
          <Text style={[s.title, { color: colors.text }]}>¡Configuración completa!</Text>
          <Text style={[s.sub, { color: colors.textMuted }]}>
            ¿Qué pantalla prefieres ver primero cada vez que entres?
          </Text>

          {/* Options */}
          <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
            {OPTIONS.map(({ key, label, sub, icon, color }) => {
              const active = selected === key;
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setSelected(key as HomeScreenKey)}
                  activeOpacity={0.75}
                  style={[
                    s.option,
                    { backgroundColor: active ? color + "14" : colors.bgRaised },
                    active && { borderColor: color, borderWidth: 1.5 },
                  ]}
                >
                  <View style={[s.iconBox, { backgroundColor: active ? color + "22" : colors.border }]}>
                    <Ionicons name={icon} size={20} color={active ? color : colors.textMuted} />
                  </View>
                  <View style={s.optionText}>
                    <Text style={[s.optLabel, { color: active ? color : colors.text }]}>{label}</Text>
                    <Text style={[s.optSub, { color: colors.textMuted }]}>{sub}</Text>
                  </View>
                  {active && (
                    <View style={[s.radio, { backgroundColor: color }]}>
                      <View style={s.radioDot} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* CTA */}
          <TouchableOpacity
            onPress={handleConfirm}
            disabled={!selected}
            activeOpacity={0.85}
            style={[
              s.cta,
              {
                backgroundColor: selected ? "#00d47e" : colors.bgRaised,
                opacity: selected ? 1 : 0.5,
              },
            ]}
          >
            <Text style={[s.ctaText, { color: selected ? "#fff" : colors.textMuted }]}>
              Empezar
            </Text>
            <Ionicons name="arrow-forward" size={16} color={selected ? "#fff" : colors.textMuted} />
          </TouchableOpacity>
          <Text style={[s.hint, { color: colors.textDim }]}>
            Puedes cambiarlo desde tu perfil en cualquier momento
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", justifyContent: "center", alignItems: "center", padding: 20 },
  card:       { width: "100%", maxWidth: 380, borderRadius: 28, borderWidth: 1, padding: 24, alignItems: "center" },
  emoji:      { fontSize: 40, marginBottom: 8 },
  title:      { fontSize: 18, fontWeight: "900", textAlign: "center" },
  sub:        { fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: 16, lineHeight: 18 },
  list:       { width: "100%", maxHeight: 300 },
  option:     { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 12, marginBottom: 8, gap: 12, borderWidth: 1.5, borderColor: "transparent" },
  iconBox:    { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optionText: { flex: 1 },
  optLabel:   { fontSize: 14, fontWeight: "800" },
  optSub:     { fontSize: 12, marginTop: 1 },
  radio:      { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  radioDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  cta:        { width: "100%", borderRadius: 16, paddingVertical: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16 },
  ctaText:    { fontSize: 15, fontWeight: "900" },
  hint:       { fontSize: 11, textAlign: "center", marginTop: 10 },
});
