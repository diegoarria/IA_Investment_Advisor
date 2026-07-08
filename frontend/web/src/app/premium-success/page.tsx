"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "@/lib/store";
import { CheckCircle, Loader2 } from "lucide-react";

const CALENDLY_URL = "https://calendly.com/diego-arria19/sesion-1-1-con-diego-nuvos-ai";

export default function PremiumSuccessPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const tier = useSubscriptionStore((s) => s.tier);
  const [ready, setReady] = useState(false);
  const [isSession, setIsSession] = useState(false);

  useEffect(() => {
    const pendingSession = localStorage.getItem("nuvos_pending_session") === "1";
    if (pendingSession) {
      setIsSession(true);
      localStorage.removeItem("nuvos_pending_session");
    }

    // Poll until the webhook has been processed and tier flips to premium
    let attempts = 0;
    const poll = async () => {
      await fetchStatus();
      attempts++;
      const current = useSubscriptionStore.getState().tier;
      if (current === "premium" || attempts >= 8) {
        setReady(true);
        if (!pendingSession) {
          setTimeout(() => router.replace("/chat"), 2500);
        }
      } else {
        setTimeout(poll, 1500);
      }
    };
    poll();
  }, [fetchStatus, router]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg, #0f1117)",
        gap: "24px",
        padding: "40px 20px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {ready ? (
        <>
          <CheckCircle size={64} color="#22c55e" strokeWidth={1.5} />
          <div style={{ textAlign: "center" }}>
            <h1 style={{ color: "#fff", fontSize: "28px", fontWeight: 800, margin: "0 0 8px" }}>
              {isSession ? t("premiumSuccess.sessionBookedTitle") : t("premiumSuccess.welcomeTitle")}
            </h1>
            <p style={{ color: "#9ca3af", fontSize: "15px", margin: 0 }}>
              {isSession
                ? t("premiumSuccess.sessionBookedDesc")
                : t("premiumSuccess.welcomeDesc")}
            </p>
          </div>

          {isSession ? (
            <a
              href={CALENDLY_URL}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "10px",
                background: "#00d47e",
                color: "#fff",
                fontWeight: 800,
                fontSize: "16px",
                padding: "16px 32px",
                borderRadius: "16px",
                textDecoration: "none",
                marginTop: "8px",
              }}
            >
              {t("premiumSuccess.bookSlot")}
            </a>
          ) : (
            <div
              style={{
                background: "rgba(34,197,94,0.08)",
                border: "1px solid rgba(34,197,94,0.3)",
                borderRadius: "16px",
                padding: "20px 28px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                maxWidth: "360px",
                width: "100%",
              }}
            >
              {[
                t("premiumSuccess.features.unlimitedChat"),
                t("premiumSuccess.features.advancedAnalysis"),
                t("premiumSuccess.features.premiumScreener"),
                t("premiumSuccess.features.weeklyEmails"),
              ].map((feat) => (
                <div key={feat} style={{ display: "flex", alignItems: "center", gap: "10px", color: "#d1fae5", fontSize: "14px" }}>
                  <CheckCircle size={16} color="#22c55e" />
                  {feat}
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Loader2 size={48} color="#22c55e" strokeWidth={1.5} className="animate-spin" style={{ animation: "spin 1s linear infinite" }} />
          <p style={{ color: "#9ca3af", fontSize: "15px", margin: 0 }}>
            {t("premiumSuccess.activating")}
          </p>
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
