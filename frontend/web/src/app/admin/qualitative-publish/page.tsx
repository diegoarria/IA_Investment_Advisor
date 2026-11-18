"use client";

// Minimal internal tool — Diego, 2026-11-17: publish the 5 reviewed pilot
// editorial versions, one click at a time, via the real authenticated
// /publish route. Same pattern as /admin/qualitative-review: the app's own
// `api` client (session cookie + automatic refresh-on-401), never a raw
// fetch, never a bulk action, never auto-publish on load. The backend
// re-checks the admin allowlist on every call — this page grants nothing
// by itself. Each card shows ticker/version/id/current status so there is
// no ambiguity about what a click is about to publish.

import { useState } from "react";
import { useAuthStore } from "@/lib/store";
import { qualitativeContentApi } from "@/lib/api";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

const CANDIDATES = [
  { ticker: "GOOGL", version: 4, id: "4084d6b0-1471-4eef-a75c-ecbf46124d51", status: "reviewed" },
  { ticker: "COST", version: 3, id: "a972e668-e4bd-4335-a767-2f6dc5bb4b21", status: "reviewed" },
  { ticker: "JPM", version: 2, id: "d19a3e09-25f0-4431-ba1a-d2fd61d01100", status: "reviewed" },
  { ticker: "NVDA", version: 2, id: "485443f7-9c86-45a7-940c-78fc290e6787", status: "reviewed" },
  { ticker: "MCD", version: 2, id: "3ecacae0-8d60-4ecd-92ff-2e40293b86df", status: "reviewed" },
];

type Result = { ok: boolean; detail: string } | null;

export default function QualitativePublishPage() {
  const { userId } = useAuthStore();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [pending, setPending] = useState<string | null>(null);

  const publish = async (ticker: string, version: number) => {
    const key = `${ticker}-${version}`;
    setPending(key);
    try {
      const { data } = await qualitativeContentApi.publish(ticker, version);
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
        Publicación editorial — Radar 2.0 (cohorte 1)
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Cada botón llama <code>POST /api/qualitative-content/publish</code> con tu sesión real. Publica esa versión
        (reviewed → published, is_current=true) y retira automáticamente la versión vigente anterior de ese ticker.
        Publica de a una — empieza por GOOGL.
      </p>

      <div className="space-y-3 max-w-2xl">
        {CANDIDATES.map(({ ticker, version, id, status }) => {
          const key = `${ticker}-${version}`;
          const result = results[key];
          const busy = pending === key;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-4 p-4 rounded-xl border"
              style={{ borderColor: "var(--border)", background: "var(--card)" }}
            >
              <div className="min-w-0">
                <p className="font-bold" style={{ color: "var(--text)" }}>
                  {ticker} v{version}
                </p>
                <p className="text-[11px] font-mono truncate" style={{ color: "var(--dim)" }}>
                  id: {id}
                </p>
                <p className="text-[11px]" style={{ color: "var(--dim)" }}>
                  estado actual: {result?.ok ? "published" : status}
                </p>
                {result && (
                  <p className="text-xs mt-1" style={{ color: result.ok ? "#22c55e" : "#ef4444" }}>
                    {result.ok ? "✓ published" : "✗ "}{result.detail}
                  </p>
                )}
              </div>
              <button
                onClick={() => publish(ticker, version)}
                disabled={busy || result?.ok}
                className="px-4 py-2 rounded-lg text-sm font-bold shrink-0 disabled:opacity-50"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                {busy ? "..." : result?.ok ? "Publicado" : "Publicar"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
