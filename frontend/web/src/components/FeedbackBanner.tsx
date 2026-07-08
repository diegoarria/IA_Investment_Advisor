"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSupabaseClient } from "@/lib/supabase";
import api from "@/lib/api";

const STORAGE_KEY = "nuvos_feedback_checked_at";

export default function FeedbackBanner() {
  const { t } = useTranslation();
  const [visible, setVisible]     = useState(false);
  const [rating, setRating]       = useState(0);
  const [hovered, setHovered]     = useState(0);
  const [message, setMessage]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]           = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const { data: { user } } = await getSupabaseClient().auth.getUser();
        if (!user) return;

        // Throttle: only call backend once per session
        const lastCheck = localStorage.getItem(STORAGE_KEY);
        if (lastCheck && Date.now() - Number(lastCheck) < 1000 * 60 * 60 * 4) return;
        localStorage.setItem(STORAGE_KEY, String(Date.now()));

        const res = await api.get("/api/feedback/status");
        if (res.data?.should_show) {
          setTimeout(() => setVisible(true), 2000);
        }
      } catch {
        // silent
      }
    };
    check();
  }, []);

  const handleDismiss = async () => {
    setVisible(false);
    try { await api.post("/api/feedback/seen"); } catch {}
  };

  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      await api.post("/api/feedback/submit", { rating, message: message.trim() || null });
      setDone(true);
      setTimeout(() => setVisible(false), 2500);
    } catch {
      setSubmitting(false);
    }
  };

  if (!visible) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 9999,
      width: 320,
      background: "var(--card, #1a1d26)",
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 20,
      padding: "20px 20px 16px",
      boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
      display: "flex",
      flexDirection: "column",
      gap: 14,
      animation: "slideUp 0.3s ease",
    }}>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {done ? (
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🙌</div>
          <p style={{ color: "#fff", fontWeight: 700, fontSize: 15, margin: 0 }}>{t("feedbackBanner.thanks")}</p>
          <p style={{ color: "#6b7280", fontSize: 13, margin: "4px 0 0" }}>{t("feedbackBanner.thanksSub")}</p>
        </div>
      ) : (
        <>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <p style={{ color: "#fff", fontWeight: 800, fontSize: 15, margin: 0 }}>{t("feedbackBanner.howIsItGoing")}</p>
              <p style={{ color: "#6b7280", fontSize: 12, margin: "3px 0 0" }}>{t("feedbackBanner.takesSeconds")}</p>
            </div>
            <button onClick={handleDismiss} style={{
              background: "none", border: "none", color: "#4b5563",
              cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 2,
            }}>×</button>
          </div>

          {/* Stars */}
          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onMouseEnter={() => setHovered(s)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(s)}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 30, padding: 2, lineHeight: 1,
                  filter: s <= (hovered || rating)
                    ? "brightness(1)"
                    : "brightness(0.35)",
                  transform: s <= (hovered || rating) ? "scale(1.15)" : "scale(1)",
                  transition: "all 0.15s ease",
                }}
              >
                ⭐
              </button>
            ))}
          </div>

          {/* Text area — only show once a star is selected */}
          {rating > 0 && (
            <textarea
              placeholder={t("feedbackBanner.placeholder")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                color: "#fff",
                fontSize: 13,
                padding: "10px 12px",
                resize: "none",
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleDismiss} style={{
              flex: 1,
              padding: "10px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "#6b7280",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}>
              {t("feedbackBanner.notNow")}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!rating || submitting}
              style={{
                flex: 2,
                padding: "10px",
                borderRadius: 12,
                border: "none",
                background: !rating ? "rgba(0,212,126,0.2)" : "linear-gradient(135deg, #00d47ecc, #00d47e)",
                color: !rating ? "#4b5563" : "#fff",
                fontSize: 13,
                fontWeight: 800,
                cursor: !rating ? "not-allowed" : "pointer",
                transition: "all 0.2s",
              }}
            >
              {submitting ? t("feedbackBanner.sending") : t("feedbackBanner.sendFeedback")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
