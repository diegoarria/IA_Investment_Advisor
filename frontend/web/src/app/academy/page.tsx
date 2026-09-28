"use client";

import { Suspense, useState } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useSearchParams, useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import { useLearnStore, getNextMilestone } from "@/lib/store";
import { BookOpen, ChevronRight, Library, Building2, LineChart, Flag, Lightbulb, Globe2, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

// Aprendizaje hub — redesigned 2026-09-27 (Diego: "muy corporativo, formal,
// elegante"), same design as mobile: neutral surfaces, hairline borders, one
// accent, line icons instead of emoji. Each category opens the topic list
// already filtered to it.

function getCategories(t: TFunction): { id: string; Icon: LucideIcon; title: string; hint: string }[] {
  return [
    { id: "basics",      Icon: Library,    title: t("academy.categories.basics"),      hint: t("academy.categoryHints.basics") },
    { id: "instruments", Icon: Building2,  title: t("academy.categories.instruments"), hint: t("academy.categoryHints.instruments") },
    { id: "analysis",    Icon: LineChart,  title: t("academy.categories.analysis"),    hint: t("academy.categoryHints.analysis") },
    { id: "strategies",  Icon: Flag,       title: t("academy.categories.strategies"),  hint: t("academy.categoryHints.strategies") },
    { id: "psychology",  Icon: Lightbulb,  title: t("academy.categories.psychology"),  hint: t("academy.categoryHints.psychology") },
    { id: "macro",       Icon: Globe2,     title: t("academy.categories.macro"),       hint: t("academy.categoryHints.macro") },
  ];
}

// Progress toward the next streak milestone.
function ProgressRing({ streak, target, label }: { streak: number; target: number | null; label: string }) {
  const size = 84, stroke = 6, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const pct = target ? Math.min(1, streak / target) : 1;
  return (
    <div className="relative flex flex-col items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--accent-l)" strokeWidth={stroke} fill="none" strokeLinecap="round"
                strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <span className="relative text-[26px] font-extrabold tracking-tight leading-none" style={{ color: "var(--text)" }}>{streak}</span>
      <span className="relative text-[10px] font-bold uppercase tracking-[0.8px] mt-1" style={{ color: "var(--muted)" }}>{label}</span>
    </div>
  );
}

function AprendizajeTab() {
  const router = useRouter();
  const { t } = useTranslation();
  const CATEGORIES = getCategories(t);
  const { streak, completedToday, completedTopicIds } = useLearnStore();
  const next = getNextMilestone(streak);

  return (
    <div className="max-w-3xl mx-auto space-y-3">
      {/* Progress */}
      <section className="rounded-[20px] border p-5 sm:p-6" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <p className="text-[11px] font-bold uppercase tracking-[1.2px] mb-3.5" style={{ color: "var(--muted)" }}>{t("academy.progressEyebrow")}</p>
        <div className="flex items-center gap-[18px]">
          <ProgressRing streak={streak} target={next?.days ?? null} label={t("academy.days")} />
          <div className="min-w-0">
            <p className="text-lg font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("academy.streakDays", { count: streak })}</p>
            <p className="text-[13px] leading-[19px] mt-1" style={{ color: "var(--muted)" }}>
              {streak > 0
                ? completedToday ? t("academy.streakActiveDone") : t("academy.streakActivePending")
                : t("academy.streakInactive")}
            </p>
          </div>
        </div>
        <div className="flex items-stretch mt-[18px] pt-4 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex-1 text-center">
            <p className="text-xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{(completedTopicIds ?? []).length}</p>
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--muted)" }}>{t("academy.completedTopics")}</p>
          </div>
          <div className="w-px" style={{ background: "var(--border)" }} />
          <div className="flex-1 text-center">
            <p className="text-xl font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{next ? t("academy.nextGoalValue", { count: next.days }) : "—"}</p>
            <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--muted)" }}>{next ? t("academy.nextGoal") : t("academy.allGoals")}</p>
          </div>
        </div>
      </section>

      {/* Topics */}
      <p className="text-[11px] font-bold uppercase tracking-[1.2px] pt-2 pb-1" style={{ color: "var(--muted)" }}>{t("academy.exploreTopics")}</p>
      <div className="rounded-[20px] border overflow-hidden grid sm:grid-cols-2" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {CATEGORIES.map((cat, i) => (
          <button
            key={cat.id}
            onClick={() => router.push(`/learn?cat=${cat.id}`)}
            className={`flex items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] ${
              i === 0 ? "" : i === 1 ? "border-t sm:border-t-0" : "border-t"
            } ${i % 2 === 1 ? "sm:border-l" : ""}`}
            style={{ borderColor: "var(--border)" }}
          >
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(0,212,126,0.08)" }}>
              <cat.Icon className="w-[19px] h-[19px]" style={{ color: "var(--accent-l)" }} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-bold tracking-tight truncate" style={{ color: "var(--text)" }}>{cat.title}</span>
              <span className="block text-[12.5px] mt-0.5 truncate" style={{ color: "var(--muted)" }}>{cat.hint}</span>
            </span>
            <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
          </button>
        ))}
      </div>

      <button
        id="tour-start-learning"
        onClick={() => router.push("/learn")}
        className="w-full flex items-center justify-center gap-2 py-[15px] mt-2 rounded-2xl font-bold text-[15px] transition-opacity hover:opacity-90"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        <BookOpen size={17} />
        {t("academy.viewAllTopics")}
      </button>
    </div>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function AcademyContent() {
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isTour = searchParams.get("tour") === "4";

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        {/* Sticky Header */}
        <div
          className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {/* pl-9 clears AppSidebar's floating mobile menu button (fixed
              top-1.5 left-1.5, ~34px wide) on mobile widths. */}
          <div className="pl-9 lg:pl-0">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {t("academy.eyebrow")}
            </p>
            <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
              {t("academy.title")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <PremiumBadge />
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto scrollbar-thin px-4 sm:px-6 py-6">
            <AprendizajeTab />
          </main>
        </div>
      </div>

      {isTour && (
        <TourSpotlight
          targetId="tour-start-learning"
          step={4}
          title={t("academy.tourTitle")}
          description={t("academy.tourDesc")}
          ctaLabel={t("academy.tourCta")}
        />
      )}
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function AcademyPage() {
  return (
    <Suspense fallback={null}>
      <AcademyContent />
    </Suspense>
  );
}
