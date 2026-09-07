"use client";

// Dev-only scaffolding for verifying CompanyDiagnosticCard — auto-loads WMT
// on mount via the same-origin /api/dev/company-diagnostic proxy (so the
// browser never makes a cross-origin request to the backend directly), with
// a search box to load any other real ticker. Not linked from any nav, no
// auth guard applies. See /Users/diegoarria/.claude/plans/cosmic-munching-crown.md.

import { useEffect, useState } from "react";
import { CompanyDiagnosticCard } from "@/components/subvaluadas/CompanyDiagnosticCard";
import { mockCopartData, type CompanyDiagnosticData } from "@/lib/types/companyDiagnostic";

export default function CompanyDiagnosticDevPage() {
  const [query, setQuery] = useState("WMT");
  const [data, setData] = useState<CompanyDiagnosticData>(mockCopartData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = async (tickerArg?: string) => {
    const ticker = (tickerArg ?? query).trim().toUpperCase();
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/company-diagnostic?ticker=${encodeURIComponent(ticker)}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(typeof body?.detail === "string" ? body.detail : `HTTP ${res.status}`);
      }
      setData(body);
    } catch (err: unknown) {
      console.error("dev company-diagnostic fetch failed:", err);
      setError(`No se pudo cargar ${ticker}. (${(err as Error)?.message || "error desconocido"})`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSearch("WMT");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen overflow-y-auto" style={{ background: "var(--bg)" }}>
      <div className="max-w-[720px] mx-auto px-4 py-6 sm:px-6">
        <div className="flex gap-2 mb-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Ticker (ej. WMT, AAPL)"
            className="flex-1 px-3 py-2 rounded-lg text-sm"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <button
            onClick={() => runSearch()}
            disabled={loading || !query.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ background: "var(--accent-l)", color: "#00110d", opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "..." : "Buscar"}
          </button>
        </div>
        {error && (
          <p className="mb-4 text-sm" style={{ color: "#DD6E63" }}>{error}</p>
        )}
        <CompanyDiagnosticCard data={data} />
      </div>
    </div>
  );
}
