"use client";

import { useEffect, useState } from "react";
import { market as marketApi } from "@/lib/api";

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

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1000)  return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return p.toFixed(2);
}

export default function MarketTickerBar() {
  const [data, setData] = useState<Idx[]>([]);

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
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (!data.length) return null;

  return (
    <div
      className="scrollbar-none"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        height: 30,
        display: "flex",
        alignItems: "center",
        overflowX: "auto",
        background: "var(--card)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      {/* centered row — min-w-max so it scrolls on narrow screens */}
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
        {data.map((idx, i) => {
          const up  = idx.change_pct >= 0;
          const col = up ? "var(--up)" : "var(--down)";
          return (
            <div
              key={idx.symbol}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                paddingLeft: 18,
                paddingRight: 18,
                height: 30,
                borderRight: i < data.length - 1
                  ? "1px solid var(--border)"
                  : undefined,
              }}
            >
              {/* Index name */}
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--sub)",
                  whiteSpace: "nowrap",
                }}
              >
                {ABBR[idx.name] ?? idx.name}
              </span>

              {idx.price != null && (
                <>
                  {/* Price */}
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: "var(--text)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fmtPrice(idx.price)}
                  </span>

                  {/* Change */}
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 700,
                      color: col,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {up ? "▲" : "▼"}&nbsp;{Math.abs(idx.change_pct).toFixed(2)}%
                  </span>

                  {/* $ change (subtle) */}
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 500,
                      color: col,
                      opacity: 0.65,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ({up ? "+" : ""}{idx.change >= 0.01 || idx.change <= -0.01 ? idx.change.toFixed(2) : idx.change.toFixed(4)})
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
