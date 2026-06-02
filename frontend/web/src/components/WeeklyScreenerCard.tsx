"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, TrendingUp, TrendingDown, Loader2, Lock, RefreshCw } from "lucide-react";
import { screenerApi } from "@/lib/api";

interface Pick {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change_pct: number;
  score: number;
  why: string;
  catalyst: string;
  risk: string;
}

interface WeeklyData {
  week_theme?: string;
  picks?: Pick[];
  mentor_note?: string;
}

interface Props {
  isPremium: boolean;
  onUpgrade: () => void;
  tickers?: string[];
}

export default function WeeklyScreenerCard({ isPremium, onUpgrade, tickers = [] }: Props) {
  const [data, setData]       = useState<WeeklyData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!isPremium) return;
    setLoading(true);
    try {
      const res = await screenerApi.getWeekly(tickers);
      setData(res.data);
    } catch {
    } finally { setLoading(false); }
  }, [isPremium, tickers.join(",")]);

  useEffect(() => { load(); }, [load]);

  if (!isPremium) {
    return (
      <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
          <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Screener Semanal</span>
          <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>PREMIUM</span>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
          Cada lunes la IA selecciona 5 oportunidades personalizadas según tu perfil y mentor.
        </p>
        <button onClick={onUpgrade} className="w-full py-2 rounded-lg text-xs font-bold text-white"
                style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }}>
          Activar Premium
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--card)" }}>
      <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: "var(--border)" }}>
        <Search className="w-4 h-4" style={{ color: "var(--accent-l)" }} />
        <span className="font-semibold text-sm" style={{ color: "var(--text)" }}>Screener Semanal</span>
        {data?.week_theme && (
          <span className="text-[10px] px-2 py-0.5 rounded-full ml-1"
                style={{ background: "rgba(0,168,94,0.1)", color: "var(--accent-l)" }}>
            {data.week_theme}
          </span>
        )}
        <button onClick={load} disabled={loading} className="ml-auto p-1 rounded-lg hover:bg-white/5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} style={{ color: "var(--muted)" }} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 p-4">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--accent-l)" }} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>Analizando el mercado...</span>
        </div>
      )}

      {!loading && data?.picks && (
        <div className="divide-y" style={{ borderColor: "var(--border)" }}>
          {data.picks.slice(0, 5).map((pick, i) => (
            <div key={pick.ticker} className="flex items-center gap-3 p-3">
              <span className="text-xs font-black w-4 text-center" style={{ color: "var(--dim)" }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm" style={{ color: "var(--text)" }}>{pick.ticker}</span>
                  <span className="text-[10px]" style={{ color: "var(--muted)" }}>{pick.sector}</span>
                </div>
                <p className="text-[11px] truncate" style={{ color: "var(--sub)" }}>{pick.why}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold" style={{ color: "var(--text)" }}>${pick.price?.toFixed(2) ?? "—"}</p>
                <p className="text-[10px] flex items-center gap-0.5 justify-end"
                   style={{ color: (pick.change_pct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                  {(pick.change_pct ?? 0) >= 0 ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                  {(pick.change_pct ?? 0) >= 0 ? "+" : ""}{pick.change_pct?.toFixed(1) ?? 0}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !data && (
        <div className="flex items-center gap-2 p-4">
          <Lock className="w-4 h-4" style={{ color: "var(--muted)" }} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>No hay picks disponibles aún.</span>
        </div>
      )}
    </div>
  );
}
