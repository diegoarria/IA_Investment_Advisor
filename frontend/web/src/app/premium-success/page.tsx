"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSubscriptionStore } from "@/lib/store";
import { CheckCircle, Loader2 } from "lucide-react";

export default function PremiumSuccessPage() {
  const router = useRouter();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const tier = useSubscriptionStore((s) => s.tier);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Poll until the webhook has been processed and tier flips to premium
    let attempts = 0;
    const poll = async () => {
      await fetchStatus();
      attempts++;
      const current = useSubscriptionStore.getState().tier;
      if (current === "premium" || attempts >= 8) {
        setReady(true);
        setTimeout(() => router.replace("/chat"), 2500);
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
              ¡Bienvenido a Nuvos Premium!
            </h1>
            <p style={{ color: "#9ca3af", fontSize: "15px", margin: 0 }}>
              Tu cuenta ya está activa. Redirigiendo...
            </p>
          </div>
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
              "Chat ilimitado con tu asesor IA",
              "Análisis avanzado de portafolio",
              "Screener premium sin límites",
              "Emails semanales personalizados",
            ].map((feat) => (
              <div key={feat} style={{ display: "flex", alignItems: "center", gap: "10px", color: "#d1fae5", fontSize: "14px" }}>
                <CheckCircle size={16} color="#22c55e" />
                {feat}
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <Loader2 size={48} color="#22c55e" strokeWidth={1.5} className="animate-spin" style={{ animation: "spin 1s linear infinite" }} />
          <p style={{ color: "#9ca3af", fontSize: "15px", margin: 0 }}>
            Activando tu cuenta premium...
          </p>
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </main>
  );
}
