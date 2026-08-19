"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, BellRing, Loader2 } from "lucide-react";
import { savedValuationsApi } from "@/lib/api";

// Configurable margin-of-safety alert — save a threshold for THIS ticker
// from Oportunidades, get notified once the live Nuvos AI Fair Value
// Engine margin reaches it (worker.py's job_saved_valuation_alerts).
// No premium gate here: CompanyDiagnosticCard (the only caller) is
// already Premium-only end to end — see valuationPanelMode.ts.
export function CompanyDiagnosticMarginAlert({
  ticker, marginOfSafetyPercent,
}: {
  ticker: string;
  marginOfSafetyPercent: number | null;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    savedValuationsApi.list()
      .then((res) => {
        if (cancelled) return;
        const row = (res.data || []).find((r: { ticker: string }) => r.ticker === ticker);
        setTarget(row ? row.target_margin_of_safety_pct : null);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  const handleSave = async () => {
    const pct = parseFloat(inputValue);
    if (!Number.isFinite(pct)) return;
    setSaving(true);
    setError(false);
    try {
      await savedValuationsApi.save(ticker, pct);
      setTarget(pct);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await savedValuationsApi.remove(ticker);
      setTarget(null);
    } catch {
      // leave as-is, user can retry
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="rounded-xl p-4 mb-5 flex items-center gap-3 flex-wrap" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
      {target !== null && !editing ? (
        <>
          <BellRing className="w-4 h-4 shrink-0" style={{ color: "var(--accent-l)" }} />
          <div className="flex-1 min-w-[140px]">
            <p className="text-[13px] font-bold" style={{ color: "var(--text)" }}>
              {t("companyDiagnostic.marginAlert.activeLabel", { pct: target })}
            </p>
            {marginOfSafetyPercent !== null && (
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                {t("companyDiagnostic.marginAlert.currentLabel", { pct: marginOfSafetyPercent.toFixed(1) })}
              </p>
            )}
          </div>
          <button
            onClick={() => { setInputValue(String(target)); setEditing(true); }}
            className="text-[12px] font-bold transition-opacity hover:opacity-70"
            style={{ color: "var(--accent-l)" }}
          >
            {t("companyDiagnostic.marginAlert.edit")}
          </button>
          <button
            onClick={handleRemove}
            disabled={saving}
            className="text-[12px] font-bold disabled:opacity-40 transition-opacity hover:opacity-70"
            style={{ color: "var(--muted)" }}
          >
            {t("companyDiagnostic.marginAlert.remove")}
          </button>
        </>
      ) : (
        <>
          <Bell className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
          <div className="flex-1 min-w-[140px]">
            <p className="text-[13px] font-bold" style={{ color: "var(--text)" }}>{t("companyDiagnostic.marginAlert.prompt")}</p>
            {error && <p className="text-[11px]" style={{ color: "#ef4444" }}>{t("companyDiagnostic.marginAlert.error")}</p>}
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="20"
            className="w-16 text-[13px] font-bold text-center rounded-lg py-1.5"
            style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
          <span className="text-[12px]" style={{ color: "var(--muted)" }}>%</span>
          <button
            onClick={handleSave}
            disabled={saving || !inputValue}
            className="text-[12px] font-bold px-3 py-1.5 rounded-lg disabled:opacity-40 transition-opacity hover:opacity-90"
            style={{ background: "var(--accent)", color: "#062a1a" }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("companyDiagnostic.marginAlert.save")}
          </button>
          {editing && (
            <button onClick={() => setEditing(false)} className="text-[12px]" style={{ color: "var(--muted)" }}>
              {t("companyDiagnostic.marginAlert.cancel")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
