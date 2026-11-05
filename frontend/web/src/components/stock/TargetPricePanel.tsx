"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Target, Bell, Check, Loader2, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { priceAlerts } from "@/lib/api";
import { fmtPrice } from "@/lib/types/stock";
import { GlowCard, IconSquare, RaisedTile } from "@/components/subvaluadas/radarUi";

// Same brand green as --brand-green-l / --accent-l in globals.css — a
// literal hex (not the CSS var) because GlowCard/RaisedTile concatenate an
// alpha suffix onto `tint` (e.g. `${tint}1c`), which only works on a real
// hex string, same reason radarUi.tsx hardcodes GOLD instead of using a var.
const BRAND_GREEN = "#00e887";
const BRAND_GREEN_D = "#00b96d";

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

  const impliedCondition: "above" | "below" | null = useMemo(() => {
    if (mode !== "single" || !validSingle) return null;
    return price != null && low > price ? "above" : "below";
  }, [mode, validSingle, low, price]);

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
        const condition: Condition = impliedCondition ?? "below";
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
    <GlowCard tint={BRAND_GREEN} strong>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <IconSquare color={BRAND_GREEN} size={40}>
          <Target className="w-[19px] h-[19px]" style={{ color: BRAND_GREEN }} />
        </IconSquare>
        <div className="flex-1 min-w-0">
          <p className="text-base font-extrabold tracking-tight" style={{ color: "var(--text)" }}>{t("stockDetailModal.targetPrice.title")}</p>
          <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{t("stockDetailModal.targetPrice.subtitle")}</p>
        </div>
        {existing && !loadingExisting && (
          <span
            className="shrink-0 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide"
            style={{ color: BRAND_GREEN, background: `${BRAND_GREEN}1f`, border: `1px solid ${BRAND_GREEN}55` }}
          >
            {t("stockDetailModal.targetPrice.active")}
          </span>
        )}
      </div>

      {/* Current price + saved target */}
      <div className="grid grid-cols-2 gap-2.5 mb-5">
        <RaisedTile tint={BRAND_GREEN}>
          <p className="text-[10.5px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
            {t("stockDetailModal.targetPrice.currentPrice")}
          </p>
          <p className="text-lg font-black tabular-nums" style={{ color: "var(--text)" }}>{fmtPrice(price, currency)}</p>
        </RaisedTile>
        <RaisedTile tint={existing ? BRAND_GREEN : undefined}>
          <p className="text-[10.5px] font-black uppercase tracking-wide mb-1" style={{ color: "var(--muted)" }}>
            {t("stockDetailModal.targetPrice.yourTarget")}
          </p>
          <p className="text-lg font-black tabular-nums truncate" style={{ color: existing ? BRAND_GREEN : "var(--dim)" }}>
            {existing
              ? existing.condition === "range"
                ? `${fmtPrice(existing.target_price, currency)}–${fmtPrice(existing.target_price_high!, currency)}`
                : fmtPrice(existing.target_price, currency)
              : "—"}
          </p>
        </RaisedTile>
      </div>

      {/* Mode toggle — same segmented switch language as the scenario toggle */}
      <div className="flex gap-1.5 p-[5px] rounded-[18px] mb-4" style={{ background: "rgba(0,0,0,0.22)" }}>
        {(["single", "range"] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => { setMode(m); setJustSaved(false); setError(null); }}
              className="flex-1 rounded-[14px] py-[11px] text-[12px] font-black uppercase tracking-wide transition-all"
              style={{
                background: active ? `linear-gradient(135deg, ${BRAND_GREEN}, ${BRAND_GREEN_D})` : "transparent",
                color: active ? "#061308" : "var(--sub)",
              }}
            >
              {t(`stockDetailModal.targetPrice.${m}Mode`)}
            </button>
          );
        })}
      </div>

      {/* Inputs */}
      <div className="flex gap-2.5 mb-2">
        <div className="flex-1 min-w-0">
          {mode === "range" && (
            <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
              {t("stockDetailModal.targetPrice.lowLabel")}
            </p>
          )}
          <input
            type="number"
            min={0}
            value={lowInput}
            onChange={(e) => { setLowInput(e.target.value); setJustSaved(false); setError(null); }}
            placeholder={t("stockDetailModal.targetPrice.lowPlaceholder")}
            className="w-full rounded-2xl px-4 py-3 text-[15px] font-bold bg-transparent outline-none tabular-nums focus:ring-1"
            style={{ color: "var(--text)", background: "var(--raised)", border: "1px solid var(--border)" }}
          />
        </div>
        {mode === "range" && (
          <div className="flex-1 min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
              {t("stockDetailModal.targetPrice.highLabel")}
            </p>
            <input
              type="number"
              min={0}
              value={highInput}
              onChange={(e) => { setHighInput(e.target.value); setJustSaved(false); setError(null); }}
              placeholder={t("stockDetailModal.targetPrice.highPlaceholder")}
              className="w-full rounded-2xl px-4 py-3 text-[15px] font-bold bg-transparent outline-none tabular-nums"
              style={{ color: "var(--text)", background: "var(--raised)", border: "1px solid var(--border)" }}
            />
          </div>
        )}
      </div>

      {mode === "single" && impliedCondition ? (
        <p className="flex items-center gap-1.5 text-[12px] font-bold mb-4" style={{ color: "var(--sub)" }}>
          {impliedCondition === "above"
            ? <ArrowUp className="w-3.5 h-3.5" style={{ color: BRAND_GREEN }} />
            : <ArrowDown className="w-3.5 h-3.5" style={{ color: BRAND_GREEN }} />}
          {t(`stockDetailModal.targetPrice.condition.${impliedCondition}`)}
        </p>
      ) : (
        <div className="mb-4" />
      )}

      {error && (
        <div
          className="rounded-2xl px-4 py-3 mb-4 text-[12.5px] font-semibold"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
        >
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2.5">
        <button
          onClick={handleSave}
          disabled={!canSave || saving || loadingExisting}
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-[13px] text-[13.5px] font-black disabled:opacity-40 transition-all"
          style={{
            background: `linear-gradient(135deg, ${BRAND_GREEN}, ${BRAND_GREEN_D})`,
            color: "#061308",
            boxShadow: canSave ? `0 0 24px ${BRAND_GREEN}3d` : "none",
          }}
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
            className="rounded-2xl px-4 flex items-center justify-center disabled:opacity-60 transition-colors"
            style={{ background: "var(--raised)", border: "1px solid var(--border)" }}
            title={t("stockDetailModal.targetPrice.removeButton")}
          >
            {removing
              ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--muted)" }} />
              : <Trash2 className="w-4 h-4" style={{ color: "#f87171" }} />}
          </button>
        )}
      </div>
    </GlowCard>
  );
}
