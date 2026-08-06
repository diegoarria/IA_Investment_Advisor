"use client";

// Fase 4, Incremento 11 — Investment Journal (Parte K, see
// /Users/diegoarria/.claude/plans/stateful-painting-flurry.md). Promotes
// DiarioDecisionesCard/InvestmentGraphSection out of /profile's collapsible
// widgets into their own dedicated page, and adds the one piece of UI that
// never existed anywhere: "Tus tesis" — every ticker the user has adopted
// or hand-written a personal thesis for, with adopt/edit/review actions.
// Every action here calls an already-existing Fase 3 engine
// (fork/create_thesis_version/Thesis Tracker) — no new financial logic.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { ChevronRight, NotebookPen, Loader2 } from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PaywallModal from "@/components/PaywallModal";
import DiarioDecisionesCard from "@/components/DiarioDecisionesCard";
import InvestmentGraphSection from "@/components/InvestmentGraphSection";
import { useAuthStore, useSubscriptionStore } from "@/lib/store";
import { researchEngineApi } from "@/lib/api";
import { Card, SectionHeader } from "@/components/ui";

interface MyThesisRow {
  ticker: string;
  version: number;
  thesis_summary: string;
  strengths: { text: string }[];
  critical_variables: { text: string }[];
  key_risks: { text: string }[];
  invalidation_events: { text: string }[];
  created_at: string;
}

interface ReviewResult {
  what_changed: string | null;
  thesis_change_explanation: string | null;
  new_thesis_version: { version: number } | null;
}

function claimsToLines(claims: { text: string }[] | undefined): string {
  return (claims ?? []).map((c) => c.text).join("\n");
}

function linesToList(value: string): string[] {
  return value.split("\n").map((l) => l.trim()).filter(Boolean);
}

function ThesisRow({ thesis, onSaved }: { thesis: MyThesisRow; onSaved: (row: MyThesisRow) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(thesis.thesis_summary);
  const [strengths, setStrengths] = useState(claimsToLines(thesis.strengths));
  const [risks, setRisks] = useState(claimsToLines(thesis.key_risks));
  const [criticalVars, setCriticalVars] = useState(claimsToLines(thesis.critical_variables));
  const [invalidation, setInvalidation] = useState(claimsToLines(thesis.invalidation_events));
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<ReviewResult | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!summary.trim()) return;
    setSaving(true);
    try {
      const res = await researchEngineApi.saveMyThesis(thesis.ticker, {
        thesis_summary: summary.trim(),
        strengths: linesToList(strengths),
        critical_variables: linesToList(criticalVars),
        key_risks: linesToList(risks),
        invalidation_events: linesToList(invalidation),
      });
      onSaved(res.data);
      setEditing(false);
    } catch {
      // real failure — stay in edit mode so the user can retry
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async () => {
    setReviewing(true);
    setReviewError(null);
    try {
      const res = await researchEngineApi.reviewThesis(thesis.ticker);
      setReview(res.data);
    } catch {
      setReviewError(t("investmentJournal.theses.reviewError"));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <button
            onClick={() => router.push(`/subvaluadas?ticker=${thesis.ticker}`)}
            className="text-sm font-bold hover:underline"
            style={{ color: "var(--text)" }}
          >
            {thesis.ticker}
          </button>
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
            {t("investmentJournal.theses.version", { version: thesis.version })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-[11px] font-semibold"
            style={{ color: "var(--accent-l)" }}
          >
            {editing ? t("investmentJournal.theses.cancel") : t("investmentJournal.theses.edit")}
          </button>
          <button
            onClick={handleReview}
            disabled={reviewing}
            className="text-[11px] font-semibold disabled:opacity-40"
            style={{ color: "var(--accent-l)" }}
          >
            {reviewing ? t("investmentJournal.theses.reviewing") : t("investmentJournal.theses.review")}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            className="w-full text-[12px] rounded-lg px-2.5 py-1.5 border bg-transparent resize-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={t("investmentJournal.theses.summaryPlaceholder")}
          />
          <textarea
            value={risks}
            onChange={(e) => setRisks(e.target.value)}
            rows={2}
            className="w-full text-[12px] rounded-lg px-2.5 py-1.5 border bg-transparent resize-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={t("investmentJournal.theses.risksPlaceholder")}
          />
          <textarea
            value={strengths}
            onChange={(e) => setStrengths(e.target.value)}
            rows={2}
            className="w-full text-[12px] rounded-lg px-2.5 py-1.5 border bg-transparent resize-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={t("investmentJournal.theses.strengthsPlaceholder")}
          />
          <textarea
            value={criticalVars}
            onChange={(e) => setCriticalVars(e.target.value)}
            rows={2}
            className="w-full text-[12px] rounded-lg px-2.5 py-1.5 border bg-transparent resize-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={t("investmentJournal.theses.criticalVarsPlaceholder")}
          />
          <textarea
            value={invalidation}
            onChange={(e) => setInvalidation(e.target.value)}
            rows={2}
            className="w-full text-[12px] rounded-lg px-2.5 py-1.5 border bg-transparent resize-none"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            placeholder={t("investmentJournal.theses.invalidationPlaceholder")}
          />
          <button
            onClick={handleSave}
            disabled={saving || !summary.trim()}
            className="text-[11.5px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
            style={{ background: "var(--accent-l)", color: "#0a0a0a" }}
          >
            {saving ? t("investmentJournal.theses.saving") : t("investmentJournal.theses.save")}
          </button>
        </div>
      ) : (
        <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{thesis.thesis_summary}</p>
      )}

      {reviewError && <p className="text-[11px] mt-2" style={{ color: "#ef4444" }}>{reviewError}</p>}
      {review && (
        <div className="mt-3 pt-3 border-t space-y-1.5" style={{ borderColor: "var(--border)" }}>
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            {t("investmentJournal.theses.reviewResultTitle")}
          </p>
          {review.what_changed ? (
            <>
              <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{review.what_changed}</p>
              {review.thesis_change_explanation && (
                <p className="text-[12px] leading-relaxed" style={{ color: "var(--sub)" }}>{review.thesis_change_explanation}</p>
              )}
              {review.new_thesis_version && (
                <p className="text-[11px]" style={{ color: "var(--accent-l)" }}>
                  {t("investmentJournal.theses.newVersionCreated", { version: review.new_thesis_version.version })}
                </p>
              )}
            </>
          ) : (
            <p className="text-[12px] italic" style={{ color: "var(--muted)" }}>{t("investmentJournal.theses.noChange")}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function JournalPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const subStore = useSubscriptionStore();
  const isPremium = subStore.tier === "premium" || subStore.isTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [theses, setTheses] = useState<MyThesisRow[]>([]);
  const [thesesLoading, setThesesLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) { router.push("/login"); return; }
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (!isPremium) { setThesesLoading(false); return; }
    let cancelled = false;
    researchEngineApi.getAllMyTheses()
      .then((res) => { if (!cancelled) setTheses(res.data?.theses ?? []); })
      .catch(() => { if (!cancelled) setTheses([]); })
      .finally(() => { if (!cancelled) setThesesLoading(false); });
    return () => { cancelled = true; };
  }, [isPremium]);

  const handleThesisSaved = (updated: MyThesisRow) => {
    setTheses((prev) => prev.map((t2) => (t2.ticker === updated.ticker ? updated : t2)));
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

            <div className="flex items-center gap-2.5">
              <NotebookPen className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              <div>
                <h1 className="text-2xl font-black" style={{ color: "var(--text)" }}>{t("investmentJournal.title")}</h1>
                <p className="text-sm" style={{ color: "var(--muted)" }}>{t("investmentJournal.subtitle")}</p>
              </div>
            </div>

            {/* Tus tesis */}
            <Card>
              <SectionHeader title={t("investmentJournal.theses.title")} subtitle={t("investmentJournal.theses.subtitle")} />
              {!isPremium ? (
                <button
                  onClick={() => setPaywallOpen(true)}
                  className="text-[12px] font-semibold"
                  style={{ color: "var(--accent-l)" }}
                >
                  {t("investmentJournal.theses.premiumRequired")}
                </button>
              ) : thesesLoading ? (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} />
                  <span className="text-[12px]" style={{ color: "var(--muted)" }}>{t("investmentJournal.theses.loading")}</span>
                </div>
              ) : theses.length === 0 ? (
                <div className="flex items-center justify-between gap-3 py-2">
                  <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t("investmentJournal.theses.empty")}</p>
                  <button
                    onClick={() => router.push("/subvaluadas")}
                    className="flex items-center gap-1 text-[11.5px] font-semibold shrink-0"
                    style={{ color: "var(--accent-l)" }}
                  >
                    {t("investmentJournal.theses.goResearch")} <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {theses.map((thesis) => (
                    <ThesisRow key={thesis.ticker} thesis={thesis} onSaved={handleThesisSaved} />
                  ))}
                </div>
              )}
            </Card>

            {/* Fortalezas y Puntos Ciegos — promovido desde /profile */}
            <DiarioDecisionesCard isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} />

            {/* Bitácora — Investment Graph — promovido desde /profile */}
            <InvestmentGraphSection isPremium={isPremium} onUpgrade={() => setPaywallOpen(true)} />

          </div>
        </main>
      </div>

      <PaywallModal visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </div>
  );
}
