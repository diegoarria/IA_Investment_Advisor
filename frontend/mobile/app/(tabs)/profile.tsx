import React, { useMemo, useRef, useState, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Alert, Modal, ActivityIndicator, Platform, Linking, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import * as ImagePicker from "expo-image-picker";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge, maturityLabel, knowledgeFromMaturity } from "../../src/lib/profileStore";
import { getMentorInfo } from "../../src/lib/mentorData";
import InvestorScorecard from "../../src/components/InvestorScorecard";
import ProgressModal from "../../src/components/ProgressModal";
import TutorialModal from "../../src/components/TutorialModal";
import { insightsApi, mentorLetterApi, profileApi, authApi, referralApi } from "../../src/lib/api";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const QUIZ_CATEGORIES = ["Mentalidad", "Horizonte", "Conocimiento", "Riesgo", "Estilo"];
const QUIZ_LABELS: Record<string, Record<string, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera sin actuar", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "Menos de 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Básico", B: "Básico", C: "Intermedio", D: "Avanzado" },
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

// ─── Mentor Letter Card ────────────────────────────────────────────────────────

function MentorLetterCard({ mentor, colors }: { mentor: ReturnType<typeof getMentorInfo>; colors: any }) {
  const [letter, setLetter] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState(false);

  const load = async () => {
    if (letter) { setOpen(true); return; }
    setLoading(true); setError(false);
    try {
      const res = await mentorLetterApi.get();
      setLetter(res.data.letter ?? null);
      setOpen(true);
    } catch { setError(true); }
    setLoading(false);
  };

  if (!mentor) return null;
  const mc = mentor.color;

  return (
    <>
      <TouchableOpacity
        style={[{ borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: mc + "0a", borderColor: mc + "35" }]}
        onPress={load}
        activeOpacity={0.75}
      >
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: mc + "20", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name="mail-outline" size={20} color={mc} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 14, fontWeight: "700" }}>Carta de {mentor.name.split(" ")[0]}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>Tu carta mensual personalizada</Text>
        </View>
        {loading
          ? <ActivityIndicator size="small" color={mc} />
          : <Ionicons name="chevron-forward" size={16} color={mc} />}
      </TouchableOpacity>

      {error && <Text style={{ color: "#ef4444", fontSize: 11, textAlign: "center", marginTop: 4 }}>No se pudo cargar la carta. Intenta más tarde.</Text>}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: mc + "0f", borderColor: mc + "40", borderWidth: 1, borderRadius: 24, padding: 24, width: "100%", gap: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: mc, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 }}>{mentor.name.toUpperCase()}</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={20} color={mc} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: colors.text, fontSize: 15, lineHeight: 24, fontStyle: "italic" }}>
                {letter}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── Profile Screen ────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const profile = useAppStore((state) => state.profile);
  const maturityScore = useAppStore((state) => state.maturityScore);
  const maturityHistory = useAppStore((state) => state.maturityHistory);
  const logout = useAppStore((state) => state.logout);

  const setProfile = useAppStore((s) => s.setProfile);
  const setAvatarUri = useAppStore((s) => s.setAvatarUri);

  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

  const [insights, setInsights] = useState<{ ready: boolean; topics?: string[]; risk_behavior?: string; risk_match?: boolean; risk_note?: string; suggestion?: string; interests?: string[] } | null>(null);
  useEffect(() => {
    insightsApi.get().then((r) => setInsights(r.data)).catch(() => {});
    referralApi.getCode().then((r) => setReferralCode(r.data.code ?? null)).catch(() => {});
    referralApi.getStats().then((r) => setReferralStats(r.data)).catch(() => {});
  }, []);

  const [avatarUploading, setAvatarUploading] = useState(false);

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permiso requerido", "Necesitamos acceso a tu galería para cambiar tu foto.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (result.canceled || !result.assets[0].base64) return;

    // Mostrar la foto inmediatamente (optimista)
    const localUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
    setAvatarUri(localUri);

    // Subir al backend en background para persistencia permanente
    setAvatarUploading(true);
    try {
      const res = await profileApi.uploadAvatar(result.assets[0].base64);
      setAvatarUri(res.data.avatar_url);
    } catch {
      // La foto local sigue visible aunque falle el upload
    } finally {
      setAvatarUploading(false);
    }
  };

  const removePhoto = () => {
    Alert.alert("Eliminar foto", "¿Seguro que quieres quitar tu foto de perfil?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar", style: "destructive",
        onPress: async () => {
          setAvatarUri(null);
          try { await profileApi.deleteAvatar(); } catch {}
        },
      },
    ]);
  };

  const [riskExpanded, setRiskExpanded] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<{ referred_count: number; pending_reward: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [tutorialFromProfile, setTutorialFromProfile] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);

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
  const age = getAge(profile.birth_date ?? "");
  const mentor = getMentorInfo(profile.mentor);
  const maturity = maturityLabel(maturityScore);
  const knowledge = knowledgeFromMaturity(maturityScore);
  const quizKeys = ["q1", "q2", "q3", "q4", "q5"] as const;

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Seguro que quieres cerrar sesión?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión", style: "destructive", onPress: () => {
          logout();
          router.replace("/");
          SecureStore.deleteItemAsync("access_token").catch(() => {});
          SecureStore.deleteItemAsync("refresh_token").catch(() => {});
          SecureStore.deleteItemAsync("user_id").catch(() => {});
        },
      },
    ]);
  };

  const handleLevelChange = async (q3Key: string) => {
    if (!profile) return;
    setSavingLevel(true);
    try {
      const updated = { ...profile, quiz_answers: { ...profile.quiz_answers, q3: q3Key as import("../../src/lib/profileStore").QuizAnswer } };
      await profileApi.update({ quiz_answers: updated.quiz_answers });
      setProfile(updated);
    } catch {}
    setSavingLevel(false);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Eliminar cuenta",
      "Esta acción es permanente. Se borrarán todos tus datos, portafolio, historial y suscripción. No se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar mi cuenta", style: "destructive",
          onPress: () => {
            Alert.alert(
              "¿Estás seguro?",
              "Se eliminará tu cuenta y todos tus datos de forma permanente.",
              [
                { text: "Cancelar", style: "cancel" },
                {
                  text: "Sí, eliminar", style: "destructive",
                  onPress: async () => {
                    try {
                      await authApi.deleteAccount();
                    } catch { /* best-effort */ }
                    logout();
                    SecureStore.deleteItemAsync("access_token").catch(() => {});
                    SecureStore.deleteItemAsync("refresh_token").catch(() => {});
                    SecureStore.deleteItemAsync("user_id").catch(() => {});
                    router.replace("/");
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── HERO CARD ── */}
        <View style={[s.heroCard, { borderColor: riskCfg.color + "30" }]}>
          <View style={[s.heroBand, { backgroundColor: riskCfg.color }]} />
          <View style={s.heroAvatarWrap}>
            <View style={[s.heroAvatarRing, { borderColor: colors.bg, backgroundColor: colors.bg }]}>
              {avatarUploading ? (
                <View style={[s.heroAvatar, { backgroundColor: riskCfg.color, alignItems: "center", justifyContent: "center" }]}>
                  <ActivityIndicator color="white" size="small" />
                </View>
              ) : profile.avatarUri ? (
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
              disabled={avatarUploading}
            >
              <Ionicons name="camera" size={13} color={colors.accentLight} />
            </TouchableOpacity>
            {profile.avatarUri && !avatarUploading && (
              <TouchableOpacity
                style={[s.cameraBtn, { backgroundColor: colors.card, borderColor: "#ef444440", marginTop: 4 }]}
                onPress={removePhoto}
              >
                <Ionicons name="trash-outline" size={13} color="#ef4444" />
              </TouchableOpacity>
            )}
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
            <View style={{ position: "relative" }}>
              <View ref={cardRef} collapsable={false}>
                <InvestorScorecard />
              </View>
              <TouchableOpacity style={s.modalCloseBtn} onPress={() => setScorecardOpen(false)}>
                <Ionicons name="close" size={18} color="white" />
              </TouchableOpacity>
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

        {/* ── AI INSIGHTS ── */}
        {insights?.ready && (
          <View style={[s.insightCard, { backgroundColor: insights.risk_match === false ? "#f59e0b0a" : colors.card, borderColor: insights.risk_match === false ? "#f59e0b40" : "#22c55e40" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Text style={{ fontSize: 18 }}>🧠</Text>
              <Text style={[s.sectionLabel, { color: colors.text, marginBottom: 0 }]}>La IA te ha analizado</Text>
            </View>
            {insights.risk_match === false && insights.risk_note && (
              <View style={{ backgroundColor: "#f59e0b15", borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: "#f59e0b30" }}>
                <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "700", marginBottom: 3 }}>⚠️ Tu comportamiento real difiere de tu perfil</Text>
                <Text style={{ color: colors.textSub, fontSize: 12, lineHeight: 18 }}>{insights.risk_note}</Text>
              </View>
            )}
            {insights.suggestion && (
              <Text style={{ color: colors.textSub, fontSize: 13, lineHeight: 20, marginBottom: 10 }}>{insights.suggestion}</Text>
            )}
            {insights.topics && insights.topics.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {insights.topics.map((t) => (
                  <View key={t} style={{ backgroundColor: "#22c55e15", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "#22c55e30" }}>
                    <Text style={{ color: "#22c55e", fontSize: 11, fontWeight: "600" }}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

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
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => setRiskExpanded((v) => !v)}
          style={[s.riskCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "40" }]}
        >
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
            <Ionicons
              name={riskExpanded ? "chevron-up" : "chevron-down"}
              size={16} color={colors.textDim}
            />
          </View>

          {/* Segment bar */}
          <View style={s.riskSegments}>
            {RISK_LEVELS.map((level) => {
              const isActive = level.key === profile.risk_tolerance;
              return (
                <View key={level.key} style={[s.riskSegment, {
                  backgroundColor: isActive ? level.color : colors.border,
                  height: isActive ? 8 : 5,
                  shadowColor: isActive ? level.color : "transparent",
                  shadowOpacity: 0.5, shadowRadius: 6,
                }]} />
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

          {/* Mini resumen expandible */}
          {riskExpanded && (
            <View style={{ marginTop: 14, gap: 10, borderTopWidth: 1, borderTopColor: riskCfg.color + "25", paddingTop: 14 }}>
              {/* Distribución */}
              <View style={{ gap: 6 }}>
                {(profile.risk_tolerance === "conservative"
                  ? [{ label: "Renta fija / Bonos", pct: 60, color: "#3b82f6" }, { label: "Acciones defensivas", pct: 30, color: "#22c55e" }, { label: "Liquidez / Oro", pct: 10, color: "#f59e0b" }]
                  : profile.risk_tolerance === "moderate"
                  ? [{ label: "Acciones diversificadas", pct: 60, color: "#22c55e" }, { label: "Renta fija", pct: 30, color: "#3b82f6" }, { label: "Alternativos / REITs", pct: 10, color: "#a855f7" }]
                  : [{ label: "Acciones de crecimiento", pct: 75, color: "#22c55e" }, { label: "Mercados emergentes", pct: 15, color: "#f59e0b" }, { label: "Renta fija mínima", pct: 10, color: "#3b82f6" }]
                ).map((item) => (
                  <View key={item.label}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                      <Text style={{ color: colors.textSub, fontSize: 11 }}>{item.label}</Text>
                      <Text style={{ color: item.color, fontSize: 11, fontWeight: "700" }}>{item.pct}%</Text>
                    </View>
                    <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
                      <View style={{ width: `${item.pct}%` as any, height: 4, backgroundColor: item.color, borderRadius: 2 }} />
                    </View>
                  </View>
                ))}
              </View>

              {/* Datos clave */}
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(profile.risk_tolerance === "conservative"
                  ? [{ label: "Volatilidad", val: "Baja" }, { label: "Retorno esperado", val: "4–7% anual" }, { label: "Horizonte ideal", val: "1–5 años" }]
                  : profile.risk_tolerance === "moderate"
                  ? [{ label: "Volatilidad", val: "Media" }, { label: "Retorno esperado", val: "7–10% anual" }, { label: "Horizonte ideal", val: "5–10 años" }]
                  : [{ label: "Volatilidad", val: "Alta" }, { label: "Retorno esperado", val: "10–15%+ anual" }, { label: "Horizonte ideal", val: "10+ años" }]
                ).map((item) => (
                  <View key={item.label} style={{ flex: 1, backgroundColor: riskCfg.color + "10", borderRadius: 10, padding: 8, alignItems: "center" }}>
                    <Text style={{ color: colors.textMuted, fontSize: 9, fontWeight: "600", textAlign: "center" }}>{item.label}</Text>
                    <Text style={{ color: riskCfg.color, fontSize: 12, fontWeight: "800", marginTop: 2, textAlign: "center" }}>{item.val}</Text>
                  </View>
                ))}
              </View>

              {/* ETFs típicos */}
              <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                <Text style={{ fontWeight: "700", color: colors.textSub }}>ETFs típicos: </Text>
                {profile.risk_tolerance === "conservative"
                  ? "BND, AGG, SCHD, VTIP, SGOV, GLD"
                  : profile.risk_tolerance === "moderate"
                  ? "VTI, VEA, BND, QQQ, VNQ, SCHD"
                  : "QQQ, VTI, VGT, SOXX, VWO, ARKK"}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── MADUREZ INVERSORA ── */}
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 20, marginBottom: 8, marginLeft: 2 }}>
          <Text style={[s.sectionLabel, { color: colors.textDim, marginTop: 0, marginBottom: 0 }]}>MADUREZ INVERSORA</Text>
          <Text style={{ color: colors.textDim, fontSize: 9, fontStyle: "italic" }}>comportamiento en la app</Text>
        </View>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setProgressOpen(true)}
          style={[s.maturityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
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
          <Text style={{ color: colors.textDim, fontSize: 10, marginTop: 8, lineHeight: 14 }}>
            Sube con cada buena decisión en la app (mantener calma, diversificar, largo plazo). No refleja tu nivel de conocimiento declarado.
          </Text>

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
        </TouchableOpacity>

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

        {/* ── CARTA DEL MENTOR ── */}
        {mentor && <MentorLetterCard mentor={mentor} colors={colors} />}

        {/* ── NIVEL DE CONOCIMIENTO ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Nivel de conocimiento</Text>
        <View style={[s.levelCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { key: "A", label: "Principiante", emoji: "🌱", desc: "Nunca he invertido",           color: "#3b82f6" },
            { key: "B", label: "Básico",       emoji: "📚", desc: "Conozco lo básico",            color: "#22c55e" },
            { key: "C", label: "Intermedio",   emoji: "📈", desc: "Leo estados financieros",       color: "#f59e0b" },
            { key: "D", label: "Avanzado",     emoji: "⚡", desc: "Análisis profundo",            color: "#ef4444" },
          ].map((opt, i) => {
            const isActive = profile.quiz_answers?.q3 === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  s.levelOption,
                  { borderColor: isActive ? opt.color : colors.border, backgroundColor: isActive ? opt.color + "12" : colors.bgRaised },
                  i % 2 === 0 && { marginRight: 6 },
                ]}
                onPress={() => handleLevelChange(opt.key)}
                disabled={savingLevel}
                activeOpacity={0.75}
              >
                <Text style={{ fontSize: 20, marginBottom: 4 }}>{opt.emoji}</Text>
                <Text style={[s.levelOptLabel, { color: isActive ? opt.color : colors.text }]}>{opt.label}</Text>
                <Text style={[s.levelOptDesc, { color: colors.textMuted }]}>{opt.desc}</Text>
              </TouchableOpacity>
            );
          })}
          {savingLevel && (
            <Text style={[s.levelSaving, { color: colors.textMuted }]}>Guardando…</Text>
          )}
        </View>

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
                  <Text style={[s.quizAnswer, { color: colors.text }]}>
                    {key === "q3" ? knowledge.label : answer ? QUIZ_LABELS[key][answer] : "—"}
                  </Text>
                </View>
                {answer && (
                  <View style={[s.quizBadge, { backgroundColor: aColor }]}>
                    <Text style={s.quizBadgeText}>{key === "q3" ? knowledge.key : answer}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>


        {/* ── REFERIDOS ── */}
        <Text style={[s.sectionLabel, { color: colors.textDim }]}>Programa de referidos</Text>
        <View style={[s.referralCard, { backgroundColor: colors.card, borderColor: "#f59e0b50" }]}>
          {/* Header */}
          <View style={[s.referralHeader, { backgroundColor: "#f59e0b0a", borderBottomColor: colors.border }]}>
            <View style={[s.referralIconBox, { backgroundColor: "#f59e0b18" }]}>
              <Ionicons name="gift-outline" size={22} color="#f59e0b" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.referralTitle, { color: colors.text }]}>Invita amigos, gana recompensas</Text>
              <Text style={[s.referralSub, { color: colors.textMuted }]}>1 mes Premium gratis por cada amigo que se una</Text>
            </View>
          </View>

          {/* Stats */}
          {referralStats && (
            <View style={[s.referralStats, { borderBottomColor: colors.border }]}>
              <View style={s.referralStat}>
                <Text style={[s.referralStatNum, { color: "#f59e0b" }]}>{referralStats.referred_count}</Text>
                <Text style={[s.referralStatLabel, { color: colors.textMuted }]}>Amigos referidos</Text>
              </View>
              <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 }} />
              <View style={s.referralStat}>
                <Text style={[s.referralStatNum, { color: "#22c55e" }]}>{referralStats.pending_reward || "—"}</Text>
                <Text style={[s.referralStatLabel, { color: colors.textMuted }]}>Recompensa pendiente</Text>
              </View>
            </View>
          )}

          {/* Link + botones */}
          <View style={{ padding: 14, gap: 10 }}>
            {/* Link row */}
            <View style={[s.referralLinkRow, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <Text style={[s.referralLink, { color: colors.textSub }]} numberOfLines={1}>
                {referralCode ? `nuvosai.com/join?ref=${referralCode}` : "Cargando..."}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  if (!referralCode) return;
                  Share.share({ message: `https://nuvosai.com/join?ref=${referralCode}` });
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name={copiedLink ? "checkmark" : "copy-outline"} size={16} color={copiedLink ? "#22c55e" : colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Share button */}
            <TouchableOpacity
              style={[s.referralShareBtn, { backgroundColor: "#f59e0b15", borderColor: "#f59e0b40" }]}
              onPress={() => {
                if (!referralCode) return;
                Share.share({
                  message: `Estoy usando Nuvos AI — el mejor mentor de inversiones con IA. Únete gratis 👉 https://nuvosai.com/join?ref=${referralCode}`,
                  url: `https://nuvosai.com/join?ref=${referralCode}`,
                });
              }}
            >
              <Ionicons name="share-social-outline" size={16} color="#f59e0b" />
              <Text style={[s.referralShareText, { color: "#f59e0b" }]}>Compartir invitación</Text>
            </TouchableOpacity>

            <Text style={[s.referralNote, { color: colors.textDim }]}>
              Tu amigo obtiene 7 días Premium gratis al registrarse. Tú recibes 1 mes Premium cuando activa su plan.
            </Text>
          </View>
        </View>

        {/* ── LEGAL ── */}
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 20, paddingVertical: 8 }}>
          <TouchableOpacity onPress={() => Linking.openURL("https://nuvosai.app/privacy")}>
            <Text style={[s.legalLink, { color: colors.textDim }]}>Política de privacidad</Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textDim, fontSize: 11 }}>·</Text>
          <TouchableOpacity onPress={() => Linking.openURL("https://nuvosai.app/terms")}>
            <Text style={[s.legalLink, { color: colors.textDim }]}>Términos de uso</Text>
          </TouchableOpacity>
        </View>

        {/* ── TUTORIAL ── */}
        <TouchableOpacity
          style={[s.logoutBtn, { borderColor: colors.border + "60", backgroundColor: "transparent" }]}
          onPress={() => setTutorialFromProfile(true)}
        >
          <Ionicons name="help-circle-outline" size={17} color={colors.textSub} />
          <Text style={[s.logoutText, { color: colors.textSub }]}>Ver tutorial de la app</Text>
        </TouchableOpacity>

        {/* ── LOGOUT ── */}
        <TouchableOpacity
          style={[s.logoutBtn, { borderColor: "#ef444435", backgroundColor: "#ef44440a" }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={17} color="#ef4444" />
          <Text style={s.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>

        {/* ── DELETE ACCOUNT ── */}
        <TouchableOpacity
          style={{ alignItems: "center", paddingVertical: 12 }}
          onPress={handleDeleteAccount}
        >
          <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: "500" }}>
            Eliminar mi cuenta
          </Text>
        </TouchableOpacity>

      </ScrollView>

      <ProgressModal visible={progressOpen} onClose={() => setProgressOpen(false)} />
      <TutorialModal visible={tutorialFromProfile} onClose={() => setTutorialFromProfile(false)} />
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
    insightCard: {
      borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 16,
    },

    // ── Hero card ──
    heroCard: {
      borderRadius: 22, borderWidth: 1, overflow: "hidden",
      backgroundColor: c.card,
      shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    },
    heroBand: { height: 48 },
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
      position: "absolute", top: 10, right: 10,
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: "rgba(0,0,0,0.55)",
      borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
      alignItems: "center", justifyContent: "center",
      zIndex: 10,
    },
    modalHint: { color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: "500" },
    modalShareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "#16a34a", borderRadius: 14, paddingVertical: 15, width: 320,
    },
    modalShareText: { color: "white", fontWeight: "700", fontSize: 15 },
    legalLink: { fontSize: 11, fontWeight: "500" },

    // ── Referral ──
    referralCard: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
    referralHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    referralIconBox: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    referralTitle: { fontSize: 14, fontWeight: "700", marginBottom: 2 },
    referralSub: { fontSize: 11, lineHeight: 16 },
    referralStats: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
    referralStat: { flex: 1, alignItems: "center", paddingVertical: 12 },
    referralStatNum: { fontSize: 22, fontWeight: "800", marginBottom: 2 },
    referralStatLabel: { fontSize: 10 },
    referralLinkRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
    referralLink: { flex: 1, fontSize: 12, fontFamily: "monospace" },
    referralShareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 12 },
    referralShareText: { fontSize: 13, fontWeight: "700" },
    referralNote: { fontSize: 10, textAlign: "center", lineHeight: 15 },

    levelCard: {
      borderWidth: 1, borderRadius: 18, padding: 14,
      flexDirection: "row", flexWrap: "wrap", gap: 0,
    },
    levelOption: {
      width: "48%", borderWidth: 1.5, borderRadius: 14, padding: 12,
      marginBottom: 8, alignItems: "flex-start",
    },
    levelOptLabel: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
    levelOptDesc:  { fontSize: 11, lineHeight: 15 },
    levelSaving:   { width: "100%", textAlign: "center", fontSize: 11, paddingTop: 4 },
  });
}
