"use client";

// Fase 4, Incremento 1 — the user-facing switcher for "Nivel de Detalle"
// (see src/lib/detailLevel.ts + src/lib/store.ts's useDetailLevelStore).
// A 4-segment control, switchable at any time per the brief ("el usuario
// debe poder cambiar de modo en cualquier momento").

import { useTranslation } from "react-i18next";
import { DETAIL_LEVELS, getDetailLevelLabel, type DetailLevel } from "@/lib/detailLevel";

export function DetailLevelToggle({ value, onChange }: { value: DetailLevel; onChange: (level: DetailLevel) => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t("common.detailLevel.label")}
      className="inline-flex items-center rounded-xl border p-0.5 gap-0.5"
      style={{ borderColor: "var(--border)", background: "var(--raised)" }}
    >
      {DETAIL_LEVELS.map((level) => {
        const active = level === value;
        return (
          <button
            key={level}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(level)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors"
            style={{
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#0A0F1A" : "var(--muted)",
            }}
          >
            {getDetailLevelLabel(t, level)}
          </button>
        );
      })}
    </div>
  );
}
