"use client";

import { useState } from "react";
import { FileText, Download, Loader2, TrendingUp, TrendingDown, X } from "lucide-react";
import { reportApi } from "@/lib/api";
import PremiumToolLocked from "@/components/PremiumToolLocked";

interface Position {
  ticker: string;
  name?: string;
  shares?: number;
  avg_cost?: number;
  current_price?: number;
  value?: number;
}

interface ReportData {
  month?: string;
  executive_summary?: string;
  generated_at?: string;
  performance?: {
    total_return_pct?: number;
    total_value?: number;
    total_invested?: number;
    unrealized_gain?: number;
    vs_sp500?: string;
    best_performer?: { ticker: string; gain_pct: number };
    worst_performer?: { ticker: string; loss_pct: number };
  };
  metrics?: {
    sharpe_ratio?: number;
    volatility_pct?: number;
    max_drawdown_pct?: number;
  };
  sector_breakdown?: { sector: string; pct: number; color: string }[];
  top_positions?: { ticker: string; name: string; value: number; gain_pct: number; weight_pct: number }[];
  risk_assessment?: string;
  mentor_note?: string;
  action_items?: string[];
  learning_insight?: string;
}

interface MonthlyReportProps {
  positions: Position[];
  isPremium: boolean;
  onUpgrade: () => void;
}

export default function MonthlyReport({ positions, isPremium, onUpgrade }: MonthlyReportProps) {
  const [loading, setLoading] = useState(false);
  const [report, setReport]   = useState<ReportData | null>(null);
  const [open, setOpen]       = useState(false);

  const handleGenerate = async () => {
    if (!isPremium) { onUpgrade(); return; }
    setLoading(true);
    try {
      const portfolio = positions.map((p) => ({
        ticker:        p.ticker,
        name:          p.name || p.ticker,
        shares:        p.shares || 0,
        avg_cost:      p.avg_cost || 0,
        current_price: p.current_price || 0,
        value:         p.value || 0,
      }));
      const res = await reportApi.monthly(portfolio);
      if (res.data?.error) {
        alert(`Error: ${res.data.error}`);
        return;
      }
      setReport(res.data);
      setOpen(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(msg ? `Error: ${msg}` : "No se pudo generar el reporte. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const returnPct = report?.performance?.total_return_pct ?? 0;
  const isPositive = returnPct >= 0;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all disabled:opacity-60"
        style={{ borderColor: "var(--border)", background: "var(--raised)", color: "var(--sub)" }}>
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <FileText className="w-3.5 h-3.5" style={{ color: "var(--accent-l)" }} />}
        {loading ? "Generando reporte..." : "Reporte mensual"}
        {!isPremium && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: "rgba(0,168,94,0.15)", color: "var(--accent-l)" }}>PREMIUM</span>
        )}
      </button>

      {/* Modal */}
      {open && report && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
             style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-2xl rounded-2xl border my-4"
               style={{ background: "var(--card)", borderColor: "var(--border)" }}>
            {/* Header */}
            <div className="h-1" style={{ background: "linear-gradient(90deg,#00a85e,#00d47e)" }} />
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "var(--border)" }}>
              <div>
                <h2 className="font-bold text-base" style={{ color: "var(--text)" }}>
                  Reporte de Portafolio — {report.month}
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
                  Generado el {new Date(report.generated_at || "").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handlePrint}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                        style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                  <Download className="w-3.5 h-3.5" /> Exportar PDF
                </button>
                <button onClick={() => setOpen(false)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: "var(--muted)" }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Executive summary */}
              {report.executive_summary && (
                <div className="p-4 rounded-xl" style={{ background: "var(--raised)" }}>
                  <p className="text-xs font-bold mb-1.5" style={{ color: "var(--muted)" }}>RESUMEN EJECUTIVO</p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{report.executive_summary}</p>
                </div>
              )}

              {/* Performance metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "Rendimiento total", value: `${isPositive ? "+" : ""}${returnPct.toFixed(2)}%`, color: isPositive ? "#22c55e" : "#ef4444" },
                  { label: "Valor total", value: `$${(report.performance?.total_value ?? 0).toLocaleString()}`, color: "var(--text)" },
                  { label: "Ganancia no realizada", value: `${(report.performance?.unrealized_gain ?? 0) >= 0 ? "+" : ""}$${(report.performance?.unrealized_gain ?? 0).toLocaleString()}`, color: (report.performance?.unrealized_gain ?? 0) >= 0 ? "#22c55e" : "#ef4444" },
                  { label: "vs S&P 500", value: report.performance?.vs_sp500 ?? "—", color: "var(--sub)" },
                ].map((m) => (
                  <div key={m.label} className="p-3 rounded-xl border text-center"
                       style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                    <p className="text-[10px] mb-1" style={{ color: "var(--muted)" }}>{m.label}</p>
                    <p className="text-sm font-bold" style={{ color: m.color }}>{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Best/worst + advanced metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl border" style={{ borderColor: "rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.05)" }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: "#22c55e" }}>🏆 Mejor posición</p>
                  <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                    {report.performance?.best_performer?.ticker ?? "—"}
                  </p>
                  <p className="text-xs" style={{ color: "#22c55e" }}>
                    +{report.performance?.best_performer?.gain_pct?.toFixed(2) ?? 0}%
                  </p>
                </div>
                <div className="p-3 rounded-xl border" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: "#ef4444" }}>📉 Peor posición</p>
                  <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                    {report.performance?.worst_performer?.ticker ?? "—"}
                  </p>
                  <p className="text-xs" style={{ color: "#ef4444" }}>
                    {report.performance?.worst_performer?.loss_pct?.toFixed(2) ?? 0}%
                  </p>
                </div>
              </div>

              {/* Advanced metrics */}
              {report.metrics && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Sharpe Ratio", value: report.metrics.sharpe_ratio?.toFixed(2) ?? "—" },
                    { label: "Volatilidad", value: report.metrics.volatility_pct ? `${report.metrics.volatility_pct.toFixed(1)}%` : "—" },
                    { label: "Max Drawdown", value: report.metrics.max_drawdown_pct ? `${report.metrics.max_drawdown_pct.toFixed(1)}%` : "—" },
                  ].map((m) => (
                    <div key={m.label} className="p-2.5 rounded-lg border text-center"
                         style={{ borderColor: "var(--border)", background: "var(--raised)" }}>
                      <p className="text-[10px]" style={{ color: "var(--muted)" }}>{m.label}</p>
                      <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Sector breakdown */}
              {report.sector_breakdown && report.sector_breakdown.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>DISTRIBUCIÓN POR SECTOR</p>
                  <div className="flex rounded-xl overflow-hidden h-3 mb-2">
                    {report.sector_breakdown.map((s) => (
                      <div key={s.sector} style={{ width: `${s.pct}%`, background: s.color }} title={`${s.sector} ${s.pct}%`} />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {report.sector_breakdown.map((s) => (
                      <div key={s.sector} className="flex items-center gap-1">
                        <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                        <span className="text-[10px]" style={{ color: "var(--sub)" }}>{s.sector} {s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Mentor note */}
              {report.mentor_note && (
                <div className="p-4 rounded-xl border"
                     style={{ borderColor: "rgba(0,168,94,0.3)", background: "rgba(0,168,94,0.06)" }}>
                  <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--accent-l)" }}>🎓 NOTA DE TU MENTOR</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{report.mentor_note}</p>
                </div>
              )}

              {/* Action items */}
              {report.action_items && report.action_items.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>✅ ACCIONES PARA EL PRÓXIMO MES</p>
                  <div className="space-y-1.5">
                    {report.action_items.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 rounded-lg"
                           style={{ background: "var(--raised)" }}>
                        <span className="text-xs font-bold mt-0.5" style={{ color: "var(--accent-l)" }}>{i + 1}.</span>
                        <p className="text-xs" style={{ color: "var(--sub)" }}>{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Learning insight */}
              {report.learning_insight && (
                <div className="p-3 rounded-xl" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: "#a78bfa" }}>💡 INSIGHT CONDUCTUAL DEL MES</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{report.learning_insight}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
