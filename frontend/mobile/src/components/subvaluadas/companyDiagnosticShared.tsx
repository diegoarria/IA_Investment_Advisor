import React, { useState, type ReactNode } from "react";
import { View, Text, TouchableOpacity, Modal, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
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

// Nuvos Radar card surface (redesign v2, 2026-09-27): a diagonal gradient
// from a faint tint of `tint` (or a white sheen) into the card color, a
// hairline border, generous radius. Every card on the screen uses this.
export function GlowCard({ children, colors, tint, style, strong }: { children: ReactNode; colors: any; tint?: string; style?: any; strong?: boolean }) {
  const from = tint ? `${tint}${strong ? "40" : "1c"}` : "rgba(255,255,255,0.05)";
  return (
    <View style={[{ borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: tint ? `${tint}${strong ? "66" : "33"}` : colors.border }, style]}>
      <LinearGradient colors={[from, colors.card]} start={{ x: 0, y: 0 }} end={{ x: 0.9, y: 0.9 }} style={{ padding: 20 }}>
        {children}
      </LinearGradient>
    </View>
  );
}

// Circular 0-100 gauge with a two-stop gradient stroke. `size` scales the
// whole thing; the center shows the same score + /100 the old text showed.
export function RingGauge({
  score, size = 112, stroke = 10, from = "#F5C76B", to = "#D4A24C", track, children,
}: { score: number; size?: number; stroke?: number; from?: string; to?: string; track: string; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const id = `ring-${from}-${to}-${size}`.replace(/[^a-zA-Z0-9-]/g, "");
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <SvgGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={`url(#${id})`} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

// Metric tile inside the diagnostic tabs — same gradient language as
// GlowCard, smaller: faint tint (or white sheen) → raised surface.
export function DiagRaisedBlock({ children, colors, style, tint }: { children: ReactNode; colors: any; style?: any; tint?: string }) {
  return (
    <View style={[{ borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: tint ? `${tint}33` : colors.border }, style]}>
      <LinearGradient
        colors={[tint ? `${tint}1f` : "rgba(255,255,255,0.05)", colors.bgRaised]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ padding: 14 }}
      >
        {children}
      </LinearGradient>
    </View>
  );
}

// Small uppercase section label used inside every tab/pillar body.
export function DiagEyebrow({ children, colors, color }: { children: ReactNode; colors: any; color?: string }) {
  return (
    <Text style={{ fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: color ?? colors.textMuted, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

// Icon in a tinted circle — the bullet/marker used across tab bodies.
export function DiagIconDot({ name, color, size = 30 }: { name: keyof typeof Ionicons.glyphMap; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: `${color}24` }}>
      <Ionicons name={name} size={Math.round(size * 0.5)} color={color} />
    </View>
  );
}

// Pillar sections render inside the diagnostic tabs card (see
// CompanyDiagnosticValuationTabs), so they're flat — a header row and the
// body — instead of a bordered card nested in another bordered card
// (Nuvos Radar redesign, 2026-09-27).
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
    <View>
      <TouchableOpacity
        onPress={() => setExpanded((e) => !e)}
        activeOpacity={0.7}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingBottom: 14 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          {icon && (
            <View style={{ width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: colors.bgRaised }}>
              {icon}
            </View>
          )}
          <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 }} numberOfLines={1}>{title}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {headline}
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
        </View>
      </TouchableOpacity>
      {expanded && <View style={{ gap: 14 }}>{children}</View>}
    </View>
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
