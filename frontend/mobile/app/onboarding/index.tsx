import React, { useState, useMemo } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, SafeAreaView, Image
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme, Colors } from "../../src/lib/ThemeContext";
import {
  useAppStore, RISK_CONFIG, calculateRisk, getAge, formatBirthDate,
} from "../../src/lib/profileStore";
import type { QuizAnswer, QuizAnswers } from "../../src/lib/profileStore";
import { MENTORS, RECOMMENDED_MENTOR } from "../../src/lib/mentorData";

// ─── Quiz data ────────────────────────────────────────────────────────────────

const QUIZ: {
  key: keyof QuizAnswers;
  num: string;
  category: string;
  question: string;
  options: Record<QuizAnswer, string>;
}[] = [
  {
    key: "q1",
    num: "01",
    category: "MENTALIDAD",
    question: "Tu portafolio cae 35% en 3 meses por una crisis del mercado. ¿Qué haces?",
    options: {
      A: "Vendo todo antes de perder más",
      B: "Espero a que se recupere, pero no compro más",
      C: "Reviso si los fundamentos siguen sólidos y mantengo",
      D: "Aprovecho para comprar más a precios bajos",
    },
  },
  {
    key: "q2",
    num: "02",
    category: "HORIZONTE",
    question: "¿Para qué necesitas este dinero invertido y en cuánto tiempo?",
    options: {
      A: "Podría necesitarlo en menos de 2 años",
      B: "En 3–5 años, para algo específico",
      C: "En 10+ años, para independencia financiera o retiro",
      D: "No tengo prisa — es para construir patrimonio a largo plazo",
    },
  },
  {
    key: "q3",
    num: "03",
    category: "CONOCIMIENTO",
    question: "¿Cuál de estos conceptos entiendes y podrías explicar a alguien más?",
    options: {
      A: "Ninguno con confianza — apenas empiezo",
      B: "Interés compuesto, CETES, fondos indexados",
      C: "P/E ratio, diversificación, rendimiento ajustado al riesgo",
      D: "Análisis fundamental, cobertura con derivados, ciclos de mercado",
    },
  },
  {
    key: "q4",
    num: "04",
    category: "RIESGO",
    question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
    options: {
      A: "Ganar $5K seguro, sin posibilidad de perder nada",
      B: "Ganar $15K probable, con riesgo de perder $5K",
      C: "Ganar $40K posible, con riesgo de perder $20K",
      D: "Ganar $120K posible, con riesgo de perder todo",
    },
  },
  {
    key: "q5",
    num: "05",
    category: "COMPORTAMIENTO",
    question: "¿Cuánto tiempo dedicarías a monitorear y gestionar tus inversiones?",
    options: {
      A: "Prefiero algo automático que no requiera atención",
      B: "Una revisión mensual o trimestral me parece suficiente",
      C: "Me gusta revisar semanalmente y hacer ajustes cuando vale",
      D: "Estoy dispuesto a dedicarle tiempo diario — es una actividad activa",
    },
  },
];

const RISK_DESC: Record<string, string> = {
  conservative: "Priorizas la seguridad y la preservación de tu capital. Prefieres rendimientos estables aunque menores.",
  moderate:     "Buscas equilibrio entre crecimiento y protección. Aceptas cierta volatilidad por mejores retornos.",
  aggressive:   "Tu objetivo es el máximo crecimiento. Tienes tolerancia a la alta volatilidad en el largo plazo.",
};

// Descriptions for the profile reveal summary
const QUIZ_LABELS: Record<keyof QuizAnswers, Record<QuizAnswer, string>> = {
  q1: { A: "Vende ante caídas", B: "Espera pasivamente", C: "Analiza y mantiene", D: "Compra las caídas" },
  q2: { A: "< 2 años", B: "3–5 años", C: "10+ años", D: "Largo plazo, sin prisa" },
  q3: { A: "Principiante", B: "Básico", C: "Intermedio", D: "Avanzado" },
  q4: { A: "$5K seguro", B: "$15K probable / riesgo $5K", C: "$40K posible / riesgo $20K", D: "$120K posible / riesgo total" },
  q5: { A: "Automático / pasivo", B: "Revisión mensual", C: "Revisión semanal", D: "Gestión diaria activa" },
};

// ─── Mentor photos (local require — static only) ──────────────────────────────

const MENTOR_PHOTOS: Record<string, number> = {
  "Warren Buffett": require("../../assets/images/mentors/warren_buffett.jpg"),
  "Ray Dalio":      require("../../assets/images/mentors/ray_dalio.jpg"),
  "Bill Ackman":    require("../../assets/images/mentors/bill_ackman.jpg"),
};

// ─── Component ────────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  birth_date: string;
  monthly_income: string;
  monthly_contribution: string;
  q1: QuizAnswer | "";
  q2: QuizAnswer | "";
  q3: QuizAnswer | "";
  q4: QuizAnswer | "";
  q5: QuizAnswer | "";
  mentor: string;
};

function isValidDate(d: string) {
  const age = getAge(d);
  return d.length === 10 && age >= 10 && age <= 100;
}

export default function OnboardingScreen() {
  const { colors, isDark, toggle } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const setProfile = useAppStore((state) => state.setProfile);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    name: "", birth_date: "", monthly_income: "", monthly_contribution: "",
    q1: "", q2: "", q3: "", q4: "", q5: "", mentor: "",
  });

  const quizAnswers = { q1: form.q1, q2: form.q2, q3: form.q3, q4: form.q4, q5: form.q5 };
  const calculated = calculateRisk(quizAnswers);
  const riskCfg = RISK_CONFIG[calculated];
  const pct = Math.round(riskCfg.pct * 100);
  const firstName = form.name.trim().split(" ")[0];
  const currentAge = getAge(form.birth_date);

  // ── Steps ──────────────────────────────────────────────────────────────────

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
              <View style={[s.letterBadge, selected && { backgroundColor: "#22c55e" }]}>
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

  const steps = [
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
    // 1 — Situación financiera
    {
      title: `Hola, ${firstName || "!"}  Tu situación financiera`,
      isValid: () => isValidDate(form.birth_date) && !!form.monthly_income && !!form.monthly_contribution,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>Fecha de nacimiento</Text>
          <TextInput
            style={s.input} value={form.birth_date}
            onChangeText={(v) => setForm((f) => ({ ...f, birth_date: formatBirthDate(v) }))}
            placeholder="DD/MM/AAAA" placeholderTextColor={colors.placeholder}
            keyboardType="numeric" maxLength={10}
          />
          {form.birth_date.length === 10 && (
            <Text style={[s.hint, { color: isValidDate(form.birth_date) ? colors.accentLight : "#ef4444" }]}>
              {isValidDate(form.birth_date) ? `Tienes ${currentAge} años` : "Fecha inválida"}
            </Text>
          )}
          <Text style={[s.label, { marginTop: 16 }]}>Ingresos mensuales (USD)</Text>
          <TextInput
            style={s.input} value={form.monthly_income}
            onChangeText={(v) => setForm((f) => ({ ...f, monthly_income: v }))}
            placeholder="3000" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
          <Text style={[s.label, { marginTop: 16 }]}>Aportación mensual planificada (USD)</Text>
          <TextInput
            style={s.input} value={form.monthly_contribution}
            onChangeText={(v) => setForm((f) => ({ ...f, monthly_contribution: v }))}
            placeholder="300" placeholderTextColor={colors.placeholder} keyboardType="numeric"
          />
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Esta info ayuda a la IA a darte recomendaciones precisas.
          </Text>
        </View>
      ),
    },
    // 2-6 — Quiz (5 preguntas)
    ...quizSteps,
    // 7 — Reveal
    {
      title: `Tu perfil, ${firstName || "!"}`,
      isValid: () => true,
      content: (
        <View style={s.fields}>
          <Text style={[s.hint, { color: colors.textMuted, marginBottom: 16 }]}>
            Analizamos tus respuestas para determinar tu perfil de inversionista real.
          </Text>

          {/* Risk card */}
          <View style={[s.revealCard, { backgroundColor: colors.card, borderColor: riskCfg.color + "55" }]}>
            <Ionicons name={riskCfg.icon} size={44} color={riskCfg.color} style={{ marginBottom: 8 }} />
            <Text style={[s.revealType, { color: colors.text }]}>{riskCfg.label}</Text>
            <Text style={[s.revealDesc, { color: colors.textMuted }]}>{RISK_DESC[calculated]}</Text>
            <View style={[s.barTrack, { backgroundColor: colors.border }]}>
              <View style={[s.barFill, { flex: pct, backgroundColor: riskCfg.color }]} />
              {pct < 100 && <View style={{ flex: 100 - pct }} />}
            </View>
            <View style={s.barLabels}>
              <Text style={[s.barLabel, { color: colors.textDim }]}>Bajo riesgo</Text>
              <Text style={[s.barLabel, { color: colors.textDim }]}>Alto riesgo</Text>
            </View>
          </View>

          {/* Quiz answers summary */}
          <Text style={[s.factorsTitle, { color: colors.textSub }]}>Resumen de tus respuestas</Text>
          {QUIZ.map((q) => {
            const answer = form[q.key] as QuizAnswer;
            return (
              <View key={q.key} style={[s.factorRow, { borderColor: colors.border }]}>
                <Text style={[s.factorLabel, { color: colors.textMuted }]}>{q.category}</Text>
                <View style={s.factorRight}>
                  <View style={s.factorBadge}>
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
            { label: "Nombre",     value: form.name },
            { label: "Edad",       value: `${currentAge} años` },
            { label: "Ingresos",   value: `$${Number(form.monthly_income).toLocaleString()} / mes` },
            { label: "Aportación", value: `$${Number(form.monthly_contribution).toLocaleString()} / mes` },
          ].map((f) => (
            <View key={f.label} style={[s.factorRow, { borderColor: colors.border }]}>
              <Text style={[s.factorLabel, { color: colors.textMuted }]}>{f.label}</Text>
              <Text style={[s.factorValue, { color: colors.text }]}>{f.value}</Text>
            </View>
          ))}
        </View>
      ),
    },
    // 8 — Mentor selection
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
              const isRec = RECOMMENDED_MENTOR[calculated] === m.id;
              return (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    s.mentorCard,
                    { borderColor: isSelected ? m.color : colors.border },
                    isSelected && { backgroundColor: m.color + "18" },
                  ]}
                  onPress={() => setForm((f) => ({ ...f, mentor: m.id }))}
                  activeOpacity={0.75}
                >
                  {isRec && (
                    <View style={[s.recBadge, { backgroundColor: m.color }]}>
                      <Text style={s.recBadgeText}>⭐ RECOMENDADO</Text>
                    </View>
                  )}
                  {MENTOR_PHOTOS[m.id] ? (
                    <Image
                      source={MENTOR_PHOTOS[m.id]}
                      style={s.mentorPhoto}
                    />
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

          {/* Sin mentor option */}
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

          <Text style={[s.label, { marginTop: 12 }]}>¿Prefieres otro inversor?</Text>
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
  ];

  const current = steps[step];
  const isLastStep = step === steps.length - 1;

  const handleNext = () => {
    if (!isLastStep) { setStep(step + 1); return; }
    const qa = quizAnswers as QuizAnswers;
    setProfile({
      name: form.name.trim(),
      birth_date: form.birth_date,
      monthly_income: form.monthly_income,
      monthly_contribution: form.monthly_contribution,
      risk_tolerance: calculated,
      quiz_answers: qa,
      mentor: form.mentor === "none" || !form.mentor.trim() ? null : form.mentor.trim(),
    });
    router.replace("/(tabs)/chat");
  };

  return (
    <SafeAreaView style={s.container}>
      <TouchableOpacity style={s.themeToggle} onPress={toggle}>
        <Ionicons name={isDark ? "sunny-outline" : "moon-outline"} size={22} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={s.progressRow}>
        {steps.map((_, i) => (
          <View key={i} style={[s.progressBar, i <= step && s.progressActive]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.stepTitle}>{current.title}</Text>
        {current.content}
      </ScrollView>

      <View style={s.footer}>
        {step > 0 && (
          <TouchableOpacity style={s.backBtn} onPress={() => setStep(step - 1)}>
            <Text style={s.backText}>Atrás</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[s.nextBtn, !current.isValid() && s.nextDisabled]}
          onPress={handleNext}
          disabled={!current.isValid()}
        >
          <Text style={s.nextText}>{isLastStep ? "¡Comenzar!" : "Siguiente"}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function makeStyles(c: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    themeToggle: { position: "absolute", top: 56, right: 24, zIndex: 10 },
    progressRow: { flexDirection: "row", gap: 5, paddingHorizontal: 20, paddingTop: 18, marginBottom: 4 },
    progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: c.border },
    progressActive: { backgroundColor: c.accentLight },
    content: { padding: 22, paddingBottom: 40 },
    stepTitle: { fontSize: 22, fontWeight: "800", color: c.text, marginBottom: 22, letterSpacing: -0.5, lineHeight: 30 },
    fields: { gap: 12 },
    label: { color: c.textSub, fontSize: 13, fontWeight: "600", marginBottom: 7, letterSpacing: 0.1 },
    hint: { fontSize: 12, lineHeight: 18, marginTop: 2 },
    input: {
      backgroundColor: c.bgRaised ?? c.card, borderWidth: 1, borderColor: c.border,
      borderRadius: 14, paddingHorizontal: 18, paddingVertical: 15, color: c.text, fontSize: 16,
    },
    // Quiz option cards
    questionText: { fontSize: 17, fontWeight: "700", lineHeight: 26, marginBottom: 10, letterSpacing: -0.3, color: c.text },
    option: {
      flexDirection: "row", alignItems: "center", gap: 14,
      backgroundColor: c.card, borderWidth: 1.5, borderColor: c.border,
      borderRadius: 16, padding: 16,
    },
    optionActive: { borderColor: c.accentLight, backgroundColor: c.accentLight + "0f" },
    letterBadge: {
      width: 38, height: 38, borderRadius: 19,
      backgroundColor: c.bgRaised ?? c.border, borderWidth: 1, borderColor: c.border,
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    letterText: { fontSize: 14, fontWeight: "800", color: c.textMuted },
    optionLabel: { flex: 1, fontSize: 14, lineHeight: 21, letterSpacing: 0.1 },
    // Reveal
    revealCard: {
      borderRadius: 20, borderWidth: 1.5, padding: 24, alignItems: "center", marginBottom: 14,
      backgroundColor: c.card,
    },
    revealType: { fontSize: 22, fontWeight: "800", marginBottom: 8, letterSpacing: -0.4 },
    revealDesc: { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 16 },
    barTrack: { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row", width: "100%", marginBottom: 8 },
    barFill: { height: "100%", borderRadius: 4 },
    barLabels: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
    barLabel: { fontSize: 10, letterSpacing: 0.2 },
    factorsTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8, color: c.accentLight },
    factorRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth,
    },
    factorLabel: { fontSize: 12, fontWeight: "500", letterSpacing: 0.1 },
    factorRight: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
    factorBadge: {
      width: 24, height: 24, borderRadius: 12,
      backgroundColor: c.accentLight, alignItems: "center", justifyContent: "center",
    },
    factorBadgeText: { color: "white", fontSize: 11, fontWeight: "800" },
    factorValue: { fontSize: 12, fontWeight: "700", textAlign: "right", flexShrink: 1 },
    // Mentor selection
    mentorGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 },
    mentorCard: {
      width: "47%", borderWidth: 2, borderRadius: 18,
      backgroundColor: c.card, padding: 14, gap: 5,
      position: "relative" as const, overflow: "hidden" as const,
    },
    recBadge: {
      position: "absolute" as const, top: 0, right: 0,
      paddingHorizontal: 9, paddingVertical: 4,
      borderBottomLeftRadius: 12,
    },
    recBadgeText: { color: "white", fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.3 },
    mentorPhoto: {
      width: 56, height: 56, borderRadius: 28, marginBottom: 6,
      backgroundColor: c.border,
    },
    mentorAvatarBox: {
      width: 56, height: 56, borderRadius: 28,
      alignItems: "center" as const, justifyContent: "center" as const,
      marginBottom: 6,
    },
    mentorEmoji: { fontSize: 26 },
    mentorName: { fontSize: 13, fontWeight: "800" as const, lineHeight: 18, letterSpacing: -0.2 },
    mentorTitle: { fontSize: 10, lineHeight: 15, marginBottom: 3 },
    mentorBadgePill: {
      alignSelf: "flex-start" as const,
      borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 5,
    },
    mentorBadgeLabel: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 0.2 },
    mentorPrinciple: { fontSize: 10, lineHeight: 16 },
    selectedCheck: {
      position: "absolute" as const, bottom: 9, right: 9,
      width: 22, height: 22, borderRadius: 11,
      alignItems: "center" as const, justifyContent: "center" as const,
    },
    noMentorCard: {
      flexDirection: "row" as const, alignItems: "center" as const,
      justifyContent: "space-between" as const,
      borderWidth: 2, borderRadius: 18, padding: 16,
      position: "relative" as const,
    },
    noMentorLeft: { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, flex: 1 },
    noMentorTitle: { fontSize: 14, fontWeight: "800" as const, letterSpacing: -0.2 },
    noMentorSub: { fontSize: 11, marginTop: 3, lineHeight: 16 },
    // Footer
    footer: { flexDirection: "row", gap: 10, padding: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    backBtn: {
      borderWidth: 1, borderColor: c.border, borderRadius: 16,
      paddingVertical: 17, paddingHorizontal: 22, alignItems: "center",
    },
    backText: { color: c.textMuted, fontWeight: "600", fontSize: 15 },
    nextBtn: {
      flex: 1, backgroundColor: c.accent, borderRadius: 16, paddingVertical: 17, alignItems: "center",
      shadowColor: c.accentLight, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    },
    nextDisabled: { opacity: 0.4 },
    nextText: { color: "white", fontWeight: "700", fontSize: 16, letterSpacing: 0.1 },
  });
}
