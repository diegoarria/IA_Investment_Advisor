"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  X, Check, Info, CheckCircle2, XCircle, Library, LayoutGrid, Building2, Calculator, LineChart, Flag, Zap,
  Lightbulb, Globe2, Globe, MapPin, Briefcase, Sparkles, type LucideIcon,
} from "lucide-react";
import { QUIZ_DATA, type QuizQuestion } from "@/lib/quizData";

interface Props {
  topicId: string;
  topicTitle: string;
  // A learn category id ("basics", "macro"…) or "search" → shown as a line
  // icon (redesign 2026-09-27); anything else falls back to a generic icon.
  topicEmoji: string;
  onPass: () => void;
  onClose: () => void;
}

const TOPIC_ICON: Record<string, LucideIcon> = {
  all: LayoutGrid, basics: Library, instruments: Building2, ratios: Calculator, analysis: LineChart,
  strategies: Flag, trading: Zap, psychology: Lightbulb, macro: Globe2, markets: Globe, mexico: MapPin,
  companies: Briefcase, search: Sparkles,
};

const ACCENT = "var(--accent-l)";
const RED = "#ef4444";

// Assessment — corporate, formal redesign (2026-09-27), same as mobile's
// QuizModal: icon header + segmented progress, lettered options with clear
// right/wrong states, an explanation panel, and a results screen with a
// score ring.
export default function QuizModal({ topicId, topicTitle, topicEmoji, onPass, onClose }: Props) {
  const { t } = useTranslation();
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
  const passed = score >= passing;
  const Icon = TOPIC_ICON[topicEmoji] ?? Library;

  function choose(i: number) {
    if (answered) return;
    setSelected(i);
    setAnswered(true);
    if (i === q.correct) setScore((s) => s + 1);
    else setWrongAnswers((w) => [...w, { q, chosen: i }]);
  }

  function next() {
    if (idx + 1 >= total) setDone(true);
    else { setIdx((i) => i + 1); setSelected(null); setAnswered(false); }
  }

  function reset() {
    setIdx(0); setSelected(null); setAnswered(false); setScore(0); setDone(false); setWrongAnswers([]);
  }

  const ringSize = 96, stroke = 7, r = (ringSize - stroke) / 2, c = 2 * Math.PI * r;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(4,8,16,0.78)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-[460px] max-h-[90vh] rounded-[22px] border overflow-hidden flex flex-col" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {/* Header */}
        <div className="px-5 pt-4 pb-3.5 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(0,212,126,0.08)" }}>
              <Icon className="w-[19px] h-[19px]" style={{ color: ACCENT }} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[1.1px]" style={{ color: "var(--muted)" }}>{t("quizModal.eyebrow")}</p>
              <p className="text-[16.5px] font-extrabold tracking-tight truncate" style={{ color: "var(--text)" }}>{topicTitle}</p>
            </div>
            <button onClick={onClose} aria-label="close"
                    className="w-8 h-8 rounded-full border flex items-center justify-center shrink-0"
                    style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--sub)" }}>
              <X className="w-4 h-4" />
            </button>
          </div>
          {!done && (
            <div className="mt-3.5">
              <div className="flex gap-1">
                {questions.map((_, i) => (
                  <div key={i} className="flex-1 h-1 rounded-sm transition-colors"
                       style={{ background: i < idx || (i === idx && answered) ? ACCENT : i === idx ? "rgba(0,212,126,0.35)" : "var(--border)" }} />
                ))}
              </div>
              <p className="text-xs font-semibold mt-2" style={{ color: "var(--muted)" }}>{t("quizModal.questionOf", { n: idx + 1, total })}</p>
            </div>
          )}
        </div>

        {done ? (
          <div className="p-5 overflow-y-auto flex flex-col items-center text-center">
            <div className="relative flex items-center justify-center mb-4" style={{ width: ringSize, height: ringSize }}>
              <svg width={ringSize} height={ringSize} className="absolute inset-0">
                <circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
                <circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={passed ? ACCENT : "#f59e0b"} strokeWidth={stroke} fill="none"
                        strokeLinecap="round" strokeDasharray={`${c * (score / total)} ${c}`} transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`} />
              </svg>
              <span className="relative text-2xl font-extrabold" style={{ color: "var(--text)" }}>{score}/{total}</span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight mb-1" style={{ color: "var(--text)" }}>
              {passed ? t("quizModal.passed") : t("quizModal.almostThere")}
            </h2>
            <p className="text-[13.5px] mb-[18px]" style={{ color: "var(--muted)" }}>{t("quizModal.scoreSummary", { score, total, passing })}</p>

            {passed ? (
              <>
                <div className="w-full flex items-center gap-2.5 rounded-[14px] border p-3.5 text-left" style={{ background: "rgba(0,212,126,0.07)", borderColor: "rgba(0,212,126,0.25)" }}>
                  <CheckCircle2 className="w-[18px] h-[18px] shrink-0" style={{ color: ACCENT }} />
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--text)" }}>{t("quizModal.markedComplete", { emoji: "", title: topicTitle }).trim()}</p>
                </div>
                <button onClick={onPass} className="w-full mt-4 py-3.5 rounded-[14px] text-[14.5px] font-bold text-white" style={{ background: "var(--accent)" }}>
                  {t("quizModal.continue")}
                </button>
              </>
            ) : (
              <>
                {wrongAnswers.length > 0 && (
                  <div className="w-full text-left mb-4 space-y-2.5">
                    {wrongAnswers.map((wa, i) => (
                      <div key={i} className="rounded-[14px] border p-3.5" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                        <p className="text-[13.5px] font-bold leading-[19px] mb-2" style={{ color: "var(--text)" }}>{wa.q.q}</p>
                        <p className="flex items-start gap-1.5 text-[12.5px]" style={{ color: RED }}><XCircle className="w-[15px] h-[15px] shrink-0 mt-px" />{wa.q.options[wa.chosen]}</p>
                        <p className="flex items-start gap-1.5 text-[12.5px] mt-1" style={{ color: ACCENT }}><CheckCircle2 className="w-[15px] h-[15px] shrink-0 mt-px" />{wa.q.options[wa.q.correct]}</p>
                        <p className="text-[12.5px] leading-[18px] mt-1.5" style={{ color: "var(--muted)" }}>{wa.q.explanation}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="w-full flex gap-2.5">
                  <button onClick={onClose} className="flex-1 py-3.5 rounded-[14px] border text-sm font-bold" style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                    {t("quizModal.close")}
                  </button>
                  <button onClick={reset} className="flex-1 py-3.5 rounded-[14px] text-[14.5px] font-bold text-white" style={{ background: "var(--accent)" }}>
                    {t("quizModal.retry")}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="p-5 overflow-y-auto">
            <p className="text-[17px] font-extrabold tracking-tight leading-6 mb-[18px]" style={{ color: "var(--text)" }}>{q.q}</p>

            <div className="space-y-2.5">
              {q.options.map((opt, i) => {
                const isCorrect = answered && i === q.correct;
                const isWrong = answered && i === selected && i !== q.correct;
                const border = isCorrect ? ACCENT : isWrong ? RED : "var(--border)";
                const bg = isCorrect ? "rgba(0,212,126,0.07)" : isWrong ? "rgba(239,68,68,0.06)" : "var(--bg)";
                const fg = isCorrect ? ACCENT : isWrong ? RED : "var(--text)";
                return (
                  <button
                    key={i}
                    onClick={() => choose(i)}
                    disabled={answered}
                    className="w-full flex items-center gap-3 text-left px-3.5 py-[13px] rounded-[14px] border transition-colors enabled:hover:border-[#00d47e]/40"
                    style={{ background: bg, borderColor: border }}
                  >
                    <span className="w-[26px] h-[26px] rounded-full border flex items-center justify-center shrink-0"
                          style={{ borderColor: border, background: isCorrect ? ACCENT : isWrong ? RED : "transparent" }}>
                      {isCorrect ? <Check className="w-3.5 h-3.5 text-white" />
                        : isWrong ? <X className="w-3.5 h-3.5 text-white" />
                        : <span className="text-xs font-extrabold" style={{ color: "var(--sub)" }}>{String.fromCharCode(65 + i)}</span>}
                    </span>
                    <span className="flex-1 text-sm leading-5 font-semibold" style={{ color: fg }}>{opt}</span>
                  </button>
                );
              })}
            </div>

            {answered && (
              <div className="mt-3.5 rounded-[14px] border p-3.5" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[1.1px] mb-1.5" style={{ color: "var(--muted)" }}>
                  <Info className="w-4 h-4" />{t("quizModal.explanation")}
                </p>
                <p className="text-[13.5px] leading-5" style={{ color: "var(--sub)" }}>{q.explanation}</p>
              </div>
            )}

            {answered && (
              <button onClick={next} className="w-full mt-4 py-3.5 rounded-[14px] text-[14.5px] font-bold text-white" style={{ background: "var(--accent)" }}>
                {idx + 1 >= total ? t("quizModal.seeResult") : t("quizModal.next")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
