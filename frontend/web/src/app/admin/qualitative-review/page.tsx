"use client";

// Minimal internal tool — Diego, 2026-11-16: approve the 5 pilot editorial
// drafts via the real authenticated /review route, using the app's own
// `api` client (session cookie + automatic refresh-on-401) instead of a
// raw browser-console fetch. Every click is explicit; nothing here batches
// or auto-approves. The backend re-checks the admin allowlist on every
// call — this page grants nothing by itself.

import { useState } from "react";
import { useAuthStore } from "@/lib/store";
import { qualitativeContentApi } from "@/lib/api";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

const CANDIDATES = [
  { ticker: "GOOGL", version: 4 },
  { ticker: "COST", version: 3 },
  { ticker: "JPM", version: 2 },
  { ticker: "NVDA", version: 2 },
  { ticker: "MCD", version: 2 },
];

type Result = { ok: boolean; detail: string } | null;

export default function QualitativeReviewPage() {
  const { userId } = useAuthStore();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [pending, setPending] = useState<string | null>(null);

  const approve = async (ticker: string, version: number) => {
    const key = `${ticker}-${version}`;
    setPending(key);
    try {
      const { data } = await qualitativeContentApi.review(ticker, version);
      setResults((r) => ({ ...r, [key]: { ok: true, detail: JSON.stringify(data) } }));
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { detail?: string } } };
      const detail = err.response ? `${err.response.status}: ${err.response.data?.detail ?? "error"}` : String(e);
      setResults((r) => ({ ...r, [key]: { ok: false, detail } }));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="h-screen overflow-y-auto p-8" style={{ background: "var(--bg)" }}>
      <p className="text-[11px] mb-1" style={{ color: "var(--dim)" }}>
        {userId === ADMIN_UID ? "Sesión de admin activa" : "Verificando acceso… (el servidor revalida en cada clic)"}
      </p>
      <h1 className="text-xl font-black mb-1" style={{ color: "var(--text)" }}>
        Revisión editorial — Radar 2.0 (cohorte 1)
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Cada botón llama <code>POST /api/qualitative-content/review</code> con tu sesión real. Ningún borrador se
        publica aquí — esto solo mueve draft → reviewed.
      </p>

      <div className="space-y-3 max-w-xl">
        {CANDIDATES.map(({ ticker, version }) => {
          const key = `${ticker}-${version}`;
          const result = results[key];
          const busy = pending === key;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-4 p-4 rounded-xl border"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <div>
                <p className="font-bold" style={{ color: "var(--text)" }}>
                  {ticker} v{version}
                </p>
                {result && (
                  <p className="text-xs mt-1" style={{ color: result.ok ? "#22c55e" : "#ef4444" }}>
                    {result.ok ? "✓ reviewed" : "✗ "}{result.detail}
                  </p>
                )}
              </div>
              <button
                onClick={() => approve(ticker, version)}
                disabled={busy || result?.ok}
                className="px-4 py-2 rounded-lg text-sm font-bold shrink-0 disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {busy ? "..." : result?.ok ? "Aprobado" : "Aprobar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
