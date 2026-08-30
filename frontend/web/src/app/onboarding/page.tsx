"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useAuthStore, useChatStore, useLanguageStore, useSubscriptionStore } from "@/lib/store";
import { ChevronRight, ChevronLeft } from "lucide-react";

// ─── Static data (language-neutral metadata; labels resolved via t() at render) ─
const GOALS = [
  { value: "house",             labelKey: "onboarding.goals.house",            emoji: "🏠" },
  { value: "car",               labelKey: "onboarding.goals.car",              emoji: "🚗" },
  { value: "passive_income",    labelKey: "onboarding.goals.passiveIncome",    emoji: "💸" },
  { value: "retirement",        labelKey: "onboarding.goals.retirement",       emoji: "👴" },
  { value: "financial_freedom", labelKey: "onboarding.goals.financialFreedom",emoji: "🦅" },
  { value: "long_term_wealth",  labelKey: "onboarding.goals.longTermWealth",  emoji: "🏛️" },
];

// E.164 dial codes for the phone step's country selector.
const DIAL_CODES = [
  { value: "MX", code: "+52", flag: "🇲🇽", labelKey: "onboarding.countries.mx" },
  { value: "US", code: "+1",  flag: "🇺🇸", labelKey: "onboarding.countries.us" },
  { value: "CO", code: "+57", flag: "🇨🇴", labelKey: "onboarding.countries.co" },
  { value: "AR", code: "+54", flag: "🇦🇷", labelKey: "onboarding.countries.ar" },
  { value: "VE", code: "+58", flag: "🇻🇪", labelKey: "onboarding.countries.ve" },
  { value: "PE", code: "+51", flag: "🇵🇪", labelKey: "onboarding.countries.pe" },
  { value: "CL", code: "+56", flag: "🇨🇱", labelKey: "onboarding.countries.cl" },
  { value: "ES", code: "+34", flag: "🇪🇸", labelKey: "onboarding.countries.es" },
];

// "¿Qué has escuchado de la bolsa?" — multi-select, fully optional. Picking
// "hasBrokerInvests" doubles as an implicit has_broker/has_investments=true
// signal, so we don't need to ask that as its own separate step anymore.
const MARKET_PERCEPTION_OPTIONS = [
  { value: "casino",             labelKey: "onboarding.marketPerception.options.casino",           emoji: "🎰" },
  { value: "only_rich",          labelKey: "onboarding.marketPerception.options.onlyRich",          emoji: "💰" },
  { value: "need_expert",        labelKey: "onboarding.marketPerception.options.needExpert",        emoji: "🎓" },
  { value: "has_broker_invests", labelKey: "onboarding.marketPerception.options.hasBrokerInvests",  emoji: "📈" },
  { value: "other",              labelKey: "onboarding.marketPerception.options.other",             emoji: "💬" },
];

// ─── Form State ────────────────────────────────────────────────────────────────
type FormState = {
  name: string;
  birth_day: string;
  birth_month: string;
  birth_year: string;
  phone_dial_code: string;
  phone_local: string;
  investment_goal: string;
  market_perception: string[];
  market_perception_other: string;
};

// ─── Component ─────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const { t } = useTranslation();
  const router  = useRouter();
  const { setProfile }  = useProfileStore();
  const { isAuthenticated, authRestoring, clearAuth, userId } = useAuthStore();
  const { language } = useLanguageStore();

  const MONTHS = t("onboarding.months", { returnObjects: true }) as string[];

  const [step, setStep]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");
  const [acceptedTerms, setAcceptedTerms]           = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);

  const [form, setForm] = useState<FormState>({
    name: "", birth_day: "", birth_month: "", birth_year: "",
    phone_dial_code: "", phone_local: "",
    investment_goal: "", market_perception: [], market_perception_other: "",
  });

  // ── Draft autosave ───────────────────────────────────────────────────────────
  // A multi-step flow held only in React state loses everything the instant
  // the tab is closed, the browser crashes, or a reload happens — persist
  // every answer as it's typed and restore it on the next load, so an
  // interruption never means starting over.
  const draftKey = `onboarding_draft__${userId || "guest"}`;
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.form) setForm((f) => ({ ...f, ...draft.form }));
        if (typeof draft.step === "number") setStep(draft.step);
        if (typeof draft.acceptedTerms === "boolean") setAcceptedTerms(draft.acceptedTerms);
        if (typeof draft.acceptedDisclaimer === "boolean") setAcceptedDisclaimer(draft.acceptedDisclaimer);
      }
    } catch { /* corrupted/unreadable draft — just start fresh, never crash onboarding over it */ }
    setDraftLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ form, step, acceptedTerms, acceptedDisclaimer }));
    } catch { /* Safari Private Browsing etc. — autosave is best-effort */ }
  }, [form, step, acceptedTerms, acceptedDisclaimer, draftLoaded, draftKey]);

  useEffect(() => { if (!authRestoring && !isAuthenticated) router.push("/"); }, [isAuthenticated, authRestoring]);

  // Guard: if this account already has a profile, never show onboarding again.
  // On a slow connection this can resolve after the user has already started
  // filling the form — only act on it if they haven't actually typed
  // anything yet, so a real answer never gets yanked away mid-flow.
  useEffect(() => {
    profileApi.get()
      .then(() => {
        if (step === 0 && !form.name.trim()) {
          window.location.href = "/home";
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Never render the form until we actually know whether this session is
  // valid — while restoring, the form used to be fully interactive, so a
  // session that turned out invalid discarded all answers at submit time
  // instead of before the user ever typed anything.
  if (authRestoring) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "var(--bg)" }}>
        <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }} />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  // ── Derived values ───────────────────────────────────────────────────────────
  const firstName  = form.name.trim().split(" ")[0];

  const birthDateValid = (() => {
    const d = parseInt(form.birth_day), m = parseInt(form.birth_month), y = parseInt(form.birth_year);
    if (!d || !m || !y) return false;
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
    const ageMs = Date.now() - dt.getTime();
    return ageMs >= 18 * 365.25 * 86_400_000 && ageMs <= 90 * 365.25 * 86_400_000;
  })();

  const birthDateStr = birthDateValid
    ? `${form.birth_year}-${form.birth_month.padStart(2,"0")}-${form.birth_day.padStart(2,"0")}`
    : "";

  const phoneDigits = form.phone_local.replace(/\D/g, "");
  // Mirrors the server's E.164 check (backend/app/models/user.py:
  // ^\+[1-9]\d{6,14}$, i.e. 7-15 digits total INCLUDING the dial code).
  const dialDigits = form.phone_dial_code.replace(/\D/g, "").length;
  const phoneValid  = !!form.phone_dial_code && phoneDigits.length >= 7 && (dialDigits + phoneDigits.length) <= 15;
  // Phone is optional — only block progress if they started filling it in
  // but left it incomplete/invalid, never if they left it untouched.
  const phoneStepValid = (!form.phone_dial_code && !form.phone_local) || phoneValid;

  const toggleMarketPerception = (value: string) => {
    setForm((f) => {
      const has = f.market_perception.includes(value);
      return {
        ...f,
        market_perception: has
          ? f.market_perception.filter((v) => v !== value)
          : [...f.market_perception, value],
      };
    });
  };

  const goalInfo = GOALS.find((g) => g.value === form.investment_goal);

  // ── Steps ────────────────────────────────────────────────────────────────────
  const STEPS = [
    // 0 — Intro: qué es Nuvos, antes de pedir cualquier dato. Feedback de
    // usuario (2026-08-29): "le gustó mucho la app, pero no entendió de qué
    // se trataba" — repite literalmente el ancla del login ("Decide mejor.")
    // en vez de ir directo a pedir nombre/fecha de nacimiento sin contexto.
    {
      subtitle: t("onboarding.stepIntro.subtitle"),
      title: t("onboarding.stepIntro.title"),
      valid: () => true,
      content: (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed" style={{ color: "var(--sub)" }}>
            {t("onboarding.stepIntro.body")}
          </p>
          <div className="rounded-xl px-4 py-3" style={{ background: "rgba(0,185,109,0.08)", border: "1px solid rgba(0,185,109,0.25)" }}>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text)" }}>
              {t("onboarding.stepIntro.footnote")}
            </p>
          </div>
        </div>
      ),
    },
    // 1 — Nombre + fecha de nacimiento (obligatorio)
    {
      subtitle: t("onboarding.step0.subtitle"),
      title: t("onboarding.step0.title"),
      valid: () => form.name.trim().length >= 2 && birthDateValid,
      content: (
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step0.nameLabel")}
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder={t("onboarding.step0.namePlaceholder")}
              autoFocus
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step0.nameHint")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              {t("onboarding.step0.birthDateLabel")}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <select value={form.birth_day}
                      onChange={(e) => setForm(f => ({ ...f, birth_day: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_day ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.day")}</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
              <select value={form.birth_month}
                      onChange={(e) => setForm(f => ({ ...f, birth_month: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_month ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.month")}</option>
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={String(i + 1)}>{m}</option>
                ))}
              </select>
              <select value={form.birth_year}
                      onChange={(e) => setForm(f => ({ ...f, birth_year: e.target.value }))}
                      className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none"
                      style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.birth_year ? "var(--text)" : "var(--muted)" }}>
                <option value="">{t("onboarding.step0.year")}</option>
                {/* Max year is "this year minus 18" so anyone who just turned 18
                    can always select their birth year. */}
                {Array.from({ length: 73 }, (_, i) => (new Date().getFullYear() - 18) - i).map(y => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
              {t("onboarding.step0.birthDateHint")}
            </p>
          </div>
        </div>
      ),
    },

    // 1 — Teléfono (opcional)
    {
      subtitle: t("onboarding.stepPhone.subtitle"),
      title: firstName ? t("onboarding.stepPhone.titleNamed", { name: firstName }) : t("onboarding.stepPhone.title"),
      valid: () => phoneStepValid,
      content: (
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
            {t("onboarding.stepPhone.phoneLabel")}
          </label>
          <div className="flex gap-2">
            <select value={form.phone_dial_code}
                    onChange={(e) => setForm(f => ({ ...f, phone_dial_code: e.target.value }))}
                    className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none shrink-0 w-[7.5rem]"
                    style={{ background: "var(--raised)", borderColor: "var(--border)", color: form.phone_dial_code ? "var(--text)" : "var(--muted)" }}>
              <option value="">{t("onboarding.stepPhone.phoneCode")}</option>
              {DIAL_CODES.map((d) => (
                <option key={d.value} value={d.code}>{d.flag} {d.code}</option>
              ))}
            </select>
            <input
              value={form.phone_local}
              onChange={(e) => setForm(f => ({ ...f, phone_local: e.target.value }))}
              type="tel" inputMode="tel"
              className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder={t("onboarding.stepPhone.phonePlaceholder")}
              autoFocus
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>
          <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>
            {t("onboarding.stepPhone.phoneHint")}
          </p>
        </div>
      ),
    },

    // 2 — Meta financiera al invertir (opcional)
    {
      subtitle: t("onboarding.step3.subtitle"),
      title: t("onboarding.step3.title"),
      valid: () => true,
      content: (
        <div className="grid grid-cols-2 gap-2.5">
          {GOALS.map((g) => {
            const active = form.investment_goal === g.value;
            return (
              <button key={g.value}
                      onClick={() => setForm(f => ({ ...f, investment_goal: f.investment_goal === g.value ? "" : g.value }))}
                      className="p-4 rounded-2xl border-2 text-left transition-all"
                      style={{
                        borderColor: active ? "var(--accent)" : "var(--border)",
                        background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                      }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-2xl">{g.emoji}</span>
                  {active && (
                    <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center"
                          style={{ background: "var(--accent)" }}>
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  )}
                </div>
                <p className="text-xs font-bold leading-snug"
                   style={{ color: active ? "var(--accent-l)" : "var(--sub)" }}>
                  {t(g.labelKey)}
                </p>
              </button>
            );
          })}
        </div>
      ),
    },

    // 3 — ¿Qué has escuchado de la bolsa? (opcional, selección múltiple)
    {
      subtitle: t("onboarding.marketPerception.subtitle"),
      title: firstName ? t("onboarding.marketPerception.titleNamed", { name: firstName }) : t("onboarding.marketPerception.title"),
      valid: () => true,
      content: (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: "var(--sub)" }}>
            {t("onboarding.marketPerception.prompt")}
          </p>
          <div className="space-y-2.5">
            {MARKET_PERCEPTION_OPTIONS.map((opt) => {
              const active = form.market_perception.includes(opt.value);
              return (
                <button key={opt.value}
                        onClick={() => toggleMarketPerception(opt.value)}
                        className="w-full text-left p-3.5 rounded-2xl border-2 transition-all flex items-center gap-3"
                        style={{
                          borderColor: active ? "var(--accent)" : "var(--border)",
                          background:  active ? "rgba(0,168,94,0.10)" : "var(--raised)",
                        }}>
                  <span className="text-lg shrink-0">{opt.emoji}</span>
                  <span className="text-sm flex-1" style={{ color: active ? "var(--text)" : "var(--sub)" }}>
                    {t(opt.labelKey)}
                  </span>
                  <span className="w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center"
                        style={{
                          borderColor: active ? "var(--accent)" : "var(--border)",
                          background:  active ? "var(--accent)" : "transparent",
                        }}>
                    {active && (
                      <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                        <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          {form.market_perception.includes("other") && (
            <input
              value={form.market_perception_other}
              onChange={(e) => setForm(f => ({ ...f, market_perception_other: e.target.value }))}
              className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder={t("onboarding.marketPerception.otherPlaceholder")}
              autoFocus
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          )}
          <p className="text-xs" style={{ color: "var(--dim)" }}>
            {t("onboarding.marketPerception.hint")}
          </p>
        </div>
      ),
    },

    // 4 — Disclaimer legal (obligatorio)
    {
      subtitle: t("onboarding.legal.subtitle"),
      title: t("onboarding.legal.title"),
      valid: () => acceptedTerms && acceptedDisclaimer,
      content: (
        <div className="space-y-4">
          {/* Scrollable legal document */}
          <div className="rounded-xl border overflow-hidden"
               style={{ borderColor: "rgba(245,158,11,0.3)" }}>
            <div className="px-3 py-2 flex items-center gap-2"
                 style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)" }}>
              <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#f59e0b" }}>
                ⚠️ {t("onboarding.legal.bannerTitle")}
              </span>
            </div>
            <div className="overflow-y-auto px-4 py-4 space-y-4 text-xs leading-relaxed"
                 style={{ maxHeight: 260, color: "var(--sub)" }}>

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

          {/* Acceptance checkboxes */}
          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                 style={{
                   borderColor: acceptedTerms ? "var(--accent)" : "var(--border)",
                   background:  acceptedTerms ? "var(--accent)" : "transparent",
                 }}
                 onClick={() => setAcceptedTerms(v => !v)}>
              {acceptedTerms && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              {t("onboarding.legal.acceptTermsPrefix")}{" "}
              <a href="/terms" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                {t("onboarding.legal.termsLink")}
              </a>
              {" "}{t("onboarding.legal.and")}{" "}
              <a href="/privacy" target="_blank" style={{ color: "var(--accent-l)", textDecoration: "underline" }}>
                {t("onboarding.legal.privacyLink")}
              </a>.
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <div className="mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center transition-all"
                 style={{
                   borderColor: acceptedDisclaimer ? "var(--accent)" : "var(--border)",
                   background:  acceptedDisclaimer ? "var(--accent)" : "transparent",
                 }}
                 onClick={() => setAcceptedDisclaimer(v => !v)}>
              {acceptedDisclaimer && (
                <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                  <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>
              {t("onboarding.legal.understandPrefix")}{" "}
              <strong style={{ color: "var(--text)" }}>{t("onboarding.legal.understandEmphasis")}</strong>
              {t("onboarding.legal.understandSuffix")}
            </span>
          </label>
        </div>
      ),
    },
  ];

  const current    = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleNext = async () => {
    if (!isLastStep) { setStep(step + 1); return; }
    setLoading(true); setError("");

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      birth_date: birthDateStr || undefined,
      terms_accepted_at: new Date().toISOString(),
      terms_version: "2026-06",
      language,
    };
    if (form.phone_dial_code && phoneDigits.length >= 7) {
      payload.phone_number = form.phone_dial_code + phoneDigits;
    }
    if (form.investment_goal) payload.investment_goal = form.investment_goal;
    if (form.market_perception.length) payload.market_perception = form.market_perception;
    if (form.market_perception.includes("other") && form.market_perception_other.trim()) {
      payload.market_perception_other = form.market_perception_other.trim();
    }
    // Picking "ya tengo broker y ya invierto" answers has_broker/has_investments
    // right away instead of asking those as their own separate step.
    if (form.market_perception.includes("has_broker_invests")) {
      payload.has_broker = true;
      payload.has_investments = true;
    }

    // This is the single most important write in the whole app — no row
    // here means no trial, no personalization, nothing. Retry a couple of
    // times with backoff on a transient failure before giving up, instead
    // of letting one flaky request (no timeout/retry existed before) strand
    // the user on an indefinite spinner or a one-shot error.
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
      // The trial starts server-side the instant this profile row is
      // created — refresh subscription status right away so the very next
      // screen already knows the user is in their 30-day trial, instead of
      // waiting on whichever page happens to mount AppSidebar first.
      useSubscriptionStore.getState().fetchStatus();

      // ── Inyectar mensaje de bienvenida del mentor en el chat ──────────────
      // The onboarding is short on purpose now — Arthur doesn't know the
      // user's risk profile, broker, or numbers yet. The welcome message
      // says so explicitly instead of pretending to already know them.
      const _goalLabelKeys: Record<string, string> = {
        house:             "onboarding.welcome.goals.house",
        car:               "onboarding.welcome.goals.car",
        passive_income:    "onboarding.welcome.goals.passiveIncome",
        retirement:        "onboarding.welcome.goals.retirement",
        financial_freedom: "onboarding.welcome.goals.financialFreedom",
        long_term_wealth:  "onboarding.welcome.goals.longTermWealth",
      };
      const _goalLabel = form.investment_goal ? (t(_goalLabelKeys[form.investment_goal] ?? "") || form.investment_goal) : "";
      const _welcomeMsg = _goalLabel
        ? t("onboarding.welcome.messageWithGoal", { name: firstName, goal: _goalLabel })
        : t("onboarding.welcome.messageNoGoal", { name: firstName });

      const _chat = useChatStore.getState();
      _chat.createSession();
      _chat.addMessage({ role: "assistant", content: _welcomeMsg });

      // These are all nice-to-have UI flags (guided tour state, a legacy
      // completion marker) — NOT guards on whether the profile save
      // succeeded, which already happened above. They used to sit inside
      // this same try block unguarded: Safari Private Browsing throws
      // synchronously on setItem, which made a fully successful save show
      // "no se pudo guardar" and never navigate anywhere, with no way out
      // except retrying into the exact same failure forever.
      try {
        localStorage.setItem("nuvos_ob", "1");
        localStorage.setItem("nuvos_guided_tour", "1");
        localStorage.setItem("nuvos_guided_step", "1");
        localStorage.removeItem(draftKey);
      } catch { /* ignore — these are cosmetic, the save already succeeded */ }
      router.push("/home");
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]?.msg ?? "") : "";
      setError(msg || t("onboarding.errors.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  // ── Main layout ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <Image src="/logo.png" alt="Nuvos AI" width={28} height={28} className="rounded-lg object-cover" />
          <span className="font-bold text-sm" style={{ color: "var(--text)" }}>Nuvos AI</span>
        </div>

        {/* Progress */}
        <div className="flex gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-all"
                 style={{ background: i <= step ? "var(--accent)" : "var(--border)" }} />
          ))}
        </div>

        <div className="rounded-2xl border p-5 overflow-y-auto max-h-[72vh]"
             style={{ background: "var(--card)", borderColor: "var(--border)" }}>
          {/* Step label */}
          <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: "var(--accent-l)" }}>
            {current.subtitle}
          </p>
          <h2 className="text-lg font-bold mb-4 leading-snug" style={{ color: "var(--text)" }}>
            {current.title}
          </h2>

          {current.content}

          {error && (
            <div className="mt-4 rounded-xl px-4 py-3 text-sm"
                 style={{ background: "rgba(255,71,87,0.1)", border: "1px solid rgba(255,71,87,0.3)", color: "var(--down)" }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button onClick={async () => { if (step === 0) { await clearAuth(); router.push("/"); } else setStep(step - 1); }}
                    className="flex items-center gap-1.5 px-4 py-3 border rounded-xl text-sm font-medium transition-colors"
                    style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
              <ChevronLeft className="w-4 h-4" />
              {step === 0 ? t("onboarding.buttons.exit") : t("onboarding.buttons.back")}
            </button>
            <button onClick={handleNext}
                    disabled={!current.valid() || loading}
                    className="flex-1 flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40"
                    style={{ background: "var(--accent)" }}>
              {loading ? t("onboarding.buttons.saving") : isLastStep ? t("onboarding.buttons.start") : t("onboarding.buttons.next")}
              {!loading && <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <p className="text-center text-xs mt-2" style={{ color: "var(--dim)" }}>
          {t("onboarding.stepCounter", { current: step + 1, total: STEPS.length })}
        </p>
      </div>
    </div>
  );
}
