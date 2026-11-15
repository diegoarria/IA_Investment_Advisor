"use client";

// Stage C of the onboarding 2.0 redesign: the one mandatory screen between
// "account created" and the product, replacing the old 6-step wizard
// (app/onboarding/page.tsx, left in place and untouched — still reachable
// directly, just no longer where a fresh signup is sent). Name, phone,
// investment goal and market perception all become OPTIONAL personalization
// collected later (Home/Perfil), not part of the required path — see the
// onboarding-2-0 design doc, section 9. Only two things stay mandatory here,
// because they're real eligibility/compliance requirements, not UX
// questions: birth date (18+ gate) and the legal consent checkboxes — same
// copy, same two checkboxes, same terms_accepted_at/terms_version evidence
// the old wizard captured, just not spread across 6 screens anymore.
//
// Backend caveat (documented, not fixed here — see design doc risk #10):
// none of this is enforced server-side. POST /profile accepts birth_date
// and terms_accepted_at/terms_version as plain optional fields with no
// validation at all. This screen is the only real gate today; a modified
// client could skip it entirely. Enforcing age/consent server-side is a
// backend change this stage deliberately does not improvise.
//
// 2026-11-15 (Diego): added 3 sub-steps before the legal step — ¿tienes
// portafolio?, conectarlo (si aplica), horizonte de inversión. The connect
// sub-step reuses the exact same real mechanisms Portfolio already has
// (BrokerConnectModal, EmailImportCard, marketApi.analyzeScreenshot) —
// nothing new was invented, just surfaced earlier in the funnel. A
// broker/email/screenshot action here works even though the profile row
// doesn't exist yet: those write to brokerage_connections/user_portfolio
// keyed by the Supabase user_id, which already exists once registered.

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { Upload, PlayCircle, X as XIcon } from "lucide-react";
import { profile as profileApi, market as marketApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useChatStore, useLanguageStore, useSubscriptionStore } from "@/lib/store";
import { usePortfolioStore } from "@/lib/portfolioStore";
import { readOnboardingGoal, clearOnboardingGoal, checkOnboardingActivation } from "@/lib/onboardingAnalytics";
import BrokerConnectModal from "@/components/BrokerConnectModal";
import EmailImportCard from "@/components/EmailImportCard";

const TERMS_VERSION = "2026-11-quick";
const TUTORIAL_VIDEO_URL = "https://www.youtube.com/embed/IMVv5gdsdh4?autoplay=1&rel=0";

type QuickSub = "basics" | "portfolioQ" | "brokerConnect" | "horizonQ" | "legal";
const SUB_ORDER: QuickSub[] = ["basics", "portfolioQ", "brokerConnect", "horizonQ", "legal"];

type ExtractedPos = { ticker: string; name: string; shares: number | null; avg_price: number };

export default function OnboardingQuickPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { setProfile } = useProfileStore();
  const { isAuthenticated, authRestoring, userId } = useAuthStore();
  const { language } = useLanguageStore();
  const addPosition = usePortfolioStore((s) => s.addPosition);

  const MONTHS = t("onboarding.months", { returnObjects: true }) as string[];

  const [sub, setSub] = useState<QuickSub>("basics");
  const [name, setName] = useState("");
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [hasPortfolio, setHasPortfolio] = useState<boolean | null>(null);
  const [horizon, setHorizon] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ── Ruta portafolio: conectar ya mismo ──────────────────────────────────
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotPreview, setScreenshotPreview] = useState<ExtractedPos[] | null>(null);
  const [screenshotMsg, setScreenshotMsg] = useState("");
  const [connectedCount, setConnectedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!authRestoring && !isAuthenticated) router.push("/"); }, [isAuthenticated, authRestoring]);

  // Same "already has a profile → never show this again" guard the old
  // wizard had, for anyone who lands here with a profile that already
  // exists (double-tap, back button, a stale bookmark of this URL).
  useEffect(() => {
    profileApi.get()
      .then(() => {
        const destination = destinationForGoal(readOnboardingGoal());
        clearOnboardingGoal();
        window.location.href = destination;
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (authRestoring) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }} />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const birthDateValid = (() => {
    const d = parseInt(day), m = parseInt(month), y = parseInt(year);
    if (!d || !m || !y) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    const ageMs = Date.now() - dt.getTime();
    return ageMs >= 18 * 365.25 * 86_400_000 && ageMs <= 90 * 365.25 * 86_400_000;
  })();
  const birthDateStr = birthDateValid ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : "";
  const canSubmit = birthDateValid && acceptedTerms && acceptedDisclaimer && !loading;

  const handleScreenshotFile = useCallback(async (file: File) => {
    setScreenshotAnalyzing(true);
    setScreenshotPreview(null);
    setScreenshotMsg("");
    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });
      const res = await marketApi.analyzeScreenshot(base64, file.type || "image/jpeg", "USD");
      const positions: ExtractedPos[] = res.data.positions || [];
      if (!positions.length) {
        setScreenshotMsg(t("onboardingQuick.importNoneFound"));
      } else {
        setScreenshotPreview(positions);
      }
    } catch {
      setScreenshotMsg(t("onboardingQuick.importScanError"));
    } finally {
      setScreenshotAnalyzing(false);
    }
  }, [t]);

  const confirmImportedPositions = () => {
    if (!screenshotPreview) return;
    screenshotPreview.forEach((p) => {
      if (p.shares && p.shares > 0) {
        addPosition({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avg_price || 0 });
      }
    });
    setConnectedCount((c) => c + screenshotPreview.length);
    setScreenshotPreview(null);
    setHasPortfolio(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true); setError("");

    const payload: Record<string, unknown> = {
      ...(name.trim() ? { name: name.trim() } : {}),
      birth_date: birthDateStr,
      terms_accepted_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
      language,
    };
    if (horizon) payload.investment_horizon = horizon;
    if (hasPortfolio) { payload.has_broker = true; payload.has_investments = true; }

    // Same retry-on-transient-failure pattern as the old wizard — this is
    // still the single most important write in the app (no row, no trial).
    const attempt = async (n: number): ReturnType<typeof profileApi.create> => {
      try {
        return await profileApi.create(payload);
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        const isDefinitive = status !== undefined && status !== 503 && status !== 429;
        if (!isDefinitive && n < 2) {
          await new Promise((r) => setTimeout(r, 800 * (n + 1)));
          return attempt(n + 1);
        }
        throw err;
      }
    };

    try {
      const res = await attempt(0);
      setProfile(res.data);
      useSubscriptionStore.getState().fetchStatus();

      const goal = readOnboardingGoal();
      const genericName = language === "en" ? "Investor" : "Inversor";
      const _welcomeMsg = t("onboarding.welcome.messageNoGoal", { name: name.trim() || genericName });
      const _chat = useChatStore.getState();
      _chat.createSession();
      _chat.addMessage({ role: "assistant", content: _welcomeMsg });

      checkOnboardingActivation();

      try {
        localStorage.setItem("nuvos_ob", "1");
        localStorage.removeItem(`onboarding_draft__${userId || "guest"}`);
      } catch { /* cosmetic only — the save already succeeded */ }

      // Ya conectó/importó algo real arriba → lo mandamos directo a
      // Distribución en vez del destino genérico del goal original.
      const destination = connectedCount > 0 ? "/portfolio" : destinationForGoal(goal);
      clearOnboardingGoal();
      window.location.href = destination;
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]?.msg ?? "") : "";
      setError(msg || t("onboardingQuick.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const subDots = (
    <div className="flex gap-1.5 mb-6">
      {SUB_ORDER.map((s, i) => {
        const curIdx = SUB_ORDER.indexOf(sub);
        return <div key={s} className="h-[3px] flex-1 rounded-full" style={{ background: i === curIdx ? "var(--accent)" : i < curIdx ? "rgba(0,185,109,0.35)" : "var(--border)" }} />;
      })}
    </div>
  );

  return (
    <div className="h-screen overflow-y-auto flex items-start justify-center p-5 py-10" style={{ background: "var(--bg)" }}>
      <div className="glass w-full max-w-[460px] rounded-3xl p-7 my-auto" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        {subDots}

        {sub === "basics" && (
          <>
            <h1 className="text-xl font-black tracking-tight mb-1" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t("onboardingQuick.title")}
            </h1>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{t("onboardingQuick.subtitle")}</p>
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                  {t("onboardingQuick.nameLabel")}
                </label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                       placeholder={t("onboardingQuick.namePlaceholder")}
                       className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                       style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
                  {t("onboardingQuick.birthDateLabel")}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <select value={day} onChange={(e) => setDay(e.target.value)}
                          className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: day ? "var(--text)" : "var(--muted)" }}>
                    <option value="">{t("onboarding.step0.day")}</option>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={String(d)}>{d}</option>)}
                  </select>
                  <select value={month} onChange={(e) => setMonth(e.target.value)}
                          className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: month ? "var(--text)" : "var(--muted)" }}>
                    <option value="">{t("onboarding.step0.month")}</option>
                    {MONTHS.map((m, i) => <option key={i + 1} value={String(i + 1)}>{m}</option>)}
                  </select>
                  <select value={year} onChange={(e) => setYear(e.target.value)}
                          className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                          style={{ background: "var(--raised)", borderColor: "var(--border)", color: year ? "var(--text)" : "var(--muted)" }}>
                    <option value="">{t("onboarding.step0.year")}</option>
                    {Array.from({ length: 73 }, (_, i) => (new Date().getFullYear() - 18) - i).map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
                <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>{t("onboardingQuick.birthDateHint")}</p>
              </div>
              <button onClick={() => setSub("portfolioQ")} disabled={!birthDateValid} className="btn-primary w-full">
                {t("onboardingQuick.continueButton")}
              </button>
            </div>
          </>
        )}

        {sub === "portfolioQ" && (
          <>
            <h1 className="text-xl font-black tracking-tight mb-1" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t("onboardingQuick.portfolioQTitle")}
            </h1>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{t("onboardingQuick.portfolioQSubtitle")}</p>
            <div className="space-y-2.5">
              <button onClick={() => { setHasPortfolio(true); setSub("brokerConnect"); }}
                      className="w-full text-left rounded-2xl p-4" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                <span className="block text-sm font-bold" style={{ color: "var(--text)" }}>{t("onboardingQuick.portfolioYes")}</span>
                <span className="block text-xs mt-0.5" style={{ color: "var(--muted)" }}>{t("onboardingQuick.portfolioYesHint")}</span>
              </button>
              <button onClick={() => { setHasPortfolio(false); setSub("horizonQ"); }}
                      className="w-full text-left rounded-2xl p-4" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                <span className="block text-sm font-bold" style={{ color: "var(--text)" }}>{t("onboardingQuick.portfolioNo")}</span>
                <span className="block text-xs mt-0.5" style={{ color: "var(--muted)" }}>{t("onboardingQuick.portfolioNoHint")}</span>
              </button>
            </div>
          </>
        )}

        {sub === "brokerConnect" && (
          <>
            <button onClick={() => setSub("portfolioQ")} className="text-xs font-bold mb-4" style={{ color: "var(--muted)" }}>{t("landing.goalBack")}</button>
            <h1 className="text-lg font-black tracking-tight mb-1" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t("onboardingQuick.brokerConnectTitle")}
            </h1>
            <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>{t("onboardingQuick.brokerConnectSubtitle")}</p>

            {connectedCount > 0 && (
              <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: "rgba(0,185,109,0.08)", border: "1px solid rgba(0,185,109,0.25)", color: "var(--accent-l)" }}>
                ✓ {t("onboardingQuick.importedCount", { count: connectedCount })}
              </div>
            )}

            {screenshotPreview ? (
              <div className="rounded-2xl p-4 mb-4" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-bold mb-3" style={{ color: "var(--text)" }}>{t("onboardingQuick.importFoundCount", { count: screenshotPreview.length })}</p>
                <div className="space-y-2 mb-4">
                  {screenshotPreview.map((p, i) => (
                    <div key={`${p.ticker}-${i}`} className="flex justify-between text-sm">
                      <span style={{ color: "var(--text)" }}>{p.ticker} · {p.shares ?? "?"} acc.</span>
                      <span style={{ color: "var(--muted)" }}>${(p.avg_price || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <button onClick={confirmImportedPositions} className="btn-primary w-full">
                  {t("onboardingQuick.confirmImport", { count: screenshotPreview.length })}
                </button>
              </div>
            ) : (
              <>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScreenshotFile(f); }} />
                <button onClick={() => fileInputRef.current?.click()} disabled={screenshotAnalyzing}
                        className="btn-primary w-full flex items-center justify-center gap-2 mb-2">
                  <Upload className="w-4 h-4" />
                  {screenshotAnalyzing ? t("onboardingQuick.importAnalyzing") : t("onboardingQuick.importScreenshotCta")}
                </button>
                {screenshotMsg && <p className="text-xs mb-2" style={{ color: "#f87171" }}>{screenshotMsg}</p>}
                <button onClick={() => setTutorialOpen(true)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 mb-4 text-xs font-semibold" style={{ color: "var(--accent-l)" }}>
                  <PlayCircle className="w-3.5 h-3.5" />{t("onboardingQuick.watchTutorial")}
                </button>

                <EmailImportCard />

                <p className="text-[11px] font-bold uppercase tracking-wider mt-5 mb-2" style={{ color: "var(--muted)" }}>{t("onboardingQuick.orConnectDirect")}</p>
                <button onClick={() => setBrokerModalOpen(true)} className="btn-ghost w-full rounded-xl py-3 text-sm font-bold mb-4"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)", color: "var(--text)" }}>
                  {t("brokerConnectModal.title")}
                </button>
              </>
            )}

            <button onClick={() => setSub("horizonQ")} className="w-full text-center text-xs font-semibold py-2" style={{ color: "var(--dim)" }}>
              {t("onboardingQuick.skipForNow")}
            </button>
          </>
        )}

        {sub === "horizonQ" && (
          <>
            <h1 className="text-xl font-black tracking-tight mb-1" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t("onboardingQuick.horizonTitle")}
            </h1>
            <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{t("onboardingQuick.horizonSubtitle")}</p>
            <div className="space-y-2.5">
              {[
                { v: "0.5", label: t("onboardingQuick.horizonShort") },
                { v: "3", label: t("onboardingQuick.horizonMedium") },
                { v: "10", label: t("onboardingQuick.horizonLong") },
              ].map((o) => (
                <button key={o.v} onClick={() => { setHorizon(o.v); setSub("legal"); }}
                        className="w-full text-left rounded-2xl p-4 text-sm font-bold" style={{ background: "var(--raised)", border: "1px solid var(--border)", color: "var(--text)" }}>
                  {o.label}
                </button>
              ))}
            </div>
          </>
        )}

        {sub === "legal" && (
          <>
            <h1 className="text-xl font-black tracking-tight mb-1" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {t("onboardingQuick.title")}
            </h1>
            <div className="space-y-5">
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "rgba(245,158,11,0.3)" }}>
                <div className="px-3 py-2 flex items-center gap-2" style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
                  <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>⚠️ {t("onboarding.legal.bannerTitle")}</span>
                </div>
                <div className="overflow-y-auto px-4 py-4 space-y-4 text-xs leading-relaxed" style={{ maxHeight: 200, color: "var(--sub)" }}>
                  <div>
                    <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section1.title")}</p>
                    <p>{t("onboarding.legal.section1.body1")} <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.section1.notEmphasis")}</strong>{" "}{t("onboarding.legal.section1.body2")}</p>
                  </div>
                  <div><p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section2.title")}</p><p>{t("onboarding.legal.section2.body")}</p></div>
                  <div>
                    <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section3.title")}</p>
                    <p>{t("onboarding.legal.section3.body1")}{" "}<strong style={{ color: "var(--text)" }}>{t("onboarding.legal.section3.responsibilityEmphasis")}</strong>.</p>
                  </div>
                  <div><p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section4.title")}</p><p>{t("onboarding.legal.section4.body")}</p></div>
                  <div><p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section5.title")}</p><p>{t("onboarding.legal.section5.body")}</p></div>
                  <div>
                    <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section6.title")}</p>
                    <p>{t("onboarding.legal.section6.body")}{" "}<a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>{t("onboarding.legal.privacyNoticeLink")}</a>.</p>
                  </div>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                     style={{ borderColor: acceptedTerms ? "var(--accent)" : "var(--border)", background: acceptedTerms ? "var(--accent)" : "transparent" }}
                     onClick={() => setAcceptedTerms((v) => !v)}>
                  {acceptedTerms && <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                  {t("onboarding.legal.acceptTermsPrefix")}{" "}
                  <a href="/terms" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>{t("onboarding.legal.termsLink")}</a>
                  {" "}{t("onboarding.legal.and")}{" "}
                  <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>{t("onboarding.legal.privacyLink")}</a>.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                     style={{ borderColor: acceptedDisclaimer ? "var(--accent)" : "var(--border)", background: acceptedDisclaimer ? "var(--accent)" : "transparent" }}
                     onClick={() => setAcceptedDisclaimer((v) => !v)}>
                  {acceptedDisclaimer && <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
                  {t("onboarding.legal.understandPrefix")}{" "}
                  <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.understandEmphasis")}</strong>
                  {t("onboarding.legal.understandSuffix")}
                </span>
              </label>

              {error && (
                <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>{error}</div>
              )}

              <button onClick={handleSubmit} disabled={!canSubmit} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" style={{ animation: "spin 0.7s linear infinite" }} /> : t("onboardingQuick.continueButton")}
              </button>
            </div>
          </>
        )}
      </div>

      {brokerModalOpen && (
        <BrokerConnectModal
          onClose={() => setBrokerModalOpen(false)}
          onPositionsImported={(positions) => {
            positions.forEach((p) => { if (p.shares > 0) addPosition({ ticker: p.ticker, name: p.name, shares: p.shares, avgPrice: p.avgPrice }); });
            setConnectedCount((c) => c + positions.length);
            setBrokerModalOpen(false);
          }}
        />
      )}

      {tutorialOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }}>
          <div className="w-full max-w-[480px] rounded-2xl overflow-hidden relative" style={{ background: "var(--bg)", border: "1px solid var(--border)" }}>
            <button onClick={() => setTutorialOpen(false)} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
              <XIcon className="w-4 h-4 text-white" />
            </button>
            <iframe src={TUTORIAL_VIDEO_URL} className="w-full aspect-video block" allow="autoplay; encrypted-media" allowFullScreen />
          </div>
        </div>
      )}
    </div>
  );
}

function destinationForGoal(goal: ReturnType<typeof readOnboardingGoal>): string {
  if (goal === "company") return "/subvaluadas";
  if (goal === "etf") return "/etf";
  if (goal === "portfolio") return "/portfolio";
  return "/home";
}
