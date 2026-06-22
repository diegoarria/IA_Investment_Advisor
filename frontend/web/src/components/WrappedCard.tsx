"use client";

import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";

interface WrappedData {
  year: number;
  user_name: string;
  top_stocks: { ticker: string; ytd_pct: number }[];
  lessons: number;
  days_active: number;
  top_sector: string;
  sim_count: number;
  debate_count: number;
}

interface WrappedCardProps {
  onClose: () => void;
}

export default function WrappedCard({ onClose }: WrappedCardProps) {
  const [data, setData] = useState<WrappedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get("/api/wrapped/annual")
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const slides = data ? [
    "cover",
    "stocks",
    "lessons",
    "sector",
  ] : [];

  const next = () => setSlide((s) => Math.min(s + 1, slides.length - 1));
  const prev = () => setSlide((s) => Math.max(s - 1, 0));

  const handleShare = async () => {
    try {
      await navigator.share({
        title: `Mi Nuvos Wrapped ${data?.year}`,
        text: `Este año completé ${data?.lessons} lecciones en Nuvos AI 🚀`,
      });
    } catch {}
  };

  if (loading) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.9)" }}>
      <div style={{ color: "#00d47e", fontSize: 14 }}>Cargando tu Wrapped…</div>
    </div>
  );

  if (!data) return null;

  const formatPct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
  const isLast = slide === slides.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Card */}
      <div
        ref={cardRef}
        style={{
          width: 360,
          height: 640,
          borderRadius: 28,
          overflow: "hidden",
          position: "relative",
          userSelect: "none",
        }}
      >
        {/* ── SLIDE 0: COVER ─────────────────────────────────── */}
        {slide === 0 && (
          <div style={{
            width: "100%", height: "100%",
            background: "linear-gradient(160deg, #0d1117 0%, #111827 50%, #0d1117 100%)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "space-between",
            padding: "48px 32px 40px",
            position: "relative",
          }}>
            {/* BG decoration */}
            <div style={{ position: "absolute", top: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "rgba(0,212,126,0.06)" }} />
            <div style={{ position: "absolute", bottom: -80, left: -80, width: 280, height: 280, borderRadius: "50%", background: "rgba(0,212,126,0.04)" }} />

            {/* Logo + name */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, zIndex: 1 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "#00d47e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "#0d1117" }}>N</div>
              <span style={{ color: "#fff", fontSize: 17, fontWeight: 900, letterSpacing: -0.3 }}>Nuvos AI</span>
            </div>

            {/* Year big */}
            <div style={{ textAlign: "center", zIndex: 1 }}>
              <div style={{ fontSize: 110, fontWeight: 900, lineHeight: 1, color: "#00d47e", letterSpacing: -6, opacity: 0.12, position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", whiteSpace: "nowrap" }}>
                {data.year}
              </div>
              <div style={{ fontSize: 13, color: "#6b7280", letterSpacing: 0.1, marginBottom: 8, textTransform: "uppercase" }}>Tu año en</div>
              <div style={{ fontSize: 42, fontWeight: 900, color: "#fff", lineHeight: 1.1, letterSpacing: -1.5 }}>Nuvos<br />Wrapped</div>
              <div style={{ fontSize: 13, color: "#00d47e", fontWeight: 700, marginTop: 10 }}>{data.year}</div>
            </div>

            {/* User name */}
            <div style={{ textAlign: "center", zIndex: 1 }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Resumen de</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>{data.user_name}</div>
            </div>
          </div>
        )}

        {/* ── SLIDE 1: TOP STOCKS ────────────────────────────── */}
        {slide === 1 && (
          <div style={{
            width: "100%", height: "100%",
            background: "linear-gradient(160deg, #0d1117 0%, #0f2818 100%)",
            display: "flex", flexDirection: "column",
            padding: "48px 32px 40px",
            position: "relative",
          }}>
            <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(0,212,126,0.08)" }} />

            <div style={{ fontSize: 11, color: "#00d47e", fontWeight: 900, letterSpacing: 0.1, textTransform: "uppercase", marginBottom: 8 }}>Tus mejores inversiones</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: "#fff", lineHeight: 1.15, marginBottom: 36 }}>Top 3 acciones<br />del año 🚀</div>

            {data.top_stocks.length === 0 ? (
              <div style={{ color: "#6b7280", fontSize: 14 }}>Agrega acciones a tu portafolio para ver este dato el próximo año.</div>
            ) : (
              data.top_stocks.map((s, i) => (
                <div key={s.ticker} style={{
                  display: "flex", alignItems: "center", gap: 16,
                  marginBottom: 20,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: "rgba(255,255,255,0.15)", width: 36, textAlign: "center" }}>{i + 1}</div>
                  <div style={{
                    flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "rgba(0,212,126,0.07)", border: "1px solid rgba(0,212,126,0.18)",
                    borderRadius: 16, padding: "14px 18px",
                  }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>{s.ticker}</div>
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>Rendimiento YTD</div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: s.ytd_pct >= 0 ? "#00d47e" : "#ef4444" }}>
                      {formatPct(s.ytd_pct)}
                    </div>
                  </div>
                </div>
              ))
            )}

            {/* Logo small */}
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: "#00d47e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: "#0d1117" }}>N</div>
              <span style={{ color: "#374151", fontSize: 12, fontWeight: 700 }}>Nuvos AI</span>
            </div>
          </div>
        )}

        {/* ── SLIDE 2: LESSONS + TIME ────────────────────────── */}
        {slide === 2 && (
          <div style={{
            width: "100%", height: "100%",
            background: "linear-gradient(160deg, #0d1117 0%, #1a0d2e 100%)",
            display: "flex", flexDirection: "column",
            padding: "48px 32px 40px",
            position: "relative",
          }}>
            <div style={{ position: "absolute", top: -40, left: -40, width: 220, height: 220, borderRadius: "50%", background: "rgba(139,92,246,0.08)" }} />

            <div style={{ fontSize: 11, color: "#8b5cf6", fontWeight: 900, letterSpacing: 0.1, textTransform: "uppercase", marginBottom: 8 }}>Tu actividad</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: "#fff", lineHeight: 1.15, marginBottom: 40 }}>Nunca dejaste<br />de aprender 🧠</div>

            {/* Big stat: lessons */}
            <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 20, padding: "24px 24px", marginBottom: 16 }}>
              <div style={{ fontSize: 64, fontWeight: 900, color: "#8b5cf6", lineHeight: 1 }}>{data.lessons}</div>
              <div style={{ fontSize: 16, color: "#e5e7eb", fontWeight: 700, marginTop: 4 }}>lecciones completadas</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                {data.sim_count} simulaciones · {data.debate_count} debates
              </div>
            </div>

            {/* Days */}
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "16px 18px" }}>
                <div style={{ fontSize: 36, fontWeight: 900, color: "#fff" }}>{data.days_active}</div>
                <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>días en plataforma</div>
              </div>
            </div>

            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: "#00d47e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: "#0d1117" }}>N</div>
              <span style={{ color: "#374151", fontSize: 12, fontWeight: 700 }}>Nuvos AI</span>
            </div>
          </div>
        )}

        {/* ── SLIDE 3: SECTOR + CTA ─────────────────────────── */}
        {slide === 3 && (
          <div style={{
            width: "100%", height: "100%",
            background: "linear-gradient(160deg, #0d1117 0%, #0f1a2e 100%)",
            display: "flex", flexDirection: "column",
            padding: "48px 32px 40px",
            position: "relative",
          }}>
            <div style={{ position: "absolute", bottom: -60, right: -60, width: 240, height: 240, borderRadius: "50%", background: "rgba(59,130,246,0.07)" }} />

            <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 900, letterSpacing: 0.1, textTransform: "uppercase", marginBottom: 8 }}>Tu perfil</div>
            <div style={{ fontSize: 34, fontWeight: 900, color: "#fff", lineHeight: 1.15, marginBottom: 36 }}>Tu sector<br />favorito 🏆</div>

            <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 20, padding: "28px 24px", marginBottom: 24, textAlign: "center" }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: "#3b82f6", lineHeight: 1.1 }}>{data.top_sector}</div>
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>Sector con mayor exposición en tu portafolio</div>
            </div>

            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>{data.user_name} · Nuvos Wrapped {data.year}</div>
            </div>

            {/* Share */}
            <button
              onClick={handleShare}
              style={{
                width: "100%", padding: "14px", borderRadius: 16,
                background: "linear-gradient(135deg, #00d47ecc, #00d47e)",
                color: "#fff", fontWeight: 900, fontSize: 15,
                border: "none", cursor: "pointer", marginBottom: 12,
                boxShadow: "0 4px 20px rgba(0,212,126,0.35)",
              }}
            >
              Compartir mi Wrapped ✨
            </button>

            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: "#00d47e", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12, color: "#0d1117" }}>N</div>
              <span style={{ color: "#374151", fontSize: 12, fontWeight: 700 }}>Nuvos AI</span>
            </div>
          </div>
        )}

        {/* ── Navigation tap zones ──────────────────────────── */}
        <div style={{ position: "absolute", inset: 0, display: "flex", zIndex: 10 }}>
          <div style={{ flex: 1, cursor: slide > 0 ? "pointer" : "default" }} onClick={prev} />
          <div style={{ flex: 1, cursor: isLast ? "default" : "pointer" }} onClick={isLast ? undefined : next} />
        </div>

        {/* ── Progress bars ─────────────────────────────────── */}
        <div style={{ position: "absolute", top: 16, left: 16, right: 16, display: "flex", gap: 4, zIndex: 20 }}>
          {slides.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= slide ? "#00d47e" : "rgba(255,255,255,0.2)" }} />
          ))}
        </div>

        {/* ── Close ─────────────────────────────────────────── */}
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 32, right: 16, zIndex: 30, background: "rgba(0,0,0,0.4)", border: "none", color: "#fff", borderRadius: 10, width: 28, height: 28, cursor: "pointer", fontSize: 14 }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
