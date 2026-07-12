"use client";

import { useId } from "react";

// ─── Google-Finance-style headline bar chart ───────────────────────────────
// Sits atop each financial-statement tab (Income / Balance / Cash Flow) —
// a big headline number + YoY delta, then a clean 5-year bar chart.

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3)  return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

interface Point { label: string; value: number | null }

export default function FinancialHeroChart({
  title, data, color = "#00a85e",
}: {
  title: string;
  data: Point[];
  color?: string;
}) {
  const gradId = useId();
  const valid = data.filter((d) => d.value != null);
  if (valid.length < 2) return null;

  const latest = valid[valid.length - 1];
  const prior = valid.length > 1 ? valid[valid.length - 2] : null;
  const yoy = prior && prior.value ? ((latest.value! - prior.value) / Math.abs(prior.value)) * 100 : null;
  const up = (yoy ?? 0) >= 0;
  const changeColor = up ? "#22c55e" : "#ef4444";

  const W = 680, H = 240;
  const BOTTOM_H = 30;
  const TOP_PAD = 42;
  const PLOT_H = H - BOTTOM_H - TOP_PAD;
  const BASE_Y = H - BOTTOM_H;

  const n = data.length;
  const gap = 18;
  const barW = (W - gap * (n - 1)) / n;
  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));

  const guides = [0.25, 0.5, 0.75].map((f) => BASE_Y - PLOT_H * f);

  return (
    <div className="px-6 pt-6 pb-3 rounded-2xl" style={{ background: "var(--raised)", border: "1px solid var(--border)" }}>
      <div className="flex items-end justify-between mb-1">
        <div>
          <span className="text-[11px] font-black uppercase tracking-[0.12em]" style={{ color: "var(--dim)" }}>
            {title}
          </span>
          <div className="flex items-baseline gap-3 mt-1.5">
            <span className="text-[38px] font-black tabular-nums leading-none tracking-tight" style={{ color: "var(--text)" }}>
              {fmtMoney(latest.value)}
            </span>
            {yoy != null && (
              <span className="text-[15px] font-bold tabular-nums flex items-center gap-1 px-2 py-0.5 rounded-lg"
                    style={{ color: changeColor, background: up ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)" }}>
                {up ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
          {latest.label}
        </span>
      </div>

      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {guides.map((gy, i) => (
          <line key={i} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--border)" strokeWidth={1} strokeDasharray="4,4" />
        ))}
        <line x1={0} y1={BASE_Y} x2={W} y2={BASE_Y} stroke="var(--border)" strokeWidth={1.5} />

        {data.map((d, i) => {
          const x = i * (barW + gap);
          const val = d.value ?? 0;
          const hasVal = d.value != null;
          const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * PLOT_H : 0;
          const y = BASE_Y - barH;
          const isNeg = val < 0;
          const active = i === n - 1;
          const fill = !hasVal ? "var(--border)" : isNeg ? "#ef4444" : active ? `url(#${gradId})` : color;
          const labelY = Math.max(y - 14, TOP_PAD - 18);

          return (
            <g key={i}>
              <rect x={x} y={TOP_PAD} width={barW} height={PLOT_H} rx={8}
                    fill={active ? "rgba(0,168,94,0.08)" : "transparent"} />
              {barH > 0 && (
                <rect x={x} y={y} width={barW} height={Math.max(barH, 4)} rx={8}
                      fill={fill} opacity={active || isNeg ? 1 : 0.5} />
              )}
              <text x={x + barW / 2} y={H - 10} textAnchor="middle"
                    fontSize={13} fontWeight={active ? 800 : 600}
                    fill={active ? "var(--text)" : "var(--dim)"}>
                {d.label}
              </text>
              {hasVal && (
                <text x={x + barW / 2} y={labelY} textAnchor="middle"
                      fontSize={active ? 16 : 13} fontWeight={active ? 800 : 700}
                      fill={isNeg ? "#ef4444" : active ? "var(--text)" : "var(--muted)"}>
                  {fmtMoney(val)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
