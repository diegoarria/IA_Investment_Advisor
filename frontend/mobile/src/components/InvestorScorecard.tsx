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

const RT_LABEL: Record<string, string> = {
  conservative: "Conservador", moderate: "Moderado", aggressive: "Agresivo",
};
const KL_LABEL: Record<string, string> = { B: "Básico", C: "Intermedio", D: "Avanzado" };
const Q1_LABELS: Record<string, string> = {
  A: "Vende en caídas", B: "Espera y observa", C: "Analiza fundamentos", D: "Compra las caídas",
};
const GOAL_MAP: Record<string, { label: string; emoji: string }> = {
  house:             { label: "Comprar una casa",         emoji: "🏠" },
  car:               { label: "Comprar un carro",         emoji: "🚗" },
  passive_income:    { label: "Vivir de mis inversiones", emoji: "💸" },
  retirement:        { label: "Retiro / pensión",         emoji: "👴" },
  financial_freedom: { label: "Libertad financiera",      emoji: "🦅" },
  long_term_wealth:  { label: "Patrimonio a largo plazo", emoji: "🏛️" },
};

// ── Dimensions ────────────────────────────────────────────────────────────────
const CARD_W  = 268;
const HERO_H  = 130;
const BAR_W   = CARD_W - 40;
const BG      = "#06070d";
const WHITE   = "#ffffff";
const DIM     = "rgba(255,255,255,0.38)";
const MUTED   = "rgba(255,255,255,0.18)";
const FAINT   = "rgba(255,255,255,0.08)";

// ── SVG helpers ───────────────────────────────────────────────────────────────

function HeroSvg({ color }: { color: string }) {
  return (
    <Svg style={StyleSheet.absoluteFillObject} width={CARD_W} height={HERO_H}>
      <Defs>
        <SvgGrad id="hg" x1="0%" y1="0%" x2="90%" y2="100%">
          <Stop offset="0%"   stopColor={color}   stopOpacity={0.98} />
          <Stop offset="50%"  stopColor={color}   stopOpacity={0.72} />
          <Stop offset="100%" stopColor={BG}      stopOpacity={1}    />
        </SvgGrad>
      </Defs>
      <Rect x="0" y="0" width={CARD_W} height={HERO_H} fill="url(#hg)" />
      {/* Decorative geometry */}
      <Circle cx={CARD_W + 10}   cy={-30}        r={120} fill="rgba(255,255,255,0.07)" />
      <Circle cx={-30}           cy={HERO_H - 10} r={80}  fill="rgba(255,255,255,0.05)" />
      <Circle cx={CARD_W / 2}    cy={HERO_H + 30} r={140} fill="rgba(0,0,0,0.22)"       />
      <Ellipse cx={90} cy={45} rx={70} ry={14}
        fill="rgba(255,255,255,0.11)"
        transform="rotate(-22, 90, 45)" />
      <Ellipse cx={CARD_W - 60} cy={HERO_H - 20} rx={50} ry={8}
        fill="rgba(255,255,255,0.06)"
        transform="rotate(12, 280, 180)" />
    </Svg>
  );
}

function GlobalGlow({ color }: { color: string }) {
  return (
    <Svg style={StyleSheet.absoluteFillObject} width={CARD_W} height={900} pointerEvents="none">
      <Defs>
        <SvgRadial id="glow" cx="50%" cy="28%" r="52%" fx="50%" fy="28%">
          <Stop offset="0%"   stopColor={color} stopOpacity={0.18} />
          <Stop offset="100%" stopColor={color} stopOpacity={0}    />
        </SvgRadial>
      </Defs>
      <Rect x="0" y="0" width={CARD_W} height={900} fill="url(#glow)" />
    </Svg>
  );
}

function GradBar({ pct, color, gid, height = 6 }: { pct: number; color: string; gid: string; height?: number }) {
  const fillW = (Math.min(Math.max(pct, 0), 100) / 100) * BAR_W;
  return (
    <Svg width={BAR_W} height={height}>
      <Defs>
        <SvgGrad id={`t_${gid}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={color} stopOpacity={0.1} />
          <Stop offset="100%" stopColor={color} stopOpacity={0.1} />
        </SvgGrad>
        <SvgGrad id={`f_${gid}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%"   stopColor={color} stopOpacity={0.55} />
          <Stop offset="100%" stopColor={color} stopOpacity={1}    />
        </SvgGrad>
      </Defs>
      <Rect x="0" y="0" width={BAR_W} height={height} rx={height / 2} fill={`url(#t_${gid})`} />
      {fillW > height && <Rect x="0" y="0" width={fillW} height={height} rx={height / 2} fill={`url(#f_${gid})`} />}
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

  // Knowledge level
  const klKey  = profile.knowledge_level as string | undefined;
  const klLabel = klKey && KL_LABEL[klKey] ? KL_LABEL[klKey] : knowledge.label;

  // Comportamiento / Risk behavior
  const rtLabel = RT_LABEL[profile.risk_tolerance] ?? riskCfg.label;

  // Goal
  const goalKey  = profile.investment_goal ?? null;
  const goalInfo = goalKey ? (GOAL_MAP[goalKey] ?? { label: goalKey, emoji: "🎯" }) : null;
  const goalAmt  = profile.investment_goal_amount ? Number(profile.investment_goal_amount) : 0;

  // Horizon
  const horizonYrs = profile.investment_horizon ? parseInt(profile.investment_horizon) : null;

  // Mentalidad from q1
  const mentalidad = qa?.q1 ? Q1_LABELS[qa.q1] : null;

  return (
    <View style={s.card}>
      {/* ── Global color glow ── */}
      <GlobalGlow color={ac} />

      {/* ── HERO BAND ── */}
      <View style={s.heroBand}>
        <HeroSvg color={ac} />

        {/* Brand */}
        <View style={s.brandRow}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.brandLogo} />
          <Text style={s.brandName}>NUVOS AI</Text>
          <View style={{ flex: 1 }} />
          <View style={[s.verifiedPill, { borderColor: "rgba(255,255,255,0.3)", backgroundColor: "rgba(255,255,255,0.1)" }]}>
            <Ionicons name="checkmark-circle" size={10} color="white" />
            <Text style={[s.verifiedText, { color: "white" }]}>VERIFICADO</Text>
          </View>
        </View>
      </View>

      {/* Avatar — outside heroBand so overflow:hidden no lo recorta */}
      <View style={[s.avatarWrap, { top: HERO_H - AVT / 2, left: (CARD_W - AVT) / 2 }]}>
        {profile.avatarUri ? (
          <Image source={{ uri: profile.avatarUri }} style={[s.avatar, { borderColor: WHITE }]} />
        ) : (
          <View style={[s.avatarFallback, { backgroundColor: ac + "55", borderColor: WHITE }]}>
            <Text style={s.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>

      {/* ── IDENTITY ── */}
      <View style={s.identity}>
        <Text style={s.name}>{firstName}</Text>
        {age != null && age > 0 && (
          <Text style={s.ageLine}>{age} años · Inversor</Text>
        )}
        <View style={s.badgeRow}>
          <View style={[s.riskBadge, { backgroundColor: ac + "25", borderColor: ac + "80" }]}>
            <Ionicons name={riskCfg.icon as any} size={11} color={ac} />
            <Text style={[s.riskBadgeText, { color: ac }]}>{riskCfg.label.toUpperCase()}</Text>
          </View>
          {trend !== 0 && (
            <View style={[s.trendBadge, { borderColor: trend > 0 ? "#4ade8088" : "#f8717188" }]}>
              <Text style={[s.trendText, { color: trend > 0 ? "#4ade80" : "#f87171" }]}>
                {trend > 0 ? `▲ +${trend}` : `▼ ${trend}`} puntos
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── META FINANCIERA ── */}
      {goalInfo && (
        <View style={[s.metaBanner, { borderColor: ac + "30", backgroundColor: ac + "0c" }]}>
          <Text style={{ fontSize: 18, lineHeight: 20 }}>{goalInfo.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[s.metaCaption, { color: ac + "99" }]}>META FINANCIERA</Text>
            <Text style={[s.metaLabel, { color: ac }]}>{goalInfo.label}</Text>
          </View>
          {goalAmt > 0 && (
            <Text style={[s.metaAmt, { color: WHITE }]}>${(goalAmt / 1e6).toFixed(1)}M</Text>
          )}
          {horizonYrs != null && horizonYrs > 0 && (
            <View style={[s.horizonBadge, { backgroundColor: ac + "20", borderColor: ac + "45" }]}>
              <Text style={[s.horizonText, { color: ac }]}>{horizonYrs}a</Text>
            </View>
          )}
        </View>
      )}

      {/* ── ACCENT LINE ── */}
      <View style={[s.accentLine, { backgroundColor: ac }]} />

      {/* ── MADUREZ INVERSORA ── */}
      <View style={[s.scoreSection, { backgroundColor: ac + "0d" }]}>
        {/* Ghost number */}
        <Text style={[s.ghost, { color: ml.color }]} pointerEvents="none">
          {maturityScore}
        </Text>

        <Text style={s.sectionCap}>MADUREZ INVERSORA</Text>

        <View style={s.scoreMainRow}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
              <Text style={[s.scoreNum, { color: ml.color }]}>{maturityScore}</Text>
              <Text style={[s.scoreDenom, { color: ml.color + "55" }]}>/100</Text>
            </View>
            <View style={[s.levelPill, { backgroundColor: ml.color + "22", borderColor: ml.color + "60" }]}>
              <Text style={[s.levelPillText, { color: ml.color }]}>{ml.label.toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }} />
          {/* Mini sparkle visual */}
          <View style={[s.maturityRing, { borderColor: ml.color + "50", backgroundColor: ml.color + "12" }]}>
            <Ionicons name="analytics-outline" size={22} color={ml.color} />
          </View>
        </View>

        <View style={{ marginTop: 14 }}>
          <GradBar pct={maturityScore} color={ml.color} gid="mat" height={7} />
        </View>
        <View style={s.barLabels}>
          <Text style={s.barLabel}>NOVATO</Text>
          <Text style={s.barLabel}>EXPERTO</Text>
        </View>
      </View>

      {/* ── ACCENT LINE ── */}
      <View style={[s.accentLine, { backgroundColor: ac + "60", height: 1 }]} />

      {/* ── PERFIL DE RIESGO ── */}
      <View style={s.section}>
        <View style={s.sectionTopRow}>
          <Text style={s.sectionCap}>PERFIL DE RIESGO</Text>
          <Text style={[s.bigPct, { color: ac }]}>{riskPct}%</Text>
        </View>

        <View style={s.riskLabelRow}>
          <View style={[s.riskIconBox, { backgroundColor: ac + "20" }]}>
            <Ionicons name={riskCfg.icon as any} size={14} color={ac} />
          </View>
          <View>
            <Text style={[s.riskLabelText, { color: WHITE }]}>{riskCfg.label}</Text>
            <Text style={[s.riskCaption, { color: ac + "cc" }]}>
              {riskPct < 40 ? "Preservación de capital" : riskPct < 70 ? "Crecimiento balanceado" : "Máximo crecimiento"}
            </Text>
          </View>
        </View>

        <View style={{ marginTop: 8 }}>
          <GradBar pct={riskPct} color={ac} gid="risk" height={7} />
        </View>
        <View style={s.barLabels}>
          <Text style={s.barLabel}>CONSERVADOR</Text>
          <Text style={s.barLabel}>AGRESIVO</Text>
        </View>
      </View>

      {/* ── ADN INVERSOR ── */}
      <View style={[s.section, { borderTopColor: ac + "20" }]}>
        <Text style={s.sectionCap}>ADN INVERSOR</Text>
        <View style={s.dnaGrid}>
          {[
            { icon: "trending-down-outline", label: "MENTALIDAD",    val: mentalidad ?? "—",   color: "#60a5fa" },
            { icon: "school-outline",        label: "CONOCIMIENTO",  val: klLabel,              color: "#a78bfa" },
            { icon: "time-outline",          label: "HORIZONTE",     val: horizonYrs ? `${horizonYrs} años` : "—", color: "#34d399" },
            { icon: "settings-outline",      label: "COMPORTAMIENTO",val: rtLabel,              color: ac        },
          ].map((row) => (
            <View key={row.label} style={[s.dnaCard, { borderColor: row.color + "35", backgroundColor: row.color + "0d" }]}>
              <View style={[s.dnaIconBox, { backgroundColor: row.color + "22" }]}>
                <Ionicons name={row.icon as any} size={13} color={row.color} />
              </View>
              <Text style={[s.dnaCardLabel, { color: row.color + "aa" }]}>{row.label}</Text>
              <Text style={[s.dnaCardVal, { color: WHITE }]} numberOfLines={2}>{row.val}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── MENTOR ── */}
      {mentor && (
        <View style={[s.section, { borderTopColor: ac + "20" }]}>
          <Text style={s.sectionCap}>REFERENTE</Text>
          <View style={[s.mentorRow, { backgroundColor: mentor.color + "10", borderColor: mentor.color + "35" }]}>
            {mentorPhoto ? (
              <Image source={mentorPhoto} style={[s.mentorPhoto, { borderColor: mentor.color + "80" }]} />
            ) : (
              <View style={[s.mentorEmojiBox, { backgroundColor: mentor.color + "22" }]}>
                <Text style={{ fontSize: 22 }}>{mentor.emoji}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.mentorName}>{mentor.name}</Text>
              <Text style={[s.mentorTitle, { color: mentor.color + "bb" }]}>{mentor.title}</Text>
            </View>
            <View style={[s.mentorBadge, { backgroundColor: mentor.color + "20", borderColor: mentor.color + "45" }]}>
              <Text style={[s.mentorBadgeText, { color: mentor.color }]}>{mentor.badge}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── FOOTER ── */}
      <View style={[s.footer, { borderTopColor: ac + "20" }]}>
        <View style={s.footerBrand}>
          <Image source={require("../../assets/images/logo_new.png")} style={s.footerLogo} />
          <Text style={s.footerName}>nuvosai.app</Text>
        </View>
        <View style={[s.verifiedPill, { borderColor: ac + "50", backgroundColor: ac + "15" }]}>
          <Ionicons name="checkmark-circle" size={10} color={ac} />
          <Text style={[s.verifiedText, { color: ac }]}>VERIFICADO</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const AVT = 64;  // avatar diameter

const s = StyleSheet.create({
  card: {
    width: CARD_W,
    backgroundColor: BG,
    borderRadius: 20,
    overflow: "hidden",
  },

  // ── Hero ──
  heroBand: {
    height: HERO_H,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  brandRow: {
    position: "absolute", top: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 13, paddingTop: 10, gap: 5,
    zIndex: 2,
  },
  brandLogo: { width: 11, height: 11, borderRadius: 3 },
  brandName: { color: "rgba(255,255,255,0.95)", fontSize: 8, fontWeight: "900", letterSpacing: 2 },
  avatarWrap: {
    position: "absolute",
    zIndex: 20,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  avatar: { width: AVT, height: AVT, borderRadius: AVT / 2, borderWidth: 2.5 },
  avatarFallback: {
    width: AVT, height: AVT, borderRadius: AVT / 2,
    borderWidth: 2.5,
    alignItems: "center", justifyContent: "center",
  },
  avatarLetter: { color: WHITE, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 },

  // ── Identity ──
  identity: {
    alignItems: "center",
    paddingTop: AVT / 2 + 6, paddingBottom: 10, paddingHorizontal: 16, gap: 3,
  },
  name: { color: WHITE, fontSize: 20, fontWeight: "900", letterSpacing: -0.6, textAlign: "center" },
  ageLine: { color: DIM, fontSize: 9, fontWeight: "600", letterSpacing: 0.3 },
  badgeRow: { flexDirection: "row", gap: 5, marginTop: 3, flexWrap: "wrap", justifyContent: "center" },
  riskBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  riskBadgeText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.6 },
  trendBadge: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3 },
  trendText: { fontSize: 8, fontWeight: "800" },

  // ── Meta banner ──
  metaBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 12, marginBottom: 5,
    borderWidth: 1, borderRadius: 11, padding: 8,
  },
  metaCaption: { fontSize: 6, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginBottom: 1 },
  metaLabel:   { fontSize: 10, fontWeight: "800", letterSpacing: -0.2 },
  metaAmt:     { fontSize: 15, fontWeight: "900", letterSpacing: -0.5 },
  horizonBadge: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 },
  horizonText:  { fontSize: 9, fontWeight: "800" },

  // ── Accent line ──
  accentLine: { height: 2 },

  // ── Score section ──
  scoreSection: {
    paddingHorizontal: 16, paddingTop: 9, paddingBottom: 8,
    overflow: "hidden",
  },
  ghost: {
    position: "absolute", right: -4, top: -4,
    fontSize: 80, fontWeight: "900", opacity: 0.06,
    letterSpacing: -5, lineHeight: 80,
  },
  sectionCap: { color: DIM, fontSize: 6, fontWeight: "900", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 6 },
  scoreMainRow: { flexDirection: "row", alignItems: "center" },
  scoreNum:   { fontSize: 46, fontWeight: "900", letterSpacing: -2.5, lineHeight: 46 },
  scoreDenom: { fontSize: 12, fontWeight: "700", marginBottom: 5 },
  levelPill: {
    alignSelf: "flex-start", borderWidth: 1.5, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 2, marginTop: 4,
  },
  levelPillText: { fontSize: 7, fontWeight: "900", letterSpacing: 0.9 },
  maturityRing: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  barLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  barLabel: { color: MUTED, fontSize: 6, fontWeight: "700", letterSpacing: 0.6 },

  // ── Sections ──
  section: {
    borderTopWidth: 1, borderTopColor: FAINT,
    paddingHorizontal: 16, paddingTop: 7, paddingBottom: 7,
  },
  sectionTopRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6,
  },
  bigPct: { fontSize: 20, fontWeight: "900", letterSpacing: -0.8, lineHeight: 22 },
  riskLabelRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 5 },
  riskIconBox:  { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  riskLabelText: { fontSize: 11, fontWeight: "800", letterSpacing: -0.2, marginBottom: 1 },
  riskCaption:   { fontSize: 7, fontWeight: "600" },

  // ── DNA grid ──
  dnaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  dnaCard: {
    width: (BAR_W - 6) / 2, borderWidth: 1, borderRadius: 10, padding: 8,
  },
  dnaIconBox: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  dnaCardLabel: { fontSize: 6, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase", marginBottom: 2 },
  dnaCardVal:   { fontSize: 10, fontWeight: "800", lineHeight: 13 },

  // ── Mentor ──
  mentorRow: {
    flexDirection: "row", alignItems: "center",
    gap: 8, borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 3,
  },
  mentorPhoto:    { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5 },
  mentorEmojiBox: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  mentorName:     { color: WHITE, fontSize: 11, fontWeight: "800", letterSpacing: -0.2 },
  mentorTitle:    { fontSize: 8, fontWeight: "500", marginTop: 1 },
  mentorBadge:    { borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  mentorBadgeText: { fontSize: 7, fontWeight: "800" },

  // ── Footer ──
  footer: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: 1, paddingHorizontal: 14, paddingVertical: 8,
  },
  footerBrand: { flexDirection: "row", alignItems: "center", gap: 5 },
  footerLogo:  { width: 11, height: 11, borderRadius: 3 },
  footerName:  { color: MUTED, fontSize: 8, fontWeight: "700", letterSpacing: 0.4 },
  verifiedPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  verifiedText: { fontSize: 7, fontWeight: "900", letterSpacing: 0.4 },
});
