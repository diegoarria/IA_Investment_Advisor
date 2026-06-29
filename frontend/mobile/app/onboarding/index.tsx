import React, { useState, useMemo, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { profileApi } from "../../src/lib/api";
import { posthog } from "../../src/config/posthog";
import { useAppStore, RISK_CONFIG } from "../../src/lib/profileStore";
import type { QuizAnswer } from "../../src/lib/profileStore";

// ─── Types ────────────────────────────────────────────────────────────────────
type RiskTolerance = "conservative" | "moderate" | "aggressive";

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const GOALS = [
  { value: "house",             label: "Comprar una casa",          emoji: "🏠" },
  { value: "car",               label: "Comprar un carro",          emoji: "🚗" },
  { value: "passive_income",    label: "Vivir de mis inversiones",  emoji: "💸" },
  { value: "retirement",        label: "Retiro / pensión",          emoji: "👴" },
  { value: "financial_freedom", label: "Libertad financiera",       emoji: "🦅" },
  { value: "long_term_wealth",  label: "Patrimonio a largo plazo",  emoji: "🏛️" },
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
  category: "Mentalidad de inversor",
  question: "Si inviertes $100,000 y el mercado se desploma 40%, ¿qué harías?",
  options: {
    A: "Vendo todo inmediatamente para evitar más pérdidas",
    B: "Espero sin hacer nada hasta que el mercado se recupere",
    C: "Mantengo mi posición — los fundamentos no cambiaron",
    D: "Compro más — es la oportunidad que estaba esperando",
  } as Record<QuizAnswer, string>,
};

const QUIZ_Q4 = {
  category: "Perfil de riesgo",
  question: "Tienes $100,000 para invertir. ¿Qué escenario prefieres?",
  options: {
    A: "Ganar $5K seguro, sin posibilidad de perder nada",
    B: "Ganar $15K probable, con riesgo de perder $5K",
    C: "Ganar $40K posible, con riesgo de perder $20K",
    D: "Ganar $120K posible, con riesgo de perder todo",
  } as Record<QuizAnswer, string>,
};

const QUIZ_LABELS = {
  q1: { A: "Vende todo",  B: "Espera pasivo", C: "Mantiene posición", D: "Compra más" } as Record<QuizAnswer, string>,
  q4: { A: "$5K seguro", B: "$15K/riesgo $5K", C: "$40K/riesgo $20K", D: "$120K/riesgo total" } as Record<QuizAnswer, string>,
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

type FormState = {
  name: string; birth_day: string; birth_month: string; birth_year: string;
  knowledge_level: QuizAnswer | "";
  monthly_contribution: string; investment_goal_amount: string;
  investment_horizon: string; investment_goal: string;
  q1: QuizAnswer | ""; q4: QuizAnswer | "";
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function OnboardingScreen() {
  const setProfile    = useAppStore((state) => state.setProfile);
  const existingProfile = useAppStore((state) => state.profile);

  useEffect(() => {
    if (existingProfile?.name) { router.replace("/(tabs)/home"); return; }
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
    return Date.now() - dt.getTime() >= 18 * 365.25 * 86_400_000;
  })();

  const birthDateStr = birthDateValid
    ? `${form.birth_year}-${form.birth_month.padStart(2,"0")}-${form.birth_day.padStart(2,"0")}`
    : "";

  const userAge = birthDateStr
    ? Math.floor((Date.now() - new Date(birthDateStr).getTime()) / (365.25 * 86_400_000))
    : 0;

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

  // ── Quiz renderer ────────────────────────────────────────────────────────────
  const renderQuiz = (q: typeof QUIZ_Q1, field: "q1" | "q4") => (
    <View style={{ gap: 10 }}>
      <Text style={S.quizQuestion}>{q.question}</Text>
      {(["A","B","C","D"] as QuizAnswer[]).map((letter) => {
        const active = form[field] === letter;
        return (
          <TouchableOpacity
            key={letter}
            activeOpacity={0.75}
            style={[S.quizOption, active && S.quizOptionActive]}
            onPress={() => setForm(f => ({ ...f, [field]: letter }))}
          >
            <View style={[S.quizBadge, active && S.quizBadgeActive]}>
              <Text style={[S.quizBadgeText, active && { color: "#fff" }]}>{letter}</Text>
            </View>
            <Text style={[S.quizLabel, active && { color: "#fff" }]}>{q.options[letter]}</Text>
            {active && <Ionicons name="checkmark-circle" size={18} color="#00d47e" />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // ── All steps ──────────────────────────────────────────────────────────────
  const STEPS = [
    // 0 — Nombre + Fecha
    {
      emoji: "👋",
      title: "¡Hola! Cuéntanos sobre ti",
      sub: "Necesitamos tu nombre y edad para personalizar tu experiencia.",
      isValid: () => form.name.trim().length >= 2 && birthDateValid,
      content: (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>Tu nombre completo</Text>
            <TextInput
              style={S.input} value={form.name}
              onChangeText={(v) => setForm(f => ({ ...f, name: v }))}
              placeholder="Ej. Diego Arria" placeholderTextColor="#374151"
              autoCapitalize="words" autoFocus
            />
            <Text style={S.hint}>Así te llamaremos en la app.</Text>
          </View>

          <View>
            <Text style={S.label}>Fecha de nacimiento</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                style={[S.input, { flex: 1, textAlign: "center" }]}
                value={form.birth_day}
                onChangeText={(v) => setForm(f => ({ ...f, birth_day: v.replace(/[^0-9]/g,"").slice(0,2) }))}
                placeholder="DD" placeholderTextColor="#374151"
                keyboardType="numeric" maxLength={2}
              />
              <TextInput
                style={[S.input, { flex: 1.4, textAlign: "center" }]}
                value={form.birth_month}
                onChangeText={(v) => setForm(f => ({ ...f, birth_month: v.replace(/[^0-9]/g,"").slice(0,2) }))}
                placeholder="MM" placeholderTextColor="#374151"
                keyboardType="numeric" maxLength={2}
              />
              <TextInput
                style={[S.input, { flex: 2, textAlign: "center" }]}
                value={form.birth_year}
                onChangeText={(v) => setForm(f => ({ ...f, birth_year: v.replace(/[^0-9]/g,"").slice(0,4) }))}
                placeholder="AAAA" placeholderTextColor="#374151"
                keyboardType="numeric" maxLength={4}
              />
            </View>
            <Text style={S.hint}>Debes tener al menos 18 años para usar Nuvos AI.</Text>
          </View>
        </View>
      ),
    },

    // 1 — Nivel de conocimiento
    {
      emoji: "📚",
      title: `${firstName ? `${firstName}, ¿cuál` : "¿Cuál"} es tu nivel?`,
      sub: "Esto nos ayuda a personalizar el lenguaje y los análisis del mentor IA.",
      isValid: () => !!form.knowledge_level,
      content: (
        <View style={{ gap: 12 }}>
          {KNOWLEDGE_LEVELS.map((lvl) => {
            const active = form.knowledge_level === lvl.value;
            return (
              <TouchableOpacity
                key={lvl.value}
                activeOpacity={0.8}
                onPress={() => setForm(f => ({ ...f, knowledge_level: lvl.value }))}
                style={[S.levelCard, active && { borderColor: lvl.color, backgroundColor: lvl.color + "10" }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View style={[S.levelEmojiWrap, active && { backgroundColor: lvl.color + "20" }]}>
                    <Text style={{ fontSize: 26 }}>{lvl.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.levelTitle, active && { color: lvl.color }]}>{lvl.label}</Text>
                    <Text style={S.levelDesc}>{lvl.desc}</Text>
                  </View>
                  {active && (
                    <View style={[S.checkCircle, { backgroundColor: lvl.color }]}>
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

    // 2 — Plan financiero
    {
      emoji: "💰",
      title: "Tu plan financiero",
      sub: "Calcularemos cuánto tiempo necesitas para alcanzar tus metas.",
      isValid: () => pmt > 0 && parseFloat(form.investment_goal_amount) > 0 && horizonYrs >= 1,
      content: (
        <View style={{ gap: 20 }}>
          <View>
            <Text style={S.label}>¿Cuánto quieres invertir mensualmente?</Text>
            <View style={S.prefixWrap}>
              <Text style={S.prefix}>$</Text>
              <TextInput
                style={[S.input, S.prefixInput]}
                value={form.monthly_contribution}
                onChangeText={(v) => setForm(f => ({ ...f, monthly_contribution: v }))}
                placeholder="500" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
              <Text style={[S.prefix, { paddingRight: 18, fontSize: 13 }]}>/mes</Text>
            </View>
          </View>

          <View>
            <Text style={S.label}>¿Cuánto patrimonio quieres alcanzar?</Text>
            <View style={S.prefixWrap}>
              <Text style={S.prefix}>$</Text>
              <TextInput
                style={[S.input, S.prefixInput]}
                value={form.investment_goal_amount}
                onChangeText={(v) => setForm(f => ({ ...f, investment_goal_amount: v }))}
                placeholder="1,000,000" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
            </View>
            <Text style={S.hint}>La app calculará cuándo llegarás a esta meta.</Text>
          </View>

          <View>
            <Text style={S.label}>¿Por cuántos años quieres invertir?</Text>
            <View style={S.prefixWrap}>
              <TextInput
                style={[S.input, S.prefixInput, { flex: 1 }]}
                value={form.investment_horizon}
                onChangeText={(v) => setForm(f => ({ ...f, investment_horizon: v }))}
                placeholder="10" placeholderTextColor="#374151"
                keyboardType="numeric"
              />
              <Text style={[S.prefix, { paddingRight: 18, fontSize: 13 }]}>años</Text>
            </View>
          </View>
        </View>
      ),
    },

    // 3 — Meta al invertir
    {
      emoji: "🎯",
      title: "¿Cuál es tu meta al invertir?",
      sub: "Personaliza tu plan según lo que más te importa lograr.",
      isValid: () => !!form.investment_goal,
      content: (
        <View style={S.goalGrid}>
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <TouchableOpacity
                key={g.value}
                activeOpacity={0.8}
                onPress={() => setForm(f => ({ ...f, investment_goal: g.value }))}
                style={[S.goalCard, active && { borderColor: "#00d47e", backgroundColor: "rgba(0,212,126,0.08)" }]}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <Text style={{ fontSize: 28 }}>{g.emoji}</Text>
                  {active && (
                    <View style={[S.checkCircle, { backgroundColor: "#00d47e", width: 18, height: 18, borderRadius: 9 }]}>
                      <Ionicons name="checkmark" size={10} color="white" />
                    </View>
                  )}
                </View>
                <Text style={[S.goalLabel, active && { color: "#00d47e" }]}>{g.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ),
    },

    // 4 — Quiz q1
    {
      emoji: "🧠",
      title: QUIZ_Q1.category,
      sub: "No hay respuestas correctas — sé honesto para obtener el mejor perfil.",
      isValid: () => !!form.q1,
      content: renderQuiz(QUIZ_Q1, "q1"),
    },

    // 5 — Quiz q4
    {
      emoji: "📊",
      title: QUIZ_Q4.category,
      sub: "Elige el escenario con el que te sentirías más cómodo.",
      isValid: () => !!form.q4,
      content: renderQuiz(QUIZ_Q4, "q4"),
    },

    // 6 — Perfil del inversor (reveal)
    {
      emoji: riskCfg?.color ? "" : "🎉",
      title: `Tu perfil, ${firstName || "inversionista"}`,
      sub: "Analizamos tus respuestas para determinar tu perfil real.",
      isValid: () => true,
      content: (
        <View style={{ gap: 16 }}>
          {/* Risk reveal card */}
          <View style={[S.revealCard, { borderColor: riskCfg.color + "44" }]}>
            <Text style={{ fontSize: 48, marginBottom: 10 }}>{RISK_EXTRA[calculated].emoji}</Text>
            <Text style={[S.revealType, { color: riskCfg.color }]}>Inversionista {riskCfg.label}</Text>
            <Text style={S.revealDesc}>{RISK_EXTRA[calculated].desc}</Text>
            <View style={S.riskBar}>
              <View style={[S.riskBarFill, { flex: pct, backgroundColor: riskCfg.color }]} />
              {pct < 100 && <View style={{ flex: 100 - pct }} />}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 4 }}>
              <Text style={S.riskBarLabel}>Bajo riesgo</Text>
              <Text style={S.riskBarLabel}>Alto riesgo</Text>
            </View>
          </View>

          {/* Summary */}
          <View style={S.summaryCard}>
            <Text style={S.summaryTitle}>Resumen de tu perfil</Text>
            {[
              { label: "Nombre",    value: form.name },
              { label: "Edad",      value: userAge ? `${userAge} años` : "—" },
              { label: "Nivel",     value: levelInfo ? `${levelInfo.emoji} ${levelInfo.label}` : "—" },
              { label: "Meta",      value: goalInfo  ? `${goalInfo.emoji} ${goalInfo.label}` : "—" },
              { label: "Objetivo",  value: `$${Number(form.investment_goal_amount).toLocaleString()}` },
              { label: "Horizonte", value: `${form.investment_horizon} años` },
              { label: "Mensual",   value: `$${Number(form.monthly_contribution).toLocaleString()}/mes` },
            ].map((row) => (
              <View key={row.label} style={S.summaryRow}>
                <Text style={S.summaryLabel}>{row.label}</Text>
                <Text style={S.summaryValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </View>
      ),
    },

    // 7 — Proyección + features
    {
      emoji: "📈",
      title: `Tu camino hacia ${fmtMoney(goalAmt)}`,
      sub: `Con disciplina y el mercado de tu lado, esto es lo que puedes lograr.`,
      isValid: () => true,
      content: (() => {
        const goalLinePct = Math.min((goalAmt / maxFV) * 100, 100);
        return (
          <View style={{ gap: 16 }}>
            {/* Projection bars */}
            <View style={S.projCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <Text style={S.projTitle}>Aportando ${pmt.toLocaleString()}/mes</Text>
                <View style={{ backgroundColor: riskCfg.color + "20", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: riskCfg.color, fontSize: 11, fontWeight: "700" }}>~{rateLabel}/año</Text>
                </View>
              </View>

              {[
                { years: horizonYrs,      fv: fvHorizon, label: `En ${horizonYrs} años` },
                { years: horizonYrs + 10, fv: fvPlus10,  label: `En ${horizonYrs + 10} años` },
              ].map(({ years, fv, label }) => {
                const barPct = Math.min((fv / maxFV) * 100, 100);
                return (
                  <View key={years} style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                      <Text style={{ color: "#9ca3af", fontSize: 12 }}>{label}</Text>
                      <Text style={{ color: fv >= goalAmt ? "#00d47e" : "#fff", fontSize: 14, fontWeight: "800" }}>
                        {fmtMoney(fv)}
                      </Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#1f2330" }}>
                      <View style={{ position: "absolute", top: 0, bottom: 0, left: `${goalLinePct}%` as any,
                                     width: 2, backgroundColor: "#00d47e", zIndex: 2 }} />
                      <View style={{ width: `${barPct}%` as any, backgroundColor: fv >= goalAmt ? "#00d47e" : riskCfg.color,
                                     height: "100%", borderRadius: 4 }} />
                    </View>
                  </View>
                );
              })}

              <View style={S.goalStatusCard}>
                <Text style={{ fontSize: 16 }}>🎯</Text>
                <Text style={{ color: "#00d47e", fontSize: 12, fontWeight: "600", flex: 1 }}>{goalStatusLine}</Text>
              </View>

              <View style={S.compoundCard}>
                <Text style={{ fontSize: 16 }}>⏳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#818cf8", fontSize: 12, fontWeight: "700" }}>
                    10 años más: +{fmtMoney(extraGain)} (+{extraPct}%)
                  </Text>
                  <Text style={{ color: "#4b5563", fontSize: 10, marginTop: 4, lineHeight: 15 }}>
                    El interés compuesto se acelera — los últimos años generan más que los primeros.
                  </Text>
                </View>
              </View>

              <Text style={{ color: "#374151", fontSize: 10, fontStyle: "italic", marginTop: 8 }}>
                * Ilustrativo. Basado en promedios históricos. No garantiza rendimientos futuros.
              </Text>
            </View>

            {/* Features */}
            <View style={S.summaryCard}>
              <Text style={[S.summaryTitle, { marginBottom: 12 }]}>Nuvos AI trabaja para ti</Text>
              {[
                { icon: "🤖", title: "IA que conoce tu perfil",   sub: "Análisis personalizado según tu nivel y tolerancia al riesgo" },
                { icon: "📊", title: "Portafolio en tiempo real", sub: "Precios cada 30s con rendimientos Hoy / YTD / Total" },
                { icon: "📅", title: "Calendario de eventos",     sub: "Earnings, dividendos y ex-dividendos de tus posiciones" },
                { icon: "🎮", title: "Paper trading sin riesgo",  sub: "Practica con $10,000 virtuales a precios reales" },
              ].map((f) => (
                <View key={f.title} style={S.featureRow}>
                  <Text style={{ fontSize: 20, flexShrink: 0 }}>{f.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{f.title}</Text>
                    <Text style={{ color: "#6b7280", fontSize: 11, marginTop: 2, lineHeight: 16 }}>{f.sub}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        );
      })(),
    },

    // 8 — Disclaimer legal
    {
      emoji: "📋",
      title: "Antes de empezar",
      sub: "Lee y acepta los siguientes puntos para continuar.",
      isValid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <View style={{ gap: 16 }}>
          <View style={S.legalBox}>
            <Text style={S.legalBadge}>⚠️  HERRAMIENTA EDUCATIVA — NO ASESORÍA FINANCIERA</Text>
            <Text style={S.legalBody}>
              Nuvos AI es una plataforma de{" "}
              <Text style={{ color: "#fff", fontWeight: "700" }}>educación e información financiera</Text>.
              El análisis de la IA y los datos de mercado son{" "}
              <Text style={{ color: "#fff", fontWeight: "700" }}>únicamente educativos</Text>{" "}
              y no constituyen asesoramiento financiero, de inversión, legal ni fiscal regulado.
            </Text>
            <Text style={[S.legalBody, { marginTop: 8 }]}>
              Los datos pueden ser inexactos o retrasados. El rendimiento pasado no garantiza resultados futuros.{" "}
              <Text style={{ color: "#fff", fontWeight: "700" }}>Nunca tomes decisiones de inversión basándote únicamente en esta app.</Text>
            </Text>
          </View>

          <TouchableOpacity style={S.checkRow} onPress={() => setAcceptedTerms(v => !v)} activeOpacity={0.7}>
            <View style={[S.checkbox, acceptedTerms && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
              {acceptedTerms && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={S.checkLabel}>
              He leído y acepto los{" "}
              <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}>Términos de Uso</Text>
              {" "}y la{" "}
              <Text style={{ color: "#00d47e", textDecorationLine: "underline" }}>Política de Privacidad</Text>.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.checkRow} onPress={() => setAcceptedDisclaimer(v => !v)} activeOpacity={0.7}>
            <View style={[S.checkbox, acceptedDisclaimer && { borderColor: "#00d47e", backgroundColor: "#00d47e" }]}>
              {acceptedDisclaimer && <Ionicons name="checkmark" size={12} color="white" />}
            </View>
            <Text style={S.checkLabel}>
              Entiendo que Nuvos AI es educativa y{" "}
              <Text style={{ color: "#fff", fontWeight: "700" }}>NO constituye asesoría financiera regulada</Text>.
              Soy responsable de mis propias decisiones de inversión.
            </Text>
          </TouchableOpacity>
        </View>
      ),
    },
  ];

  const current    = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
  const totalSteps = STEPS.length;

  // ── Submit ────────────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!isLastStep) {
      posthog.capture("onboarding_step_advanced", { step_index: step, step_total: STEPS.length });
      setStep(step + 1);
      return;
    }
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
      posthog.capture("onboarding_completed", {
        risk_tolerance: calculated,
        knowledge_level: form.knowledge_level,
        investment_goal: form.investment_goal,
        investment_horizon: parseInt(form.investment_horizon) || 0,
      });
      router.replace("/(tabs)/chat");
    } catch {
      setError("Error al guardar el perfil. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={S.screen}>
      <View style={S.glowOrb} />
      <SafeAreaView style={{ flex: 1 }}>

        {/* ── Top nav ── */}
        <View style={S.topNav}>
          <TouchableOpacity
            style={S.backBtn}
            onPress={() => step === 0 ? router.replace("/") : setStep(step - 1)}
          >
            <Ionicons name="arrow-back" size={20} color="#9ca3af" />
          </TouchableOpacity>

          {/* Step dots */}
          <View style={S.dotsRow}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  S.dot,
                  i < step && S.dotDone,
                  i === step && S.dotActive,
                ]}
              />
            ))}
          </View>

          <View style={{ width: 36 }} />
        </View>

        {/* ── Progress bar ── */}
        <View style={S.progressTrack}>
          <View style={[S.progressFill, { width: `${((step + 1) / totalSteps) * 100}%` as any }]} />
        </View>

        <ScrollView
          contentContainerStyle={S.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step emoji + header */}
          <View style={S.stepHeader}>
            {current.emoji ? (
              <View style={S.stepEmojiBubble}>
                <Text style={{ fontSize: 28 }}>{current.emoji}</Text>
              </View>
            ) : null}
            <Text style={S.stepCounter}>Paso {step + 1} de {totalSteps}</Text>
            <Text style={S.stepTitle}>{current.title}</Text>
            <Text style={S.stepSub}>{current.sub}</Text>
          </View>

          {current.content}

          {!!error && (
            <View style={S.errorBox}>
              <Text style={{ color: "#ef4444", fontSize: 13 }}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* ── Footer ── */}
        <View style={S.footer}>
          {step > 0 && (
            <TouchableOpacity style={S.footerBack} onPress={() => setStep(step - 1)}>
              <Text style={S.footerBackText}>Atrás</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[S.footerNext, (!(current.isValid?.() ?? true) || loading) && S.footerNextDisabled]}
            onPress={handleNext}
            disabled={!(current.isValid?.() ?? true) || loading}
          >
            <Text style={S.footerNextText}>
              {loading ? "Guardando..." : isLastStep ? "¡Comenzar!" : "Siguiente"}
            </Text>
            {!loading && !isLastStep && (
              <Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
            )}
          </TouchableOpacity>
        </View>

      </SafeAreaView>
    </View>
  );
}

// ─── Styles — always dark ────────────────────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0a0d12" },
  glowOrb: {
    position: "absolute", top: -100, alignSelf: "center",
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: "rgba(0,212,126,0.05)",
  },

  // ── Navigation ──
  topNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
  },
  dotsRow: { flexDirection: "row", gap: 5, alignItems: "center" },
  dot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: "#1f2330",
  },
  dotDone: { backgroundColor: "#374151" },
  dotActive: { width: 18, backgroundColor: "#00d47e" },

  // ── Progress ──
  progressTrack: { height: 2, backgroundColor: "#111318", marginHorizontal: 0 },
  progressFill: { height: 2, backgroundColor: "#00d47e" },

  // ── Content ──
  content: { padding: 24, paddingBottom: 16 },
  stepHeader: { marginBottom: 28 },
  stepEmojiBubble: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: "#111318",
    borderWidth: 1, borderColor: "#1f2330",
    alignItems: "center", justifyContent: "center", marginBottom: 16,
  },
  stepCounter: { color: "#00d47e", fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 },
  stepTitle:   { fontSize: 26, fontWeight: "900", color: "#fff", letterSpacing: -0.6, lineHeight: 32, marginBottom: 8 },
  stepSub:     { fontSize: 14, color: "#6b7280", lineHeight: 21 },

  // ── Inputs ──
  label: { color: "#9ca3af", fontSize: 13, fontWeight: "600", letterSpacing: 0.2, marginBottom: 9 },
  hint:  { color: "#4b5563", fontSize: 11, marginTop: 6, lineHeight: 16 },
  input: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1a1d27",
    borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16,
    color: "#fff", fontSize: 16,
  },
  prefixWrap: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderColor: "#1a1d27", borderRadius: 14,
    backgroundColor: "#111318",
  },
  prefix:      { paddingLeft: 18, fontSize: 16, fontWeight: "700", color: "#9ca3af" },
  prefixInput: { flex: 1, borderWidth: 0, paddingLeft: 6 },

  // ── Knowledge level cards ──
  levelCard: {
    borderWidth: 1.5, borderColor: "#1f2330", borderRadius: 18,
    padding: 16, backgroundColor: "#111318",
  },
  levelEmojiWrap: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: "#1f2330", alignItems: "center", justifyContent: "center",
  },
  levelTitle: { fontSize: 16, fontWeight: "800", color: "#fff", marginBottom: 4 },
  levelDesc:  { fontSize: 12, color: "#6b7280", lineHeight: 18 },

  // ── Goal grid ──
  goalGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goalCard: {
    width: "47%", borderWidth: 1.5, borderColor: "#1f2330",
    borderRadius: 18, padding: 16, backgroundColor: "#111318",
  },
  goalLabel: { fontSize: 12, fontWeight: "700", color: "#9ca3af", lineHeight: 17 },

  // ── Quiz ──
  quizQuestion: { fontSize: 17, fontWeight: "800", color: "#fff", lineHeight: 26, letterSpacing: -0.3, marginBottom: 16 },
  quizOption: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#111318", borderWidth: 1.5, borderColor: "#1f2330",
    borderRadius: 16, padding: 16,
  },
  quizOptionActive: { borderColor: "#00d47e", backgroundColor: "rgba(0,212,126,0.06)" },
  quizBadge: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: "#1f2330", borderWidth: 1, borderColor: "#2a2d3a",
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  quizBadgeActive: { backgroundColor: "rgba(0,212,126,0.2)", borderColor: "#00d47e" },
  quizBadgeText: { fontSize: 14, fontWeight: "800", color: "#6b7280" },
  quizLabel:     { flex: 1, fontSize: 14, color: "#9ca3af", lineHeight: 21 },

  // ── Shared ──
  checkCircle: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },

  // ── Reveal step ──
  revealCard: {
    borderRadius: 20, borderWidth: 1.5, padding: 24,
    alignItems: "center", backgroundColor: "#111318",
  },
  revealType: { fontSize: 22, fontWeight: "900", marginBottom: 10, letterSpacing: -0.5 },
  revealDesc: { fontSize: 13, color: "#9ca3af", textAlign: "center", lineHeight: 20, marginBottom: 20 },
  riskBar:    { height: 8, borderRadius: 4, overflow: "hidden", flexDirection: "row", width: "100%", marginBottom: 8, backgroundColor: "#1f2330" },
  riskBarFill: { height: "100%", borderRadius: 4 },
  riskBarLabel: { fontSize: 10, color: "#4b5563", letterSpacing: 0.2 },

  // ── Summary card ──
  summaryCard: {
    backgroundColor: "#111318", borderWidth: 1, borderColor: "#1f2330",
    borderRadius: 18, padding: 18,
  },
  summaryTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", color: "#00d47e", marginBottom: 12 },
  summaryRow:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                  paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330" },
  summaryLabel: { fontSize: 12, color: "#6b7280", fontWeight: "500" },
  summaryValue: { fontSize: 12, color: "#fff", fontWeight: "700", textAlign: "right", flex: 1, marginLeft: 16 },

  // ── Projection card ──
  projCard:    { backgroundColor: "#111318", borderRadius: 18, borderWidth: 1, borderColor: "#1f2330", padding: 18 },
  projTitle:   { fontSize: 13, fontWeight: "700", color: "#9ca3af" },
  goalStatusCard: {
    backgroundColor: "rgba(0,212,126,0.06)", borderRadius: 12, padding: 12, borderWidth: 1,
    borderColor: "rgba(0,212,126,0.2)", flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10,
  },
  compoundCard: {
    backgroundColor: "rgba(99,102,241,0.06)", borderRadius: 12, padding: 12, borderWidth: 1,
    borderColor: "rgba(99,102,241,0.2)", flexDirection: "row", alignItems: "center", gap: 10,
  },

  // ── Features ──
  featureRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1f2330",
  },

  // ── Legal ──
  legalBox:   { borderWidth: 1, borderColor: "rgba(245,158,11,0.3)", backgroundColor: "rgba(245,158,11,0.06)", borderRadius: 16, padding: 18 },
  legalBadge: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, color: "#f59e0b", marginBottom: 10 },
  legalBody:  { fontSize: 12, color: "#9ca3af", lineHeight: 19 },
  checkRow:   { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  checkbox:   { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#2a2d3a",
                alignItems: "center", justifyContent: "center", marginTop: 1, flexShrink: 0 },
  checkLabel: { flex: 1, fontSize: 13, color: "#9ca3af", lineHeight: 20 },

  // ── Footer ──
  footer: {
    flexDirection: "row", gap: 12, paddingHorizontal: 20, paddingVertical: 16,
    borderTopWidth: 1, borderTopColor: "#111318",
    backgroundColor: "#0a0d12",
  },
  footerBack: {
    borderWidth: 1, borderColor: "#1f2330", borderRadius: 16,
    paddingVertical: 17, paddingHorizontal: 22, alignItems: "center",
    backgroundColor: "#111318",
  },
  footerBackText: { color: "#6b7280", fontWeight: "600", fontSize: 15 },
  footerNext: {
    flex: 1, backgroundColor: "#00d47e", borderRadius: 16,
    paddingVertical: 17, alignItems: "center", justifyContent: "center",
    flexDirection: "row",
    shadowColor: "#00d47e", shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  footerNextDisabled: { opacity: 0.35 },
  footerNextText:     { color: "#000", fontWeight: "900", fontSize: 16, letterSpacing: 0.1 },

  // ── Error ──
  errorBox: { marginTop: 16, borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.08)", borderRadius: 14, padding: 14 },
});
