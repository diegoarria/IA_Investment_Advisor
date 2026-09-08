"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { Download, Share2, X, ChevronLeft, ChevronRight } from "lucide-react";
import posthog from "posthog-js";
import {
  ScreenPortada, ScreenPortafolio, ScreenDecisiones, ScreenInvestigacion,
  ScreenPatrimonio, ScreenHabitos, ScreenEvolucion, ScreenProximoMes,
  ScreenLogros, ScreenCompartir,
} from "./screens";
import { InvestorRecapData, WT } from "./types";

// Exactly these 9 content screens (Overview counts as the "portada" —
// spec calls it screen 1 of 10 total including the Compartir closer),
// always in this order — a user with thin data still sees all 9, each
// screen renders its own empty state internally.
const SCREENS = [
  ScreenPortada, ScreenPortafolio, ScreenDecisiones, ScreenInvestigacion,
  ScreenPatrimonio, ScreenHabitos, ScreenEvolucion, ScreenProximoMes, ScreenLogros,
] as const;

const SCREEN_KEYS = [
  "portada", "portafolio", "decisiones", "investigacion", "patrimonio",
  "habitos", "evolucion", "proximo_mes", "logros",
] as const;

const NEXT_TEASERS = [
  "Tu portafolio 📊", "Tus decisiones 🎯", "Empresas investigadas 🔍",
  "Tu patrimonio 💼", "Tu constancia 🔥", "Tu evolución 📈",
  "Tu próximo mes 🎯", "Tus logros 🏆", "Tu tarjeta para compartir 🎉",
] as const;

export default function RecapFlow({
  data, year, month, onClose, onNavigateMonth, canGoPrev, canGoNext,
}: {
  data: InvestorRecapData;
  year: number;
  month: number;
  onClose: () => void;
  onNavigateMonth: (direction: -1 | 1) => void;
  canGoPrev: boolean;
  canGoNext: boolean;
}) {
  const screens = SCREENS;
  const total = screens.length + 1;
  const [index, setIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  const isLast = index === screens.length;
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, screens.length)), [screens.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    posthog.capture("recap_opened", { year, month });
  }, [year, month]);

  useEffect(() => {
    if (isLast) {
      posthog.capture("recap_share_card_viewed", { year, month });
    } else {
      posthog.capture("recap_section_viewed", { year, month, section: SCREEN_KEYS[index] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, isLast]);

  useEffect(() => {
    setIndex(0);
  }, [year, month]);

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
    const canvas = await html2canvas(shareRef.current, { backgroundColor: "#03060e", scale: 2, useCORS: true });
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }, []);

  const fileLabel = `nuvos-investor-recap-${year}-${String(month).padStart(2, "0")}`;

  const handleDownload = useCallback(async () => {
    setExporting(true);
    posthog.capture("recap_share_clicked", { year, month, method: "download" });
    try {
      const blob = await captureShareImage();
      if (!blob) return;
      posthog.capture("recap_share_generated", { year, month });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileLabel}.png`;
      a.click();
      URL.revokeObjectURL(url);
      posthog.capture("recap_share_downloaded", { year, month });
    } finally {
      setExporting(false);
    }
  }, [captureShareImage, fileLabel, year, month]);

  const handleShare = useCallback(async () => {
    setExporting(true);
    posthog.capture("recap_share_clicked", { year, month, method: "native_share" });
    try {
      const blob = await captureShareImage();
      if (!blob) return;
      posthog.capture("recap_share_generated", { year, month });
      const file = new File([blob], `${fileLabel}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Nuvos Investor Recap", text: `Mi Investor Recap de ${data.overview.month_label} con Nuvos AI #NuvosInvestor` });
      } else {
        await handleDownload();
      }
    } catch {
      // user cancelled the share sheet
    } finally {
      setExporting(false);
    }
  }, [captureShareImage, fileLabel, year, month, data.overview.month_label, handleDownload]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", width: "100%", maxWidth: 430, height: "100%", maxHeight: 900, background: WT.bg, overflow: "hidden", borderRadius: 0 }}>
        <div style={{ position: "absolute", top: 10, left: 12, right: 12, display: "flex", gap: 4, zIndex: 10 }}>
          {Array.from({ length: total }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 3, borderRadius: 100, background: i <= index ? WT.accentL : "rgba(255,255,255,0.15)" }} />
          ))}
        </div>

        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 12, zIndex: 20, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 10, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <X size={16} color="#fff" />
        </button>

        {/* Month navigation — only on the portada (index 0), so it never
            competes with the tap-to-advance zones on other screens. */}
        {index === 0 && (canGoPrev || canGoNext) && (
          <div style={{ position: "absolute", top: 54, left: 0, right: 0, zIndex: 20, display: "flex", justifyContent: "space-between", padding: "0 14px", pointerEvents: "none" }}>
            <button
              onClick={() => canGoPrev && onNavigateMonth(-1)}
              disabled={!canGoPrev}
              style={{ pointerEvents: "auto", opacity: canGoPrev ? 1 : 0.25, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 10, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: canGoPrev ? "pointer" : "default" }}
            >
              <ChevronLeft size={16} color="#fff" />
            </button>
            <button
              onClick={() => canGoNext && onNavigateMonth(1)}
              disabled={!canGoNext}
              style={{ pointerEvents: "auto", opacity: canGoNext ? 1 : 0.25, background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 10, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: canGoNext ? "pointer" : "default" }}
            >
              <ChevronRight size={16} color="#fff" />
            </button>
          </div>
        )}

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
            <button onClick={handleDownload} disabled={exporting} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 100, background: WT.card2, border: `1.5px solid ${WT.border}`, color: WT.text, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
              <Download size={15} /> Descargar
            </button>
            <button onClick={handleShare} disabled={exporting} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              <Share2 size={15} /> Compartir mi Investor Personality
            </button>
          </div>
        )}
      </div>

      {/* Off-screen, fixed-size (430x900), never-clipped clone — see
          wrapped/WrappedFlow.tsx's identical comment for why this exists
          (a real, confirmed html2canvas viewport-clipping bug). */}
      {isLast && (
        <div ref={shareRef} aria-hidden="true" style={{ position: "fixed", left: -9999, top: 0, width: 430, height: 900, overflow: "visible", pointerEvents: "none" }}>
          <ScreenCompartir data={data} staticMode />
        </div>
      )}
    </div>
  );
}
