"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";

interface WrappedCardProps {
  onClose: () => void;
}

interface WrappedData {
  year: number;
  user_name: string;
  top_stocks: { ticker: string; ytd_pct: number }[];
  lessons: number;
  days_active: number;
  top_sector: string;
  growth_pct?: number;
  milestones_this_year?: { title: string; description?: string }[];
  decisions_logged_this_year?: number;
  diversification_note?: string;
}

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

export default function WrappedCard({ onClose }: WrappedCardProps) {
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    api.get("/api/wrapped/annual")
      .then((res) => setData(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const hasProgress = !!(data && (data.growth_pct !== undefined || data.milestones_this_year?.length || data.decisions_logged_this_year));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: 380,
          maxHeight: "88vh",
          borderRadius: 28,
          overflow: "hidden",
          position: "relative",
          background: "linear-gradient(160deg, #0d1117 0%, #0f1a2e 100%)",
          border: "1px solid rgba(0,212,126,0.2)",
          boxShadow: "0 0 60px rgba(0,212,126,0.12), 0 25px 50px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ height: 4, background: "linear-gradient(90deg, #00d47e99, #00d47e)", flexShrink: 0 }} />

        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 20, right: 16, zIndex: 10,
            background: "rgba(0,0,0,0.4)", border: "none", color: "#fff",
            borderRadius: 10, width: 28, height: 28, cursor: "pointer", fontSize: 14,
          }}
        >✕</button>

        <div style={{ padding: "32px 32px 36px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#00d47e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "#0d1117", flexShrink: 0 }}>N</div>
            <span style={{ color: "#fff", fontSize: 16, fontWeight: 900, letterSpacing: -0.3 }}>Nuvos AI</span>
          </div>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0", gap: 12 }}>
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: "#00d47e" }} />
              <span style={{ color: "#8fa3c0", fontSize: 13 }}>Preparando tu ScoreBoard…</span>
            </div>
          ) : error || !data ? (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <span style={{ color: "#8fa3c0", fontSize: 13 }}>No se pudo cargar tu ScoreBoard.</span>
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 11, color: "#00d47e", fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                  Tu año en
                </div>
                <div style={{ fontSize: 32, fontWeight: 900, color: "#fff", lineHeight: 1.1, letterSpacing: -1.5 }}>
                  Annual<br />ScoreBoard
                </div>
                <div style={{ fontSize: 14, color: "#00d47e", fontWeight: 700, marginTop: 8 }}>{data.user_name} · {data.year}</div>
              </div>

              {/* Progress (Investor Progress Engine) */}
              {hasProgress && (
                <div style={{ background: "rgba(0,212,126,0.06)", border: "1px solid rgba(0,212,126,0.18)", borderRadius: 20, padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  {data.growth_pct !== undefined && (
                    <div>
                      <div style={{ fontSize: 34, fontWeight: 900, color: "#00d47e", lineHeight: 1.1 }}>{fmtPct(data.growth_pct)}</div>
                      <div style={{ fontSize: 13, color: "#e5e7eb", fontWeight: 700 }}>creció tu patrimonio este año</div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10 }}>
                    {!!data.milestones_this_year?.length && (
                      <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 12 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{data.milestones_this_year.length}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>hitos alcanzados</div>
                      </div>
                    )}
                    {!!data.decisions_logged_this_year && (
                      <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 12 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{data.decisions_logged_this_year}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>decisiones registradas</div>
                      </div>
                    )}
                  </div>
                  {data.diversification_note && (
                    <div style={{ fontSize: 12, color: "#8fa3c0", lineHeight: 1.5 }}>{data.diversification_note}</div>
                  )}
                </div>
              )}

              {/* Top stocks */}
              {data.top_stocks.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 900, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>
                    🚀 Tus mejores acciones
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {data.top_stocks.map((st, i) => (
                      <div key={st.ticker} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,212,126,0.07)", border: "1px solid rgba(0,212,126,0.18)", borderRadius: 14, padding: "10px 14px" }}>
                        <span style={{ fontSize: 15, fontWeight: 900, color: "#fff" }}>{i + 1}. {st.ticker}</span>
                        <span style={{ fontSize: 15, fontWeight: 900, color: st.ytd_pct >= 0 ? "#00d47e" : "#ef4444" }}>{fmtPct(st.ytd_pct)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Lessons / days / sector */}
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#8b5cf6" }}>{data.lessons}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>lecciones</div>
                </div>
                <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", borderRadius: 14, padding: 12 }}>
                  <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>{data.days_active}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>días activo</div>
                </div>
              </div>
              {data.top_sector && (
                <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 14, padding: 12, textAlign: "center" }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#3b82f6" }}>{data.top_sector}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>sector con mayor exposición</div>
                </div>
              )}
            </>
          )}

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
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
