import React, { useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Alert, Modal, ActivityIndicator, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge, maturityLabel } from "../../src/lib/profileStore";
import { getMentorInfo } from "../../src/lib/mentorData";
import InvestorScorecard from "../../src/components/InvestorScorecard";
import { useSubscriptionStore, msgsRemaining, FREE_MSG_LIMIT } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const QUIZ_CATEGORIES = ["Mentalidad", "Horizonte", "Conocimiento", "Riesgo", "Estilo"];
const QUIZ_LABELS: Record<string, Record<string, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera sin actuar", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "Menos de 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
  q5: { A: "Automático / pasivo", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria" },
};
const QUIZ_ICONS: Record<string, string> = {
  q1: "trending-down-outline",
  q2: "time-outline",
  q3: "school-outline",
  q4: "dice-outline",
  q5: "settings-outline",
};
const ANSWER_COLORS: Record<string, string> = {
  A: "#3b82f6", B: "#22c55e", C: "#f59e0b", D: "#ef4444",
};

const RISK_LEVELS = [
  { key: "conservative", label: "Conservador", color: "#3b82f6" },
  { key: "moderate",     label: "Moderado",    color: "#f59e0b" },
  { key: "aggressive",   label: "Agresivo",    color: "#ef4444" },
];

export default function ProfileScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const profile = useAppStore((state) => state.profile);
  const maturityScore = useAppStore((state) => state.maturityScore);
  const maturityHistory = useAppStore((state) => state.maturityHistory);
  const logout = useAppStore((state) => state.logout);

  const setAvatarUri = useAppStore((s) => s.setAvatarUri);

  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galería para cambiar tu foto.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      setAvatarUri(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const subStore = useSubscriptionStore();
  const isPremium = subStore.tier === "premium";
  const remaining = msgsRemaining(subStore);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const handleShare = async () => {
    if (Platform.OS === "web") return;
    setSharing(true);
    try {
      const uri = await captureRef(cardRef, { format: "png", quality: 1 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: "image/png", dialogTitle: "Mi perfil de inversión" });
      }
    } catch {}
    setSharing(false);
  };

  if (!profile) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.empty}>
          <Ionicons name="person-circle-outline" size={60} color={colors.textDim} />
          <Text style={[s.emptyText, { color: colors.textMuted }]}>No hay perfil activo</Text>
        </View>
      </SafeAreaView>
    );
  }

  const riskCfg = RISK_CONFIG[profile.risk_tolerance];
  const age = getAge(profile.birth_date);
  const mentor = getMentorInfo(profile.mentor);
  const maturity = maturityLabel(maturityScore);
  const quizKeys = ["q1", "q2", "q3", "q4", "q5"] as const;

  const msgUsed = isPremium ? 0 : FREE_MSG_LIMIT - (remaining === Infinity ? FREE_MSG_LIMIT : remaining);
  const msgPct = Math.min(msgUsed / FREE_MSG_LIMIT, 1);

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres cerrar sesión?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión", style: "destructive", onPress: async () => {
          logout();
          await SecureStore.deleteItemAsync("access_token").catch(() => {});
          await SecureStore.deleteItemAsync("refresh_token").catch(() => {});
          await SecureStore.deleteItemAsync("user_id").catch(() => {});
          router.replace("/");
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── HERO CARD ── */}
        <View style={[s.heroCard, { borderColor: riskCfg.color + "30" }]}>
          <View style={[s.heroBand, { backgroundColor: riskCfg.color }]} />
          <View style={s.heroAvatarWrap}>
            <View style={[s.heroAvatarRing, { borderColor: colors.bg, backgroundColor: colors.bg }]}>
              {profile.avatarUri ? (
                <Image source={{ uri: profile.avatarUri }} style={s.heroAvatar} />
              ) : (
                <View style={[s.heroAvatar, { backgroundColor: riskCfg.color }]}>
                  <Text style={s.heroAvatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              style={[s.cameraBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={pickPhoto}
            >
              <Ionicons name="camera" size={13} color={colors.accentLight} />
            </TouchableOpacity>
          </View>
          <View style={s.heroBody}>
            <Text style={[s.heroName, { color: colors.text }]}>{profile.name}</Text>
            <View style={s.heroTags}>
              <View style={[s.heroTag, { backgroundColor: riskCfg.color + "18", borderColor: riskCfg.color + "50" }]}>
                <Ionicons name={riskCfg.icon} size={11} color={riskCfg.color} />
                <Text style={[s.heroTagText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
              </View>
              {mentor && (
                <View style={[s.heroTag, { backgroundColor: mentor.color + "18", borderColor: mentor.color + "50" }]}>
                  <Text style={[s.heroTagText, { color: mentor.color }]}>{mentor.name}</Text>
                </View>
              )}
            </View>
          </View>
          <View style={[s.heroActions, { borderTopColor: colors.border }]}>
            <TouchableOpacity style={s.heroActionBtn} onPress={() => router.push("/profile/edit")}>
              <Ionicons name="pencil-outline" size={14} color={colors.textSub} />
              <Text style={[s.heroActionText, { color: colors.textSub }]}>Editar perfil</Text>
            </TouchableOpacity>
            <View style={[s.heroActionSep, { backgroundColor: colors.border }]} />
            <TouchableOpacity style={s.heroActionBtn} onPress={() => setScorecardOpen(true)}>
              <Ionicons name="share-social-outline" size={14} color={colors.accentLight} />
              <Text style={[s.heroActionText, { color: colors.accentLight }]}>Compartir</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── SCORECARD MODAL ── */}
        <Modal visible={scorecardOpen} transparent animationType="fade" onRequestClose={() => setScorecardOpen(false)}>
          <View style={s.modalOverlay}>
            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setScorecardOpen(false)}>
              <Ionicons name="close" size={18} color="white" />
            </TouchableOpacity>
            <View ref={cardRef} collapsable={false}>
              <InvestorScorecard />
            </View>
            <Text style={s.modalHint}>Esta es la imagen que se compartirá</Text>
            {Platform.OS !== "web" && (
              <TouchableOpacity style={[s.modalShareBtn, sharing && { opacity: 0.6 }]} onPress={handleShare} disabled={sharing}>
                {sharing ? <ActivityIndicator color="white" size="small" /> : <Ionicons name="share-social-outline" size={18} color="white" />}
                <Text style={s.modalShareText}>{sharing ? "Generando imagen…" : "Compartir mi perfil"}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Modal>

        {/* ── STATS GRID ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Datos personales</Text>
        <View style={s.statsGrid}>
          <View style={[s.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.statIconBox, { backgroundColor: "#3b82f618" }]}>
              <Ionicons name="person-outline" size={17} color="#3b82f6" />
            </View>
            <Text style={[s.statNum, { color: colors.text }]}>{age}</Text>
            <Text style={[s.statSub, { color: colors.textMuted }]}>años</Text>
          </View>
          <View style={[s.statTile, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.statIconBox, { backgroundColor: "#22c55e18" }]}>
              <Ionicons name="cash-outline" size={17} color="#22c55e" />
            </View>
            <Text style={[s.statNum, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit>
              ${Number(profile.monthly_income).toLocaleString()}
            </Text>
            <Text style={[s.statSub, { color: colors.textMuted }]}>ingresos/mes</Text>
          </View>
          <View style={[s.statTileFull, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[s.statIconBox, { backgroundColor: riskCfg.color + "18" }]}>
              <Ionicons name="trending-up-outline" size={17} color={riskCfg.color} />
            </View>
            <View>
              <Text style={[s.statNum, { color: colors.text }]}>
                ${Number(profile.monthly_contribution).toLocaleString()}
                <Text style={[s.statSub, { color: colors.textMuted }]}> USD</Text>
              </Text>
              <Text style={[s.statSub, { color: colors.textMuted }]}>Aportación mensual</Text>
            </View>
          </View>
        </View>

        {/* ── PERFIL DE RIESGO ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Perfil de riesgo</Text>
        <View style={[s.riskCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "40" }]}>
          <View style={s.riskTopRow}>
            <View style={[s.riskIconBox, { backgroundColor: riskCfg.color + "18" }]}>
              <Ionicons name={riskCfg.icon} size={24} color={riskCfg.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.riskLabel, { color: colors.text }]}>{riskCfg.label}</Text>
              <Text style={[s.riskDesc, { color: colors.textMuted }]}>
                {profile.risk_tolerance === "conservative"
                  ? "Priorizas la seguridad y la preservación del capital."
                  : profile.risk_tolerance === "moderate"
                  ? "Buscas equilibrio entre crecimiento y protección."
                  : "Tu objetivo es el máximo crecimiento a largo plazo."}
              </Text>
            </View>
          </View>
          {/* Segment bar */}
          <View style={s.riskSegments}>
            {RISK_LEVELS.map((level) => {
              const isActive = level.key === profile.risk_tolerance;
              return (
                <View
                  key={level.key}
                  style={[s.riskSegment, {
                    backgroundColor: isActive ? level.color : colors.border,
                    height: isActive ? 8 : 5,
                    shadowColor: isActive ? level.color : "transparent",
                    shadowOpacity: 0.5, shadowRadius: 6,
                  }]}
                />
              );
            })}
          </View>
          <View style={s.riskSegmentLabels}>
            {RISK_LEVELS.map((level) => {
              const isActive = level.key === profile.risk_tolerance;
              return (
                <Text key={level.key} style={[s.riskSegmentLabel, {
                  color: isActive ? level.color : colors.textDim,
                  fontWeight: isActive ? "700" : "400",
                }]}>
                  {level.label}
                </Text>
              );
            })}
          </View>
        </View>

        {/* ── MADUREZ INVERSORA ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Madurez inversora</Text>
        <View style={[s.maturityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.maturityTop}>
            <View>
              <Text style={[s.maturityNum, { color: maturity.color }]}>
                {maturityScore}
                <Text style={[s.maturitySlash, { color: colors.textMuted }]}>/100</Text>
              </Text>
              <View style={[s.maturityBadge, { backgroundColor: maturity.color + "18", borderColor: maturity.color + "40" }]}>
                <Text style={[s.maturityBadgeText, { color: maturity.color }]}>{maturity.label}</Text>
              </View>
            </View>
            <View style={[s.maturityCircle, { borderColor: maturity.color + "40", backgroundColor: maturity.color + "0e" }]}>
              <Ionicons name="analytics-outline" size={28} color={maturity.color} />
            </View>
          </View>
          <View style={[s.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[s.progressFill, { width: `${maturityScore}%` as any, backgroundColor: maturity.color }]} />
          </View>
          <View style={s.progressLabels}>
            <Text style={[s.progressLabel, { color: colors.textDim }]}>Pasivo</Text>
            <Text style={[s.progressLabel, { color: colors.textDim }]}>Racional</Text>
            <Text style={[s.progressLabel, { color: colors.textDim }]}>Especulativo</Text>
          </View>

          {maturityHistory.length > 0 && (
            <>
              <View style={[s.divider, { borderTopColor: colors.border }]} />
              <Text style={[s.histTitle, { color: colors.textMuted }]}>Últimas señales detectadas</Text>
              {maturityHistory.slice(-5).reverse().map((ev, i) => (
                <View key={i} style={[s.histRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <View style={[s.histDelta, { backgroundColor: ev.delta >= 0 ? "#22c55e18" : "#ef444418" }]}>
                    <Text style={[s.histDeltaText, { color: ev.delta >= 0 ? "#22c55e" : "#ef4444" }]}>
                      {ev.delta >= 0 ? "+" : ""}{ev.delta}
                    </Text>
                  </View>
                  <Text style={[s.histSig, { color: colors.textSub }]} numberOfLines={1}>
                    {ev.signals.map((sig) => sig.replace(/_/g, " ")).join(", ")}
                  </Text>
                  <Text style={[s.histScore, { color: colors.textMuted }]}>{ev.newScore}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* ── MENTOR ── */}
        {mentor && (
          <>
            <Text style={[s.sectionLabel, { color: colors.textDim }]}>Tu mentor</Text>
            <View style={[s.mentorCard, { borderColor: mentor.color + "40" }]}>
              <View style={[s.mentorBand, { backgroundColor: mentor.color + "12" }]}>
                {MENTOR_PHOTOS[mentor.id] ? (
                  <Image source={MENTOR_PHOTOS[mentor.id]} style={s.mentorPhoto} />
                ) : (
                  <View style={[s.mentorEmojiBox, { backgroundColor: mentor.color + "22" }]}>
                    <Text style={s.mentorEmoji}>{mentor.emoji}</Text>
                  </View>
                )}
                <View style={s.mentorInfo}>
                  <Text style={[s.mentorName, { color: colors.text }]}>{mentor.name}</Text>
                  <Text style={[s.mentorTitle, { color: colors.textMuted }]}>{mentor.title}</Text>
                  <View style={[s.mentorBadgeWrap, { backgroundColor: mentor.color + "22", borderColor: mentor.color + "40" }]}>
                    <Text style={[s.mentorBadgeText, { color: mentor.color }]}>{mentor.badge}</Text>
                  </View>
                </View>
              </View>
              <View style={[s.mentorPrinciples, { backgroundColor: colors.card }]}>
                {mentor.principles.map((p, i) => (
                  <View key={i} style={[s.principlePill, { borderColor: mentor.color + "30", backgroundColor: mentor.color + "0a" }]}>
                    <View style={[s.principleDot, { backgroundColor: mentor.color }]} />
                    <Text style={[s.principleText, { color: colors.textSub }]}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {/* ── PERFIL PSICOLÓGICO ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Perfil psicológico</Text>
        <View style={[s.quizCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {quizKeys.map((key, i) => {
            const answer = profile.quiz_answers?.[key];
            const aColor = answer ? (ANSWER_COLORS[answer] ?? colors.accentLight) : colors.textDim;
            return (
              <View
                key={key}
                style={[s.quizRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <View style={[s.quizIconBox, { backgroundColor: aColor + "15" }]}>
                  <Ionicons name={QUIZ_ICONS[key] as any} size={14} color={aColor} />
                </View>
                <View style={s.quizMid}>
                  <Text style={[s.quizCat, { color: colors.textDim }]}>{QUIZ_CATEGORIES[i]}</Text>
                  <Text style={[s.quizAnswer, { color: colors.text }]}>{answer ? QUIZ_LABELS[key][answer] : "—"}</Text>
                </View>
                {answer && (
                  <View style={[s.quizBadge, { backgroundColor: aColor }]}>
                    <Text style={s.quizBadgeText}>{answer}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* ── SUSCRIPCIÓN ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Suscripción</Text>
        {isPremium ? (
          <View style={[s.subCard, { backgroundColor: colors.card, borderColor: "#f59e0b50" }]}>
            <View style={[s.subAccent, { backgroundColor: "#f59e0b" }]} />
            <View style={s.subRow}>
              <View style={[s.subIconBox, { backgroundColor: "#f59e0b18" }]}>
                <Ionicons name="star" size={22} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.subTitle, { color: colors.text }]}>Nuvos AI Premium</Text>
                <Text style={[s.subDesc, { color: colors.textMuted }]}>Acceso completo · Mensajes ilimitados</Text>
              </View>
              <View style={[s.subActivePill, { backgroundColor: "#22c55e18", borderColor: "#22c55e40" }]}>
                <View style={[s.subActiveDot, { backgroundColor: "#22c55e" }]} />
                <Text style={[s.subActiveTxt, { color: "#22c55e" }]}>Activo</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={[s.subCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.subRow}>
              <View style={[s.subIconBox, { backgroundColor: colors.accentGlow ?? colors.border }]}>
                <Ionicons name="person-outline" size={20} color={colors.accentLight} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.subTitle, { color: colors.text }]}>Plan Gratis</Text>
                <Text style={[s.subDesc, { color: colors.textMuted }]}>
                  {remaining === Infinity ? FREE_MSG_LIMIT : remaining}/{FREE_MSG_LIMIT} mensajes hoy
                </Text>
              </View>
            </View>
            <View style={[s.msgTrack, { backgroundColor: colors.border }]}>
              <View style={[s.msgFill, {
                width: `${Math.round(msgPct * 100)}%` as any,
                backgroundColor: msgPct > 0.8 ? "#ef4444" : "#22c55e",
              }]} />
            </View>
            <TouchableOpacity style={s.upgradeBtn} onPress={() => setPaywallOpen(true)}>
              <Ionicons name="star" size={15} color="white" />
              <Text style={s.upgradeBtnText}>Activar Premium — $11.99/mes</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── LOGOUT ── */}
        <TouchableOpacity
          style={[s.logoutBtn, { borderColor: "#ef444435", backgroundColor: "#ef44440a" }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={17} color="#ef4444" />
          <Text style={s.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>

      </ScrollView>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 52, gap: 4 },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    emptyText: { fontSize: 15 },

    sectionLabel: {
      fontSize: 10, fontWeight: "700", letterSpacing: 1.2,
      textTransform: "uppercase", marginTop: 20, marginBottom: 8, marginLeft: 2,
    },

    // ── Hero card ──
    heroCard: {
      borderRadius: 22, borderWidth: 1, overflow: "hidden",
      backgroundColor: c.card,
      shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    },
    heroBand: { height: 80 },
    heroAvatarWrap: { alignItems: "center", marginTop: -42 },
    heroAvatarRing: { width: 88, height: 88, borderRadius: 44, borderWidth: 4, alignItems: "center", justifyContent: "center" },
    heroAvatar: { width: 76, height: 76, borderRadius: 38, alignItems: "center", justifyContent: "center" },
    heroAvatarLetter: { color: "white", fontSize: 32, fontWeight: "900", letterSpacing: -1 },
    heroBody: { alignItems: "center", paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 10 },
    heroName: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5 },
    heroTags: { flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" },
    heroTag: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
    heroTagText: { fontSize: 11, fontWeight: "700" },
    cameraBtn: {
      position: "absolute", bottom: 0, right: 0,
      width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
      alignItems: "center", justifyContent: "center",
    },
    heroActions: {
      flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth,
    },
    heroActionBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, paddingVertical: 13,
    },
    heroActionSep: { width: StyleSheet.hairlineWidth, marginVertical: 10 },
    heroActionText: { fontSize: 13, fontWeight: "600" },
    // keep old share styles in case they're referenced elsewhere
    heroShare: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth,
    },
    heroShareText: { fontSize: 13, fontWeight: "600" },

    // ── Stats grid ──
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    statTile: {
      flex: 1, minWidth: 130,
      borderRadius: 18, borderWidth: 1, padding: 14, gap: 4,
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    statTileFull: {
      flexBasis: "100%",
      borderRadius: 18, borderWidth: 1, padding: 14,
      flexDirection: "row", alignItems: "center", gap: 14,
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    statIconBox: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 4 },
    statNum: { fontSize: 24, fontWeight: "800", letterSpacing: -0.5, lineHeight: 28 },
    statSub: { fontSize: 11, fontWeight: "500" },

    // ── Risk card ──
    riskCard: {
      borderRadius: 20, borderWidth: 1.5, padding: 16, gap: 0,
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
    },
    riskTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 18 },
    riskIconBox: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
    riskLabel: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3, marginBottom: 5 },
    riskDesc: { fontSize: 12, lineHeight: 17 },
    riskSegments: { flexDirection: "row", gap: 5, marginBottom: 7, alignItems: "center" },
    riskSegment: { flex: 1, borderRadius: 4 },
    riskSegmentLabels: { flexDirection: "row" },
    riskSegmentLabel: { flex: 1, fontSize: 9, letterSpacing: 0.3, textAlign: "center" },

    // ── Maturity card ──
    maturityCard: {
      borderRadius: 20, borderWidth: 1, padding: 16,
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    maturityTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    maturityNum: { fontSize: 48, fontWeight: "900", letterSpacing: -2, lineHeight: 52 },
    maturitySlash: { fontSize: 20, fontWeight: "400", letterSpacing: 0 },
    maturityBadge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5, marginTop: 8 },
    maturityBadgeText: { fontSize: 11, fontWeight: "700" },
    maturityCircle: {
      width: 62, height: 62, borderRadius: 31, borderWidth: 1.5,
      alignItems: "center", justifyContent: "center",
    },
    progressTrack: { height: 7, borderRadius: 4, overflow: "hidden", marginBottom: 6 },
    progressFill: { height: "100%", borderRadius: 4 },
    progressLabels: { flexDirection: "row", justifyContent: "space-between" },
    progressLabel: { fontSize: 9, letterSpacing: 0.3 },

    divider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 14, marginBottom: 10 },
    histTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
    histRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7 },
    histDelta: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, minWidth: 42, alignItems: "center" },
    histDeltaText: { fontSize: 12, fontWeight: "800" },
    histSig: { flex: 1, fontSize: 11 },
    histScore: { fontSize: 12, fontWeight: "600" },

    // ── Mentor card ──
    mentorCard: { borderRadius: 20, borderWidth: 1.5, overflow: "hidden" },
    mentorBand: { flexDirection: "row", gap: 14, alignItems: "center", padding: 16 },
    mentorPhoto: { width: 70, height: 70, borderRadius: 35 },
    mentorEmojiBox: { width: 70, height: 70, borderRadius: 35, alignItems: "center", justifyContent: "center" },
    mentorEmoji: { fontSize: 34 },
    mentorInfo: { flex: 1, gap: 5 },
    mentorName: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
    mentorTitle: { fontSize: 12 },
    mentorBadgeWrap: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    mentorBadgeText: { fontSize: 10, fontWeight: "700" },
    mentorPrinciples: { padding: 14, gap: 8 },
    principlePill: {
      flexDirection: "row", alignItems: "center", gap: 10,
      borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
    },
    principleDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
    principleText: { fontSize: 13, flex: 1, lineHeight: 18 },

    // ── Quiz card ──
    quizCard: {
      borderRadius: 20, borderWidth: 1, overflow: "hidden",
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    quizRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 14 },
    quizIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    quizMid: { flex: 1, gap: 2 },
    quizCat: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
    quizAnswer: { fontSize: 13, fontWeight: "600" },
    quizBadge: {
      width: 30, height: 30, borderRadius: 15,
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    quizBadgeText: { color: "white", fontSize: 13, fontWeight: "900" },

    // ── Subscription ──
    subCard: {
      borderRadius: 20, borderWidth: 1, overflow: "hidden",
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    subAccent: { height: 3 },
    subRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    subIconBox: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
    subTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
    subDesc: { fontSize: 12, marginTop: 2 },
    subActivePill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
    subActiveDot: { width: 6, height: 6, borderRadius: 3 },
    subActiveTxt: { fontSize: 11, fontWeight: "700" },
    msgTrack: { height: 5, borderRadius: 3, overflow: "hidden", marginHorizontal: 16, marginBottom: 12 },
    msgFill: { height: "100%", borderRadius: 3 },
    upgradeBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "#f59e0b", marginHorizontal: 14, marginBottom: 14,
      borderRadius: 14, paddingVertical: 14,
      shadowColor: "#f59e0b", shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    },
    upgradeBtnText: { color: "white", fontWeight: "800", fontSize: 14 },

    // ── Logout ──
    logoutBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      borderWidth: 1, borderRadius: 14, paddingVertical: 14, marginTop: 20,
    },
    logoutText: { color: "#ef4444", fontWeight: "600", fontSize: 14 },

    // ── Modal ──
    modalOverlay: {
      flex: 1, backgroundColor: "rgba(0,0,0,0.82)",
      alignItems: "center", justifyContent: "center",
      gap: 16, paddingHorizontal: 20, paddingVertical: 40,
    },
    modalCloseBtn: {
      position: "absolute", top: 52, right: 20,
      width: 34, height: 34, borderRadius: 17,
      backgroundColor: "rgba(255,255,255,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    modalHint: { color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: "500" },
    modalShareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "#16a34a", borderRadius: 14, paddingVertical: 15, width: 320,
    },
    modalShareText: { color: "white", fontWeight: "700", fontSize: 15 },
  });
}
