"use client";

import { useState } from "react";
import { FileText, Download, Loader2, TrendingUp, TrendingDown, X, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reportApi } from "@/lib/api";

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
  const { t } = useTranslation();
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
        alert(`${t("monthlyReport.errorPrefix")}: ${res.data.error}`);
        return;
      }
      setReport(res.data);
      setOpen(true);
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]?.msg ?? raw[0] ?? "") : "";
      alert(msg ? `${t("monthlyReport.errorPrefix")}: ${msg}` : t("monthlyReport.generateFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const returnPct = report?.performance?.total_return_pct ?? 0;
  const isPositive = returnPct >= 0;

  const TOOL_COLOR = "#3b82f6";

  return (
    <>
      {/* ── Tool Card ── */}
      <div
        onClick={handleGenerate}
        className="rounded-3xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.01] active:scale-[0.99]"
        style={{ background: "var(--card)", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", opacity: loading ? 0.8 : 1 }}
      >
        {/* Hero */}
        <div className="relative flex flex-col items-center pt-9 pb-7 overflow-hidden"
             style={{ background: TOOL_COLOR + "18" }}>
          <div className="absolute -top-14 -right-10 w-44 h-44 rounded-full pointer-events-none"
               style={{ background: TOOL_COLOR + "15" }} />
          <div className="absolute -bottom-8 -left-5 w-28 h-28 rounded-full pointer-events-none"
               style={{ background: TOOL_COLOR + "0A" }} />
          <div className="relative z-10 w-[88px] h-[88px] rounded-[28px] border-2 flex items-center justify-center"
               style={{ background: TOOL_COLOR + "25", borderColor: TOOL_COLOR + "40" }}>
            <div className="w-[72px] h-[72px] rounded-[22px] flex items-center justify-center"
                 style={{ background: TOOL_COLOR }}>
              {loading
                ? <Loader2 className="w-7 h-7 text-white animate-spin" />
                : <FileText className="w-7 h-7 text-white" />}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 pt-5">
          <h3 className="text-[22px] font-black tracking-tight text-center mb-1"
              style={{ color: "var(--text)" }}>
            {t("monthlyReport.title")}
          </h3>
          <p className="text-[13px] font-bold text-center mb-5 tracking-wide" style={{ color: TOOL_COLOR }}>
            {t("monthlyReport.subtitle")}
          </p>

          {/* Feature list */}
          <div className="rounded-2xl border overflow-hidden mb-5" style={{ borderColor: "var(--border)" }}>
            {[
              { emoji: "📊", text: t("monthlyReport.feature1") },
              { emoji: "📉", text: t("monthlyReport.feature2") },
              { emoji: "✅", text: t("monthlyReport.feature3") },
            ].map((f, i, arr) => (
              <div key={f.text}
                   className="flex items-center gap-3 px-3.5 py-3"
                   style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center shrink-0 text-[17px]"
                     style={{ background: TOOL_COLOR + "12" }}>
                  {f.emoji}
                </div>
                <span className="text-[13px] leading-snug font-medium" style={{ color: "var(--sub)" }}>
                  {f.text}
                </span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={(e) => { e.stopPropagation(); handleGenerate(); }}
            disabled={loading}
            className="relative w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-extrabold text-[15px] text-white overflow-hidden tracking-wide transition-opacity hover:opacity-90 disabled:opacity-70"
            style={{ background: TOOL_COLOR }}
          >
            <div className="absolute inset-0 top-0 h-1/2 pointer-events-none"
                 style={{ background: "rgba(255,255,255,0.12)" }} />
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" />{t("monthlyReport.generating")}</>
              : <><Sparkles className="w-4 h-4" />{t("monthlyReport.generateCta")}</>}
          </button>
        </div>
      </div>

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
                  {t("monthlyReport.reportTitle")} — {report.month}
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--muted)" }}>
                  {t("monthlyReport.generatedOn")} {new Date(report.generated_at || "").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handlePrint}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                        style={{ borderColor: "var(--border)", color: "var(--sub)" }}>
                  <Download className="w-3.5 h-3.5" /> {t("monthlyReport.exportPdf")}
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
                  <p className="text-xs font-bold mb-1.5" style={{ color: "var(--muted)" }}>{t("monthlyReport.executiveSummary")}</p>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{report.executive_summary}</p>
                </div>
              )}

              {/* Performance metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: t("monthlyReport.metrics.totalReturn"), value: `${isPositive ? "+" : ""}${returnPct.toFixed(2)}%`, color: isPositive ? "#22c55e" : "#ef4444" },
                  { label: t("monthlyReport.metrics.totalValue"), value: `$${(report.performance?.total_value ?? 0).toLocaleString()}`, color: "var(--text)" },
                  { label: t("monthlyReport.metrics.unrealizedGain"), value: `${(report.performance?.unrealized_gain ?? 0) >= 0 ? "+" : ""}$${(report.performance?.unrealized_gain ?? 0).toLocaleString()}`, color: (report.performance?.unrealized_gain ?? 0) >= 0 ? "#22c55e" : "#ef4444" },
                  { label: t("monthlyReport.metrics.vsSp500"), value: report.performance?.vs_sp500 ?? "—", color: "var(--sub)" },
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
                  <p className="text-[10px] font-bold mb-1" style={{ color: "#22c55e" }}>🏆 {t("monthlyReport.bestPosition")}</p>
                  <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
                    {report.performance?.best_performer?.ticker ?? "—"}
                  </p>
                  <p className="text-xs" style={{ color: "#22c55e" }}>
                    +{report.performance?.best_performer?.gain_pct?.toFixed(2) ?? 0}%
                  </p>
                </div>
                <div className="p-3 rounded-xl border" style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)" }}>
                  <p className="text-[10px] font-bold mb-1" style={{ color: "#ef4444" }}>📉 {t("monthlyReport.worstPosition")}</p>
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
                    { label: t("monthlyReport.metrics.volatility"), value: report.metrics.volatility_pct ? `${report.metrics.volatility_pct.toFixed(1)}%` : "—" },
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
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>{t("monthlyReport.sectorBreakdown")}</p>
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
                  <p className="text-[10px] font-bold mb-1.5" style={{ color: "var(--accent-l)" }}>🎓 {t("monthlyReport.mentorNote")}</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--sub)" }}>{report.mentor_note}</p>
                </div>
              )}

              {/* Action items */}
              {report.action_items && report.action_items.length > 0 && (
                <div>
                  <p className="text-xs font-bold mb-2" style={{ color: "var(--muted)" }}>✅ {t("monthlyReport.actionItems")}</p>
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
                  <p className="text-[10px] font-bold mb-1" style={{ color: "#a78bfa" }}>💡 {t("monthlyReport.learningInsight")}</p>
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
