"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { X, ArrowRight, Brain, Bell, Zap } from "lucide-react";
import { useGuestGateStore, isGuestUser, GUEST_PROMPT_INTERVAL_MS } from "@/lib/store";

// Surfaces on its own every 2 minutes a guest spends in the app — accept it
// and it's done, reject/close it and it comes back 2 minutes later, up to 5
// times a day (see useGuestGateStore's own comment for the exact rule).
// Nothing is ever blocked to force this open; it's a standalone nag, not a
// gate. Design approved by Diego as-is from a preview artifact before
// implementation; ported 1:1 (same copy, gradient, orbs, icon cluster)
// rather than re-interpreted.
export default function GuestSignupFlashcard() {
  const { t } = useTranslation();
  const router = useRouter();
  const { flashcardOpen, dismissFlashcard, acceptFlashcard, showFlashcard } = useGuestGateStore();

  // Kicks off the very first prompt of this session — every prompt after
  // that reschedules itself from dismissFlashcard(). Only guests get this
  // timer at all; a real logged-in user never sees this component fire.
  useEffect(() => {
    if (!isGuestUser()) return;
    const id = setTimeout(() => showFlashcard(), GUEST_PROMPT_INTERVAL_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!flashcardOpen) return null;

  const goToAuth = () => {
    acceptFlashcard();
    router.push("/?auth=1");
  };

  const pillars = [
    { icon: Brain, bg: "rgba(167,139,250,0.14)", color: "#a78bfa", text: t("guestGate.pillars.mentor") },
    { icon: Bell,  bg: "rgba(245,158,11,0.14)",  color: "#f59e0b", text: t("guestGate.pillars.alerts") },
    { icon: Zap,   bg: "rgba(0,185,109,0.14)",   color: "var(--accent-l)", text: t("guestGate.pillars.save") },
  ];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-5 overflow-y-auto"
      style={{
        background: "radial-gradient(120% 90% at 50% 0%, rgba(0,185,109,0.10), transparent 55%), rgba(2,4,9,0.72)",
        backdropFilter: "blur(6px) saturate(1.1)",
        WebkitBackdropFilter: "blur(6px) saturate(1.1)",
      }}
      onClick={dismissFlashcard}
    >
      <div
        className="relative w-full max-w-[400px] rounded-[28px] p-[2px] my-auto animate-fade-in-up"
        style={{
          background: "linear-gradient(160deg, rgba(0,232,135,0.55), rgba(0,185,109,0.05) 40%, rgba(167,139,250,0.35) 100%)",
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.02)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative rounded-[26px] overflow-hidden px-[26px] pt-[30px] pb-[26px]"
          style={{ background: "linear-gradient(180deg, var(--card-2, var(--card)) 0%, var(--card) 100%)" }}
        >
          {/* Ambient orbs */}
          <div className="pointer-events-none absolute rounded-full blur-[2px]"
               style={{ width: 240, height: 240, top: -120, right: -90, background: "radial-gradient(circle, rgba(0,232,135,0.28) 0%, transparent 70%)" }} />
          <div className="pointer-events-none absolute rounded-full blur-[2px]"
               style={{ width: 200, height: 200, bottom: -110, left: -80, background: "radial-gradient(circle, rgba(167,139,250,0.20) 0%, transparent 70%)" }} />

          <button
            onClick={dismissFlashcard}
            aria-label={t("guestGate.close")}
            className="absolute top-4 right-4 z-[2] w-[30px] h-[30px] rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
            style={{ background: "rgba(127,127,127,0.08)", border: "1px solid var(--border)", color: "var(--muted)" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <span
            className="relative z-[1] inline-flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider rounded-full pl-2.5 pr-3 py-1.5 mb-[18px]"
            style={{ color: "var(--accent-l)", background: "rgba(0,185,109,0.12)", border: "1px solid rgba(0,185,109,0.3)" }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-l)", boxShadow: "0 0 0 3px rgba(0,232,135,0.18)" }} />
            {t("guestGate.badge")}
          </span>

          <div className="relative z-[1] flex gap-2 mb-[18px]">
            {pillars.map((p) => (
              <div key={p.text} className="w-11 h-11 rounded-2xl flex items-center justify-center border" style={{ background: p.bg, borderColor: `${p.color}4d` }}>
                <p.icon className="w-5 h-5" style={{ color: p.color }} />
              </div>
            ))}
          </div>

          <h2 className="relative z-[1] text-[25px] font-black leading-[1.14] tracking-tight mb-2.5" style={{ color: "var(--text)" }}>
            {t("guestGate.headlinePre")}{" "}
            <span style={{
              backgroundImage: "linear-gradient(100deg, #00e887, #34d399 55%, #00b96d)",
              WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
            }}>
              {t("guestGate.headlineGrad")}
            </span>{" "}
            {t("guestGate.headlinePost")}
          </h2>

          <p className="relative z-[1] text-sm leading-relaxed mb-[22px]" style={{ color: "var(--sub)" }}>
            {t("guestGate.body")}
          </p>

          <div className="relative z-[1] flex flex-col gap-2.5 mb-6">
            {pillars.map((p) => (
              <div key={p.text} className="flex items-center gap-2.5">
                <div className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center shrink-0" style={{ background: p.bg }}>
                  <p.icon className="w-3.5 h-3.5" style={{ color: p.color }} />
                </div>
                <span className="text-[12.5px] font-bold" style={{ color: "var(--text)" }}>{p.text}</span>
              </div>
            ))}
          </div>

          <button
            onClick={goToAuth}
            className="relative z-[1] w-full rounded-2xl py-[15px] px-[18px] text-[14.5px] font-extrabold tracking-tight flex items-center justify-center gap-2 mb-3 transition-transform hover:-translate-y-px"
            style={{
              color: "#04140c",
              background: "linear-gradient(100deg, #00e887, #00c87a)",
              boxShadow: "0 10px 26px -8px rgba(0,232,135,0.55)",
            }}
          >
            {t("guestGate.cta")} <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={goToAuth} className="relative z-[1] block w-full text-center text-[12.5px] font-bold py-1.5" style={{ color: "var(--muted)" }}>
            {t("guestGate.secondaryPre")} <span style={{ color: "var(--accent-l)", fontWeight: 800 }}>{t("guestGate.secondaryCta")}</span>
          </button>

          <p className="relative z-[1] text-center text-[10.5px] mt-3.5" style={{ color: "var(--dim)" }}>
            {t("guestGate.trust")}
          </p>
        </div>
      </div>
    </div>
  );
}
