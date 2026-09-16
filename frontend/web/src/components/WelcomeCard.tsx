"use client";

import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore, useProfileStore } from "@/lib/store";

// Diego, 2026-09-16: shows exactly once, right after onboarding, announcing
// the 30-day free Premium trial. "has_seen_welcome_card" is server-
// persisted (migration 098) — never localStorage — so it genuinely never
// shows again on any other device/browser/reinstall once "Continuar" is
// tapped. Gated purely on trialStartedAt (not tier/isTrialPremium — the
// backend already folds an active trial into tier:"premium", which would
// wrongly exclude the exact users this card is for): anyone who ever had a
// trial started is eligible, regardless of what they've since become.
export default function WelcomeCard() {
  const { t, i18n } = useTranslation();
  const { profile } = useProfileStore();
  const { trialStartedAt, trialDaysLeft, hasFetchedStatus, hasSeenWelcomeCard, markWelcomeCardSeen } = useSubscriptionStore();

  const visible = hasFetchedStatus && !!trialStartedAt && !hasSeenWelcomeCard;
  if (!visible) return null;

  const trialEndDate = new Date(Date.now() + trialDaysLeft * 86_400_000);
  const trialEndLabel = new Intl.DateTimeFormat(i18n.language === "en" ? "en-US" : "es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(trialEndDate);

  const FEATURES = [
    t("paywallModal.heroFeature1"),
    t("paywallModal.heroFeature2"),
    t("paywallModal.heroFeature3"),
    t("paywallModal.heroFeature4"),
    t("paywallModal.heroFeature5"),
  ];

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-[480px] rounded-3xl overflow-y-auto"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 60px rgba(0,185,109,0.08)",
          maxHeight: "92vh",
          minHeight: 0,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Header */}
        <div className="pt-7 px-8 flex flex-col items-center text-center gap-2.5">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--grad-green)", boxShadow: "0 0 24px rgba(0,185,109,0.35)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 L19 6 L19 13 C19 18 15.5 21.5 12 22.5 C8.5 21.5 5 18 5 13 L5 6 Z" />
            </svg>
          </div>
          <h1 className="font-black text-[22px]" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
            {t("welcomePremiumCard.title", { name: profile?.name || "" })}
          </h1>
          <p className="text-sm max-w-[320px]" style={{ color: "var(--sub)" }}>
            {t("welcomePremiumCard.subtitle")}
          </p>
        </div>

        {/* Trial banner */}
        <div
          className="mx-8 mt-5 rounded-2xl px-4.5 py-3.5"
          style={{
            background: "linear-gradient(135deg, rgba(0,185,109,0.12) 0%, rgba(0,232,135,0.05) 100%)",
            border: "1px solid rgba(0,185,109,0.3)",
          }}
        >
          <div className="text-[11px] font-bold uppercase" style={{ color: "var(--accent-l)", letterSpacing: "0.04em" }}>
            {t("welcomePremiumCard.trialLabel")}
          </div>
          <div className="text-[13px] mt-0.5" style={{ color: "var(--sub)" }}>
            {t("welcomePremiumCard.trialEndsPrefix")}{" "}
            <strong style={{ color: "var(--text)" }}>{trialEndLabel}</strong>
          </div>
        </div>

        {/* Features */}
        <div className="mx-8 mt-5 flex flex-col gap-3">
          <div className="text-[11px] font-bold uppercase" style={{ color: "var(--muted)", letterSpacing: "0.04em" }}>
            {t("welcomePremiumCard.featuresLabel")}
          </div>
          {FEATURES.map((f) => (
            <div key={f} className="flex items-start gap-2.5">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "rgba(0,185,109,0.15)" }}
              >
                <Check className="w-3 h-3" style={{ color: "var(--accent-l)" }} />
              </div>
              <span className="text-sm" style={{ color: "var(--text)" }}>{f}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-8 pt-6 pb-7 flex flex-col gap-2.5">
          <button
            onClick={markWelcomeCardSeen}
            className="w-full py-3.5 rounded-2xl font-black text-[14.5px]"
            style={{ background: "var(--grad-green)", color: "var(--bg)", boxShadow: "0 4px 20px rgba(0,185,109,0.35)" }}
          >
            {t("welcomePremiumCard.continue")}
          </button>
          <div className="text-center text-[11.5px]" style={{ color: "var(--muted)" }}>
            {t("welcomePremiumCard.noCardRequired")}
          </div>
        </div>
      </div>
    </div>
  );
}
