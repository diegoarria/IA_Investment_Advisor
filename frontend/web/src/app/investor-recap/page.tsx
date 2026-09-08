"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import api from "@/lib/api";
import RecapFlow from "@/components/investor-recap/RecapFlow";
import { InvestorRecapResponse, WT } from "@/components/investor-recap/types";

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default function InvestorRecapPage() {
  const router = useRouter();
  const [{ year, month }, setYearMonth] = useState(currentYearMonth);
  const [data, setData] = useState<InvestorRecapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [premiumLocked, setPremiumLocked] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPremiumLocked(null);
    api.get("/api/recap/monthly", { params: { year, month }, timeout: 30000 })
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => {
        if (cancelled) return;
        const detail = err?.response?.data?.detail;
        if (err?.response?.status === 403 && detail?.code === "premium_required") {
          setPremiumLocked(detail.message);
        } else {
          setError(true);
        }
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

      {!loading && premiumLocked && (
        <div style={{ maxWidth: 360, textAlign: "center", padding: 32 }}>
          <div style={{ width: 56, height: 56, borderRadius: 18, background: "rgba(212,162,76,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Lock size={26} color={WT.gold} />
          </div>
          <h1 style={{ fontWeight: 800, fontSize: 20, color: WT.text, marginBottom: 10 }}>Investor Recap es Premium</h1>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub, lineHeight: 1.5, marginBottom: 24 }}>{premiumLocked}</p>
          <button onClick={close} style={{ padding: "12px 28px", borderRadius: 100, background: WT.gradGreen, border: "none", color: "#062a1a", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
            Volver
          </button>
        </div>
      )}

      {!loading && error && (
        <div style={{ maxWidth: 320, textAlign: "center", padding: 32 }}>
          <p style={{ fontFamily: "var(--font-ui)", fontSize: 14, color: WT.sub }}>No pudimos cargar tu Investor Recap. Intenta de nuevo en unos minutos.</p>
        </div>
      )}

      {!loading && data && !data.available && (
        <div style={{ maxWidth: 340, textAlign: "center", padding: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 14 }}>{month === now.month && year === now.year ? "🌱" : "📅"}</div>
          <h1 style={{ fontWeight: 800, fontSize: 18, color: WT.text, marginBottom: 10 }}>
            {data.reason === "before_account_inception" ? "Todavía no existías en Nuvos" : "Tu Investor Recap está tomando forma"}
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

      {!loading && data && data.available && (
        <RecapFlow data={data} year={year} month={month} onClose={close} onNavigateMonth={navigateMonth} canGoPrev={canGoPrev} canGoNext={canGoNext} />
      )}
    </div>
  );
}
