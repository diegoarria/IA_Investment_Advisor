"use client";
import { useState } from "react";
import { QUIZ_DATA, type QuizQuestion } from "@/lib/quizData";

interface Props {
  topicId: string;
  topicTitle: string;
  topicEmoji: string;
  onPass: () => void;
  onClose: () => void;
}

export default function QuizModal({ topicId, topicTitle, topicEmoji, onPass, onClose }: Props) {
  const questions = QUIZ_DATA[topicId];
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const [wrongAnswers, setWrongAnswers] = useState<{ q: QuizQuestion; chosen: number }[]>([]);

  if (!questions || questions.length === 0) {
    onPass();
    return null;
  }

  const q = questions[idx];
  const total = questions.length;
  const passing = Math.ceil(total * 0.67); // 2/3 correct to pass

  function choose(i: number) {
    if (answered) return;
    setSelected(i);
    setAnswered(true);
    const correct = i === q.correct;
    if (correct) setScore(s => s + 1);
    else setWrongAnswers(w => [...w, { q, chosen: i }]);
  }

  function next() {
    if (idx + 1 >= total) {
      setDone(true);
    } else {
      setIdx(i => i + 1);
      setSelected(null);
      setAnswered(false);
    }
  }

  const passed = score >= passing;

  if (done) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
        <div className="w-full max-w-md rounded-3xl border p-6 text-center" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          <div className="text-4xl mb-3">{passed ? "🎉" : "📚"}</div>
          <h2 className="text-xl font-black mb-1" style={{ color: "var(--text)" }}>
            {passed ? "¡Quiz aprobado!" : "Casi lo logras"}
          </h2>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
            {score}/{total} correctas · necesitabas {passing}
          </p>

          {passed ? (
            <>
              <div className="rounded-2xl p-4 mb-4" style={{ background: "rgba(0,212,126,0.08)", border: "1px solid rgba(0,212,126,0.25)" }}>
                <p className="text-sm font-bold" style={{ color: "#00d47e" }}>
                  {topicEmoji} {topicTitle} marcado como completado ✓
                </p>
              </div>
              <button
                onClick={onPass}
                className="w-full py-3 rounded-2xl font-black text-sm"
                style={{ background: "#00d47e", color: "#000" }}
              >
                Continuar →
              </button>
            </>
          ) : (
            <>
              {wrongAnswers.length > 0 && (
                <div className="text-left mb-4 space-y-3">
                  {wrongAnswers.map((wa, i) => (
                    <div key={i} className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <p className="text-xs font-bold mb-1" style={{ color: "var(--text)" }}>{wa.q.q}</p>
                      <p className="text-[10px] mb-0.5" style={{ color: "#ef4444" }}>✗ {wa.q.options[wa.chosen]}</p>
                      <p className="text-[10px] mb-1" style={{ color: "#00d47e" }}>✓ {wa.q.options[wa.q.correct]}</p>
                      <p className="text-[10px]" style={{ color: "var(--muted)" }}>{wa.q.explanation}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setIdx(0); setSelected(null); setAnswered(false); setScore(0); setDone(false); setWrongAnswers([]); }}
                  className="flex-1 py-3 rounded-2xl font-black text-sm"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                >
                  Reintentar
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-2xl font-black text-sm"
                  style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--muted)" }}
                >
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)" }}>
      <div className="w-full max-w-md rounded-3xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{topicEmoji}</span>
              <span className="text-xs font-black" style={{ color: "var(--accent-l)" }}>Quiz · {topicTitle}</span>
            </div>
            <button onClick={onClose} className="text-xs" style={{ color: "var(--muted)" }}>✕</button>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${((idx) / total) * 100}%`, background: "#00d47e" }} />
            </div>
            <span className="text-[10px] shrink-0" style={{ color: "var(--muted)" }}>{idx + 1}/{total}</span>
          </div>
        </div>

        {/* Question */}
        <div className="p-5">
          <p className="text-sm font-black mb-4" style={{ color: "var(--text)", lineHeight: 1.4 }}>{q.q}</p>

          <div className="space-y-2">
            {q.options.map((opt, i) => {
              let bg = "var(--bg)";
              let border = "var(--border)";
              let textColor = "var(--sub)";

              if (answered) {
                if (i === q.correct) { bg = "rgba(0,212,126,0.08)"; border = "rgba(0,212,126,0.4)"; textColor = "#00d47e"; }
                else if (i === selected && i !== q.correct) { bg = "rgba(239,68,68,0.05)"; border = "rgba(239,68,68,0.3)"; textColor = "#ef4444"; }
              } else if (selected === i) {
                bg = "rgba(0,212,126,0.05)"; border = "rgba(0,212,126,0.3)"; textColor = "var(--text)";
              }

              return (
                <button
                  key={i}
                  onClick={() => choose(i)}
                  className="w-full text-left px-4 py-3 rounded-2xl border text-sm font-semibold transition-all"
                  style={{ background: bg, borderColor: border, color: textColor }}
                >
                  <span className="mr-2 text-xs font-black">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {answered && (
            <div className="mt-3 rounded-2xl p-3" style={{ background: "rgba(0,212,126,0.04)", border: "1px solid rgba(0,212,126,0.15)" }}>
              <p className="text-xs" style={{ color: "var(--muted)", lineHeight: 1.5 }}>{q.explanation}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {answered && (
          <div className="px-5 pb-5">
            <button
              onClick={next}
              className="w-full py-3 rounded-2xl font-black text-sm"
              style={{ background: "#00d47e", color: "#000" }}
            >
              {idx + 1 >= total ? "Ver resultado →" : "Siguiente →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
