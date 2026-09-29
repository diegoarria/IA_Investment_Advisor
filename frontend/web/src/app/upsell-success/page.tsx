"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check, Calendar, ExternalLink, ArrowRight, Loader2, Users, AlertTriangle, CreditCard, Video, PlayCircle, type LucideIcon } from "lucide-react";
import { SuccessShell, SuccessHero } from "@/components/SuccessShell";
import { billing, upsells } from "@/lib/api";
import { getSupabaseClient } from "@/lib/supabase";

// ← Reemplaza con tu link real de Calendly
const CALENDLY_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai";

function getOfferMeta(t: TFunction) {
  return {
    session: {
      icon: Calendar as LucideIcon,
      tone: "emerald" as const,
      color: "#00d47e",
      title: t("upsellSuccess.offers.session.title"),
      subtitle: t("upsellSuccess.offers.session.subtitle"),
      cta: true,
    },
    family_plan: {
      icon: Users as LucideIcon,
      tone: "indigo" as const,
      color: "#818CF8",
      title: t("upsellSuccess.offers.family_plan.title"),
      subtitle: t("upsellSuccess.offers.family_plan.subtitle"),
      cta: false,
    },
  };
}

type Offer = "session" | "family_plan" | "broker_call";
// One-time-payment 1:1 call offers whose booking link (Calendly) must never
// be shown until the backend has actually verified this specific Stripe
// checkout — see verify-1on1-payment/redeem-1on1-session, added after a
// 2026-08-20 audit found the link was public and shown regardless of
// payment (backend/app/api/routes/upsells.py's comment has the full story).
const PAID_1ON1_OFFERS: Offer[] = ["session", "broker_call"];

function UpsellSuccessContent() {
  const router = useRouter();
  const { t } = useTranslation();
  const OFFER_META = getOfferMeta(t);
  const params = useSearchParams();
  const offer = (params.get("offer") ?? "session") as Offer;
  // broker_call reuses the "session" offer's copy/visuals — same "you paid,
  // here's your booking link" story, no separate translated content exists.
  const meta = OFFER_META[offer === "broker_call" ? "session" : offer] ?? OFFER_META.session;

  // Duo plan setup state
  const [myEmail, setMyEmail] = useState("");
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [duoSaving, setDuoSaving] = useState(false);
  const [duoSaved, setDuoSaved] = useState(false);
  const [duoError, setDuoError] = useState("");

  // 1:1 session payment verification — CTA only ever renders once this
  // reaches "ready". A session_id-less visit (or a checkout that doesn't
  // verify) lands on "error" and never gets the Calendly link.
  const [payState, setPayState] = useState<"idle" | "verifying" | "ready" | "error">("idle");

  useEffect(() => {
    // If duo plan, pre-fill user email from Supabase session
    if (offer === "family_plan") {
      getSupabaseClient().auth.getUser().then(({ data }) => {
        if (data?.user?.email) setMyEmail(data.user.email);
      });
    }
  }, [offer]);

  useEffect(() => {
    if (!PAID_1ON1_OFFERS.includes(offer)) return;
    const sessionId = params.get("session_id");
    // `payment_intent` — either appended by us directly after a no-redirect
    // embedded Elements success (EmbeddedCheckout's onSuccess), or by
    // Stripe itself when a 3D Secure challenge redirects back here.
    const paymentIntentId = params.get("payment_intent");
    if (!sessionId && !paymentIntentId) {
      setPayState("error");
      return;
    }
    setPayState("verifying");
    upsells.verify1on1Payment(sessionId ? sessionId : { paymentIntentId: paymentIntentId! })
      .then(() => upsells.redeem1on1Session())
      .then(() => setPayState("ready"))
      .catch(() => setPayState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer]);

  const handleDuoSave = async () => {
    if (!secondaryEmail || !secondaryEmail.includes("@")) return;
    setDuoError("");
    setDuoSaving(true);
    try {
      await billing.duoSetup(secondaryEmail);
      setDuoSaved(true);
      setTimeout(() => router.replace("/profile"), 2000);
    } catch (err: any) {
      const msg = err?.response?.data?.detail
        ?? t("upsellSuccess.familyPlan.saveError");
      setDuoError(msg);
    } finally {
      setDuoSaving(false);
    }
  };

  const is1on1 = PAID_1ON1_OFFERS.includes(offer);
  const heroTone = is1on1 && payState === "error" ? "red" : meta.tone;
  const heroIcon = is1on1 && payState === "error" ? AlertTriangle : meta.icon;
  const inputOk = secondaryEmail.includes("@");

  // Redesign 2026-09-28 — same brand language as Products (see
  // components/SuccessShell). Logic unchanged: the Calendly CTA still only
  // renders once the payment is verified (payState === "ready").
  return (
    <SuccessShell>
      <SuccessHero
        icon={heroIcon}
        tone={heroTone}
        eyebrow={is1on1 && payState === "error" ? undefined : t("premiumSuccess.eyebrow")}
        title={is1on1 && payState === "error" ? t("upsellSuccess.session.verifyError") : meta.title}
        subtitle={is1on1 && payState === "error" ? t("upsellSuccess.session.verifyErrorDesc") : meta.subtitle}
        tagline={is1on1 && payState === "error" ? undefined : t("upsellSuccess.tagline")}
      />

      <div className="p-6 space-y-4">
        {is1on1 && payState !== "error" && (
          payState !== "ready" ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-7 h-7 animate-spin" style={{ color: "var(--accent-l)" }} />
              <p className="text-sm font-semibold" style={{ color: "var(--sub)" }}>{t("upsellSuccess.session.verifying")}</p>
            </div>
          ) : (
            <>
              <div className="space-y-2.5">
                {([
                  { icon: CreditCard, text: t("upsellSuccess.session.paymentProcessed", { amount: params.get("amount") ?? "" }) },
                  { icon: Video, text: t("upsellSuccess.session.videoCall") },
                  { icon: PlayCircle, text: t("upsellSuccess.session.recording") },
                ] as { icon: LucideIcon; text: string }[]).map(({ icon: Icon, text }) => (
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

              <div className="rounded-[16px] border p-4" style={{ background: "rgba(0,185,109,0.07)", borderColor: "rgba(0,185,109,0.3)" }}>
                <p className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[1.1px] mb-1.5" style={{ color: "var(--accent-l)" }}>
                  <Calendar className="w-3.5 h-3.5" />{t("upsellSuccess.session.nextStep")}
                </p>
                <p className="text-[13.5px] leading-relaxed" style={{ color: "var(--sub)" }}>{t("upsellSuccess.session.nextStepDesc")}</p>
              </div>

              {/* Only once the payment is actually verified. */}
              <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer"
                 className="w-full inline-flex items-center justify-center gap-2 py-4 rounded-[16px] text-[15px] font-extrabold transition-all hover:opacity-90 hover:-translate-y-0.5"
                 style={{ background: "#00D47E", color: "#06120D", boxShadow: "0 12px 28px -12px rgba(0,212,126,0.75)" }}>
                <Calendar className="w-[18px] h-[18px]" />
                {t("upsellSuccess.session.scheduleCta")}
                <ExternalLink className="w-3.5 h-3.5 opacity-70" />
              </a>
            </>
          )
        )}

        {offer === "family_plan" && (
          duoSaved ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.14)" }}>
                <Check className="w-6 h-6" style={{ color: "#22c55e" }} strokeWidth={3} />
              </span>
              <p className="text-[15px] font-extrabold" style={{ color: "var(--text)" }}>{t("upsellSuccess.familyPlan.savedTitle")}</p>
              <p className="text-[13px]" style={{ color: "var(--muted)" }}>{t("upsellSuccess.familyPlan.redirecting")}</p>
            </div>
          ) : (
            <>
              <p className="flex items-center gap-2 text-[15px] font-extrabold tracking-tight" style={{ color: "var(--text)" }}>
                <span className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ background: "rgba(129,140,248,0.14)" }}>
                  <Users className="w-4 h-4" style={{ color: "#818CF8" }} />
                </span>
                {t("upsellSuccess.familyPlan.whichAccounts")}
              </p>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.8px] mb-1.5" style={{ color: "var(--muted)" }}>{t("upsellSuccess.familyPlan.account1Label")}</p>
                <div className="px-3.5 py-3 rounded-[12px] border text-sm" style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--sub)" }}>
                  {myEmail || t("upsellSuccess.familyPlan.loading")}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.8px] mb-1.5" style={{ color: "var(--muted)" }}>{t("upsellSuccess.familyPlan.account2Label")}</p>
                <input
                  type="email"
                  placeholder={t("upsellSuccess.familyPlan.emailPlaceholder")}
                  value={secondaryEmail}
                  onChange={(e) => setSecondaryEmail(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-[12px] border text-sm outline-none transition-colors"
                  style={{ background: "var(--bg)", borderColor: inputOk ? "rgba(129,140,248,0.6)" : "var(--border)", color: "var(--text)" }}
                />
              </div>

              {duoError && (
                <p className="flex items-start gap-1.5 text-[13px] leading-relaxed" style={{ color: "#f87171" }}>
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{duoError}
                </p>
              )}

              <button
                onClick={handleDuoSave}
                disabled={duoSaving || !inputOk}
                className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-[16px] text-[15px] font-extrabold transition-all enabled:hover:opacity-90 disabled:cursor-not-allowed"
                style={{
                  background: duoSaving || !inputOk ? "rgba(129,140,248,0.18)" : "#818CF8",
                  color: duoSaving || !inputOk ? "var(--muted)" : "#0B0E22",
                  boxShadow: duoSaving || !inputOk ? "none" : "0 12px 28px -12px rgba(129,140,248,0.75)",
                }}
              >
                {duoSaving ? <><Loader2 className="w-4 h-4 animate-spin" />{t("upsellSuccess.familyPlan.saving")}</> : t("upsellSuccess.familyPlan.saveAccounts")}
              </button>

              <button onClick={() => router.replace("/profile")}
                      className="w-full text-[13px] font-semibold py-1 hover:opacity-80 transition-opacity" style={{ color: "var(--muted)" }}>
                {t("upsellSuccess.familyPlan.addLater")}
              </button>
            </>
          )
        )}

        <button
          onClick={() => router.replace("/profile")}
          className="w-full inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold pt-1 hover:opacity-80 transition-opacity"
          style={{ color: "var(--muted)" }}
        >
          {t("upsellSuccess.backToProfile")} <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </SuccessShell>
  );
}

export default function UpsellSuccessPage() {
  return (
    <Suspense>
      <UpsellSuccessContent />
    </Suspense>
  );
}
