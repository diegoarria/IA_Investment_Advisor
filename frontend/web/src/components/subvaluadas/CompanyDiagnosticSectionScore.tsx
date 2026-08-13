"use client";

// Shared "score/100 + (i)" pattern reused by the hero's overall score and
// all 4 pillar headlines — wraps the existing ScorePill (components/ui/
// Badge.tsx) with the existing ExplainableValue (i) popover instead of
// building a new score-display or a new tooltip mechanism.

import { ScorePill } from "@/components/ui/Badge";
import { ExplainableValue } from "@/components/ui/ExplainableValue";

export function CompanyDiagnosticSectionScore({
  score, label, explanation,
}: {
  score: number;
  label: string;
  explanation: string;
}) {
  return (
    <ExplainableValue label={label} content={{ summary: explanation }}>
      <span className="flex items-center gap-1">
        <ScorePill score={score} size="md" />
        <span className="text-[13px] font-bold" style={{ color: "var(--muted)" }}>/100</span>
      </span>
    </ExplainableValue>
  );
}
