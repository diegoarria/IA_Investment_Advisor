"use client";

import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "@/lib/store";
import { readOnboardingGoal } from "@/lib/onboardingAnalytics";

// Diego, 2026-09-16: shows exactly once, right after onboarding, announcing
// the 30-day free Premium trial. "has_seen_welcome_card" is server-
// persisted (migration 098) — never localStorage — so it genuinely never
// shows again on any other device/browser/reinstall once dismissed. Gated
// purely on trialStartedAt (not tier/isTrialPremium — the backend already
// folds an active trial into tier:"premium", which would wrongly exclude
// the exact users this card is for): anyone who ever had a trial started
// is eligible, regardless of what they've since become.
//
// Stage D (onboarding 2.0, 2026-11): this used to be a full-screen,
// backdrop-dimmed modal mounted globally via AppSidebar — meaning it could
// cover a brand-new user's very first real Radar/ETF/Portfolio result the
// instant they landed on it, straight out of /onboarding/quick. Diego:
// "no interrumpir con un modal antes de que el usuario obtenga valor."
// Now a small, non-blocking corner card instead — the page underneath
// stays fully visible and interactive the whole time. CTA label is
// contextual to whichever Ruta (Empresa/ETF/Portafolio) sent the user
// here, read straight from the same onboarding-goal flag the rest of the
// Stage A-C flow already uses — no prop drilling needed since AppSidebar
// mounts this unconditionally on every authenticated page.
export default function WelcomeCard() {
  const { t, i18n } = useTranslation();
  const { trialStartedAt, trialDaysLeft, hasFetchedStatus, hasSeenWelcomeCard, markWelcomeCardSeen } = useSubscriptionStore();

  const visible = hasFetchedStatus && !!trialStartedAt && !hasSeenWelcomeCard;
  if (!visible) return null;

  const goal = readOnboardingGoal();
  const ctaLabel =
    goal === "company" ? t("welcomePremiumCard.ctaCompany") :
    goal === "etf"      ? t("welcomePremiumCard.ctaEtf") :
    goal === "portfolio" ? t("welcomePremiumCard.ctaPortfolio") :
    t("welcomePremiumCard.continue");

  const trialEndDate = new Date(Date.now() + trialDaysLeft * 86_400_000);
  const trialEndLabel = new Intl.DateTimeFormat(i18n.language === "en" ? "en-US" : "es-ES", {
    day: "numeric",
    month: "long",
  }).format(trialEndDate);

  const FEATURES = [
    t("paywallModal.heroFeature1"),
    t("paywallModal.heroFeature2"),
    t("paywallModal.heroFeature3"),
  ];

  return (
    <div
      className="fixed z-[9000] left-4 right-4 bottom-4 sm:left-auto sm:right-5 sm:bottom-5 sm:w-[360px]"
      role="status"
    >
      <div
        className="rounded-[20px] overflow-hidden relative animate-fade-in-up"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 12px 36px rgba(0,0,0,0.4), 0 0 32px rgba(0,185,109,0.1)",
        }}
      >
        <button
          onClick={markWelcomeCardSeen}
          aria-label={t("common.close")}
          className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
          style={{ color: "var(--muted)" }}
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <div className="p-5 pr-9">
          <div className="flex items-center gap-2.5 mb-2">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "var(--grad-green)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2 L19 6 L19 13 C19 18 15.5 21.5 12 22.5 C8.5 21.5 5 18 5 13 L5 6 Z" />
              </svg>
            </div>
            <h1 className="font-black text-[15px] leading-tight" style={{ color: "var(--text)", letterSpacing: "-0.01em" }}>
              {t("welcomePremiumCard.title")}
            </h1>
          </div>
          <p className="text-[13px] leading-relaxed mb-2" style={{ color: "var(--sub)" }}>
            {t("welcomePremiumCard.subtitle")}
          </p>
          <p className="text-[11.5px] mb-3.5" style={{ color: "var(--muted)" }}>
            {t("welcomePremiumCard.trialEndsPrefix")}{" "}
            <strong style={{ color: "var(--text)" }}>{trialEndLabel}</strong>
          </p>

          <div className="flex flex-col gap-1.5 mb-4">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-start gap-2">
                <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--accent-l)" }} />
                <span className="text-[12.5px] leading-snug" style={{ color: "var(--text)" }}>{f}</span>
              </div>
            ))}
          </div>

          <button
            onClick={markWelcomeCardSeen}
            className="w-full py-2.5 rounded-xl font-black text-[13px]"
            style={{ background: "var(--grad-green)", color: "var(--bg)" }}
          >
            {ctaLabel}
          </button>
          <div className="text-center text-[11px] mt-2" style={{ color: "var(--muted)" }}>
            {t("welcomePremiumCard.noCardRequired")}
          </div>
        </div>
      </div>
    </div>
  );
}
