"use client";

import { useState, useRef, useEffect } from "react";
import { TOOLTIPS } from "@/lib/userLevel";
import type { UserLevel } from "@/lib/userLevel";

interface Props {
  term: string;
  userLevel: UserLevel;
  children: React.ReactNode;
  className?: string;
}

/**
 * Wraps a financial term with a hover/tap tooltip for principiante and basico users.
 * For intermedio+ it renders children as-is (no tooltip overhead).
 */
export default function FinancialTip({ term, userLevel, children, className }: Props) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tip = TOOLTIPS[term];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // No tooltip for intermedio+ or if term not in dict
  if (userLevel === "intermedio" || userLevel === "avanzado" || !tip) {
    return <span className={className}>{children}</span>;
  }

  const handleToggle = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAbove(rect.bottom + 80 > window.innerHeight);
    }
    setOpen((v) => !v);
  };

  return (
    <span ref={ref} className={`relative inline-flex items-center gap-0.5 cursor-help ${className ?? ""}`}
          onMouseEnter={() => { if (ref.current) { const r = ref.current.getBoundingClientRect(); setAbove(r.bottom + 80 > window.innerHeight); } setOpen(true); }}
          onMouseLeave={() => setOpen(false)}
          onClick={handleToggle}>
      {children}
      {/* Subtle underline indicator */}
      <span className="absolute bottom-0 left-0 right-0 h-px rounded-full"
            style={{ background: "var(--accent-l)", opacity: 0.5 }} />

      {open && (
        <span
          className="absolute z-50 w-52 text-left px-3 py-2 rounded-xl shadow-lg text-[11px] leading-relaxed pointer-events-none"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--sub)",
            [above ? "bottom" : "top"]: "calc(100% + 6px)",
            left: "50%",
            transform: "translateX(-50%)",
          }}>
          <strong style={{ color: "var(--accent-l)", display: "block", marginBottom: 2 }}>{term}</strong>
          {tip}
        </span>
      )}
    </span>
  );
}
