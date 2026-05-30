import React from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Svg, {
  Defs,
  LinearGradient as SvgGrad,
  RadialGradient as SvgRadial,
  Stop,
  Rect,
  Circle,
  Ellipse,
} from "react-native-svg";
import { useAppStore, RISK_CONFIG, maturityLabel, knowledgeFromMaturity, getAge } from "../lib/profileStore";
import { getMentorInfo } from "../lib/mentorData";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const Q1_LABELS: Record<string, string> = {
  A: "Vende en caídas", B: "Espera y observa", C: "Analiza fundamentos", D: "Compra las caídas",
};
const Q5_LABELS: Record<string, string> = {
  A: "Pasivo / automático", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria",
};
const TRAIT_COLORS: Record<string, string> = {
  A: "#60a5fa", B: "#34d399", C: "#fbbf24", D: "#f87171",
};

const CARD_W = 270;
const BAR_W  = CARD_W - 40;

// ── SVG helpers ───────────────────────────────────────────────────────────────

function HeroSvg({ color }: { color: string }) {
  return (
    <Svg style={StyleSheet.absoluteFillObject} width={CARD_W} height={140}>
      <Defs>
        <SvgGrad id="hg" x1="0%" y1="0%" x2="100%" y2="110%">
          <Stop offset="0%"   stopColor={color}   stopOpacity={1} />
          <Stop offset="58%"  stopColor={color}   stopOpacity={0.9} />
          <Stop offset="100%" stopColor="#040610" stopOpacity={1} />
        </SvgGrad>
      </Defs>
      <Rect x="0" y="0" width={CARD_W} height={140} fill="url(#hg)" />
      <Circle cx={CARD_W + 5}  cy={-18} r={80}  fill="rgba(255,255,255,0.07)" />
      <Circle cx={-18}         cy={128} r={62}  fill="rgba(255,255,255,0.05)" />
      <Circle cx={CARD_W / 2}  cy={155} r={96}  fill="rgba(0,0,0,0.18)" />
      <Ellipse cx={58} cy={34} rx={48} ry={10}
        fill="rgba(255,255,255,0.09)"
        transform="rotate(-28, 58, 34)" />
    </Svg>
  );
}

function CardBgGlow({ color }: { color: string }) {
  return (
    <Svg style={StyleSheet.absoluteFillObject} width={CARD_W} height={900}>
      <Defs>
        <SvgRadial id="cbg" cx="50%" cy="3%" r="55%" fx="50%" fy="3%">
          <Stop offset="0%"   stopColor={color} stopOpacity={0.22} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </SvgRadial>
      </Defs>
      <Rect x="0" y="0" width={CARD_W} height={900} fill="url(#cbg)" />
    </Svg>
  );
}

function GradBar({ pct, color, gid }: { pct: number; color: string; gid: string }) {
  const fillW = (Math.min(pct, 100) / 100) * BAR_W;
  return (
    <Svg width={BAR_W} height={8}>
      <Defs>
        <SvgGrad id={`t_${gid}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={color} stopOpacity={0.12} />
          <Stop offset="100%" stopColor={color} stopOpacity={0.12} />
        </SvgGrad>
        <SvgGrad id={`f_${gid}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={color} stopOpacity={0.5} />
          <Stop offset="100%" stopColor={color} stopOpacity={1} />
        </SvgGrad>
      </Defs>
      <Rect x="0" y="0" width={BAR_W} height={8} rx={4} fill={`url(#t_${gid})`} />
      {fillW > 4 && <Rect x="0" y="0" width={fillW} height={8} rx={4} fill={`url(#f_${gid})`} />}
    </Svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvestorScorecard() {
  const { profile, maturityScore, maturityHistory } = useAppStore();
  if (!profile) return null;

  const riskCfg     = RISK_CONFIG[profile.risk_tolerance];
  const riskPct     = Math.round(riskCfg.pct * 100);
  const ml          = maturityLabel(maturityScore);
  const knowledge   = knowledgeFromMaturity(maturityScore);
  const trend       = maturityHistory.slice(-10).reduce((a, e) => a + e.delta, 0);
  const mentor      = getMentorInfo(profile.mentor);
  const mentorPhoto = mentor ? MENTOR_PHOTOS[mentor.id] : null;
  const qa          = profile.quiz_answers;
  const age         = profile.birth_date ? getAge(profile.birth_date) : null;
  const firstName   = profile.name.split(" ")[0];
  const ac          = riskCfg.color;

  return (
    <View style={s.card}>
      {/* ─── Card-wide gradient glow ─────────────────────────── */}
      <CardBgGlow color={ac} />

      {/* ─── Hero ────────────────────────────────────────────── */}
      <View style={s.heroBand}>
        <HeroSvg color={ac} />

        <View style={s.brandRow}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.brandLogo} />
          <Text style={s.brandName}>NUVOS AI</Text>
          <Text style={s.brandYear}>2025</Text>
        </View>
      </View>

      {/* ─── Avatar — floats above hero/identity boundary ────── */}
      <View style={s.avatarWrap}>
        {profile.avatarUri ? (
          <Image source={{ uri: profile.avatarUri }} style={s.avatar} />
        ) : (
          <View style={[s.avatarFallback, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
            <Text style={s.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>

      {/* ─── Identity ─────────────────────────────────────────── */}
      <View style={s.identity}>
        <Text style={s.name} numberOfLines={1}>{firstName}</Text>
        {age && <Text style={s.ageLine}>Inversor · {age} años</Text>}
        <View style={s.badgeRow}>
          <View style={[s.riskBadge, { backgroundColor: ac + "22", borderColor: ac + "88" }]}>
            <Ionicons name={riskCfg.icon as any} size={10} color={ac} />
            <Text style={[s.riskBadgeText, { color: ac }]}>{riskCfg.label.toUpperCase()}</Text>
          </View>
          {trend !== 0 && (
            <View style={[s.trendBadge, { borderColor: trend > 0 ? "#4ade80" : "#f87171" }]}>
              <Text style={[s.trendText, { color: trend > 0 ? "#4ade80" : "#f87171" }]}>
                {trend > 0 ? `▲ +${trend}` : `▼ ${trend}`}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ─── Accent divider ──────────────────────────────────── */}
      <View style={[s.dividerLine, { backgroundColor: ac }]} />

      {/* ─── Madurez ─────────────────────────────────────────── */}
      <View style={[s.scoreSection, { backgroundColor: ac + "10" }]}>
        <Text style={[s.ghost, { color: ml.color }]} pointerEvents="none">{maturityScore}</Text>

        <Text style={s.scoreLabel}>MADUREZ INVERSORA</Text>
        <View style={s.scoreRow}>
          <View style={s.scoreNumRow}>
            <Text style={[s.scoreNum, { color: ml.color }]}>{maturityScore}</Text>
            <Text style={[s.scoreDenom, { color: ml.color + "55" }]}>/100</Text>
          </View>
          <View style={[s.levelPill, { backgroundColor: ml.color + "20", borderColor: ml.color + "60" }]}>
            <Text style={[s.levelText, { color: ml.color }]}>{ml.label.toUpperCase()}</Text>
          </View>
        </View>

        <View style={{ marginTop: 12 }}>
          <GradBar pct={maturityScore} color={ml.color} gid="mat" />
        </View>
        <View style={s.barLabels}>
          <Text style={s.barLabel}>NOVATO</Text>
          <Text style={s.barLabel}>EXPERTO</Text>
        </View>
      </View>

      {/* ─── Perfil de riesgo ────────────────────────────────── */}
      <View style={[s.section, { borderTopColor: ac + "22" }]}>
        <View style={s.riskHeader}>
          <Text style={s.sectionLabel}>PERFIL DE RIESGO</Text>
          <Text style={[s.riskPctText, { color: ac }]}>{riskPct}%</Text>
        </View>
        <Text style={[s.riskCaption, { color: ac + "cc" }]}>
          {riskPct < 40 ? "Preservación de capital" : riskPct < 70 ? "Crecimiento balanceado" : "Máximo crecimiento"}
        </Text>
        <GradBar pct={riskPct} color={ac} gid="risk" />
      </View>

      {/* ─── ADN Inversor ─────────────────────────────────────── */}
      {qa && (
        <View style={[s.section, { borderTopColor: ac + "22" }]}>
          <Text style={s.sectionLabel}>ADN INVERSOR</Text>
          <View style={s.dnaChips}>
            {([
              { label: "MENTALIDAD",   val: Q1_LABELS[qa.q1], ans: qa.q1 },
              { label: "CONOCIMIENTO", val: knowledge.label,  ans: knowledge.key },
              { label: "GESTIÓN",      val: Q5_LABELS[qa.q5], ans: qa.q5 },
            ] as const).map((row) => {
              const tc = TRAIT_COLORS[row.ans] ?? ac;
              return (
                <View key={row.label} style={[s.dnaChip, { borderColor: tc + "50", backgroundColor: tc + "12" }]}>
                  <View style={[s.dnaDot, { backgroundColor: tc }]} />
                  <View>
                    <Text style={[s.dnaChipLabel, { color: tc + "aa" }]}>{row.label}</Text>
                    <Text style={[s.dnaChipVal, { color: "#fff" }]} numberOfLines={1}>{row.val}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ─── Mentor / Referente ───────────────────────────────── */}
      {mentor && (
        <View style={[s.section, { borderTopColor: ac + "22" }]}>
          <Text style={s.sectionLabel}>REFERENTE</Text>
          <View style={[s.mentorRow, { backgroundColor: mentor.color + "12", borderColor: mentor.color + "40" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={[s.mentorImg, { borderColor: mentor.color }]} />
            ) : (
              <View style={[s.mentorEmoji, { backgroundColor: mentor.color + "20" }]}>
                <Text style={{ fontSize: 22 }}>{mentor.emoji}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.mentorName}>{mentor.name}</Text>
              <Text style={[s.mentorTitle, { color: mentor.color + "cc" }]}>{mentor.title}</Text>
            </View>
            <View style={[s.mentorBadge, { backgroundColor: mentor.color + "20", borderColor: mentor.color + "45" }]}>
              <Text style={[s.mentorBadgeText, { color: mentor.color }]}>{mentor.badge}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ─── Footer ───────────────────────────────────────────── */}
      <View style={[s.footer, { borderTopColor: ac + "18" }]}>
        <View style={s.footerBrand}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.footerLogo} />
          <Text style={s.footerName}>nuvosai.app</Text>
        </View>
        <View style={[s.verifiedBadge, { backgroundColor: ac + "18", borderColor: ac + "35" }]}>
          <Ionicons name="checkmark-circle" size={9} color={ac} />
          <Text style={[s.verifiedText, { color: ac }]}>VERIFICADO</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const BG    = "#07080f";
const DIM   = "rgba(255,255,255,0.32)";
const MUTED = "rgba(255,255,255,0.16)";
const WHITE = "#ffffff";

const s = StyleSheet.create({
  card: {
    width: CARD_W,
    backgroundColor: BG,
    borderRadius: 22,
    overflow: "hidden",
  },

  // Hero
  heroBand: {
    height: 140,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  brandRow: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingTop: 10, gap: 5,
    zIndex: 2,
  },
  brandLogo: { width: 11, height: 11, borderRadius: 3 },
  brandName: { color: "rgba(255,255,255,0.92)", fontSize: 8, fontWeight: "900", letterSpacing: 2, flex: 1 },
  brandYear: { color: "rgba(255,255,255,0.72)", fontSize: 8, fontWeight: "700" },
  avatarWrap: {
    position: "absolute",
    top: 99,                        // heroHeight(140) - avatarRadius(41) = 99
    left: (CARD_W - 82) / 2,       // horizontally centered
    zIndex: 10,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  avatar: { width: 82, height: 82, borderRadius: 41, borderWidth: 3, borderColor: WHITE },
  avatarFallback: {
    width: 82, height: 82, borderRadius: 41,
    borderWidth: 3, borderColor: WHITE,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { color: WHITE, fontSize: 34, fontWeight: "900" },

  // Identity
  identity: {
    alignItems: "center", paddingTop: 50, paddingBottom: 10, paddingHorizontal: 18, gap: 2,
  },
  name: { color: WHITE, fontSize: 22, fontWeight: "900", letterSpacing: -0.5, textAlign: "center" },
  ageLine: { color: DIM, fontSize: 8, fontWeight: "600", letterSpacing: 0.3 },
  badgeRow: { flexDirection: "row", gap: 5, marginTop: 3, flexWrap: "wrap", justifyContent: "center" },
  riskBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  riskBadgeText: { fontSize: 7, fontWeight: "900", letterSpacing: 0.6 },
  trendBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3 },
  trendText: { fontSize: 7, fontWeight: "800" },

  // Divider
  dividerLine: { height: 2 },

  // Score
  scoreSection: {
    paddingHorizontal: 18, paddingTop: 11, paddingBottom: 11, overflow: "hidden",
  },
  ghost: {
    position: "absolute", right: -4, top: -6,
    fontSize: 112, fontWeight: "900", opacity: 0.07,
    letterSpacing: -7, lineHeight: 112,
  },
  scoreLabel: { color: DIM, fontSize: 7, fontWeight: "900", letterSpacing: 1.8, marginBottom: 3 },
  scoreRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  scoreNumRow: { flexDirection: "row", alignItems: "baseline", gap: 2 },
  scoreNum: { fontSize: 56, fontWeight: "900", letterSpacing: -2, lineHeight: 58 },
  scoreDenom: { fontSize: 14, fontWeight: "700", marginBottom: 5 },
  levelPill: {
    borderWidth: 1.5, borderRadius: 7,
    paddingHorizontal: 7, paddingVertical: 4,
    marginBottom: 5, alignSelf: "flex-end",
  },
  levelText: { fontSize: 7, fontWeight: "900", letterSpacing: 1 },
  barLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  barLabel: { color: MUTED, fontSize: 6, fontWeight: "700", letterSpacing: 1 },

  // Generic section
  section: {
    borderTopWidth: 1, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 8,
  },
  sectionLabel: { color: DIM, fontSize: 6, fontWeight: "900", letterSpacing: 1.8, marginBottom: 6 },

  // Risk
  riskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  riskPctText: { fontSize: 24, fontWeight: "900", letterSpacing: -1, lineHeight: 28 },
  riskCaption: { fontSize: 8, fontWeight: "600", marginBottom: 7, marginTop: 1 },

  // DNA
  dnaChips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  dnaChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 5,
  },
  dnaDot: { width: 5, height: 5, borderRadius: 2.5, flexShrink: 0 },
  dnaChipLabel: { fontSize: 6, fontWeight: "900", letterSpacing: 0.4 },
  dnaChipVal: { fontSize: 9, fontWeight: "700", marginTop: 1 },

  // Mentor
  mentorRow: {
    flexDirection: "row", alignItems: "center",
    gap: 8, borderWidth: 1, borderRadius: 10, padding: 8,
  },
  mentorImg: { width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
  mentorEmoji: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
  },
  mentorName: { color: WHITE, fontSize: 11, fontWeight: "800", letterSpacing: -0.2 },
  mentorTitle: { fontSize: 7, fontWeight: "500", marginTop: 1 },
  mentorBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  mentorBadgeText: { fontSize: 6, fontWeight: "800" },

  // Footer
  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 8,
  },
  footerBrand: { flexDirection: "row", alignItems: "center", gap: 5 },
  footerLogo: { width: 11, height: 11, borderRadius: 3 },
  footerName: { color: MUTED, fontSize: 7, fontWeight: "700", letterSpacing: 0.6 },
  verifiedBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  verifiedText: { fontSize: 6, fontWeight: "900", letterSpacing: 0.4 },
});
