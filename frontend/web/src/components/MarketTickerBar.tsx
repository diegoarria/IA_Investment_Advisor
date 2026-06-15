"use client";

import { useEffect, useState } from "react";
import { market as marketApi } from "@/lib/api";
import { X, ChevronRight } from "lucide-react";
import type { IndexNewsItem } from "@/lib/types";

interface Idx {
  name: string;
  symbol: string;
  price: number | null;
  change: number;
  change_pct: number;
}

const ABBR: Record<string, string> = {
  "S&P 500":   "S&P 500",
  "Nasdaq":    "Nasdaq",
  "Dow Jones": "Dow Jones",
  "Russell":   "Russell",
  "VIX":       "VIX",
};

function isMarketOpen(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const day = get("weekday");
  if (day === "Sat" || day === "Sun") return false;
  const mins = parseInt(get("hour")) * 60 + parseInt(get("minute"));
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1000)  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toFixed(2);
}

function formatAge(ts: number): string {
  const h = Math.floor((Date.now() / 1000 - ts) / 3600);
  if (h < 1) return "Ahora";
  if (h === 1) return "Hace 1h";
  if (h < 24) return `Hace ${h}h`;
  const days = Math.floor(h / 24);
  return days === 1 ? "Ayer" : `Hace ${days}d`;
}

function NewsModal({ idx, onClose }: { idx: Idx; onClose: () => void }) {
  const up = idx.change_pct >= 0;
  const [news, setNews] = useState<IndexNewsItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    marketApi.getIndexNews(idx.symbol)
      .then((res) => setNews((res.data as IndexNewsItem[]).slice(0, 3)))
      .catch(() => setNews([]))
      .finally(() => setLoading(false));
  }, [idx.symbol]);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(2px)", zIndex: 1100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
           style={{ background: "var(--card)", border: "1px solid var(--border)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b"
             style={{ borderColor: "var(--border)" }}>
          <div>
            <p className="text-sm font-bold" style={{ color: "var(--text)" }}>
              Noticias — {idx.name}
            </p>
            {idx.price !== null && (
              <p className="text-xs mt-0.5 flex items-center gap-2">
                <span style={{ color: "var(--muted)" }}>
                  {fmtPrice(idx.price)}
                </span>
                <span className="font-semibold" style={{ color: up ? "var(--up)" : "var(--down)" }}>
                  {up ? "▲" : "▼"} {Math.abs(idx.change_pct).toFixed(2)}%
                </span>
              </p>
            )}
          </div>
          <button onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: "var(--muted)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* News */}
        {loading ? (
          <div className="p-4 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-full rounded-md animate-pulse" style={{ background: "var(--raised)" }} />
                  <div className="h-4 w-4/5 rounded-md animate-pulse" style={{ background: "var(--raised)" }} />
                  <div className="h-3 w-1/3 rounded-md animate-pulse" style={{ background: "var(--raised)" }} />
                </div>
                <div className="w-20 h-16 rounded-xl animate-pulse shrink-0" style={{ background: "var(--raised)" }} />
              </div>
            ))}
          </div>
        ) : news && news.length > 0 ? (
          news.map((item, i) => (
            <div key={item.uuid || i} className="flex gap-4 px-5 py-4"
                 style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 mb-2">
                  <span className="text-xs font-bold shrink-0 mt-px" style={{ color: "var(--accent-l)" }}>
                    {i + 1}.
                  </span>
                  <p className="text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
                    {item.title}
                  </p>
                </div>
                <p className="text-xs mb-3" style={{ color: "var(--dim)" }}>
                  {item.publisher} · {formatAge(item.timestamp)}
                </p>
                <a href={item.url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:bg-white/5"
                   style={{ color: "var(--accent-l)", borderColor: "var(--border)" }}>
                  Leer artículo <ChevronRight className="w-3 h-3" />
                </a>
              </div>
              {item.thumbnail && (
                <img src={item.thumbnail} alt="" className="w-24 object-cover rounded-xl shrink-0"
                     style={{ height: "72px" }}
                     onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
            </div>
          ))
        ) : (
          <div className="p-8 text-center">
            <p className="text-sm" style={{ color: "var(--dim)" }}>Sin noticias disponibles</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MarketTickerBar() {
  const [data, setData] = useState<Idx[]>([]);
  const [selected, setSelected] = useState<Idx | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = async () => {
      if (typeof window === "undefined") return;
      if (!localStorage.getItem("access_token")) return;
      try {
        const res = await marketApi.getIndices();
        setData(res.data ?? []);
      } catch {}
    };

    load();

    // Re-schedule dynamically: 10s when market open, 5min when closed
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const marketOpen = isMarketOpen();
      setOpen(marketOpen);
      const delay = marketOpen ? 10_000 : 300_000;
      timer = setTimeout(async () => {
        await load();
        schedule();
      }, delay);
    };
    schedule();

    return () => clearTimeout(timer);
  }, []);

  if (!data.length) return null;

  return (
    <>
      <div
        className="scrollbar-none market-ticker-bar"
        style={{
          height: 30,
          display: "flex",
          alignItems: "center",
          overflowX: "auto",
          background: "var(--card)",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minWidth: "max-content",
            gap: 0,
          }}
        >
          {/* Market status indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, paddingLeft: 12, paddingRight: 12, borderRight: "1px solid var(--border)", height: 30 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: open ? "#22c55e" : "var(--muted)",
              boxShadow: open ? "0 0 0 2px rgba(34,197,94,0.25)" : "none",
              animation: open ? "pulse 2s infinite" : "none",
              display: "inline-block",
            }} />
            <span style={{ fontSize: 9, fontWeight: 600, color: open ? "#22c55e" : "var(--dim)", whiteSpace: "nowrap" }}>
              {open ? "LIVE" : "CLOSED"}
            </span>
          </div>

          {data.map((idx, i) => {
            const up  = idx.change_pct >= 0;
            const col = up ? "var(--up)" : "var(--down)";
            return (
              <button
                key={idx.symbol}
                onClick={() => setSelected(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  paddingLeft: 18,
                  paddingRight: 18,
                  height: 30,
                  borderRight: i < data.length - 1 ? "1px solid var(--border)" : undefined,
                  background: "transparent",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span style={{ fontSize: 10, fontWeight: 600, color: "var(--sub)", whiteSpace: "nowrap" }}>
                  {ABBR[idx.name] ?? idx.name}
                </span>

                {idx.price != null && (
                  <>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmtPrice(idx.price)}
                    </span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: col, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {up ? "▲" : "▼"}&nbsp;{Math.abs(idx.change_pct).toFixed(2)}%
                    </span>
                    <span style={{ fontSize: 9, fontWeight: 500, color: col, opacity: 0.65, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      ({up ? "+" : ""}{idx.change >= 0.01 || idx.change <= -0.01 ? idx.change.toFixed(2) : idx.change.toFixed(4)})
                    </span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selected && <NewsModal idx={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
