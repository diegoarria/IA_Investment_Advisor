import React, { useState, useMemo, useEffect } from "react";
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

// ─── Types ────────────────────────────────────────────────────────────────────
type RiskTolerance = "conservative" | "moderate" | "aggressive";

// ─── Static data ──────────────────────────────────────────────────────────────
const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const GOALS = [
  { value: "house",             label: "Comprar una casa",          emoji: "🏠" },
  { value: "car",               label: "Comprar un carro",          emoji: "🚗" },
  { value: "passive_income",    label: "Vivir de mis inversiones",  emoji: "💸" },
  { value: "retirement",        label: "Retiro / pensión",          emoji: "👴" },
  { value: "financial_freedom", label: "Libertad financiera",       emoji: "🦅" },
  { value: "long_term_wealth",  label: "Patrimonio de largo plazo", emoji: "🏛️" },
];

const KNOWLEDGE_LEVELS = [
  { value: "B" as QuizAnswer, label: "Básico",     emoji: "🌱", color: "#22c55e",
    desc: "Sin experiencia o apenas inicio. Conozco ahorro, CETES o fondos básicos." },
  { value: "C" as QuizAnswer, label: "Intermedio", emoji: "📈", color: "#3b82f6",
    desc: "Tengo experiencia con ETFs y acciones. Entiendo diversificación y rendimiento." },
  { value: "D" as QuizAnswer, label: "Avanzado",   emoji: "🎯", color: "#a855f7",
    desc: "Manejo análisis fundamental, derivados, ciclos de mercado y estrategias complejas." },
];

const RISK_EXTRA: Record<RiskTolerance, { emoji: string; desc: string }> = {
  conservative: { emoji: "🛡️", desc: "Priorizas la preservación del capital. Prefieres rendimientos modestos con baja volatilidad." },
  moderate:     { emoji: "⚖️", desc: "Equilibras crecimiento y seguridad. Aceptas oscilaciones moderadas por mejores retornos." },
  aggressive:   { emoji: "🚀", desc: "Buscas máximo crecimiento. Toleras volatilidad alta a cambio de retornos superiores." },
};

const QUIZ_Q1 = {
  category: "01 · MENTALIDAD",
  question: "Si inviertes $100,000 y el mercado se desploma 40%, ¿qué harías?",
  options: {
    A: "Vendo todo inmediatamente para evitar más pérdidas",
    B: "Espero sin hacer nada hasta que el mercado se recupere",
    C: "Mantengo mi posición — los fundamentos no cambiaron",
    D: "Compro más — es la oportunidad que estaba esperando",
  } as Record<QuizAnswer, string>,
};

const QUIZ_Q4 = {
  category: "02 · RIESGO",
  question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
  options: {
    A: "Ganar $5K seguro, sin posibilidad de perder nada",
    B: "Ganar $15K probable, con riesgo de perder $5K",
    C: "Ganar $40K posible, con riesgo de perder $20K",
    D: "Ganar $120K posible, con riesgo de perder todo",
  } as Record<QuizAnswer, string>,
};

const QUIZ_LABELS = {
  q1: { A: "Vende todo",  B: "Espera pasivo", C: "Mantiene posición", D: "Compra más"          } as Record<QuizAnswer, string>,
  q4: { A: "$5K seguro", B: "$15K/riesgo $5K",C: "$40K/riesgo $20K",  D: "$120K/riesgo total"  } as Record<QuizAnswer, string>,
};


// ─── Helpers ──────────────────────────────────────────────────────────────────
function calculateRisk(q1: string, q4: string): RiskTolerance {
  const m: Record<QuizAnswer, number> = { A: 1, B: 2, C: 3, D: 4 };
  const vals = [q1, q4].filter((v): v is QuizAnswer => "ABCD".includes(v));
  if (!vals.length) return "moderate";
  const avg = vals.reduce((s, v) => s + m[v], 0) / vals.length;
  return avg <= 2 ? "conservative" : avg <= 3 ? "moderate" : "aggressive";
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function yearsToGoal(pmt: number, goal: number, annualRate: number): number | null {
  if (pmt <= 0 || goal <= 0) return null;
  const r = annualRate / 12;
  const n = Math.log(1 + (goal * r) / pmt) / Math.log(1 + r);
  if (!isFinite(n) || n <= 0) return null;
  return Math.ceil(n / 12);
}

// ─── Form State ───────────────────────────────────────────────────────────────
type FormState = {
  name: string;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  knowledge_level: QuizAnswer | "";
  monthly_contribution: string;
  investment_goal_amount: string;
  investment_horizon: string;
  investment_goal: string;
  q1: QuizAnswer | "";
  q4: QuizAnswer | "";
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const { colors, isDark, toggle } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const setProfile = useAppStore((state) => state.setProfile);
  const existingProfile = useAppStore((state) => state.profile);

  // Guard: if user already has a profile in the store, block onboarding forever
  useEffect(() => {
    if (existingProfile?.name) { router.replace("/(tabs)/home"); return; }
    // Also check via API in case store was cleared
    profileApi.get().then(() => router.replace("/(tabs)/home")).catch(() => {});
  }, []);

  const [step, setStep]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [acceptedTerms, setAcceptedTerms]           = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", birth_day: "", birth_month: "", birth_year: "",
    knowledge_level: "", monthly_contribution: "", investment_goal_amount: "",
    investment_horizon: "", investment_goal: "", q1: "", q4: "",
  });

  // ── Derived ─────────────────────────────────────────────────────────────────
  const firstName  = form.name.trim().split(" ")[0];
  const calculated = calculateRisk(form.q1, form.q4);
  const riskCfg    = RISK_CONFIG[calculated];
  const pct        = Math.round(riskCfg.pct * 100);
  const levelInfo  = KNOWLEDGE_LEVELS.find(l => l.value === form.knowledge_level);
  const goalInfo   = GOALS.find(g => g.value === form.investment_goal);

  const birthDateValid = (() => {
    const d = parseInt(form.birth_day), m = parseInt(form.birth_month), y = parseInt(form.birth_year);
    if (!d || !m || !y || y < 1920 || y > 2006) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    const ageMs = Date.now() - dt.getTime();
    return ageMs >= 18 * 365.25 * 86_400_000;
  })();

  const birthDateStr = birthDateValid
    ? `${form.birth_year}-${form.birth_month.padStart(2,"0")}-${form.birth_day.padStart(2,"0")}`
    : "";

  const userAge = birthDateStr
    ? Math.floor((Date.now() - new Date(birthDateStr).getTime()) / (365.25 * 86_400_000))
    : 0;

  // ── Projections ─────────────────────────────────────────────────────────────
  const pmt        = Math.max(parseFloat(form.monthly_contribution) || 0, 0);
  const goalAmt    = Math.max(parseFloat(form.investment_goal_amount) || 0, 1);
  const horizonYrs = Math.max(parseInt(form.investment_horizon) || 10, 1);
  const annualRate = calculated === "conservative" ? 0.07 : calculated === "moderate" ? 0.10 : 0.12;
  const rateLabel  = calculated === "conservative" ? "7%" : calculated === "moderate" ? "10%" : "12%";
  const r          = annualRate / 12;
  const fvAt       = (months: number) => pmt > 0 ? Math.round(pmt * ((Math.pow(1 + r, months) - 1) / r)) : 0;
  const fvHorizon  = fvAt(horizonYrs * 12);
  const fvPlus10   = fvAt((horizonYrs + 10) * 12);
  const extraGain  = fvPlus10 - fvHorizon;
  const extraPct   = fvHorizon > 0 ? Math.round((extraGain / fvHorizon) * 100) : 0;
  const maxFV      = Math.max(fvPlus10, goalAmt);
  const yrsNeeded  = yearsToGoal(pmt, goalAmt, annualRate);
  const goalStatusLine = fvHorizon >= goalAmt
    ? `¡Alcanzas tu meta dentro de los ${horizonYrs} años!`
    : yrsNeeded
    ? `Necesitas ~${yrsNeeded} años para alcanzar ${fmtMoney(goalAmt)}`
    : `En ${horizonYrs} años tendrías ${fmtMoney(fvHorizon)}`;

  // ── Quiz options renderer ────────────────────────────────────────────────────
  const renderQuiz = (q: typeof QUIZ_Q1, field: "q1" | "q4") => (
    <View style={s.fields}>
      <Text style={[s.questionText, { color: colors.text }]}>{q.question}</Text>
      {(["A","B","C","D"] as QuizAnswer[]).map((letter) => {
        const active = form[field] === letter;
        return (
          <TouchableOpacity key={letter} activeOpacity={0.75}
                            style={[s.option, active && s.optionActive]}
                            onPress={() => setForm(f => ({ ...f, [field]: letter }))}>
            <View style={[s.letterBadge, active && { backgroundColor: colors.accentLight }]}>
              <Text style={[s.letterText, active && { color: "white" }]}>{letter}</Text>
            </View>
            <Text style={[s.optionLabel, { color: active ? colors.text : colors.textSub }]}>
              {q.options[letter]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ── All steps ──────────────────────────────────────────────────────────────
  const STEPS = [
    // 0 — Nombre + Fecha de nacimiento
    {
      title: "¡Hola! Cuéntanos sobre ti",
      isValid: () => form.name.trim().length >= 2 && birthDateValid,
      content: (
        <View style={s.fields}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.accentLight, textAlign: "center", marginBottom: 16, letterSpacing: 0.3 }}>
            Con Nuvos, construye tu futuro.
          </Text>
          <Text style={s.label}>Tu nombre completo</Text>
          <TextInput style={s.input} value={form.name}
                     onChangeText={(v) => setForm(f => ({ ...f, name: v }))}
                     placeholder="Ej. Diego Arria" placeholderTextColor={colors.placeholder}
                     autoCapitalize="words" autoFocus />
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Así te llamaremos en la app.
          </Text>

          <Text style={[s.label, { marginTop: 20 }]}>Fecha de nacimiento</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {/* Day */}
            <TextInput style={[s.input, { flex: 1, textAlign: "center" }]}
                       value={form.birth_day}
                       onChangeText={(v) => setForm(f => ({ ...f, birth_day: v.replace(/[^0-9]/g,"").slice(0,2) }))}
                       placeholder="DD" placeholderTextColor={colors.placeholder}
                       keyboardType="numeric" maxLength={2} />
            {/* Month */}
            <TextInput style={[s.input, { flex: 1.5, textAlign: "center" }]}
                       value={form.birth_month}
                       onChangeText={(v) => setForm(f => ({ ...f, birth_month: v.replace(/[^0-9]/g,"").slice(0,2) }))}
                       placeholder="MM" placeholderTextColor={colors.placeholder}
                       keyboardType="numeric" maxLength={2} />
            {/* Year */}
            <TextInput style={[s.input, { flex: 2, textAlign: "center" }]}
                       value={form.birth_year}
                       onChangeText={(v) => setForm(f => ({ ...f, birth_year: v.replace(/[^0-9]/g,"").slice(0,4) }))}
                       placeholder="AAAA" placeholderTextColor={colors.placeholder}
                       keyboardType="numeric" maxLength={4} />
          </View>
          <Text style={[s.hint, { color: colors.textMuted }]}>
            Debes tener al menos 18 años para usar Nuvos AI.
          </Text>
        </View>
      ),
    },

    // 1 — Nivel de conocimiento
    {
      title: `${firstName ? `${firstName}, ¿cuál` : "¿Cuál"} es tu nivel en inversiones?`,
      isValid: () => !!form.knowledge_level,
      content: (
        <View style={s.fields}>
          {KNOWLEDGE_LEVELS.map((lvl) => {
            const active = form.knowledge_level === lvl.value;
            return (
              <TouchableOpacity key={lvl.value} activeOpacity={0.75}
                                onPress={() => setForm(f => ({ ...f, knowledge_level: lvl.value }))}
                                style={[
                                  s.levelCard,
                                  { borderColor: active ? lvl.color : colors.border,
                                    backgroundColor: active ? lvl.color + "12" : colors.card },
                                ]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <Text style={{ fontSize: 28 }}>{lvl.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: active ? lvl.color : colors.text }}>
                      {lvl.label}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textSub, marginTop: 3, lineHeight: 18 }}>
                      {lvl.desc}
                    </Text>
                  </View>
                  {active && (
                    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: lvl.color,
                                   alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Ionicons name="checkmark" size={13} color="white" />
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ),
    },

    // 2 — Metas financieras (números)
    {
      title: "Cuéntanos sobre tu plan financiero",
      isValid: () => pmt > 0 && parseFloat(form.investment_goal_amount) > 0 && horizonYrs >= 1,
      content: (
        <View style={s.fields}>
          <Text style={s.label}>¿Cuánto quieres invertir mensualmente?</Text>
          <View style={s.prefixWrap}>
            <Text style={[s.prefix, { color: colors.textMuted }]}>$</Text>
            <TextInput style={[s.input, s.prefixInput, { color: colors.text }]}
                       value={form.monthly_contribution}
                       onChangeText={(v) => setForm(f => ({ ...f, monthly_contribution: v }))}
                       placeholder="500" placeholderTextColor={colors.placeholder}
                       keyboardType="numeric" />
            <Text style={[s.prefix, { paddingRight: 16, fontSize: 13, color: colors.textMuted }]}>/mes</Text>
          </View>

          <Text style={[s.label, { marginTop: 18 }]}>¿Cuánto patrimonio quieres tener?</Text>
          <View style={s.prefixWrap}>
            <Text style={[s.prefix, { color: colors.textMuted }]}>$</Text>
            <TextInput style={[s.input, s.prefixInput, { color: colors.text }]}
                       value={form.investment_goal_amount}
                       onChangeText={(v) => setForm(f => ({ ...f, investment_goal_amount: v }))}
                       placeholder="1,000,000" placeholderTextColor={colors.placeholder}
                       keyboardType="numeric" />
          </View>
          <Text style={[s.hint, { color: colors.textMuted }]}>
            La app calculará cuándo llegarás a esta meta.
          </Text>

          <Text style={[s.label, { marginTop: 18 }]}>¿Por cuántos años quieres invertir?</Text>
          <View style={s.prefixWrap}>
            <TextInput style={[s.input, s.prefixInput, { color: colors.text, flex: 1 }]}
                       value={form.investment_horizon}
                       onChangeText={(v) => setForm(f => ({ ...f, investment_horizon: v }))}
                       placeholder="10" placeholderTextColor={colors.placeholder}
                       keyboardType="numeric" />
            <Text style={[s.prefix, { paddingRight: 18, fontSize: 13, color: colors.textMuted }]}>años</Text>
          </View>
        </View>
      ),
    },

    // 3 — Meta al invertir (tipo)
    {
      title: "¿Cuál es tu meta al invertir?",
      isValid: () => !!form.investment_goal,
      content: (
        <View style={s.goalGrid}>
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <TouchableOpacity key={g.value} activeOpacity={0.75}
                                onPress={() => setForm(f => ({ ...f, investment_goal: g.value }))}
                                style={[s.goalCard, { borderColor: active ? colors.accentLight : colors.border,
                                                       backgroundColor: active ? colors.accentLight + "15" : colors.card }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <Text style={{ fontSize: 26 }}>{g.emoji}</Text>
                  {active && (
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accentLight,
                                   alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="checkmark" size={11} color="white" />
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, fontWeight: "700", color: active ? colors.accentLight : colors.textSub, lineHeight: 17 }}>
                  {g.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ),
    },

    // 4 — Quiz q1
    {
      title: QUIZ_Q1.category,
      isValid: () => !!form.q1,
      content: renderQuiz(QUIZ_Q1, "q1"),
    },

    // 5 — Quiz q4
    {
      title: QUIZ_Q4.category,
      isValid: () => !!form.q4,
      content: renderQuiz(QUIZ_Q4, "q4"),
    },

    // 6 — Perfil del inversor (reveal)
    {
      title: `Tu perfil, ${firstName || "inversionista"}`,
      isValid: () => true,
      content: (
        <View style={s.fields}>
          <Text style={[s.hint, { color: colors.textMuted, marginBottom: 4 }]}>
            Analizamos tus respuestas para determinar tu perfil real.
          </Text>

          {/* Risk card */}
          <View style={[s.revealCard, { borderColor: riskCfg.color + "55" }]}>
            <Text style={{ fontSize: 44, marginBottom: 8 }}>{RISK_EXTRA[calculated].emoji}</Text>
            <Text style={[s.revealType, { color: colors.text }]}>Inversionista {riskCfg.label}</Text>
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

          {/* Summary rows */}
          <Text style={[s.factorsTitle, { color: colors.textSub }]}>Resumen de tu perfil</Text>
          {[
            { label: "Nombre",    value: form.name },
            { label: "Edad",      value: userAge ? `${userAge} años` : "—" },
            { label: "Nivel",     value: levelInfo ? `${levelInfo.emoji} ${levelInfo.label}` : "—" },
            { label: "Meta",      value: goalInfo  ? `${goalInfo.emoji} ${goalInfo.label}` : "—" },
            { label: "Patrimonio objetivo", value: `$${Number(form.investment_goal_amount).toLocaleString()}` },
            { label: "Horizonte", value: `${form.investment_horizon} años` },
            { label: "Mensual",   value: `$${Number(form.monthly_contribution).toLocaleString()}/mes` },
          ].map((row) => (
            <View key={row.label} style={[s.factorRow, { borderColor: colors.border }]}>
              <Text style={[s.factorLabel, { color: colors.textMuted }]}>{row.label}</Text>
              <Text style={[s.factorValue, { color: colors.text }]}>{row.value}</Text>
            </View>
          ))}

          {/* Quiz answers */}
          <Text style={[s.factorsTitle, { color: colors.textSub, marginTop: 16 }]}>Tus respuestas</Text>
          {([
            { key: "q1" as const, label: "Ante una caída del 40%" },
            { key: "q4" as const, label: "Escenario de riesgo" },
          ]).map(({ key, label }) => {
            const ans = form[key] as QuizAnswer;
            return (
              <View key={key} style={[s.factorRow, { borderColor: colors.border }]}>
                <Text style={[s.factorLabel, { color: colors.textMuted }]}>{label}</Text>
                <View style={s.factorRight}>
                  <View style={[s.factorBadge, { backgroundColor: colors.accentLight }]}>
                    <Text style={s.factorBadgeText}>{ans}</Text>
                  </View>
                  <Text style={[s.factorValue, { color: colors.text }]}>
                    {ans ? QUIZ_LABELS[key][ans] : "—"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ),
    },

    // 7 — Proyección + Nuvos AI
    {
      title: `Tu camino hacia ${fmtMoney(goalAmt)}`,
      isValid: () => true,
      content: (() => {
        const goalLinePct = Math.min((goalAmt / maxFV) * 100, 100);
        return (
          <View style={{ gap: 16 }}>
            {/* Projection bars */}
            <View style={[s.revealCard, { alignItems: "stretch" }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={[s.factorsTitle, { color: colors.textSub, marginBottom: 0 }]}>
                  Aportando ${pmt.toLocaleString()}/mes
                </Text>
                <View style={{ backgroundColor: riskCfg.color + "22", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: riskCfg.color, fontSize: 10, fontWeight: "700" }}>~{rateLabel}/año</Text>
                </View>
              </View>

              {[
                { years: horizonYrs,      fv: fvHorizon, label: `A los ${horizonYrs} años` },
                { years: horizonYrs + 10, fv: fvPlus10,  label: `+10 años más (${horizonYrs + 10} total)` },
              ].map(({ years, fv, label }) => {
                const barPct = Math.min((fv / maxFV) * 100, 100);
                return (
                  <View key={years} style={{ marginBottom: 14 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 5 }}>
                      <Text style={{ color: colors.textSub, fontSize: 11, flex: 1, marginRight: 8 }}>{label}</Text>
                      <Text style={{ color: fv >= goalAmt ? "#22c55e" : colors.text, fontSize: 13, fontWeight: "800" }}>
                        {fmtMoney(fv)}
                      </Text>
                    </View>
                    <View style={{ height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: colors.border }}>
                      <View style={{ position: "absolute", top: 0, bottom: 0, left: `${goalLinePct}%` as any,
                                     width: 2, backgroundColor: "#22c55e", zIndex: 2, opacity: 0.8 }} />
                      <View style={{ width: `${barPct}%` as any, backgroundColor: fv >= goalAmt ? "#22c55e" : riskCfg.color,
                                     height: "100%", borderRadius: 5 }} />
                    </View>
                  </View>
                );
              })}

              {/* Goal status */}
              <View style={{ backgroundColor: "rgba(34,197,94,0.08)", borderRadius: 14, padding: 12,
                             flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1,
                             borderColor: "rgba(34,197,94,0.25)", marginBottom: 8 }}>
                <Text style={{ fontSize: 16 }}>🎯</Text>
                <Text style={{ color: "#22c55e", fontSize: 12, fontWeight: "600", flex: 1 }}>
                  {goalStatusLine}
                </Text>
              </View>

              {/* Power of time */}
              <View style={{ backgroundColor: "rgba(99,102,241,0.08)", borderRadius: 14, padding: 12,
                             borderWidth: 1, borderColor: "rgba(99,102,241,0.25)" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>⏳</Text>
                  <Text style={{ color: "#818cf8", fontSize: 12, fontWeight: "700", flex: 1 }}>
                    10 años más: +{fmtMoney(extraGain)} (+{extraPct}%)
                  </Text>
                </View>
                <Text style={{ color: colors.textDim, fontSize: 10, marginTop: 6, marginLeft: 24 }}>
                  El interés compuesto se acelera — los últimos años generan más que los primeros.
                </Text>
              </View>

              <Text style={{ color: colors.textDim, fontSize: 10, fontStyle: "italic", marginTop: 8 }}>
                * Ilustrativo. Basado en promedios históricos. No garantiza rendimientos futuros.
              </Text>
            </View>

            {/* Features */}
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.accentLight, textAlign: "center", marginBottom: 4, letterSpacing: 0.3 }}>
              Con Nuvos, construye tu futuro.
            </Text>
            <Text style={[s.factorsTitle, { color: colors.textSub }]}>Nuvos AI trabaja contigo</Text>
            {[
              { icon: "🤖", title: "IA que conoce tu perfil",     sub: "Análisis personalizado según tu nivel y tolerancia al riesgo" },
              { icon: "📊", title: "Portafolio en tiempo real",    sub: "Precios cada 30s con rendimientos Hoy / YTD / Total" },
              { icon: "📅", title: "Calendario de eventos",        sub: "Earnings, dividendos y ex-dividendos de tus posiciones" },
              { icon: "🎮", title: "Paper trading sin riesgo",     sub: "Practica con $10,000 virtuales a precios reales" },
            ].map((f) => (
              <View key={f.title} style={[s.featureRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={{ fontSize: 20, flexShrink: 0 }}>{f.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>{f.title}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 1, lineHeight: 16 }}>{f.sub}</Text>
                </View>
              </View>
            ))}
          </View>
        );
      })(),
    },

    // 8 — Disclaimer legal
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
              El análisis de la IA y los datos de mercado son{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>únicamente educativos</Text> y no constituyen
              asesoramiento financiero, de inversión, legal ni fiscal regulado.
            </Text>
            <Text style={[s.legalBody, { color: colors.textSub, marginTop: 6 }]}>
              Los datos pueden ser inexactos o retrasados. El rendimiento pasado no garantiza resultados futuros.{" "}
              <Text style={{ color: colors.text, fontWeight: "700" }}>Nunca tomes decisiones de inversión basándote únicamente en esta app.</Text>
            </Text>
          </View>

          <TouchableOpacity style={s.checkRow} onPress={() => setAcceptedTerms(v => !v)} activeOpacity={0.7}>
            <View style={[s.checkbox, { borderColor: acceptedTerms ? colors.accent : colors.border,
                                         backgroundColor: acceptedTerms ? colors.accent : "transparent" }]}>
              {acceptedTerms && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={[s.checkLabel, { color: colors.textSub }]}>
              He leído y acepto los{" "}
              <Text style={{ color: colors.accentLight, textDecorationLine: "underline" }}>Términos de Uso</Text>
              {" "}y la{" "}
              <Text style={{ color: colors.accentLight, textDecorationLine: "underline" }}>Política de Privacidad</Text>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.checkRow} onPress={() => setAcceptedDisclaimer(v => !v)} activeOpacity={0.7}>
            <View style={[s.checkbox, { borderColor: acceptedDisclaimer ? colors.accent : colors.border,
                                         backgroundColor: acceptedDisclaimer ? colors.accent : "transparent" }]}>
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

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!isLastStep) { setStep(step + 1); return; }
    setLoading(true); setError("");
    try {
      const profileData = {
        name:                   form.name.trim(),
        birth_date:             birthDateStr || undefined,
        monthly_contribution:   form.monthly_contribution,
        investment_goal:        form.investment_goal,
        investment_goal_amount: form.investment_goal_amount,
        investment_horizon:     form.investment_horizon,
        knowledge_level:        form.knowledge_level,
        risk_tolerance:         calculated,
        quiz_answers:           { q1: form.q1, q4: form.q4 },
        mentor:                 null,
      };
      setProfile(profileData as unknown as import("../../src/lib/profileStore").UserProfile);
      profileApi.create(profileData as Record<string, unknown>).catch(() => {});
      // El perfil en el store persiste con AsyncStorage — el guard lo detecta en futuros accesos
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
        <TouchableOpacity style={s.backArrow}
                          onPress={() => step === 0 ? router.replace("/") : setStep(step - 1)}>
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
        <TouchableOpacity style={[s.nextBtn, (!(current.isValid?.() ?? true) || loading) && s.nextDisabled]}
                          onPress={handleNext}
                          disabled={!(current.isValid?.() ?? true) || loading}>
          <Text style={s.nextText}>{loading ? "Guardando..." : isLastStep ? "¡Comenzar!" : "Siguiente"}</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: Colors) {
  return StyleSheet.create({
    container:      { flex: 1, backgroundColor: c.bg },
    topRow:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                      paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
    backArrow:      { padding: 6 },
    progressRow:    { flexDirection: "row", gap: 4, paddingHorizontal: 20, paddingTop: 18, marginBottom: 4 },
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
    prefixWrap:  { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: c.border,
                   borderRadius: 14, backgroundColor: c.bgRaised ?? c.card },
    prefix:      { paddingLeft: 18, fontSize: 16, fontWeight: "700" },
    prefixInput: { flex: 1, borderWidth: 0, paddingLeft: 6 },
    // Knowledge level cards
    levelCard:   { borderWidth: 2, borderRadius: 18, padding: 16 },
    // Goal grid
    goalGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    goalCard:    { width: "47%", borderWidth: 1.5, borderRadius: 18, padding: 14 },
    // Quiz
    questionText: { fontSize: 17, fontWeight: "700", lineHeight: 26, marginBottom: 10,
                    letterSpacing: -0.3, color: c.text },
    option:       { flexDirection: "row", alignItems: "center", gap: 14, backgroundColor: c.card,
                    borderWidth: 1.5, borderColor: c.border, borderRadius: 16, padding: 16 },
    optionActive: { borderColor: c.accentLight, backgroundColor: c.accentLight + "0f" },
    letterBadge:  { width: 38, height: 38, borderRadius: 19, backgroundColor: c.bgRaised ?? c.border,
                    borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    letterText:   { fontSize: 14, fontWeight: "800", color: c.textMuted },
    optionLabel:  { flex: 1, fontSize: 14, lineHeight: 21, letterSpacing: 0.1 },
    // Reveal
    revealCard:   { borderRadius: 20, borderWidth: 1.5, padding: 24, alignItems: "center",
                    marginBottom: 14, backgroundColor: c.card },
    revealType:   { fontSize: 20, fontWeight: "800", marginBottom: 8, letterSpacing: -0.4 },
    revealDesc:   { fontSize: 13, textAlign: "center", lineHeight: 20, marginBottom: 16 },
    barTrack:     { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row", width: "100%", marginBottom: 8 },
    barFill:      { height: "100%", borderRadius: 4 },
    barLabels:    { flexDirection: "row", justifyContent: "space-between", width: "100%" },
    barLabel:     { fontSize: 10, letterSpacing: 0.2 },
    factorsTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase",
                    marginBottom: 8, color: c.accentLight },
    factorRow:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
    factorLabel:  { fontSize: 12, fontWeight: "500", letterSpacing: 0.1 },
    factorRight:  { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, justifyContent: "flex-end" },
    factorBadge:  { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    factorBadgeText: { color: "white", fontSize: 11, fontWeight: "800" },
    factorValue:  { fontSize: 12, fontWeight: "700", textAlign: "right", flexShrink: 1 },
    featureRow:   { flexDirection: "row", alignItems: "center", gap: 14, padding: 14,
                    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
    // Legal
    legalBox:   { borderWidth: 1, borderRadius: 16, padding: 16, gap: 6 },
    legalBadge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 4 },
    legalBody:  { fontSize: 12, lineHeight: 18 },
    checkRow:   { flexDirection: "row", alignItems: "flex-start", gap: 12 },
    checkbox:   { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center",
                  justifyContent: "center", marginTop: 1, flexShrink: 0 },
    checkLabel: { flex: 1, fontSize: 13, lineHeight: 20 },
    // Footer
    footer:       { flexDirection: "row", gap: 10, padding: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
    backBtn:      { borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingVertical: 17, paddingHorizontal: 22, alignItems: "center" },
    backText:     { color: c.textMuted, fontWeight: "600", fontSize: 15 },
    nextBtn:      { flex: 1, backgroundColor: c.accent, borderRadius: 16, paddingVertical: 17, alignItems: "center",
                    shadowColor: c.accentLight, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    nextDisabled: { opacity: 0.4 },
    nextText:     { color: "white", fontWeight: "700", fontSize: 16, letterSpacing: 0.1 },
    errorBox:     { marginTop: 14, borderWidth: 1, borderRadius: 14, padding: 14 },
  });
}
