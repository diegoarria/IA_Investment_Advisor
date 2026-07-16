"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlayCircle } from "lucide-react";
import { useAuthStore } from "@/lib/store";
import { adminApi } from "@/lib/api";

const ADMIN_UID = "86961402-9072-4670-9f73-b2aa91930b04";

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre
      className="text-xs p-4 rounded-xl overflow-x-auto whitespace-pre-wrap break-words"
      style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function AdminDiagnosticsPage() {
  const router = useRouter();
  const { userId, isAuthenticated } = useAuthStore();

  const [marketOpenLoading, setMarketOpenLoading] = useState(false);
  const [marketOpenResult, setMarketOpenResult] = useState<any>(null);
  const [marketOpenError, setMarketOpenError] = useState<string | null>(null);

  const [ticker, setTicker] = useState("NVDA");
  const [pct, setPct] = useState("5.0");
  const [whyLoading, setWhyLoading] = useState(false);
  const [whyResult, setWhyResult] = useState<any>(null);
  const [whyError, setWhyError] = useState<string | null>(null);

  const [usageDays, setUsageDays] = useState("1");
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageResult, setUsageResult] = useState<any>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId || !isAuthenticated) return;
    if (userId !== ADMIN_UID) router.push("/");
  }, [userId, isAuthenticated, router]);

  const runMarketOpen = async () => {
    setMarketOpenLoading(true);
    setMarketOpenError(null);
    setMarketOpenResult(null);
    try {
      const res = await adminApi.testMarketOpen();
      setMarketOpenResult(res.data);
    } catch (err: any) {
      setMarketOpenError(err?.response?.data?.detail ?? "Error al ejecutar la prueba.");
    } finally {
      setMarketOpenLoading(false);
    }
  };

  const runPriceAlertWhy = async () => {
    if (!ticker.trim()) return;
    setWhyLoading(true);
    setWhyError(null);
    setWhyResult(null);
    try {
      const res = await adminApi.testPriceAlertWhy(ticker.trim().toUpperCase(), parseFloat(pct) || 5.0);
      setWhyResult(res.data);
    } catch (err: any) {
      setWhyError(err?.response?.data?.detail ?? "Error al ejecutar la prueba.");
    } finally {
      setWhyLoading(false);
    }
  };

  const runLlmUsage = async () => {
    setUsageLoading(true);
    setUsageError(null);
    setUsageResult(null);
    try {
      const res = await adminApi.llmUsage(parseInt(usageDays) || 1);
      setUsageResult(res.data);
    } catch (err: any) {
      setUsageError(err?.response?.data?.detail ?? "Error al obtener el uso.");
    } finally {
      setUsageLoading(false);
    }
  };

  if (userId && userId !== ADMIN_UID) return null;

  return (
    <div className="h-screen overflow-y-auto p-6" style={{ background: "var(--bg)" }}>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text)" }}>Diagnósticos</h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            Prueba las notificaciones con datos reales, en vivo, sin esperar a que corran solas.
          </p>
        </div>

        {/* ── Mercado Abierto ── */}
        <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>🔔 Mercado Abierto</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Trae S&P 500/Nasdaq reales ahora mismo y te manda un push de prueba solo a ti.
            </p>
          </div>
          <button
            onClick={runMarketOpen}
            disabled={marketOpenLoading}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
          >
            {marketOpenLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Ejecutar prueba
          </button>
          {marketOpenError && <p className="text-sm" style={{ color: "#f87171" }}>{marketOpenError}</p>}
          {marketOpenResult && <JsonBlock data={marketOpenResult} />}
        </section>

        {/* ── Por qué de alerta de precio ── */}
        <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>📰 Por qué de alerta de precio</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Corre el pipeline real (Perplexity + Finnhub + Claude) para un ticker y te dice en qué paso falla si sale "NO_CATALYST".
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="Ticker (ej. NVDA)"
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
            <input
              type="number"
              step="0.1"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="% movimiento"
              className="w-28 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <button
            onClick={runPriceAlertWhy}
            disabled={whyLoading || !ticker.trim()}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
          >
            {whyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Ejecutar prueba
          </button>
          {whyError && <p className="text-sm" style={{ color: "#f87171" }}>{whyError}</p>}
          {whyResult && <JsonBlock data={whyResult} />}
        </section>

        {/* ── Consumo de tokens (LLM usage) ── */}
        <section className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>💰 Consumo de tokens</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              Gasto real en USD por usuario, agregado desde llm_usage_log.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              step="1"
              min="1"
              value={usageDays}
              onChange={(e) => setUsageDays(e.target.value)}
              placeholder="Días"
              className="w-28 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
          <button
            onClick={runLlmUsage}
            disabled={usageLoading}
            className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-1.5"
            style={{ background: "var(--accent)" }}
          >
            {usageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Ver consumo
          </button>
          {usageError && <p className="text-sm" style={{ color: "#f87171" }}>{usageError}</p>}
          {usageResult && <JsonBlock data={usageResult} />}
        </section>
      </div>
    </div>
  );
}
