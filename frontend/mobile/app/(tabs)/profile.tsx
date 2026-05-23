import React, { useMemo, useRef, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, Image,
  StyleSheet, SafeAreaView, Alert, Modal, ActivityIndicator, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import {
  useAppStore, RISK_CONFIG, getAge, maturityLabel,
} from "../../src/lib/profileStore";
import { getMentorInfo } from "../../src/lib/mentorData";
import InvestorScorecard from "../../src/components/InvestorScorecard";

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

const QUIZ_CATEGORIES = ["MENTALIDAD", "HORIZONTE", "CONOCIMIENTO", "RIESGO", "COMPORTAMIENTO"];
const QUIZ_LABELS: Record<string, Record<string, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera sin actuar", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "< 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
  q5: { A: "Automático / pasivo", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria" },
};

export default function ProfileScreen() {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const profile = useAppStore((state) => state.profile);
  const maturityScore = useAppStore((state) => state.maturityScore);
  const maturityHistory = useAppStore((state) => state.maturityHistory);
  const logout = useAppStore((state) => state.logout);

  const [scorecardOpen, setScorecardOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cardRef = useRef<View>(null);

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

  const handleLogout = () => {
    Alert.alert("Cerrar sesión", "¿Salir de tu perfil y volver al onboarding?", [
      { text: "Cancelar", style: "cancel" },
      { text: "Salir", style: "destructive", onPress: logout },
    ]);
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content}>

        {/* ── Header ── */}
        <View style={[s.headerCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "33" }]}>
          <View style={[s.headerTopAccent, { backgroundColor: riskCfg.color }]} />
          <View style={s.headerMain}>
            <View style={[s.avatarRing, { borderColor: riskCfg.color + "55" }]}>
              <View style={[s.avatarInner, { backgroundColor: riskCfg.color }]}>
                <Text style={s.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
              </View>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={[s.userName, { color: colors.text }]}>{profile.name}</Text>
              <View style={[s.riskPill, { backgroundColor: riskCfg.color + "1A", borderColor: riskCfg.color + "55" }]}>
                <Ionicons name={riskCfg.icon} size={11} color={riskCfg.color} />
                <Text style={[s.riskPillText, { color: riskCfg.color }]}>{riskCfg.label}</Text>
              </View>
              {mentor && (
                <View style={[s.mentorChip, { backgroundColor: mentor.color + "18", borderColor: mentor.color + "44" }]}>
                  <Text style={[s.mentorChipText, { color: mentor.color }]}>
                    Mentor: {mentor.name}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={[s.headerDivider, { borderTopColor: colors.border }]} />
          <TouchableOpacity
            style={[s.shareBtn, { backgroundColor: colors.accentLight + "12" }]}
            onPress={() => setScorecardOpen(true)}
          >
            <Ionicons name="share-social-outline" size={15} color={colors.accentLight} />
            <Text style={[s.shareBtnText, { color: colors.accentLight }]}>Compartir mi perfil</Text>
          </TouchableOpacity>
        </View>

        {/* ── Scorecard modal ── */}
        <Modal visible={scorecardOpen} transparent animationType="fade" onRequestClose={() => setScorecardOpen(false)}>
          <View style={s.modalOverlay}>
            <View style={[s.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.modalHeader}>
                <Text style={[s.modalTitle, { color: colors.text }]}>Mi Perfil Inversor</Text>
                <TouchableOpacity onPress={() => setScorecardOpen(false)}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
                <View ref={cardRef} collapsable={false}>
                  <InvestorScorecard />
                </View>
              </ScrollView>

              {Platform.OS !== "web" && (
                <TouchableOpacity
                  style={[s.modalShareBtn, sharing && { opacity: 0.6 }]}
                  onPress={handleShare}
                  disabled={sharing}
                >
                  {sharing ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Ionicons name="share-social-outline" size={18} color="white" />
                  )}
                  <Text style={s.modalShareText}>{sharing ? "Generando imagen…" : "Compartir imagen"}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </Modal>

        {/* ── Mentor card ── */}
        {mentor && (
          <>
            <Text style={[s.sectionLabel, { color: colors.textSub }]}>Tu Mentor</Text>
            <View style={[s.mentorCard, { backgroundColor: colors.card, borderColor: mentor.color + "55" }]}>
              <View style={s.mentorCardTop}>
                {MENTOR_PHOTOS[mentor.id] ? (
                  <Image source={MENTOR_PHOTOS[mentor.id]} style={s.mentorPhoto} />
                ) : (
                  <View style={[s.mentorEmojiBox, { backgroundColor: mentor.color + "22" }]}>
                    <Text style={s.mentorEmoji}>{mentor.emoji}</Text>
                  </View>
                )}
                <View style={s.mentorCardInfo}>
                  <Text style={[s.mentorName, { color: colors.text }]}>{mentor.name}</Text>
                  <Text style={[s.mentorTitle, { color: colors.textMuted }]}>{mentor.title}</Text>
                  <View style={[s.mentorBadge, { backgroundColor: mentor.color + "22" }]}>
                    <Text style={[s.mentorBadgeText, { color: mentor.color }]}>{mentor.badge}</Text>
                  </View>
                </View>
              </View>
              <View style={[s.mentorDivider, { borderTopColor: colors.border }]} />
              {mentor.principles.map((p, i) => (
                <View key={i} style={s.principleRow}>
                  <View style={[s.principleDot, { backgroundColor: mentor.color }]} />
                  <Text style={[s.principleText, { color: colors.textSub }]}>{p}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* ── Maturity score ── */}
        <Text style={[s.sectionLabel, { color: colors.textSub }]}>Madurez Inversora</Text>
        <View style={[s.maturityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={s.maturityTop}>
            <View>
              <Text style={[s.maturityScore, { color: maturity.color }]}>{maturityScore}<Text style={s.maturityMax}>/100</Text></Text>
              <Text style={[s.maturityLevel, { color: maturity.color }]}>{maturity.label}</Text>
            </View>
            <Ionicons name="analytics-outline" size={32} color={maturity.color} />
          </View>
          {maturityHistory.length > 0 && (
            <>
              <Text style={[s.maturityHistLabel, { color: colors.textMuted }]}>
                Últimas {Math.min(maturityHistory.length, 5)} señales detectadas
              </Text>
              {maturityHistory.slice(-5).reverse().map((ev, i) => (
                <View key={i} style={[s.maturityRow, { borderTopColor: colors.border }]}>
                  <Text style={[s.maturityRowDelta, { color: ev.delta >= 0 ? "#22c55e" : "#ef4444" }]}>
                    {ev.delta >= 0 ? "+" : ""}{ev.delta}
                  </Text>
                  <Text style={[s.maturityRowSig, { color: colors.textDim }]} numberOfLines={1}>
                    {ev.signals.map((s) => s.replace(/_/g, " ")).join(", ")}
                  </Text>
                  <Text style={[s.maturityRowScore, { color: colors.textMuted }]}>{ev.newScore}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        {/* ── Risk profile ── */}
        <Text style={[s.sectionLabel, { color: colors.textSub }]}>Perfil de Riesgo</Text>
        <View style={[s.riskCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "55" }]}>
          <View style={s.riskTop}>
            <Ionicons name={riskCfg.icon} size={28} color={riskCfg.color} />
            <View style={{ flex: 1, marginLeft: 12 }}>
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
        </View>

        {/* ── Financial data ── */}
        <Text style={[s.sectionLabel, { color: colors.textSub }]}>Datos Financieros</Text>
        <View style={[s.dataCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { label: "Edad", value: `${age} años` },
            { label: "Ingresos mensuales", value: `$${Number(profile.monthly_income).toLocaleString()} USD` },
            { label: "Aportación mensual", value: `$${Number(profile.monthly_contribution).toLocaleString()} USD` },
          ].map((row) => (
            <View key={row.label} style={[s.dataRow, { borderTopColor: colors.border }]}>
              <Text style={[s.dataLabel, { color: colors.textMuted }]}>{row.label}</Text>
              <Text style={[s.dataValue, { color: colors.text }]}>{row.value}</Text>
            </View>
          ))}
        </View>

        {/* ── Quiz answers ── */}
        <Text style={[s.sectionLabel, { color: colors.textSub }]}>Respuestas del Cuestionario</Text>
        <View style={[s.dataCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {quizKeys.map((key, i) => {
            const answer = profile.quiz_answers?.[key];
            return (
              <View key={key} style={[s.dataRow, { borderTopColor: colors.border }]}>
                <Text style={[s.dataLabel, { color: colors.textMuted }]}>{QUIZ_CATEGORIES[i]}</Text>
                <View style={s.quizRight}>
                  <View style={s.answerBadge}>
                    <Text style={s.answerBadgeText}>{answer}</Text>
                  </View>
                  <Text style={[s.dataValue, { color: colors.text, textAlign: "right", flexShrink: 1 }]}>
                    {answer ? QUIZ_LABELS[key][answer] : "—"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={[s.logoutBtn, { borderColor: "#ef4444" }]} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
          <Text style={s.logoutText}>Cerrar sesión</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, paddingBottom: 48, gap: 4 },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
    emptyText: { fontSize: 15 },
    sectionLabel: {
      fontSize: 11, fontWeight: "700", letterSpacing: 0.8,
      textTransform: "uppercase", marginTop: 16, marginBottom: 6, marginLeft: 2,
    },
    // Header card
    headerCard: {
      borderRadius: 16, borderWidth: 1, overflow: "hidden",
    },
    headerTopAccent: { height: 3 },
    headerMain: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, paddingBottom: 14 },
    avatarRing: {
      width: 58, height: 58, borderRadius: 29, borderWidth: 2,
      alignItems: "center", justifyContent: "center",
    },
    avatarInner: {
      width: 48, height: 48, borderRadius: 24,
      alignItems: "center", justifyContent: "center",
    },
    avatarLetter: { color: "white", fontSize: 22, fontWeight: "900" },
    userName: { fontSize: 19, fontWeight: "800", letterSpacing: -0.3 },
    userSub: { fontSize: 13 },
    riskPill: {
      flexDirection: "row", alignItems: "center", gap: 5,
      alignSelf: "flex-start", borderWidth: 1, borderRadius: 20,
      paddingHorizontal: 9, paddingVertical: 4,
    },
    riskPillText: { fontSize: 11, fontWeight: "700" },
    mentorChip: {
      borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3,
      alignSelf: "flex-start",
    },
    mentorChipText: { fontSize: 11, fontWeight: "600" },
    headerDivider: { borderTopWidth: 1, marginHorizontal: 18 },
    // Mentor card
    mentorCard: { borderRadius: 14, borderWidth: 1.5, padding: 14 },
    mentorCardTop: { flexDirection: "row", gap: 12, alignItems: "center", marginBottom: 12 },
    mentorPhoto: { width: 64, height: 64, borderRadius: 32 },
    mentorEmojiBox: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
    mentorEmoji: { fontSize: 30 },
    mentorCardInfo: { flex: 1, gap: 4 },
    mentorName: { fontSize: 16, fontWeight: "700" },
    mentorTitle: { fontSize: 12 },
    mentorBadge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
    mentorBadgeText: { fontSize: 10, fontWeight: "700" },
    mentorDivider: { borderTopWidth: 1, marginBottom: 10 },
    principleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
    principleDot: { width: 6, height: 6, borderRadius: 3 },
    principleText: { fontSize: 13, flex: 1 },
    // Maturity
    maturityCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
    maturityTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
    maturityScore: { fontSize: 36, fontWeight: "800" },
    maturityMax: { fontSize: 16, fontWeight: "400" },
    maturityLevel: { fontSize: 13, fontWeight: "700", marginTop: 2 },
    maturityHistLabel: { fontSize: 11, marginBottom: 6 },
    maturityRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5, borderTopWidth: 1 },
    maturityRowDelta: { fontSize: 13, fontWeight: "700", width: 36 },
    maturityRowSig: { flex: 1, fontSize: 11 },
    maturityRowScore: { fontSize: 12, fontWeight: "600" },
    // Risk card
    riskCard: { borderRadius: 14, borderWidth: 1.5, padding: 14 },
    riskTop: { flexDirection: "row", alignItems: "center" },
    riskLabel: { fontSize: 15, fontWeight: "700", marginBottom: 4 },
    riskDesc: { fontSize: 12, lineHeight: 17 },
    // Data rows
    dataCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
    dataRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, paddingHorizontal: 14, borderTopWidth: 1 },
    dataLabel: { fontSize: 12, fontWeight: "500" },
    dataValue: { fontSize: 13, fontWeight: "600" },
    quizRight: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
    answerBadge: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#22c55e", alignItems: "center", justifyContent: "center" },
    answerBadgeText: { color: "white", fontSize: 11, fontWeight: "700" },
    // Share button (inside header card, flush footer)
    shareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
      paddingVertical: 13,
    },
    shareBtnText: { fontSize: 13, fontWeight: "600" },
    // Scorecard modal
    modalOverlay: {
      flex: 1, backgroundColor: "rgba(0,0,0,0.6)",
      alignItems: "center", justifyContent: "center", padding: 20,
    },
    modalSheet: {
      width: "100%", maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: 20, gap: 14,
    },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    modalTitle: { fontSize: 16, fontWeight: "700" },
    modalShareBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      backgroundColor: "#16a34a", borderRadius: 12, paddingVertical: 14,
    },
    modalShareText: { color: "white", fontWeight: "600", fontSize: 15 },
    // Logout
    logoutBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
      borderWidth: 1, borderRadius: 12, paddingVertical: 14, marginTop: 20,
    },
    logoutText: { color: "#ef4444", fontWeight: "600", fontSize: 15 },
  });
}
