"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { Download, Share2, X } from "lucide-react";
import {
  ScreenPersonalidad, ScreenNumeros, ScreenPercentil, ScreenEmpresaFavorita,
  ScreenTopPosiciones, ScreenPeorDecision, ScreenTipoInversionista, ScreenCompartir,
} from "./screens";
import { WrappedData, WT } from "./types";

// Exactly these 7 content screens, always, in this order, plus the
// Compartir closer — the spec is explicit that Wrapped has 8 screens, no
// more, no fewer. A user missing the data for one (e.g. brand new, no
// portfolio) still sees all 7 — each screen renders its own empty state
// internally instead of the flow skipping it.
const SCREENS = [
  ScreenPersonalidad, ScreenNumeros, ScreenPercentil, ScreenEmpresaFavorita,
  ScreenTopPosiciones, ScreenPeorDecision, ScreenTipoInversionista,
] as const;

// Curiosity-driving teaser for "what's next" — shown bouncing at the bottom
// of each screen (Stage's nextLabel) so tapping through builds toward
// something instead of just paging a report (Diego, 2026-08-20: "que
// mantengan intrigados a los usuarios"). Index i is the teaser for the
// screen that comes AFTER SCREENS[i], i.e. what you see while on screen i.
const NEXT_TEASERS = [
  "Tu año, medido 📊",
  "¿Qué tan arriba estás? 🏆",
  "Tu empresa favorita 🏢",
  "Tus mejores jugadas 📈",
  "Tu peor decisión 😬",
  "¿Qué tipo de inversionista eres? 🎯",
  "Tu tarjeta para compartir 🎉",
] as const;

export default function WrappedFlow({ data, onClose }: { data: WrappedData; onClose: () => void }) {
  const screens = SCREENS;
  const total = screens.length + 1; // +1 for the always-shown Compartir closer
  const [index, setIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  const isLast = index === screens.length;
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, screens.length)), [screens.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Desktop keyboard support — mirrors the tap zones (Right/Down = next,
  // Left/Up = prev, Escape = close), same story-viewer convention as
  // Instagram/Spotify Wrapped's own web players.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next();
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") prev();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, prev, onClose]);

  const captureShareImage = useCallback(async (): Promise<Blob | null> => {
    if (!shareRef.current) return null;
    // useCORS lets the Nuvos logo and ticker logos (both loaded with
    // crossOrigin="anonymous") actually paint into the exported canvas
    // instead of leaving blank squares where they were.
    const canvas = await html2canvas(shareRef.current, { backgroundColor: "#03060e", scale: 2, useCORS: true });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }, []);

  const handleDownload = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await captureShareImage();
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nuvos-wrapped-${data.year}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [captureShareImage, data.year]);

  const handleShare = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await captureShareImage();
      if (!blob) return;
      const file = new File([blob], `nuvos-wrapped-${data.year}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Nuvos AI Investor Wrapped", text: `Mi ${data.year} como inversionista con Nuvos AI #NuvosInvestor` });
      } else {
        await handleDownload();
      }
    } catch {
      // user cancelled the share sheet — not an error
    } finally {
      setExporting(false);
    }
  }, [captureShareImage, data.year, handleDownload]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 430, height: "100%", maxHeight: 900, background: WT.bg, overflow: "hidden", borderRadius: 0 }}>
        {/* Progress segments */}
        <div style={{ position: "absolute", top: 10, left: 12, right: 12, display: "flex", gap: 4, zIndex: 10 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 100, background: i <= index ? WT.accentL : "rgba(255,255,255,0.15)" }} />
          ))}
        </div>

        <button
          onClick={onClose}
          style={{ position: "absolute", top: 16, right: 12, zIndex: 20, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 10, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <X size={16} color="#fff" />
        </button>

        {/* Tap zones */}
        <button aria-label="Anterior" onClick={prev} style={{ position: "absolute", left: 0, top: 0, width: "35%", height: "100%", zIndex: 8, background: "transparent", border: "none", cursor: "pointer" }} />
        <button aria-label="Siguiente" onClick={next} style={{ position: "absolute", right: 0, top: 0, width: "35%", height: "100%", zIndex: 8, background: "transparent", border: "none", cursor: isLast ? "default" : "pointer" }} disabled={isLast} />

        <div style={{ width: "100%", height: "100%" }}>
          {isLast ? (
            <ScreenCompartir data={data} />
          ) : (
            (() => {
              const Comp = screens[index];
              return <Comp data={data} total={total} page={index + 1} nextLabel={NEXT_TEASERS[index]} />;
            })()
          )}
        </div>

        {isLast && (
          <div style={{ position: "absolute", bottom: 24, left: 20, right: 20, display: "flex", gap: 10, zIndex: 20 }}>
            <button
              onClick={handleDownload}
              disabled={exporting}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 100, background: WT.card2, border: `1.5px solid ${WT.border}`, color: WT.text, fontWeight: 700, fontSize: 13, cursor: "pointer" }}
            >
              <Download size={15} /> Descargar
            </button>
            <button
              onClick={handleShare}
              disabled={exporting}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 13, cursor: "pointer" }}
            >
              <Share2 size={15} /> Compartir
            </button>
          </div>
        )}
      </div>

      {/* Off-screen, fixed-size (430x900), never-clipped clone of the share
          card — the ONLY thing html2canvas actually captures. The on-screen
          card above lives inside a chain of height:100% boxes under a
          position:fixed root, so its real pixel height follows whatever the
          device's actual viewport happens to be; on a shorter phone
          viewport that's less tall than the card's natural content height,
          the ancestor's overflow:hidden clips it — invisibly, since it
          still looks fine live (the visible portion is centered and
          nothing looks obviously cut) but the html2canvas export bakes in
          that same clip, so everything past whatever fit in that shorter
          viewport (confirmed live, 2026-08-2x: everything below the
          rendimiento number) never made it into the downloaded PNG. This
          clone always has the full fixed-size canvas worth of unclipped
          room, independent of the real device viewport. */}
      {isLast && (
        <div
          ref={shareRef}
          aria-hidden="true"
          style={{ position: "fixed", left: -9999, top: 0, width: 430, height: 900, overflow: "visible", pointerEvents: "none" }}
        >
          <ScreenCompartir data={data} staticMode />
        </div>
      )}
    </div>
  );
}
