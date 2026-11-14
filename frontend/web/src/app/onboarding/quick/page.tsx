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

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useChatStore, useLanguageStore, useSubscriptionStore } from "@/lib/store";
import { readOnboardingGoal, clearOnboardingGoal, checkOnboardingActivation } from "@/lib/onboardingAnalytics";

const TERMS_VERSION = "2026-11-quick";

export default function OnboardingQuickPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { setProfile } = useProfileStore();
  const { isAuthenticated, authRestoring, userId } = useAuthStore();
  const { language } = useLanguageStore();

  const MONTHS = t("onboarding.months", { returnObjects: true }) as string[];

  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true); setError("");

    const payload = {
      birth_date: birthDateStr,
      terms_accepted_at: new Date().toISOString(),
      terms_version: TERMS_VERSION,
      language,
    };

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
      const _welcomeMsg = t("onboarding.welcome.messageNoGoal", { name: genericName });
      const _chat = useChatStore.getState();
      _chat.createSession();
      _chat.addMessage({ role: "assistant", content: _welcomeMsg });

      checkOnboardingActivation();

      try {
        localStorage.setItem("nuvos_ob", "1");
        localStorage.removeItem(`onboarding_draft__${userId || "guest"}`);
      } catch { /* cosmetic only — the save already succeeded */ }

      const destination = destinationForGoal(goal);
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

  return (
    <div className="min-h-screen flex items-center justify-center p-5" style={{ background: "var(--bg)" }}>
      <div className="glass w-full max-w-[460px] rounded-3xl p-7" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
        <h1 className="text-xl font-black tracking-tight mb-1" style={{ color: "var(--text)", fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {t("onboardingQuick.title")}
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>{t("onboardingQuick.subtitle")}</p>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboardingQuick.birthDateLabel")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <select value={day} onChange={(e) => setDay(e.target.value)}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: day ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.day")}</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
              <select value={month} onChange={(e) => setMonth(e.target.value)}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: month ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.month")}</option>
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={String(i + 1)}>{m}</option>
                ))}
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: year ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.year")}</option>
                {Array.from({ length: 73 }, (_, i) => (new Date().getFullYear() - 18) - i).map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>{t("onboardingQuick.birthDateHint")}</p>
          </div>

          {/* Same legal evidence the old 6-step wizard captured — unchanged
              copy, unchanged two checkboxes, just not its own separate step. */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "rgba(245,158,11,0.3)" }}>
            <div className="px-3 py-2 flex items-center gap-2"
                 style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>
                ⚠️ {t("onboarding.legal.bannerTitle")}
              </span>
            </div>
            <div className="overflow-y-auto px-4 py-4 space-y-4 text-xs leading-relaxed" style={{ maxHeight: 200, color: "var(--sub)" }}>
              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section1.title")}</p>
                <p>
                  {t("onboarding.legal.section1.body1")} <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.section1.notEmphasis")}</strong>{" "}
                  {t("onboarding.legal.section1.body2")}
                </p>
              </div>
              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section2.title")}</p>
                <p>{t("onboarding.legal.section2.body")}</p>
              </div>
              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section3.title")}</p>
                <p>
                  {t("onboarding.legal.section3.body1")}{" "}
                  <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.section3.responsibilityEmphasis")}</strong>.
                </p>
              </div>
              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section4.title")}</p>
                <p>{t("onboarding.legal.section4.body")}</p>
              </div>
              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section5.title")}</p>
                <p>{t("onboarding.legal.section5.body")}</p>
              </div>
              <div>
                <p className="font-bold mb-1" style={{ color: "var(--text)" }}>{t("onboarding.legal.section6.title")}</p>
                <p>
                  {t("onboarding.legal.section6.body")}{" "}
                  <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                    {t("onboarding.legal.privacyNoticeLink")}
                  </a>.
                </p>
              </div>
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                 style={{ borderColor: acceptedTerms ? "var(--accent)" : "var(--border)", background: acceptedTerms ? "var(--accent)" : "transparent" }}
                 onClick={() => setAcceptedTerms((v) => !v)}>
              {acceptedTerms && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
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
              {acceptedDisclaimer && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              {t("onboarding.legal.understandPrefix")}{" "}
              <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.understandEmphasis")}</strong>
              {t("onboarding.legal.understandSuffix")}
            </span>
          </label>

          {error && (
            <div className="rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)", color: "#f87171" }}>
              {error}
            </div>
          )}

          <button onClick={handleSubmit} disabled={!canSubmit}
                  className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full" style={{ animation: "spin 0.7s linear infinite" }} />
            ) : (
              t("onboardingQuick.continueButton")
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function destinationForGoal(goal: ReturnType<typeof readOnboardingGoal>): string {
  if (goal === "company") return "/subvaluadas";
  if (goal === "etf") return "/etf";
  if (goal === "portfolio") return "/portfolio";
  return "/home";
}
