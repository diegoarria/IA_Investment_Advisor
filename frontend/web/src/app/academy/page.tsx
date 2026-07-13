"use client";

import { Suspense, useState } from "react";
import TourSpotlight from "@/components/TourSpotlight";
import { useSearchParams, useRouter } from "next/navigation";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import PremiumBadge from "@/components/PremiumBadge";
import { useLearnStore } from "@/lib/store";
import { BookOpen, ArrowRight, Play, Smartphone } from "lucide-react";
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

// ─── Videos Tab ──────────────────────────────────────────────────────────────

function VideosTab() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {/* Description Card */}
      <div
        className="rounded-xl p-5 border"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "var(--accent)" + "22" }}
          >
            <Play size={18} style={{ color: "var(--accent)" }} />
          </div>
          <div>
            <p className="font-black" style={{ color: "var(--text)" }}>{t("academy.videosTitle")}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>{t("academy.videosSubtitle")}</p>
          </div>
        </div>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("academy.videosDesc")}
        </p>
      </div>

      {/* Open Feed Button */}
      <button
        onClick={() => router.push("/feed")}
        className="w-full flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        <Play size={16} />
        {t("academy.viewVideos")} <ArrowRight size={16} />
      </button>

      {/* Mobile Note */}
      <div
        className="rounded-xl p-4 border flex items-start gap-3"
        style={{ background: "var(--bgRaised, var(--card))", borderColor: "var(--border)" }}
      >
        <Smartphone size={18} className="shrink-0 mt-0.5" style={{ color: "var(--muted)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          <strong style={{ color: "var(--text)" }}>{t("academy.mobileNoteTitle")}</strong>{" "}
          {t("academy.mobileNoteDesc")}
        </p>
      </div>
    </div>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

const TAB_IDS = ["aprendizaje", "videos"] as const;

type TabId = (typeof TAB_IDS)[number];

function AcademyContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const TABS = [
    { id: "aprendizaje" as const, label: t("academy.tabLearning") },
    { id: "videos" as const, label: t("academy.tabVideos") },
  ];
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const rawTab = searchParams.get("tab") as TabId | null;
  const activeTab: TabId = rawTab && TABS.some((tab) => tab.id === rawTab) ? rawTab : "aprendizaje";
  const isTour = searchParams.get("tour") === "4";

  function setTab(id: TabId) {
    router.push(`/academy?tab=${id}`);
  }

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

        {/* Sub-tab Bar */}
        <div
          className="flex gap-1 px-6 py-2 border-b shrink-0"
          style={{ background: "var(--bg)", borderColor: "var(--border)" }}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === tab.id ? "var(--accent)" : "transparent",
                color: activeTab === tab.id ? "#fff" : "var(--muted)",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="flex flex-1 overflow-hidden">
          <main className="flex-1 overflow-y-auto scrollbar-thin p-4">
            {activeTab === "aprendizaje" && <AprendizajeTab />}
            {activeTab === "videos" && <VideosTab />}
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
