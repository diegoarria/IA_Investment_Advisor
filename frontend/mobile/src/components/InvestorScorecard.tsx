import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore, RISK_CONFIG, maturityLabel } from "../lib/profileStore";
import { getMentorInfo } from "../lib/mentorData";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const Q1_LABELS: Record<string, string> = {
  A: "Vende ante caídas", B: "Espera pasivamente", C: "Analiza fundamentos", D: "Compra las caídas",
};
const Q3_LABELS: Record<string, string> = {
  A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado",
};
const Q5_LABELS: Record<string, string> = {
  A: "Pasivo / automático", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria activa",
};
const ANSWER_COLORS: Record<string, string> = {
  A: "#3b82f6", B: "#22c55e", C: "#f59e0b", D: "#ef4444",
};

function ScoreBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: color + "22", marginTop: 10, overflow: "hidden" }}>
      <View style={{ width: `${Math.min(pct, 100)}%` as any, height: "100%", backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export default function InvestorScorecard() {
  const { profile, maturityScore, maturityHistory } = useAppStore();
  if (!profile) return null;

  const riskCfg = RISK_CONFIG[profile.risk_tolerance];
  const riskPct = Math.round(riskCfg.pct * 100);
  const ml = maturityLabel(maturityScore);
  const trend = maturityHistory.slice(-10).reduce((acc, e) => acc + e.delta, 0);
  const mentor = getMentorInfo(profile.mentor);
  const mentorPhoto = mentor ? MENTOR_PHOTOS[mentor.id] : null;
  const qa = profile.quiz_answers;

  const riskCaption =
    riskPct < 40 ? "Preserva capital" :
    riskPct < 70 ? "Crecimiento balanceado" :
    "Máximo crecimiento";

  return (
    <View style={s.card}>

      {/* ── HEADER ── */}
      <View style={s.header}>
        {/* Color wash behind header */}
        <View style={[s.headerWash, { backgroundColor: riskCfg.color + "16" }]} />
        {/* Top accent bar */}
        <View style={[s.accentBar, { backgroundColor: riskCfg.color }]} />

        {/* Brand row */}
        <View style={s.brandRow}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.brandLogo} />
          <Text style={s.brandName}>NUVOS AI</Text>
          <View style={[s.investorBadge, { borderColor: riskCfg.color + "55", backgroundColor: riskCfg.color + "14" }]}>
            <Text style={[s.investorBadgeText, { color: riskCfg.color }]}>INVESTOR CARD</Text>
          </View>
        </View>

        {/* Avatar with glow rings */}
        <View style={s.avatarWrap}>
          <View style={{ width: 116, height: 116, alignItems: "center", justifyContent: "center" }}>
            <View style={{ position: "absolute", width: 116, height: 116, borderRadius: 58, borderWidth: 1, borderColor: riskCfg.color + "14" }} />
            <View style={{ position: "absolute", width: 98, height: 98, borderRadius: 49, borderWidth: 1, borderColor: riskCfg.color + "28" }} />
            <View style={{ position: "absolute", width: 82, height: 82, borderRadius: 41, borderWidth: 1.5, borderColor: riskCfg.color + "55" }} />
            {profile.avatarUri ? (
              <Image source={{ uri: profile.avatarUri }} style={[s.avatar, { backgroundColor: "transparent" }]} />
            ) : (
              <View style={[s.avatar, { backgroundColor: riskCfg.color }]}>
                <Text style={s.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* ── IDENTITY ── */}
      <View style={s.identity}>
        <Text style={s.name} numberOfLines={1}>{profile.name}</Text>
        <View style={s.tagsRow}>
          <View style={[s.tag, { backgroundColor: riskCfg.color + "1A", borderColor: riskCfg.color + "50" }]}>
            <Ionicons name={riskCfg.icon} size={11} color={riskCfg.color} />
            <Text style={[s.tagText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
          </View>
          {trend !== 0 && (
            <View style={[s.tag, {
              backgroundColor: trend > 0 ? "#22c55e15" : "#ef444415",
              borderColor: trend > 0 ? "#22c55e45" : "#ef444445",
            }]}>
              <Text style={[s.tagText, { color: trend > 0 ? "#22c55e" : "#ef4444" }]}>
                {trend > 0 ? `↑ +${trend}` : `↓ ${trend}`} pts
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── MAIN STATS ── */}
      <View style={[s.statsBlock, { borderTopColor: riskCfg.color + "1A" }]}>
        <View style={s.statCol}>
          <Text style={s.statLabel}>MADUREZ INVERSORA</Text>
          <View style={s.statNumRow}>
            <Text style={[s.statNum, { color: ml.color }]}>{maturityScore}</Text>
            <Text style={[s.statDenom, { color: ml.color + "60" }]}>/100</Text>
          </View>
          <Text style={[s.statCaption, { color: ml.color + "CC" }]}>{ml.label}</Text>
          <ScoreBar pct={maturityScore} color={ml.color} />
        </View>

        <View style={[s.statSep, { backgroundColor: riskCfg.color + "22" }]} />

        <View style={s.statCol}>
          <Text style={s.statLabel}>PERFIL DE RIESGO</Text>
          <View style={s.statNumRow}>
            <Text style={[s.statNum, { color: riskCfg.color }]}>{riskPct}</Text>
            <Text style={[s.statDenom, { color: riskCfg.color + "60" }]}>%</Text>
          </View>
          <Text style={[s.statCaption, { color: riskCfg.color + "CC" }]}>{riskCaption}</Text>
          <ScoreBar pct={riskPct} color={riskCfg.color} />
        </View>
      </View>

      {/* ── PERFIL PSICOLÓGICO ── */}
      {qa && (
        <View style={[s.section, { borderTopColor: riskCfg.color + "1A" }]}>
          <Text style={[s.sectionTitle, { color: riskCfg.color + "88" }]}>PERFIL PSICOLÓGICO</Text>
          <View style={s.dnaList}>
            {([
              { icon: "trending-down-outline" as const, label: "MENTALIDAD",   val: Q1_LABELS[qa.q1], ans: qa.q1 },
              { icon: "school-outline" as const,        label: "CONOCIMIENTO", val: Q3_LABELS[qa.q3], ans: qa.q3 },
              { icon: "settings-outline" as const,      label: "GESTIÓN",      val: Q5_LABELS[qa.q5], ans: qa.q5 },
            ]).map((row) => {
              const ac = ANSWER_COLORS[row.ans] ?? riskCfg.color;
              return (
                <View key={row.label} style={[s.dnaRow, { backgroundColor: ac + "08", borderColor: ac + "22" }]}>
                  <View style={[s.dnaIcon, { backgroundColor: ac + "18" }]}>
                    <Ionicons name={row.icon} size={12} color={ac} />
                  </View>
                  <View style={s.dnaMid}>
                    <Text style={[s.dnaLabel, { color: ac + "88" }]}>{row.label}</Text>
                    <Text style={s.dnaVal} numberOfLines={1}>{row.val}</Text>
                  </View>
                  <View style={[s.dnaBadge, { backgroundColor: ac }]}>
                    <Text style={s.dnaBadgeText}>{row.ans}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── MENTOR ── */}
      {mentor && (
        <View style={[s.section, { borderTopColor: riskCfg.color + "1A" }]}>
          <Text style={[s.sectionTitle, { color: riskCfg.color + "88" }]}>APRENDE CON</Text>
          <View style={[s.mentorCard, { backgroundColor: mentor.color + "0D", borderColor: mentor.color + "35" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={[s.mentorPhoto, { borderColor: mentor.color + "60" }]} />
            ) : (
              <View style={[s.mentorEmojiBox, { backgroundColor: mentor.color + "22" }]}>
                <Text style={{ fontSize: 26 }}>{mentor.emoji}</Text>
              </View>
            )}
            <View style={s.mentorInfo}>
              <Text style={[s.mentorName, { color: mentor.color }]}>{mentor.name}</Text>
              <Text style={s.mentorTitle}>{mentor.title}</Text>
            </View>
            <View style={[s.mentorBadge, { backgroundColor: mentor.color + "18", borderColor: mentor.color + "40" }]}>
              <Text style={[s.mentorBadgeText, { color: mentor.color }]}>{mentor.badge}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── FOOTER ── */}
      <View style={[s.footer, { borderTopColor: riskCfg.color + "1A" }]}>
        <View style={s.footerLeft}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.footerLogo} />
          <Text style={s.footerBrand}>nuvosai.app</Text>
        </View>
        <View style={[s.footerVerify, { backgroundColor: riskCfg.color + "12", borderColor: riskCfg.color + "30" }]}>
          <Ionicons name="checkmark-circle" size={10} color={riskCfg.color} />
          <Text style={[s.footerVerifyText, { color: riskCfg.color }]}>Perfil verificado</Text>
        </View>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  card: {
    width: 340,
    backgroundColor: "#04080f",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#0c1828",
    overflow: "hidden",
  },

  // ── Header ──
  header: { paddingBottom: 10 },
  headerWash: { position: "absolute", top: 0, left: 0, right: 0, height: 150 },
  accentBar: { height: 3 },
  brandRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20,
  },
  brandLogo: { width: 20, height: 20, borderRadius: 5 },
  brandName: { color: "#d0dce8", fontSize: 11, fontWeight: "900", letterSpacing: 1.8, flex: 1 },
  investorBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  investorBadgeText: { fontSize: 7, fontWeight: "900", letterSpacing: 1 },
  avatarWrap: { alignItems: "center", paddingBottom: 8 },
  avatar: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  avatarLetter: { color: "white", fontSize: 28, fontWeight: "900", letterSpacing: -1 },

  // ── Identity ──
  identity: {
    alignItems: "center", paddingHorizontal: 24,
    paddingTop: 14, paddingBottom: 20, gap: 10,
  },
  name: { color: "#eef2f7", fontSize: 26, fontWeight: "900", letterSpacing: -0.8, textAlign: "center" },
  tagsRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
  tag: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  tagText: { fontSize: 10, fontWeight: "700" },

  // ── Stats ──
  statsBlock: {
    flexDirection: "row", borderTopWidth: 1,
    paddingVertical: 20, paddingHorizontal: 20,
  },
  statCol: { flex: 1 },
  statSep: { width: 1, marginHorizontal: 16, borderRadius: 1 },
  statLabel: { color: "#2a4258", fontSize: 7, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  statNumRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  statNum: { fontSize: 50, fontWeight: "900", letterSpacing: -2, lineHeight: 54 },
  statDenom: { fontSize: 16, fontWeight: "600" },
  statCaption: { fontSize: 9, fontWeight: "700", marginTop: 4 },

  // ── Section ──
  section: { borderTopWidth: 1, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14 },
  sectionTitle: { fontSize: 7, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 10 },

  // ── DNA rows ──
  dnaList: { gap: 6 },
  dnaRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 11, paddingHorizontal: 10, paddingVertical: 9 },
  dnaIcon: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  dnaMid: { flex: 1, gap: 2 },
  dnaLabel: { fontSize: 7, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  dnaVal: { color: "#b8c8d8", fontSize: 11, fontWeight: "600" },
  dnaBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  dnaBadgeText: { color: "white", fontSize: 11, fontWeight: "900" },

  // ── Mentor ──
  mentorCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 12 },
  mentorPhoto: { width: 46, height: 46, borderRadius: 23, borderWidth: 2 },
  mentorEmojiBox: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  mentorInfo: { flex: 1, gap: 3 },
  mentorName: { fontSize: 13, fontWeight: "800", letterSpacing: -0.2 },
  mentorTitle: { color: "#2e4558", fontSize: 9, fontWeight: "500" },
  mentorBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  mentorBadgeText: { fontSize: 8, fontWeight: "800" },

  // ── Footer ──
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 14 },
  footerLeft: { flexDirection: "row", alignItems: "center", gap: 7 },
  footerLogo: { width: 14, height: 14, borderRadius: 3 },
  footerBrand: { color: "#243546", fontSize: 9, fontWeight: "700", letterSpacing: 0.6 },
  footerVerify: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  footerVerifyText: { fontSize: 8, fontWeight: "700", letterSpacing: 0.3 },
});
