import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppStore, RISK_CONFIG, maturityLabel, getAge } from "../lib/profileStore";
import { getMentorInfo } from "../lib/mentorData";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const Q1_LABELS: Record<string, string> = {
  A: "Vende ante caídas", B: "Espera y observa", C: "Analiza fundamentos", D: "Compra las caídas",
};
const Q3_LABELS: Record<string, string> = {
  A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado",
};
const Q5_LABELS: Record<string, string> = {
  A: "Pasivo / automático", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria",
};

// Trait color per answer
const TRAIT_COLORS: Record<string, string> = {
  A: "#60a5fa", B: "#34d399", C: "#fbbf24", D: "#f87171",
};

export default function InvestorScorecard() {
  const { profile, maturityScore, maturityHistory } = useAppStore();
  if (!profile) return null;

  const riskCfg   = RISK_CONFIG[profile.risk_tolerance];
  const riskPct   = Math.round(riskCfg.pct * 100);
  const ml        = maturityLabel(maturityScore);
  const trend     = maturityHistory.slice(-10).reduce((acc, e) => acc + e.delta, 0);
  const mentor    = getMentorInfo(profile.mentor);
  const mentorPhoto = mentor ? MENTOR_PHOTOS[mentor.id] : null;
  const qa        = profile.quiz_answers;
  const age       = profile.birth_date ? getAge(profile.birth_date) : null;

  const firstName = profile.name.split(" ")[0].toUpperCase();

  // Accent color: derive a slightly brighter variant for text
  const ac = riskCfg.color;

  return (
    <View style={s.card}>

      {/* ─────────────────────────── HERO ─────────────────────────── */}
      <View style={s.hero}>
        {/* Decorative blobs */}
        <View style={[s.blob1, { backgroundColor: ac + "30" }]} />
        <View style={[s.blob2, { backgroundColor: ac + "18" }]} />

        {/* Brand strip */}
        <View style={s.brandStrip}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.brandLogo} />
          <Text style={s.brandText}>NUVOS AI</Text>
          <View style={[s.yearPill, { borderColor: ac + "55" }]}>
            <Text style={[s.yearText, { color: ac }]}>2025</Text>
          </View>
        </View>

        {/* Avatar */}
        <View style={s.avatarWrap}>
          {/* Outer glow ring */}
          <View style={[s.avatarRing, { borderColor: ac + "40" }]} />
          {profile.avatarUri ? (
            <Image source={{ uri: profile.avatarUri }} style={[s.avatar, { borderColor: ac }]} />
          ) : (
            <View style={[s.avatar, s.avatarFallback, { backgroundColor: ac + "25", borderColor: ac }]}>
              <Text style={[s.avatarLetter, { color: ac }]}>{profile.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
        </View>

        {/* Name */}
        <Text style={s.heroName} numberOfLines={1}>{firstName}</Text>
        {age && <Text style={s.heroSub}>Inversor · {age} años</Text>}

        {/* Tags row */}
        <View style={s.tagsRow}>
          <View style={[s.tag, { backgroundColor: ac + "22", borderColor: ac + "55" }]}>
            <Ionicons name={riskCfg.icon as any} size={10} color={ac} />
            <Text style={[s.tagText, { color: ac }]}>{riskCfg.label.toUpperCase()}</Text>
          </View>
          {trend !== 0 && (
            <View style={[s.tag, { backgroundColor: trend > 0 ? "#22c55e20" : "#ef444420", borderColor: trend > 0 ? "#22c55e50" : "#ef444450" }]}>
              <Text style={[s.tagText, { color: trend > 0 ? "#4ade80" : "#f87171" }]}>
                {trend > 0 ? `▲ +${trend}` : `▼ ${trend}`} pts
              </Text>
            </View>
          )}
        </View>

        {/* Bottom accent line */}
        <View style={[s.heroAccentLine, { backgroundColor: ac }]} />
      </View>

      {/* ─────────────────────── MADUREZ INVERSORA ────────────────── */}
      <View style={s.scoreSection}>
        <Text style={s.scoreSectionLabel}>MADUREZ INVERSORA</Text>

        {/* Ghost number behind */}
        <View style={s.ghostWrap} pointerEvents="none">
          <Text style={[s.ghostNum, { color: ml.color }]}>{maturityScore}</Text>
        </View>

        <View style={s.scoreMain}>
          <View style={s.scoreNumWrap}>
            <Text style={[s.scoreNum, { color: ml.color }]}>{maturityScore}</Text>
            <Text style={[s.scoreDenom, { color: ml.color + "70" }]}>/100</Text>
          </View>
          <View style={[s.scoreLabelPill, { backgroundColor: ml.color + "20", borderColor: ml.color + "50" }]}>
            <Text style={[s.scoreLabelText, { color: ml.color }]}>{ml.label.toUpperCase()}</Text>
          </View>
        </View>

        {/* Thick progress bar */}
        <View style={s.bigBarTrack}>
          <View style={[s.bigBarFill, { width: `${Math.min(maturityScore, 100)}%` as any, backgroundColor: ml.color }]} />
        </View>
        <View style={s.barEndLabels}>
          <Text style={s.barEndLabel}>NOVATO</Text>
          <Text style={s.barEndLabel}>EXPERTO</Text>
        </View>
      </View>

      {/* ─────────────────────── RISK PROFILE ─────────────────────── */}
      <View style={[s.riskSection, { borderTopColor: ac + "20" }]}>
        <View style={s.riskLeft}>
          <Text style={s.riskLabel}>PERFIL DE RIESGO</Text>
          <View style={s.riskNumRow}>
            <Text style={[s.riskNum, { color: ac }]}>{riskPct}</Text>
            <Text style={[s.riskPct, { color: ac + "80" }]}>%</Text>
          </View>
          <Text style={[s.riskCaption, { color: ac + "99" }]}>
            {riskPct < 40 ? "Preserva capital" : riskPct < 70 ? "Crecimiento balanceado" : "Máximo crecimiento"}
          </Text>
        </View>
        <View style={[s.riskRight, { borderLeftColor: ac + "25" }]}>
          {/* Segmented bar */}
          <View style={s.segBarWrap}>
            {[...Array(10)].map((_, i) => (
              <View
                key={i}
                style={[
                  s.segBar,
                  {
                    backgroundColor: i < Math.round(riskPct / 10) ? ac : ac + "18",
                    opacity: i < Math.round(riskPct / 10) ? 1 : 0.4,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={[s.riskTier, { color: ac }]}>{riskCfg.label}</Text>
        </View>
      </View>

      {/* ─────────────────────── ADN INVERSOR ─────────────────────── */}
      {qa && (
        <View style={[s.dnaSection, { borderTopColor: ac + "20" }]}>
          <Text style={s.dnaSectionLabel}>ADN INVERSOR</Text>
          <View style={s.dnaGrid}>
            {([
              { icon: "pulse-outline", label: "MENTALIDAD",   val: Q1_LABELS[qa.q1], ans: qa.q1 },
              { icon: "school-outline", label: "CONOCIMIENTO", val: Q3_LABELS[qa.q3], ans: qa.q3 },
              { icon: "settings-outline", label: "GESTIÓN",     val: Q5_LABELS[qa.q5], ans: qa.q5 },
            ] as const).map((row) => {
              const tc = TRAIT_COLORS[row.ans] ?? ac;
              return (
                <View key={row.label} style={s.dnaRow}>
                  <View style={[s.dnaLeftBar, { backgroundColor: tc }]} />
                  <View style={[s.dnaIconBox, { backgroundColor: tc + "15" }]}>
                    <Ionicons name={row.icon as any} size={13} color={tc} />
                  </View>
                  <View style={s.dnaContent}>
                    <Text style={[s.dnaTraitLabel, { color: tc + "aa" }]}>{row.label}</Text>
                    <Text style={s.dnaTraitVal} numberOfLines={1}>{row.val}</Text>
                  </View>
                  <View style={[s.dnaAnswerBadge, { backgroundColor: tc }]}>
                    <Text style={s.dnaAnswerText}>{row.ans}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ─────────────────────── MENTOR ───────────────────────────── */}
      {mentor && (
        <View style={[s.mentorSection, { borderTopColor: ac + "20" }]}>
          <Text style={s.mentorSectionLabel}>REFERENTE</Text>
          <View style={[s.mentorCard, { backgroundColor: mentor.color + "10", borderColor: mentor.color + "35" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={[s.mentorPhoto, { borderColor: mentor.color + "80" }]} />
            ) : (
              <View style={[s.mentorEmoji, { backgroundColor: mentor.color + "20" }]}>
                <Text style={{ fontSize: 24 }}>{mentor.emoji}</Text>
              </View>
            )}
            <View style={s.mentorText}>
              <Text style={[s.mentorName, { color: "#fff" }]}>{mentor.name}</Text>
              <Text style={s.mentorTitle}>{mentor.title}</Text>
              {mentor.principles[0] && (
                <Text style={[s.mentorQuote, { color: mentor.color }]}>"{mentor.principles[0]}"</Text>
              )}
            </View>
          </View>
        </View>
      )}

      {/* ─────────────────────── FOOTER ───────────────────────────── */}
      <View style={[s.footer, { borderTopColor: ac + "15" }]}>
        <View style={s.footerLeft}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.footerLogo} />
          <Text style={s.footerBrand}>nuvosai.app</Text>
        </View>
        <View style={[s.footerBadge, { backgroundColor: ac + "15", borderColor: ac + "35" }]}>
          <Ionicons name="checkmark-circle" size={10} color={ac} />
          <Text style={[s.footerBadgeText, { color: ac }]}>PERFIL VERIFICADO</Text>
        </View>
      </View>

    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const CARD_BG   = "#060810";
const TEXT_DIM  = "rgba(255,255,255,0.35)";
const TEXT_MUTED = "rgba(255,255,255,0.18)";

const s = StyleSheet.create({
  card: {
    width: 340,
    backgroundColor: CARD_BG,
    borderRadius: 28,
    overflow: "hidden",
  },

  // ── Hero ──────────────────────────────────────────────────────────
  hero: {
    paddingBottom: 0,
    overflow: "hidden",
    minHeight: 220,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  blob1: {
    position: "absolute", top: -60, right: -60,
    width: 220, height: 220, borderRadius: 110,
  },
  blob2: {
    position: "absolute", top: 20, left: -80,
    width: 200, height: 200, borderRadius: 100,
  },
  brandStrip: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 18, gap: 8,
  },
  brandLogo:  { width: 18, height: 18, borderRadius: 5 },
  brandText:  { color: "rgba(255,255,255,0.5)", fontSize: 10, fontWeight: "900", letterSpacing: 2, flex: 1 },
  yearPill:   { borderWidth: 1, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  yearText:   { fontSize: 9, fontWeight: "800", letterSpacing: 1 },

  avatarWrap:   { marginTop: 52, alignItems: "center", justifyContent: "center" },
  avatarRing: {
    position: "absolute",
    width: 92, height: 92, borderRadius: 46,
    borderWidth: 1.5,
  },
  avatar: { width: 76, height: 76, borderRadius: 38, borderWidth: 2 },
  avatarFallback: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { fontSize: 32, fontWeight: "900" },

  heroName: {
    color: "#fff",
    fontSize: 34, fontWeight: "900",
    letterSpacing: -1, textAlign: "center",
    marginTop: 14, paddingHorizontal: 20,
  },
  heroSub: {
    color: TEXT_DIM,
    fontSize: 11, fontWeight: "600",
    letterSpacing: 0.5, marginTop: 3,
  },
  tagsRow: {
    flexDirection: "row", gap: 8,
    marginTop: 12, marginBottom: 20, flexWrap: "wrap", justifyContent: "center",
  },
  tag: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 11, paddingVertical: 5,
  },
  tagText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },

  heroAccentLine: { height: 2, width: "100%" },

  // ── Score section ──────────────────────────────────────────────────
  scoreSection: {
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 20,
    overflow: "hidden",
  },
  scoreSectionLabel: {
    color: TEXT_DIM,
    fontSize: 8, fontWeight: "900", letterSpacing: 2,
    textTransform: "uppercase", marginBottom: 4,
  },
  ghostWrap: {
    position: "absolute", top: 0, right: -10,
    overflow: "hidden",
  },
  ghostNum: {
    fontSize: 160, fontWeight: "900",
    opacity: 0.04, letterSpacing: -8, lineHeight: 160,
  },
  scoreMain: {
    flexDirection: "row", alignItems: "flex-end",
    gap: 12, marginTop: 4,
  },
  scoreNumWrap: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  scoreNum: { fontSize: 80, fontWeight: "900", letterSpacing: -4, lineHeight: 82 },
  scoreDenom: { fontSize: 20, fontWeight: "700", marginBottom: 6 },
  scoreLabelPill: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    marginBottom: 8, alignSelf: "flex-end",
  },
  scoreLabelText: { fontSize: 9, fontWeight: "900", letterSpacing: 1.2 },

  bigBarTrack: {
    height: 8, backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 4, overflow: "hidden", marginTop: 14,
  },
  bigBarFill:  { height: "100%", borderRadius: 4 },
  barEndLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
  barEndLabel:  { color: TEXT_MUTED, fontSize: 7, fontWeight: "700", letterSpacing: 0.8 },

  // ── Risk section ───────────────────────────────────────────────────
  riskSection: {
    flexDirection: "row",
    borderTopWidth: 1, paddingVertical: 18, paddingHorizontal: 24,
  },
  riskLeft:  { flex: 1, gap: 2 },
  riskRight: {
    flex: 1, borderLeftWidth: 1,
    paddingLeft: 20, gap: 8, alignItems: "flex-start",
  },
  riskLabel:   { color: TEXT_DIM, fontSize: 8, fontWeight: "900", letterSpacing: 1.5, textTransform: "uppercase" },
  riskNumRow:  { flexDirection: "row", alignItems: "baseline", gap: 2 },
  riskNum:     { fontSize: 44, fontWeight: "900", letterSpacing: -2, lineHeight: 48 },
  riskPct:     { fontSize: 16, fontWeight: "700" },
  riskCaption: { fontSize: 9, fontWeight: "600", marginTop: 2 },
  segBarWrap:  { flexDirection: "row", gap: 3, marginTop: 4 },
  segBar:      { width: 14, height: 8, borderRadius: 2 },
  riskTier:    { fontSize: 10, fontWeight: "800", letterSpacing: 0.5, marginTop: 2 },

  // ── DNA section ────────────────────────────────────────────────────
  dnaSection: {
    borderTopWidth: 1, paddingHorizontal: 20,
    paddingTop: 16, paddingBottom: 16,
  },
  dnaSectionLabel: {
    color: TEXT_DIM, fontSize: 8, fontWeight: "900",
    letterSpacing: 2, textTransform: "uppercase", marginBottom: 10,
  },
  dnaGrid: { gap: 7 },
  dnaRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 12, overflow: "hidden",
    paddingVertical: 10, paddingRight: 12,
  },
  dnaLeftBar:   { width: 3, alignSelf: "stretch", borderRadius: 2 },
  dnaIconBox: {
    width: 30, height: 30, borderRadius: 8,
    alignItems: "center", justifyContent: "center", marginLeft: 8,
  },
  dnaContent:   { flex: 1, gap: 2 },
  dnaTraitLabel: { fontSize: 7, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  dnaTraitVal:   { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "700" },
  dnaAnswerBadge: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  dnaAnswerText: { color: "#fff", fontSize: 11, fontWeight: "900" },

  // ── Mentor section ─────────────────────────────────────────────────
  mentorSection: {
    borderTopWidth: 1, paddingHorizontal: 20,
    paddingTop: 16, paddingBottom: 16,
  },
  mentorSectionLabel: {
    color: TEXT_DIM, fontSize: 8, fontWeight: "900",
    letterSpacing: 2, textTransform: "uppercase", marginBottom: 10,
  },
  mentorCard: {
    flexDirection: "row", alignItems: "center",
    gap: 12, borderWidth: 1, borderRadius: 16, padding: 12,
  },
  mentorPhoto: { width: 50, height: 50, borderRadius: 25, borderWidth: 2 },
  mentorEmoji: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: "center", justifyContent: "center",
  },
  mentorText:  { flex: 1, gap: 2 },
  mentorName:  { fontSize: 14, fontWeight: "800", letterSpacing: -0.3 },
  mentorTitle: { color: TEXT_DIM, fontSize: 9, fontWeight: "500" },
  mentorQuote: { fontSize: 9, fontWeight: "600", fontStyle: "italic", marginTop: 4, lineHeight: 13 },

  // ── Footer ─────────────────────────────────────────────────────────
  footer: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1, paddingHorizontal: 20, paddingVertical: 12,
  },
  footerLeft:  { flexDirection: "row", alignItems: "center", gap: 6 },
  footerLogo:  { width: 14, height: 14, borderRadius: 3 },
  footerBrand: { color: TEXT_MUTED, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  footerBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  footerBadgeText: { fontSize: 7, fontWeight: "800", letterSpacing: 0.5 },
});
