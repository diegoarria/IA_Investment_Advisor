"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Bookmark, Trash2, ChevronRight } from "lucide-react";
import StockAvatar from "@/components/StockAvatar";
import { savedValuationsApi } from "@/lib/api";

interface SavedValuation {
  ticker: string;
  company_name: string | null;
  sector: string | null;
  target_margin_of_safety_pct: number | null;
  current_price: number | null;
  margin_of_safety_pct: number | null;
  notified_at: string | null;
  stale: boolean;
}

function MarginBadge({ pct }: { pct: number | null }) {
  const { t } = useTranslation();
  if (pct === null) return <span className="text-[10px]" style={{ color: "var(--muted)" }}>{t("profile.savedValuations.noData")}</span>;
  const positive = pct >= 0;
  return (
    <span className="text-xs font-black px-2 py-0.5 rounded-lg"
          style={{ background: positive ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.12)", color: positive ? "#22c55e" : "#ef4444" }}>
      {positive ? "+" : ""}{pct}%
    </span>
  );
}

export default function SavedValuationsSection() {
  const { t } = useTranslation();
  const [items, setItems] = useState<SavedValuation[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    savedValuationsApi.list()
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]));
  }, []);

  const handleDelete = async (ticker: string) => {
    setDeleting(ticker);
    try {
      await savedValuationsApi.remove(ticker);
      setItems((prev) => (prev || []).filter((i) => i.ticker !== ticker));
    } catch {
      // leave it in the list — user can retry
    } finally {
      setDeleting(null);
    }
  };

  if (items === null || items.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-2 ml-0.5" style={{ color: "var(--dim)" }}>
        {t("profile.savedValuations.title")}
      </p>
      <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--card)", borderColor: "var(--border)" }}>
        {items.map((item, i) => (
          <div key={item.ticker} className="flex items-center gap-3 p-3" style={{ borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
            <StockAvatar ticker={item.ticker} size="sm" />
            <Link href={`/subvaluadas?ticker=${item.ticker}`} className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate" style={{ color: "var(--text)" }}>{item.ticker}</p>
              <p className="text-[10px] truncate" style={{ color: "var(--muted)" }}>
                {item.stale
                  ? `${item.company_name} · ${t("profile.savedValuations.stale")}`
                  : item.margin_of_safety_pct !== null && item.target_margin_of_safety_pct !== null
                    ? t("profile.savedValuations.currentVsTarget", { current: item.margin_of_safety_pct, target: item.target_margin_of_safety_pct })
                    : item.company_name}
              </p>
            </Link>
            <MarginBadge pct={item.margin_of_safety_pct} />
            <button onClick={() => handleDelete(item.ticker)} disabled={deleting === item.ticker} className="p-1.5 disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" style={{ color: "var(--dim)" }} />
            </button>
            <Link href={`/subvaluadas?ticker=${item.ticker}`}>
              <ChevronRight className="w-4 h-4" style={{ color: "var(--dim)" }} />
            </Link>
          </div>
        ))}
      </div>
      <p className="text-[10px] mt-2 ml-0.5 flex items-center gap-1" style={{ color: "var(--dim)" }}>
        <Bookmark className="w-3 h-3" />
        {t("profile.savedValuations.footer")}
      </p>
    </div>
  );
}
