"use client";

import { useEffect, useState, useCallback } from "react";
import { setNetworkErrorHandler, clearNetworkErrorHandler } from "@/lib/api";

export default function NetworkToast() {
  const [toast, setToast] = useState<{ msg: string; key: number } | null>(null);

  const show = useCallback((offline: boolean) => {
    const msg = offline
      ? "Sin conexión a internet. Verifica tu red e inténtalo de nuevo."
      : "Algo salió mal. Inténtalo de nuevo.";
    setToast({ msg, key: Date.now() });
  }, []);

  useEffect(() => {
    setNetworkErrorHandler(show);
    return () => clearNetworkErrorHandler();
  }, [show]);

  // Auto-dismiss after 4 s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast?.key]);

  if (!toast) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "#1e2130",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 14,
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        animation: "slideUp 0.25s ease",
        maxWidth: "calc(100vw - 48px)",
      }}
    >
      <span style={{ fontSize: 18 }}>📡</span>
      <span style={{ color: "#e5e7eb", fontSize: 14, fontWeight: 500 }}>{toast.msg}</span>
      <button
        onClick={() => setToast(null)}
        style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", padding: "0 0 0 8px", fontSize: 16 }}
      >
        ✕
      </button>
      <style>{`@keyframes slideUp { from { opacity:0; transform:translateX(-50%) translateY(12px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>
    </div>
  );
}
