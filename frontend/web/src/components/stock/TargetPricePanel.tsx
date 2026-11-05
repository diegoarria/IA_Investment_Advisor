"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Target, Bell, Check, Loader2, Trash2 } from "lucide-react";
import { priceAlerts } from "@/lib/api";
import { fmtPrice } from "@/lib/types/stock";

type Condition = "above" | "below" | "range";

interface StoredAlert {
  ticker: string;
  name: string | null;
  target_price: number;
  target_price_high: number | null;
  condition: Condition;
}

interface Props {
  ticker: string;
  companyName: string | null;
  price: number | null;
  currency?: string;
}

export function TargetPricePanel({ ticker, companyName, price, currency = "USD" }: Props) {
  const { t } = useTranslation();
  const [existing, setExisting] = useState<StoredAlert | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [mode, setMode] = useState<"single" | "range">("single");
  const [lowInput, setLowInput] = useState("");
  const [highInput, setHighInput] = useState("");
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
        const mine = rows.find((r) => r.ticker === ticker.toUpperCase()) || null;
        setExisting(mine);
        if (mine) {
          if (mine.condition === "range" && mine.target_price_high != null) {
            setMode("range");
            setLowInput(String(mine.target_price));
            setHighInput(String(mine.target_price_high));
          } else {
            setMode("single");
            setLowInput(String(mine.target_price));
          }
        }
      })
      .catch(() => { if (!cancelled) setExisting(null); })
      .finally(() => { if (!cancelled) setLoadingExisting(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const low = parseFloat(lowInput);
  const high = parseFloat(highInput);
  const validSingle = Number.isFinite(low) && low > 0;
  const validRange = validSingle && Number.isFinite(high) && high > low;
  const canSave = mode === "single" ? validSingle : validRange;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const name = companyName || ticker.toUpperCase();
      if (mode === "range") {
        await priceAlerts.create(ticker.toUpperCase(), low, "range", name, high);
        setExisting({ ticker: ticker.toUpperCase(), name, target_price: low, target_price_high: high, condition: "range" });
      } else {
        const condition: Condition = price != null && low > price ? "above" : "below";
        await priceAlerts.create(ticker.toUpperCase(), low, condition, name);
        setExisting({ ticker: ticker.toUpperCase(), name, target_price: low, target_price_high: null, condition });
      }
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3000);
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const detail = typeof raw === "string" ? raw : (raw as { message?: string })?.message;
      setError(detail || t("stockDetailModal.targetPrice.error"));
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
      setLowInput("");
      setHighInput("");
    } catch {
      setError(t("stockDetailModal.targetPrice.error"));
    } finally {
      setRemoving(false);
    }
  };

  if (price == null) return null;

  return (
    <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 mb-4">
        <Target className="w-5 h-5 shrink-0" style={{ color: "var(--muted)" }} />
        <div>
          <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("stockDetailModal.targetPrice.title")}</p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>{t("stockDetailModal.targetPrice.subtitle")}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode("single")}
          className="flex-1 rounded-xl py-2 text-xs font-bold transition-colors"
          style={{
            background: mode === "single" ? "var(--text)" : "transparent",
            color: mode === "single" ? "var(--bg)" : "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          {t("stockDetailModal.targetPrice.singleMode")}
        </button>
        <button
          onClick={() => setMode("range")}
          className="flex-1 rounded-xl py-2 text-xs font-bold transition-colors"
          style={{
            background: mode === "range" ? "var(--text)" : "transparent",
            color: mode === "range" ? "var(--bg)" : "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          {t("stockDetailModal.targetPrice.rangeMode")}
        </button>
      </div>

      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        {t("stockDetailModal.targetPrice.currentPrice")} <span className="font-bold" style={{ color: "var(--text)" }}>{fmtPrice(price, currency)}</span>
      </p>

      <div className="flex gap-2 mb-3">
        <input
          type="number"
          min={0}
          value={lowInput}
          onChange={(e) => { setLowInput(e.target.value); setJustSaved(false); setError(null); }}
          placeholder={t("stockDetailModal.targetPrice.lowPlaceholder")}
          className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm bg-transparent outline-none"
          style={{ color: "var(--text)", border: "1px solid var(--border)" }}
        />
        {mode === "range" && (
          <input
            type="number"
            min={0}
            value={highInput}
            onChange={(e) => { setHighInput(e.target.value); setJustSaved(false); setError(null); }}
            placeholder={t("stockDetailModal.targetPrice.highPlaceholder")}
            className="flex-1 min-w-0 rounded-xl px-3 py-2.5 text-sm bg-transparent outline-none"
            style={{ color: "var(--text)", border: "1px solid var(--border)" }}
          />
        )}
      </div>

      {error && <p className="text-xs mb-3" style={{ color: "#ef4444" }}>{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!canSave || saving || loadingExisting}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold disabled:opacity-50"
          style={{ background: justSaved ? "#22c55e" : "var(--text)", color: "var(--bg)" }}
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : justSaved ? (
            <Check className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
          {saving
            ? t("stockDetailModal.targetPrice.creating")
            : justSaved
              ? t("stockDetailModal.targetPrice.created")
              : existing
                ? t("stockDetailModal.targetPrice.updateButton")
                : t("stockDetailModal.targetPrice.createButton")}
        </button>
        {existing && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="rounded-xl px-3.5 flex items-center justify-center disabled:opacity-60"
            style={{ border: "1px solid var(--border)" }}
            title={t("stockDetailModal.targetPrice.removeButton")}
          >
            {removing ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} /> : <Trash2 className="w-4 h-4" style={{ color: "#ef4444" }} />}
          </button>
        )}
      </div>
    </div>
  );
}
