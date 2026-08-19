"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { Download, Share2, X } from "lucide-react";
import {
  ScreenPortada, ScreenNumeros, ScreenEvolucion, ScreenEstilo, ScreenMejorDecision,
  ScreenFavoritas, ScreenAprendizaje, ScreenComparacion, ScreenVsInversores,
  ScreenScore, ScreenProximoCapitulo, ScreenCompartir,
} from "./screens";
import { WrappedData, WT } from "./types";

// Same order as the approved design canvas. Each entry's `show` predicate
// mirrors that screen component's own `if (!x) return null` guard — kept
// here too so the progress bar/segment count reflects only the screens
// that will actually render, never an empty tap-through gap.
function buildScreens(data: WrappedData) {
  const all = [
    { key: "portada", show: true, Comp: ScreenPortada },
    { key: "numeros", show: true, Comp: ScreenNumeros },
    { key: "evolucion", show: !!(data.evolution && data.evolution.start_score !== undefined && data.evolution.end_score !== undefined), Comp: ScreenEvolucion },
    { key: "estilo", show: !!data.archetype, Comp: ScreenEstilo },
    { key: "mejor_decision", show: data.top_stocks.length > 0, Comp: ScreenMejorDecision },
    { key: "favoritas", show: data.favoritas.length > 0, Comp: ScreenFavoritas },
    { key: "aprendizaje", show: !!data.decisions_logged_this_year, Comp: ScreenAprendizaje },
    { key: "comparacion", show: data.growth_pct !== undefined && data.spy_ytd_pct !== undefined && data.spy_ytd_pct !== null, Comp: ScreenComparacion },
    { key: "vs_inversores", show: !!data.vs_community, Comp: ScreenVsInversores },
    { key: "score", show: !!data.investor_score, Comp: ScreenScore },
    { key: "proximo", show: true, Comp: ScreenProximoCapitulo },
  ] as const;
  return all.filter((s) => s.show);
}

export default function WrappedFlow({ data, onClose }: { data: WrappedData; onClose: () => void }) {
  const screens = buildScreens(data);
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
            <div ref={shareRef} style={{ width: "100%", height: "100%" }}>
              <ScreenCompartir data={data} />
            </div>
          ) : (
            (() => {
              const { Comp } = screens[index];
              return <Comp data={data} total={total} page={index + 1} />;
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
    </div>
  );
}
