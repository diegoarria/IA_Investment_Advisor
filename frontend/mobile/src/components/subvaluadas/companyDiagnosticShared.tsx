import React, { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { scoreColor } from "../../lib/types/companyDiagnostic";

// Mobile mirror of web's Card/ExpandableSection/ExplainableValue/
// CompanyDiagnosticSectionScore (components/ui/*.tsx + subvaluadas/
// CompanyDiagnosticSectionScore.tsx) — RN has no hover, so the (i) popover
// becomes a bottom-sheet-style Modal instead of an absolutely-positioned
// dropdown, and every color comes from the `colors` prop (viColors) instead
// of CSS custom properties.

export function DiagCard({ children, colors, style }: { children: ReactNode; colors: any; style?: any }) {
  return (
    <View style={[{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }, style]}>
      {children}
    </View>
  );
}

export function DiagRaisedBlock({ children, colors, style }: { children: ReactNode; colors: any; style?: any }) {
  return (
    <View style={[{ borderRadius: 10, padding: 10, backgroundColor: colors.bgRaised }, style]}>
      {children}
    </View>
  );
}

export function ExpandableSection({
  title, icon, headline, defaultExpanded = false, children, colors,
}: {
  title: string;
  icon?: ReactNode;
  headline?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
  colors: any;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <DiagCard colors={colors}>
      <TouchableOpacity
        onPress={() => setExpanded((e) => !e)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 14 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          {icon}
          <Text style={{ fontSize: 14.5, fontWeight: "800", color: colors.text }} numberOfLines={1}>{title}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, shrink: 0 } as any}>
          {headline}
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
      {expanded && <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>{children}</View>}
    </DiagCard>
  );
}

export function ExplainableValue({
  label, summary, children, colors,
}: {
  label: string;
  summary: string;
  children: ReactNode;
  colors: any;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 }}>
        <View style={{ flexShrink: 1, minWidth: 0 }}>{children}</View>
        <TouchableOpacity onPress={() => setOpen(true)} hitSlop={8}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 }} onPress={() => setOpen(false)}>
          <Pressable
            style={{ borderRadius: 16, padding: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3, color: colors.textMuted }}>{label}</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={17} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 14.5, lineHeight: 21, color: colors.textSub }}>{summary}</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function DiagSectionScore({ score, label, explanation, colors }: { score: number; label: string; explanation: string; colors: any }) {
  const color = scoreColor(score);
  return (
    <ExplainableValue label={label} summary={explanation} colors={colors}>
      <Text style={{ fontSize: 16, fontWeight: "900", color }}>{score}</Text>
      <Text style={{ fontSize: 11.5, fontWeight: "700", color: colors.textMuted }}>/100</Text>
    </ExplainableValue>
  );
}
