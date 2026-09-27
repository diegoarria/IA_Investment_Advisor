"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import { weeklyRitualsApi } from "@/lib/api";

const GREEN = "#00d47e";

// Diego (2026-09-27): these answers are what Arthur remembers week over
// week, so they can never be lost. A failed save used to be swallowed
// silently. Now: answers are kept as a local draft while typing, the save
// retries, and a failure says so and keeps everything on screen.
const DRAFT_KEY = "weeklyRitual.saturday.draft.v1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Monday of the current week in US Eastern — same week the backend files the reflection under.
function currentWeekKeyET(): string {
  try {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

const STEPS: { key: "went_well" | "learned" | "would_do_differently"; emoji: string }[] = [
  { key: "went_well", emoji: "✅" },
  { key: "learned", emoji: "🧠" },
  { key: "would_do_differently", emoji: "🔁" },
];

export default function WeeklyRitualSaturdayPage() {
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const current = STEPS[step];
  const total = STEPS.length;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const draft = raw ? JSON.parse(raw) : null;
      if (draft?.week && draft.week === currentWeekKeyET() && draft.answers) {
        setAnswers(draft.answers);
        setStep(Math.min(Math.max(0, draft.step || 0), STEPS.length - 1));
      }
    } catch {}
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded || done) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ week: currentWeekKeyET(), step, answers }));
    } catch {}
  }, [answers, step, draftLoaded, done]);

  const next = async () => {
    if (step + 1 < total) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    setSaveError(false);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await weeklyRitualsApi.saveReflection(answers);
          setDone(true);
          try { localStorage.removeItem(DRAFT_KEY); } catch {}
          return;
        } catch {
          if (attempt < 3) await sleep(1000 * 2 ** attempt);
        }
      }
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <main className="flex-1 overflow-y-auto p-6 flex items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {done ? (
            <div className="p-6 text-center">
              <div className="text-4xl mb-3">🪞</div>
              <h2 className="text-lg font-black mb-1" style={{ color: "var(--text)" }}>{t("weeklyRitual.saturday.doneTitle")}</h2>
              <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>{t("weeklyRitual.saturday.doneSubtitle")}</p>
              <a href="/weekly-ritual/saturday/history" className="text-sm font-bold" style={{ color: GREEN }}>
                {t("weeklyRitual.saturday.seeHistory")} →
              </a>
            </div>
          ) : (
            <>
              <div className="px-5 pt-5 pb-3 border-b" style={{ borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black" style={{ color: GREEN }}>🪞 {t("weeklyRitual.saturday.title")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${(step / total) * 100}%`, background: GREEN }} />
                  </div>
                  <span className="text-[10px] shrink-0" style={{ color: "var(--muted)" }}>{step + 1}/{total}</span>
                </div>
              </div>

              <div className="p-5">
                <p className="text-sm font-black mb-3" style={{ color: "var(--text)" }}>
                  {current.emoji} {t(`weeklyRitual.saturday.prompts.${current.key}`)}
                </p>
                <textarea
                  value={answers[current.key] || ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [current.key]: e.target.value }))}
                  rows={4}
                  placeholder={t("weeklyRitual.saturday.placeholder")}
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none resize-none"
                  style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}
                />
              </div>

              <div className="px-5 pb-5">
                {saveError && (
                  <p className="text-xs mb-3" style={{ color: "#f87171" }}>{t("weeklyRitual.saturday.saveError")}</p>
                )}
                <button
                  onClick={next}
                  disabled={saving}
                  className="w-full py-3 rounded-2xl font-black text-sm flex items-center justify-center gap-2"
                  style={{ background: GREEN, color: "#000" }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {step + 1 >= total ? t("weeklyRitual.saturday.finish") : t("weeklyRitual.saturday.next")}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
