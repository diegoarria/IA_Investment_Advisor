"use client";

// Fase 4, Incremento 8 — Investment Checklist (Parte H). A personalizable
// checklist that gates marking a company "Invertible" — no new financial
// logic, purely a decision-discipline UI on top of migration 065's tables
// (checklist_service.py). Self-contained: owns its own fetch/mutation state
// (unlike ThesisHistoryPanel/CompanyTimeline, which receive data as props)
// because every interaction here is a direct user mutation (check an item,
// add/remove a custom item, mark investable), not a read the page already
// orchestrates alongside other panels.
//
// Different from ChecklistDisplay (subvaluadas/shared.tsx) — that one
// renders the read-only, backend-computed 7-point NIF checklist
// (`data.checklist`); this one is the user's own personalized, persisted,
// per-company checklist.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Plus, X, ShieldCheck } from "lucide-react";
import { Card, SectionHeader, Badge } from "@/components/ui";
import { checklistApi } from "@/lib/api";
import { ChecklistItem, isChecklistComplete, checklistProgress } from "@/lib/investmentChecklist";

export function InvestmentChecklistPanel({ ticker }: { ticker: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [isInvestable, setIsInvestable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    checklistApi.getForTicker(ticker)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data?.items ?? []);
        setIsInvestable(!!res.data?.is_investable);
      })
      .catch(() => { if (!cancelled) { setItems([]); setIsInvestable(false); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  };

  useEffect(() => { return load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ticker]);

  const toggleItem = async (item: ChecklistItem) => {
    const next = !item.checked;
    setItems((prev) => prev.map((i) => (i.item_key === item.item_key ? { ...i, checked: next } : i)));
    setMarkError(null);
    try {
      await checklistApi.toggleItem(ticker, item.item_key, next);
    } catch {
      setItems((prev) => prev.map((i) => (i.item_key === item.item_key ? { ...i, checked: !next } : i)));
    }
  };

  const addItem = async () => {
    const label = newLabel.trim();
    if (!label || adding) return;
    setAdding(true);
    try {
      const res = await checklistApi.addItem(label);
      const freshKeys = new Set<string>((res.data?.items ?? []).map((i: ChecklistItem) => i.item_key));
      const alreadyChecked = new Set(items.filter((i) => i.checked).map((i) => i.item_key));
      setItems((res.data?.items ?? []).map((i: ChecklistItem) => ({ ...i, checked: freshKeys.has(i.item_key) && alreadyChecked.has(i.item_key) })));
      setNewLabel("");
    } catch {
      // real failure — leave the input as-is so the user can retry
    } finally {
      setAdding(false);
    }
  };

  const removeItem = async (itemKey: string) => {
    const checkedBefore = new Set(items.filter((i) => i.checked).map((i) => i.item_key));
    try {
      const res = await checklistApi.removeItem(itemKey);
      setItems((res.data?.items ?? []).map((i: ChecklistItem) => ({ ...i, checked: checkedBefore.has(i.item_key) })));
    } catch {
      // real failure — nothing removed locally, list stays consistent with the server
    }
  };

  const handleSetInvestable = async (marked: boolean) => {
    setMarking(true);
    setMarkError(null);
    try {
      await checklistApi.setInvestable(ticker, marked);
      setIsInvestable(marked);
    } catch {
      setMarkError(t("subvaluadas.investableChecklist.markError"));
    } finally {
      setMarking(false);
    }
  };

  const complete = isChecklistComplete(items);
  const progress = checklistProgress(items);

  return (
    <Card className="mb-6">
      <SectionHeader
        title={t("subvaluadas.investableChecklist.title")}
        subtitle={t("subvaluadas.investableChecklist.subtitle")}
        action={isInvestable ? <Badge tone="positive">{t("subvaluadas.investableChecklist.markedBadge")}</Badge> : undefined}
      />

      {loading ? (
        <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t("subvaluadas.investableChecklist.loading")}</p>
      ) : (
        <>
          <ul className="space-y-1.5 mb-3">
            {items.map((item) => {
              const label = item.label ?? t(`subvaluadas.investableChecklist.items.${item.item_key}`, item.item_key);
              return (
                <li key={item.item_key} className="flex items-center gap-2 group">
                  <button
                    type="button"
                    onClick={() => toggleItem(item)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    {item.checked ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#22c55e" }} />
                    ) : (
                      <Circle className="w-4 h-4 shrink-0" style={{ color: "var(--muted)" }} />
                    )}
                    <span className="text-[12.5px] truncate" style={{ color: item.checked ? "var(--sub)" : "var(--text)" }}>
                      {label}
                    </span>
                  </button>
                  {item.is_custom && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.item_key)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      aria-label={t("subvaluadas.investableChecklist.removeItem")}
                    >
                      <X className="w-3.5 h-3.5" style={{ color: "var(--muted)" }} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="flex items-center gap-2 mb-4">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
              placeholder={t("subvaluadas.investableChecklist.addPlaceholder")}
              className="flex-1 min-w-0 text-[12px] rounded-lg px-2.5 py-1.5 border bg-transparent"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            />
            <button
              type="button"
              onClick={addItem}
              disabled={adding || !newLabel.trim()}
              className="shrink-0 flex items-center gap-1 text-[11.5px] font-semibold rounded-lg px-2.5 py-1.5 border disabled:opacity-40"
              style={{ borderColor: "var(--border)", color: "var(--accent-l)" }}
            >
              <Plus className="w-3.5 h-3.5" /> {t("subvaluadas.investableChecklist.addItem")}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-[11px] tabular-nums" style={{ color: "var(--muted)" }}>
              {t("subvaluadas.investableChecklist.progress", { checked: progress.checked, total: progress.total })}
            </p>
            {isInvestable ? (
              <button
                type="button"
                onClick={() => handleSetInvestable(false)}
                disabled={marking}
                className="text-[11.5px] font-semibold rounded-lg px-3 py-1.5 border disabled:opacity-40"
                style={{ borderColor: "var(--border)", color: "var(--sub)" }}
              >
                {t("subvaluadas.investableChecklist.unmark")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSetInvestable(true)}
                disabled={marking || !complete}
                title={!complete ? t("subvaluadas.investableChecklist.incompleteHint") : undefined}
                className="flex items-center gap-1.5 text-[11.5px] font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40"
                style={{ background: complete ? "var(--accent-l)" : "var(--raised)", color: complete ? "#0a0a0a" : "var(--muted)" }}
              >
                <ShieldCheck className="w-3.5 h-3.5" /> {t("subvaluadas.investableChecklist.markInvestable")}
              </button>
            )}
          </div>
          {markError && <p className="text-[11px] mt-2" style={{ color: "#ef4444" }}>{markError}</p>}
        </>
      )}
    </Card>
  );
}
