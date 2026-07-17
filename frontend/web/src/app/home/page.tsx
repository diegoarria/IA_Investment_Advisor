"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  TrendingUp, TrendingDown, Sparkles, BookOpen,
  Bell, ChevronRight, GraduationCap, Newspaper, Target, Flame, X,
} from "lucide-react";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import HomeMarketOverview from "@/components/HomeMarketOverview";
import StockAvatar from "@/components/StockAvatar";
import PersonalizedMessageBanner from "@/components/PersonalizedMessageBanner";
import { market as marketApi, notifications as notifApi, profile as profileApi, sync as syncApi, watchlist as watchlistApi, billing } from "@/lib/api";
import PricingModal from "@/components/PricingModal";
import { useAuthStore, useProfileStore, useLearnStore, useSubscriptionStore, useChatStore } from "@/lib/store";
import OnboardingChecklist, { type OnboardingStep } from "@/components/OnboardingChecklist";
import HomeScreenPickerModal, { HOME_SCREEN_KEY } from "@/components/HomeScreenPickerModal";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { useFxRate } from "@/lib/useFxRate";
import { isNYSEOpen } from "@/lib/marketHours";
import { registerWebPush } from "@/lib/webPush";
import { getUserLevel } from "@/lib/userLevel";

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENCY_SYM: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", JPY: "¥", MXN: "$", ARS: "$", BRL: "R$",
};

function fmt(n: number, currency = "USD") {
  const sym = CURRENCY_SYM[currency] ?? "$";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}M`;
  return `${sign}${sym}${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function greeting(t: TFunction): string {
  const h = new Date().getHours();
  if (h < 12) return t("home.greeting.morning");
  if (h < 19) return t("home.greeting.afternoon");
  return t("home.greeting.evening");
}

function notifIcon(type: string): string {
  if (type === "price_alert") return "📈";
  if (type === "earnings")    return "📊";
  if (type === "news")        return "📰";
  if (type === "portfolio")   return "💼";
  if (type === "dividend")    return "💰";
  return "🔔";
}

function timeAgo(ts: string | number, t: TFunction): string {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return t("home.timeAgoNow");
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const DAILY_LESSON_KEYS = [
  { emoji: "🥧", key: "diversification" },
  { emoji: "📅", key: "dca" },
  { emoji: "💰", key: "dividends" },
  { emoji: "📈", key: "peRatio" },
  { emoji: "🛡️", key: "moat" },
  { emoji: "⚠️", key: "lossAversion" },
  { emoji: "🔄", key: "rebalancing" },
  { emoji: "📊", key: "freeCashFlow" },
  { emoji: "🎯", key: "investmentHorizon" },
  { emoji: "🧠", key: "fomo" },
  { emoji: "🏦", key: "etfsVsStocks" },
  { emoji: "💡", key: "buyBusinesses" },
  { emoji: "📉", key: "dropsNormal" },
  { emoji: "🌍", key: "concentrationRisk" },
];

function getDailyLessons(t: TFunction) {
  return DAILY_LESSON_KEYS.map(({ emoji, key }) => ({
    emoji,
    title: t(`home.lessons.${key}.title`),
    body: t(`home.lessons.${key}.body`),
    tip: t(`home.lessons.${key}.tip`),
  }));
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { isAuthenticated, authRestoring } = useAuthStore();
  const { profile, setProfile } = useProfileStore();
  const { positions, portfolioCurrency } = usePortfolioStore();
  const fxRate = useFxRate(portfolioCurrency);
  const streak = useLearnStore((s) => s.streak);
  const completedToday = useLearnStore((s) => s.completedToday);
  const { tier: subTier, isTrialPremium: subTrialPremium } = useSubscriptionStore();
  const isPremium = subTier === "premium" || subTrialPremium;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showScreenPicker, setShowScreenPicker] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [prices, setPrices]       = useState<Record<string, any>>({});
  const [indices, setIndices]     = useState<any[]>([]);
  const [news, setNews]           = useState<any[]>([]);
  const [unread,     setUnread]    = useState(0);
  const [totalNotifs, setTotalNotifs] = useState(0);
  const [topNotifs,  setTopNotifs] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [ytdGain, setYtdGain]     = useState<number | null>(null);
  const [ytdPct,  setYtdPct]      = useState<number | null>(null);
  const [shortGain, setShortGain] = useState<number | null>(null);
  const [shortPct,  setShortPct]  = useState<number | null>(null);
  const [watchlistCount, setWatchlistCount] = useState(0);
  const marketOpen = useMemo(() => isNYSEOpen(), []);
  const hasChatted = useChatStore((s) => s.sessions.some((sess) => sess.messages.length > 0));

  // Goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalDraft,     setGoalDraft]     = useState("");
  const [goalAmtDraft,  setGoalAmtDraft]  = useState("");
  const [savingGoal,    setSavingGoal]    = useState(false);
  const [goalError,     setGoalError]     = useState("");

  // ── Broker call (checklist item only) ───────────────────────────────────
  const BROKER_CALENDLY_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai";
  const handleBrokerCheckout = async () => {
    try {
      const res: any = await billing.brokerCallCheckout();
      const url = res?.data?.url ?? res?.url;
      if (url) window.location.href = url;
    } catch { /* silently fail */ }
  };

  // Shared entry point for the "book the broker call" checklist item: free
  // during the 24h window (straight to Calendly, no Stripe involved), $20
  // checkout after. Treat "not loaded yet" as still-free — a slow network
  // read should never accidentally charge someone who was actually still
  // inside the window.
  const handleBookBrokerCall = async () => {
    const stillFree = freeWindowMsLeft === null || freeWindowMsLeft > 0;
    if (stillFree) {
      window.open(BROKER_CALENDLY_URL, "_blank");
      return;
    }
    await handleBrokerCheckout();
  };

  // Free-call window: 24h from broker_offer_seen_at (server-anchored so it's
  // consistent across devices). Starts ticking on mount.
  const [freeWindowMsLeft, setFreeWindowMsLeft] = useState<number | null>(null);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;
    const DURATION = 24 * 60 * 60 * 1000;
    const startTick = (seenAtIso: string) => {
      const seenMs = new Date(seenAtIso).getTime();
      const tick = () => { const r = DURATION - (Date.now() - seenMs); setFreeWindowMsLeft(r > 0 ? r : 0); };
      tick();
      intervalId = setInterval(tick, 1000);
    };
    billing.brokerOfferSeen()
      .then((res: any) => { startTick(res.data.broker_offer_seen_at); })
      .catch(() => {
        // Fallback to localStorage if backend unreachable
        const KEY = "nuvos_broker_upsell_seen_at";
        let seenAt = localStorage.getItem(KEY);
        if (!seenAt) { seenAt = new Date().toISOString(); localStorage.setItem(KEY, seenAt); }
        startTick(seenAt);
      });
    return () => clearInterval(intervalId);
  }, []);

  const fmtCountdown = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  };

  const sym = CURRENCY_SYM[portfolioCurrency] ?? "$";
  const DAILY_LESSONS = useMemo(() => getDailyLessons(t), [t]);
  const dailyLesson = DAILY_LESSONS[new Date().getDay() % DAILY_LESSONS.length];

  useEffect(() => {
    if (!authRestoring && !isAuthenticated && !localStorage.getItem("nuvos_guest")) { router.push("/"); return; }
  }, [isAuthenticated, authRestoring]);

  useEffect(() => {
    if (!isAuthenticated) return;
    registerWebPush().catch(() => {});
  }, [isAuthenticated]);

  // Redirect to the user's preferred start screen — but only once per
  // session, right after landing here from login. Without the sessionStorage
  // guard this fired on every single mount of /home, including a deliberate
  // click on the Home nav item itself — making Home permanently unreachable
  // for anyone who picked a different preferred screen (it would instantly
  // bounce them right back out every time).
  useEffect(() => {
    const REDIRECT_DONE_KEY = "nuvos_start_screen_redirected";
    if (sessionStorage.getItem(REDIRECT_DONE_KEY)) return;
    sessionStorage.setItem(REDIRECT_DONE_KEY, "1");
    const saved = localStorage.getItem(HOME_SCREEN_KEY);
    if (!saved || saved === "home") return;
    const routes: Record<string, string> = {
      portfolio: "/portfolio", patrimonio: "/patrimonio",
      chat: "/chat", learn: "/learn", notifications: "/notifications",
    };
    const href = routes[saved];
    if (href) router.replace(href);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const tickers = positions.map((p) => p.ticker);
      const [priceRes, idxRes, notifRes] = await Promise.allSettled([
        tickers.length ? marketApi.getPrices(tickers) : Promise.resolve({ data: {} }),
        marketApi.getIndices(),
        notifApi.getAll(),
      ]);
      if (priceRes.status === "fulfilled")  setPrices(priceRes.value.data ?? {});
      if (idxRes.status  === "fulfilled") { setIndices(idxRes.value.data ?? []); setLastRefresh(new Date()); }
      if (notifRes.status === "fulfilled") {
        const d = notifRes.value.data;
        setUnread(d?.unread_count ?? 0);
        const items: any[] = d?.notifications ?? d?.items ?? [];
        setTotalNotifs(items.length);
        setTopNotifs(items.slice(0, 2));
      }

      const wlRes = await watchlistApi.get().catch(() => null);
      setWatchlistCount((wlRes?.data as any[])?.length ?? 0);

      if (tickers.length) {
        const newsRes = await marketApi.getNews(tickers.slice(0, 6)).catch(() => null);
        if (newsRes) setNews((newsRes.data?.articles ?? newsRes.data?.news ?? []).slice(0, 6));

        // Must match Portfolio page's posPayload exactly (including purchase_date) —
        // the backend uses purchase_date to adjust the base for mid-period buys, so
        // omitting it here would make the same endpoint return a different number.
        const posPayload = positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice, purchase_date: p.purchaseDate ?? null }));
        if (isPremium) {
          marketApi.getPortfolioChart(posPayload, "ytd").then((res) => {
            if (res?.data) { setYtdGain(res.data.period_amount ?? null); setYtdPct(res.data.period_pct ?? null); }
          }).catch(() => {});
        } else {
          marketApi.getPortfolioChart(posPayload, "5d").then((res) => {
            if (res?.data) { setYtdGain(res.data.period_amount ?? null); setYtdPct(res.data.period_pct ?? null); }
          }).catch(() => {});
          marketApi.getPortfolioChart(posPayload, "1mo").then((res) => {
            if (res?.data) { setShortGain(res.data.period_amount ?? null); setShortPct(res.data.period_pct ?? null); }
          }).catch(() => {});
        }
      }
    } catch {}
    setLoading(false);
  }, [positions]);

  useEffect(() => {
    loadData();
    syncApi.getAll().then((res) => {
      const serverScore: number = res.data?.maturity?.score ?? 0;
      const serverHistory = res.data?.maturity?.history ?? [];
      const { maturityScore: localScore, maturityHistory: localHistory } = useProfileStore.getState();
      if (serverScore > localScore) {
        useProfileStore.setState({ maturityScore: serverScore, maturityHistory: serverHistory });
      } else if (localScore > serverScore) {
        syncApi.pushMaturity(localScore, localHistory).catch(() => {});
      }
    }).catch(() => {});
  }, [loadData]);

  const openGoalModal = () => {
    setGoalDraft(profile?.investment_goal ?? "");
    setGoalAmtDraft(profile?.investment_goal_amount ?? "");
    setShowGoalModal(true);
  };

  const saveGoal = async () => {
    if (!goalDraft) return;
    setSavingGoal(true);
    setGoalError("");
    try {
      await profileApi.update({
        investment_goal: goalDraft,
        investment_goal_amount: goalAmtDraft || null,
      });
      const fresh = await profileApi.get();
      setProfile(fresh.data);
      setShowGoalModal(false);
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? err?.message ?? t("home.saveError");
      setGoalError(msg);
      console.error("saveGoal error:", err?.response ?? err);
    }
    setSavingGoal(false);
  };

  // Refresh prices + indices every 30s (no news/notifs to avoid hammering API)
  useEffect(() => {
    const tick = () => {
      const tickers = positions.map((p) => p.ticker);
      if (tickers.length) {
        marketApi.getPrices(tickers)
          .then((res) => { if (res?.data) setPrices(res.data ?? {}); })
          .catch(() => {});
      }
      marketApi.getIndices()
        .then((res) => { if (res?.data) { setIndices(res.data ?? []); setLastRefresh(new Date()); } })
        .catch(() => {});
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [positions]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed portfolio totals ───────────────────────────────────────────────
  const { total, dayGain, dayGainPct, totalGain, totalGainPct } = useMemo(() => {
    if (!positions.length) return { total: 0, dayGain: 0, dayGainPct: 0, totalGain: 0, totalGainPct: 0 };
    let total = 0, dayGain = 0, costBasis = 0;
    for (const p of positions) {
      const px   = prices[p.ticker];
      const curr = px?.price ?? p.avgPrice;
      const cp   = px?.change_pct ?? 0;
      const prev = cp !== -100 ? curr / (1 + cp / 100) : curr;
      total     += curr * p.shares;
      dayGain   += (curr - prev) * p.shares;
      costBasis += p.avgPrice * p.shares;
    }
    const dayGainPct   = total > 0 ? (dayGain / (total - dayGain)) * 100 : 0;
    const totalGain    = total - costBasis;
    const totalGainPct = costBasis > 0 ? (totalGain / costBasis) * 100 : 0;
    return { total: total * fxRate, dayGain: dayGain * fxRate, dayGainPct, totalGain: totalGain * fxRate, totalGainPct };
  }, [positions, prices, fxRate]);

  // ── Top gainers today (sorted by % change desc, top 4) ────────────────────
  const movers = useMemo(() => {
    return [...positions]
      .map((p) => {
        const px   = prices[p.ticker];
        const curr = px?.price ?? p.avgPrice;
        const cp   = px?.change_pct ?? 0;
        const prev = cp !== -100 ? curr / (1 + cp / 100) : curr;
        const chg  = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        return { ...p, curr: curr * fxRate, chg };
      })
      .filter((m) => m.chg > 0)
      .sort((a, b) => b.chg - a.chg)
      .slice(0, 4);
  }, [positions, prices, fxRate]);

  // ── Top losers today (sorted by % change asc, top 4, only negative) ────────
  const losers = useMemo(() => {
    return [...positions]
      .map((p) => {
        const px   = prices[p.ticker];
        const curr = px?.price ?? p.avgPrice;
        const cp   = px?.change_pct ?? 0;
        const prev = cp !== -100 ? curr / (1 + cp / 100) : curr;
        const chg  = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
        return { ...p, curr: curr * fxRate, chg };
      })
      .filter((m) => m.chg < 0)
      .sort((a, b) => a.chg - b.chg)
      .slice(0, 4);
  }, [positions, prices, fxRate]);

  // ── Goal ───────────────────────────────────────────────────────────────────
  const GOAL_MAP: Record<string, { label: string; emoji: string }> = {
    house:             { label: t("common.goalMap.house"),             emoji: "🏠" },
    car:               { label: t("common.goalMap.car"),               emoji: "🚗" },
    passive_income:    { label: t("common.goalMap.passiveIncome"),     emoji: "💸" },
    retirement:        { label: t("common.goalMap.retirement"),        emoji: "👴" },
    financial_freedom: { label: t("common.goalMap.financialFreedom"),  emoji: "🦅" },
    long_term_wealth:  { label: t("common.goalMap.longTermWealth"),    emoji: "🏛️" },
  };
  const goalKey    = profile?.investment_goal ?? null;
  const goalInfo   = goalKey ? (GOAL_MAP[goalKey] ?? { label: goalKey, emoji: "🎯" }) : null;
  const goalAmount = parseFloat(profile?.investment_goal_amount ?? "0") || 0;
  const goalPct    = goalAmount > 0 ? Math.min(100, (total / goalAmount) * 100) : 0;

  const firstName = profile?.name?.split(" ")[0] ?? t("home.defaultName");
  const userLevel = getUserLevel(profile);
  const isGuest = typeof window !== "undefined" && localStorage.getItem("nuvos_guest") === "1";
  // "Tu camino para empezar" only makes sense for guests exploring the app, or for
  // beginner/intermediate users who haven't imported a real portfolio yet — once an
  // account has actual positions, this onboarding pitch is no longer relevant to them.
  const isBeginnerMode = isGuest || !isAuthenticated || ((userLevel === "basico" || userLevel === "intermedio") && positions.length === 0);

  const [beginnerCardDismissed, setBeginnerCardDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("nuvos_beginner_card_dismissed") === "1"
  );
  const dismissBeginnerCard = () => {
    localStorage.setItem("nuvos_beginner_card_dismissed", "1");
    setBeginnerCardDismissed(true);
  };
  const reopenBeginnerCard = () => {
    localStorage.removeItem("nuvos_beginner_card_dismissed");
    setBeginnerCardDismissed(false);
  };

  // ── Onboarding checklist ─────────────────────────────────────────────────
  const [checklistPermanentlyDone, setChecklistPermanentlyDone] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("nuvos_checklist_done") === "1"
  );
  // Restore checklist_done from server so Safari localStorage clears don't resurface the checklist
  useEffect(() => {
    if (!isAuthenticated || checklistPermanentlyDone) return;
    import("@/lib/api").then(({ sync }) =>
      sync.getAll().then((res) => {
        if (res.data?.checklist_done) {
          localStorage.setItem("nuvos_checklist_done", "1");
          setChecklistPermanentlyDone(true);
        }
      }).catch(() => {})
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const markBrokerConfigured = async () => {
    if (profile?.has_broker) return;
    try {
      await profileApi.update({ has_broker: true });
      const fresh = await profileApi.get();
      setProfile(fresh.data);
    } catch {}
  };

  const onboardingSteps: OnboardingStep[] = [
    { emoji: "💼", title: t("home.onboarding.addFirstPosition.title"),  description: t("home.onboarding.addFirstPosition.desc"), completed: positions.length > 0 },
    { emoji: "🎯", title: t("home.onboarding.configureGoal.title"),     description: t("home.onboarding.configureGoal.desc"),    completed: !!profile?.investment_goal },
    { emoji: "🤖", title: t("home.onboarding.talkToNuvos.title"),       description: t("home.onboarding.talkToNuvos.desc"),      completed: hasChatted },
    { emoji: "📚", title: t("home.onboarding.firstLesson.title"),       description: t("home.onboarding.firstLesson.desc"),      completed: streak > 0 },
    { emoji: "👀", title: t("home.onboarding.addToWatchlist.title"),    description: t("home.onboarding.addToWatchlist.desc"),   completed: watchlistCount > 0 },
    {
      emoji: "📞",
      title: t("home.onboarding.bookCall.title"),
      description:
        freeWindowMsLeft === null || freeWindowMsLeft > 0
          ? t("home.onboarding.bookCall.descFree", { time: freeWindowMsLeft !== null ? fmtCountdown(freeWindowMsLeft) : "24:00:00" })
          : t("home.onboarding.bookCall.descExpired"),
      completed: !!profile?.has_broker,
      secondaryAction: { label: t("home.onboarding.bookCall.alreadyHaveBroker"), onClick: markBrokerConfigured },
    },
  ];
  const allOnboardingDone = checklistPermanentlyDone || onboardingSteps.every((s) => s.completed);

  // Once onboarding is complete: persist the flag so it never shows again,
  // and prompt the user to pick their preferred start screen.
  useEffect(() => {
    if (loading || !allOnboardingDone) return;
    localStorage.setItem("nuvos_checklist_done", "1");
    import("@/lib/api").then(({ sync }) => sync.pushChecklistDone().catch(() => {}));
    const saved = localStorage.getItem(HOME_SCREEN_KEY);
    if (!saved) setShowScreenPicker(true);
    // Show pricing modal once after checklist completion (free users only)
    if (!isPremium && !localStorage.getItem("nuvos_pricing_shown")) {
      localStorage.setItem("nuvos_pricing_shown", "1");
      setTimeout(() => setShowPricing(true), 1200);
    }
  }, [loading, allOnboardingDone]);

  const handleOnboardingStep = (index: number) => {
    if (index === 1) { openGoalModal(); return; }
    if (index === 5) {
      handleBookBrokerCall();
      return;
    }
    const hrefs = ["/portfolio?tour=1", null, "/chat?tour=3", "/academy?tour=4", "/watchlist?tour=5"];
    const href = hrefs[index];
    if (href) router.push(href);
  };

  const GOAL_OPTIONS = [
    { key: "house",             label: t("home.goalOptions.house"),             emoji: "🏠" },
    { key: "car",               label: t("home.goalOptions.car"),               emoji: "🚗" },
    { key: "passive_income",    label: t("home.goalOptions.passiveIncome"),     emoji: "💸" },
    { key: "retirement",        label: t("home.goalOptions.retirement"),        emoji: "👴" },
    { key: "financial_freedom", label: t("home.goalOptions.financialFreedom"),  emoji: "🦅" },
    { key: "long_term_wealth",  label: t("home.goalOptions.longTermWealth"),    emoji: "🏛️" },
  ];

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg)" }}>
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onOpen={() => setSidebarOpen(true)} />

      {/* ── Goal Modal ── */}
      {showGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
             style={{ background: "rgba(0,0,0,0.55)" }}
             onClick={() => setShowGoalModal(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl"
               style={{ background: "var(--card)", border: "1px solid var(--border)" }}
               onClick={e => e.stopPropagation()}>

            <h3 className="text-base font-black mb-1" style={{ color: "var(--text)" }}>
              🎯 {t("home.goalModal.title")}
            </h3>
            <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
              {t("home.goalModal.subtitle")}
            </p>

            {/* Goal options grid */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              {GOAL_OPTIONS.map(g => (
                <button key={g.key}
                        onClick={() => setGoalDraft(g.key)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left transition-all"
                        style={{
                          background: goalDraft === g.key ? "rgba(0,212,126,0.10)" : "var(--raised)",
                          borderColor: goalDraft === g.key ? "rgba(0,212,126,0.50)" : "var(--border)",
                        }}>
                  <span className="text-lg leading-none shrink-0">{g.emoji}</span>
                  <span className="text-[11px] font-semibold leading-tight" style={{ color: goalDraft === g.key ? "var(--accent)" : "var(--sub)" }}>
                    {g.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="mb-5">
              <label className="text-[10px] font-bold uppercase tracking-wider mb-1.5 block" style={{ color: "var(--muted)" }}>
                {t("home.goalModal.targetAmount")}
              </label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border"
                   style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                <span className="font-bold text-sm" style={{ color: "var(--dim)" }}>$</span>
                <input
                  type="number"
                  placeholder="100,000"
                  value={goalAmtDraft}
                  onChange={e => setGoalAmtDraft(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-semibold outline-none"
                  style={{ color: "var(--text)" }}
                />
                <span className="text-[10px]" style={{ color: "var(--dim)" }}>USD</span>
              </div>
            </div>

            {/* Error */}
            {goalError && (
              <p className="text-xs text-red-400 text-center -mt-1">{goalError}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button onClick={() => setShowGoalModal(false)}
                      className="flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all"
                      style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                {t("common.cancel")}
              </button>
              <button onClick={saveGoal} disabled={!goalDraft || savingGoal}
                      className="flex-1 py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-40"
                      style={{ background: "var(--accent)", color: "#000" }}>
                {savingGoal ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <MarketTickerBar />

        <main className="flex-1 overflow-y-auto">
          {/* ── Sticky Header ──────────────────────────────────────────────── */}
          <div className="sticky top-0 z-10 px-6 py-4 flex items-center justify-between border-b"
               style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            {/* pl-9 clears AppSidebar's floating mobile menu button (fixed
                top-1.5 left-1.5, ~34px wide) on mobile widths. */}
            <div className="pl-9 lg:pl-0">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                {t("home.todaySummary")}
              </p>
              <h1 className="text-2xl font-black tracking-tight" style={{ color: "var(--text)" }}>
                {greeting(t)}, {firstName} 👋
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border"
                   style={{
                     borderColor: marketOpen ? "rgba(34,197,94,0.3)" : "var(--border)",
                     color: marketOpen ? "#22c55e" : "var(--dim)",
                     background: marketOpen ? "rgba(34,197,94,0.06)" : "transparent",
                   }}>
                <span className="w-1.5 h-1.5 rounded-full"
                      style={{ background: marketOpen ? "#22c55e" : "var(--dim)" }} />
                {marketOpen ? t("home.marketOpen") : t("home.marketClosed")}
              </div>
              {isBeginnerMode && beginnerCardDismissed && (
                <button onClick={reopenBeginnerCard}
                        title={t("home.showGuideTooltip")}
                        className="relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                        style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                  <GraduationCap className="w-4 h-4" style={{ color: "var(--sub)" }} />
                </button>
              )}
              <button onClick={() => router.push("/notifications")}
                      className="relative w-9 h-9 flex items-center justify-center rounded-xl border transition-colors hover:border-[var(--accent)]"
                      style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                <Bell className="w-4 h-4" style={{ color: "var(--sub)" }} />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-black text-white flex items-center justify-center"
                        style={{ background: "#ef4444" }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            </div>
          </div>

          <div className="px-6 py-5 space-y-5 max-w-5xl mx-auto">

            <PersonalizedMessageBanner />

            {/* ── Onboarding checklist (hidden once all done) ──────────────── */}
            {!allOnboardingDone && (
              <OnboardingChecklist steps={onboardingSteps} onStepClick={handleOnboardingStep} />
            )}

            {/* ── Guía para principiantes / modo guest ─────────────────── */}
            {isBeginnerMode && !beginnerCardDismissed && (
              <div className="rounded-2xl border overflow-hidden relative"
                   style={{ borderColor: "rgba(0,212,126,0.25)", background: "var(--card)" }}>
                <div className="h-1" style={{ background: "linear-gradient(90deg,#00d47e,#00a8ff)" }} />
                <button onClick={dismissBeginnerCard}
                        aria-label={t("common.close")}
                        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
                <div className="p-5">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1"
                     style={{ color: "var(--accent-l)" }}>{t("home.beginnerCard.eyebrow")}</p>
                  <h3 className="text-base font-black mb-1 pr-8" style={{ color: "var(--text)" }}>
                    {t("home.beginnerCard.title")}
                  </h3>
                  <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                    {t("home.beginnerCard.subtitle")}
                  </p>

                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {([
                      { icon: "📚", title: t("home.beginnerCard.step1Title"), desc: t("home.beginnerCard.step1Desc"), href: "/learn" },
                      { icon: "🎮", title: t("home.beginnerCard.step2Title"), desc: t("home.beginnerCard.step2Desc"), href: "/paper" },
                      { icon: "🚀", title: t("home.beginnerCard.step3Title"), desc: t("home.beginnerCard.step3Desc"), href: "/screener" },
                    ] as const).map((s) => (
                      <button key={s.href} onClick={() => router.push(s.href)}
                              className="flex flex-col items-start p-3 rounded-xl border transition-all hover:opacity-80 text-left"
                              style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
                        <span className="text-xl mb-1.5">{s.icon}</span>
                        <p className="text-[11px] font-black mb-0.5" style={{ color: "var(--text)" }}>{s.title}</p>
                        <p className="text-[10px] leading-tight" style={{ color: "var(--muted)" }}>{s.desc}</p>
                      </button>
                    ))}
                  </div>

                  <button onClick={() => router.push("/chat")}
                          className="w-full py-2.5 rounded-xl text-sm font-black transition-all hover:opacity-90"
                          style={{ background: "var(--accent)", color: "#000" }}>
                    {t("home.beginnerCard.askMentor")}
                  </button>

                  {isGuest && (
                    <button onClick={() => router.push("/")}
                            className="w-full py-2 mt-2 text-xs font-semibold transition-all hover:opacity-70"
                            style={{ color: "var(--muted)" }}>
                      {t("home.beginnerCard.createFreeAccount")}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Stat Strip ──────────────────────────────────────────────── */}
            {/* grid-cols-4/5 with no breakpoint forced 5 equal columns at any
                width — on a phone each card got squeezed to ~60px and the
                last one was clipped by the page's overflow boundary with no
                way to scroll to it. Wrap to 2 columns below lg (unchanged
                desktop layout preserved at lg:+). */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 lg:grid-cols-4">
              {/* Portfolio day */}
              <button onClick={() => router.push("/patrimonio")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                {dayGain >= 0
                  ? <TrendingUp className="w-5 h-5 shrink-0" style={{ color: "#22c55e" }} />
                  : <TrendingDown className="w-5 h-5 shrink-0" style={{ color: "#ef4444" }} />
                }
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: dayGain >= 0 ? "#22c55e" : "#ef4444" }}>
                    {loading ? "—" : fmtPct(dayGainPct)}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{t("home.stats.portfolioToday")}</p>
                </div>
              </button>

              {/* Racha */}
              <button onClick={() => router.push("/learn")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <span className="text-xl shrink-0">{streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}</span>
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: streak > 0 ? "#f59e0b" : "var(--text)" }}>
                    {t("home.streakCard.days", { count: streak })}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{t("home.stats.streak")}</p>
                </div>
              </button>

              {/* Meta */}
              <button onClick={openGoalModal}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: goalInfo ? "rgba(0,212,126,0.25)" : "var(--border)" }}>
                {goalInfo
                  ? <span className="text-xl shrink-0 leading-none">{goalInfo.emoji}</span>
                  : <Target className="w-5 h-5 shrink-0" style={{ color: "var(--accent-l)" }} />}
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none truncate" style={{ color: "var(--text)" }}>
                    {goalInfo ? goalInfo.label : t("home.stats.noGoal")}
                  </p>
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--accent-l)" }}>
                    {goalAmount > 0
                      ? `$${goalAmount.toLocaleString("en-US")} USD`
                      : goalInfo ? t("home.stats.activeGoal") : t("home.stats.goal")}
                  </p>
                </div>
              </button>

              {/* Alertas */}
              <button onClick={() => router.push("/notifications")}
                      className="flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <Bell className="w-5 h-5 shrink-0"
                      style={{ color: unread > 0 ? "#ef4444" : "var(--sub)" }} />
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: unread > 0 ? "#ef4444" : "var(--text)" }}>
                    {unread > 0 ? t("home.stats.newAlerts", { count: unread }) : totalNotifs > 0 ? t("home.stats.alertsCount", { count: totalNotifs }) : t("home.stats.noAlerts")}
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{t("home.stats.notifications")}</p>
                </div>
              </button>
            </div>

            {/* ── Main grid: Portfolio hero + Key stats ───────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Portfolio hero (2/3) */}
              <button onClick={() => router.push("/patrimonio")}
                      className="lg:col-span-2 text-left rounded-2xl p-5 border transition-all hover:border-[var(--accent)] group relative overflow-hidden"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>

                {/* Top row: label + amount LEFT, avatar RIGHT */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5" style={{ color: "var(--muted)" }}>
                      {t("home.portfolioHero.myPortfolio")}
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md"
                            style={{ background: "var(--raised)", color: "var(--sub)" }}>
                        {portfolioCurrency}
                      </span>
                    </p>
                    {loading ? (
                      <div className="h-10 w-44 rounded-lg animate-pulse" style={{ background: "var(--raised)" }} />
                    ) : (
                      <p className="text-4xl font-black tracking-tight leading-none" style={{ color: "var(--text)" }}>
                        {fmt(total, portfolioCurrency)}
                      </p>
                    )}
                  </div>

                  {/* Profile avatar */}
                  <div className="shrink-0 w-20 h-20 rounded-full overflow-hidden border-2"
                       style={{ borderColor: "var(--border)" }}>
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} className="w-full h-full object-cover" alt="avatar" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl font-black"
                           style={{ background: "var(--accent)22", color: "var(--accent-l)" }}>
                        {profile?.name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats row — full width, vertical-line dividers, no boxes */}
                {!loading && positions.length > 0 && (
                  <div className="flex items-stretch mt-4 pt-4 border-t"
                       style={{ borderColor: "var(--border)" }}>
                    {/* Hoy */}
                    <div className="flex-1 pr-4">
                      <p className="text-[11px] font-medium mb-1" style={{ color: "var(--muted)" }}>{t("home.portfolioHero.today")}</p>
                      <p className="text-xl font-black tracking-tight leading-none" style={{ color: dayGain >= 0 ? "#22c55e" : "#ef4444" }}>
                        {fmtPct(dayGainPct)}
                        <span className="text-sm font-semibold ml-1">
                          ({dayGain >= 0 ? "+" : ""}{fmt(dayGain, portfolioCurrency)})
                        </span>
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: "var(--sub)" }}>
                        {t("home.portfolioHero.todayReturn")}
                      </p>
                    </div>
                    {/* Divider */}
                    <div className="w-px self-stretch" style={{ background: "var(--border)" }} />
                    {/* YTD (premium) / 5D (free) */}
                    <div className="flex-1 px-4">
                      <p className="text-[11px] font-medium mb-1" style={{ color: "var(--muted)" }}>{isPremium ? "YTD" : "5D"}</p>
                      {ytdGain !== null ? (
                        <>
                          <p className="text-xl font-black tracking-tight leading-none" style={{ color: (ytdPct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                            {fmtPct(ytdPct ?? 0)}
                            <span className="text-sm font-semibold ml-1">
                              ({ytdGain >= 0 ? "+" : ""}{fmt(ytdGain * fxRate, portfolioCurrency)})
                            </span>
                          </p>
                          <p className="text-[11px] mt-1" style={{ color: "var(--sub)" }}>
                            {isPremium ? t("home.portfolioHero.ytd") : t("home.portfolioHero.last5Days")}
                          </p>
                        </>
                      ) : (
                        <p className="text-xl font-black" style={{ color: "var(--muted)" }}>—</p>
                      )}
                    </div>
                    {/* Divider */}
                    <div className="w-px self-stretch" style={{ background: "var(--border)" }} />
                    {/* Total (premium) / 1M (free) */}
                    <div className="flex-1 pl-4">
                      <p className="text-[11px] font-medium mb-1" style={{ color: "var(--muted)" }}>{isPremium ? "Total" : "1M"}</p>
                      {isPremium ? (
                        <>
                          <p className="text-xl font-black tracking-tight leading-none" style={{ color: totalGain >= 0 ? "#22c55e" : "#ef4444" }}>
                            {fmtPct(totalGainPct)}
                            <span className="text-sm font-semibold ml-1">
                              ({totalGain >= 0 ? "+" : ""}{fmt(totalGain, portfolioCurrency)})
                            </span>
                          </p>
                          <p className="text-[11px] mt-1" style={{ color: "var(--sub)" }}>{t("home.portfolioHero.total")}</p>
                        </>
                      ) : shortGain !== null ? (
                        <>
                          <p className="text-xl font-black tracking-tight leading-none" style={{ color: (shortPct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                            {fmtPct(shortPct ?? 0)}
                          </p>
                          <p className="text-[11px] mt-1" style={{ color: "var(--sub)" }}>
                            {t("home.portfolioHero.lastMonth", { amount: `${shortGain >= 0 ? "+" : ""}${fmt(shortGain * fxRate, portfolioCurrency)}` })}
                          </p>
                        </>
                      ) : (
                        <p className="text-xl font-black" style={{ color: "var(--muted)" }}>—</p>
                      )}
                    </div>
                  </div>
                )}

                {!loading && !positions.length && (
                  <div className="mt-4 pt-4 border-t border-dashed" style={{ borderColor: "var(--border)" }}>
                    <p className="text-sm font-black mb-1" style={{ color: "var(--text)" }}>{t("home.portfolioHero.addFirstStock")}</p>
                    <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--muted)" }}>
                      {t("home.portfolioHero.addFirstStockDesc")}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {["AAPL", "NVDA", "MSFT", "TSLA", "GOOGL"].map((ticker) => (
                        <button key={ticker} onClick={() => router.push("/portfolio")}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors hover:border-[var(--accent)]"
                                style={{ borderColor: "var(--border)", color: "var(--accent-l)", background: "var(--raised)" }}>
                          {ticker}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => router.push("/portfolio")}
                            className="w-full py-2 rounded-xl text-xs font-bold transition-colors"
                            style={{ background: "var(--accent)", color: "#fff" }}>
                      {t("home.portfolioHero.addPosition")}
                    </button>
                  </div>
                )}

                <ChevronRight className="absolute right-4 top-5 w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity"
                              style={{ color: "var(--dim)" }} />
              </button>

              {/* Right column: 3 key stat cards */}
              <div className="flex flex-col gap-3">

                {/* 🎯 Meta */}
                <button onClick={openGoalModal}
                        className="flex-1 flex items-center gap-3 px-4 py-4 rounded-xl border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: goalInfo ? "rgba(0,212,126,0.25)" : "var(--border)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                       style={{ background: goalInfo ? "rgba(0,212,126,0.12)" : "var(--raised)" }}>
                    {goalInfo
                      ? <span className="text-xl leading-none">{goalInfo.emoji}</span>
                      : <Target className="w-5 h-5" style={{ color: "var(--accent-l)" }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>{t("home.goalCard.myGoal")}</p>
                    <p className="text-sm font-black truncate" style={{ color: "var(--text)" }}>
                      {goalInfo ? goalInfo.label : t("home.goalCard.configureGoal")}
                    </p>
                    {goalAmount > 0 && (
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--accent-l)" }}>
                        ${goalAmount.toLocaleString("en-US")} USD
                      </p>
                    )}
                    {goalPct > 0 && (
                      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--raised)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${goalPct}%`, background: "var(--accent)" }} />
                      </div>
                    )}
                    {goalPct > 0 && (
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>{t("home.goalCard.completedPct", { pct: goalPct.toFixed(1) })}</p>
                    )}
                  </div>
                </button>

                {/* 🔥 Racha */}
                <button onClick={() => router.push("/learn")}
                        className="flex-1 flex items-center gap-3 px-4 py-4 rounded-xl border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: streak > 0 ? "rgba(245,158,11,0.3)" : "var(--border)" }}>
                  <div className="w-10 h-10 rounded-full border-2 flex items-center justify-center text-xl shrink-0"
                       style={{ borderColor: streak > 0 ? "#f59e0b" : "var(--border)" }}>
                    {streak >= 7 ? "🔥" : streak >= 3 ? "⚡" : "✨"}
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5" style={{ color: "var(--muted)" }}>{t("home.stats.streak")}</p>
                    <p className="text-xl font-black leading-none" style={{ color: streak > 0 ? "#f59e0b" : "var(--text)" }}>
                      {t("home.streakCard.days", { count: streak })}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                      {streak === 0 ? t("home.streakCard.startToday") : t("home.streakCard.consecutive")}
                    </p>
                  </div>
                </button>

                {/* 📚 Lección del día */}
                <button onClick={() => router.push("/learn")}
                        className="flex-1 flex items-center gap-3 px-4 py-4 rounded-xl border transition-all hover:border-[var(--accent)] text-left"
                        style={{
                          background: completedToday ? "rgba(34,197,94,0.06)" : "var(--card)",
                          borderColor: completedToday ? "rgba(34,197,94,0.35)" : "var(--border)",
                        }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
                       style={{ background: completedToday ? "rgba(34,197,94,0.14)" : "rgba(124,58,237,0.1)" }}>
                    {completedToday ? "✅" : dailyLesson.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
                       style={{ color: completedToday ? "#22c55e" : "var(--muted)" }}>
                      {completedToday ? t("home.lessonCard.completedToday") : t("home.lessonCard.lessonOfDay")}
                    </p>
                    <p className="text-sm font-black" style={{ color: "var(--text)" }}>{dailyLesson.title}</p>
                    {"body" in dailyLesson && !completedToday && (
                      <p className="text-[10px] mt-1 line-clamp-2 leading-relaxed" style={{ color: "var(--muted)" }}>
                        {(dailyLesson as { body: string }).body}
                      </p>
                    )}
                    {"tip" in dailyLesson && !completedToday && (
                      <p className="text-[10px] mt-1 font-semibold" style={{ color: "var(--accent-l)" }}>
                        💡 {(dailyLesson as { tip: string }).tip}
                      </p>
                    )}
                    {completedToday && (
                      <p className="text-[10px] mt-0.5 font-semibold" style={{ color: "#16a34a" }}>
                        {t("home.lessonCard.viewAnother")}
                      </p>
                    )}
                  </div>
                </button>
              </div>
            </div>

            {/* ── Lo más importante hoy ────────────────────────────────────── */}
            {topNotifs.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                    <Bell className="w-4 h-4" style={{ color: "var(--muted)" }} />
                    {t("home.mostImportantToday")}
                  </h2>
                  <button onClick={() => router.push("/notifications")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewAll")}
                  </button>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {topNotifs.map((n: any, i: number) => (
                    <button key={n.id ?? i}
                            onClick={() => router.push("/notifications")}
                            className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:opacity-80 transition-opacity ${i > 0 ? "border-t" : ""}`}
                            style={{ borderColor: "var(--border)" }}>
                      <span className="text-lg shrink-0 mt-0.5">{notifIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold" style={{ color: "var(--text)" }}>{n.title}</p>
                        {n.body && (
                          <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: "var(--muted)" }}>{n.body}</p>
                        )}
                      </div>
                      {n.created_at && (
                        <p className="text-[10px] shrink-0 mt-0.5" style={{ color: "var(--dim)" }}>
                          {timeAgo(n.created_at, t)}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Market Indices ──────────────────────────────────────────── */}
            <HomeMarketOverview indices={indices} lastRefresh={lastRefresh} />

            {/* ── Quick Actions ────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { icon: BookOpen,       label: t("home.quickActions.askSomething"), sub: t("home.quickActions.aiMentor"),   href: "/chat",       accent: true  },
                { icon: Sparkles,       label: t("home.quickActions.myMoney"),      sub: t("home.quickActions.patrimonio"), href: "/patrimonio", accent: false },
                { icon: GraduationCap,  label: t("home.quickActions.learn"),        sub: t("home.quickActions.academy"),    href: "/learn",       accent: false },
                { icon: Flame,          label: t("home.quickActions.myProfile"),    sub: t("home.quickActions.stats"),      href: "/profile",     accent: false },
              ].map(({ icon: Icon, label, sub, href, accent }) => (
                <button key={href}
                        onClick={() => router.push(href)}
                        className="flex flex-col items-start p-3.5 rounded-xl border transition-all hover:scale-[1.02]"
                        style={{
                          background: accent ? "rgba(0,212,126,0.07)" : "var(--card)",
                          borderColor: accent ? "rgba(0,212,126,0.3)" : "var(--border)",
                        }}>
                  <Icon className="w-5 h-5 mb-2" style={{ color: accent ? "var(--accent-l)" : "var(--sub)" }} />
                  <p className="text-xs font-bold leading-tight" style={{ color: "var(--text)" }}>{label}</p>
                  <p className="text-[10px]" style={{ color: "var(--muted)" }}>{sub}</p>
                </button>
              ))}
            </div>

            {/* ── Top movers ──────────────────────────────────────────────── */}
            {positions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("home.risingToday")}</h2>
                  <button onClick={() => router.push("/patrimonio")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewAll")}
                  </button>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {loading
                    ? [0,1,2].map((i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 animate-pulse"
                             style={{ borderColor: "var(--border)" }}>
                          <div className="w-9 h-9 rounded-xl" style={{ background: "var(--raised)" }} />
                          <div className="flex-1 space-y-1.5">
                            <div className="h-3 w-16 rounded" style={{ background: "var(--raised)" }} />
                            <div className="h-2.5 w-24 rounded" style={{ background: "var(--raised)" }} />
                          </div>
                          <div className="h-5 w-12 rounded" style={{ background: "var(--raised)" }} />
                        </div>
                      ))
                    : movers.length === 0
                    ? (
                        <div className="px-4 py-5 text-center">
                          <p className="text-sm" style={{ color: "var(--muted)" }}>
                            {t("home.noPositionsUp")}
                          </p>
                        </div>
                      )
                    : movers.map((m) => (
                        <div key={m.ticker}
                             className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 cursor-pointer hover:opacity-80 transition-opacity"
                             style={{ borderColor: "var(--border)" }}
                             onClick={() => router.push("/patrimonio")}>
                          <StockAvatar ticker={m.ticker} size="sm" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{m.ticker}</p>
                            <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{(m as any).name ?? m.ticker}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{sym}{m.curr.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                  style={{ background: "rgba(34,197,94,0.12)", color: "#22c55e" }}>
                              +{m.chg.toFixed(2)}%
                            </span>
                          </div>
                        </div>
                      ))
                  }
                </div>
              </div>
            )}

            {/* ── Top losers ───────────────────────────────────────────────── */}
            {losers.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("home.fallingToday")}</h2>
                  <button onClick={() => router.push("/patrimonio")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewAll")}
                  </button>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {losers.map((m) => (
                    <div key={m.ticker}
                         className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 cursor-pointer hover:opacity-80 transition-opacity"
                         style={{ borderColor: "var(--border)" }}
                         onClick={() => router.push("/patrimonio")}>
                      <StockAvatar ticker={m.ticker} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{m.ticker}</p>
                        <p className="text-xs truncate" style={{ color: "var(--muted)" }}>{(m as any).name ?? m.ticker}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{sym}{m.curr.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                              style={{ background: "rgba(239,68,68,0.12)", color: "#ef4444" }}>
                          {m.chg.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Portfolio news ───────────────────────────────────────────── */}
            {news.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                    <Newspaper className="w-4 h-4" style={{ color: "var(--muted)" }} />
                    {t("home.portfolioNews")}
                  </h2>
                  <button onClick={() => router.push("/notifications")}
                          className="text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewMore")}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {news.map((item: any, idx: number) => (
                    <div key={idx} className="rounded-xl border overflow-hidden"
                         style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                      {(item.thumbnail_url || item.thumbnail) ? (
                        <img src={item.thumbnail_url ?? item.thumbnail} alt=""
                             className="w-full h-28 object-cover" />
                      ) : (
                        <div className="w-full h-28 flex items-center justify-center"
                             style={{ background: "var(--raised)" }}>
                          <Newspaper className="w-6 h-6" style={{ color: "var(--dim)" }} />
                        </div>
                      )}
                      <div className="p-3">
                        {item.ticker && (
                          <span className="text-[10px] font-bold" style={{ color: "var(--accent-l)" }}>
                            {item.ticker}
                          </span>
                        )}
                        <p className="text-xs font-semibold leading-snug mt-0.5 line-clamp-3"
                           style={{ color: "var(--text)" }}>
                          {item.title}
                        </p>
                        <p className="text-[10px] mt-1.5 truncate" style={{ color: "var(--muted)" }}>
                          {item.publisher ?? item.source}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── AI Mentor CTA ────────────────────────────────────────────── */}
            <button onClick={() => router.push("/chat")}
                    className="w-full flex items-center gap-4 p-5 rounded-2xl border transition-all hover:opacity-90"
                    style={{ background: "rgba(0,212,126,0.06)", borderColor: "rgba(0,212,126,0.25)" }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                   style={{ background: "rgba(0,212,126,0.15)" }}>
                <Sparkles className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("home.mentorCta.title")}</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {positions.length
                    ? t("home.mentorCta.withPositions", { count: positions.length })
                    : t("home.mentorCta.withoutPositions")}
                </p>
              </div>
              <ChevronRight className="w-5 h-5 shrink-0" style={{ color: "var(--dim)" }} />
            </button>

            <div className="h-6" />
          </div>
        </main>
      </div>
      {showScreenPicker && (
        <HomeScreenPickerModal
          onDone={(href) => {
            setShowScreenPicker(false);
            router.replace(href);
          }}
        />
      )}
      <PricingModal visible={showPricing} onClose={() => setShowPricing(false)} />
    </div>
  );
}
