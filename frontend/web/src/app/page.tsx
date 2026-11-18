"use client";
export const dynamic = "force-dynamic";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { auth, profile as profileApi, screenerApi, etfApi } from "@/lib/api";
import { applyPendingReferralIfAny } from "@/lib/referral";
import { consumeReturnTo } from "@/lib/returnTo";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuthStore, useProfileStore, useLanguageStore, enterGuestMode, isGuestUser, getGuestId } from "@/lib/store";
import { Eye, EyeOff, ArrowRight, User, Send, PieChart, Search, ListChecks } from "lucide-react";
import {
  captureOnboardingStarted,
  captureOnboardingGoalSelected,
  captureSignupStarted,
  captureSignupCompleted,
  identifyUser,
  saveOnboardingGoal,
  readOnboardingGoal,
  type OnboardingGoal,
} from "@/lib/onboardingAnalytics";

// Stage D: shown at most once, ever, per browser — a visitor who's already
// seen the Bienvenida screen (whatever they did next) never sees it again,
// same "no pantalla obligatoria cada vez que se abre Nuvos" rule the goal
// screen already follows.
const WELCOME_SEEN_KEY = "nuvos_seen_welcome";

function getPillars(t: TFunction) {
  return [
    {
      emoji: "🧠",
      accent: "#a78bfa",
      title: t("landing.pillars.mentor.title"),
      desc: t("landing.pillars.mentor.desc"),
    },
    {
      emoji: "🔔",
      accent: "#f59e0b",
      title: t("landing.pillars.alerts.title"),
      desc: t("landing.pillars.alerts.desc"),
    },
    {
      emoji: "⚡",
      accent: "#34d399",
      title: t("landing.pillars.action.title"),
      desc: t("landing.pillars.action.desc"),
    },
  ];
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageStore();
  const PILLARS = getPillars(t);
  // /?auth=1 is the one explicit "show me the login/register form" escape
  // hatch — every internal link whose real intent is signing in or creating
  // an account (the guest-mode "Crear cuenta gratis" card, PremiumBadge's
  // logged-out state, the referral /join page) points here instead of bare
  // "/", which now sends anyone without a session straight into guest
  // exploration instead (Diego: "NO QUIERO QUE SE ABRA EL LOGIN... QUIERO
  // QUE LOS USUARIOS QUE NO NOS CONOCEN... PUEDAN VER TODO EL VALOR").
  const searchParams = useSearchParams();
  const wantsAuthForm = searchParams.get("auth") === "1";
  // AppSidebar's guest CTA links to /?auth=1&mode=register for "Crear
  // cuenta" — was already a no-op before (this page never read a `mode`
  // param at all), now made real.
  // "goal" = the new Personalización step (one question: ¿qué quieres
  // entender primero?) shown before the email/password form for anyone
  // heading toward registration. Existing links to ?mode=register (e.g.
  // AppSidebar's guest CTA) now land on "goal" first instead of skipping
  // straight to the form — registration itself is unchanged.
  // Skip straight to "register" instead of re-asking "goal" when a goal is
  // already saved (e.g. a guest who explored Empresa/ETF via the Radar
  // public route and is now coming back to create an account) — Stage C:
  // never lose the intention the user already gave us.
  // "welcome" = Stage D's Bienvenida screen (title + 3 actions, no form) —
  // shown only to a truly first-ever, unknown visitor (see the ?auth=1
  // catch-block below); every other entry point (?auth=1 explicitly,
  // ?mode=register, a returning guest) is unaffected and starts at its
  // existing mode exactly as before.
  const [mode, setMode]             = useState<"login" | "register" | "forgot" | "goal" | "welcome" | "preview">(
    () => (searchParams.get("mode") === "register" ? (readOnboardingGoal() ? "register" : "goal") : "login")
  );
  const [goal, setGoal] = useState<OnboardingGoal | null>(() => readOnboardingGoal());
  // Onboarding preview (Empresa/ETF) — a real, curated example shown
  // inline during onboarding, never via enterGuestMode()/the real Explorer.
  const PREVIEW_COMPANY_TICKER = "AAPL"; // the free default view — real data, no weekly-limit impact
  const PREVIEW_ETF_TICKERS = ["VOO", "QQQ", "VXUS"] as const;
  const [previewEtfIndex, setPreviewEtfIndex] = useState(0);
  const [previewCompany, setPreviewCompany] = useState<{
    ticker: string; company_name: string | null; price: number | null; margin_of_safety_pct: number | null; summary: string;
  } | null>(null);
  const [previewEtf, setPreviewEtf] = useState<{
    ticker: string; name: string | null; expense_ratio_pct: number | null;
    top_sector_name: string | null; top_sector_pct: number | null; horizon_note: string; insight: string | null;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  // Mini Arthur demo on the left panel — Diego, 2026-10-04: "añade la
  // posibilidad de chatear con Arthur y probarlo levemente", then,
  // 2026-10-04 follow-up: "respuesta inmediata, en menos de 1 segundo,
  // que el usuario no espere nada". A real Claude call can't honestly be
  // sub-second, so this no longer hits the backend at all — it answers
  // the 3 suggested beginner questions (and simple keyword variations of
  // them) instantly from real, pre-written, generic educational copy,
  // same accuracy bar as the rest of this page's static copy. Never
  // personalized, never a fabricated reply to a question it doesn't
  // recognize — those get an honest "create your account to ask Arthur
  // directly" instead of a fake answer. Single exchange shown at a time
  // (not a growing thread) to keep this a quick taste, not a full
  // conversation, on a screen whose real job is login.
  const [previewUser, setPreviewUser]     = useState<string | null>(null);
  const [previewReply, setPreviewReply]   = useState("");
  const [previewTyping, setPreviewTyping] = useState(false);
  const [previewInput, setPreviewInput]   = useState("");

  const pickPreviewAnswer = (question: string): string => {
    const q = question.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (/riesgo|\brisk\b/.test(q)) return t("landing.preview.answer2");
    if (/(cuanto|minimo|how much).*(invert|start)|start investing/.test(q)) return t("landing.preview.answer1");
    if (/ganar dinero|hacer dinero|make money|dividend|bolsa|stock market/.test(q)) return t("landing.preview.answer3");
    return t("landing.preview.answerFallback");
  };

  const askArthurPreview = (question: string) => {
    const q = question.trim();
    if (!q || previewTyping) return;
    setPreviewInput("");
    setPreviewUser(q);
    setPreviewReply("");
    setPreviewTyping(true);
    const words = pickPreviewAnswer(q).split(" ");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setPreviewReply(words.slice(0, i).join(" "));
      if (i >= words.length) { clearInterval(id); setPreviewTyping(false); }
    }, 9); // ~9ms/word — a ~40-word answer finishes well under half a second
  };

  // Forgot password flow
  const [forgotStep, setForgotStep]         = useState<"email" | "code" | "newpass">("email");
  const [forgotEmail, setForgotEmail]       = useState("");
  const [forgotCode, setForgotCode]         = useState("");
  const [forgotNewPass, setForgotNewPass]   = useState("");
  const [forgotDone, setForgotDone]         = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  const [checking, setChecking]                 = useState(true);
  const [existingUserName, setExistingUserName] = useState<string | null>(null);

  const extractErrorMsg = (err: unknown): string => {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 429) return t("landing.rateLimited");
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) return String(detail[0]?.msg ?? detail[0]);
    return "";
  };

  const router = useRouter();
  const { setAuth } = useAuthStore();
  const { setProfile } = useProfileStore();

  useEffect(() => {
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    // Whether or not localStorage says this browser was previously
    // authenticated, always confirm a profile actually exists before
    // deciding where to send the user. The old code sent a previously-
    // authenticated user straight to /home with NO profile check at all —
    // so anyone who signed up, started onboarding, and closed the tab
    // (network hiccup, distraction, anything) came back to a permanently
    // half-initialized account: authenticated, no profile, and /home has no
    // guard of its own to catch that and send them back to finish it.
    const fallback = setTimeout(() => setChecking(false), 4000);
    profileApi.get()
      .then((res) => {
        clearTimeout(fallback);
        setAuth("", res.data.user_id);
        setProfile(res.data);
        setExistingUserName(res.data.name || res.data.email || t("landing.yourAccount"));
        router.push(consumeReturnTo() ?? "/home");
      })
      .catch((err: unknown) => {
        clearTimeout(fallback);
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404) {
          // Valid session (the auth dependency already rejects an invalid
          // one with 401 before this can even 404), just no profile row yet.
          // Stage C: the minimal screen (birth date + legal consent only),
          // not the old 6-step wizard — see /onboarding/quick.
          router.replace("/onboarding/quick");
          return;
        }
        // No valid session (or profileApi itself failed) — send straight
        // into guest exploration instead of showing the login form, unless
        // ?auth=1 explicitly asked for it (see the comment on wantsAuthForm
        // above). Mirrors exactly what the "Explorar sin cuenta" button
        // below already sets. Chat with Arthur, not Home, is deliberately
        // the first screen a stranger ever sees (Diego: "es la primera
        // pantalla que quiero que vean") — it's the one screen that needs
        // no portfolio, no positions, nothing personal to already feel like
        // the real product.
        if (!wantsAuthForm) {
          // Stage D: a truly first-ever, unknown visitor (never seen the
          // Bienvenida screen, never explored as a guest before) sees it
          // once instead of silently dropping straight into guest chat.
          // Anyone who's already been through it — or already explored as
          // a guest via any other entry point — keeps the exact prior
          // behavior (auto guest → /chat, no screen in the way at all).
          let alreadySeenWelcome = false;
          try {
            alreadySeenWelcome = localStorage.getItem(WELCOME_SEEN_KEY) === "1" || isGuestUser();
          } catch { /* Safari private mode — treat as never seen, harmless either way */ }
          if (alreadySeenWelcome) {
            enterGuestMode().finally(() => router.replace("/chat"));
            return;
          }
          try { localStorage.setItem(WELCOME_SEEN_KEY, "1"); } catch { /* cosmetic only */ }
          setMode("welcome");
          setChecking(false);
          return;
        }
        setChecking(false);
      });
  }, []);

  useEffect(() => {
    // Either entry point counts as "started" — a direct ?mode=register
    // link that skips Bienvenida (e.g. AppSidebar's CTA) still reaches
    // Personalización, so it must still register as onboarding_started.
    // captureOnboardingStarted dedupes per browser session on its own, so
    // reaching both "welcome" then "goal" in the same visit never double-fires.
    if (mode === "welcome" || mode === "goal") captureOnboardingStarted();
    if (mode === "register") captureSignupStarted();
  }, [mode]);

  // Onboarding preview fetch — real data, fixed curated ticker(s), no
  // guest session created. The weekly VI-search counter isn't touched
  // (AAPL's default view is exempt server-side, same as the real Radar
  // screen); the ETF endpoint is a dedicated no-auth preview route, not
  // the general-purpose one.
  useEffect(() => {
    if (mode !== "preview" || !goal) return;
    setPreviewError(false);
    if (goal === "company" && !previewCompany) {
      setPreviewLoading(true);
      screenerApi.quickAnalysisPublic(PREVIEW_COMPANY_TICKER, getGuestId(), language, true)
        .then((res) => setPreviewCompany({
          ticker: res.data.ticker, company_name: res.data.company_name,
          price: res.data.price, margin_of_safety_pct: res.data.margin_of_safety_pct,
          summary: res.data.summary,
        }))
        .catch(() => setPreviewError(true))
        .finally(() => setPreviewLoading(false));
    } else if (goal === "etf") {
      const ticker = PREVIEW_ETF_TICKERS[previewEtfIndex];
      setPreviewLoading(true);
      etfApi.preview(ticker, language)
        .then((res) => {
          const d = res.data;
          setPreviewEtf({
            ticker: d.ticker, name: d.identification?.name ?? null,
            expense_ratio_pct: d.costs?.expense_ratio_pct ?? null,
            top_sector_name: d.diversification?.by_sector?.top1_name ?? null,
            top_sector_pct: d.diversification?.by_sector?.top1_weight_pct ?? null,
            horizon_note: d.horizon_note, insight: d.insights?.[0]?.text ?? null,
          });
        })
        .catch(() => setPreviewError(true))
        .finally(() => setPreviewLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, goal, previewEtfIndex]);

  const handleGoalSelect = (selected: OnboardingGoal) => {
    setGoal(selected);
    saveOnboardingGoal(selected);
    captureOnboardingGoalSelected(selected);
    setError("");
    if (selected === "portfolio") {
      // Portafolio siempre requiere cuenta — datos personales, no hay
      // vista previa honesta que mostrar sin ellos.
      setMode("register");
      return;
    }
    // Empresa y ETF: Diego, 2026-11-15 — "mostrar valor de lo que viene
    // dentro... pero sin meterlo como guest, sino como parte del
    // onboarding". Antes, Empresa entraba a modo invitado real
    // (enterGuestMode + /subvaluadas) y ETF iba directo a registro sin
    // mostrar nada. Ahora ambos muestran un ejemplo real curado — aquí
    // mismo, dentro del onboarding — antes de pedir la cuenta.
    setMode("preview");
  };

  useEffect(() => {
    if (forgotStep !== "code") return;
    setResendCooldown(30);
    const id = setInterval(() => setResendCooldown((v) => (v > 0 ? v - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [forgotStep]);

  const handleForgotSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      if (forgotStep === "email") {
        await auth.forgotPassword(forgotEmail);
        setForgotStep("code");
      } else if (forgotStep === "code") {
        setForgotStep("newpass");
      } else {
        await auth.resetPassword(forgotEmail, forgotCode, forgotNewPass);
        setForgotDone(true);
      }
    } catch (err: unknown) {
      setError(extractErrorMsg(err) || t("landing.genericError"));
    } finally { setLoading(false); }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setLoading(true); setError("");
    try {
      await auth.forgotPassword(forgotEmail);
      setResendCooldown(30);
    } catch (err: unknown) {
      setError(extractErrorMsg(err) || t("landing.resendError"));
    } finally { setLoading(false); }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true); setError("");
    try {
      // Clear any leftover Supabase session before starting a fresh OAuth flow —
      // this page is only reachable while logged out of the app, but a stale
      // Supabase session from a previous account (never explicitly signed out
      // of) would otherwise get silently reused by the callback page instead
      // of the account the user is actually trying to sign into now.
      await getSupabaseClient().auth.signOut();
      // redirectTo must be a FIXED origin, not window.location.origin: the
      // PKCE code_verifier is saved to sessionStorage under the origin the
      // flow STARTS on (apex or www), but Vercel 307-redirects the apex to
      // www site-wide, so a flow started on the apex would land on /auth/
      // callback under www with no verifier available — exchangeCodeForSession
      // fails silently and the user bounces back to login in a loop. Same
      // apex/www split that made the auth cookie's Domain need to be fixed
      // to .nuvosai.com (see backend/app/api/routes/auth.py's _COOKIE_KW).
      const isProd = window.location.hostname.endsWith("nuvosai.com");
      const callbackOrigin = isProd ? "https://www.nuvosai.com" : window.location.origin;
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${callbackOrigin}/auth/callback` },
      });
      if (error) setError(`Google error: ${error.message}`);
    } catch (e: unknown) {
      setError(`Error: ${(e as { message?: string })?.message ?? t("landing.unknown")}`);
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      // Same reasoning as handleGoogleSignIn — clear any leftover Supabase
      // session from a previous account before establishing this one.
      await getSupabaseClient().auth.signOut().catch(() => {});
      const res = mode === "login"
        ? await auth.login(email, password)
        : await auth.register(email, password, language);
      setAuth(res.data.access_token, res.data.user_id);
      identifyUser(res.data.user_id);
      if (mode === "register") {
        applyPendingReferralIfAny();
        captureSignupCompleted("email");
      }
      try {
        const p = await profileApi.get();
        setProfile(p.data);
        window.location.href = consumeReturnTo() ?? "/home";
      } catch (err: any) {
        // A 404 here is authoritative — this account genuinely has no profile
        // yet, so it always means onboarding. (Previously this was gated by a
        // global, un-namespaced "nuvos_ob" localStorage flag that stayed set
        // from whichever account last finished onboarding on this device —
        // so creating a second account on the same browser would silently
        // skip onboarding for it too.) Any OTHER error (network, 5xx, token
        // timing) sends to home to avoid showing onboarding to users who
        // already completed it but hit a transient failure — EXCEPT right
        // after a brand-new registration, where there is no "already
        // completed it" case to protect: the account is seconds old, so any
        // error here still means "no profile yet," just like a 404. Bug fix,
        // 2026-09-15: a transient error straight after register() used to
        // send a fresh signup to a profile-less /home with no way back into
        // onboarding from the UI.
        const noProfileYet = err?.response?.status === 404 || mode === "register";
        window.location.href = noProfileYet ? "/onboarding/quick" : "/home";
      }
    } catch (err: unknown) {
      setError(extractErrorMsg(err) || t("landing.checkCredentials"));
    } finally { setLoading(false); }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="w-8 h-8 border-2 border-white/10 border-t-green-400 rounded-full"
             style={{ animation: "spin 0.7s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex relative" style={{ background: "var(--bg)" }}>

      {/* Language toggle */}
      <div className="fixed top-4 right-4 z-20 flex items-center gap-1 rounded-xl border p-1"
           style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
        <button onClick={() => setLanguage("en")}
                className="h-8 px-2.5 flex items-center justify-center rounded-lg text-[11px] font-bold transition-colors"
                style={{
                  background: language === "en" ? "var(--accent)" : "transparent",
                  color: language === "en" ? "#000" : "var(--sub)",
                }}>
          EN🇺🇸
        </button>
        <button onClick={() => setLanguage("es")}
                className="h-8 px-2.5 flex items-center justify-center rounded-lg text-[11px] font-bold transition-colors"
                style={{
                  background: language === "es" ? "var(--accent)" : "transparent",
                  color: language === "es" ? "#000" : "var(--sub)",
                }}>
          ES🇪🇸
        </button>
      </div>

      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="animate-orb absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-[0.06]"
             style={{ background: "radial-gradient(circle, #00e887 0%, transparent 70%)" }} />
        <div className="animate-orb absolute -bottom-60 right-10 w-[700px] h-[700px] rounded-full opacity-[0.04]"
             style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", animationDelay: "3s" }} />
        <div className="animate-orb absolute top-1/2 left-1/3 w-[400px] h-[400px] rounded-full opacity-[0.03]"
             style={{ background: "radial-gradient(circle, #a78bfa 0%, transparent 70%)", animationDelay: "5s" }} />
        <div className="line-grid absolute inset-0 opacity-30" />
      </div>

      {/* ── LEFT PANEL — Value proposition ──────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[54%] flex-col justify-center px-12 xl:px-24 py-8 relative z-10 min-h-screen overflow-y-auto scrollbar-thin">

        {/* Headline spotlight — a soft radial glow anchored behind the hero
            text, independent of the ambient page-wide orbs above, so the
            headline itself reads as the visual focal point of the screen. */}
        <div className="pointer-events-none absolute -left-20 top-[8%] w-[720px] h-[720px] rounded-full opacity-[0.10] blur-[10px]"
             style={{ background: "radial-gradient(circle, #00e887 0%, transparent 65%)" }} />

        <div className="relative max-w-[600px] xl:max-w-[640px]">

          {/* Logo */}
          <div className="flex items-center gap-3 mb-5 animate-fade-in">
            <div className="relative">
              <Image src="/logo.png" alt="Nuvos AI" width={40} height={40}
                     className="rounded-2xl object-cover" style={{ boxShadow: "var(--shadow-accent)" }} />
              <div className="absolute -inset-1 rounded-2xl blur-md opacity-25"
                   style={{ background: "var(--grad-green)" }} />
            </div>
            <div>
              <span className="text-base font-bold" style={{ color: "var(--text)" }}>Nuvos AI</span>
            </div>
          </div>

          {/* Headline */}
          <div className="mb-5 animate-fade-in-up">
            <h1 className="text-[2.3rem] lg:text-[2.6rem] xl:text-[3.4rem] font-black leading-[1.08] tracking-[-0.02em] mb-3"
                style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t("landing.heroLine1")}<br />
              <span className="gradient-text">{t("landing.heroLine2")}</span>
            </h1>
            <p className="text-base leading-relaxed max-w-[480px]" style={{ color: "var(--muted)" }}>
              {t("landing.heroSubtitle")}
            </p>
          </div>

          {/* Social proof bar */}
          <div className="flex items-center gap-0 mb-5 animate-fade-in-up stagger-1">
            {[
              { value: "2,847", label: t("landing.stats.activeInvestors") },
              { value: "4.9 ★", label: t("landing.stats.rating") },
              { value: "< 2 min", label: t("landing.stats.toStart") },
            ].map((stat, i) => (
              <div key={stat.label} className="flex items-center">
                <div className="text-center px-5 first:pl-0">
                  <div className="text-lg font-black tabular-nums"
                       style={{ color: "var(--text)" }}>{stat.value}</div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{stat.label}</div>
                </div>
                {i < 2 && <div className="w-px h-7 shrink-0" style={{ background: "var(--border)" }} />}
              </div>
            ))}
          </div>

          {/* Instant Arthur demo — see askArthurPreview's own comment above
              for why this answers locally instead of calling the real
              backend. Arthur explains, never prescribes a buy/sell — same
              as everywhere else in the app. */}
          <div className="relative rounded-2xl p-3.5 mb-5 overflow-hidden animate-fade-in-up stagger-2"
               style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full opacity-[0.12] blur-2xl"
                 style={{ background: "var(--grad-green)" }} />
            <div className="relative flex items-center gap-2 mb-2.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-l)" }} />
              <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                {t("landing.preview.label")}
              </span>
            </div>

            {!previewUser ? (
              <div className="relative flex flex-wrap gap-1.5 mb-1">
                {[t("landing.preview.suggestion1"), t("landing.preview.suggestion2"), t("landing.preview.suggestion3")].map((s) => (
                  <button key={s} type="button" onClick={() => askArthurPreview(s)}
                          className="text-left rounded-xl px-2.5 py-1.5 text-[12px] transition-colors"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "var(--sub)" }}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="relative flex justify-end mb-1.5">
                  <div className="rounded-2xl rounded-tr-sm px-3 py-1.5 max-w-[75%] text-[12.5px] leading-snug"
                       style={{ background: "rgba(255,255,255,0.05)", color: "var(--text)" }}>
                    {previewUser}
                  </div>
                </div>
                <div className="relative flex items-start gap-2 mb-1">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
                       style={{ background: "rgba(167,139,250,0.14)", border: "1px solid rgba(167,139,250,0.28)" }}>
                    🧠
                  </div>
                  <div className="rounded-2xl rounded-tl-sm px-3 py-2 text-[12.5px] leading-snug min-h-[32px]"
                       style={{ background: "rgba(0,185,109,0.08)", border: "1px solid rgba(0,185,109,0.16)", color: "var(--sub)" }}>
                    {previewReply}
                  </div>
                </div>
              </>
            )}

            <form className="relative flex items-center gap-1.5 mt-2.5"
                  onSubmit={(e) => { e.preventDefault(); askArthurPreview(previewInput); }}>
              <input value={previewInput} onChange={(e) => setPreviewInput(e.target.value)}
                     placeholder={t("landing.preview.placeholder")} disabled={previewTyping}
                     className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[12.5px] outline-none disabled:opacity-50"
                     style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "var(--text)" }} />
              <button type="submit" disabled={previewTyping || !previewInput.trim()}
                      className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center disabled:opacity-40 transition-opacity"
                      style={{ background: "var(--grad-green)" }}>
                <Send className="w-3.5 h-3.5" style={{ color: "#06160f" }} />
              </button>
            </form>
          </div>

          {/* Three pillars — compact 3-up row (icon + title only, full
              description on hover's not needed; the chat preview above
              already demonstrates pillar #1 directly) */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {PILLARS.map((p, i) => (
              <div key={p.title}
                   className={`p-3 rounded-2xl animate-fade-in-up stagger-${i + 2}`}
                   style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base mb-2"
                     style={{ background: p.accent + "1a", border: `1px solid ${p.accent}30` }}>
                  {p.emoji}
                </div>
                <div className="text-[12.5px] font-bold leading-tight" style={{ color: "var(--text)" }}>{p.title}</div>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div className="relative rounded-2xl p-4 pl-5 overflow-hidden animate-fade-in-up stagger-4"
               style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "var(--grad-green)" }} />
            <span className="absolute -top-2 left-4 text-5xl font-black leading-none select-none"
                  style={{ color: "var(--accent)", opacity: 0.18, fontFamily: "Georgia, serif" }}>&ldquo;</span>
            <div className="flex gap-1 mb-2">
              {"★★★★★".split("").map((s, i) => (
                <span key={i} className="text-xs" style={{ color: "#f59e0b" }}>{s}</span>
              ))}
            </div>
            <p className="text-[13px] italic leading-relaxed mb-2.5" style={{ color: "var(--muted)" }}>
              &quot;{t("landing.testimonial")}&quot;
            </p>
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                   style={{ background: "rgba(0,168,94,0.2)", color: "var(--accent-l)" }}>D</div>
              <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.35)" }}>
                {t("landing.testimonialAuthor")}
              </span>
            </div>
          </div>

        </div>
      </div>

      {/* ── RIGHT PANEL — Auth form ──────────────────────────────────────── */}
      <div className="w-full lg:w-[46%] flex items-start justify-center overflow-y-auto p-5 lg:p-12 min-h-screen relative z-10">
        {/* Ambient halo behind the form card — purely decorative, sits behind
            everything in this column and never affects the card's own
            markup/classes/position below (kept exactly as-is per Diego's
            brief). */}
        <div className="hidden lg:block pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-[0.07] blur-[60px]"
             style={{ background: "var(--grad-green)" }} />
        <div className="w-full max-w-[400px] my-auto py-8 relative">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 animate-fade-in">
            <Image src="/logo.png" alt="Nuvos AI" width={38} height={38} className="rounded-xl object-cover" />
            <div>
              <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
            </div>
          </div>

          {/* Mobile value prop */}
          <div className="lg:hidden mb-8 animate-fade-in-up">
            <h1 className="text-3xl font-black leading-tight tracking-tight mb-2"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              <span style={{ color: "var(--text)" }}>{t("landing.heroLine1")}<br /></span>
              <span className="gradient-text">{t("landing.heroLine2")}</span>
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {t("landing.heroSubtitle")}
            </p>
          </div>

          {/* Existing session banner */}
          {existingUserName && (
            <div className="mb-4 rounded-2xl p-4 flex items-center justify-between gap-3 animate-fade-in-up"
                 style={{ background: "rgba(0,168,94,0.08)", border: "1px solid rgba(0,168,94,0.18)" }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                     style={{ background: "rgba(0,168,94,0.15)" }}>
                  <User className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest"
                     style={{ color: "var(--accent-l)", opacity: 0.7 }}>{t("landing.activeSession")}</p>
                  <p className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>{existingUserName}</p>
                </div>
              </div>
              <button onClick={() => router.push("/home")}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold"
                      style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>
                {t("landing.continue")} <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* ── FORM CARD ────────────────────────────────────────────────── */}
          <div className="glass rounded-3xl p-7 animate-fade-in-up"
               style={{ border: "1px solid rgba(255,255,255,0.07)" }}>

            {mode === "welcome" ? (
              /* ── BIENVENIDA (Stage D) — título + 3 acciones, sin formulario ── */
              <div className="py-2">
                <h1 className="text-2xl font-black tracking-tight mb-2"
                    style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {t("landing.welcomeTitle")}
                </h1>
                <p className="text-sm mb-7" style={{ color: "var(--muted)" }}>
                  {t("landing.welcomeSubtitle")}
                </p>
                <div className="space-y-2.5">
                  <button type="button" onClick={() => setMode("goal")}
                          className="btn-primary w-full flex items-center justify-center gap-2">
                    {t("landing.welcomeCtaStart")} <ArrowRight className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setMode("login")}
                          className="w-full py-3 rounded-2xl text-sm font-bold transition-opacity hover:opacity-80"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--text)" }}>
                    {t("landing.welcomeCtaLogin")}
                  </button>
                  <button type="button"
                          onClick={() => enterGuestMode().finally(() => router.push("/chat"))}
                          className="w-full py-2.5 rounded-2xl text-xs font-semibold text-center transition-opacity hover:opacity-80"
                          style={{ color: "var(--muted)" }}>
                    {t("landing.welcomeCtaExplore")}
                  </button>
                </div>
              </div>
            ) : mode === "forgot" ? (
              /* ── FORGOT PASSWORD ── */
              forgotDone ? (
                <div className="text-center py-4 space-y-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto"
                       style={{ background: "rgba(34,197,94,0.12)" }}>
                    <span className="text-2xl">✓</span>
                  </div>
                  <h2 className="text-xl font-black" style={{ color: "var(--text)" }}>{t("landing.passwordUpdated")}</h2>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>{t("landing.passwordUpdatedBody")}</p>
                  <button onClick={() => { setMode("login"); setForgotStep("email"); setForgotDone(false); setError(""); }}
                          className="btn-primary w-full mt-2">{t("landing.login")}</button>
                </div>
              ) : (
                <>
                  <button onClick={() => { setMode("login"); setForgotStep("email"); setError(""); }}
                          className="flex items-center gap-2 text-sm mb-6 transition-opacity hover:opacity-70"
                          style={{ color: "var(--muted)" }}>{t("landing.back")}</button>
                  <h2 className="text-xl font-black tracking-tight mb-1"
                      style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {forgotStep === "email" ? t("landing.forgotPasswordTitle") : forgotStep === "code" ? t("landing.verifyYour", { channel: t("landing.email") }) : t("landing.newPassword")}
                  </h2>
                  <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
                    {forgotStep === "email"
                      ? t("landing.chooseVerificationMethod")
                      : forgotStep === "code"
                      ? t("landing.codeSentTo", { destination: forgotEmail })
                      : t("landing.choosePassword")}
                  </p>
                  <form onSubmit={handleForgotSubmit} className="space-y-4">
                    {forgotStep === "email" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>{t("landing.emailLabel")}</label>
                        <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                               className="input-premium" placeholder="tu@email.com" required autoFocus />
                      </div>
                    )}
                    {forgotStep === "code" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>{t("landing.verificationCode")}</label>
                        <input type="text"
                               value={forgotCode}
                               onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                               className="input-premium text-center text-2xl tracking-[0.5em] font-black"
                               placeholder="000000" required maxLength={6} autoFocus />
                        <div className="flex items-center justify-center mt-3 gap-2">
                          {resendCooldown > 0 ? (
                            <span className="text-xs" style={{ color: "var(--muted)" }}>
                              {t("landing.resendIn")} <span className="font-bold tabular-nums" style={{ color: "var(--accent-l)" }}>{resendCooldown}s</span>
                            </span>
                          ) : (
                            <button type="button" onClick={handleResend} disabled={loading}
                                    className="text-xs font-semibold transition-opacity hover:opacity-70 disabled:opacity-40"
                                    style={{ color: "var(--accent-l)" }}>
                              {t("landing.resendCode")}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    {forgotStep === "newpass" && (
                      <div>
                        <label className="block text-xs font-semibold mb-2 uppercase tracking-wider"
                               style={{ color: "var(--muted)" }}>{t("landing.newPasswordLabel")}</label>
                        <input type="password" value={forgotNewPass} onChange={(e) => setForgotNewPass(e.target.value)}
                               className="input-premium" placeholder={t("landing.min6Chars")} required minLength={10} autoFocus />
                      </div>
                    )}
                    {error && (
                      <div className="rounded-xl px-4 py-3 text-sm animate-fade-in"
                           style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
                        {error}
                      </div>
                    )}
                    <button type="submit"
                            disabled={loading
                              || (forgotStep === "email" && !forgotEmail)
                              || (forgotStep === "code" && forgotCode.length < 6)
                              || (forgotStep === "newpass" && forgotNewPass.length < 6)}
                            className="btn-primary w-full flex items-center justify-center gap-2">
                      {loading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                             style={{ animation: "spin 0.7s linear infinite" }} />
                      ) : (
                        <>{forgotStep === "email" ? t("landing.sendCode") : forgotStep === "code" ? t("landing.verify") : t("landing.updatePassword")} <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </form>
                </>
              )
            ) : mode === "goal" ? (
              /* ── PERSONALIZACIÓN (una sola pregunta antes del registro) ── */
              <>
                <button onClick={() => { setMode("login"); setError(""); }}
                        className="flex items-center gap-2 text-sm mb-6 transition-opacity hover:opacity-70"
                        style={{ color: "var(--muted)" }}>{t("landing.goalBack")}</button>
                <h2 className="text-xl font-black tracking-tight mb-5"
                    style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {t("landing.goalTitle")}
                </h2>
                <div className="space-y-3">
                  {([
                    { key: "portfolio" as const, label: t("landing.goalOptionPortfolio"), Icon: PieChart },
                    { key: "company" as const, label: t("landing.goalOptionCompany"), Icon: Search },
                    { key: "etf" as const, label: t("landing.goalOptionEtf"), Icon: ListChecks },
                  ]).map(({ key, label, Icon }) => (
                    <button key={key} type="button" onClick={() => handleGoalSelect(key)}
                            className="w-full flex items-center gap-3 p-4 rounded-2xl text-left transition-all hover:opacity-90"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                           style={{ background: "rgba(0,168,94,0.12)" }}>
                        <Icon className="w-4.5 h-4.5" style={{ color: "var(--accent-l)" }} />
                      </div>
                      <span className="text-sm font-bold" style={{ color: "var(--text)" }}>{label}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : mode === "preview" ? (
              /* ── VISTA PREVIA (Empresa/ETF) — ejemplo real curado dentro
                  del onboarding, nunca modo invitado real ── */
              <>
                <button onClick={() => { setMode("goal"); setError(""); }}
                        className="flex items-center gap-2 text-sm mb-5 transition-opacity hover:opacity-70"
                        style={{ color: "var(--muted)" }}>{t("landing.goalBack")}</button>

                {previewLoading && !previewCompany && !previewEtf ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-7 h-7 border-2 border-white/10 border-t-green-400 rounded-full" style={{ animation: "spin 0.7s linear infinite" }} />
                  </div>
                ) : previewError && !previewCompany && !previewEtf ? (
                  <div className="py-8">
                    <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>{t("landing.previewError")}</p>
                    <button onClick={() => setMode("register")} className="btn-primary w-full">{t("landing.previewContinue")}</button>
                  </div>
                ) : goal === "company" && previewCompany ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
                      {t("landing.previewCompanyEyebrow")}
                    </p>
                    <div className="rounded-2xl p-5 mb-5" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-lg font-black" style={{ color: "var(--text)" }}>{previewCompany.ticker}</span>
                        {previewCompany.price != null && (
                          <span className="text-sm font-bold" style={{ color: "var(--text)" }}>${previewCompany.price.toFixed(2)}</span>
                        )}
                      </div>
                      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>{previewCompany.company_name}</p>
                      {previewCompany.margin_of_safety_pct != null && (
                        <p className="text-xs font-bold mb-3" style={{ color: previewCompany.margin_of_safety_pct > 0 ? "#34d399" : "#f87171" }}>
                          {previewCompany.margin_of_safety_pct > 0
                            ? t("landing.previewUndervalued", { pct: Math.abs(previewCompany.margin_of_safety_pct).toFixed(0) })
                            : t("landing.previewOvervalued", { pct: Math.abs(previewCompany.margin_of_safety_pct).toFixed(0) })}
                        </p>
                      )}
                      <p className="text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>{previewCompany.summary}</p>
                    </div>
                    <button onClick={() => setMode("register")} className="btn-primary w-full">{t("landing.previewCtaCompany")}</button>
                  </>
                ) : goal === "etf" && previewEtf ? (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--muted)" }}>
                      {t("landing.previewEtfEyebrow")}
                    </p>
                    <div className="rounded-2xl p-5 mb-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)" }}>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-lg font-black" style={{ color: "var(--text)" }}>{previewEtf.ticker}</span>
                        {previewEtf.expense_ratio_pct != null && (
                          <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{t("landing.previewExpenseRatio", { pct: previewEtf.expense_ratio_pct.toFixed(2) })}</span>
                        )}
                      </div>
                      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>{previewEtf.name}</p>
                      {previewEtf.top_sector_name && previewEtf.top_sector_pct != null && (
                        <p className="text-[13px] mb-2" style={{ color: "var(--sub)" }}>
                          {t("landing.previewTopSector", { sector: previewEtf.top_sector_name, pct: previewEtf.top_sector_pct.toFixed(0) })}
                        </p>
                      )}
                      {previewEtf.insight && (
                        <p className="text-[13px] leading-relaxed" style={{ color: "var(--sub)" }}>{previewEtf.insight}</p>
                      )}
                    </div>
                    <button onClick={() => { setPreviewLoading(false); setPreviewEtf(null); setPreviewEtfIndex((i) => (i + 1) % PREVIEW_ETF_TICKERS.length); }}
                            className="w-full py-2.5 mb-3 rounded-xl text-xs font-semibold text-center transition-opacity hover:opacity-80"
                            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                      {t("landing.previewSeeAnother")}
                    </button>
                    <button onClick={() => setMode("register")} className="btn-primary w-full">{t("landing.previewCtaEtf")}</button>
                  </>
                ) : (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-7 h-7 border-2 border-white/10 border-t-green-400 rounded-full" style={{ animation: "spin 0.7s linear infinite" }} />
                  </div>
                )}
              </>
            ) : (
              /* ── LOGIN / REGISTER ── */
              <>
                {/* Form heading — contextual to the chosen goal in register
                    mode, instead of a generic "Empieza hoy" with no
                    explanation of why an account is needed right now
                    (Diego: "no te dice nada, solo te muestra la caja"). */}
                <div className="mb-6">
                  <h2 className="text-xl font-black tracking-tight mb-1"
                      style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                    {mode === "login" ? t("landing.welcomeBack") :
                     goal === "etf" ? t("landing.registerHeadingEtf") :
                     goal === "portfolio" ? t("landing.registerHeadingPortfolio") :
                     t("landing.startTodayFree")}
                  </h2>
                  <p className="text-sm" style={{ color: "var(--muted)" }}>
                    {mode === "login" ? t("landing.accessYourMentor") :
                     goal === "etf" ? t("landing.registerSubtitleEtf") :
                     goal === "portfolio" ? t("landing.registerSubtitlePortfolio") :
                     t("landing.noCreditCard")}
                  </p>
                </div>

                {/* GOOGLE — primary CTA */}
                <button type="button" onClick={handleGoogleSignIn} disabled={loading}
                        className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl text-sm font-bold transition-all duration-200 disabled:opacity-50 mb-4"
                        style={{
                          background: "rgba(0,168,94,0.08)",
                          border: "1px solid rgba(0,168,94,0.28)",
                          color: "var(--text)",
                        }}>
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  {mode === "register" ? t("landing.startFreeWithGoogle") : t("landing.continueWithGoogle")}
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                  <span className="text-xs" style={{ color: "var(--dim)" }}>{t("landing.orWithEmail")}</span>
                  <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
                </div>

                {/* Email form */}
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                         className="input-premium" placeholder="tu@email.com" required autoComplete="email" />

                  <div className="relative">
                    <input type={showPass ? "text" : "password"}
                           value={password} onChange={(e) => setPassword(e.target.value)}
                           className="input-premium pr-11"
                           placeholder={mode === "register" ? t("landing.createPasswordPlaceholder") : t("landing.passwordLabel")}
                           required minLength={mode === "register" ? 10 : 1} autoComplete={mode === "register" ? "new-password" : "current-password"} />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg transition-colors"
                            style={{ color: "var(--muted)" }}>
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {mode === "login" && (
                    <div className="text-right -mt-1">
                      <button type="button"
                              onClick={() => { setMode("forgot"); setForgotEmail(email); setForgotStep("email"); setError(""); }}
                              className="text-xs transition-opacity hover:opacity-70"
                              style={{ color: "var(--accent-l)" }}>
                        {t("landing.forgotPassword")}
                      </button>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-xl px-4 py-3 text-sm animate-fade-in"
                         style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading || !email || !password}
                          className="btn-primary w-full flex items-center justify-center gap-2 !mt-4">
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
                           style={{ animation: "spin 0.7s linear infinite" }} />
                    ) : (
                      <>{mode === "login" ? t("landing.login") : t("landing.createAccount")} <ArrowRight className="w-4 h-4" /></>
                    )}
                  </button>
                </form>

                {/* Switch mode */}
                <p className="text-center text-sm mt-5" style={{ color: "var(--muted)" }}>
                  {mode === "login" ? (
                    <>{t("landing.newHere")}{" "}
                      <button onClick={() => { setMode("goal"); setError(""); }}
                              className="font-bold transition-opacity hover:opacity-80"
                              style={{ color: "var(--accent-l)" }}>
                        {t("landing.createFreeAccount")}
                      </button>
                    </>
                  ) : (
                    <>{t("landing.alreadyHaveAccount")}{" "}
                      <button onClick={() => { setMode("login"); setError(""); }}
                              className="font-bold transition-opacity hover:opacity-80"
                              style={{ color: "var(--accent-l)" }}>
                        {t("landing.loginArrow")}
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
          </div>

          {/* Low-friction entry points — not on "welcome", which already has
              its own explore/login actions right above (no duplicates). */}
          {mode !== "forgot" && mode !== "welcome" && mode !== "preview" && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => { localStorage.setItem("nuvos_ob", "1"); setEmail("demo@nuvosai.app"); setPassword("demo1234"); setMode("login"); }}
                      className="text-xs py-2.5 rounded-xl text-center transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                {t("landing.viewDemoAccount")}
              </button>
              <button onClick={() => enterGuestMode().finally(() => router.push("/chat"))}
                      className="text-xs py-2.5 rounded-xl text-center transition-all hover:opacity-80"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--muted)" }}>
                {t("landing.exploreWithoutAccount")}
              </button>
            </div>
          )}

          {/* Trust + Legal */}
          <p className="text-center text-[11px] mt-4 leading-relaxed animate-fade-in"
             style={{ color: "var(--dim)" }}>
            🔐 {t("landing.dataNeverSold")}{" "}
            <a href="/terms" className="hover:opacity-80 transition-opacity underline" style={{ color: "var(--muted)" }}>{t("landing.terms")}</a>
            {" "}{t("landing.and")}{" "}
            <a href="/privacy" className="hover:opacity-80 transition-opacity underline" style={{ color: "var(--muted)" }}>{t("landing.privacy")}</a>
          </p>

        </div>
      </div>
    </div>
  );
}
