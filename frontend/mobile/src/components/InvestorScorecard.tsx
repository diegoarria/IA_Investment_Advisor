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

export default function InvestorScorecard() {
  const { profile, maturityScore, maturityHistory } = useAppStore();
  if (!profile) return null;

  const riskCfg = RISK_CONFIG[profile.risk_tolerance];
  const riskPct = Math.round(riskCfg.pct * 100);
  const ml = maturityLabel(maturityScore);
  const recent = maturityHistory.slice(-10);
  const trend = recent.reduce((acc, e) => acc + e.delta, 0);
  const mentor = getMentorInfo(profile.mentor);
  const mentorPhoto = mentor ? MENTOR_PHOTOS[mentor.id] : null;
  const qa = profile.quiz_answers;

  return (
    <View style={styles.card}>
      {/* Top accent stripe */}
      <View style={[styles.topStripe, { backgroundColor: riskCfg.color }]} />

      {/* Branding */}
      <View style={styles.brandRow}>
        <View style={styles.brandIcon}>
          <Ionicons name="trending-up" size={10} color="white" />
        </View>
        <Text style={styles.brandText}>IA INVESTMENT ADVISOR</Text>
      </View>

      {/* Hero: avatar + name + risk badge */}
      <View style={styles.heroRow}>
        <View style={[styles.avatarRing, { borderColor: riskCfg.color + "55" }]}>
          <View style={[styles.avatarInner, { backgroundColor: riskCfg.color }]}>
            <Text style={styles.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.heroInfo}>
          <Text style={styles.heroName}>{profile.name}</Text>
          <View style={[styles.riskPill, { backgroundColor: riskCfg.color + "1A", borderColor: riskCfg.color + "55" }]}>
            <Ionicons name={riskCfg.icon} size={10} color={riskCfg.color} />
            <Text style={[styles.riskPillText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
          </View>
        </View>
      </View>

      {/* ── Risk bar ── */}
      <View style={styles.block}>
        <View style={styles.blockHeader}>
          <Text style={styles.blockLabel}>PERFIL DE RIESGO</Text>
          <Text style={[styles.blockValue, { color: riskCfg.color }]}>{riskPct}%</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${riskPct}%` as any, backgroundColor: riskCfg.color }]} />
        </View>
        <View style={styles.trackEndLabels}>
          <Text style={styles.trackEndText}>Conservador</Text>
          <Text style={styles.trackEndText}>Agresivo</Text>
        </View>
      </View>

      {/* ── Maturity ── */}
      <View style={[styles.block, styles.divider]}>
        <View style={styles.blockHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="trophy-outline" size={10} color={ml.color} />
            <Text style={styles.blockLabel}>MADUREZ INVERSORA</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {trend !== 0 && (
              <Text style={[styles.trendLabel, { color: trend > 0 ? "#22c55e" : "#ef4444" }]}>
                {trend > 0 ? `+${trend}` : trend} pts
              </Text>
            )}
            <View style={[styles.levelPill, { backgroundColor: ml.color + "1A", borderColor: ml.color + "55" }]}>
              <Text style={[styles.levelPillText, { color: ml.color }]}>{ml.label}</Text>
            </View>
          </View>
        </View>
        <View style={styles.maturityScoreRow}>
          <Text style={[styles.maturityNum, { color: ml.color }]}>{maturityScore}</Text>
          <Text style={styles.maturityDen}>/100</Text>
        </View>
        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${maturityScore}%` as any, backgroundColor: ml.color }]} />
        </View>
      </View>

      {/* ── Mentor ── */}
      {mentor && (
        <View style={[styles.block, styles.divider]}>
          <View style={[styles.mentorRow, { borderLeftColor: mentor.color, backgroundColor: mentor.color + "0D" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={styles.mentorPhoto} />
            ) : (
              <View style={[styles.mentorEmojiBox, { backgroundColor: mentor.color + "22" }]}>
                <Text style={{ fontSize: 18 }}>{mentor.emoji}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.mentorName, { color: mentor.color }]}>{mentor.name}</Text>
              <Text style={styles.mentorSub}>{mentor.badge}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Psychology ── */}
      {qa && (
        <View style={[styles.block, styles.divider]}>
          <Text style={[styles.blockLabel, { marginBottom: 9 }]}>PERFIL PSICOLÓGICO</Text>
          {[
            { key: "MENTALIDAD",     val: Q1_LABELS[qa.q1], answer: qa.q1 },
            { key: "CONOCIMIENTO",   val: Q3_LABELS[qa.q3], answer: qa.q3 },
            { key: "COMPORTAMIENTO", val: Q5_LABELS[qa.q5], answer: qa.q5 },
          ].map((row) => (
            <View key={row.key} style={styles.insightRow}>
              <Text style={styles.insightKey}>{row.key}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[styles.answerDot, { backgroundColor: riskCfg.color }]}>
                  <Text style={styles.answerDotText}>{row.answer}</Text>
                </View>
                <Text style={styles.insightVal}>{row.val}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>🤖 IA Investment Advisor · {new Date().getFullYear()}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 300,
    backgroundColor: "#07090f",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#131929",
    overflow: "hidden",
    padding: 20,
  },
  topStripe: {
    position: "absolute",
    top: 0, left: 0, right: 0,
    height: 3,
  },

  // Branding
  brandRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 18, marginTop: 6 },
  brandIcon: {
    width: 20, height: 20, borderRadius: 5, backgroundColor: "#16a34a",
    alignItems: "center", justifyContent: "center",
  },
  brandText: { color: "#2d3a4a", fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },

  // Hero
  heroRow: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 18 },
  avatarRing: {
    width: 58, height: 58, borderRadius: 29, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  avatarInner: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { color: "white", fontSize: 22, fontWeight: "900" },
  heroInfo: { flex: 1, gap: 7 },
  heroName: { color: "#f0f4f8", fontSize: 19, fontWeight: "800", letterSpacing: -0.4 },
  riskPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start", borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  riskPillText: { fontSize: 11, fontWeight: "700" },

  // Blocks
  block: { marginBottom: 12, paddingBottom: 12 },
  divider: { borderTopWidth: 1, borderTopColor: "#0e1520", paddingTop: 12, marginTop: 0 },
  blockHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 9 },
  blockLabel: { color: "#2d3d52", fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  blockValue: { fontSize: 13, fontWeight: "800" },

  // Track
  track: {
    height: 6, backgroundColor: "#111827", borderRadius: 3, overflow: "hidden",
  },
  trackFill: { height: "100%", borderRadius: 3 },
  trackEndLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  trackEndText: { color: "#1e2d3d", fontSize: 9 },

  // Maturity
  maturityScoreRow: { flexDirection: "row", alignItems: "baseline", marginBottom: 8 },
  maturityNum: { fontSize: 30, fontWeight: "900", lineHeight: 34 },
  maturityDen: { color: "#1e2d3d", fontSize: 13, marginLeft: 3 },
  trendLabel: { fontSize: 10, fontWeight: "700" },
  levelPill: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  levelPillText: { fontSize: 9, fontWeight: "800" },

  // Mentor
  mentorRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderLeftWidth: 3, borderRadius: 8, padding: 9,
  },
  mentorPhoto: { width: 34, height: 34, borderRadius: 17 },
  mentorEmojiBox: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  mentorName: { fontSize: 12, fontWeight: "700" },
  mentorSub: { color: "#2d3d52", fontSize: 9, marginTop: 2 },

  // Psychology
  insightRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 4,
  },
  insightKey: { color: "#1e2d3d", fontSize: 9, fontWeight: "700", letterSpacing: 0.4, width: 92 },
  insightVal: { color: "#6b7280", fontSize: 10, fontWeight: "600" },
  answerDot: {
    width: 17, height: 17, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
  },
  answerDotText: { color: "white", fontSize: 8, fontWeight: "800" },

  // Footer
  footer: { alignItems: "center", paddingTop: 4 },
  footerText: { color: "#111827", fontSize: 8 },
});
