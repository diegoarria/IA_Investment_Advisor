"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "@/lib/store";
import { billing } from "@/lib/api";
import { Check, Loader2, Calendar, ExternalLink, MessageCircle, PieChart, Filter, Mail, Clock, RefreshCw, type LucideIcon } from "lucide-react";
import { SuccessShell, SuccessHero } from "@/components/SuccessShell";

const CALENDLY_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai";

export default function PremiumSuccessPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const tier = useSubscriptionStore((s) => s.tier);
  const [ready, setReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [isSession, setIsSession] = useState(false);

  useEffect(() => {
    const pendingSession = localStorage.getItem("nuvos_pending_session") === "1";
    if (pendingSession) {
      setIsSession(true);
      localStorage.removeItem("nuvos_pending_session");
    }

    // Poll until Premium is active. Each round first asks the backend to verify the
    // payment directly with Stripe (POST /billing/sync-subscription) instead of only
    // waiting for the webhook — a paid user must NEVER stay Free because a webhook
    // was missed or matched no profile.
    let attempts = 0;
    const poll = async () => {
      if (!pendingSession) await billing.syncSubscription().catch(() => {});
      await fetchStatus();
      attempts++;
      const current = useSubscriptionStore.getState().tier;
      if (current === "premium" || pendingSession) {
        setReady(true);
        if (!pendingSession) {
          setTimeout(() => router.replace("/chat"), 2500);
        }
      } else if (attempts >= 20) {
        // Never claim success we couldn't confirm.
        setTimedOut(true);
      } else {
        setTimeout(poll, 1500);
      }
    };
    poll();
  }, [fetchStatus, router]);

  // Redesign 2026-09-28 — same brand language as Products: an emerald
  // gradient hero card over a clean body; theme-aware (was hardcoded white
  // text that disappeared on the light theme).
  const features: { icon: LucideIcon; text: string }[] = [
    { icon: MessageCircle, text: t("premiumSuccess.features.unlimitedChat") },
    { icon: PieChart, text: t("premiumSuccess.features.advancedAnalysis") },
    { icon: Filter, text: t("premiumSuccess.features.premiumScreener") },
    { icon: Mail, text: t("premiumSuccess.features.weeklyEmails") },
  ];

  return (
    <SuccessShell>
      {ready ? (
        <>
          <SuccessHero
            icon={isSession ? Calendar : Check}
            eyebrow={t("premiumSuccess.eyebrow")}
            title={isSession ? t("premiumSuccess.sessionBookedTitle") : t("premiumSuccess.welcomeTitle")}
            subtitle={isSession ? t("premiumSuccess.sessionBookedDesc") : t("premiumSuccess.welcomeDesc")}
          />
          <div className="p-6">
            {isSession ? (
              <a href={CALENDLY_URL}
                 className="w-full inline-flex items-center justify-center gap-2 py-4 rounded-[16px] text-[15px] font-extrabold transition-all hover:opacity-90 hover:-translate-y-0.5"
                 style={{ background: "#00D47E", color: "#06120D", boxShadow: "0 12px 28px -12px rgba(0,212,126,0.75)" }}>
                <Calendar className="w-[18px] h-[18px]" />
                {t("premiumSuccess.bookSlot")}
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </a>
            ) : (
              <>
                <div className="space-y-2.5">
                  {features.map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-3 rounded-[14px] border px-3.5 py-3"
                         style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
                      <span className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.12)" }}>
                        <Icon className="w-[17px] h-[17px]" style={{ color: "var(--accent-l)" }} />
                      </span>
                      <span className="flex-1 text-sm font-semibold" style={{ color: "var(--text)" }}>{text}</span>
                      <Check className="w-4 h-4 shrink-0" style={{ color: "var(--accent-l)" }} strokeWidth={3} />
                    </div>
                  ))}
                </div>
                {/* Visual cue for the automatic redirect to chat (2.5s). */}
                <div className="mt-5 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                  <div className="h-full rounded-full" style={{ background: "var(--accent)", animation: "nuvosFill 2.5s linear forwards" }} />
                </div>
                <style>{`@keyframes nuvosFill { from { width: 0% } to { width: 100% } }`}</style>
              </>
            )}
          </div>
        </>
      ) : timedOut ? (
        <>
          <SuccessHero icon={Clock} tone="amber" title={t("premiumSuccess.pendingTitle")} subtitle={t("premiumSuccess.pendingDesc")} />
          <div className="p-6">
            <button
              onClick={() => window.location.reload()}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-[16px] text-[15px] font-extrabold transition-opacity hover:opacity-90"
              style={{ background: "#00D47E", color: "#06120D" }}
            >
              <RefreshCw className="w-4 h-4" />
              {t("premiumSuccess.retry")}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 px-6 py-14">
          <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(0,185,109,0.12)" }}>
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent-l)" }} />
          </span>
          <p className="text-[15px] font-semibold" style={{ color: "var(--sub)" }}>{t("premiumSuccess.activating")}</p>
        </div>
      )}
    </SuccessShell>
  );
}
