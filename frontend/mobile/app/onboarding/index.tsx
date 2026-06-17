import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { profileApi } from "../../src/lib/api";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import { useAppStore, RISK_CONFIG } from "../../src/lib/profileStore";
import type { QuizAnswer } from "../../src/lib/profileStore";
import { MENTORS, RECOMMENDED_MENTOR } from "../../src/lib/mentorData";
import { useSubscriptionStore } from "../../src/lib/subscriptionStore";
import PaywallModal from "../../src/components/PaywallModal";

// ─── Types ────────────────────────────────────────────────────────────────────

type RiskTolerance = "conservative" | "moderate" | "aggressive";

// ─── Quiz (only 2 questions, matching web) ────────────────────────────────────

const QUIZ: { key: "q1" | "q4"; num: string; category: string; question: string; options: Record<QuizAnswer, string> }[] = [
  {
    key: "q1", num: "01", category: "MENTALIDAD",
    question: "Tu portafolio cae 35% en 3 meses por una crisis del mercado. ¿Qué haces?",
    options: {
      A: "Vendo todo antes de perder más",
      B: "Espero a que se recupere, pero no compro más",
      C: "Reviso si los fundamentos siguen sólidos y mantengo",
      D: "Aprovecho para comprar más a precios bajos",
    },
  },
  {
    key: "q4", num: "04", category: "RIESGO",
    question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
    options: {
      A: "Ganar $5K seguro, sin posibilidad de perder nada",
      B: "Ganar $15K probable, con riesgo de perder $5K",
      C: "Ganar $40K posible, con riesgo de perder $20K",
      D: "Ganar $120K posible, con riesgo de perder todo",
    },
  },
];

const QUIZ_LABELS: Record<"q1" | "q4", Record<QuizAnswer, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera pasivamente", C: "Analiza y mantiene", D: "Compra las caídas" },
  q4: { A: "$5K seguro", B: "$15K / riesgo $5K", C: "$40K / riesgo $20K", D: "$120K / riesgo total" },
};

// ─── Risk calculation (identical to web) ─────────────────────────────────────

function calculateRisk(answers: { q1: string; q4: string }): RiskTolerance {
  const scoreMap: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const scores = (Object.values(answers) as string[])
    .filter((v): v is QuizAnswer => ["A", "B", "C", "D"].includes(v))
    .map((a) => scoreMap[a]);
  if (scores.length === 0) return "moderate";
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg <= 2.0) return "conservative";
  if (avg <= 3.0) return "moderate";
  return "aggressive";
}

const RISK_EXTRA: Record<"conservative" | "moderate" | "aggressive", { emoji: string; desc: string }> = {
  conservative: { emoji: "🛡️", desc: "Priorizas la preservación del capital. Prefieres rendimientos modestos con baja volatilidad." },
  moderate:     { emoji: "⚖️", desc: "Equilibras crecimiento y seguridad. Aceptas oscilaciones moderadas por mejores retornos." },
  aggressive:   { emoji: "🚀", desc: "Buscas máximo crecimiento. Toleras volatilidad alta a cambio de retornos superiores." },
};

// ─── Mentor photos ────────────────────────────────────────────────────────────

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

// ─── Form state ───────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  age: string;
  monthly_contribution: string;
  investment_amount: string;
  investment_goal_amount: string;
  investment_goal: string;
  knowledge_level: QuizAnswer | "";
  q1: QuizAnswer | "";
  q4: QuizAnswer | "";
  mentor: string;
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const { colors, isDark, toggle } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const setProfile = useAppStore((state) => state.setProfile);
  const isPremium  = useSubscriptionStore((s) => s.tier === "premium");

  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [paywallOpen, setPaywallOpen]             = useState(false);
  const [acceptedTerms, setAcceptedTerms]         = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", age: "", monthly_contribution: "",
    investment_amount: "", investment_goal_amount: "", investment_goal: "",
    knowledge_level: "", q1: "", q4: "", mentor: "",
  });

  const quizAnswers = { q1: form.q1, q4: form.q4 };
  const calculated  = calculateRisk(quizAnswers);
  const riskCfg     = RISK_CONFIG[calculated];
  const pct         = Math.round(riskCfg.pct * 100);
  const firstName   = form.name.trim().split(" ")[0];

  // ── Quiz steps ─────────────────────────────────────────────────────────────

  const quizSteps = QUIZ.map((q) => ({
    title: `${q.num} · ${q.category}`,
    isValid: () => !!form[q.key],
    content: (
      <View style={s.fields}>
        <Text style={[s.questionText, { color: colors.text }]}>{q.question}</Text>
        {(["A", "B", "C", "D"] as QuizAnswer[]).map((letter) => {
          const selected = form[q.key] === letter;
          return (
            <TouchableOpacity
              key={letter}
              style={[s.option, selected && s.optionActive]}
              onPress={() => setForm((f) => ({ ...f, [q.key]: letter }))}
              activeOpacity={0.75}
            >
              <View style={[s.letterBadge, selected && { backgroundColor: colors.accentLight }]}>
                <Text style={[s.letterText, selected && { color: "white" }]}>{letter}</Text>
              </View>
              <Text style={[s.optionLabel, { color: selected ? colors.text : colors.textSub }]}>
                {q.options[letter]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    ),
  }));

  // ── All steps ──────────────────────────────────────────────────────────────

  const STEPS = [
    // 0 — Nombre
    {
      title: "¡Bienvenido! ¿Cómo te llamas?",
      isValid: () => form.name.trim().length >= 2,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Tu nombre completo</Text>
          <TextInput
            style={s.input} value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="Ej. Diego Arria" placeholderTextColor={colors.placeholder}
            autoCapitalize="words" autoFocus
          />
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Así te llamaremos en la app y la IA sabrá cómo dirigirse a ti.
          </Text>
        </View>
      ),
    },
    // 1 — Perfil personal
    {
      title: `Cuéntanos sobre ti, ${firstName || "tú"}`,
      isValid: () => {
        const age = parseInt(form.age);
        const contrib = parseFloat(form.monthly_contribution);
        return age >= 18 && age <= 90 && contrib > 0;
      },
      content: (
        <View style={s.fields}>
          <Text style={s.label}>¿Cuántos años tienes?</Text>
          <TextInput
            style={s.input} value={form.age}
            onChangeText={(v) => setForm((f) => ({ ...f, age: v }))}
            placeholder="Ej. 28" placeholderTextColor={colors.placeholder}
            keyboardType="numeric"
          />
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Tu edad ayuda a la IA a calibrar tu horizonte de inversión.
          </Text>

          <Text style={[s.label, { marginTop: 16 }]}>¿Cuánto puedes invertir cada mes?</Text>
          <View style={s.prefixWrap}>
            <Text style={[s.prefix, { color: colors.textMuted }]}>$</Text>
            <TextInput
              style={[s.input, s.prefixInput, { color: colors.text }]}
              value={form.monthly_contribution}
              onChangeText={(v) => setForm((f) => ({ ...f, monthly_contribution: v }))}
              placeholder="500" placeholderTextColor={colors.placeholder}
              keyboardType="numeric"
            />
          </View>
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Tu aportación mensual recurrente en USD. Puedes cambiarlo después.
          </Text>
        </View>
      ),
    },
    // 2 — Meta financiera
    {
      title: "Tu meta financiera",
      isValid: () => {
        const amt  = parseFloat(form.investment_amount);
        const goal = parseFloat(form.investment_goal_amount);
        return amt > 0 && goal > 0 && !!form.investment_goal && !!form.knowledge_level;
      },
      content: (
        <View style={s.fields}>
          {/* Capital disponible */}
          <Text style={s.label}>¿Cuánto tienes disponible para invertir hoy?</Text>
          <View style={s.prefixWrap}>
            <Text style={[s.prefix, { color: colors.textMuted }]}>$</Text>
            <TextInput
              style={[s.input, s.prefixInput, { color: colors.text }]}
              value={form.investment_amount}
              onChangeText={(v) => setForm((f) => ({ ...f, investment_amount: v }))}
              placeholder="5,000" placeholderTextColor={colors.placeholder}
              keyboardType="numeric"
            />
          </View>

          {/* Meta en $ */}
          <Text style={[s.label, { marginTop: 16 }]}>¿A cuánto quieres llegar?</Text>
          <View style={s.prefixWrap}>
            <Text style={[s.prefix, { color: colors.textMuted }]}>$</Text>
            <TextInput
              style={[s.input, s.prefixInput, { color: colors.text }]}
              value={form.investment_goal_amount}
              onChangeText={(v) => setForm((f) => ({ ...f, investment_goal_amount: v }))}
              placeholder="50,000" placeholderTextColor={colors.placeholder}
              keyboardType="numeric"
            />
          </View>
          <Text style={[s.hint, { color: colors.textMuted }]}>
            La app mostrará tu progreso hacia esta meta en tiempo real.
          </Text>

          {/* Tipo de meta */}
          <Text style={[s.label, { marginTop: 16 }]}>¿Para qué es esta meta?</Text>
          <View style={s.goalGrid}>
            {[
              { value: "emergency_fund", label: "Fondo de emergencia" },
              { value: "big_purchase",   label: "Compra importante" },
              { value: "retirement",     label: "Retiro / pensión" },
              { value: "independence",   label: "Independencia financiera" },
            ].map((opt) => {
              const active = form.investment_goal === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.goalChip, { borderColor: active ? colors.accentLight : colors.border, backgroundColor: active ? colors.accentLight + "18" : colors.card }]}
                  onPress={() => setForm((f) => ({ ...f, investment_goal: opt.value }))}
                  activeOpacity={0.75}
                >
                  <Text style={[s.goalChipText, { color: active ? colors.accentLight : colors.textSub }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Nivel de conocimiento */}
          <Text style={[s.label, { marginTop: 16 }]}>¿Cómo describes tu experiencia con inversiones?</Text>
          {[
            { value: "A" as QuizAnswer, label: "Sin experiencia — empiezo de cero" },
            { value: "B" as QuizAnswer, label: "Conozco lo básico (CETES, fondos indexados)" },
            { value: "C" as QuizAnswer, label: "Tengo experiencia (ETFs, acciones)" },
            { value: "D" as QuizAnswer, label: "Avanzado — análisis, derivados, ciclos" },
          ].map((opt) => {
            const active = form.knowledge_level === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[s.option, active && s.optionActive]}
                onPress={() => setForm((f) => ({ ...f, knowledge_level: opt.value }))}
                activeOpacity={0.75}
              >
                <View style={[s.letterBadge, active && { backgroundColor: colors.accentLight }]}>
                  <Text style={[s.letterText, active && { color: "white" }]}>{opt.value}</Text>
                </View>
                <Text style={[s.optionLabel, { color: active ? colors.text : colors.textSub }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ),
    },
    // 3–4 — Quiz (2 preguntas, igual que web)
    ...quizSteps,
    // 5 — Reveal
    {
      title: `Tu perfil, ${firstName || "!"}`,
      isValid: () => true,
      content: (
        <View style={s.fields}>
          <Text style={[s.hint, { color: colors.textMuted, marginBottom: 8 }]}>
            Analizamos tus respuestas para determinar tu perfil de inversionista real.
          </Text>

          {/* Risk card */}
          <View style={[s.revealCard, { borderColor: riskCfg.color + "55" }]}>
            <Text style={{ fontSize: 44, marginBottom: 8 }}>{RISK_EXTRA[calculated].emoji}</Text>
            <Text style={[s.revealType, { color: colors.text }]}>{riskCfg.label}</Text>
            <Text style={[s.revealDesc, { color: colors.textMuted }]}>{RISK_EXTRA[calculated].desc}</Text>
            <View style={[s.barTrack, { backgroundColor: colors.border }]}>
              <View style={[s.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
              {pct < 100 && <View style={{ flex: 100 - pct }} />}
            </View>
            <View style={s.barLabels}>
              <Text style={[s.barLabel, { color: colors.textDim }]}>Bajo riesgo</Text>
              <Text style={[s.barLabel, { color: colors.textDim }]}>Alto riesgo</Text>
            </View>
          </View>

          {/* Quiz summary (solo q1 y q4) */}
          <Text style={[s.factorsTitle, { color: colors.textSub }]}>Resumen de tus respuestas</Text>
          {QUIZ.map((q) => {
            const answer = form[q.key] as QuizAnswer;
            return (
              <View key={q.key} style={[s.factorRow, { borderColor: colors.border }]}>
                <Text style={[s.factorLabel, { color: colors.textMuted }]}>{q.category}</Text>
                <View style={s.factorRight}>
                  <View style={[s.factorBadge, { backgroundColor: colors.accentLight }]}>
                    <Text style={s.factorBadgeText}>{answer}</Text>
                  </View>
                  <Text style={[s.factorValue, { color: colors.text }]}>
                    {answer ? QUIZ_LABELS[q.key][answer] : "—"}
                  </Text>
                </View>
              </View>
            );
          })}

          {/* Financial summary */}
          <Text style={[s.factorsTitle, { color: colors.textSub, marginTop: 16 }]}>Datos financieros</Text>
          {[
            { label: "Nombre",          value: form.name },
            { label: "Capital inicial", value: `$${Number(form.investment_amount).toLocaleString()}` },
            { label: "Meta",            value: `$${Number(form.investment_goal_amount).toLocaleString()}` },
          ].map((f) => (
            <View key={f.label} style={[s.factorRow, { borderColor: colors.border }]}>
              <Text style={[s.factorLabel, { color: colors.textMuted }]}>{f.label}</Text>
              <Text style={[s.factorValue, { color: colors.text }]}>{f.value}</Text>
            </View>
          ))}
        </View>
      ),
    },
    // 6 — ROI projection (lump sum, igual que web)
    {
      title: `Tu meta: $${Number(form.investment_goal_amount || 0).toLocaleString()}`,
      isValid: () => true,
      content: (() => {
        const pv       = Math.max(parseFloat(form.investment_amount) || 1000, 1);
        const goalAmt  = Math.max(parseFloat(form.investment_goal_amount) || pv * 3, pv + 1);
        const annualRate = calculated === "conservative" ? 0.07 : calculated === "moderate" ? 0.10 : 0.12;
        const rateLabel  = calculated === "conservative" ? "7%" : calculated === "moderate" ? "10%" : "12%";
        const r = annualRate / 12;
        const proj = [12, 60, 120].map((months) => ({
          years: months / 12,
          fv: Math.round(pv * Math.pow(1 + r, months)),
        }));
        const maxFV = Math.max(proj[2].fv, goalAmt);
        const monthsToGoal = Math.log(goalAmt / pv) / Math.log(1 + r);
        const yearsToGoal  = monthsToGoal / 12;
        const timeLabel = yearsToGoal < 1
          ? `${Math.ceil(monthsToGoal)} meses`
          : yearsToGoal < 1.83 ? "~1 año y medio"
          : `~${Math.round(yearsToGoal)} años`;

        return (
          <View style={{ gap: 16 }}>
            {/* Projection bars */}
            <View style={[s.revealCard, { alignItems: "stretch" }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={[s.factorsTitle, { color: colors.textSub, marginBottom: 0 }]}>
                  ${pv.toLocaleString()} → Meta: ${goalAmt.toLocaleString()}
                </Text>
                <View style={{ backgroundColor: riskCfg.color + "22", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: riskCfg.color, fontSize: 10, fontWeight: "700" }}>~{rateLabel}/año</Text>
                </View>
              </View>

              {proj.map(({ years, fv }) => {
                const barPct  = Math.min((fv / maxFV) * 100, 100);
                const goalPct = Math.min((goalAmt / maxFV) * 100, 100);
                return (
                  <View key={years} style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                      <Text style={{ color: colors.textSub, fontSize: 12 }}>
                        {years} año{years !== 1 ? "s" : ""}
                      </Text>
                      <Text style={{ color: fv >= goalAmt ? "#22c55e" : colors.text, fontSize: 13, fontWeight: "800" }}>
                        ${fv.toLocaleString()}
                      </Text>
                    </View>
                    <View style={{ height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row", backgroundColor: colors.border }}>
                      {/* Goal marker line */}
                      <View style={{ position: "absolute", top: 0, bottom: 0, left: `${goalPct}%` as any, width: 2, backgroundColor: "#22c55e", zIndex: 2, opacity: 0.8 }} />
                      <View style={{ width: `${barPct}%` as any, backgroundColor: fv >= goalAmt ? "#22c55e" : riskCfg.color, height: "100%", borderRadius: 5 }} />
                    </View>
                  </View>
                );
              })}

              {/* Time to goal */}
              <View style={{ backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 14, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: "rgba(34,197,94,0.25)" }}>
                <Text style={{ fontSize: 18 }}>🎯</Text>
                <Text style={{ color: "#22c55e", fontSize: 13, fontWeight: "600", flex: 1 }}>
                  A tasa del {rateLabel}/año, alcanzas tu meta en {timeLabel}
                </Text>
              </View>
              <Text style={{ color: colors.textDim, fontSize: 10, fontStyle: "italic", marginTop: 8 }}>
                * Ilustrativo. Basado en promedios históricos del mercado. No garantiza rendimientos futuros.
              </Text>
            </View>

            {/* Features */}
            <Text style={[s.factorsTitle, { color: colors.textSub }]}>Nuvos AI trabaja contigo</Text>
            {[
              { icon: "🤖", title: "IA que conoce tu perfil",   sub: "Análisis personalizado según tu tolerancia al riesgo" },
              { icon: "📰", title: "Noticias de tus acciones",  sub: "Solo lo relevante para empresas que posees o sigues" },
              { icon: "🔔", title: "Guardian del domingo",      sub: "Revisión semanal automática con alertas accionables" },
              { icon: "📄", title: "Paper trading sin riesgo",  sub: "Practica estrategias reales sin dinero en juego" },
            ].map((f) => (
              <View key={f.title} style={[s.featureRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={{ fontSize: 20, flexShrink: 0 }}>{f.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>{f.title}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 1, lineHeight: 16 }}>{f.sub}</Text>
                </View>
              </View>
            ))}

            {/* Value pill */}
            <View style={[s.revealCard, { borderColor: "rgba(0,168,94,0.3)", backgroundColor: "rgba(0,168,94,0.06)", alignItems: "center" }]}>
              <Text style={{ fontSize: 28, fontWeight: "900", color: colors.accentLight }}>$0.43 / día</Text>
              <Text style={{ color: colors.textSub, fontSize: 12, marginTop: 4, textAlign: "center" }}>
                Nuvos AI Premium · menos que un café ☕
              </Text>
              <Text style={{ color: colors.textDim, fontSize: 10, marginTop: 2 }}>$12.99/mes · cancela cuando quieras</Text>
            </View>
          </View>
        );
      })(),
    },
    // 7 — Mentor (mobile exclusive)
    {
      title: "¿Con qué estilo quieres que te asesore?",
      isValid: () => true,
      content: (
        <View style={s.fields}>
          <Text style={[s.hint, { color: colors.textMuted, marginBottom: 4 }]}>
            La IA adoptará el marco de pensamiento de tu mentor. Puedes cambiarlo después desde tu perfil.
          </Text>
          <View style={s.mentorGrid}>
            {MENTORS.map((m) => {
              const isSelected = form.mentor === m.id;
              const isRec      = RECOMMENDED_MENTOR[calculated] === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    s.mentorCard,
                    { borderColor: isSelected ? m.color : colors.border },
                    isSelected && { backgroundColor: m.color + "18" },
                    !isPremium && { opacity: 0.6 },
                  ]}
                  onPress={() => {
                    if (!isPremium) { setPaywallOpen(true); return; }
                    setForm((f) => ({ ...f, mentor: m.id }));
                  }}
                  activeOpacity={0.75}
                >
                  {isRec && (
                    <View style={[s.recBadge, { backgroundColor: m.color }]}>
                      <Text style={s.recBadgeText}>⭐ RECOMENDADO</Text>
                    </View>
                  )}
                  {!isPremium && (
                    <View style={s.mentorLockBadge}>
                      <Ionicons name="star" size={9} color="#f59e0b" />
                      <Text style={s.mentorLockText}>Premium</Text>
                    </View>
                  )}
                  {MENTOR_PHOTOS[m.id] ? (
                    <Image source={MENTOR_PHOTOS[m.id]} style={s.mentorPhoto} />
                  ) : (
                    <View style={[s.mentorAvatarBox, { backgroundColor: m.color + "22" }]}>
                      <Text style={s.mentorEmoji}>{m.emoji}</Text>
                    </View>
                  )}
                  <Text style={[s.mentorName, { color: colors.text }]}>{m.name}</Text>
                  <Text style={[s.mentorTitle, { color: colors.textMuted }]}>{m.title}</Text>
                  <View style={[s.mentorBadgePill, { backgroundColor: m.color + "22" }]}>
                    <Text style={[s.mentorBadgeLabel, { color: m.color }]}>{m.badge}</Text>
                  </View>
                  {m.principles.map((p, i) => (
                    <Text key={i} style={[s.mentorPrinciple, { color: colors.textSub }]}>• {p}</Text>
                  ))}
                  {isSelected && (
                    <View style={[s.selectedCheck, { backgroundColor: m.color }]}>
                      <Ionicons name="checkmark" size={12} color="white" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[
              s.noMentorCard,
              { borderColor: form.mentor === "none" ? "#6b7280" : colors.border },
              form.mentor === "none" && { backgroundColor: "rgba(107,114,128,0.1)" },
            ]}
            onPress={() => setForm((f) => ({ ...f, mentor: "none" }))}
            activeOpacity={0.75}
          >
            <View style={s.noMentorLeft}>
              <Text style={{ fontSize: 22 }}>🤖</Text>
              <View>
                <Text style={[s.noMentorTitle, { color: colors.text }]}>Sin mentor</Text>
                <Text style={[s.noMentorSub, { color: colors.textMuted }]}>IA neutral — análisis imparcial sin estilo fijo</Text>
              </View>
            </View>
            {form.mentor === "none" && (
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: "#6b7280", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="checkmark" size={12} color="white" />
              </View>
            )}
          </TouchableOpacity>

          <Text style={s.label}>¿Prefieres otro inversor?</Text>
          <TextInput
            style={s.input}
            value={MENTORS.some((m) => m.id === form.mentor) || form.mentor === "none" ? "" : form.mentor}
            onChangeText={(v) => setForm((f) => ({ ...f, mentor: v }))}
            placeholder="Ej. Charlie Munger, Benjamin Graham…"
            placeholderTextColor={colors.placeholder}
          />
        </View>
      ),
    },
    // 8 — Legal
    {
      title: "Antes de empezar",
      isValid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <View style={{ gap: 16 }}>
          <View style={[s.legalBox, { borderColor: "rgba(245,158,11,0.35)", backgroundColor: "rgba(245,158,11,0.07)" }]}>
            <Text style={[s.legalBadge, { color: "#f59e0b" }]}>⚠️ HERRAMIENTA EDUCATIVA — NO ASESORÍA FINANCIERA</Text>
            <Text style={[s.legalBody, { color: colors.textSub }]}>
              Nuvos AI es una plataforma de{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>educación e información financiera</Text>.
              El análisis de la IA, los portafolios simulados y el paper trading son{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>únicamente educativos</Text> y no constituyen
              asesoramiento financiero, de inversión, legal ni fiscal regulado.
            </Text>
            <Text style={[s.legalBody, { color: colors.textSub, marginTop: 6 }]}>
              Los datos pueden ser inexactos o retrasados. El rendimiento pasado no garantiza resultados futuros.{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>Nunca tomes decisiones de inversión basándote únicamente en esta app.</Text>
            </Text>
          </View>

          <TouchableOpacity style={s.checkRow} onPress={() => setAcceptedTerms((v) => !v)} activeOpacity={0.7}>
            <View style={[s.checkbox, { borderColor: acceptedTerms ? colors.accent : colors.border, backgroundColor: acceptedTerms ? colors.accent : "transparent" }]}>
              {acceptedTerms && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={[s.checkLabel, { color: colors.textSub }]}>
              He leído y acepto los{" "}
              <Text style={{ color: colors.accentLight, textDecorationLine: "underline" }}>Términos de Uso</Text>
              {" "}y la{" "}
              <Text style={{ color: colors.accentLight, textDecorationLine: "underline" }}>Política de Privacidad</Text>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.checkRow} onPress={() => setAcceptedDisclaimer((v) => !v)} activeOpacity={0.7}>
            <View style={[s.checkbox, { borderColor: acceptedDisclaimer ? colors.accent : colors.border, backgroundColor: acceptedDisclaimer ? colors.accent : "transparent" }]}>
              {acceptedDisclaimer && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={[s.checkLabel, { color: colors.textSub }]}>
              Entiendo que Nuvos AI es educativa y{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>NO constituye asesoría financiera regulada</Text>.
              Soy responsable de mis propias decisiones de inversión.
            </Text>
          </TouchableOpacity>
        </View>
      ),
    },
  ];

  const current    = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  const handleNext = async () => {
    if (!isLastStep) { setStep(step + 1); return; }
    setLoading(true); setError("");
    try {
      const birthYear  = new Date().getFullYear() - parseInt(form.age || "0");
      const profileData = {
        name:                   form.name.trim(),
        birth_date:             form.age ? `${birthYear}-01-01` : undefined,
        monthly_contribution:   form.monthly_contribution,
        investment_amount:      form.investment_amount,
        investment_goal:        form.investment_goal,
        investment_goal_amount: form.investment_goal_amount,
        knowledge_level:        form.knowledge_level,
        risk_tolerance:         calculated,
        quiz_answers:           quizAnswers,
        mentor:                 form.mentor === "none" || !form.mentor.trim() ? null : form.mentor.trim(),
      };
      setProfile(profileData as unknown as import("../../src/lib/profileStore").UserProfile);
      profileApi.create(profileData as Record<string, unknown>).catch(() => {});
      router.replace("/(tabs)/chat");
    } catch {
      setError("Error al guardar el perfil. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Top row */}
      <View style={s.topRow}>
        <TouchableOpacity
          style={s.backArrow}
          onPress={() => step === 0 ? router.replace("/") : setStep(step - 1)}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={toggle}>
          <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={22} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Progress bar */}
      <View style={s.progressRow}>
        {STEPS.map((_, i) => (
          <View key={i} style={[s.progressBar, i <= step && s.progressActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.stepTitle}>{current.title}</Text>
        {current.content}
        {!!error && (
          <View style={[s.errorBox, { borderColor: "rgba(255,71,87,0.3)", backgroundColor: "rgba(255,71,87,0.1)" }]}>
            <Text style={{ color: "#ef4444", fontSize: 13 }}>{error}</Text>
          </View>
        )}
      </ScrollView>

      <View style={s.footer}>
        {step > 0 && (
          <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)}>
            <Text style={s.backText}>Atrás</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.nextBtn, (!(current.isValid?.() ?? true) || loading) && s.nextDisabled]}
          onPress={handleNext}
          disabled={!(current.isValid?.() ?? true) || loading}
        >
          <Text style={s.nextText}>{loading ? "Guardando..." : isLastStep ? "¡Comenzar!" : "Siguiente"}</Text>
        </TouchableOpacity>
      </View>

      <PaywallModal
        visible={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        reason="Los mentores de inversión son exclusivos de Premium"
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container:      { flex: 1, backgroundColor: c.bg },
    topRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    backArrow:      { padding: 6 },
    progressRow:    { flexDirection: "row", gap: 5, paddingHorizontal: 20, paddingTop: 18, marginBottom: 4 },
    progressBar:    { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.border },
    progressActive: { backgroundColor: c.accentLight },
    content:        { padding: 22, paddingBottom: 40 },
    stepTitle:      { fontSize: 22, fontWeight: "800", color: c.text, marginBottom: 22, letterSpacing: -0.5, lineHeight: 30 },
    fields:         { gap: 12 },
    label:          { color: c.textSub, fontSize: 13, fontWeight: "600", marginBottom: 7, letterSpacing: 0.1 },
    hint:           { fontSize: 12, lineHeight: 18, marginTop: 2 },
    input: {
      backgroundColor: c.bgRaised ?? c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15, color: c.text, fontSize: 16,
    },
    // Prefix input ($)
    prefixWrap:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.border, borderRadius: 14, backgroundColor: c.bgRaised ?? c.card },
    prefix:      { paddingLeft: 18, fontSize: 16, fontWeight: "700" },
    prefixInput: { flex: 1, borderWidth: 0, paddingLeft: 6 },
    // Goal chips
    goalGrid:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    goalChip:     { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
    goalChipText: { fontSize: 13, fontWeight: "600" },
    // Quiz
    questionText: { fontSize: 17, fontWeight: "700", lineHeight: 26, marginBottom: 10, letterSpacing: -0.3, color: c.text },
    option:       { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border, borderRadius: 16, padding: 16 },
    optionActive: { borderColor: c.accentLight, backgroundColor: c.accentLight + "0f" },
    letterBadge:  { width: 38, height: 38, borderRadius: 19, backgroundColor: c.bgRaised ?? c.border, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    letterText:   { fontSize: 14, fontWeight: "800", color: c.textMuted },
    optionLabel:  { flex: 1, fontSize: 14, lineHeight: 21, letterSpacing: 0.1 },
    // Reveal
    revealCard:   { borderRadius: 20, borderWidth: 1.5, padding: 24, alignItems: "center", marginBottom: 14, backgroundColor: c.card },
    revealType:   { fontSize: 22, fontWeight: "800", marginBottom: 8, letterSpacing: -0.4 },
    revealDesc:   { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 16 },
    barTrack:     { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row", width: "100%", marginBottom: 8 },
    barFill:      { height: "100%", borderRadius: 4 },
    barLabels:    { flexDirection: "row", justifyContent: "space-between", width: "100%" },
    barLabel:     { fontSize: 10, letterSpacing: 0.2 },
    factorsTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8, color: c.accentLight },
    factorRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
    factorLabel:  { fontSize: 12, fontWeight: "500", letterSpacing: 0.1 },
    factorRight:  { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
    factorBadge:  { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    factorBadgeText: { color: "white", fontSize: 11, fontWeight: "800" },
    factorValue:  { fontSize: 12, fontWeight: "700", textAlign: "right", flexShrink: 1 },
    featureRow:   { flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    // Mentor
    mentorGrid:       { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
    mentorCard:       { width: "47%", borderWidth: 2, borderRadius: 18, backgroundColor: c.card, padding: 14, gap: 5, position: "relative", overflow: "hidden" },
    recBadge:         { position: "absolute", top: 0, right: 0, paddingHorizontal: 9, paddingVertical: 4, borderBottomLeftRadius: 12 },
    recBadgeText:     { color: "white", fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
    mentorPhoto:      { width: 56, height: 56, borderRadius: 28, marginBottom: 6, backgroundColor: c.border },
    mentorAvatarBox:  { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
    mentorEmoji:      { fontSize: 26 },
    mentorName:       { fontSize: 13, fontWeight: "800", lineHeight: 18, letterSpacing: -0.2 },
    mentorTitle:      { fontSize: 10, lineHeight: 15, marginBottom: 3 },
    mentorBadgePill:  { alignSelf: "flex-start", borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 5 },
    mentorBadgeLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.2 },
    mentorPrinciple:  { fontSize: 10, lineHeight: 16 },
    selectedCheck:    { position: "absolute", bottom: 9, right: 9, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    mentorLockBadge:  { position: "absolute", top: 9, right: 9, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#f59e0b18", borderWidth: 1, borderColor: "#f59e0b44", borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3 },
    mentorLockText:   { color: "#f59e0b", fontSize: 9, fontWeight: "700" },
    noMentorCard:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 2, borderRadius: 18, padding: 16, position: "relative" },
    noMentorLeft:     { flexDirection: "row", alignItems: "center", gap: 14, flex: 1 },
    noMentorTitle:    { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
    noMentorSub:      { fontSize: 11, marginTop: 3, lineHeight: 16 },
    // Legal
    legalBox:   { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
    legalBadge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 4 },
    legalBody:  { fontSize: 12, lineHeight: 18 },
    checkRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    checkbox:   { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0 },
    checkLabel: { flex: 1, fontSize: 13, lineHeight: 20 },
    // Footer
    footer:       { flexDirection: "row", gap: 10, padding: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    backBtn:      { borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 22, alignItems: "center" },
    backText:     { color: c.textMuted, fontWeight: "600", fontSize: 15 },
    nextBtn:      { flex: 1, backgroundColor: c.accent, borderRadius: 16, paddingVertical: 17, alignItems: "center", shadowColor: c.accentLight, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    nextDisabled: { opacity: 0.4 },
    nextText:     { color: "white", fontWeight: "700", fontSize: 16, letterSpacing: 0.1 },
    errorBox:     { marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 14 },
  });
}
