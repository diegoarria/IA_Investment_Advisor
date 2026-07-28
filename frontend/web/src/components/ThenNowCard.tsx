"use client";

import { useTranslation } from "react-i18next";

type GraphNode = {
  event_type: string;
  occurred_at: string;
  payload: Record<string, any>;
};

export type ThenNowData = {
  ticker: string;
  then: GraphNode;
  now: GraphNode;
  reversal_detected: boolean;
  reversal_reason: "sign_flip" | "decision_without_new_thesis" | null;
  days_holding: number | null;
};

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

function NodeLine({ node, t }: { node: GraphNode; t: (k: string, o?: any) => string }) {
  const p = node.payload || {};
  if (node.event_type === "thesis") {
    const mos = p.margin_of_safety_pct;
    const parts = [];
    if (mos != null) parts.push(t("thenNow.marginOfSafety", { pct: mos > 0 ? `+${mos}` : mos }));
    if (p.price != null) parts.push(t("thenNow.priceThen", { price: p.price }));
    return <>{parts.join(" · ") || t("thenNow.thesisViewed")}</>;
  }
  const actionKey = p.action === "buy" ? "thenNow.decisionBuy" : p.action === "sell" ? "thenNow.decisionSell" : "thenNow.decisionOther";
  const parts = [t(actionKey)];
  if (p.price_at_action != null) parts.push(t("thenNow.priceThen", { price: p.price_at_action }));
  return <>{parts.join(" · ")}</>;
}

export default function ThenNowCard({ data, className = "" }: { data: ThenNowData; className?: string }) {
  const { t, i18n } = useTranslation();

  return (
    <div className={`rounded-2xl border p-4 ${className}`} style={{ background: "var(--raised)", borderColor: "var(--border)" }}>
      <div className="text-[10.5px] font-extrabold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
        {t("thenNow.title")}
      </div>

      <div className="flex gap-2.5 mb-3">
        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--amber, #f59e0b)" }} />
        <div>
          <div className="text-[10.5px] font-bold" style={{ color: "var(--dim)" }}>{fmtDate(data.then.occurred_at, i18n.language)} · {t("thenNow.then")}</div>
          <div className="text-sm mt-0.5" style={{ color: "var(--sub)" }}><NodeLine node={data.then} t={t} /></div>
        </div>
      </div>

      <div className="h-px mb-3" style={{ background: "var(--border)" }} />

      <div className="flex gap-2.5 mb-3">
        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: "var(--accent)" }} />
        <div>
          <div className="text-[10.5px] font-bold" style={{ color: "var(--dim)" }}>{fmtDate(data.now.occurred_at, i18n.language)} · {t("thenNow.now")}</div>
          <div className="text-sm mt-0.5" style={{ color: "var(--sub)" }}><NodeLine node={data.now} t={t} /></div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {data.reversal_detected && (
          <span
            className="text-[11px] font-bold px-2.5 py-1 rounded-full"
            style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.35)" }}
          >
            ⚠ {data.reversal_reason === "sign_flip" ? t("thenNow.reversalSignFlip") : t("thenNow.reversalNoNewThesis")}
          </span>
        )}
        {data.days_holding != null && (
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ background: "var(--card)", color: "var(--sub)", border: "1px solid var(--border)" }}>
            {t("thenNow.daysHolding", { count: data.days_holding })}
          </span>
        )}
      </div>
    </div>
  );
}
