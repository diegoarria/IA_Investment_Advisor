import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  Dimensions, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";
import { useAppStore } from "../lib/profileStore";

const { width } = Dimensions.get("window");

const STEPS = [
  {
    emoji: "👋",
    color: "#00b96d",
    title: "Bienvenido a Nuvos AI",
    subtitle: "Tu mentor de inversiones con IA",
    desc: "Nuvos AI te enseña a pensar como un inversor profesional. No te decimos qué comprar — te enseñamos a analizar y tomar decisiones por ti mismo.",
    tip: "Este tutorial dura menos de 2 minutos. Puedes saltarlo y reabrirlo desde tu perfil.",
  },
  {
    emoji: "💬",
    color: "#00b96d",
    title: "Chat con tu mentor IA",
    subtitle: "La herramienta principal",
    desc: "Pregunta sobre cualquier empresa, ETF o concepto. La IA conoce tu perfil de riesgo, tu portafolio real y detecta si tus decisiones contradicen tu perfil declarado.",
    tip: "💡 Puedes editar un mensaje tuyo tocando el ícono de lápiz que aparece al lado.",
  },
  {
    emoji: "📊",
    color: "#3b82f6",
    title: "Portafolio",
    subtitle: "Analiza tus inversiones reales",
    desc: "Importa tus posiciones con una captura de pantalla de tu broker o manualmente. Obtén análisis de riesgo, stress test en crisis históricas y simulaciones de rendimiento.",
    tip: "💡 El simulador proyecta tu portafolio en distintos escenarios de mercado.",
  },
  {
    emoji: "🎮",
    color: "#8b5cf6",
    title: "Simulador",
    subtitle: "Practica sin dinero real",
    desc: "Opera con $100,000 virtuales en mercados reales. Compra y vende acciones, sigue tus rendimientos y aprende a ejecutar estrategias sin arriesgar tu capital.",
    tip: "💡 El simulador usa precios reales del mercado en tiempo real.",
  },
  {
    emoji: "📚",
    color: "#06b6d4",
    title: "Aprendizaje",
    subtitle: "45+ temas financieros",
    desc: "Biblioteca de conceptos explicados con IA: ETFs, análisis fundamental, P/E, DCA, Value Investing, psicología del inversor y mucho más. Cada tema en menos de 2 minutos.",
    tip: "💡 Busca cualquier concepto financiero — la IA lo explica con ejemplos reales.",
  },
  {
    emoji: "🔔",
    color: "#f97316",
    title: "Alertas & Watchlist",
    subtitle: "Mantente al tanto del mercado",
    desc: "Recibe alertas sobre movimientos relevantes para tu perfil. Agrega acciones a tu Watchlist y ve sus precios en tiempo real con análisis IA automático.",
    tip: "💡 Si una acción en tu Watchlist cae más del 3%, obtienes un análisis IA del movimiento.",
  },
  {
    emoji: "🧠",
    color: "#a855f7",
    title: "Tu perfil & Madurez",
    subtitle: "Conoce tu evolución como inversor",
    desc: "La IA analiza tu comportamiento real en la app — detecta si entras en pánico, si diversificas, si piensas a largo plazo — y te asigna una puntuación de Madurez Inversora (0-100).",
    tip: "💡 Los insights del perfil te alertan cuando tu comportamiento real contradice tu perfil declarado.",
  },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function TutorialModal({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const [step, setStep] = useState(0);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  const handleNext = () => {
    if (isLast) { onClose(); setStep(0); }
    else setStep(step + 1);
  };

  const handleClose = () => { onClose(); setStep(0); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.progressFill, { width: `${progress}%` as any, backgroundColor: current.color }]} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.stepLabel, { color: colors.textDim }]}>
              {step + 1} / {STEPS.length}
            </Text>
            <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* Emoji */}
            <View style={styles.emojiWrap}>
              <View style={[styles.emojiBox, { backgroundColor: current.color + "18", borderColor: current.color + "35" }]}>
                <Text style={styles.emoji}>{current.emoji}</Text>
              </View>
            </View>

            {/* Text */}
            <Text style={[styles.title, { color: colors.text }]}>{current.title}</Text>
            <Text style={[styles.subtitle, { color: current.color }]}>{current.subtitle}</Text>
            <Text style={[styles.desc, { color: colors.textSub }]}>{current.desc}</Text>

            {/* Tip */}
            <View style={[styles.tip, { backgroundColor: current.color + "0e", borderColor: current.color + "25" }]}>
              <Text style={[styles.tipText, { color: colors.textMuted }]}>{current.tip}</Text>
            </View>

            {/* Navigation */}
            <View style={styles.nav}>
              {step > 0 ? (
                <TouchableOpacity
                  style={[styles.btnBack, { backgroundColor: colors.bg, borderColor: colors.border }]}
                  onPress={() => setStep(step - 1)}
                >
                  <Ionicons name="arrow-back" size={16} color={colors.textMuted} />
                  <Text style={[styles.btnBackText, { color: colors.textMuted }]}>Atrás</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.btnBack, { backgroundColor: colors.bg, borderColor: colors.border }]}
                  onPress={handleClose}
                >
                  <Text style={[styles.btnBackText, { color: colors.textMuted }]}>Saltar</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.btnNext, { backgroundColor: current.color, shadowColor: current.color }]}
                onPress={handleNext}
              >
                <Text style={styles.btnNextText}>{isLast ? "¡Empezar!" : "Siguiente"}</Text>
                {!isLast && <Ionicons name="arrow-forward" size={16} color="white" />}
              </TouchableOpacity>
            </View>

            {/* Dots */}
            <View style={styles.dots}>
              {STEPS.map((_, i) => (
                <TouchableOpacity key={i} onPress={() => setStep(i)}>
                  <View style={[
                    styles.dot,
                    {
                      width: i === step ? 20 : 6,
                      backgroundColor: i === step ? current.color : colors.border,
                    },
                  ]} />
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%", maxWidth: 420,
    borderRadius: 28, borderWidth: 1,
    overflow: "hidden",
    maxHeight: "90%",
  },
  progressTrack: { height: 3, width: "100%" },
  progressFill: { height: 3, borderRadius: 2 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  stepLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  emojiWrap: { alignItems: "center", marginVertical: 16 },
  emojiBox: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5,
  },
  emoji: { fontSize: 38 },
  title: {
    fontSize: 20, fontWeight: "900", textAlign: "center",
    marginBottom: 4, paddingHorizontal: 20, letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 11, fontWeight: "700", textAlign: "center",
    textTransform: "uppercase", letterSpacing: 0.8,
    marginBottom: 14, paddingHorizontal: 20,
  },
  desc: {
    fontSize: 14, lineHeight: 22, textAlign: "center",
    paddingHorizontal: 20, marginBottom: 14,
  },
  tip: {
    marginHorizontal: 20, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20,
  },
  tipText: { fontSize: 12, lineHeight: 18 },
  nav: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 20, marginBottom: 16,
  },
  btnBack: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  btnBackText: { fontSize: 13, fontWeight: "600" },
  btnNext: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, borderRadius: 18, paddingVertical: 12,
    shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnNextText: { color: "white", fontWeight: "700", fontSize: 14 },
  dots: {
    flexDirection: "row", justifyContent: "center",
    gap: 6, paddingBottom: 20,
  },
  dot: { height: 6, borderRadius: 3 },
});
