"use client";

import { useBillingPricing, fmtMxn } from "@/lib/pricing";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  TrendingUp, TrendingDown, Sparkles, BookOpen,
  Bell, ChevronRight, GraduationCap, Newspaper, Target, Flame, X, Eye, EyeOff, Zap,
  Wallet, Banknote, ArrowRight, Gamepad2, Rocket, Flag, Lightbulb, CheckCircle2,
  BarChart3, DollarSign, Briefcase, type LucideIcon,
} from "lucide-react";
import { InsightCallout } from "@/components/ui";
import AppSidebar from "@/components/AppSidebar";
import MarketTickerBar from "@/components/MarketTickerBar";
import HomeMarketOverview from "@/components/HomeMarketOverview";
import StockAvatar from "@/components/StockAvatar";
import MorningBriefCard from "@/components/MorningBriefCard";
import ExplainButton from "@/components/ExplainButton";
import { market as marketApi, notifications as notifApi, profile as profileApi, sync as syncApi, billing, cashHoldings as cashHoldingsApi, dividends as dividendsApi } from "@/lib/api";
import PricingModal from "@/components/PricingModal";
import EmbeddedCheckout, { type CheckoutSummary } from "@/components/EmbeddedCheckout";
import { useAuthStore, useProfileStore, useLearnStore, useSubscriptionStore, useChatStore, useBalanceVisibilityStore, hasPremiumAccess, getNextMilestone } from "@/lib/store";
import OnboardingChecklist, { type OnboardingStep } from "@/components/OnboardingChecklist";
import HomeScreenPickerModal, { HOME_SCREEN_KEY } from "@/components/HomeScreenPickerModal";
import { useCombinedPositions, useCombinedCurrency, useCombinedClosedPositions, useCombinedInceptionDate } from "@/lib/portfolioStore";
import { usePaperStore } from "@/lib/paperStore";
import { useFxRate } from "@/lib/useFxRate";
import { isNYSEOpen, readPriceCache, writePriceCache, needsPriceRefresh } from "@/lib/marketHours";
import { registerWebPush } from "@/lib/webPush";
import { getUserLevel } from "@/lib/userLevel";
import { isDismissedToday, dismissToday, isWeekdayET } from "@/lib/dailyDismiss";
import { fetchWithRetry } from "@/lib/fetchWithRetry";

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

function notifIcon(type: string): LucideIcon {
  if (type === "price_alert") return TrendingUp;
  if (type === "earnings")    return BarChart3;
  if (type === "news")        return Newspaper;
  if (type === "portfolio")   return Briefcase;
  if (type === "dividend")    return DollarSign;
  return Bell;
}

// Small SVG progress ring (streak → next milestone), same as mobile's MiniRing.
function MiniRing({ pct, size = 44, stroke = 4, color, children }: { pct: number; size?: number; stroke?: number; color: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
                strokeDasharray={`${c * Math.max(0, Math.min(1, pct))} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="relative flex items-center justify-center">{children}</div>
    </div>
  );
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
  const { hidden: balanceHidden, toggle: toggleBalanceHidden } = useBalanceVisibilityStore();
  // Combined across every portfolio, not just the active one — the Home
  // hero number previously only reflected whichever portfolio tab happened
  // to be selected (2026-08-21 multi-portfolio audit). portfolioCurrency
  // is only a display choice when every portfolio agrees on one currency;
  // when portfolios use different currencies there's no single correct FX
  // rate to apply to the combined total, so this shows USD instead of
  // silently misconverting part of it (same fix worker.py's
  // job_market_close got on the backend, 2026-08-21).
  const positions = useCombinedPositions();
  const portfolioCurrency = useCombinedCurrency();
  const closedPositions = useCombinedClosedPositions();
  const inceptionDate = useCombinedInceptionDate();
  // Distinct holdings, not purchase lots — buying more of a ticker you
  // already own shouldn't inflate this count.
  const distinctPositionsCount = useMemo(() => new Set(positions.map((p) => p.ticker)).size, [positions]);
  const fxRate = useFxRate(portfolioCurrency);

  // Cash held outside stock positions (CETES, bank, bonds, other) and
  // dividends actually paid (forward-tracking only) both count toward the
  // total shown here, same as on /portfolio.
  const [cashTotalUSD, setCashTotalUSD] = useState(0);
  const [dividendTotalUSD, setDividendTotalUSD] = useState(0);
  const CASH_APPROX_TO_USD: Record<string, number> = { MXN: 18.5, EUR: 0.92, GBP: 0.79, CAD: 1.38, BRL: 5.7, JPY: 155, AUD: 1.55, CHF: 0.89 };
  useEffect(() => {
    // A transient failure here must never silently drop cash/dividends out
    // of the headline total for the rest of the session (Diego, 2026-09-12:
    // "SIEMPRE debe quedarse fijo") — retry a few times with backoff before
    // giving up, same discipline as useSubscriptionStore.fetchStatus.
    fetchWithRetry(() => cashHoldingsApi.list()).then((res) => {
      if (!res) return;
      const holdings = res.data?.holdings ?? [];
      const usd = holdings.reduce((sum: number, c: { amount: number; currency: string; accrued_amount?: number }) => {
        const amt = c.accrued_amount ?? c.amount;
        if (c.currency === "USD") return sum + amt;
        return sum + amt / (CASH_APPROX_TO_USD[c.currency] ?? 1);
      }, 0);
      setCashTotalUSD(usd);
    });
    fetchWithRetry(() => dividendsApi.getIncome()).then((res) => {
      if (res) setDividendTotalUSD(res.data?.total ?? 0);
    });
  }, []);
  const cashTotal = portfolioCurrency === "USD" ? cashTotalUSD : cashTotalUSD * fxRate;
  const dividendTotal = portfolioCurrency === "USD" ? dividendTotalUSD : dividendTotalUSD * fxRate;

  const streak = useLearnStore((s) => s.streak);
  const completedToday = useLearnStore((s) => s.completedToday);
  const { tier: subTier, isTrialPremium: subTrialPremium, hasFetchedStatus: subHasFetchedStatus } = useSubscriptionStore();
  const isPremium = hasPremiumAccess({ tier: subTier, isTrialPremium: subTrialPremium, hasFetchedStatus: subHasFetchedStatus });

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
  // Real "MAX" return from the backend — same field/formula as the Portfolio
  // screen's MAX toggle (POST /api/market/portfolio-returns, returns.max),
  // not the client-side cost-basis approximation below. null while loading.
  const [maxGain, setMaxGain] = useState<number | null>(null);
  const [maxPct,  setMaxPct]  = useState<number | null>(null);
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
  // Diego, 2026-09-15: card entry happens INSIDE a modal (Stripe Elements)
  // instead of redirecting to a Stripe-hosted page.
  const [brokerCheckoutOpen, setBrokerCheckoutOpen] = useState(false);

  // Diego, 2026-09-15: "quiero agregarle este resumen del pedido similar a
  // los productos con sus respectivos productos" — same order-summary card
  // PricingModal's checkout already shows.
  const brokerPricing = useBillingPricing();
  const brokerMxn = brokerPricing.currency === "mxn" && brokerPricing.broker_call != null;
  const brokerPriceText = brokerMxn ? `${fmtMxn(brokerPricing.broker_call!)} MXN` : "$20 USD";
  const brokerCallSummary: CheckoutSummary = {
    planName: t("home.onboarding.bookCall.title"),
    priceLabel: brokerMxn ? fmtMxn(brokerPricing.broker_call!) : "$20",
    priceSuffix: brokerMxn ? " MXN" : " USD",
    dueTodayLabel: brokerPriceText,
    features: [t("home.onboarding.bookCall.sessionFeature")],
    accentColor: "#00d47e",
  };

  const handleBrokerCheckoutSuccess = (paymentIntentId?: string) => {
    setBrokerCheckoutOpen(false);
    router.push(`/upsell-success?offer=broker_call${paymentIntentId ? `&payment_intent=${paymentIntentId}` : ""}`);
  };

  // Shared entry point for the "book the broker call" checklist item: free
  // during the 24h window (straight to Calendly, no Stripe involved), $20
  // checkout after. Treat "not loaded yet" as still-free — a slow network
  // read should never accidentally charge someone who was actually still
  // inside the window.
  const handleBookBrokerCall = () => {
    const stillFree = freeWindowMsLeft === null || freeWindowMsLeft > 0;
    if (stillFree) {
      window.open(BROKER_CALENDLY_URL, "_blank");
      return;
    }
    setBrokerCheckoutOpen(true);
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

  // Landing on /home authenticated but with no profile loaded (a direct
  // navigation/bookmark/restored tab, bypassing the landing page's own
  // profile check) used to just render Home in a permanently
  // half-initialized state — profile-dependent calls 404, no trial, no
  // personalization, and nothing here ever pointed the user back to finish
  // onboarding. This closes that gap regardless of how the user got here.
  useEffect(() => {
    if (authRestoring || !isAuthenticated || profile) return;
    profileApi.get()
      .then((res) => setProfile(res.data))
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) router.replace("/onboarding");
      });
  }, [authRestoring, isAuthenticated, profile]);

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
      // A guest has no session cookie at all, so every one of these except
      // indices would just 401 — indices alone has a real no-auth twin
      // (market data is public info, not user data) so guests still see
      // something real and live instead of an empty "Mercados en vivo"
      // section (Diego: "esa pantalla de Inicio realmente no muestra nada").
      const guest = typeof window !== "undefined" && localStorage.getItem("nuvos_guest") === "1";
      // Diego, 2026-09-27: the portfolio value only moves during market
      // hours — show the last saved prices instantly and only hit the
      // network when the market is open (or the saved close is stale).
      const priceUid = useAuthStore.getState().userId;
      const priceCache = readPriceCache(priceUid);
      if (priceCache) setPrices((prev) => ({ ...priceCache.prices, ...prev }));
      const refreshPrices = tickers.length > 0 && needsPriceRefresh(priceCache, tickers);
      const [priceRes, idxRes, notifRes] = await Promise.allSettled([
        refreshPrices ? marketApi.getPrices(tickers) : Promise.resolve({ data: null }),
        guest ? marketApi.getIndicesPublic() : marketApi.getIndices(),
        guest ? Promise.resolve({ data: {} }) : notifApi.getAll(),
      ]);
      if (priceRes.status === "fulfilled" && priceRes.value.data) {
        setPrices((prev) => ({ ...prev, ...priceRes.value.data }));
        writePriceCache(priceUid, priceRes.value.data);
      }
      if (idxRes.status  === "fulfilled") { setIndices(idxRes.value.data ?? []); setLastRefresh(new Date()); }
      if (notifRes.status === "fulfilled") {
        const d = notifRes.value.data;
        setUnread(d?.unread_count ?? 0);
        const items: any[] = d?.notifications ?? d?.items ?? [];
        setTotalNotifs(items.length);
        setTopNotifs(items.slice(0, 2));
      }

      if (tickers.length) {
        // Diego, 2026-09-23: "máximo 3 segundos" — news isn't gated behind
        // `loading` anywhere in this page (renders on its own `news.length`
        // check below), so awaiting it here before setLoading(false) was
        // pure wasted latency: the whole screen sat on its loading skeleton
        // waiting for an aggregated-articles fetch nothing above the fold
        // actually needed. Fire-and-forget, same as the portfolio-chart
        // calls right below it.
        marketApi.getNews(tickers.slice(0, 6)).then((newsRes) => {
          setNews((newsRes.data?.articles ?? newsRes.data?.news ?? []).slice(0, 6));
        }).catch(() => {});

        // Must match Portfolio page's posPayload exactly (including purchase_date) —
        // the backend uses purchase_date to adjust the base for mid-period buys, so
        // omitting it here would make the same endpoint return a different number.
        const posPayload = positions.map((p) => ({ ticker: p.ticker, shares: p.shares, avg_price: p.avgPrice, purchase_date: p.purchaseDate ?? null }));
        if (isPremium) {
          marketApi.getPortfolioChart(posPayload, "ytd").then((res) => {
            if (res?.data) { setYtdGain(res.data.period_amount ?? null); setYtdPct(res.data.period_pct ?? null); }
          }).catch(() => {});
          // Same call the Portfolio screen's MAX toggle uses (positions +
          // closed positions + inceptionDate) so "Total" here is pixel-identical
          // to what the user sees there, not a separate client-side estimate.
          const closedPosPayload = closedPositions.map((c) => ({
            ticker: c.ticker, shares: c.shares, avg_price: c.avgPrice, close_price: c.closePrice,
            purchase_date: c.purchaseDate ?? null, close_date: c.closeDate ?? null,
          }));
          marketApi.getPortfolioReturns(posPayload, closedPosPayload, inceptionDate).then((res) => {
            const max = res?.data?.returns?.max;
            if (max) { setMaxGain(max.amount ?? null); setMaxPct(max.pct ?? null); }
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
  }, [positions, closedPositions, inceptionDate]);

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
    // Market hours only — outside them the numbers stay fixed (Diego, 2026-09-27).
    const tick = () => {
      const tickers = positions.map((p) => p.ticker);
      const uid = useAuthStore.getState().userId;
      if (tickers.length && needsPriceRefresh(readPriceCache(uid), tickers)) {
        marketApi.getPrices(tickers)
          .then((res) => { if (res?.data) { setPrices((prev) => ({ ...prev, ...res.data })); writePriceCache(uid, res.data); } })
          .catch(() => {});
      }
      if (!isNYSEOpen()) return;
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

  // Positions can hold the same ticker more than once (separate buy lots) —
  // "Top gainers/losers" are about which STOCKS moved, not which lots, so
  // dedupe by ticker first. Without this, a ticker held in two lots renders
  // two rows with the same React key ("Encountered two children with the
  // same key").
  const uniquePositionsByTicker = useMemo(() => {
    const seen = new Set<string>();
    return positions.filter((p) => {
      if (seen.has(p.ticker)) return false;
      seen.add(p.ticker);
      return true;
    });
  }, [positions]);

  // ── Top gainers today (sorted by % change desc, top 4) ────────────────────
  const movers = useMemo(() => {
    return [...uniquePositionsByTicker]
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
  }, [uniquePositionsByTicker, prices, fxRate]);

  // ── Top losers today (sorted by % change asc, top 4, only negative) ────────
  const losers = useMemo(() => {
    return [...uniquePositionsByTicker]
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
  }, [uniquePositionsByTicker, prices, fxRate]);

  // ── "Decide mejor" audit, 2026-09-11 — moved here from Patrimonio at
  // Diego's request: this is the actual homepage, replacing the Monthly
  // Report entry point below. Real, honest insight (which position moved
  // the most $ today, never just biggest %) from data already loaded on
  // this page — no new endpoint, never shown with nothing real to say. ──
  const topMoverInsight = useMemo(() => {
    if (uniquePositionsByTicker.length < 2) return null;
    let best: { ticker: string; dollarImpact: number; pct: number } | null = null;
    for (const p of uniquePositionsByTicker) {
      const px = prices[p.ticker];
      const curr = px?.price ?? p.avgPrice;
      const cp = px?.change_pct ?? 0;
      if (!cp) continue;
      const prev = cp !== -100 ? curr / (1 + cp / 100) : curr;
      const dollarImpact = (curr - prev) * p.shares * fxRate;
      if (!best || Math.abs(dollarImpact) > Math.abs(best.dollarImpact)) {
        best = { ticker: p.ticker, dollarImpact, pct: cp };
      }
    }
    return best;
  }, [uniquePositionsByTicker, prices, fxRate]);

  // Dismissible for the rest of today (Diego, 2026-09-12) — same
  // daily-reset pattern as the Morning Brief flashcard above, own key so
  // the two don't share state. Resets tomorrow since it's a new top mover
  // by then anyway.
  const TOP_MOVER_INSIGHT_DISMISS_KEY = "nuvos_top_mover_insight_dismissed";
  const [topMoverDismissed, setTopMoverDismissed] = useState(false);
  useEffect(() => {
    if (isDismissedToday(TOP_MOVER_INSIGHT_DISMISS_KEY)) setTopMoverDismissed(true);
  }, []);

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

  // ── Welcome card (first session after onboarding only) ──────────────────
  // Diego, 2026-08-29: reinforces the same "Decide mejor" anchor from
  // login/onboarding once more, right when Home is first seen — same
  // dismiss-forever pattern as beginnerCardDismissed above (simple local
  // flag, no server sync needed for a one-time reinforcement message).
  const [welcomeCardDismissed, setWelcomeCardDismissed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("nuvos_welcome_card_dismissed") === "1"
  );
  const dismissWelcomeCard = () => {
    localStorage.setItem("nuvos_welcome_card_dismissed", "1");
    setWelcomeCardDismissed(true);
  };

  // ── Morning Brief full flashcard — auto-open once per day ────────────────
  // Diego, 2026-08-30: "que abarquen gran parte de la pantalla... cuando se
  // inicie sesión, se haga refresh o así aparezca 1 sola vez al día." Marks
  // itself seen the moment it navigates (not on close/return), so a refresh
  // 5 seconds later doesn't loop back into it — same daily-reset dismiss
  // helper MorningBriefCard already uses, different key so the two features
  // don't share state.
  const MORNING_BRIEF_FLASHCARD_KEY = "nuvos_morning_brief_flashcard_seen";
  useEffect(() => {
    if (!isPremium || !isAuthenticated || !isWeekdayET()) return;
    if (isDismissedToday(MORNING_BRIEF_FLASHCARD_KEY)) return;
    dismissToday(MORNING_BRIEF_FLASHCARD_KEY);
    router.push("/morning-brief");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPremium, isAuthenticated]);

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

  const { trades: paperTrades } = usePaperStore();
  const hasPaperTraded = paperTrades.length > 0;
  const [opportunityViewed, setOpportunityViewed] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("nuvos_opportunity_viewed") === "1"
  );
  useEffect(() => {
    if (opportunityViewed) return;
    const check = () => {
      if (localStorage.getItem("nuvos_opportunity_viewed") === "1") setOpportunityViewed(true);
    };
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [opportunityViewed]);

  // Step 1 branches on the user's declared investing status: someone who
  // already invests should be pushed to add their real portfolio, while
  // someone who hasn't should try the risk-free simulator first.
  const showAddPortfolioStep = !!profile?.has_investments;

  const onboardingSteps: OnboardingStep[] = [
    showAddPortfolioStep
      ? { emoji: "💼", title: t("home.onboarding.addFirstPosition.title"), description: t("home.onboarding.addFirstPosition.desc"), completed: positions.length > 0 }
      : { emoji: "🎮", title: t("home.onboarding.trySimulator.title"),     description: t("home.onboarding.trySimulator.desc"),     completed: hasPaperTraded },
    {
      emoji: "📞",
      title: t("home.onboarding.bookCall.title"),
      description:
        freeWindowMsLeft === null || freeWindowMsLeft > 0
          ? t("home.onboarding.bookCall.descFree", { time: freeWindowMsLeft !== null ? fmtCountdown(freeWindowMsLeft) : "24:00:00" })
          : t("home.onboarding.bookCall.descExpired", { price: brokerPriceText }),
      completed: !!profile?.has_broker,
      secondaryAction: { label: t("home.onboarding.bookCall.alreadyHaveBroker"), onClick: markBrokerConfigured },
    },
    { emoji: "🤖", title: t("home.onboarding.talkToNuvos.title"),   description: t("home.onboarding.talkToNuvos.desc"),   completed: hasChatted },
    { emoji: "👀", title: t("home.onboarding.viewOpportunity.title"), description: t("home.onboarding.viewOpportunity.desc"), completed: opportunityViewed },
  ];
  const allOnboardingDone = checklistPermanentlyDone || onboardingSteps.every((s) => s.completed);

  const persistChecklistDone = () => {
    localStorage.setItem("nuvos_checklist_done", "1");
    import("@/lib/api").then(({ sync }) => sync.pushChecklistDone().catch(() => {}));
    setChecklistPermanentlyDone(true);
  };

  // Once onboarding is complete: persist the flag so it never shows again,
  // and prompt the user to pick their preferred start screen.
  useEffect(() => {
    if (loading || !allOnboardingDone) return;
    persistChecklistDone();
    const saved = localStorage.getItem(HOME_SCREEN_KEY);
    if (!saved) setShowScreenPicker(true);
    // Show pricing modal once after checklist completion (free users only).
    // Diego, 2026-09-15 (Nuvos CARE): re-runs once `isPremium` itself
    // changes (not just loading/allOnboardingDone) so a user who is
    // ACTUALLY premium never has this decided by the brief window before
    // hasFetchedStatus resolves (hasPremiumAccess defaults to premium
    // during that window, so `!isPremium` is false then regardless) — and
    // a genuinely free user whose status resolves a moment later still
    // gets the prompt instead of silently missing it forever.
    if (!isPremium && !localStorage.getItem("nuvos_pricing_shown")) {
      localStorage.setItem("nuvos_pricing_shown", "1");
      setTimeout(() => setShowPricing(true), 1200);
    }
  }, [loading, allOnboardingDone, isPremium]);

  const handleOnboardingStep = (index: number) => {
    if (index === 1) { handleBookBrokerCall(); return; }
    if (index === 2) { router.push("/chat?tour=3"); return; }
    if (index === 3) { router.push("/subvaluadas"); return; }
    router.push(showAddPortfolioStep ? "/portfolio?tour=1" : "/paper?tour=1");
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
              <p className="text-[11px] font-bold uppercase tracking-[1.1px]" style={{ color: "var(--muted)" }}>
                {greeting(t)}
              </p>
              <h1 className="text-2xl font-extrabold tracking-tight leading-tight" style={{ color: "var(--text)" }}>
                {firstName} 👋
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
                      style={{ background: marketOpen ? "#22c55e" : "var(--dim)", boxShadow: marketOpen ? "0 0 0 3px rgba(34,197,94,0.18)" : "none" }} />
                {marketOpen ? t("home.marketOpen") : t("home.marketClosed")}
              </div>
              <ExplainButton
                screen="home"
                context={{
                  portfolio_value: total,
                  day_gain_pct: dayGainPct,
                  day_gain_amount: dayGain,
                  total_gain_pct: totalGainPct,
                  goal_progress_pct: goalAmount > 0 ? Math.round((total / goalAmount) * 100) : null,
                  cash_total: cashTotal > 0 ? cashTotal : null,
                  dividend_income_received: dividendTotal > 0 ? dividendTotal : null,
                  currency: portfolioCurrency,
                  market_indices: indices.map((idx) => ({ name: idx.name, change_pct: idx.change_pct })),
                  top_gainers: movers.map((m) => ({ ticker: m.ticker, change_pct: m.chg })),
                  top_losers: losers.map((m) => ({ ticker: m.ticker, change_pct: m.chg })),
                }}
              />
              {isBeginnerMode && beginnerCardDismissed && (
                <button onClick={reopenBeginnerCard}
                        title={t("home.showGuideTooltip")}
                        className="relative w-9 h-9 flex items-center justify-center rounded-full border transition-colors hover:border-[var(--accent)]"
                        style={{ borderColor: "var(--border)", background: "var(--card)" }}>
                  <GraduationCap className="w-4 h-4" style={{ color: "var(--sub)" }} />
                </button>
              )}
              <button onClick={() => router.push("/notifications")}
                      className="relative w-9 h-9 flex items-center justify-center rounded-full border transition-colors hover:border-[var(--accent)]"
                      style={{ borderColor: "var(--border)", background: "var(--card)" }}>
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

          <div className="px-6 py-6 space-y-7 max-w-5xl mx-auto">

            {!welcomeCardDismissed && isAuthenticated && (
              <div className="rounded-[20px] border overflow-hidden relative"
                   style={{ borderColor: "rgba(0,212,126,0.3)", background: "linear-gradient(135deg, rgba(0,185,109,0.08), rgba(0,100,200,0.04))" }}>
                <button onClick={dismissWelcomeCard}
                        aria-label={t("common.close")}
                        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
                <div className="px-5 py-4 pr-12 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                       style={{ background: "rgba(0,185,109,0.14)" }}>
                    <Sparkles className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black mb-0.5" style={{ color: "var(--text)" }}>
                      {t("home.welcomeCard.title")}
                    </p>
                    <p className="text-xs leading-relaxed mb-2.5" style={{ color: "var(--sub)" }}>
                      {t("home.welcomeCard.body")}
                    </p>
                    <button onClick={() => router.push("/chat")}
                            className="inline-flex items-center gap-1 text-xs font-bold transition-opacity hover:opacity-80"
                            style={{ color: "var(--accent-l)" }}>
                      {t("home.welcomeCard.cta")}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            <MorningBriefCard />

            {/* ── Onboarding checklist (hidden once all done) ──────────────── */}
            {!allOnboardingDone && (
              <OnboardingChecklist steps={onboardingSteps} onStepClick={handleOnboardingStep} onDismiss={persistChecklistDone} />
            )}

            {/* ── Guía para principiantes / modo guest ─────────────────── */}
            {isBeginnerMode && !beginnerCardDismissed && (
              <div className="rounded-[20px] border overflow-hidden relative"
                   style={{ borderColor: "rgba(0,212,126,0.25)", background: "linear-gradient(135deg, rgba(0,185,109,0.08), var(--card) 55%)" }}>
                <button onClick={dismissBeginnerCard}
                        aria-label={t("common.close")}
                        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                        style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
                <div className="p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[1.1px] mb-1"
                     style={{ color: "var(--accent-l)" }}>{t("home.beginnerCard.eyebrow")}</p>
                  <h3 className="text-[17px] font-extrabold tracking-tight mb-1 pr-8" style={{ color: "var(--text)" }}>
                    {t("home.beginnerCard.title")}
                  </h3>
                  <p className="text-xs mb-4" style={{ color: "var(--muted)" }}>
                    {t("home.beginnerCard.subtitle")}
                  </p>

                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {([
                      { icon: BookOpen, title: t("home.beginnerCard.step1Title"), desc: t("home.beginnerCard.step1Desc"), href: "/learn" },
                      { icon: Gamepad2, title: t("home.beginnerCard.step2Title"), desc: t("home.beginnerCard.step2Desc"), href: "/paper" },
                      { icon: Rocket,   title: t("home.beginnerCard.step3Title"), desc: t("home.beginnerCard.step3Desc"), href: "/screener" },
                    ] as const).map((s) => (
                      <button key={s.href} onClick={() => router.push(s.href)}
                              className="flex flex-col items-start p-3.5 rounded-[14px] border transition-all hover:border-[var(--accent)] text-left"
                              style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                        <span className="w-8 h-8 rounded-[10px] flex items-center justify-center mb-2" style={{ background: "rgba(0,185,109,0.12)" }}>
                          <s.icon className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                        </span>
                        <p className="text-xs font-bold mb-0.5" style={{ color: "var(--text)" }}>{s.title}</p>
                        <p className="text-[11px] leading-snug" style={{ color: "var(--muted)" }}>{s.desc}</p>
                      </button>
                    ))}
                  </div>

                  <button onClick={() => router.push("/chat")}
                          className="w-full py-3 rounded-[14px] text-sm font-bold transition-all hover:opacity-90 inline-flex items-center justify-center gap-1.5"
                          style={{ background: "var(--accent)", color: "#fff" }}>
                    {t("home.beginnerCard.askMentor")}
                    <ArrowRight className="w-4 h-4" />
                  </button>

                  {isGuest && (
                    <button onClick={() => router.push("/?auth=1")}
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
                      className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: dayGain >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }}>
                  {dayGain >= 0
                    ? <TrendingUp className="w-4 h-4" style={{ color: "#22c55e" }} />
                    : <TrendingDown className="w-4 h-4" style={{ color: "#ef4444" }} />}
                </span>
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: dayGain >= 0 ? "#22c55e" : "#ef4444" }}>
                    {loading ? "—" : fmtPct(dayGainPct)}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>{t("home.stats.portfolioToday")}</p>
                </div>
              </button>

              {/* Racha */}
              <button onClick={() => router.push("/learn")}
                      className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(245,158,11,0.12)" }}>
                  <Flame className="w-4 h-4" style={{ color: "#f59e0b" }} />
                </span>
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: streak > 0 ? "#f59e0b" : "var(--text)" }}>
                    {t("home.streakCard.days", { count: streak })}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>{t("home.stats.streak")}</p>
                </div>
              </button>

              {/* Meta */}
              <button onClick={openGoalModal}
                      className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: goalInfo ? "rgba(0,212,126,0.25)" : "var(--border)" }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.12)" }}>
                  {goalInfo
                    ? <Flag className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                    : <Target className="w-4 h-4" style={{ color: "var(--accent-l)" }} />}
                </span>
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
                      className="flex items-center gap-3 px-3.5 py-3 rounded-[16px] border transition-all hover:border-[var(--accent)]"
                      style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: unread > 0 ? "rgba(239,68,68,0.12)" : "var(--raised)" }}>
                  <Bell className="w-4 h-4" style={{ color: unread > 0 ? "#ef4444" : "var(--sub)" }} />
                </span>
                <div className="text-left min-w-0">
                  <p className="text-sm font-black leading-none"
                     style={{ color: unread > 0 ? "#ef4444" : "var(--text)" }}>
                    {unread > 0 ? t("home.stats.newAlerts", { count: unread }) : totalNotifs > 0 ? t("home.stats.alertsCount", { count: totalNotifs }) : t("home.stats.noAlerts")}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--muted)" }}>{t("home.stats.notifications")}</p>
                </div>
              </button>
            </div>

            {/* Diego, 2026-09-11 — "Decide mejor" audit: replaces the old
                Monthly Report entry point that used to live here (moved
                off Home; Wrapped's own entry in Profile remains the
                primary "recap" surface). This is the real decision-hook
                the audit found Home was missing — only rendered when
                there's genuinely something real to say. */}
            {topMoverInsight && !topMoverDismissed && (
              <InsightCallout
                icon={<Zap className="w-4 h-4" style={{ color: "#D4A24C" }} />}
                title={t("home.topMoverInsight.title", { ticker: topMoverInsight.ticker })}
                body={t(
                  topMoverInsight.dollarImpact >= 0
                    ? "home.topMoverInsight.bodyPositive"
                    : "home.topMoverInsight.bodyNegative",
                  {
                    amount: balanceHidden ? "••••" : fmt(Math.abs(topMoverInsight.dollarImpact), portfolioCurrency),
                    pct: fmtPct(topMoverInsight.pct),
                  },
                )}
                cta={{
                  label: t("home.topMoverInsight.cta", { ticker: topMoverInsight.ticker }),
                  onClick: () => router.push(`/subvaluadas?ticker=${topMoverInsight.ticker}`),
                }}
                onClose={() => {
                  dismissToday(TOP_MOVER_INSIGHT_DISMISS_KEY);
                  setTopMoverDismissed(true);
                }}
              />
            )}

            {/* ── Main grid: Portfolio hero + Key stats ───────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Portfolio hero (2/3) — polished 2026-09-28, same as mobile:
                  subtle brand-green gradient + glow, high-contrast labels,
                  currency pill, big value with today's badge under it,
                  readable cash/dividend lines and the three returns in an
                  inset panel. A <div role="button"> since it contains the
                  eye-toggle <button> (a <button> can't nest a <button>). */}
              <div role="button" tabIndex={0}
                      onClick={() => router.push("/patrimonio")}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push("/patrimonio"); }}
                      className="lg:col-span-2 flex flex-col justify-center text-left rounded-[22px] p-6 border transition-all hover:-translate-y-0.5 relative overflow-hidden cursor-pointer"
                      style={{
                        background: "linear-gradient(135deg, rgba(0,185,109,0.14) 0%, rgba(0,185,109,0.03) 45%, var(--card) 100%), var(--card)",
                        borderColor: "rgba(0,185,109,0.25)",
                        boxShadow: "0 14px 34px -18px rgba(0,185,109,0.45)",
                      }}>
                <div aria-hidden className="pointer-events-none absolute -top-24 -right-20 w-64 h-64 rounded-full"
                     style={{ background: "radial-gradient(circle, rgba(0,232,135,0.12), transparent 70%)" }} />

                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Label row */}
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-l)" }} />
                      <span className="text-xs font-bold uppercase tracking-[1px]" style={{ color: "var(--sub)" }}>
                        {t("home.portfolioHero.myPortfolio")}
                      </span>
                      <span className="inline-flex items-center gap-1.5 pl-[3px] pr-2 py-[3px] rounded-full border"
                            style={{ background: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.35)" }}>
                        <span className="min-w-4 h-4 px-[3px] rounded-full flex items-center justify-center text-[10px] font-black"
                              style={{ background: "var(--accent-l)", color: "var(--bg)" }}>
                          {sym}
                        </span>
                        <span className="text-[11px] font-extrabold tracking-[0.8px]" style={{ color: "var(--accent-l)" }}>
                          {portfolioCurrency}
                        </span>
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleBalanceHidden(); }}
                        className="p-0.5 rounded-md transition-opacity hover:opacity-70"
                        style={{ color: "var(--sub)" }}
                        aria-label={balanceHidden ? t("home.portfolioHero.showBalance") : t("home.portfolioHero.hideBalance")}
                        title={balanceHidden ? t("home.portfolioHero.showBalance") : t("home.portfolioHero.hideBalance")}
                      >
                        {balanceHidden ? <EyeOff className="w-[19px] h-[19px]" /> : <Eye className="w-[19px] h-[19px]" />}
                      </button>
                    </div>

                    {/* Value */}
                    {loading ? (
                      <div className="h-11 w-52 rounded-lg animate-pulse mt-3.5" style={{ background: "var(--raised)" }} />
                    ) : (() => {
                      const heroTotal = total + cashTotal + dividendTotal;
                      const heroValueStr = balanceHidden ? "••••••" : fmt(heroTotal, portfolioCurrency);
                      // Shrinks very large values proportionally instead of wrapping/clipping.
                      const heroValueSize =
                        heroValueStr.length > 16 ? "1.9rem" :
                        heroValueStr.length > 13 ? "2.3rem" : undefined;
                      return (
                        <p className="text-[44px] font-extrabold tracking-[-1.5px] leading-none whitespace-nowrap mt-3.5"
                           style={{ color: "var(--text)", fontSize: heroValueSize }}>
                          {heroValueStr}
                        </p>
                      );
                    })()}

                    {/* Today's badge */}
                    {!loading && (
                      <span className="inline-flex items-center gap-1 mt-2.5 px-2.5 py-[5px] rounded-full border text-[13px] font-extrabold"
                            style={{
                              color: dayGain >= 0 ? "var(--up)" : "var(--down)",
                              background: `color-mix(in srgb, ${dayGain >= 0 ? "var(--up)" : "var(--down)"} 12%, transparent)`,
                              borderColor: `color-mix(in srgb, ${dayGain >= 0 ? "var(--up)" : "var(--down)"} 35%, transparent)`,
                            }}>
                        {dayGain >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        {fmtPct(dayGainPct)} {t("home.portfolioHero.todaySuffix")}
                      </span>
                    )}

                    {/* Cash / dividends */}
                    {!loading && !balanceHidden && (cashTotal > 0 || dividendTotal > 0) && (
                      <div className="mt-3 space-y-1">
                        {cashTotal > 0 && (
                          <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--sub)" }}>
                            <Wallet className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent-l)" }} />
                            <span><b className="font-bold" style={{ color: "var(--text)" }}>{fmt(cashTotal, portfolioCurrency)}</b> en efectivo</span>
                          </p>
                        )}
                        {dividendTotal > 0 && (
                          <p className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--sub)" }}>
                            <Banknote className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent-l)" }} />
                            <span><b className="font-bold" style={{ color: "var(--text)" }}>{fmt(dividendTotal, portfolioCurrency)}</b> en dividendos recibidos</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Profile avatar */}
                  <div className="shrink-0 w-20 h-20 rounded-full overflow-hidden border-2"
                       style={{ borderColor: "rgba(0,185,109,0.35)" }}>
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} className="w-full h-full object-cover" alt="avatar" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl font-black"
                           style={{ background: "rgba(0,185,109,0.14)", color: "var(--accent-l)" }}>
                        {profile?.name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                    )}
                  </div>
                </div>

                {/* Returns — inset panel */}
                {!loading && positions.length > 0 && (() => {
                  const cols: { label: string; pct: number | null; amt: number | null }[] = [
                    { label: t("home.portfolioHero.today"), pct: dayGainPct, amt: dayGain },
                    { label: isPremium ? "YTD" : "5D", pct: ytdGain !== null ? (ytdPct ?? 0) : null, amt: ytdGain !== null ? ytdGain * fxRate : null },
                    isPremium
                      ? { label: "Total", pct: maxGain !== null ? (maxPct ?? 0) : null, amt: maxGain !== null ? maxGain * fxRate : null }
                      : { label: "1M", pct: shortGain !== null ? (shortPct ?? 0) : null, amt: shortGain !== null ? shortGain * fxRate : null },
                  ];
                  return (
                    <div className="relative flex items-stretch mt-5 px-4 py-3.5 rounded-[14px] border"
                         style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)", borderColor: "var(--border)" }}>
                      {cols.map((c, i) => {
                        const pos = (c.amt ?? 0) >= 0;
                        return (
                          <div key={c.label} className="flex-1 min-w-0 flex">
                            {i > 0 && <div className="w-px self-stretch mx-4" style={{ background: "var(--border)" }} />}
                            <div className="min-w-0">
                              <p className="text-[11.5px] font-bold uppercase tracking-[0.8px] mb-1.5" style={{ color: "var(--sub)" }}>{c.label}</p>
                              <p className="text-xl font-extrabold tracking-tight leading-none truncate"
                                 style={{ color: c.pct === null ? "var(--sub)" : pos ? "var(--up)" : "var(--down)" }}>
                                {c.pct === null ? "—" : fmtPct(c.pct)}
                              </p>
                              {c.amt !== null && (
                                <p className="text-[13.5px] font-semibold mt-1 truncate" style={{ color: "var(--text)" }}>
                                  {balanceHidden ? "••••" : `${pos ? "+" : ""}${fmt(c.amt, portfolioCurrency)}`}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {!loading && !positions.length && (
                  <div className="relative mt-4 pt-4 border-t border-dashed" style={{ borderColor: "var(--border)" }}>
                    <p className="text-sm font-black mb-1" style={{ color: "var(--text)" }}>{t("home.portfolioHero.addFirstStock")}</p>
                    <p className="text-xs mb-3 leading-relaxed" style={{ color: "var(--muted)" }}>
                      {t("home.portfolioHero.addFirstStockDesc")}
                    </p>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {["AAPL", "NVDA", "MSFT", "TSLA", "GOOGL"].map((ticker) => (
                        <button key={ticker} onClick={(e) => { e.stopPropagation(); router.push("/portfolio"); }}
                                className="text-xs font-bold px-2.5 py-1 rounded-lg border transition-colors hover:border-[var(--accent)]"
                                style={{ borderColor: "var(--border)", color: "var(--accent-l)", background: "var(--raised)" }}>
                          {ticker}
                        </button>
                      ))}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); router.push("/portfolio"); }}
                            className="w-full py-2 rounded-xl text-xs font-bold transition-colors"
                            style={{ background: "var(--accent)", color: "#fff" }}>
                      {t("home.portfolioHero.addPosition")}
                    </button>
                  </div>
                )}
              </div>

              {/* Right column: 3 key stat cards */}
              <div className="flex flex-col gap-3">

                {/* 🎯 Meta */}
                <button onClick={openGoalModal}
                        className="flex-1 flex items-center gap-3.5 px-4 py-4 rounded-[18px] border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  <MiniRing pct={goalPct / 100} color="var(--accent-l)">
                    {goalInfo
                      ? <Flag className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />
                      : <Target className="w-[18px] h-[18px]" style={{ color: "var(--accent-l)" }} />}
                  </MiniRing>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[1px] mb-0.5" style={{ color: "var(--muted)" }}>{t("home.goalCard.myGoal")}</p>
                    <p className="text-[15px] font-extrabold tracking-tight truncate" style={{ color: "var(--text)" }}>
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
                        className="flex-1 flex items-center gap-3.5 px-4 py-4 rounded-[18px] border transition-all hover:border-[var(--accent)] text-left"
                        style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {(() => {
                    const next = getNextMilestone(streak);
                    return (
                      <MiniRing pct={next ? streak / next.days : 1} color="#f59e0b">
                        <Flame className="w-[18px] h-[18px]" style={{ color: "#f59e0b" }} />
                      </MiniRing>
                    );
                  })()}
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[1px] mb-0.5" style={{ color: "var(--muted)" }}>{t("home.stats.streak")}</p>
                    <p className="text-xl font-extrabold tracking-tight leading-none" style={{ color: "var(--text)" }}>
                      {t("home.streakCard.days", { count: streak })}
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--muted)" }}>
                      {streak === 0 ? t("home.streakCard.startToday") : t("home.streakCard.consecutive")}
                    </p>
                  </div>
                </button>

                {/* 📚 Lección del día */}
                <button onClick={() => router.push("/learn")}
                        className="flex-1 flex items-center gap-3.5 px-4 py-4 rounded-[18px] border transition-all hover:border-[var(--accent)] text-left"
                        style={{
                          background: "var(--card)",
                          borderColor: completedToday ? "rgba(34,197,94,0.35)" : "var(--border)",
                        }}>
                  <div className="w-11 h-11 rounded-[12px] flex items-center justify-center shrink-0"
                       style={{ background: completedToday ? "rgba(34,197,94,0.12)" : "rgba(0,185,109,0.10)" }}>
                    {completedToday
                      ? <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />
                      : <GraduationCap className="w-5 h-5" style={{ color: "var(--accent-l)" }} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[1px] mb-0.5"
                       style={{ color: completedToday ? "#22c55e" : "var(--muted)" }}>
                      {completedToday ? t("home.lessonCard.completedToday") : t("home.lessonCard.lessonOfDay")}
                    </p>
                    <p className="text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{dailyLesson.title}</p>
                    {"body" in dailyLesson && !completedToday && (
                      <p className="text-[10px] mt-1 line-clamp-2 leading-relaxed" style={{ color: "var(--muted)" }}>
                        {(dailyLesson as { body: string }).body}
                      </p>
                    )}
                    {"tip" in dailyLesson && !completedToday && (
                      <p className="flex items-start gap-1 text-[11px] mt-1 font-semibold" style={{ color: "var(--accent-l)" }}>
                        <Lightbulb className="w-3 h-3 shrink-0 mt-px" />
                        {(dailyLesson as { tip: string }).tip}
                      </p>
                    )}
                    {completedToday && (
                      <p className="inline-flex items-center gap-1 text-[11px] mt-0.5 font-semibold" style={{ color: "#16a34a" }}>
                        {t("home.lessonCard.viewAnother")}
                        <ChevronRight className="w-3 h-3" />
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
                  <h2 className="text-[17px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>
                    {t("home.mostImportantToday")}
                  </h2>
                  <button onClick={() => router.push("/notifications")}
                          className="inline-flex items-center gap-0.5 text-[13px] font-semibold hover:opacity-80" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewAll")}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="rounded-[18px] border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {topNotifs.map((n: any, i: number) => (
                    <button key={n.id ?? i}
                            onClick={() => router.push("/notifications")}
                            className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:opacity-80 transition-opacity ${i > 0 ? "border-t" : ""}`}
                            style={{ borderColor: "var(--border)" }}>
                      {(() => {
                        const NIcon = notifIcon(n.type);
                        return (
                          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.10)" }}>
                            <NIcon className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
                          </span>
                        );
                      })()}
                      <div className="flex-1 min-w-0">
                        <p className="text-[13.5px] font-bold" style={{ color: "var(--text)" }}>{n.title}</p>
                        {n.body && (
                          <p className="text-xs mt-0.5 line-clamp-2 leading-relaxed" style={{ color: "var(--muted)" }}>{n.body}</p>
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: BookOpen,       label: t("home.quickActions.askSomething"), sub: t("home.quickActions.aiMentor"),   href: "/chat",       accent: true  },
                { icon: Sparkles,       label: t("home.quickActions.myMoney"),      sub: t("home.quickActions.patrimonio"), href: "/patrimonio", accent: false },
                { icon: GraduationCap,  label: t("home.quickActions.learn"),        sub: t("home.quickActions.academy"),    href: "/learn",       accent: false },
                { icon: Flame,          label: t("home.quickActions.myProfile"),    sub: t("home.quickActions.stats"),      href: "/profile",     accent: false },
              ].map(({ icon: Icon, label, sub, href, accent }) => (
                <button key={href}
                        onClick={() => router.push(href)}
                        className="flex flex-col items-start p-4 rounded-[18px] border transition-all hover:border-[var(--accent)] hover:-translate-y-0.5"
                        style={{
                          background: accent ? "linear-gradient(135deg, rgba(0,185,109,0.12), var(--card) 70%)" : "var(--card)",
                          borderColor: accent ? "rgba(0,185,109,0.3)" : "var(--border)",
                        }}>
                  <span className="w-10 h-10 rounded-[12px] flex items-center justify-center mb-3"
                        style={{ background: accent ? "var(--accent)" : "rgba(0,185,109,0.10)" }}>
                    <Icon className="w-[18px] h-[18px]" style={{ color: accent ? "#fff" : "var(--accent-l)" }} />
                  </span>
                  <p className="text-[13.5px] font-bold leading-tight" style={{ color: "var(--text)" }}>{label}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{sub}</p>
                </button>
              ))}
            </div>

            {/* ── Top movers ──────────────────────────────────────────────── */}
            {positions.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-[17px] font-extrabold tracking-tight flex items-center gap-2" style={{ color: "var(--text)" }}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.12)" }}>
                      <TrendingUp className="w-3.5 h-3.5" style={{ color: "#22c55e" }} />
                    </span>
                    {t("home.risingToday")}
                  </h2>
                  <button onClick={() => router.push("/patrimonio")}
                          className="inline-flex items-center gap-0.5 text-[13px] font-semibold hover:opacity-80" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewAll")}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="rounded-[18px] border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
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
                             className="flex items-center gap-3 px-4 py-3.5 border-b last:border-b-0 cursor-pointer hover:opacity-80 transition-opacity"
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
                  <h2 className="text-[17px] font-extrabold tracking-tight flex items-center gap-2" style={{ color: "var(--text)" }}>
                    <span className="w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(239,68,68,0.12)" }}>
                      <TrendingDown className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                    </span>
                    {t("home.fallingToday")}
                  </h2>
                  <button onClick={() => router.push("/patrimonio")}
                          className="inline-flex items-center gap-0.5 text-[13px] font-semibold hover:opacity-80" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewAll")}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="rounded-[18px] border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
                  {losers.map((m) => (
                    <div key={m.ticker}
                         className="flex items-center gap-3 px-4 py-3.5 border-b last:border-b-0 cursor-pointer hover:opacity-80 transition-opacity"
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
                  <h2 className="text-[17px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>
                    {t("home.portfolioNews")}
                  </h2>
                  <button onClick={() => router.push("/notifications")}
                          className="inline-flex items-center gap-0.5 text-[13px] font-semibold hover:opacity-80" style={{ color: "var(--accent-l)" }}>
                    {t("home.viewMore")}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {news.map((item: any, idx: number) => (
                    <div key={idx} className="rounded-[18px] border overflow-hidden transition-all hover:border-[var(--accent)]"
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
                      <div className="p-3.5">
                        {item.ticker && (
                          <span className="inline-block text-[10.5px] font-extrabold tracking-[0.5px] px-2 py-0.5 rounded-full"
                                style={{ color: "var(--accent-l)", background: "rgba(0,185,109,0.10)" }}>
                            {item.ticker}
                          </span>
                        )}
                        <p className="text-[13px] font-bold leading-snug mt-1.5 line-clamp-3"
                           style={{ color: "var(--text)" }}>
                          {item.title}
                        </p>
                        <p className="text-[11px] mt-2 truncate" style={{ color: "var(--muted)" }}>
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
                    className="w-full flex items-center gap-4 p-5 rounded-[20px] border transition-all hover:border-[var(--accent)]"
                    style={{ background: "linear-gradient(135deg, rgba(0,185,109,0.14), var(--card) 65%)", borderColor: "rgba(0,185,109,0.3)" }}>
              <div className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0"
                   style={{ background: "var(--accent)" }}>
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-[16px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("home.mentorCta.title")}</p>
                <p className="text-[13px] mt-0.5" style={{ color: "var(--sub)" }}>
                  {distinctPositionsCount
                    ? t("home.mentorCta.withPositions", { count: distinctPositionsCount })
                    : t("home.mentorCta.withoutPositions")}
                </p>
              </div>
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.12)" }}>
                <ArrowRight className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
              </span>
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

      {brokerCheckoutOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}>
          {/* Same fix as products/page.tsx's checkout modal (2026-09-15):
              no maxHeight/scroll here clipped a tall checkout form with no
              way to reach the rest of it. */}
          <div
            className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-y-auto"
            style={{ background: "var(--bg)", border: "1px solid var(--border)", maxHeight: "90vh", minHeight: 0, WebkitOverflowScrolling: "touch" }}
          >
            <div className="pt-5">
              <EmbeddedCheckout
                createIntent={() => billing.createEmbeddedBrokerCall(brokerMxn ? "mxn" : "usd").then((r) => r.data)}
                returnUrl={`${window.location.origin}/upsell-success?offer=broker_call`}
                onBack={() => setBrokerCheckoutOpen(false)}
                onSuccess={handleBrokerCheckoutSuccess}
                payCtaLabel={t("pricingModal.payCtaSession")}
                summary={brokerCallSummary}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
