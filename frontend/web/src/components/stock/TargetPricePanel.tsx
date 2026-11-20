"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Target, Bell, Check, Loader2, Trash2, ArrowUp, ArrowDown, AlertTriangle } from "lucide-react";
import { priceAlerts } from "@/lib/api";
import { fmtPrice } from "@/lib/types/stock";
import { GlowCard, IconSquare } from "@/components/subvaluadas/radarUi";

// Same brand green as --brand-green-l / --accent-l in globals.css — a
// literal hex (not the CSS var) because GlowCard concatenates an alpha
// suffix onto `tint` (e.g. `${tint}1c`), which only works on a real hex
// string, same reason radarUi.tsx hardcodes GOLD instead of using a var.
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

// Horizontal position gauge: plots the current price against either a
// single target or a [low, high] range on one shared axis, so the user
// sees at a glance how far the price has to move — never a new number,
// only a visual re-presentation of values already shown as text above.
function PriceGauge({
  price, low, high, currency,
}: { price: number; low: number; high: number | null; currency: string }) {
  const targets = high != null ? [low, high] : [low];
  const allValues = [price, ...targets];
  const spread = Math.max(...allValues) - Math.min(...allValues) || 1;
  const pad = spread * 0.35;
  const min = Math.min(...allValues) - pad;
  const max = Math.max(...allValues) + pad;
  const toPct = (v: number) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

  const pricePct = toPct(price);
  const lowPct = toPct(low);
  const highPct = high != null ? toPct(high) : null;

  return (
    <div className="relative pt-7 pb-6">
      <div className="relative h-1.5 rounded-full" style={{ background: "var(--raised)" }}>
        {highPct != null ? (
          <div
            className="absolute top-0 h-full rounded-full"
            style={{ left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 1.5)}%`, background: `${BRAND_GREEN}40` }}
          />
        ) : (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
            style={{ left: `calc(${lowPct}% - 6px)`, background: BRAND_GREEN, boxShadow: `0 0 10px ${BRAND_GREEN}99` }}
          />
        )}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full z-10"
          style={{
            left: `calc(${pricePct}% - 7px)`,
            background: "var(--card)",
            border: `2.5px solid var(--text)`,
          }}
        />
      </div>

      {/* Price label — flips side near the edges so it never clips. */}
      <div
        className="absolute text-[11px] font-black tabular-nums whitespace-nowrap"
        style={{
          top: 0,
          left: `${pricePct}%`,
          transform: pricePct > 80 ? "translateX(-100%)" : pricePct < 20 ? "translateX(0%)" : "translateX(-50%)",
          color: "var(--text)",
        }}
      >
        {fmtPrice(price, currency)}
      </div>

      {/* Target label(s) below the track. */}
      {highPct != null ? (
        <>
          <div className="absolute text-[10.5px] font-bold tabular-nums whitespace-nowrap" style={{ bottom: 0, left: `${lowPct}%`, transform: "translateX(-50%)", color: BRAND_GREEN }}>
            {fmtPrice(low, currency)}
          </div>
          <div className="absolute text-[10.5px] font-bold tabular-nums whitespace-nowrap" style={{ bottom: 0, left: `${highPct}%`, transform: "translateX(-50%)", color: BRAND_GREEN }}>
            {fmtPrice(high, currency)}
          </div>
        </>
      ) : (
        <div
          className="absolute text-[10.5px] font-bold tabular-nums whitespace-nowrap"
          style={{ bottom: 0, left: `${lowPct}%`, transform: lowPct > 80 ? "translateX(-100%)" : lowPct < 20 ? "translateX(0%)" : "translateX(-50%)", color: BRAND_GREEN }}
        >
          {fmtPrice(low, currency)}
        </div>
      )}
    </div>
  );
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
  const rangeTyped = validSingle && Number.isFinite(high) && highInput !== "";
  const rangeOrderOk = rangeTyped && high > low;
  const validRange = rangeOrderOk;
  const canSave = mode === "single" ? validSingle : validRange;

  const impliedCondition: "above" | "below" | null = useMemo(() => {
    if (mode !== "single" || !validSingle) return null;
    return price != null && low > price ? "above" : "below";
  }, [mode, validSingle, low, price]);

  // Distance-to-target readout — purely a re-presentation of numbers
  // already on screen (price, low/high inputs), never a new computation
  // the backend doesn't also imply.
  const distanceNote = useMemo(() => {
    if (price == null) return null;
    if (mode === "single" && validSingle) {
      if (impliedCondition === "above") {
        if (low <= price) return t("stockDetailModal.targetPrice.gauge.reached");
        const pct = (((low - price) / price) * 100).toFixed(1);
        return t("stockDetailModal.targetPrice.gauge.toReachAbove", { pct });
      }
      if (low >= price) return t("stockDetailModal.targetPrice.gauge.reached");
      const pct = (((price - low) / price) * 100).toFixed(1);
      return t("stockDetailModal.targetPrice.gauge.toReachBelow", { pct });
    }
    if (mode === "range" && validRange) {
      if (price >= low && price <= high) return t("stockDetailModal.targetPrice.gauge.inRange");
      if (price < low) {
        const pct = (((low - price) / price) * 100).toFixed(1);
        return t("stockDetailModal.targetPrice.gauge.belowRange", { pct });
      }
      const pct = (((price - high) / price) * 100).toFixed(1);
      return t("stockDetailModal.targetPrice.gauge.aboveRange", { pct });
    }
    return null;
  }, [price, mode, validSingle, validRange, low, high, impliedCondition, t]);

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
        <IconSquare color={BRAND_GREEN} size={42}>
          <Target className="w-5 h-5" style={{ color: BRAND_GREEN }} />
        </IconSquare>
        <div className="flex-1 min-w-0">
          <p className="text-[16.5px] font-black tracking-tight" style={{ color: "var(--text)" }}>{t("stockDetailModal.targetPrice.title")}</p>
          <p className="text-[12.5px] font-medium" style={{ color: "var(--muted)" }}>{t("stockDetailModal.targetPrice.subtitle")}</p>
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

      {/* Visual price-vs-target gauge — only when there's something real to plot. */}
      {(existing || canSave) && (
        <div className="rounded-2xl px-4 mb-4" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
          <PriceGauge
            price={price}
            low={canSave ? low : existing!.target_price}
            high={canSave ? (mode === "range" ? high : null) : existing!.target_price_high}
            currency={currency}
          />
        </div>
      )}
      {distanceNote && (
        <p className="text-[12px] font-bold mb-4 -mt-1 flex items-center gap-1.5" style={{ color: "var(--sub)" }}>
          {distanceNote}
        </p>
      )}

      {/* Mode toggle */}
      <div className="flex gap-1.5 p-[5px] rounded-[18px] mb-4" style={{ background: "rgba(0,0,0,0.22)" }}>
        {(["single", "range"] as const).map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => { setMode(m); setJustSaved(false); setError(null); }}
              className="flex-1 rounded-[14px] py-[11px] text-[12px] font-black uppercase tracking-wide transition-all duration-150"
              style={{
                background: active ? `linear-gradient(135deg, ${BRAND_GREEN}, ${BRAND_GREEN_D})` : "transparent",
                color: active ? "#061308" : "var(--sub)",
                boxShadow: active ? `0 2px 10px ${BRAND_GREEN}33` : "none",
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
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold pointer-events-none" style={{ color: "var(--muted)" }}>$</span>
            <input
              type="number"
              min={0}
              value={lowInput}
              onChange={(e) => { setLowInput(e.target.value); setJustSaved(false); setError(null); }}
              placeholder={t("stockDetailModal.targetPrice.lowPlaceholder")}
              className="w-full rounded-2xl pl-8 pr-4 py-3 text-[15px] font-bold bg-transparent outline-none tabular-nums transition-colors focus:border-[var(--text)]"
              style={{ color: "var(--text)", background: "var(--card)", border: "1px solid var(--border)" }}
            />
          </div>
        </div>
        {mode === "range" && (
          <div className="flex-1 min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--muted)" }}>
              {t("stockDetailModal.targetPrice.highLabel")}
            </p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] font-bold pointer-events-none" style={{ color: "var(--muted)" }}>$</span>
              <input
                type="number"
                min={0}
                value={highInput}
                onChange={(e) => { setHighInput(e.target.value); setJustSaved(false); setError(null); }}
                placeholder={t("stockDetailModal.targetPrice.highPlaceholder")}
                className="w-full rounded-2xl pl-8 pr-4 py-3 text-[15px] font-bold bg-transparent outline-none tabular-nums transition-colors"
                style={{
                  color: "var(--text)",
                  background: "var(--card)",
                  border: rangeTyped && !rangeOrderOk ? "1px solid #f87171" : "1px solid var(--border)",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {mode === "range" && rangeTyped && !rangeOrderOk && (
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold mb-3" style={{ color: "#f87171" }}>
          <AlertTriangle className="w-3.5 h-3.5" />
          {t("stockDetailModal.targetPrice.rangeInvalid")}
        </p>
      )}

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
          className="flex items-start gap-2 rounded-2xl px-4 py-3 mb-4 text-[12.5px] font-semibold"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171" }}
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2.5">
        <button
          onClick={handleSave}
          disabled={!canSave || saving || loadingExisting}
          className="flex-1 flex items-center justify-center gap-2 rounded-2xl py-[13px] text-[13.5px] font-black disabled:opacity-40 transition-all duration-150 active:scale-[0.98]"
          style={{
            background: `linear-gradient(135deg, ${BRAND_GREEN}, ${BRAND_GREEN_D})`,
            color: "#061308",
            boxShadow: canSave ? `0 4px 20px ${BRAND_GREEN}40` : "none",
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
            className="rounded-2xl px-4 flex items-center justify-center disabled:opacity-60 transition-all duration-150 active:scale-[0.96]"
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
