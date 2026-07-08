"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, X, BookOpen, MessageSquare, PieChart, Eye, Bell, User } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { getUserLevel } from "@/lib/userLevel";
import { useProfileStore } from "@/lib/store";

type PageKey = "chat" | "learn" | "portfolio" | "watchlist" | "notifications" | "profile";

function getGuide(t: TFunction): Record<PageKey, {
  icon: React.ReactNode;
  title: string;
  what: string;
  todo: string;
  tip: string;
  nextPage: string | null;
  nextLabel: string | null;
}> {
  return {
    chat: {
      icon: <MessageSquare className="w-5 h-5" />,
      title: t("guidedSteps.pages.chat.title"),
      what: t("guidedSteps.pages.chat.what"),
      todo: t("guidedSteps.pages.chat.todo"),
      tip: t("guidedSteps.pages.chat.tip"),
      nextPage: "/learn",
      nextLabel: t("guidedSteps.pages.chat.nextLabel"),
    },
    learn: {
      icon: <BookOpen className="w-5 h-5" />,
      title: t("guidedSteps.pages.learn.title"),
      what: t("guidedSteps.pages.learn.what"),
      todo: t("guidedSteps.pages.learn.todo"),
      tip: t("guidedSteps.pages.learn.tip"),
      nextPage: "/portfolio",
      nextLabel: t("guidedSteps.pages.learn.nextLabel"),
    },
    portfolio: {
      icon: <PieChart className="w-5 h-5" />,
      title: t("guidedSteps.pages.portfolio.title"),
      what: t("guidedSteps.pages.portfolio.what"),
      todo: t("guidedSteps.pages.portfolio.todo"),
      tip: t("guidedSteps.pages.portfolio.tip"),
      nextPage: "/watchlist",
      nextLabel: t("guidedSteps.pages.portfolio.nextLabel"),
    },
    watchlist: {
      icon: <Eye className="w-5 h-5" />,
      title: t("guidedSteps.pages.watchlist.title"),
      what: t("guidedSteps.pages.watchlist.what"),
      todo: t("guidedSteps.pages.watchlist.todo"),
      tip: t("guidedSteps.pages.watchlist.tip"),
      nextPage: "/notifications",
      nextLabel: t("guidedSteps.pages.watchlist.nextLabel"),
    },
    notifications: {
      icon: <Bell className="w-5 h-5" />,
      title: t("guidedSteps.pages.notifications.title"),
      what: t("guidedSteps.pages.notifications.what"),
      todo: t("guidedSteps.pages.notifications.todo"),
      tip: t("guidedSteps.pages.notifications.tip"),
      nextPage: "/profile",
      nextLabel: t("guidedSteps.pages.notifications.nextLabel"),
    },
    profile: {
      icon: <User className="w-5 h-5" />,
      title: t("guidedSteps.pages.profile.title"),
      what: t("guidedSteps.pages.profile.what"),
      todo: t("guidedSteps.pages.profile.todo"),
      tip: t("guidedSteps.pages.profile.tip"),
      nextPage: null,
      nextLabel: null,
    },
  };
}

const PAGE_ORDER: PageKey[] = ["chat", "learn", "portfolio", "watchlist", "notifications", "profile"];
const VISITED_KEY = "nuvos_visited_pages";
const DISMISSED_KEY = "nuvos_guide_dismissed";

export default function GuidedSteps({ currentPage }: { currentPage: PageKey }) {
  const { t } = useTranslation();
  const { profile } = useProfileStore();
  const router = useRouter();
  const level = getUserLevel(profile);
  const GUIDE = getGuide(t);
  const [visited, setVisited] = useState<Set<PageKey>>(new Set());
  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(VISITED_KEY);
    const saved: PageKey[] = raw ? JSON.parse(raw) : [];
    const set = new Set<PageKey>(saved);
    // Mark current page as visited
    if (!set.has(currentPage)) {
      set.add(currentPage);
      localStorage.setItem(VISITED_KEY, JSON.stringify(Array.from(set)));
    }
    setVisited(set);
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
  }, [currentPage]);

  if (level !== "basico") return null;
  if (dismissed) return null;

  const guide = GUIDE[currentPage];
  const doneCount = PAGE_ORDER.filter((p) => visited.has(p)).length;
  const totalSteps = PAGE_ORDER.length;
  const isLast = !guide.nextPage;

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mx-4 mt-3 mb-2 rounded-2xl border overflow-hidden shrink-0"
         style={{ background: "var(--card)", borderColor: "rgba(0,168,94,0.3)" }}>
      <div className="h-[3px]" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e,#3ecf8e)" }} />

      {/* Header — always visible */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2"
           style={{ borderBottom: collapsed ? "none" : "1px solid var(--border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
               style={{ background: "rgba(0,168,94,0.12)", color: "var(--accent-l)" }}>
            {guide.icon}
          </div>
          <div>
            <p className="text-[11px] font-black leading-tight" style={{ color: "var(--accent-l)" }}>
              {t("guidedSteps.guideLabel")}
            </p>
            <p className="text-[10px] leading-tight" style={{ color: "var(--dim)" }}>
              {t("guidedSteps.screensExplored", { done: doneCount, total: totalSteps })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* Progress dots */}
          <div className="flex gap-1 mr-1">
            {PAGE_ORDER.map((p) => (
              <div key={p} className="w-1.5 h-1.5 rounded-full transition-all"
                   style={{ background: visited.has(p) ? "var(--accent-l)" : p === currentPage ? "var(--accent-l)" : "var(--border)" }} />
            ))}
          </div>
          <button onClick={() => setCollapsed(!collapsed)}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "var(--muted)" }}>
            {collapsed ? t("guidedSteps.view") : t("guidedSteps.minimize")}
          </button>
          <button onClick={handleDismiss} style={{ color: "var(--dim)" }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-4 py-3 space-y-3">
          {/* Page title */}
          <div>
            <p className="font-black text-sm leading-tight" style={{ color: "var(--text)" }}>
              {guide.title}
            </p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--muted)" }}>
              {guide.what}
            </p>
          </div>

          {/* What to do now */}
          <div className="rounded-xl p-3" style={{ background: "rgba(0,168,94,0.07)", border: "1px solid rgba(0,168,94,0.2)" }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--accent-l)" }}>
              {t("guidedSteps.doThisNow")}
            </p>
            <p className="text-xs leading-snug" style={{ color: "var(--sub)" }}>
              {guide.todo}
            </p>
          </div>

          {/* Tip */}
          <p className="text-[10px] leading-snug italic" style={{ color: "var(--dim)" }}>
            💡 {guide.tip}
          </p>

          {/* Next step CTA */}
          {guide.nextPage && (
            <button onClick={() => router.push(guide.nextPage!)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold text-white transition-opacity hover:opacity-90"
                    style={{ background: "linear-gradient(135deg,#00a85e,#00d47e)" }}>
              {guide.nextLabel} <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          {isLast && doneCount >= totalSteps - 1 && (
            <div className="rounded-xl p-3 text-center"
                 style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.25)" }}>
              <p className="text-sm font-black mb-0.5" style={{ color: "var(--accent-l)" }}>{t("guidedSteps.allDoneTitle")}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>{t("guidedSteps.allDoneBody")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
