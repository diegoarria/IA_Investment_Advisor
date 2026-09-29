"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge, Zap, Leaf, Check, Loader2 } from "lucide-react";
import { billing, type UsageSummary } from "@/lib/api";

// Uso extra (Diego, 2026-09-29) — shows how much of the usage included in
// Premium this month has been used and, once it's reached, lets the user
// turn on uso extra (billed per block, capped) or keep Arthur in economy
// mode until the month resets. `variant="banner"` is the compact version
// shown in Arthur's chat only while that choice is still pending.

function money(minor: number, currency: string) {
  const v = minor / 100;
  return currency === "mxn"
    ? `$${Math.round(v).toLocaleString("en-US")} MXN`
    : `$${v.toFixed(2)} USD`;
}

export default function UsageMeterCard({ variant = "card", refreshKey }: { variant?: "card" | "banner"; refreshKey?: number }) {
  const { t, i18n } = useTranslation();
  const [u, setU] = useState<UsageSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    billing.getUsage().then((r) => setU(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!u) return null;
  if (variant === "banner" && !(u.reached_included && !u.decided)) return null;

  const date = new Date(u.resets_at).toLocaleDateString(i18n.language === "en" ? "en-US" : "es-MX", { day: "numeric", month: "long" });
  const price = money(u.block_price, u.currency);
  const pctBar = Math.min(100, u.pct_used);
  const barColor = u.pct_used >= 100 ? "#f59e0b" : u.pct_used >= 90 ? "#f59e0b" : "var(--accent)";

  const choose = async (enabled: boolean, cap?: number) => {
    setSaving(true); setError(null);
    try {
      const r = await billing.setOverage(enabled, cap ?? u.cap_blocks);
      setU(r.data);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? t("usage.notChargeable"));
    } finally {
      setSaving(false);
    }
  };

  const choiceButtons = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">
      {u.can_opt_in && (
        <button onClick={() => choose(true)} disabled={saving}
                className="text-left rounded-[16px] border p-3.5 transition-all hover:-translate-y-0.5 disabled:opacity-60"
                style={{ background: "rgba(0,185,109,0.10)", borderColor: "rgba(0,185,109,0.4)" }}>
          <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: "var(--accent-l)" }}>
            <Zap className="w-4 h-4" />{t("usage.optionOverage")}
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--sub)" }}>
            {t("usage.optionOverageDesc", { price, cap: u.cap_blocks })}
          </p>
        </button>
      )}
      <button onClick={() => choose(false)} disabled={saving}
              className="text-left rounded-[16px] border p-3.5 transition-all hover:-translate-y-0.5 disabled:opacity-60"
              style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
        <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: "var(--text)" }}>
          <Leaf className="w-4 h-4" style={{ color: "var(--accent-l)" }} />{t("usage.optionEconomy")}
        </p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--sub)" }}>
          {t("usage.optionEconomyDesc", { date })}
        </p>
      </button>
    </div>
  );

  if (variant === "banner") {
    return (
      <div className="rounded-[20px] border p-4" style={{ background: "var(--card)", borderColor: "rgba(245,158,11,0.4)" }}>
        <p className="text-[15px] font-extrabold" style={{ color: "var(--text)" }}>{t("usage.reachedTitle")}</p>
        <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>{t("usage.reachedDesc")}</p>
        {choiceButtons}
        {saving && <p className="flex items-center gap-1.5 text-xs mt-2" style={{ color: "var(--muted)" }}><Loader2 className="w-3.5 h-3.5 animate-spin" />{t("usage.saving")}</p>}
        {error && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[18px] font-extrabold tracking-tight mb-3" style={{ color: "var(--text)" }}>{t("usage.title")}</p>
      <div className="rounded-[20px] border p-5" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: "rgba(0,185,109,0.12)" }}>
            <Gauge className="w-5 h-5" style={{ color: "var(--accent-l)" }} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold" style={{ color: "var(--text)" }}>{t("usage.percentUsed", { pct: u.pct_used })}</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>{t("usage.subtitle")} · {t("usage.resets", { date })}</p>
          </div>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden mt-4" style={{ background: "var(--border)" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pctBar}%`, background: barColor }} />
        </div>

        {u.mode === "included" && (
          <p className="text-[13px] mt-3" style={{ color: "var(--sub)" }}>{t("usage.includedDesc")}</p>
        )}

        {u.reached_included && !u.decided && (
          <>
            <p className="text-sm font-extrabold mt-4" style={{ color: "var(--text)" }}>{t("usage.reachedTitle")}</p>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--sub)" }}>{t("usage.reachedDesc")}</p>
            {choiceButtons}
          </>
        )}

        {u.opted_in && (
          <div className="mt-4 rounded-[14px] border p-3.5" style={{ background: "rgba(0,185,109,0.07)", borderColor: "rgba(0,185,109,0.3)" }}>
            <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: "var(--accent-l)" }}>
              <Check className="w-4 h-4" />{t("usage.overageActive")}
            </p>
            <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>
              {u.blocks_used > 0
                ? t("usage.overageBlocks", { count: u.blocks_used, cap: u.cap_blocks, amount: money(u.extra_charge, u.currency) })
                : t("usage.overageBlocksNone")}
              {" · "}{price} {t("usage.perBlock")}
            </p>
            {u.mode === "economy" && (
              <p className="text-[13px] mt-1" style={{ color: "#f59e0b" }}>{t("usage.capReached", { date })}</p>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <label className="text-xs font-semibold" style={{ color: "var(--muted)" }}>{t("usage.capLabel")}</label>
              <select value={u.cap_blocks} disabled={saving}
                      onChange={(e) => choose(true, Number(e.target.value))}
                      className="text-sm font-bold rounded-lg border px-2 py-1 outline-none"
                      style={{ background: "var(--bg)", borderColor: "var(--border)", color: "var(--text)" }}>
                {[1, 2, 3, 4, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <button onClick={() => choose(false)} disabled={saving}
                      className="ml-auto text-xs font-bold px-3 py-1.5 rounded-full border"
                      style={{ color: "var(--sub)", borderColor: "var(--border)" }}>
                {t("usage.disable")}
              </button>
            </div>
          </div>
        )}

        {u.declined && u.reached_included && (
          <div className="mt-4 rounded-[14px] border p-3.5" style={{ background: "var(--bg)", borderColor: "var(--border)" }}>
            <p className="flex items-center gap-1.5 text-sm font-extrabold" style={{ color: "var(--text)" }}>
              <Leaf className="w-4 h-4" style={{ color: "var(--accent-l)" }} />{t("usage.economyActive")}
            </p>
            <p className="text-[13px] mt-1" style={{ color: "var(--sub)" }}>{t("usage.economyDesc", { date })}</p>
            {u.can_opt_in && (
              <button onClick={() => choose(true)} disabled={saving}
                      className="mt-3 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-extrabold"
                      style={{ background: "#00D47E", color: "#06120D" }}>
                <Zap className="w-3.5 h-3.5" />{t("usage.enable")} · {price} {t("usage.perBlock")}
              </button>
            )}
          </div>
        )}

        {saving && <p className="flex items-center gap-1.5 text-xs mt-2" style={{ color: "var(--muted)" }}><Loader2 className="w-3.5 h-3.5 animate-spin" />{t("usage.saving")}</p>}
        {error && <p className="text-xs mt-2" style={{ color: "#ef4444" }}>{error}</p>}
      </div>
    </div>
  );
}
