"use client";

import { useEffect, useRef, useState } from "react";

interface WrappedCardProps {
  onClose: () => void;
}

export default function WrappedCard({ onClose }: WrappedCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const year = new Date().getFullYear();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={cardRef}
        style={{
          width: 360,
          borderRadius: 28,
          overflow: "hidden",
          position: "relative",
          background: "linear-gradient(160deg, #0d1117 0%, #0f1a2e 100%)",
          border: "1px solid rgba(0,212,126,0.2)",
          boxShadow: "0 0 60px rgba(0,212,126,0.12), 0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        {/* Top accent bar */}
        <div style={{ height: 4, background: "linear-gradient(90deg, #00d47e99, #00d47e)" }} />

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 20, right: 16, zIndex: 10,
            background: "rgba(0,0,0,0.4)", border: "none", color: "#fff",
            borderRadius: 10, width: 28, height: 28, cursor: "pointer", fontSize: 14,
          }}
        >✕</button>

        <div style={{ padding: "32px 32px 36px", display: "flex", flexDirection: "column", gap: 28 }}>

          {/* Logo + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#00d47e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "#0d1117", flexShrink: 0 }}>N</div>
            <span style={{ color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: -0.3 }}>Nuvos AI</span>
          </div>

          {/* Main content */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Title */}
            <div>
              <div style={{ fontSize: 11, color: "#00d47e", fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                Próximamente
              </div>
              <div style={{ fontSize: 36, fontWeight: 900, color: "#fff", lineHeight: 1.1, letterSpacing: -1.5 }}>
                Annual<br />ScoreBoard
              </div>
              <div style={{ fontSize: 14, color: "#00d47e", fontWeight: 700, marginTop: 8 }}>{year}</div>
            </div>

            {/* Countdown card */}
            <div style={{
              background: "rgba(0,212,126,0.06)", border: "1px solid rgba(0,212,126,0.18)",
              borderRadius: 20, padding: "24px",
            }}>
              <div style={{ fontSize: 32 }}>📅</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#fff", marginTop: 12, lineHeight: 1.4 }}>
                Tu Annual ScoreBoard estará disponible en diciembre {year}
              </div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8, lineHeight: 1.6 }}>
                Sigue acumulando historial inversionista — cada lección que tomes este año quedará registrada en tu resumen anual.
              </div>
            </div>

            {/* What's coming */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { icon: "🚀", text: "Top 3 acciones de tu portafolio con mejor rendimiento" },
                { icon: "🧠", text: "Total de lecciones completadas" },
                { icon: "🏆", text: "Tu sector de mayor exposición" },
                { icon: "📊", text: "Días activo en la plataforma" },
              ].map(({ icon, text }) => (
                <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 13, color: "#8fa3c0", lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTA */}
          <button
            onClick={onClose}
            style={{
              width: "100%", padding: "14px", borderRadius: 16,
              background: "linear-gradient(135deg, #00d47ecc, #00d47e)",
              color: "#fff", fontWeight: 900, fontSize: 15,
              border: "none", cursor: "pointer",
              boxShadow: "0 4px 20px rgba(0,212,126,0.35)",
            }}
          >
            ¡Lo espero con ansias! 🎯
          </button>
        </div>
      </div>
    </div>
  );
}
