"use client";

import { useId } from "react";

// ─── Google-Finance-style headline bar chart ───────────────────────────────
// Used atop each financial-statement tab (Income / Balance / Cash Flow) to
// show the primary metric's trend before the granular table below.

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

  const W = 640, H = 200;
  const BOTTOM_H = 26;
  const TOP_PAD = 34;
  const PLOT_H = H - BOTTOM_H - TOP_PAD;
  const BASE_Y = H - BOTTOM_H;

  const n = data.length;
  const gap = 14;
  const barW = (W - gap * (n - 1)) / n;
  const maxAbs = Math.max(...valid.map((d) => Math.abs(d.value!)));

  const guides = [0.33, 0.66].map((f) => BASE_Y - PLOT_H * f);

  return (
    <div className="px-5 pt-5 pb-2">
      <div className="flex items-end justify-between mb-1">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--dim)" }}>
            {title}
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-[26px] font-black tabular-nums leading-none" style={{ color: "var(--text)" }}>
              {fmtMoney(latest.value)}
            </span>
            {yoy != null && (
              <span className="text-[13px] font-bold tabular-nums" style={{ color: changeColor }}>
                {up ? "▲" : "▼"} {Math.abs(yoy).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <span className="text-[10px]" style={{ color: "var(--dim)" }}>
          {latest.label}
        </span>
      </div>

      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {guides.map((gy, i) => (
          <line key={i} x1={0} y1={gy} x2={W} y2={gy} stroke="var(--border)" strokeWidth={1} />
        ))}
        <line x1={0} y1={BASE_Y} x2={W} y2={BASE_Y} stroke="var(--border)" strokeWidth={1} />

        {data.map((d, i) => {
          const x = i * (barW + gap);
          const val = d.value ?? 0;
          const hasVal = d.value != null;
          const barH = maxAbs > 0 ? (Math.abs(val) / maxAbs) * PLOT_H : 0;
          const y = BASE_Y - barH;
          const isNeg = val < 0;
          const active = i === n - 1;
          const fill = !hasVal ? "var(--border)" : isNeg ? "#ef4444" : active ? `url(#${gradId})` : color;
          const labelY = Math.max(y - 10, TOP_PAD - 14);

          return (
            <g key={i}>
              <rect x={x} y={TOP_PAD} width={barW} height={PLOT_H} rx={6}
                    fill={active ? "rgba(0,168,94,0.06)" : "transparent"} />
              {barH > 0 && (
                <rect x={x} y={y} width={barW} height={Math.max(barH, 3)} rx={6}
                      fill={fill} opacity={active || isNeg ? 1 : 0.55} />
              )}
              <text x={x + barW / 2} y={H - 8} textAnchor="middle"
                    fontSize={11} fontWeight={active ? 800 : 600}
                    fill={active ? "var(--text)" : "var(--dim)"}>
                {d.label}
              </text>
              {hasVal && (
                <text x={x + barW / 2} y={labelY} textAnchor="middle"
                      fontSize={active ? 13 : 11} fontWeight={active ? 800 : 700}
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
