import React, { useMemo, useState, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, Alert, Modal, ActivityIndicator, Platform, Linking, Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG, getAge, maturityLabel } from "../../src/lib/profileStore";
import { getMentorInfo } from "../../src/lib/mentorData";
import ProgressModal from "../../src/components/ProgressModal";
import TutorialModal from "../../src/components/TutorialModal";
import { insightsApi, mentorLetterApi, profileApi, authApi, referralApi, syncApi, feedApi } from "../../src/lib/api";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const QUIZ_CATEGORIES = ["Mentalidad", "Horizonte", "Conocimiento", "Riesgo", "Comportamiento"];
const QUIZ_LABELS: Record<string, Record<string, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera sin actuar", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "Menos de 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Básico", B: "Básico", C: "Intermedio", D: "Avanzado" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
  q5: { A: "Automático / pasivo", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria" },
};
const KL_LABEL: Record<string, string>  = { B: "Básico", C: "Intermedio", D: "Avanzado" };
const KL_COLOR: Record<string, string>  = { B: "#22c55e", C: "#3b82f6",   D: "#a855f7"  };
const RT_LABEL: Record<string, string>  = { conservative: "Conservador", moderate: "Moderado", aggressive: "Agresivo" };
const RT_COLOR: Record<string, string>  = { conservative: "#3b82f6",     moderate: "#f59e0b",  aggressive: "#ef4444"  };
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

const GOAL_MAP: Record<string, { label: string; emoji: string }> = {
  house:             { label: "Comprar una casa",         emoji: "🏠" },
  car:               { label: "Comprar un carro",         emoji: "🚗" },
  passive_income:    { label: "Vivir de mis inversiones", emoji: "💸" },
  retirement:        { label: "Retiro / pensión",         emoji: "👴" },
  financial_freedom: { label: "Libertad financiera",      emoji: "🦅" },
  long_term_wealth:  { label: "Patrimonio a largo plazo", emoji: "🏛️" },
};

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
        style={{ borderRadius: 16, borderWidth: 1, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: mc + "0a", borderColor: mc + "35" }}
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

  const [progressOpen, setProgressOpen] = useState(false);

  const [insights, setInsights] = useState<{ ready: boolean; topics?: string[]; risk_behavior?: string; risk_match?: boolean; risk_note?: string; suggestion?: string; interests?: string[] } | null>(null);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralStats, setReferralStats] = useState<{ referred_count: number; pending_reward: string } | null>(null);
  const [likedClips, setLikedClips] = useState<{ id: string; title: string; thumbnail_url: string; speaker: string; duration_sec: number }[]>([]);

  useEffect(() => {
    insightsApi.get().then((r) => setInsights(r.data)).catch(() => {});
    referralApi.getCode().then((r) => setReferralCode(r.data.code ?? null)).catch(() => {});
    feedApi.getLiked().then((r: any) => setLikedClips(r.data.clips || [])).catch(() => {});
    referralApi.getStats().then((r) => setReferralStats(r.data)).catch(() => {});
    // Sync full profile from server to keep birth_date and other fields up to date
    profileApi.get().then((r: any) => {
      const current = useAppStore.getState().profile;
      if (current && r.data) {
        useAppStore.getState().setProfile({ ...current, ...r.data, avatarUri: current.avatarUri });
      }
    }).catch(() => {});
    // Bidirectional maturity sync on every profile view
    syncApi.getAll().then((res: any) => {
      const serverScore: number = res.data?.maturity?.score ?? 0;
      const serverHistory = res.data?.maturity?.history ?? [];
      const { maturityScore: local, maturityHistory: localHist } = useAppStore.getState();
      if (serverScore > local) {
        useAppStore.setState({ maturityScore: serverScore, maturityHistory: serverHistory });
      } else if (local > serverScore) {
        syncApi.pushMaturity(local, localHist).catch(() => {});
      }
    }).catch(() => {});
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
    const localUri = `data:image/jpeg;base64,${result.assets[0].base64}`;
    setAvatarUri(localUri);
    setAvatarUploading(true);
    try {
      const res = await profileApi.uploadAvatar(result.assets[0].base64);
      setAvatarUri(res.data.avatar_url);
    } catch {
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
  const [copiedLink, setCopiedLink] = useState(false);
  const [tutorialFromProfile, setTutorialFromProfile] = useState(false);
  const [savingLevel, setSavingLevel] = useState(false);
  const [psyEditField, setPsyEditField] = useState<string | null>(null);
  const [savingPsy, setSavingPsy] = useState(false);

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

  const handlePsySave = async (field: string, value: string) => {
    if (!profile) return;
    setSavingPsy(true);
    try {
      let update: Record<string, unknown> = {};
      if (field === "risk_tolerance") {
        update = { risk_tolerance: value };
      } else if (field === "investment_goal") {
        update = { investment_goal: value };
      } else {
        update = { quiz_answers: { ...profile.quiz_answers, [field]: value } };
      }
      await profileApi.update(update);
      setProfile({
        ...profile,
        ...(field === "risk_tolerance" ? { risk_tolerance: value as import("../../src/lib/profileStore").RiskTolerance } : {}),
        ...(field === "investment_goal" ? { investment_goal: value } : {}),
        quiz_answers: field !== "risk_tolerance" && field !== "investment_goal"
          ? { ...profile.quiz_answers, [field]: value as import("../../src/lib/profileStore").QuizAnswer }
          : profile.quiz_answers,
      });
      setPsyEditField(null);
    } catch {
      Alert.alert("Error", "No se pudo guardar. Intenta de nuevo.");
    }
    setSavingPsy(false);
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
                    try { await authApi.deleteAccount(); } catch {}
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

  // ── Derived goal info ────────────────────────────────────────────────────────
  const goalKey   = profile.investment_goal ?? null;
  const goalInfo  = goalKey ? (GOAL_MAP[goalKey] ?? { label: goalKey, emoji: "🎯" }) : null;
  const goalAmount = profile.investment_goal_amount ? Number(profile.investment_goal_amount) : 0;
  const horizonYrs = profile.investment_horizon ? parseInt(profile.investment_horizon) : 0;

  return (
    <SafeAreaView style={s.container} edges={["bottom", "left", "right"]}>

      {/* ── HEADER ── */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <View>
          <Text style={[s.headerGreet, { color: colors.textMuted }]}>Mi Perfil</Text>
          <Text style={[s.headerName, { color: colors.text }]}>{profile.name}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity
            style={[s.iconBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            onPress={() => router.push("/profile/edit")}
          >
            <Ionicons name="pencil-outline" size={17} color={colors.text} />
          </TouchableOpacity>

        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* ── HERO CARD ── */}
        <View style={[s.heroCard, { borderColor: riskCfg.color + "35" }]}>
          {/* Colored band with decorative icon */}
          <View style={[s.heroBand, { backgroundColor: riskCfg.color }]}>
            <View style={{ position: "absolute", right: 18, top: 14, opacity: 0.18 }}>
              <Ionicons name={riskCfg.icon} size={46} color="white" />
            </View>
          </View>

          {/* Avatar centered on band edge */}
          <View style={s.heroAvatarRow}>
            <View style={[s.heroRing, { borderColor: colors.bg }]}>
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
              <TouchableOpacity
                style={[s.cameraBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={pickPhoto}
                disabled={avatarUploading}
              >
                <Ionicons name="camera" size={11} color={colors.accentLight} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Name + tags */}
          <View style={s.heroBody}>
            <Text style={[s.heroName, { color: colors.text }]}>{profile.name}</Text>
            <View style={s.heroTags}>
              <View style={[s.heroTag, { backgroundColor: riskCfg.color + "18", borderColor: riskCfg.color + "45" }]}>
                <Ionicons name={riskCfg.icon} size={10} color={riskCfg.color} />
                <Text style={[s.heroTagText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
              </View>
              {mentor && (
                <View style={[s.heroTag, { backgroundColor: mentor.color + "18", borderColor: mentor.color + "45" }]}>
                  <Text style={[s.heroTagText, { color: mentor.color }]}>{mentor.name}</Text>
                </View>
              )}
              {profile.avatarUri && !avatarUploading && (
                <TouchableOpacity
                  style={[s.heroTag, { borderColor: "#ef444432", backgroundColor: "#ef44440a" }]}
                  onPress={removePhoto}
                >
                  <Ionicons name="trash-outline" size={10} color="#ef4444" />
                  <Text style={[s.heroTagText, { color: "#ef4444" }]}>Quitar foto</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Stats row: age | income | contribution */}
            <View style={[s.heroStats, { borderTopColor: riskCfg.color + "22" }]}>
              <View style={s.heroStat}>
                <Text style={[s.heroStatVal, { color: colors.text }]}>{age || "—"}</Text>
                <Text style={[s.heroStatLabel, { color: colors.textMuted }]}>años</Text>
              </View>
              <View style={[s.heroDivider, { backgroundColor: colors.border }]} />
              <View style={s.heroStat}>
                <Text style={[s.heroStatVal, { color: colors.text }]} adjustsFontSizeToFit numberOfLines={1}>
                  ${Number(profile.monthly_income ?? 0).toLocaleString()}
                </Text>
                <Text style={[s.heroStatLabel, { color: colors.textMuted }]}>ingresos/mes</Text>
              </View>
              <View style={[s.heroDivider, { backgroundColor: colors.border }]} />
              <View style={s.heroStat}>
                <Text style={[s.heroStatVal, { color: colors.accentLight }]}>
                  ${Number(profile.monthly_contribution ?? 0).toLocaleString()}
                </Text>
                <Text style={[s.heroStatLabel, { color: colors.textMuted }]}>aportación/mes</Text>
              </View>
            </View>
          </View>
        </View>


{/* ── META FINANCIERA ── */}
        {goalInfo && (
          <View style={s.metaCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <View style={s.metaIconBox}>
                <Text style={{ fontSize: 26, lineHeight: 30 }}>{goalInfo.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.metaCaption}>MI META FINANCIERA</Text>
                <Text style={s.metaLabel}>{goalInfo.label}</Text>
                {goalAmount > 0 && (
                  <Text style={[s.metaAmount, { color: colors.text }]}>
                    ${goalAmount.toLocaleString("en-US")} USD
                  </Text>
                )}
              </View>
              {horizonYrs > 0 && (
                <View style={s.metaHorizonBadge}>
                  <Text style={s.metaHorizonVal}>{horizonYrs}</Text>
                  <Text style={s.metaHorizonUnit}>años</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* ── AI INSIGHTS ── */}
        {insights?.ready && (
          <View style={[s.insightCard, {
            borderColor: insights.risk_match === false ? "#f59e0b45" : "#22c55e32",
            backgroundColor: insights.risk_match === false ? "#f59e0b07" : "#22c55e06",
          }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <View style={[s.insightIcon, { backgroundColor: insights.risk_match === false ? "#f59e0b18" : "#22c55e18" }]}>
                <Text style={{ fontSize: 20 }}>🧠</Text>
              </View>
              <Text style={[s.sectionTitle, { color: colors.text }]}>La IA te ha analizado</Text>
            </View>
            {insights.risk_match === false && insights.risk_note && (
              <View style={{ backgroundColor: "#f59e0b10", borderRadius: 12, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: "#f59e0b28" }}>
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
                  <View key={t} style={{ backgroundColor: "#22c55e10", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "#22c55e28" }}>
                    <Text style={{ color: "#22c55e", fontSize: 11, fontWeight: "600" }}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── PERFIL DE RIESGO ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>Perfil de riesgo</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setRiskExpanded((v) => !v)}
            style={[s.riskCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "40" }]}
          >
            <View style={s.riskTopRow}>
              <View style={[s.riskIconBox, { backgroundColor: riskCfg.color + "18" }]}>
                <Ionicons name={riskCfg.icon} size={26} color={riskCfg.color} />
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
              <Ionicons name={riskExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textDim} />
            </View>

            <View style={s.riskSegments}>
              {RISK_LEVELS.map((level) => {
                const isActive = level.key === profile.risk_tolerance;
                return (
                  <View key={level.key} style={[s.riskSegment, {
                    backgroundColor: isActive ? level.color : colors.border,
                    height: isActive ? 8 : 4,
                    shadowColor: isActive ? level.color : "transparent",
                    shadowOpacity: 0.45, shadowRadius: 6,
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

            {riskExpanded && (
              <View style={{ marginTop: 16, gap: 10, borderTopWidth: 1, borderTopColor: riskCfg.color + "20", paddingTop: 16 }}>
                <View style={{ gap: 7 }}>
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
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(profile.risk_tolerance === "conservative"
                    ? [{ label: "Volatilidad", val: "Baja" }, { label: "Retorno esperado", val: "4–7% anual" }, { label: "Horizonte ideal", val: "1–5 años" }]
                    : profile.risk_tolerance === "moderate"
                    ? [{ label: "Volatilidad", val: "Media" }, { label: "Retorno esperado", val: "7–10% anual" }, { label: "Horizonte ideal", val: "5–10 años" }]
                    : [{ label: "Volatilidad", val: "Alta" }, { label: "Retorno esperado", val: "10–15%+ anual" }, { label: "Horizonte ideal", val: "10+ años" }]
                  ).map((item) => (
                    <View key={item.label} style={{ flex: 1, backgroundColor: riskCfg.color + "0e", borderRadius: 10, padding: 8, alignItems: "center" }}>
                      <Text style={{ color: colors.textMuted, fontSize: 9, fontWeight: "600", textAlign: "center" }}>{item.label}</Text>
                      <Text style={{ color: riskCfg.color, fontSize: 12, fontWeight: "800", marginTop: 2, textAlign: "center" }}>{item.val}</Text>
                    </View>
                  ))}
                </View>
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
        </View>

        {/* ── MADUREZ INVERSORA ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>Madurez inversora</Text>
            <TouchableOpacity onPress={() => setProgressOpen(true)}>
              <Text style={[s.sectionLink, { color: colors.accentLight }]}>Ver historial →</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setProgressOpen(true)}
            style={[s.maturityCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={s.maturityRow}>
              <View style={[s.maturityCircle, { borderColor: maturity.color + "40", backgroundColor: maturity.color + "0e" }]}>
                <Ionicons name="analytics-outline" size={26} color={maturity.color} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
                  <Text style={[s.maturityNum, { color: maturity.color }]}>{maturityScore}</Text>
                  <Text style={[s.maturitySlash, { color: colors.textMuted }]}>/100</Text>
                </View>
                <View style={[s.maturityBadge, { backgroundColor: maturity.color + "18", borderColor: maturity.color + "35" }]}>
                  <Text style={[s.maturityBadgeText, { color: maturity.color }]}>{maturity.label}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
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
              Sube con cada buena decisión en la app. No refleja tu nivel de conocimiento declarado.
            </Text>

            {maturityHistory.length > 0 && (
              <>
                <View style={[s.divider, { borderTopColor: colors.border }]} />
                <Text style={[s.histTitle, { color: colors.textMuted }]}>Últimas señales detectadas</Text>
                {maturityHistory.slice(-3).reverse().map((ev, i) => (
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
        </View>

        {/* ── MENTOR ── */}
        {mentor && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: colors.text }]}>Tu mentor</Text>
            </View>
            <View style={[s.mentorCard, { backgroundColor: colors.card, borderColor: mentor.color + "40" }]}>
              <View style={[s.mentorBand, { backgroundColor: mentor.color + "0d" }]}>
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
                  <View style={[s.mentorBadgeWrap, { backgroundColor: mentor.color + "20", borderColor: mentor.color + "40" }]}>
                    <Text style={[s.mentorBadgeText, { color: mentor.color }]}>{mentor.badge}</Text>
                  </View>
                </View>
              </View>
              <View style={[s.mentorPrinciples, { backgroundColor: colors.card }]}>
                {mentor.principles.map((p, i) => (
                  <View key={i} style={[s.principlePill, { borderColor: mentor.color + "28", backgroundColor: mentor.color + "08" }]}>
                    <View style={[s.principleDot, { backgroundColor: mentor.color }]} />
                    <Text style={[s.principleText, { color: colors.textSub }]}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={{ marginTop: 10 }}>
              <MentorLetterCard mentor={mentor} colors={colors} />
            </View>
          </View>
        )}

        {/* ── PERFIL PSICOLÓGICO ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>Perfil psicológico</Text>
            {savingPsy && <ActivityIndicator size="small" color={colors.accentLight} />}
          </View>
          <View style={[s.psyTwoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>

            {/* ── Horizonte ── */}
            {(() => {
              const val = profile.quiz_answers?.q2;
              const label = val ? QUIZ_LABELS.q2[val] : null;
              return (
                <View style={[s.psyRow, { borderBottomColor: colors.border }]}>
                  <View style={[s.psyRowIcon, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
                    <Text style={{ fontSize: 18 }}>🕐</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.psyRowCat, { color: colors.textDim }]}>Horizonte de inversión</Text>
                    <Text style={[s.psyRowVal, { color: label ? colors.text : colors.textDim }]}>
                      {label ?? "No completado"}
                    </Text>
                  </View>
                  {label ? (
                    <TouchableOpacity onPress={() => setPsyEditField("q2")}
                      style={{ backgroundColor: "rgba(34,197,94,0.12)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(34,197,94,0.3)" }}>
                      <Text style={{ color: "#22c55e", fontSize: 11, fontWeight: "700" }}>{label}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => setPsyEditField("q2")}
                      style={{ backgroundColor: "rgba(251,191,36,0.12)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(251,191,36,0.3)" }}>
                      <Text style={{ color: "#fbbf24", fontSize: 11, fontWeight: "700" }}>Completar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}

            {/* ── Comportamiento / Perfil de riesgo ── */}
            {(() => {
              const rt = profile.risk_tolerance;
              const compLabel = RT_LABEL[rt] ?? rt;
              const compColor = RT_COLOR[rt] ?? "#f59e0b";
              return (
                <View style={[s.psyRow, { borderBottomColor: colors.border }]}>
                  <View style={[s.psyRowIcon, { backgroundColor: compColor + "18" }]}>
                    <Text style={{ fontSize: 18 }}>🧠</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.psyRowCat, { color: colors.textDim }]}>Comportamiento</Text>
                    <Text style={[s.psyRowVal, { color: colors.text }]}>{compLabel}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setPsyEditField("risk_tolerance")}
                    style={{ backgroundColor: compColor + "18", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: compColor + "44" }}>
                    <Text style={{ color: compColor, fontSize: 11, fontWeight: "700" }}>{compLabel}</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}

            {/* ── Reacción ante caídas ── */}
            {(() => {
              const val = profile.quiz_answers?.q1;
              const label = val ? QUIZ_LABELS.q1[val] : null;
              return (
                <View style={[s.psyRow, { borderBottomColor: colors.border }]}>
                  <View style={[s.psyRowIcon, { backgroundColor: "rgba(239,68,68,0.10)" }]}>
                    <Text style={{ fontSize: 18 }}>📉</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.psyRowCat, { color: colors.textDim }]}>Reacción ante caídas</Text>
                    <Text style={[s.psyRowVal, { color: label ? colors.text : colors.textDim }]}>
                      {label ?? "No completado"}
                    </Text>
                  </View>
                  {label ? (
                    <TouchableOpacity onPress={() => setPsyEditField("q1")}
                      style={{ backgroundColor: "rgba(239,68,68,0.10)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(239,68,68,0.25)" }}>
                      <Text style={{ color: "#ef4444", fontSize: 11, fontWeight: "700" }}>{label}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => setPsyEditField("q1")}
                      style={{ backgroundColor: "rgba(251,191,36,0.12)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(251,191,36,0.3)" }}>
                      <Text style={{ color: "#fbbf24", fontSize: 11, fontWeight: "700" }}>Completar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}

            {/* ── Seguimiento del mercado ── */}
            {(() => {
              const val = profile.quiz_answers?.q5;
              const label = val ? QUIZ_LABELS.q5[val] : null;
              return (
                <View style={[s.psyRow, { borderBottomWidth: 0 }]}>
                  <View style={[s.psyRowIcon, { backgroundColor: "rgba(59,130,246,0.10)" }]}>
                    <Text style={{ fontSize: 18 }}>⚙️</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.psyRowCat, { color: colors.textDim }]}>Seguimiento del mercado</Text>
                    <Text style={[s.psyRowVal, { color: label ? colors.text : colors.textDim }]}>
                      {label ?? "No completado"}
                    </Text>
                  </View>
                  {label ? (
                    <TouchableOpacity onPress={() => setPsyEditField("q5")}
                      style={{ backgroundColor: "rgba(59,130,246,0.10)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(59,130,246,0.25)" }}>
                      <Text style={{ color: "#3b82f6", fontSize: 11, fontWeight: "700" }}>{label}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity onPress={() => setPsyEditField("q5")}
                      style={{ backgroundColor: "rgba(251,191,36,0.12)", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(251,191,36,0.3)" }}>
                      <Text style={{ color: "#fbbf24", fontSize: 11, fontWeight: "700" }}>Completar</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}
          </View>
        </View>

        {/* ── MODAL EDICIÓN PERFIL PSICOLÓGICO ── */}
        <Modal
          visible={psyEditField !== null}
          transparent
          animationType="slide"
          onRequestClose={() => setPsyEditField(null)}
        >
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}
            activeOpacity={1}
            onPress={() => setPsyEditField(null)}
          >
            <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 12 }}
              onStartShouldSetResponder={() => true}>
              {/* Header */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: "800" }}>
                  {psyEditField === "q2" ? "¿Cuál es tu horizonte de inversión?" :
                   psyEditField === "risk_tolerance" ? "¿Cuál es tu comportamiento inversor?" :
                   psyEditField === "q1" ? "¿Qué haces cuando tu portafolio cae?" :
                   "¿Con qué frecuencia revisas el mercado?"}
                </Text>
                <TouchableOpacity onPress={() => setPsyEditField(null)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>
                Toca una opción para guardar automáticamente
              </Text>

              {/* Options */}
              {psyEditField === "q2" && Object.entries(QUIZ_LABELS.q2).map(([key, text]) => {
                const active = profile.quiz_answers?.q2 === key;
                return (
                  <TouchableOpacity key={key} onPress={() => handlePsySave("q2", key)} disabled={savingPsy}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14,
                      backgroundColor: active ? "rgba(34,197,94,0.12)" : colors.bgRaised,
                      borderWidth: 1.5, borderColor: active ? "#22c55e" : colors.border }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: active ? "#22c55e" : colors.border + "60",
                      alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: active ? "#fff" : colors.textMuted }}>{key}</Text>
                    </View>
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: active ? "700" : "500", color: active ? colors.text : colors.textSub }}>{text}</Text>
                    {active && <Ionicons name="checkmark-circle" size={20} color="#22c55e" />}
                  </TouchableOpacity>
                );
              })}

              {psyEditField === "risk_tolerance" && [
                { key: "conservative", label: "Conservador", color: "#3b82f6", desc: "Priorizo no perder dinero sobre ganar" },
                { key: "moderate",     label: "Moderado",    color: "#f59e0b", desc: "Balance entre crecimiento y estabilidad" },
                { key: "aggressive",   label: "Agresivo",    color: "#ef4444", desc: "Acepto alta volatilidad buscando mayor retorno" },
              ].map(({ key, label, color, desc }) => {
                const active = profile.risk_tolerance === key;
                return (
                  <TouchableOpacity key={key} onPress={() => handlePsySave("risk_tolerance", key)} disabled={savingPsy}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14,
                      backgroundColor: active ? color + "12" : colors.bgRaised,
                      borderWidth: 1.5, borderColor: active ? color : colors.border }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: active ? color : color + "30",
                      alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 14, fontWeight: "800", color: active ? "#fff" : color }}>
                        {key === "conservative" ? "C" : key === "moderate" ? "M" : "A"}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: active ? color : colors.text }}>{label}</Text>
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>{desc}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={color} />}
                  </TouchableOpacity>
                );
              })}

              {psyEditField === "q1" && Object.entries(QUIZ_LABELS.q1).map(([key, text]) => {
                const active = profile.quiz_answers?.q1 === key;
                const color = key === "A" ? "#ef4444" : key === "B" ? "#f59e0b" : key === "C" ? "#3b82f6" : "#22c55e";
                return (
                  <TouchableOpacity key={key} onPress={() => handlePsySave("q1", key)} disabled={savingPsy}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14,
                      backgroundColor: active ? color + "12" : colors.bgRaised,
                      borderWidth: 1.5, borderColor: active ? color : colors.border }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: active ? color : color + "30",
                      alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: active ? "#fff" : color }}>{key}</Text>
                    </View>
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: active ? "700" : "500", color: active ? colors.text : colors.textSub }}>{text}</Text>
                    {active && <Ionicons name="checkmark-circle" size={20} color={color} />}
                  </TouchableOpacity>
                );
              })}

              {psyEditField === "q5" && Object.entries(QUIZ_LABELS.q5).map(([key, text]) => {
                const active = profile.quiz_answers?.q5 === key;
                return (
                  <TouchableOpacity key={key} onPress={() => handlePsySave("q5", key)} disabled={savingPsy}
                    style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14,
                      backgroundColor: active ? "rgba(59,130,246,0.12)" : colors.bgRaised,
                      borderWidth: 1.5, borderColor: active ? "#3b82f6" : colors.border }}>
                    <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: active ? "#3b82f6" : colors.border + "60",
                      alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 11, fontWeight: "800", color: active ? "#fff" : colors.textMuted }}>{key}</Text>
                    </View>
                    <Text style={{ flex: 1, fontSize: 14, fontWeight: active ? "700" : "500", color: active ? colors.text : colors.textSub }}>{text}</Text>
                    {active && <Ionicons name="checkmark-circle" size={20} color="#3b82f6" />}
                  </TouchableOpacity>
                );
              })}

              {savingPsy && (
                <View style={{ alignItems: "center", paddingTop: 4 }}>
                  <ActivityIndicator size="small" color={colors.accentLight} />
                </View>
              )}
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── NIVEL DE CONOCIMIENTO ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>Nivel de conocimiento</Text>
            {savingLevel && <ActivityIndicator size="small" color={colors.accentLight} />}
          </View>
          <View style={[s.levelCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              { key: "B", label: "Básico",       emoji: "🌱", desc: "Conozco lo básico",      color: "#22c55e" },
              { key: "C", label: "Intermedio",   emoji: "📈", desc: "Tengo experiencia",       color: "#3b82f6" },
              { key: "D", label: "Avanzado",     emoji: "🎯", desc: "Análisis profundo",       color: "#a855f7" },
            ].map((opt, i) => {
              const isActive = profile.quiz_answers?.q3 === opt.key || profile.knowledge_level === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    s.levelOption,
                    { borderColor: isActive ? opt.color : colors.border, backgroundColor: isActive ? opt.color + "12" : colors.bgRaised },
                    i < 2 && { marginRight: 6 },
                  ]}
                  onPress={() => handleLevelChange(opt.key)}
                  disabled={savingLevel}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontSize: 20, marginBottom: 4 }}>{opt.emoji}</Text>
                  <Text style={[s.levelOptLabel, { color: isActive ? opt.color : colors.text }]}>{opt.label}</Text>
                  <Text style={[s.levelOptDesc, { color: colors.textMuted }]}>{opt.desc}</Text>
                  {isActive && (
                    <View style={{ position: "absolute", top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: opt.color, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark" size={11} color="white" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── REFERIDOS ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={[s.sectionTitle, { color: colors.text }]}>Invita amigos</Text>
          </View>
          <View style={[s.referralCard, { backgroundColor: colors.card, borderColor: "#f59e0b45" }]}>
            <View style={[s.referralHeader, { backgroundColor: "#f59e0b08", borderBottomColor: colors.border }]}>
              <View style={[s.referralIconBox, { backgroundColor: "#f59e0b18" }]}>
                <Ionicons name="gift-outline" size={22} color="#f59e0b" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[s.referralTitle, { color: colors.text }]}>Invita amigos, gana recompensas</Text>
                <Text style={[s.referralSub, { color: colors.textMuted }]}>1 mes Premium gratis por cada amigo que se una</Text>
              </View>
            </View>

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

            <View style={{ padding: 14, gap: 10 }}>
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
              <TouchableOpacity
                style={[s.referralShareBtn, { backgroundColor: "#f59e0b10", borderColor: "#f59e0b35" }]}
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
        </View>

        {/* ── VIDEOS QUE TE GUSTARON ── */}
        {likedClips.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 14 }}>❤️</Text>
                <Text style={[s.sectionTitle, { color: colors.text }]}>
                  VIDEOS QUE TE GUSTARON
                </Text>
                <View style={{ backgroundColor: colors.accent + "22", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <Text style={{ color: colors.accentLight, fontSize: 11, fontWeight: "700" }}>{likedClips.length}</Text>
                </View>
              </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 4 }}>
              {likedClips.map((clip) => (
                <TouchableOpacity
                  key={clip.id}
                  activeOpacity={0.8}
                  onPress={() => router.push({ pathname: "/(tabs)/videos", params: { clipId: clip.id } })}
                  style={{ width: 148, borderRadius: 16, borderWidth: 1, overflow: "hidden", backgroundColor: colors.card, borderColor: colors.border }}
                >
                  {/* Thumbnail */}
                  <View style={{ width: "100%", height: 90, backgroundColor: colors.bgRaised, position: "relative" }}>
                    {clip.thumbnail_url ? (
                      <Image source={{ uri: clip.thumbnail_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                    ) : (
                      <View style={[StyleSheet.absoluteFillObject, { alignItems: "center", justifyContent: "center" }]}>
                        <Text style={{ fontSize: 28 }}>🎬</Text>
                      </View>
                    )}
                    <View style={{ position: "absolute", bottom: 6, right: 6, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
                        {clip.duration_sec >= 60 ? `${Math.floor(clip.duration_sec / 60)}m` : `${clip.duration_sec}s`}
                      </Text>
                    </View>
                  </View>
                  {/* Info */}
                  <View style={{ padding: 10, gap: 3 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", lineHeight: 16, color: colors.text }} numberOfLines={2}>{clip.title}</Text>
                    <Text style={{ fontSize: 10, color: colors.textMuted }} numberOfLines={1}>{clip.speaker}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── BOTTOM ── */}
        <View style={{ marginTop: 16, gap: 10, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 20, paddingVertical: 4 }}>
            <TouchableOpacity onPress={() => Linking.openURL("https://nuvosai.app/privacy")}>
              <Text style={[s.legalLink, { color: colors.textDim }]}>Política de privacidad</Text>
            </TouchableOpacity>
            <Text style={{ color: colors.textDim, fontSize: 11 }}>·</Text>
            <TouchableOpacity onPress={() => Linking.openURL("https://nuvosai.app/terms")}>
              <Text style={[s.legalLink, { color: colors.textDim }]}>Términos de uso</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[s.actionBtn, { borderColor: colors.border + "70", backgroundColor: "transparent", marginHorizontal: 16 }]}
            onPress={() => setTutorialFromProfile(true)}
          >
            <Ionicons name="help-circle-outline" size={17} color={colors.textSub} />
            <Text style={[s.actionBtnText, { color: colors.textSub }]}>Ver tutorial de la app</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.actionBtn, { borderColor: "#ef444432", backgroundColor: "#ef44440a", marginHorizontal: 16 }]}
            onPress={handleLogout}
          >
            <Ionicons name="log-out-outline" size={17} color="#ef4444" />
            <Text style={[s.actionBtnText, { color: "#ef4444" }]}>Cerrar sesión</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ alignItems: "center", paddingVertical: 10 }} onPress={handleDeleteAccount}>
            <Text style={{ color: colors.textDim, fontSize: 12, fontWeight: "500" }}>Eliminar mi cuenta</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      <ProgressModal visible={progressOpen} onClose={() => setProgressOpen(false)} />
      <TutorialModal visible={tutorialFromProfile} onClose={() => setTutorialFromProfile(false)} />
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { paddingBottom: 8, gap: 0 },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    emptyText: { fontSize: 15 },

    // ── Header ──
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingHorizontal: 20, paddingTop: 6, paddingBottom: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerGreet: { fontSize: 12, fontWeight: "500", letterSpacing: 0.3, marginBottom: 1 },
    headerName: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
    iconBtn: {
      width: 38, height: 38, borderRadius: 12, borderWidth: 1,
      alignItems: "center", justifyContent: "center",
    },

    // ── Sections ──
    section: { marginTop: 24, paddingHorizontal: 16 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    sectionTitle: { fontSize: 16, fontWeight: "700", letterSpacing: -0.3 },
    sectionLink: { fontSize: 13, fontWeight: "600" },

    // ── Hero card ──
    heroCard: {
      marginHorizontal: 16, marginTop: 16,
      borderRadius: 22, borderWidth: 1,
      backgroundColor: c.card, overflow: "hidden",
      shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 5 },
    },
    heroBand: { height: 72, overflow: "hidden" },
    heroAvatarRow: { alignItems: "center", marginTop: -46 },
    heroRing: {
      width: 92, height: 92, borderRadius: 46, borderWidth: 5,
      alignItems: "center", justifyContent: "center", position: "relative",
      backgroundColor: c.bg,
    },
    heroAvatar: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
    heroAvatarLetter: { color: "white", fontSize: 34, fontWeight: "900", letterSpacing: -1 },
    cameraBtn: {
      position: "absolute", bottom: 2, right: 2,
      width: 26, height: 26, borderRadius: 13, borderWidth: 1.5,
      alignItems: "center", justifyContent: "center",
    },
    heroBody: { alignItems: "center", paddingHorizontal: 16, paddingTop: 10 },
    heroName: { fontSize: 22, fontWeight: "800", letterSpacing: -0.5, marginBottom: 8 },
    heroTags: { flexDirection: "row", gap: 7, flexWrap: "wrap", justifyContent: "center", marginBottom: 4 },
    heroTag: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
    heroTagText: { fontSize: 11, fontWeight: "700" },
    heroStats: {
      flexDirection: "row", width: "100%",
      borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, marginTop: 12,
    },
    heroStat: { flex: 1, alignItems: "center" },
    heroStatVal: { fontSize: 15, fontWeight: "800", letterSpacing: -0.3, marginBottom: 2 },
    heroStatLabel: { fontSize: 10, fontWeight: "500" },
    heroDivider: { width: 1, marginVertical: 4 },

    // ── Meta card ──
    metaCard: {
      marginHorizontal: 16, marginTop: 16,
      borderRadius: 18, borderWidth: 1,
      borderColor: "rgba(0,212,126,0.28)",
      backgroundColor: "rgba(0,212,126,0.06)",
      padding: 14,
    },
    metaIconBox: {
      width: 52, height: 52, borderRadius: 15,
      backgroundColor: "rgba(0,212,126,0.12)",
      alignItems: "center", justifyContent: "center",
    },
    metaCaption: { fontSize: 9, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", color: "rgba(0,212,126,0.55)", marginBottom: 2 },
    metaLabel: { fontSize: 16, fontWeight: "800", color: "#00d47e", letterSpacing: -0.3 },
    metaAmount: { fontSize: 13, fontWeight: "600", marginTop: 2 },
    metaHorizonBadge: {
      alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(0,212,126,0.12)", borderRadius: 12,
      paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(0,212,126,0.28)",
      minWidth: 50,
    },
    metaHorizonVal: { color: "#00d47e", fontSize: 16, fontWeight: "900", lineHeight: 18 },
    metaHorizonUnit: { color: "rgba(0,212,126,0.65)", fontSize: 9, fontWeight: "600", marginTop: 1 },

    // ── Insight card ──
    insightCard: {
      marginHorizontal: 16, marginTop: 16,
      borderRadius: 18, borderWidth: 1, padding: 14,
    },
    insightIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },

    // ── Risk card ──
    riskCard: {
      borderRadius: 18, borderWidth: 1.5, padding: 16,
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 2 },
    },
    riskTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 18 },
    riskIconBox: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
    riskLabel: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3, marginBottom: 4 },
    riskDesc: { fontSize: 12, lineHeight: 17 },
    riskSegments: { flexDirection: "row", gap: 5, marginBottom: 7, alignItems: "center" },
    riskSegment: { flex: 1, borderRadius: 4 },
    riskSegmentLabels: { flexDirection: "row" },
    riskSegmentLabel: { flex: 1, fontSize: 9, letterSpacing: 0.3, textAlign: "center" },

    // ── Maturity card ──
    maturityCard: {
      borderRadius: 18, borderWidth: 1, padding: 16,
      shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    },
    maturityRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
    maturityCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
    maturityNum: { fontSize: 42, fontWeight: "900", letterSpacing: -2, lineHeight: 46 },
    maturitySlash: { fontSize: 18, fontWeight: "400" },
    maturityBadge: { alignSelf: "flex-start", borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 },
    maturityBadgeText: { fontSize: 11, fontWeight: "700" },
    progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginBottom: 6 },
    progressFill: { height: "100%", borderRadius: 3 },
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
    mentorCard: { borderRadius: 18, borderWidth: 1.5, overflow: "hidden" },
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
    principlePill: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
    principleDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
    principleText: { fontSize: 13, flex: 1, lineHeight: 18 },

    // ── Psychological profile ──
    psyTwoCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    psyRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
    psyRowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    psyRowCat: { fontSize: 9, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 3 },
    psyRowVal: { fontSize: 14, fontWeight: "700" },

    // ── Knowledge level ──
    levelCard: { borderWidth: 1, borderRadius: 18, padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 0 },
    levelOption: { width: "48%", borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 8, alignItems: "flex-start", position: "relative" },
    levelOptLabel: { fontSize: 13, fontWeight: "700", marginBottom: 2 },
    levelOptDesc: { fontSize: 11, lineHeight: 15 },

    // ── Referral ──
    referralCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
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

    // ── Liked video cards ──
    likedCard: {
      width: 148, borderRadius: 16, borderWidth: 1, overflow: "hidden",
    },
    likedThumb: {
      width: "100%", height: 90, backgroundColor: c.bgRaised, position: "relative",
    },
    likedDuration: {
      position: "absolute", bottom: 6, right: 6,
      backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 6,
      paddingHorizontal: 6, paddingVertical: 2,
    },
    likedDurationText: { color: "#fff", fontSize: 10, fontWeight: "700" },
    likedInfo: { padding: 10, gap: 3 },
    likedTitle: { fontSize: 12, fontWeight: "700", lineHeight: 16 },
    likedSpeaker: { fontSize: 10 },

    // ── Action buttons ──
    actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 14, paddingVertical: 14 },
    actionBtnText: { fontWeight: "600", fontSize: 14 },
    legalLink: { fontSize: 11, fontWeight: "500" },

    // ── Modal ──
    modalOverlay: {
      flex: 1, backgroundColor: "rgba(0,0,0,0.82)",
      alignItems: "center", justifyContent: "center",
      gap: 16, paddingHorizontal: 20, paddingVertical: 40,
    },
    modalCloseBtn: {
      position: "absolute", top: 10, right: 10,
      width: 32, height: 32, borderRadius: 16,
      backgroundColor: "rgba(0,0,0,0.55)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
      alignItems: "center", justifyContent: "center", zIndex: 10,
    },
    modalHint: { color: "rgba(255,255,255,0.35)", fontSize: 11, fontWeight: "500" },
    modalShareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "#16a34a", borderRadius: 14, paddingVertical: 15, width: 320,
    },
    modalShareText: { color: "white", fontWeight: "700", fontSize: 15 },
  });
}
