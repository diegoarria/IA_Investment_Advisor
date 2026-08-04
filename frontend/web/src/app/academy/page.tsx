"use client";

import { Suspense, useState } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useSearchParams, useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import { useLearnStore } from "@/lib/store";
import { BookOpen, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

// ─── Category Grid ───────────────────────────────────────────────────────────

function getCategories(t: TFunction) {
  return [
    { emoji: "📚", title: t("academy.categories.basics") },
    { emoji: "🏦", title: t("academy.categories.instruments") },
    { emoji: "📊", title: t("academy.categories.analysis") },
    { emoji: "🎯", title: t("academy.categories.strategies") },
    { emoji: "🧠", title: t("academy.categories.psychology") },
    { emoji: "🌐", title: t("academy.categories.macro") },
  ];
}

// ─── Aprendizaje Tab ─────────────────────────────────────────────────────────

function AprendizajeTab() {
  const router = useRouter();
  const { t } = useTranslation();
  const CATEGORIES = getCategories(t);
  const { streak, completedToday } = useLearnStore();

  return (
    <div className="space-y-4">
      {/* Streak Card */}
      <div
        className="rounded-xl p-5 border flex items-center gap-4"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div
          className="w-14 h-14 rounded-full flex flex-col items-center justify-center border-2 shrink-0"
          style={{
            borderColor: streak > 0 ? "#f59e0b" : "var(--border)",
            background: streak > 0 ? "#f59e0b18" : "var(--bg)",
          }}
        >
          <span className="text-2xl leading-none">{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}</span>
          <span
            className="text-sm font-black leading-none mt-0.5"
            style={{ color: streak > 0 ? "#f59e0b" : "var(--muted)" }}
          >
            {streak}
          </span>
        </div>
        <div>
          <p className="font-black text-lg" style={{ color: "var(--text)" }}>
            {t("academy.streakDays", { count: streak })}
          </p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {streak > 0
              ? completedToday
                ? t("academy.streakActiveDone")
                : t("academy.streakActivePending")
              : t("academy.streakInactive")}
          </p>
        </div>
      </div>

      {/* Category Grid */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--muted)" }}>
          {t("academy.exploreTopics")}
        </p>
        <div className="grid grid-cols-3 gap-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.title}
              onClick={() => router.push("/learn")}
              className="rounded-xl p-4 border text-left transition-all hover:opacity-80 active:scale-95"
              style={{ background: "var(--card)", borderColor: "var(--border)" }}
            >
              <span className="text-2xl block mb-2">{cat.emoji}</span>
              <p className="font-bold text-sm" style={{ color: "var(--text)" }}>
                {cat.title}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Ver todos button */}
      <button
        id="tour-start-learning"
        onClick={() => router.push("/learn")}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        <BookOpen size={16} />
        {t("academy.viewAllTopics")} <ArrowRight size={16} />
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
          <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
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
