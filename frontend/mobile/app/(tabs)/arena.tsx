import React, { useState, useEffect } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, Modal,
  StyleSheet, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../src/lib/ThemeContext";
import { learnApi } from "../../src/lib/api";
import { useLearnStore, getMilestoneForStreak, getNextMilestone, STREAK_MILESTONES, STREAK_MILESTONES_PREMIUM } from "../../src/lib/learnStore";
import { useSubscriptionStore, hasPremiumAccess } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";
import MobileDecisionDiary from "../../src/components/MobileDecisionDiary";

const FREE_SIM_LIMIT = 5;
const PREMIUM_DIFFICULTIES = new Set(["dificil", "imposible"]);

// ─── Types ─────────────────────────────────────────────────────────────────

interface Scenario {
  id: string; title: string; date: string;
  context: string; question: string; options: Record<string, string>;
  difficulty: string;
}

interface ScenarioResult {
  outcome: string; user_choice: string; optimal: string;
  lesson: string; return_pct: number; is_optimal: boolean;
  all_returns: Record<string, number>; xp_earned: number;
}

type Difficulty = "principiante" | "intermedio" | "dificil" | "imposible";

const DIFF_CONFIG: Record<Difficulty, { label: string; color: string; icon: string; desc: string }> = {
  principiante: { label: "Principiante",  color: "#22c55e", icon: "leaf-outline",       desc: "Conceptos claros, contexto amigable" },
  intermedio:   { label: "Intermedio",    color: "#3b82f6", icon: "trending-up-outline", desc: "Escenarios reales de mercado" },
  dificil:      { label: "Difícil",       color: "#f59e0b", icon: "flame-outline",       desc: "Análisis avanzado, sin pistas" },
  imposible:    { label: "Imposible",     color: "#ef4444", icon: "nuclear-outline",     desc: "Nivel institucional. Prepárate." },
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function ArenaScreen() {
  const { colors } = useTheme();
  const { streak, completedToday, markTopicCompleted, initStreak } = useLearnStore();
  const subStore = useSubscriptionStore();
  const isPremiumAccess = hasPremiumAccess(subStore);

  const [difficulty, setDifficulty] = useState<Difficulty>("intermedio");
  const [hallOfFame, setHallOfFame] = useState<{ name: string; streak: number }[]>([]);
  const [simUsedToday, setSimUsedToday] = useState(0);
  const [paywallOpen, setPaywallOpen]   = useState(false);
  const [paywallReason, setPaywallReason]     = useState("");
  const [milestonesOpen, setMilestonesOpen]   = useState(false);

  const openPaywall = (reason: string) => { setPaywallReason(reason); setPaywallOpen(true); };

  useEffect(() => {
    initStreak();
    learnApi.getHallOfFame().then((r) => setHallOfFame(r.data.leaderboard ?? [])).catch(() => {});
  }, []);

  // ── Simulator state ──────────────────────────────────────────────────────
  const [simOpen, setSimOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simChoice, setSimChoice] = useState<string | null>(null);
  const [simResult, setSimResult] = useState<ScenarioResult | null>(null);


  const activeMilestones = isPremiumAccess ? STREAK_MILESTONES_PREMIUM : STREAK_MILESTONES;
  const currentMilestone = getMilestoneForStreak(streak, isPremiumAccess);
  const nextMilestone = getNextMilestone(streak, isPremiumAccess);
  const diffCfg = DIFF_CONFIG[difficulty];
  const returnColor = (pct: number) => pct > 0 ? "#22c55e" : pct < 0 ? "#ef4444" : "#9ca3af";

  // ── Simulator handlers ───────────────────────────────────────────────────

  const openSimulator = async () => {
    if (!isPremiumAccess && PREMIUM_DIFFICULTIES.has(difficulty))
      return openPaywall("Los niveles Difícil e Imposible son exclusivos de Premium.");
    if (!isPremiumAccess && simUsedToday >= FREE_SIM_LIMIT)
      return openPaywall(`Alcanzaste el límite de ${FREE_SIM_LIMIT} simulaciones diarias. Activa Premium para acceso ilimitado.`);
    setSimOpen(true); setSimLoading(true);
    setScenario(null); setSimChoice(null); setSimResult(null);
    try { const r = await learnApi.getScenario(difficulty); setScenario(r.data); } catch {}
    setSimLoading(false);
  };

  const submitSimChoice = async (choice: string) => {
    if (!scenario || simResult) return;
    setSimChoice(choice); setSimLoading(true);
    try {
      const r = await learnApi.submitScenarioResult(scenario.id, choice, difficulty);
      setSimResult(r.data);
      markTopicCompleted();
      if (!isPremiumAccess) setSimUsedToday(simUsedToday + 1);
    } catch {}
    setSimLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Streak card ───────────────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => setMilestonesOpen(true)}
          style={[styles.streakCard, { backgroundColor: colors.card, borderColor: completedToday ? "#f59e0b44" : colors.border }]}>
          <View style={styles.streakTop}>
            <View style={styles.streakLeft}>
              <Text style={styles.streakFire}>{completedToday ? "🔥" : "🌑"}</Text>
              <View>
                <Text style={[styles.streakNum, { color: completedToday ? "#f59e0b" : colors.textMuted }]}>
                  {streak} {streak === 1 ? "día" : "días"}
                </Text>
                <Text style={[styles.streakLabel, { color: colors.textDim }]}>
                  {completedToday ? "Racha activa" : "Aprende algo hoy"}
                </Text>
              </View>
            </View>
            {currentMilestone && (
              <View style={[styles.badgePill, { backgroundColor: "#f59e0b18", borderColor: "#f59e0b44" }]}>
                <Text style={{ color: "#f59e0b", fontSize: 11, fontWeight: "700" }}>{currentMilestone.reward.split(" ").slice(-1)[0]}</Text>
              </View>
            )}
          </View>

          {/* Progress to next milestone */}
          {nextMilestone && (
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  Próximo: {nextMilestone.reward}
                </Text>
                <Text style={{ color: colors.textDim, fontSize: 11 }}>
                  {streak}/{nextMilestone.days}
                </Text>
              </View>
              <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" }}>
                <View style={{ height: 4, borderRadius: 2, backgroundColor: "#f59e0b",
                  width: `${Math.min((streak / nextMilestone.days) * 100, 100)}%` }} />
              </View>
            </View>
          )}

          {/* Milestones list */}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {activeMilestones.map((m) => (
              <View key={m.days} style={[styles.milestonePill,
                { backgroundColor: streak >= m.days ? "#f59e0b18" : colors.border + "50",
                  borderColor: streak >= m.days ? "#f59e0b44" : "transparent" }]}>
                <Text style={{ color: streak >= m.days ? "#f59e0b" : colors.textDim, fontSize: 10, fontWeight: "700" }}>
                  {streak >= m.days ? "✓ " : ""}{m.days}d
                </Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>

        {/* ── Difficulty selector ───────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textDim }]}>NIVEL DE DIFICULTAD</Text>
        <View style={styles.diffRow}>
          {(Object.keys(DIFF_CONFIG) as Difficulty[]).map((d) => {
            const cfg = DIFF_CONFIG[d];
            const active = difficulty === d;
            const locked = !isPremiumAccess && PREMIUM_DIFFICULTIES.has(d);
            return (
              <TouchableOpacity key={d}
                style={[styles.diffBtn, { borderColor: active ? cfg.color : colors.border,
                  backgroundColor: active ? cfg.color + "15" : colors.card,
                  opacity: locked ? 0.55 : 1 }]}
                onPress={() => locked
                  ? openPaywall("Los niveles Difícil e Imposible son exclusivos de Premium.")
                  : setDifficulty(d)}>
                {locked
                  ? <Ionicons name="lock-closed" size={14} color={colors.textDim} />
                  : <Ionicons name={cfg.icon as any} size={16} color={active ? cfg.color : colors.textMuted} />}
                <Text style={{ color: active ? cfg.color : locked ? colors.textDim : colors.textMuted, fontSize: 11, fontWeight: "700", marginTop: 4 }}>
                  {cfg.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={[styles.diffDesc, { color: colors.textDim }]}>{diffCfg.desc}</Text>

        {/* ── Game cards ────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textDim }]}>JUEGOS</Text>
        <View style={styles.gameRow}>
          <TouchableOpacity style={[styles.gameCard, { backgroundColor: colors.card, borderColor: "#8b5cf644" }]}
            onPress={openSimulator} activeOpacity={0.75}>
            <View style={[styles.gameIcon, { backgroundColor: "#8b5cf618" }]}>
              <Ionicons name="time-outline" size={26} color="#8b5cf6" />
            </View>
            <Text style={[styles.gameTitle, { color: colors.text }]}>Simulador</Text>
            <Text style={[styles.gameDesc, { color: colors.textMuted }]}>
              Toma decisiones en escenarios históricos reales
            </Text>
            <View style={[styles.diffTag, { backgroundColor: diffCfg.color + "18" }]}>
              <Text style={{ color: diffCfg.color, fontSize: 10, fontWeight: "700" }}>{diffCfg.label}</Text>
            </View>
            {!isPremiumAccess && (
              <Text style={{ color: simUsedToday >= FREE_SIM_LIMIT ? "#ef4444" : colors.textDim, fontSize: 10, marginTop: 6, fontWeight: "600" }}>
                {simUsedToday >= FREE_SIM_LIMIT ? "Límite diario alcanzado" : `${FREE_SIM_LIMIT - simUsedToday}/${FREE_SIM_LIMIT} restantes hoy`}
              </Text>
            )}
          </TouchableOpacity>

        </View>

        {/* ── Hall of Fame ──────────────────────────────────────────── */}
        {/* Diario de Decisiones */}
        <MobileDecisionDiary
          isPremium={isPremiumAccess}
          onUpgrade={() => openPaywall("Activa Premium para registrar tus decisiones y detectar tus sesgos.")}
        />

        <Text style={[styles.sectionTitle, { color: colors.textDim }]}>🏆 HALL OF FAME</Text>
        <View style={[styles.hofCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {hallOfFame.length === 0 ? (
            <View style={{ alignItems: "center", padding: 24 }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>🏆</Text>
              <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>
                Sé el primero en aparecer aquí.{"\n"}Mantén una racha de 10+ días.
              </Text>
            </View>
          ) : (
            hallOfFame.map((entry, i) => (
              <View key={i} style={[styles.hofRow, { borderBottomColor: colors.border,
                borderBottomWidth: i < hallOfFame.length - 1 ? 1 : 0 }]}>
                <Text style={[styles.hofRank, { color: i < 3 ? ["#f59e0b","#9ca3af","#cd7f32"][i] : colors.textDim }]}>
                  {i < 3 ? ["🥇","🥈","🥉"][i] : `${i + 1}.`}
                </Text>
                <Text style={[styles.hofName, { color: colors.text }]}>{entry.name}</Text>
                <View style={styles.hofStreak}>
                  <Text style={styles.hofFire}>🔥</Text>
                  <Text style={[styles.hofStreakNum, { color: "#f59e0b" }]}>{entry.streak}</Text>
                </View>
              </View>
            ))
          )}
        </View>

      </ScrollView>

      {/* ── Simulator Modal ─────────────────────────────────────────────── */}
      <Modal visible={simOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSimOpen(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setSimOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              ⏳ Simulador · <Text style={{ color: diffCfg.color }}>{diffCfg.label}</Text>
            </Text>
            <View style={{ width: 22 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {simLoading && !scenario ? (
              <View style={styles.loading}>
                <ActivityIndicator color="#8b5cf6" size="large" />
                <Text style={{ color: colors.textMuted, marginTop: 12 }}>Cargando escenario...</Text>
              </View>
            ) : scenario ? (
              <View>
                <View style={[styles.scenarioCtx, { backgroundColor: "#8b5cf610", borderColor: "#8b5cf630" }]}>
                  <Text style={{ color: "#8b5cf6", fontSize: 11, fontWeight: "700", letterSpacing: 1 }}>{scenario.date.toUpperCase()}</Text>
                  <Text style={[styles.scenarioTitle, { color: colors.text }]}>{scenario.title}</Text>
                  <Text style={{ color: colors.textSub, fontSize: 14, lineHeight: 22 }}>{scenario.context}</Text>
                </View>
                <Text style={[styles.scenarioQ, { color: colors.text }]}>{scenario.question}</Text>

                {!simResult ? (
                  Object.entries(scenario.options).map(([key, label]) => {
                    const active = simChoice === key;
                    return (
                      <TouchableOpacity key={key}
                        style={[styles.optionBtn, { borderColor: active ? "#8b5cf6" : colors.border,
                          backgroundColor: active ? "#8b5cf610" : colors.card,
                          opacity: simChoice && !active ? 0.45 : 1 }]}
                        onPress={() => submitSimChoice(key)} disabled={!!simChoice}>
                        <View style={[styles.optionLetter, { backgroundColor: active ? "#8b5cf6" : colors.border }]}>
                          <Text style={{ color: active ? "white" : colors.textSub, fontWeight: "800" }}>{key}</Text>
                        </View>
                        <Text style={{ flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 }}>{label}</Text>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  <View>
                    <View style={[styles.resultBox, { backgroundColor: simResult.is_optimal ? "#22c55e10" : "#f59e0b10",
                      borderColor: simResult.is_optimal ? "#22c55e44" : "#f59e0b44" }]}>
                      <Text style={{ color: simResult.is_optimal ? "#22c55e" : "#f59e0b", fontWeight: "800", fontSize: 15, marginBottom: 8 }}>
                        {simResult.is_optimal ? "✅ ¡Decisión óptima!" : "📊 Lo que pasó realmente"}
                      </Text>
                      <Text style={{ color: colors.textSub, fontSize: 13, lineHeight: 20 }}>{simResult.outcome}</Text>
                    </View>

                    <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700", marginBottom: 4 }}>
                        TU ELECCIÓN ({simResult.user_choice}) · {difficulty.toUpperCase()}
                      </Text>
                      <Text style={{ color: returnColor(simResult.return_pct), fontSize: 26, fontWeight: "800" }}>
                        {simResult.return_pct > 0 ? "+" : ""}{simResult.return_pct}%
                      </Text>
                      <Text style={{ color: colors.textSub, fontSize: 13, marginTop: 8, lineHeight: 19 }}>{simResult.lesson}</Text>
                      <View style={[styles.xpBadge, { backgroundColor: "#f59e0b15", borderColor: "#f59e0b44" }]}>
                        <Text style={{ color: "#f59e0b", fontSize: 12, fontWeight: "700" }}>+{simResult.xp_earned} XP</Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 20 }}>
                      {Object.entries(simResult.all_returns).map(([k, v]) => (
                        <View key={k} style={[styles.retCell, { backgroundColor: colors.card, borderColor: k === simResult.optimal ? "#22c55e44" : colors.border }]}>
                          <Text style={{ color: k === simResult.optimal ? "#22c55e" : colors.textMuted, fontSize: 11, fontWeight: "700" }}>{k}</Text>
                          <Text style={{ color: returnColor(v as number), fontSize: 14, fontWeight: "800", marginTop: 2 }}>
                            {(v as number) > 0 ? "+" : ""}{v}%
                          </Text>
                        </View>
                      ))}
                    </View>

                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#8b5cf6" }]} onPress={openSimulator}>
                      <Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>Otro escenario</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {simLoading && simChoice && (
                  <View style={{ alignItems: "center", marginTop: 20 }}>
                    <ActivityIndicator color="#8b5cf6" />
                  </View>
                )}
              </View>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Milestones Modal ─────────────────────────────────────────── */}
      <Modal visible={milestonesOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMilestonesOpen(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setMilestonesOpen(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: colors.text }]}>🔥 Recompensas por Racha</Text>
            <View style={{ width: 22 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }}>
            {/* Current streak summary */}
            <View style={[styles.resultBox, { backgroundColor: completedToday ? "#f59e0b10" : colors.card, borderColor: completedToday ? "#f59e0b44" : colors.border, alignItems: "center", marginBottom: 24 }]}>
              <Text style={{ fontSize: 48, marginBottom: 4 }}>{completedToday ? "🔥" : "🌑"}</Text>
              <Text style={{ color: completedToday ? "#f59e0b" : colors.textMuted, fontSize: 32, fontWeight: "800" }}>
                {streak} {streak === 1 ? "día" : "días"}
              </Text>
              <Text style={{ color: colors.textDim, fontSize: 13, marginTop: 4 }}>
                {completedToday ? "¡Racha activa hoy!" : "Aprende algo hoy para mantener tu racha"}
              </Text>
            </View>

            {/* Milestones list */}
            <Text style={[styles.sectionTitle, { color: colors.textDim, marginTop: 0 }]}>OBJETIVOS</Text>
            {activeMilestones.map((m, i) => {
              const achieved = streak >= m.days;
              const isNext = !achieved && (i === 0 || streak >= activeMilestones[i - 1].days);
              const progress = Math.min(streak / m.days, 1);
              return (
                <View key={m.days} style={[styles.resultBox, {
                  backgroundColor: achieved ? "#f59e0b10" : colors.card,
                  borderColor: achieved ? "#f59e0b44" : isNext ? "#f59e0b22" : colors.border,
                  marginBottom: 12,
                }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                    <Text style={{ fontSize: 28, marginRight: 12 }}>
                      {achieved ? "✅" : isNext ? "🎯" : "🔒"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: achieved ? "#f59e0b" : colors.text, fontSize: 16, fontWeight: "800" }}>
                        {m.days} días seguidos
                      </Text>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                        {achieved ? "¡Conseguido!" : isNext ? `Te faltan ${m.days - streak} días` : `${m.days - streak} días restantes`}
                      </Text>
                    </View>
                  </View>

                  {/* Progress bar */}
                  {!achieved && (
                    <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden", marginBottom: 12 }}>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: "#f59e0b", width: `${progress * 100}%` }} />
                    </View>
                  )}

                  {/* Rewards */}
                  <View style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={[styles.diffTag, { backgroundColor: "#22c55e18" }]}>
                        <Text style={{ color: "#22c55e", fontSize: 11, fontWeight: "700" }}>RECOMPENSA</Text>
                      </View>
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 }}>{m.reward}</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={[styles.diffTag, { backgroundColor: "#8b5cf618" }]}>
                        <Text style={{ color: "#8b5cf6", fontSize: 11, fontWeight: "700" }}>BONUS</Text>
                      </View>
                      <Text style={{ color: colors.textSub, fontSize: 13, flex: 1 }}>{m.bonus}</Text>
                    </View>
                  </View>
                </View>
              );
            })}

            <View style={{ height: 20 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={paywallReason} />

    </SafeAreaView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 14, paddingBottom: 40 },
  sectionTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 1.2, marginTop: 20, marginBottom: 8, marginLeft: 2 },

  streakCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 4 },
  streakTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  streakLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  streakFire: { fontSize: 32 },
  streakNum: { fontSize: 20, fontWeight: "800" },
  streakLabel: { fontSize: 11, marginTop: 2 },
  badgePill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  milestonePill: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },

  diffRow: { flexDirection: "row", gap: 8 },
  diffBtn: { flex: 1, alignItems: "center", borderRadius: 12, borderWidth: 1.5, paddingVertical: 12, paddingHorizontal: 4 },
  diffDesc: { fontSize: 11, marginTop: 6, marginLeft: 2, marginBottom: 4 },

  gameRow: { flexDirection: "row", gap: 12 },
  gameCard: { flex: 1, borderRadius: 16, borderWidth: 1.5, padding: 16, alignItems: "center" },
  gameIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  gameTitle: { fontSize: 15, fontWeight: "800", marginBottom: 6, textAlign: "center" },
  gameDesc: { fontSize: 11, textAlign: "center", lineHeight: 16, marginBottom: 10 },
  diffTag: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },

  hofCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  hofRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
  hofRank: { width: 32, fontSize: 18, fontWeight: "800" },
  hofName: { flex: 1, fontSize: 14, fontWeight: "600" },
  hofStreak: { flexDirection: "row", alignItems: "center", gap: 4 },
  hofFire: { fontSize: 14 },
  hofStreakNum: { fontSize: 15, fontWeight: "800" },

  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  loading: { alignItems: "center", marginTop: 60 },

  scenarioCtx: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  scenarioTitle: { fontSize: 18, fontWeight: "800", marginVertical: 8 },
  scenarioQ: { fontSize: 16, fontWeight: "700", marginBottom: 16 },
  optionBtn: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14, marginBottom: 10 },
  optionLetter: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  resultBox: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 14 },
  xpBadge: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, alignSelf: "flex-start", marginTop: 10 },
  retCell: { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10, alignItems: "center" },
  actionBtn: { borderRadius: 14, padding: 16, alignItems: "center", marginTop: 4 },

  thesisInput: { borderRadius: 14, borderWidth: 1, padding: 14, fontSize: 14, minHeight: 90, textAlignVertical: "top", marginBottom: 16 },
  bubble: { maxWidth: "88%", borderRadius: 16, padding: 14 },
  inputRow: { flexDirection: "row", gap: 10, padding: 14, borderTopWidth: 1 },
  chatInput: { flex: 1, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, maxHeight: 100 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", alignSelf: "flex-end" },
});
