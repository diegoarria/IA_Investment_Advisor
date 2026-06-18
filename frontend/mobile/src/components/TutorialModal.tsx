import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/ThemeContext";

const STEPS = [
  {
    emoji: "👋",
    color: "#00b96d",
    title: "Bienvenido a Nuvos AI",
    subtitle: "Tu mentor de inversiones con IA",
    desc: "Nuvos AI te enseña a pensar como un inversor profesional. No te decimos qué comprar — te enseñamos a analizar, entender y tomar decisiones por ti mismo. Todos tus datos se sincronizan en tiempo real entre la app y la web.",
    tip: "💡 Completa el perfil inicial para que la IA adapte sus respuestas a tu nivel: Básico, Intermedio o Avanzado.",
  },
  {
    emoji: "🏠",
    color: "#00b96d",
    title: "Tu Dashboard",
    subtitle: "El pulso del mercado, de un vistazo",
    desc: "El Inicio muestra los índices S&P 500, Nasdaq y Dow Jones en tiempo real. Debajo verás el valor de tu portafolio con tres métricas clave: rendimiento de Hoy, YTD (lo que va del año) y Total acumulado.",
    tip: "💡 La sección «Subiendo hoy» muestra las 4 posiciones de tu portafolio con mayor ganancia del día.",
  },
  {
    emoji: "💬",
    color: "#10b981",
    title: "Chat con tu Mentor IA",
    subtitle: "La herramienta principal de Nuvos",
    desc: "Pregunta sobre cualquier empresa, ETF, concepto o estrategia. La IA conoce tu perfil de riesgo, tu portafolio real y tu nivel inversor, y detecta cuando tus decisiones los contradicen. Cada conversación actualiza tu madurez conductual.",
    tip: "💡 Puedes editar cualquier mensaje tuyo tocando el ícono de lápiz que aparece al lado del texto.",
  },
  {
    emoji: "📊",
    color: "#3b82f6",
    title: "Portafolio en Tiempo Real",
    subtitle: "Tus inversiones con datos vivos",
    desc: "Agrega posiciones manualmente o con una captura de tu broker — la IA extrae los datos automáticamente. Los precios se actualizan cada 30 segundos. Alterna entre vista Básica y Avanzada para ver Volumen, Market Cap, P/E y rango 52 semanas.",
    tip: "💡 El badge de moneda junto a «Mi Portafolio» indica la divisa de tu portafolio. Toca cualquier posición para ver su análisis completo.",
  },
  {
    emoji: "📅",
    color: "#f59e0b",
    title: "Calendario de Eventos",
    subtitle: "Earnings, dividendos y ex-dividendos",
    desc: "El calendario en Watchlist muestra automáticamente tres tipos de eventos para todas tus posiciones y watchlist: Earnings (resultados trimestrales), Ex-Dividendo (fecha límite para recibir el dividendo) y pago de Dividendo.",
    tip: "💡 Las posiciones de tu portafolio aparecen en verde intenso; las de watchlist en azul — así identificas de un vistazo cuáles te afectan directamente.",
  },
  {
    emoji: "👁️",
    color: "#0ea5e9",
    title: "Watchlist",
    subtitle: "Sigue acciones sin comprarlas",
    desc: "Agrega cualquier acción para seguir su precio, noticias y eventos en tiempo real. En modo Avanzado obtienes una tabla completa con after-hours, market cap, P/E ratio, fecha de earnings y rango 52 semanas.",
    tip: "💡 Arrastra las tarjetas para reordenar tu watchlist. El orden se sincroniza automáticamente entre la app y la web.",
  },
  {
    emoji: "🎮",
    color: "#8b5cf6",
    title: "Simulador Paper Trading",
    subtitle: "Practica sin dinero real",
    desc: "Opera con $10,000 virtuales a precios reales del mercado. Compra, vende y sigue tus rendimientos sin arriesgar capital. Puedes recargar el saldo virtual en cualquier momento y comparar tu desempeño en el Leaderboard.",
    tip: "💡 El simulador usa los mismos precios en tiempo real que el portafolio — la práctica refleja condiciones reales del mercado.",
  },
  {
    emoji: "📚",
    color: "#06b6d4",
    title: "Aprendizaje & Herramientas",
    subtitle: "Todo lo que necesitas para invertir mejor",
    desc: "Biblioteca de conceptos financieros con IA adaptada a tu nivel: ETFs, análisis fundamental, P/E ratio, DCA, Value Investing y psicología del inversor. El Screener semanal analiza el mercado y selecciona oportunidades personalizadas.",
    tip: "💡 La sección Inversores te muestra cómo invierten los grandes fondos — útil para identificar tendencias y validar tus ideas.",
  },
  {
    emoji: "🧠",
    color: "#a855f7",
    title: "Tu Perfil & Madurez Inversora",
    subtitle: "La IA que te conoce como inversor",
    desc: "La IA analiza tu comportamiento real — si entras en pánico, si diversificas bien, si piensas a largo plazo — y te asigna una Madurez Inversora (0-100) que evoluciona. Tu nivel (Básico, Intermedio o Avanzado) adapta toda la experiencia.",
    tip: "💡 Tu barra de riesgo conductual en el perfil se actualiza automáticamente con cada conversación. Puedes cambiar tu nivel en Perfil en cualquier momento.",
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
