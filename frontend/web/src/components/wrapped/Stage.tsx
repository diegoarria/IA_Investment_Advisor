"use client";

import Image from "next/image";
import { WT } from "./types";

/** Shared full-bleed 9:16 chrome every Wrapped screen sits inside — brand
 * lockup top-left, page counter top-right, footer tagline, an animated
 * accent glow background, and (except on the last, chrome-less share
 * screen) a bouncing "sigue: ..." teaser for the next screen so tapping
 * through feels like it's building toward something instead of just
 * paging through a report. Mirrors the approved design canvas 1:1. */
export default function Stage({
  page, total, glow, children, noChrome, nextLabel,
}: {
  page: number;
  total: number;
  glow?: "top" | "bottom" | "center";
  children: React.ReactNode;
  noChrome?: boolean;
  /** Short, curiosity-driving label for the screen that comes after this
   * one — shown as a bouncing "SIGUE: ..." hint above the footer. Omit on
   * the last content screen (nothing to tease). */
  nextLabel?: string;
}) {
  const glowPos = glow === "bottom" ? "50% 110%" : glow === "center" ? "50% 50%" : "50% -10%";
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: WT.bg,
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-body), 'DM Sans', system-ui, sans-serif",
      }}
    >
      {/* Living background glow — subtly breathes instead of sitting static,
          so the stage itself never feels inert even before content reveals. */}
      <div
        className="animate-glow-breathe"
        style={{
          position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
          background: `radial-gradient(ellipse 900px 700px at ${glowPos}, rgba(0,185,109,0.16) 0%, rgba(0,185,109,0) 60%)`,
        }}
      />
      {!noChrome && (
        <>
          <div style={{ position: "absolute", top: 28, left: 28, display: "flex", alignItems: "center", gap: 10, zIndex: 5 }}>
            <Image src="/logo.png" alt="Nuvos AI" width={30} height={30} style={{ borderRadius: 8 }} />
            <span style={{ fontWeight: 800, fontSize: 15, color: WT.text }}>NUVOS AI</span>
          </div>
          <div style={{ position: "absolute", top: 33, right: 28, fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: WT.muted, zIndex: 5 }}>
            {String(page).padStart(2, "0")} / {total}
          </div>
        </>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 28px", position: "relative", zIndex: 3 }}>
        {children}
      </div>
      {!noChrome && nextLabel && (
        <div
          className="animate-fade-in animate-float"
          style={{
            position: "absolute", bottom: 46, left: 0, right: 0, zIndex: 5,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            animationDelay: "900ms", animationFillMode: "both",
          }}
        >
          <span style={{ fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 10, color: WT.accentL, letterSpacing: 1, textTransform: "uppercase" }}>
            Sigue
          </span>
          <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 12, color: WT.sub }}>
            {nextLabel}
          </span>
        </div>
      )}
      {!noChrome && (
        <div style={{ position: "absolute", bottom: 22, left: 0, right: 0, textAlign: "center", fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 10, color: WT.dim, letterSpacing: 1, zIndex: 5 }}>
          NUVOS AI · TU AÑO COMO INVERSIONISTA
        </div>
      )}
    </div>
  );
}
