"use client";

// Dev-only scaffolding for verifying CompanyDiagnosticCard against the
// Copart mock fixture — not linked from any nav, no auth guard applies.
// See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.

import { CompanyDiagnosticCard } from "@/components/subvaluadas/CompanyDiagnosticCard";
import { mockCopartData } from "@/lib/types/companyDiagnostic";

export default function CompanyDiagnosticDevPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>
      <div className="max-w-[720px] mx-auto px-4 py-6 sm:px-6">
        <CompanyDiagnosticCard data={mockCopartData} />
      </div>
    </div>
  );
}
