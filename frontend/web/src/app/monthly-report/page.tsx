"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, TrendingUp, TrendingDown } from "lucide-react";
import api from "@/lib/api";
import MonthlyReportFlow from "@/components/monthly-report/MonthlyReportFlow";
import { MonthlyReportResponse, fmtPct, WT } from "@/components/monthly-report/types";

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// The report is only open on days 1-3 of each month, when the month that
// matters is the one that JUST ended — so that is the default, not the
// barely-started current month.
function defaultYearMonth(): { year: number; month: number } {
  const { year, month } = currentYearMonth();
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export default function MonthlyReportPage() {
  return (
    <Suspense fallback={
      <div style={{ position: "fixed", inset: 0, background: WT.bg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
        <Loader2 className="animate-spin" size={28} color={WT.accentL} />
      </div>
    }>
      <MonthlyReportPageInner />
    </Suspense>
  );
}

function MonthlyReportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-link support (?year=&month=) — the monthly-summary email links here
  // pointing at the month it just recapped, not whatever month happens to be
  // current when the user clicks through.
  const [{ year, month }, setYearMonth] = useState(() => {
    const y = Number(searchParams.get("year"));
    const m = Number(searchParams.get("month"));
    if (y && m && m >= 1 && m <= 12) return { year: y, month: m };
    return defaultYearMonth();
  });
  const [data, setData] = useState<MonthlyReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // 404 monthly_report_window_closed: outside days 1-3 (server is the real gate).
  const [windowClosed, setWindowClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setWindowClosed(false);
    api.get("/api/monthly-report", { params: { year, month }, timeout: 30000 })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => {
        if (cancelled) return;
        if (err?.response?.status === 404 && err?.response?.data?.detail?.code === "monthly_report_window_closed") setWindowClosed(true);
        else setError(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, month]);

  const close = () => router.back();

  const navigateMonth = useCallback((direction: -1 | 1) => {
    setYearMonth(({ year, month }) => {
      let newMonth = month + direction;
      let newYear = year;
      if (newMonth < 1) { newMonth = 12; newYear -= 1; }
      if (newMonth > 12) { newMonth = 1; newYear += 1; }
      return { year: newYear, month: newMonth };
    });
  }, []);

  const now = currentYearMonth();
  const canGoNext = year < now.year || (year === now.year && month < now.month);
  // No hard lower bound known client-side (account inception varies per
  // user) — a month with nothing real just shows its own honest empty
  // state below; the user can always navigate back further manually.
  const canGoPrev = true;

  return (
    <div style={{ position: "fixed", inset: 0, background: WT.bg, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      {loading && <Loader2 className="animate-spin" size={28} color={WT.accentL} />}

      {/* Free: 3-line executive summary instead of a flat paywall — real
          numbers (return, best/worst position), full attribution/habits/
          research breakdown stays behind Premium. 2026-09-17. */}
      {!loading && data && data.available && data.is_premium === false && (
        <div style={{ maxWidth: 360, textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: WT.accentL, marginBottom: 6 }}>
            {data.overview.month_label}
          </p>
          <h1 style={{ fontWeight: 800, fontSize: 20, color: WT.text, marginBottom: 20 }}>Tu resumen del mes</h1>

          {data.summary.return_pct !== null ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 8 }}>
              {data.summary.return_pct >= 0 ? <TrendingUp size={20} color={WT.accentL} /> : <TrendingDown size={20} color="#ef4444" />}
              <span style={{ fontSize: 30, fontWeight: 800, color: data.summary.return_pct >= 0 ? WT.accentL : "#ef4444" }}>
                {fmtPct(data.summary.return_pct)}
              </span>
            </div>
          ) : (
            <p style={{ fontSize: 14, color: WT.sub, marginBottom: 8 }}>Sin suficiente actividad de portafolio este mes.</p>
          )}
          {data.summary.benchmark_pct !== null && (
            <p style={{ fontSize: 13, color: WT.sub, marginBottom: 20 }}>
              S&amp;P 500: <span style={{ fontWeight: 700 }}>{fmtPct(data.summary.benchmark_pct)}</span>
            </p>
          )}

          {(data.summary.best_position || data.summary.worst_position) && (
            <div style={{ display: "flex", gap: 10, marginBottom: 24 }}>
              {data.summary.best_position && (
                <div style={{ flex: 1, borderRadius: 14, border: `1px solid ${WT.border}`, background: WT.card2, padding: 14 }}>
                  <p style={{ fontSize: 11, color: WT.sub, marginBottom: 4 }}>Mejor posición</p>
                  <p style={{ fontSize: 14, fontWeight: 800, color: WT.text }}>{data.summary.best_position.ticker}</p>
                  <p style={{ fontSize: 12, color: WT.accentL, fontWeight: 700 }}>{fmtPct(data.summary.best_position.move_pct)}</p>
                </div>
              )}
              {data.summary.worst_position && (
                <div style={{ flex: 1, borderRadius: 14, border: `1px solid ${WT.border}`, background: WT.card2, padding: 14 }}>
                  <p style={{ fontSize: 11, color: WT.sub, marginBottom: 4 }}>Peor posición</p>
                  <p style={{ fontSize: 14, fontWeight: 800, color: WT.text }}>{data.summary.worst_position.ticker}</p>
                  <p style={{ fontSize: 12, color: "#ef4444", fontWeight: 700 }}>{fmtPct(data.summary.worst_position.move_pct)}</p>
                </div>
              )}
            </div>
          )}

          <div style={{ borderRadius: 14, border: `1px solid ${WT.border}`, background: "rgba(212,162,76,0.08)", padding: 16, marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left" }}>
            <Lock size={18} color={WT.gold} style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ fontSize: 13, color: WT.sub, lineHeight: 1.5 }}>
              Premium desbloquea la atribución completa, tus hábitos de inversión, investigación del mes y tu evolución como inversor.
            </p>
          </div>

          <button onClick={close} style={{ padding: "12px 28px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            Volver
          </button>
        </div>
      )}

      {!loading && windowClosed && (
        <div style={{ maxWidth: 340, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>🔒</div>
          <h1 style={{ fontWeight: 800, fontSize: 18, color: WT.text, marginBottom: 10 }}>Tu Monthly Report abre del 1 al 3 de cada mes</h1>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub, lineHeight: 1.5, marginBottom: 24 }}>
            Vuelve el próximo día 1 para ver cómo te fue este mes.
          </p>
          <button onClick={close} style={{ padding: "10px 20px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            Volver
          </button>
        </div>
      )}

      {!loading && error && (
        <div style={{ maxWidth: 320, textAlign: "center", padding: 32 }}>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub }}>No pudimos cargar tu Monthly Report. Intenta de nuevo en unos minutos.</p>
        </div>
      )}

      {!loading && data && !data.available && (
        <div style={{ maxWidth: 340, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>{month === now.month && year === now.year ? "🌱" : "📅"}</div>
          <h1 style={{ fontWeight: 800, fontSize: 18, color: WT.text, marginBottom: 10 }}>
            {data.reason === "before_account_inception" ? "Todavía no existías en Nuvos" : "Tu Monthly Report está tomando forma"}
          </h1>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub, lineHeight: 1.5, marginBottom: 24 }}>
            {data.reason === "before_account_inception"
              ? "Este mes es anterior a tu primera inversión con Nuvos."
              : "No tenemos suficiente actividad todavía. Sigue aprendiendo y tomando decisiones en Nuvos."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => navigateMonth(1)} disabled={!canGoNext} style={{ padding: "10px 20px", borderRadius: 100, background: WT.card2, border: `1px solid ${WT.border}`, color: WT.text, fontWeight: 700, fontSize: 13, cursor: canGoNext ? "pointer" : "default", opacity: canGoNext ? 1 : 0.4 }}>
              Mes siguiente
            </button>
            <button onClick={close} style={{ padding: "10px 20px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              Volver
            </button>
          </div>
        </div>
      )}

      {!loading && data && data.available && data.is_premium !== false && (
        <MonthlyReportFlow data={data} year={year} month={month} onClose={close} onNavigateMonth={navigateMonth} canGoPrev={canGoPrev} canGoNext={canGoNext} />
      )}
    </div>
  );
}
