import React, { useState } from "react";
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
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
  const { t } = useTranslation();
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

  // Redesign 2026-09-27 (corporate, formal): icon header + segmented
  // progress, lettered options with clear right/wrong states, an
  // explanation panel, and a results screen with a score ring. The topic
  // "emoji" prop actually carries an Ionicons name (it always did — it used
  // to render as literal text like "library-outline").
  const iconName = (topicEmoji in Ionicons.glyphMap ? topicEmoji : "book-outline") as keyof typeof Ionicons.glyphMap;
  const ACCENT = colors.accentLight;
  const RED = "#ef4444";

  const Header = () => (
    <View style={[st.header, { borderBottomColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={[st.iconBox, { backgroundColor: ACCENT + "14" }]}>
          <Ionicons name={iconName} size={19} color={ACCENT} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[st.eyebrow, { color: colors.textMuted }]}>{t("quizModal.eyebrow")}</Text>
          <Text style={[st.title, { color: colors.text }]} numberOfLines={1}>{topicTitle}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          style={[st.closeBtn, { backgroundColor: colors.bg, borderColor: colors.border }]}>
          <Ionicons name="close" size={16} color={colors.textSub} />
        </TouchableOpacity>
      </View>
      {!done && (
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {questions.map((_, i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < idx || (i === idx && answered) ? ACCENT : i === idx ? ACCENT + "55" : colors.border }} />
            ))}
          </View>
          <Text style={[st.progressText, { color: colors.textMuted }]}>{t("quizModal.questionOf", { n: idx + 1, total })}</Text>
        </View>
      )}
    </View>
  );

  const ring = (() => {
    const size = 96, stroke = 7, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const pct = total ? score / total : 0;
    const col = passed ? ACCENT : "#f59e0b";
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
        <Svg width={size} height={size} style={{ position: "absolute" }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={col} strokeWidth={stroke} fill="none" strokeLinecap="round"
                  strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </Svg>
        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text }}>{score}/{total}</Text>
      </View>
    );
  })();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Header />
          {done ? (
            <ScrollView contentContainerStyle={{ padding: 20, alignItems: "center" }}>
              {ring}
              <Text style={[st.resultTitle, { color: colors.text }]}>{passed ? t("quizModal.passed") : t("quizModal.almostThere")}</Text>
              <Text style={[st.resultSub, { color: colors.textMuted }]}>{t("quizModal.scoreLine", { score, total, passing })}</Text>

              {passed ? (
                <>
                  <View style={[st.notice, { backgroundColor: ACCENT + "12", borderColor: ACCENT + "40" }]}>
                    <Ionicons name="checkmark-circle" size={18} color={ACCENT} />
                    <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "600", color: colors.text }}>
                      {t("quizModal.markedComplete", { emoji: "", title: topicTitle }).trim()}
                    </Text>
                  </View>
                  <TouchableOpacity style={[st.primaryBtn, { backgroundColor: colors.accent }]} onPress={onPass} activeOpacity={0.85}>
                    <Text style={st.primaryText}>{t("quizModal.continue")}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {wrongAnswers.length > 0 && (
                    <View style={{ width: "100%", gap: 10, marginBottom: 16 }}>
                      {wrongAnswers.map((wa, i) => (
                        <View key={i} style={[st.review, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                          <Text style={{ fontSize: 13.5, fontWeight: "700", color: colors.text, marginBottom: 8, lineHeight: 19 }}>{wa.q.q}</Text>
                          <View style={st.reviewRow}>
                            <Ionicons name="close-circle" size={15} color={RED} />
                            <Text style={{ flex: 1, fontSize: 12.5, color: RED }}>{wa.q.options[wa.chosen]}</Text>
                          </View>
                          <View style={st.reviewRow}>
                            <Ionicons name="checkmark-circle" size={15} color={ACCENT} />
                            <Text style={{ flex: 1, fontSize: 12.5, color: ACCENT }}>{wa.q.options[wa.q.correct]}</Text>
                          </View>
                          <Text style={{ fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 6 }}>{wa.q.explanation}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
                    <TouchableOpacity style={[st.secondaryBtn, { borderColor: colors.border }]} onPress={onClose} activeOpacity={0.8}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textSub }}>{t("quizModal.close")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[st.primaryBtn, { flex: 1, marginTop: 0, backgroundColor: colors.accent }]} onPress={reset} activeOpacity={0.85}>
                      <Text style={st.primaryText}>{t("quizModal.retry")}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={[st.question, { color: colors.text }]}>{q.q}</Text>

              <View style={{ gap: 10 }}>
                {q.options.map((opt, i) => {
                  const isCorrect = answered && i === q.correct;
                  const isWrong = answered && i === selected && i !== q.correct;
                  const border = isCorrect ? ACCENT : isWrong ? RED : colors.border;
                  const bg = isCorrect ? ACCENT + "12" : isWrong ? RED + "0f" : colors.bg;
                  const fg = isCorrect ? ACCENT : isWrong ? RED : colors.text;
                  return (
                    <TouchableOpacity key={i} style={[st.option, { backgroundColor: bg, borderColor: border }]} onPress={() => choose(i)} activeOpacity={0.75} disabled={answered}>
                      <View style={[st.letter, { borderColor: border, backgroundColor: isCorrect ? ACCENT : isWrong ? RED : "transparent" }]}>
                        {isCorrect ? <Ionicons name="checkmark" size={14} color="#fff" />
                          : isWrong ? <Ionicons name="close" size={14} color="#fff" />
                          : <Text style={{ fontSize: 12, fontWeight: "800", color: colors.textSub }}>{String.fromCharCode(65 + i)}</Text>}
                      </View>
                      <Text style={{ flex: 1, fontSize: 14, lineHeight: 20, fontWeight: "600", color: fg }}>{opt}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {answered && (
                <View style={[st.explain, { backgroundColor: colors.bg, borderColor: colors.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
                    <Text style={[st.eyebrow, { color: colors.textMuted }]}>{t("quizModal.explanation")}</Text>
                  </View>
                  <Text style={{ fontSize: 13.5, color: colors.textSub, lineHeight: 20 }}>{q.explanation}</Text>
                </View>
              )}

              {answered && (
                <TouchableOpacity style={[st.primaryBtn, { backgroundColor: colors.accent }]} onPress={next} activeOpacity={0.85}>
                  <Text style={st.primaryText}>{idx + 1 >= total ? t("quizModal.seeResult") : t("quizModal.next")}</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(4,8,16,0.78)", justifyContent: "center", alignItems: "center", padding: 16 },
  card: { width: "100%", maxWidth: 460, maxHeight: "90%", borderRadius: 22, overflow: "hidden", borderWidth: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.1 },
  title: { fontSize: 16.5, fontWeight: "800", letterSpacing: -0.3, marginTop: 2 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  progressText: { fontSize: 12, fontWeight: "600", marginTop: 8 },
  question: { fontSize: 17, fontWeight: "800", letterSpacing: -0.3, lineHeight: 24, marginBottom: 18 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
  letter: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  explain: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 14 },
  primaryBtn: { width: "100%", alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14, marginTop: 16 },
  primaryText: { color: "#fff", fontSize: 14.5, fontWeight: "700" },
  secondaryBtn: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 14, paddingVertical: 14, borderWidth: 1 },
  resultTitle: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3, marginBottom: 4 },
  resultSub: { fontSize: 13.5, marginBottom: 18, textAlign: "center" },
  notice: { width: "100%", flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  review: { borderRadius: 14, borderWidth: 1, padding: 14 },
  reviewRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 3 },
});
