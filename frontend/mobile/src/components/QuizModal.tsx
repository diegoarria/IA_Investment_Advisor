import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
} from "react-native";
import { QUIZ_DATA, type QuizQuestion } from "../lib/quizData";
import { useTheme } from "../lib/ThemeContext";

interface Props {
  visible: boolean;
  topicId: string;
  topicTitle: string;
  topicEmoji: string;
  onPass: () => void;
  onClose: () => void;
}

export default function QuizModal({ visible, topicId, topicTitle, topicEmoji, onPass, onClose }: Props) {
  const { colors } = useTheme();
  const questions = QUIZ_DATA[topicId] || [];
  const total = questions.length;
  const passing = Math.ceil(total * 0.67);

  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [wrongAnswers, setWrongAnswers] = useState<{ q: QuizQuestion; chosen: number }[]>([]);

  function reset() {
    setIdx(0); setSelected(null); setAnswered(false);
    setScore(0); setDone(false); setWrongAnswers([]);
  }

  function choose(i: number) {
    if (answered) return;
    setSelected(i);
    setAnswered(true);
    const correct = questions[idx].correct;
    if (i === correct) setScore(s => s + 1);
    else setWrongAnswers(w => [...w, { q: questions[idx], chosen: i }]);
  }

  function next() {
    if (idx + 1 >= total) setDone(true);
    else { setIdx(i => i + 1); setSelected(null); setAnswered(false); }
  }

  if (!visible || questions.length === 0) return null;

  const q = questions[idx];
  const passed = score >= passing;

  const s = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.88)", justifyContent: "center", alignItems: "center", padding: 16 },
    card:    { width: "100%", maxWidth: 440, borderRadius: 28, overflow: "hidden", borderWidth: 1 },
    header:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: StyleSheet.hairlineWidth },
    option:  { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, borderWidth: 1, marginBottom: 8 },
    btn:     { paddingVertical: 14, borderRadius: 18, alignItems: "center", marginTop: 12 },
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {done ? (
            /* ── Result Screen ── */
            <ScrollView contentContainerStyle={{ padding: 24, alignItems: "center" }}>
              <Text style={{ fontSize: 48, marginBottom: 8 }}>{passed ? "🎉" : "📚"}</Text>
              <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text, marginBottom: 4 }}>
                {passed ? "¡Quiz aprobado!" : "Casi lo logras"}
              </Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16 }}>
                {score}/{total} correctas · necesitabas {passing}
              </Text>

              {passed ? (
                <>
                  <View style={{ width: "100%", borderRadius: 16, padding: 14, backgroundColor: "rgba(0,212,126,0.08)", borderWidth: 1, borderColor: "rgba(0,212,126,0.25)", marginBottom: 16 }}>
                    <Text style={{ fontSize: 13, fontWeight: "800", color: "#00d47e", textAlign: "center" }}>
                      {topicEmoji} {topicTitle} marcado como completado ✓
                    </Text>
                  </View>
                  <TouchableOpacity style={[s.btn, { backgroundColor: "#00d47e", width: "100%" }]} onPress={onPass} activeOpacity={0.8}>
                    <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>Continuar →</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {wrongAnswers.length > 0 && (
                    <View style={{ width: "100%", marginBottom: 16, gap: 8 }}>
                      {wrongAnswers.map((wa, i) => (
                        <View key={i} style={{ borderRadius: 14, padding: 12, backgroundColor: "rgba(239,68,68,0.05)", borderWidth: 1, borderColor: "rgba(239,68,68,0.15)" }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: colors.text, marginBottom: 4 }}>{wa.q.q}</Text>
                          <Text style={{ fontSize: 10, color: "#ef4444", marginBottom: 2 }}>✗ {wa.q.options[wa.chosen]}</Text>
                          <Text style={{ fontSize: 10, color: "#00d47e", marginBottom: 4 }}>✓ {wa.q.options[wa.q.correct]}</Text>
                          <Text style={{ fontSize: 10, color: colors.textMuted }}>{wa.q.explanation}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={{ flexDirection: "row", gap: 8, width: "100%" }}>
                    <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }]} onPress={reset} activeOpacity={0.8}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>Reintentar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[s.btn, { flex: 1, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border }]} onPress={onClose} activeOpacity={0.8}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.textMuted }}>Cerrar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          ) : (
            /* ── Question Screen ── */
            <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
              {/* Header */}
              <View style={[s.header, { borderBottomColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Text style={{ fontSize: 14 }}>{topicEmoji}</Text>
                    <Text style={{ fontSize: 11, fontWeight: "800", color: colors.accent }}>Quiz · {topicTitle}</Text>
                  </View>
                  {/* Progress bar */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" }}>
                      <View style={{ width: `${(idx / total) * 100}%`, height: "100%", backgroundColor: colors.accent, borderRadius: 4 }} />
                    </View>
                    <Text style={{ fontSize: 10, color: colors.textMuted }}>{idx + 1}/{total}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={onClose} style={{ marginLeft: 12 }}>
                  <Text style={{ fontSize: 16, color: colors.textMuted }}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={{ padding: 16 }}>
                {/* Question */}
                <Text style={{ fontSize: 14, fontWeight: "900", color: colors.text, marginBottom: 16, lineHeight: 20 }}>
                  {q.q}
                </Text>

                {/* Options */}
                {q.options.map((opt, i) => {
                  let bg = colors.bg;
                  let border = colors.border;
                  let textColor = colors.textSub;
                  if (answered) {
                    if (i === q.correct) { bg = "rgba(0,212,126,0.08)"; border = "rgba(0,212,126,0.4)"; textColor = "#00d47e"; }
                    else if (i === selected && i !== q.correct) { bg = "rgba(239,68,68,0.05)"; border = "rgba(239,68,68,0.3)"; textColor = "#ef4444"; }
                  } else if (selected === i) {
                    bg = "rgba(0,212,126,0.05)"; border = "rgba(0,212,126,0.3)"; textColor = colors.text;
                  }
                  return (
                    <TouchableOpacity key={i} style={[s.option, { backgroundColor: bg, borderColor: border }]} onPress={() => choose(i)} activeOpacity={0.7}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: textColor }}>
                        <Text style={{ fontWeight: "900" }}>{String.fromCharCode(65 + i)}. </Text>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Explanation */}
                {answered && (
                  <View style={{ borderRadius: 16, padding: 12, backgroundColor: "rgba(0,212,126,0.04)", borderWidth: 1, borderColor: "rgba(0,212,126,0.15)", marginTop: 4 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 18 }}>{q.explanation}</Text>
                  </View>
                )}

                {/* Next button */}
                {answered && (
                  <TouchableOpacity style={[s.btn, { backgroundColor: "#00d47e" }]} onPress={next} activeOpacity={0.8}>
                    <Text style={{ fontSize: 14, fontWeight: "900", color: "#000" }}>
                      {idx + 1 >= total ? "Ver resultado →" : "Siguiente →"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
