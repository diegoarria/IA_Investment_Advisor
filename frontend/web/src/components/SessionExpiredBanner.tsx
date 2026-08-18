"use client";

import { useTranslation } from "react-i18next";
import { useAuthStore, useGuestGateStore } from "@/lib/store";

export default function SessionExpiredBanner() {
  const { t } = useTranslation();
  const { sessionExpired, setSessionExpired } = useAuthStore();
  const forceShowFlashcard = useGuestGateStore((s) => s.forceShowFlashcard);

  if (!sessionExpired) return null;

  // Clicking the banner itself (not the × dismiss) surfaces the signup
  // flashcard instead of just sitting there — Diego: "si le doy clic salte
  // el flashcard que creamos ahorita". forceShowFlashcard() bypasses the
  // guest-only check and the 5/day cap those exist for, since this person
  // isn't a browsing guest, they're a real user whose session just died.
  const handleBannerClick = () => forceShowFlashcard();

  return (
    <div
      onClick={handleBannerClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleBannerClick(); }}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "14px 20px",
        background: "#1a1d26",
        borderTop: "1px solid rgba(239,68,68,0.35)",
        boxShadow: "0 -8px 30px rgba(0,0,0,0.4)",
        animation: "slideUpBanner 0.25s ease",
        cursor: "pointer",
      }}
    >
      <style>{`
        @keyframes slideUpBanner {
          from { opacity: 0; transform: translateY(100%); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <span style={{ fontSize: 18 }}>⚠️</span>
      <p style={{ color: "#fff", fontSize: 13, fontWeight: 600, margin: 0, textAlign: "center" }}>
        {t("sessionExpiredBanner.message")}
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); setSessionExpired(false); }}
        style={{
          background: "none",
          border: "none",
          color: "#6b7280",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: 4,
          marginLeft: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}
