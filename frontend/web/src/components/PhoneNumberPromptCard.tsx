"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Phone } from "lucide-react";
import { profile as profileApi } from "@/lib/api";
import { useProfileStore, useSubscriptionStore } from "@/lib/store";
import { DIAL_CODES } from "@/lib/dialCodes";

// Diego, 2026-09-24: "Quiero que le pidas 5. Número de teléfono a usuarios
// actuales ... para definir su país y por ende mostrarles el paywall
// correcto para que no haya fallas a la hora de pagar." app/core/
// pricing_region.py's is_mexico() uses country OR a +52 phone number to
// decide whether to show the MXN Stripe price instead of USD — many
// Mexican debit cards decline USD charges outright. New users already get
// asked during onboarding's phone step (optional there); this is the
// one-time catch-up for every EXISTING account that predates it or
// skipped it. "SOLO 1 VEZ EN TODA LA HISTORIA" — has_seen_phone_prompt
// (migration 106) is persisted server-side, same never-twice pattern as
// WelcomeCard's has_seen_welcome_card, and gets set whether the user
// submits a number or dismisses the card — a decline must never come
// back and ask again either.
export default function PhoneNumberPromptCard() {
  const { t } = useTranslation();
  const { profile, setProfile } = useProfileStore();
  const { trialStartedAt, hasSeenWelcomeCard } = useSubscriptionStore();
  const [dialCode, setDialCode] = useState("");
  const [localNumber, setLocalNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Never stack on top of WelcomeCard (also a full-screen modal, mounted
  // alongside this one in AppSidebar) — a brand new trial user sees that
  // one first; this one waits its turn on their next visit instead of two
  // modals fighting for the same screen.
  const welcomeCardShowing = !!trialStartedAt && !hasSeenWelcomeCard;
  const visible = !!profile && !profile.phone_number && !profile.has_seen_phone_prompt && !welcomeCardShowing;
  if (!visible) return null;

  const digits = localNumber.replace(/\D/g, "");
  const dialDigits = dialCode.replace(/\D/g, "").length;
  const valid = !!dialCode && digits.length >= 7 && (dialDigits + digits.length) <= 15;

  const markSeen = () => {
    // Same "never block the user, best-effort server write" discipline as
    // WelcomeCard's markWelcomeCardSeen — flips local state instantly so
    // the card closes right away regardless of network conditions.
    setProfile({ ...profile!, has_seen_phone_prompt: true });
    profileApi.markPhonePromptSeen().catch(() => {});
  };

  const handleSubmit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const phone_number = dialCode + digits;
      const res = await profileApi.update({ phone_number });
      setProfile(res.data);
      await profileApi.markPhonePromptSeen().catch(() => {});
      setProfile({ ...res.data, has_seen_phone_prompt: true });
    } catch {
      setError(t("phonePromptCard.error"));
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
    >
      <div
        className="w-full max-w-[440px] rounded-3xl overflow-y-auto"
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 60px rgba(0,185,109,0.08)",
          maxHeight: "92vh",
        }}
      >
        <div className="pt-7 px-8 flex flex-col items-center text-center gap-2.5">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "var(--grad-green)", boxShadow: "0 0 24px rgba(0,185,109,0.35)" }}
          >
            <Phone className="w-6 h-6" style={{ color: "var(--bg)" }} strokeWidth={2.5} />
          </div>
          <h1 className="font-black text-[20px]" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
            {t("phonePromptCard.title")}
          </h1>
          <p className="text-sm max-w-[320px]" style={{ color: "var(--sub)" }}>
            {t("phonePromptCard.subtitle")}
          </p>
        </div>

        <div className="px-8 pt-6">
          <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
            {t("phonePromptCard.phoneLabel")}
          </label>
          <div className="flex gap-2">
            <select
              value={dialCode}
              onChange={(e) => setDialCode(e.target.value)}
              className="rounded-xl border px-3 py-3 text-sm outline-none appearance-none shrink-0 w-[7.5rem]"
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: dialCode ? "var(--text)" : "var(--muted)" }}
            >
              <option value="">{t("onboarding.stepPhone.phoneCode")}</option>
              {DIAL_CODES.map((d) => (
                <option key={d.value} value={d.code}>{d.flag} {d.code}</option>
              ))}
            </select>
            <input
              value={localNumber}
              onChange={(e) => setLocalNumber(e.target.value)}
              type="tel"
              inputMode="tel"
              autoFocus
              className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none"
              placeholder={t("onboarding.stepPhone.phonePlaceholder")}
              style={{ background: "var(--raised)", borderColor: "var(--border)", color: "var(--text)" }}
            />
          </div>
          {error && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{error}</p>}
        </div>

        <div className="px-8 pt-6 pb-7 flex flex-col gap-2.5">
          <button
            onClick={handleSubmit}
            disabled={!valid || saving}
            className="w-full py-3.5 rounded-2xl font-black text-[14.5px] disabled:opacity-40"
            style={{ background: "var(--grad-green)", color: "var(--bg)", boxShadow: "0 4px 20px rgba(0,185,109,0.35)" }}
          >
            {saving ? t("phonePromptCard.saving") : t("phonePromptCard.save")}
          </button>
          <button
            onClick={markSeen}
            className="w-full py-2 text-center text-[12.5px] font-semibold"
            style={{ color: "var(--muted)" }}
          >
            {t("phonePromptCard.skip")}
          </button>
        </div>
      </div>
    </div>
  );
}
