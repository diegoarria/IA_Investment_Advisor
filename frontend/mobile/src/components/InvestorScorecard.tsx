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

function SegmentBar({ pct, color }: { pct: number; color: string }) {
  const filled = Math.round(pct / 10);
  return (
    <View style={{ flexDirection: "row", gap: 3, marginTop: 8 }}>
      {Array.from({ length: 10 }).map((_, i) => (
        <View
          key={i}
          style={{
            flex: 1, height: 4, borderRadius: 2,
            backgroundColor: i < filled ? color : "#162032",
            opacity: i < filled ? 1 : 1,
          }}
        />
      ))}
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
    riskPct < 65 ? "Crecimiento balanceado" :
    "Máximo crecimiento";

  return (
    <View style={styles.card}>
      {/* Colored top stripe */}
      <View style={[styles.topStripe, { backgroundColor: riskCfg.color }]} />
      {/* Soft glow behind hero area */}
      <View style={[styles.topGlow, { backgroundColor: riskCfg.color + "14" }]} />

      {/* ── Brand row ── */}
      <View style={styles.brandRow}>
        <View style={[styles.logoBox, { borderColor: riskCfg.color + "55", backgroundColor: riskCfg.color + "14" }]}>
          <Ionicons name="trending-up" size={11} color={riskCfg.color} />
        </View>
        <Text style={styles.brandName}>Nuvo</Text>
        <View style={[styles.profileTag, { borderColor: riskCfg.color + "50", backgroundColor: riskCfg.color + "14" }]}>
          <Text style={[styles.profileTagText, { color: riskCfg.color }]}>INVESTOR PROFILE</Text>
        </View>
      </View>

      {/* ── Hero ── */}
      <View style={styles.hero}>
        <View style={[styles.avatarRing, { borderColor: riskCfg.color + "70" }]}>
          <View style={[styles.avatarInner, { backgroundColor: riskCfg.color }]}>
            <Text style={styles.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroName} numberOfLines={1}>{profile.name}</Text>
          <View style={[styles.riskPill, { backgroundColor: riskCfg.color + "1E", borderColor: riskCfg.color + "55" }]}>
            <Ionicons name={riskCfg.icon} size={10} color={riskCfg.color} />
            <Text style={[styles.riskPillText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
          </View>
        </View>
      </View>

      {/* ── Stats 2-column grid ── */}
      <View style={[styles.row, styles.divider]}>
        {/* Maturity */}
        <View style={[styles.statCard, { borderColor: ml.color + "35", backgroundColor: ml.color + "0A" }]}>
          <Text style={styles.statLabel}>MADUREZ</Text>
          <View style={styles.statNumRow}>
            <Text style={[styles.statBig, { color: ml.color }]}>{maturityScore}</Text>
            <Text style={[styles.statSuffix, { color: ml.color + "80" }]}>/100</Text>
          </View>
          <SegmentBar pct={maturityScore} color={ml.color} />
          <View style={styles.statFootRow}>
            <Text style={[styles.statCaption, { color: ml.color + "CC" }]}>{ml.label}</Text>
            {trend !== 0 && (
              <Text style={[styles.trendText, { color: trend > 0 ? "#22c55e" : "#ef4444" }]}>
                {trend > 0 ? `↑+${trend}` : `↓${trend}`}
              </Text>
            )}
          </View>
        </View>

        {/* Risk */}
        <View style={[styles.statCard, { borderColor: riskCfg.color + "35", backgroundColor: riskCfg.color + "0A" }]}>
          <Text style={styles.statLabel}>RIESGO</Text>
          <View style={styles.statNumRow}>
            <Text style={[styles.statBig, { color: riskCfg.color }]}>{riskPct}</Text>
            <Text style={[styles.statSuffix, { color: riskCfg.color + "80" }]}>%</Text>
          </View>
          <SegmentBar pct={riskPct} color={riskCfg.color} />
          <View style={styles.statFootRow}>
            <Text style={[styles.statCaption, { color: riskCfg.color + "CC" }]}>{riskCaption}</Text>
          </View>
        </View>
      </View>

      {/* ── Psicología inversora ── */}
      {qa && (
        <View style={[styles.section, styles.divider]}>
          <Text style={styles.sectionTitle}>PSICOLOGÍA INVERSORA</Text>
          {[
            { key: "MENTALIDAD",      val: Q1_LABELS[qa.q1], ans: qa.q1 },
            { key: "CONOCIMIENTO",    val: Q3_LABELS[qa.q3], ans: qa.q3 },
            { key: "COMPORTAMIENTO",  val: Q5_LABELS[qa.q5], ans: qa.q5 },
          ].map((row) => (
            <View key={row.key} style={styles.psychRow}>
              <Text style={styles.psychKey}>{row.key}</Text>
              <View style={styles.psychRight}>
                <View style={[styles.ansBadge, { backgroundColor: riskCfg.color + "22", borderColor: riskCfg.color + "55" }]}>
                  <Text style={[styles.ansBadgeText, { color: riskCfg.color }]}>{row.ans}</Text>
                </View>
                <Text style={styles.psychVal} numberOfLines={1}>{row.val}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Mentor ── */}
      {mentor && (
        <View style={[styles.section, styles.divider]}>
          <Text style={styles.sectionTitle}>MENTOR</Text>
          <View style={[styles.mentorBox, { borderColor: mentor.color + "45", backgroundColor: mentor.color + "0D" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={[styles.mentorPhoto, { borderColor: mentor.color + "66" }]} />
            ) : (
              <View style={[styles.mentorEmoji, { backgroundColor: mentor.color + "22" }]}>
                <Text style={{ fontSize: 22 }}>{mentor.emoji}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.mentorName, { color: mentor.color }]}>{mentor.name}</Text>
              <Text style={styles.mentorBadge}>{mentor.badge}</Text>
            </View>
            <View style={[styles.mentorIconBox, { backgroundColor: mentor.color + "18" }]}>
              <Ionicons name="school-outline" size={13} color={mentor.color} />
            </View>
          </View>
        </View>
      )}

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <View style={[styles.footerDot, { backgroundColor: riskCfg.color }]} />
        <Text style={styles.footerText}>nuvo.app · {new Date().getFullYear()}</Text>
        <View style={[styles.footerDot, { backgroundColor: riskCfg.color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 320,
    backgroundColor: "#05080f",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#0e1825",
    overflow: "hidden",
    paddingHorizontal: 20,
    paddingBottom: 18,
  },

  topStripe: {
    position: "absolute", top: 0, left: 0, right: 0, height: 2,
  },
  topGlow: {
    position: "absolute", top: 0, left: 0, right: 0, height: 100,
  },

  // Brand
  brandRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingTop: 20, marginBottom: 18,
  },
  logoBox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  brandName: {
    color: "#e2e8f0", fontSize: 14, fontWeight: "800", letterSpacing: -0.3, flex: 1,
  },
  profileTag: {
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  profileTagText: {
    fontSize: 8, fontWeight: "800", letterSpacing: 0.9,
  },

  // Hero
  hero: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 2 },
  avatarRing: {
    width: 62, height: 62, borderRadius: 31, borderWidth: 2,
    alignItems: "center", justifyContent: "center",
  },
  avatarInner: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { color: "white", fontSize: 23, fontWeight: "900" },
  heroText: { flex: 1, gap: 8 },
  heroName: { color: "#f1f5f9", fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  riskPill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start", borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 9, paddingVertical: 4,
  },
  riskPillText: { fontSize: 11, fontWeight: "700" },

  // Layout helpers
  row: { flexDirection: "row", gap: 10, paddingVertical: 16 },
  divider: { borderTopWidth: 1, borderTopColor: "#0d1b2a" },
  section: { paddingVertical: 14 },
  sectionTitle: {
    color: "#4a6070", fontSize: 9, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 10,
  },

  // Stat cards
  statCard: {
    flex: 1, borderWidth: 1, borderRadius: 14, padding: 12,
  },
  statLabel: {
    color: "#3a5168", fontSize: 8, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4,
  },
  statNumRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  statBig: { fontSize: 30, fontWeight: "900", lineHeight: 32 },
  statSuffix: { fontSize: 12, fontWeight: "600" },
  statFootRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginTop: 6,
  },
  statCaption: { fontSize: 9, fontWeight: "600" },
  trendText: { fontSize: 9, fontWeight: "800" },

  // Psychology rows
  psychRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 5,
  },
  psychKey: {
    color: "#4a6070", fontSize: 8, fontWeight: "800",
    letterSpacing: 0.4, width: 90, textTransform: "uppercase",
  },
  psychRight: { flexDirection: "row", alignItems: "center", gap: 7, flex: 1, justifyContent: "flex-end" },
  ansBadge: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  ansBadgeText: { fontSize: 9, fontWeight: "900" },
  psychVal: { color: "#6b7a90", fontSize: 10, fontWeight: "600", textAlign: "right", flex: 1 },

  // Mentor
  mentorBox: {
    flexDirection: "row", alignItems: "center", gap: 12,
    borderWidth: 1, borderRadius: 14, padding: 12,
  },
  mentorPhoto: { width: 42, height: 42, borderRadius: 21, borderWidth: 1.5 },
  mentorEmoji: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  mentorName: { fontSize: 13, fontWeight: "800" },
  mentorBadge: { color: "#3a5168", fontSize: 9, fontWeight: "600", marginTop: 2 },
  mentorIconBox: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },

  // Footer
  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingTop: 4,
  },
  footerDot: { width: 4, height: 4, borderRadius: 2 },
  footerText: { color: "#2e4558", fontSize: 9, fontWeight: "600", letterSpacing: 0.4 },
});
