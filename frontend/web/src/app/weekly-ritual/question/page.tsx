"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Lock } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import PaywallModal from "@/components/PaywallModal";
import { weeklyRitualsApi } from "@/lib/api";
import { useSubscriptionStore } from "@/lib/store";

// Same visual language as QuizModal.tsx (the "Academy" flashcard pattern
// Diego asked this to look like) — centered card, A/B option buttons that
// color in once answered, green (#00d47e) as the primary accent.
const GREEN = "#00d47e";

interface QuestionData {
  question_id: string;
  date: string;
  question: string;
  option_a: string;
  option_b: string;
  voted: boolean;
  my_choice: "a" | "b" | null;
  total_votes?: number;
  pct_a?: number | null;
  pct_b?: number | null;
  nuvos_choice: "a" | "b" | null;
  nuvos_explanation: string | null;
}

export default function WeeklyRitualQuestionPage() {
  const { t, i18n } = useTranslation();
  const sub = useSubscriptionStore();
  const isPremium = sub.tier === "premium" || sub.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [data, setData] = useState<QuestionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [revealNuvos, setRevealNuvos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    weeklyRitualsApi.getQuestion(i18n.language)
      .then((res) => setData(res.data))
      .catch(() => setError(t("weeklyRitual.question.error")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [i18n.language]);

  const choose = async (choice: "a" | "b") => {
    if (voting || data?.voted) return;
    setVoting(true);
    try {
      const res = await weeklyRitualsApi.vote(choice);
      setData((d) => d ? {
        ...d, voted: true, my_choice: choice,
        total_votes: res.data.total_votes, pct_a: res.data.pct_a, pct_b: res.data.pct_b,
      } : d);
    } catch {
      // Already voted today (409) or a transient error — reload to show real state either way.
      load();
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        {loading ? (
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: GREEN }} />
        ) : error || !data ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>{error || t("weeklyRitual.question.error")}</p>
        ) : (
          <div className="w-full max-w-md rounded-3xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
              <span className="text-xs font-black" style={{ color: GREEN }}>🎯 {t("weeklyRitual.question.title")}</span>
            </div>

            <div className="p-5">
              <p className="text-sm font-black mb-4" style={{ color: "var(--text)", lineHeight: 1.4 }}>{data.question}</p>

              <div className="space-y-2">
                {(["a", "b"] as const).map((opt) => {
                  const label = opt === "a" ? data.option_a : data.option_b;
                  const pct = opt === "a" ? data.pct_a : data.pct_b;
                  const isMine = data.my_choice === opt;
                  let bg = "var(--bg)", border = "var(--border)", textColor = "var(--sub)";
                  if (data.voted) {
                    if (isMine) { bg = "rgba(0,212,126,0.08)"; border = "rgba(0,212,126,0.4)"; textColor = GREEN; }
                  }
                  return (
                    <button
                      key={opt}
                      onClick={() => choose(opt)}
                      disabled={data.voted || voting}
                      className="w-full text-left px-4 py-3 rounded-2xl border text-sm font-semibold transition-all relative overflow-hidden"
                      style={{ background: bg, borderColor: border, color: textColor }}
                    >
                      {data.voted && pct !== null && pct !== undefined && (
                        <div className="absolute inset-0 -z-0" style={{ width: `${pct}%`, background: isMine ? "rgba(0,212,126,0.12)" : "rgba(255,255,255,0.04)" }} />
                      )}
                      <span className="relative flex items-center justify-between gap-2">
                        <span>{label}</span>
                        {data.voted && pct !== null && pct !== undefined && (
                          <span className="text-xs font-black shrink-0">{pct}%</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {data.voted && (
                <p className="text-[11px] mt-3" style={{ color: "var(--muted)" }}>
                  {t("weeklyRitual.question.communityVoted", {
                    pct: data.my_choice === "a" ? data.pct_a : data.pct_b,
                    option: data.my_choice === "a" ? data.option_a : data.option_b,
                  })}
                </p>
              )}
            </div>

            {data.voted && (
              <div className="px-5 pb-5">
                {!isPremium ? (
                  <button
                    onClick={() => setPaywallOpen(true)}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-black text-sm"
                    style={{ background: "var(--raised)", color: "var(--muted)" }}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    {t("weeklyRitual.question.premiumCta")}
                  </button>
                ) : !revealNuvos ? (
                  <button
                    onClick={() => setRevealNuvos(true)}
                    className="w-full py-3 rounded-2xl font-black text-sm"
                    style={{ background: GREEN, color: "#000" }}
                  >
                    {t("weeklyRitual.question.revealCta")}
                  </button>
                ) : (
                  <div className="rounded-2xl p-4" style={{ background: "rgba(0,212,126,0.06)", border: "1px solid rgba(0,212,126,0.2)" }}>
                    <p className="text-xs font-black mb-1.5" style={{ color: GREEN }}>
                      {t("weeklyRitual.question.nuvosChoiceLabel", { option: data.nuvos_choice === "a" ? data.option_a : data.option_b })}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{data.nuvos_explanation}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} reason={t("weeklyRitual.question.paywallReason")} />
    </div>
  );
}
