// Fase 4, Incremento 1 — shared UI primitives.

import type { ReactNode } from "react";

export function SectionHeader({
  title, subtitle, action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2">
      <div className="min-w-0">
        <h2 className="text-sm font-bold truncate" style={{ color: "var(--text)" }}>{title}</h2>
        {subtitle && <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
