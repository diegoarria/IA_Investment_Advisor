"use client";

// Fase 4, Incremento 1 — shared UI primitives. Generalizes the
// chevron-toggle expand/collapse pattern already used ad hoc in
// ChecklistDisplay and NifScoreEngineCard (components/subvaluadas/shared.tsx)
// so new Fase 4 surfaces (comparisons, timeline, checklist, journal) reuse
// one implementation instead of a third/fourth copy.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "./Card";

export function ExpandableSection({
  title, icon, headline, defaultExpanded = false, children,
}: {
  title: string;
  icon?: ReactNode;
  /** Rendered on the right of the header row, before the chevron — e.g. a
   * score, a count badge, a percentile. */
  headline?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Card padding="">
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 p-3.5"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {headline}
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
            : <ChevronDown className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />}
        </div>
      </button>
      {expanded && <div className="px-3.5 pb-3.5 space-y-2">{children}</div>}
    </Card>
  );
}
