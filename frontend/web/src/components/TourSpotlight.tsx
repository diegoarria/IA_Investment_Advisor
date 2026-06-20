"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

interface Props {
  targetId: string;
  step: number;
  totalSteps?: number;
  title: string;
  description: string;
  ctaLabel?: string;
  onDismiss?: () => void;
}

interface TooltipPos {
  top: number;
  left: number;
  arrowUp: boolean; // true = arrow on top of tooltip pointing UP toward element above
}

export default function TourSpotlight({
  targetId,
  step,
  totalSteps = 5,
  title,
  description,
  ctaLabel = "Listo, volver al inicio ✓",
  onDismiss,
}: Props) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);

  useEffect(() => setMounted(true), []);

  const updatePos = useCallback(() => {
    const el = document.getElementById(targetId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const showBelow = rect.bottom + 260 < window.innerHeight;
    setTooltipPos({
      top: showBelow ? rect.bottom + 18 : rect.top - 18,
      left: Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170),
      arrowUp: showBelow,
    });
  }, [targetId]);

  useEffect(() => {
    if (!mounted) return;

    // Inject ring keyframe once
    const STYLE_ID = "tour-spotlight-kf";
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement("style");
      s.id = STYLE_ID;
      s.textContent = `
        @keyframes tour-ring {
          0%,100% { box-shadow: 0 0 0 9999px rgba(0,0,0,0.68), 0 0 0 3px #00d47e, 0 0 20px rgba(0,212,126,0.35); }
          50%      { box-shadow: 0 0 0 9999px rgba(0,0,0,0.68), 0 0 0 5px #00d47e, 0 0 36px rgba(0,212,126,0.55); }
        }
      `;
      document.head.appendChild(s);
    }

    // Find element with retries (page might still be rendering)
    let cleanup: (() => void) | undefined;
    let attempts = 0;
    const tryApply = () => {
      const el = document.getElementById(targetId);
      if (!el && attempts++ < 12) { setTimeout(tryApply, 250); return; }
      if (!el) return;

      el.scrollIntoView({ behavior: "smooth", block: "center" });

      const saved = {
        position: el.style.position,
        zIndex: el.style.zIndex,
        animation: el.style.animation,
        borderRadius: el.style.borderRadius,
        transition: el.style.transition,
      };
      el.style.transition = "box-shadow 0.3s";
      el.style.position = "relative";
      el.style.zIndex = "10001";
      el.style.animation = "tour-ring 2s ease-in-out infinite";
      el.style.borderRadius = "14px";

      // Position tooltip after scroll settles
      const t = setTimeout(updatePos, 550);

      window.addEventListener("scroll", updatePos, true);
      window.addEventListener("resize", updatePos);

      cleanup = () => {
        clearTimeout(t);
        window.removeEventListener("scroll", updatePos, true);
        window.removeEventListener("resize", updatePos);
        el.style.position = saved.position;
        el.style.zIndex = saved.zIndex;
        el.style.animation = saved.animation;
        el.style.borderRadius = saved.borderRadius;
        el.style.transition = saved.transition;
      };
    };
    tryApply();
    return () => cleanup?.();
  }, [mounted, targetId, updatePos]);

  const dismiss = () => {
    if (onDismiss) onDismiss();
    else router.push("/home");
  };

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Click-to-dismiss backdrop — pointer-events only on non-highlighted area */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 10000, cursor: "default" }}
        onClick={dismiss}
      />

      {/* Tooltip */}
      {tooltipPos && (
        <div
          style={{
            position: "fixed",
            top: tooltipPos.top,
            left: tooltipPos.left,
            transform: tooltipPos.arrowUp
              ? "translateX(-50%)"
              : "translate(-50%, -100%)",
            zIndex: 10002,
            width: 300,
            background: "var(--card)",
            border: "1.5px solid rgba(0,212,126,0.4)",
            borderRadius: 16,
            padding: "16px 18px",
            boxShadow: "0 16px 48px rgba(0,0,0,0.55)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Arrow pointing toward highlighted element */}
          {tooltipPos.arrowUp && (
            <div
              style={{
                position: "absolute",
                top: -8,
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderBottom: "8px solid rgba(0,212,126,0.5)",
              }}
            />
          )}
          {!tooltipPos.arrowUp && (
            <div
              style={{
                position: "absolute",
                bottom: -8,
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                borderTop: "8px solid rgba(0,212,126,0.5)",
              }}
            />
          )}

          {/* Step badge + close */}
          <div className="flex items-center justify-between mb-3">
            <span
              style={{
                background: "rgba(0,212,126,0.12)",
                color: "#00d47e",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 1,
                padding: "3px 9px",
                borderRadius: 20,
                textTransform: "uppercase",
              }}
            >
              Paso {step} de {totalSteps}
            </span>
            <button onClick={dismiss} style={{ color: "var(--dim)", lineHeight: 1, cursor: "pointer" }}>
              <X size={14} />
            </button>
          </div>

          <p style={{ color: "var(--text)", fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
            {title}
          </p>
          <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.65, marginBottom: 14 }}>
            {description}
          </p>

          <button
            onClick={dismiss}
            style={{
              width: "100%",
              background: "#00d47e",
              color: "#000",
              fontWeight: 800,
              fontSize: 13,
              padding: "10px 0",
              borderRadius: 12,
              cursor: "pointer",
              border: "none",
            }}
          >
            {ctaLabel}
          </button>
        </div>
      )}
    </>,
    document.body
  );
}
