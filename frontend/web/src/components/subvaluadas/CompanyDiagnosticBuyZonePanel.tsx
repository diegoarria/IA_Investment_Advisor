"use client";

// "Mi Zona de Compra" module, themed to match CompanyDiagnosticCard (dark/
// light theme tokens, larger type, same visual language as the rest of the
// card) instead of FollowAlertPanel.tsx's hardcoded light/white styling.
//
// FollowAlertPanel itself is intentionally NOT touched — it's shared with
// the real /subvaluadas page, where its white background was Diego's own
// explicit prior request ("la pantalla de fondo blanco") and must keep
// working exactly as-is there. This is a separate component with the same
// real logic (price-alert fetch/create/remove via priceAlerts, same i18n
// copy under subvaluadas.followAlert.*) restyled for this card only.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Target, Bell, Check, Plus, Loader2, Trash2 } from "lucide-react";
import { priceAlerts } from "@/lib/api";
import { fmtPrice } from "@/lib/types/stock";

const PRESETS = [0, 10, 20, 30, 40, 50];
const DEFAULT_PCT = 20;
const _ACCENT_GREEN = "#4FA695"; // same "bull"/positive tone used throughout this card

interface StoredAlert {
  ticker: string;
  name: string | null;
  target_price: number;
  condition: "above" | "below";
}

interface Props {
  ticker: string;
  companyName: string | null;
  price: number | null;
  intrinsicValue: number | null;
  currency?: string;
  defaultMarginPct?: number | null;
}

export function CompanyDiagnosticBuyZonePanel({ ticker, companyName, price, intrinsicValue, currency = "USD", defaultMarginPct }: Props) {
  const { t } = useTranslation();
  const [existing, setExisting] = useState<StoredAlert | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [selectedPct, setSelectedPct] = useState<number>(() => (defaultMarginPct != null ? Math.round(defaultMarginPct) : DEFAULT_PCT));
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    priceAlerts.list()
      .then((res) => {
        if (cancelled) return;
        const rows: StoredAlert[] = res.data || [];
        const mine = rows.find((r) => r.ticker === ticker.toUpperCase() && r.condition === "below") || null;
        setExisting(mine);
        if (mine && intrinsicValue) {
          const impliedPct = Math.round((1 - mine.target_price / intrinsicValue) * 100);
          setSelectedPct(impliedPct);
        }
      })
      .catch(() => { if (!cancelled) setExisting(null); })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const targetPrice = useMemo(() => {
    if (intrinsicValue == null) return null;
    return intrinsicValue * (1 - selectedPct / 100);
  }, [intrinsicValue, selectedPct]);

  const otherPresets = PRESETS.filter((p) => p !== selectedPct);

  const handleSelect = (pct: number) => {
    setSelectedPct(pct);
    setJustSaved(false);
    setError(null);
    setCustomOpen(false);
  };

  const handleCustomSubmit = () => {
    const v = parseFloat(customInput);
    if (!Number.isFinite(v) || v < 0 || v > 95) return;
    handleSelect(Math.round(v));
    setCustomInput("");
  };

  const handleCreate = async () => {
    if (targetPrice == null) return;
    setSaving(true);
    setError(null);
    try {
      await priceAlerts.create(ticker.toUpperCase(), targetPrice, "below", companyName || ticker.toUpperCase());
      setExisting({ ticker: ticker.toUpperCase(), name: companyName, target_price: targetPrice, condition: "below" });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof raw === "string" ? raw : t("subvaluadas.followAlert.error"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await priceAlerts.remove(ticker.toUpperCase());
      setExisting(null);
      setJustSaved(false);
    } catch {
      setError(t("subvaluadas.followAlert.error"));
    } finally {
      setRemoving(false);
    }
  };

  if (intrinsicValue == null || price == null) return null;

  return (
    <div className="mt-4 rounded-2xl p-5 sm:p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 mb-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--raised)" }}>
          <Target className="w-5 h-5" style={{ color: _ACCENT_GREEN }} />
        </div>
        <div>
          <p className="text-[17px] font-bold" style={{ color: "var(--text)" }}>{t("subvaluadas.followAlert.title", { ticker: ticker.toUpperCase() })}</p>
          <p className="text-[13px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.followAlert.subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Primary card — currently selected margin */}
        <div className="lg:w-[420px] shrink-0 rounded-2xl p-5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <span
            className="inline-block text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg mb-3.5"
            style={{ background: `${_ACCENT_GREEN}1f`, color: _ACCENT_GREEN }}
          >
            {t("subvaluadas.followAlert.badge")}
          </span>
          <p className="text-[22px] font-black leading-snug" style={{ color: "var(--text)" }}>
            {t("subvaluadas.followAlert.belowLabel", { pct: selectedPct })}
          </p>
          {targetPrice != null && (
            <p className="text-[14px] mt-1" style={{ color: "var(--dim)" }}>· {fmtPrice(targetPrice, currency)}</p>
          )}
          <p className="text-[14px] mt-3 leading-relaxed" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.followAlert.description")}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-xl p-3" style={{ background: "var(--card)" }}>
              <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.followAlert.currentPrice")}</p>
              <p className="text-[17px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(price, currency)}</p>
            </div>
            <div className="rounded-xl p-3" style={{ background: "var(--card)" }}>
              <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{t("subvaluadas.followAlert.intrinsicValue")}</p>
              <p className="text-[17px] font-black tabular-nums mt-0.5" style={{ color: "var(--text)" }}>{fmtPrice(intrinsicValue, currency)}</p>
            </div>
            <div className="col-span-2 rounded-xl p-3" style={{ background: `${_ACCENT_GREEN}14`, border: `1px solid ${_ACCENT_GREEN}` }}>
              <p className="text-[12px] font-bold uppercase tracking-wide" style={{ color: _ACCENT_GREEN }}>{t("subvaluadas.followAlert.marginOfSafety", { pct: selectedPct })}</p>
              <p className="text-[19px] font-black tabular-nums mt-0.5" style={{ color: _ACCENT_GREEN }}>{targetPrice != null ? fmtPrice(targetPrice, currency) : "—"}</p>
            </div>
          </div>

          {error && <p className="text-[13px] mt-3" style={{ color: "#ef4444" }}>{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving || loadingExisting}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3.5 text-[14px] font-bold disabled:opacity-60"
              style={{ background: justSaved ? _ACCENT_GREEN : "var(--brand-green)", color: "#fff" }}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : justSaved ? (
                <Check className="w-4 h-4" />
              ) : (
                <Bell className="w-4 h-4" />
              )}
              {saving
                ? t("subvaluadas.followAlert.creating")
                : justSaved
                  ? t("subvaluadas.followAlert.created")
                  : existing
                    ? t("subvaluadas.followAlert.updateButton", { pct: selectedPct })
                    : t("subvaluadas.followAlert.createButton", { pct: selectedPct })}
            </button>
            {existing && (
              <button
                onClick={handleRemove}
                disabled={removing}
                className="rounded-xl px-4 flex items-center justify-center disabled:opacity-60"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                title={t("subvaluadas.followAlert.removeButton")}
              >
                {removing ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} /> : <Trash2 className="w-4 h-4" style={{ color: "#ef4444" }} />}
              </button>
            )}
          </div>
        </div>

        {/* Other margin options */}
        <div className="flex-1">
          <p className="text-[12px] font-bold uppercase tracking-wide mb-3" style={{ color: "var(--muted)" }}>
            {t("subvaluadas.followAlert.otherOptions")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {otherPresets.map((pct) => (
              <button
                key={pct}
                onClick={() => handleSelect(pct)}
                className="rounded-xl px-2 py-3 flex flex-col items-center justify-center text-center min-h-[76px] transition-colors duration-150"
                style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
              >
                <p className="text-[17px] font-black tabular-nums" style={{ color: "var(--text)" }}>{pct}%</p>
                {intrinsicValue != null && (
                  <p className="text-[11px] font-semibold tabular-nums mt-0.5" style={{ color: "var(--muted)" }}>
                    {fmtPrice(intrinsicValue * (1 - pct / 100), currency)}
                  </p>
                )}
              </button>
            ))}
            {!customOpen ? (
              <button
                onClick={() => setCustomOpen(true)}
                className="rounded-xl px-2 py-3 flex flex-col items-center justify-center gap-1 min-h-[76px]"
                style={{ background: "transparent", border: "1px dashed var(--border)" }}
              >
                <Plus className="w-4 h-4" style={{ color: "var(--dim)" }} />
                <p className="text-[11px] font-semibold text-center" style={{ color: "var(--muted)" }}>{t("subvaluadas.followAlert.customOption")}</p>
              </button>
            ) : (
              <div className="col-span-3 rounded-xl p-3 flex items-center gap-1.5" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
                <input
                  autoFocus
                  type="number"
                  min={0}
                  max={95}
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCustomSubmit()}
                  placeholder={t("subvaluadas.followAlert.customPlaceholder")}
                  className="w-full text-[14px] bg-transparent outline-none"
                  style={{ color: "var(--text)" }}
                />
                <button onClick={handleCustomSubmit} className="text-[13px] font-bold shrink-0" style={{ color: _ACCENT_GREEN }}>
                  {t("subvaluadas.followAlert.customApply")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
