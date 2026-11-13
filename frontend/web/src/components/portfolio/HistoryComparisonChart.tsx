"use client";

// Nuvos Plus — Fase 5C/5D: the single protagonist visualization of the
// "Historia" perspective — two normalized curves (composición actual vs.
// hipotética), same calendar, same starting value of 100. Same custom-SVG
// approach as src/components/ui/Sparkline.tsx (no charting library added),
// extended to two series with a shared hover/tap crosshair and a few
// discreet Y-axis reference labels. Colors are neutral — muted (A,
// "composición actual") vs. GOLD (B, "composición hipotética") — the exact
// same before/after convention this file's BeforeAfterRow already uses
// everywhere else, never a green/red good-or-bad encoding.
//
// Fase 5D additions (Diego's QA pass): (1) 3-5 Y-axis reference labels,
// computed from the REAL min/max of the plotted series — never a fixed
// range that could clip data, never altering the underlying values. (2)
// the hover crosshair also responds to onClick/onTouchStart, so a tap on
// mobile (not just a hover) reveals the same real date+values — both
// numbers always come straight from the series passed in, never an
// interpolation. (3) an optional small logo next to the hypothetical
// curve's legend label — never inside the curve itself.
import { useRef, useState } from "react";
// Fase 7.2 (Diego, captura real): verde de marca, no el dorado de Radar.
const GOLD = "#00e887";
import StockAvatar from "@/components/StockAvatar";
import type { HistoryPoint } from "@/lib/historyChartDownsample";

const _Y_AXIS_TICK_COUNT = 4; // 4 reference lines -> within the "3 a 5" range requested, without crowding a 180px-tall chart

function buildYAxisTicks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

export function HistoryComparisonChart({
  seriesA,
  seriesB,
  labelA,
  labelB,
  logoTickerB,
  height = 180,
  formatValue,
}: {
  seriesA: HistoryPoint[];
  seriesB: HistoryPoint[];
  labelA: string;
  labelB: string;
  logoTickerB?: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 2) return null;

  const width = 600;
  const leftMargin = 34; // room for the Y-axis tick labels, inside the same scaled coordinate system -- never a separate, unsynced overlay
  const plotWidth = width - leftMargin;
  const allValues = [...seriesA.slice(0, n).map((p) => p.value), ...seriesB.slice(0, n).map((p) => p.value)];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const stepX = plotWidth / (n - 1);
  const pad = 6;

  const toX = (i: number) => leftMargin + i * stepX;
  const toY = (v: number) => height - ((v - min) / range) * (height - pad * 2) - pad;

  const pathFor = (series: HistoryPoint[]) => {
    let d = "";
    for (let i = 0; i < n; i++) {
      d += (i === 0 ? "M " : "L ") + `${toX(i)} ${toY(series[i].value)}`;
    }
    return d;
  };

  const yTicks = buildYAxisTicks(min, max, _Y_AXIS_TICK_COUNT);

  const updateHoverFromClientX = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((clientX - rect.left) / rect.width) * width;
    const closest = Math.max(0, Math.min(n - 1, Math.round((relX - leftMargin) / stepX)));
    setHoverIdx(closest);
  };

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => updateHoverFromClientX(e.clientX);
  // Tap-to-query on mobile: a tap fires a synthetic click after touchend,
  // so reusing the same resolver covers both input types without any
  // drag-tracking complexity.
  const handleTap = (e: React.MouseEvent<SVGSVGElement>) => updateHoverFromClientX(e.clientX);

  const hx = hoverIdx != null ? toX(hoverIdx) : null;
  const fmt = formatValue ?? ((v: number) => v.toFixed(2));

  return (
    <div style={{ position: "relative" }}>
      <div className="flex items-center gap-4 mb-2">
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: "var(--sub)" }}>
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--muted)" }} />
          {labelA}
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] font-semibold" style={{ color: "var(--sub)" }}>
          {logoTickerB && <StockAvatar ticker={logoTickerB} size="sm" />}
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GOLD }} />
          {labelB}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block", cursor: "crosshair", overflow: "visible" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={handleTap}
        role="img"
        aria-label={`${labelA} vs ${labelB}`}
      >
        {yTicks.map((tick, i) => {
          const y = toY(tick);
          return (
            <g key={i}>
              <line x1={leftMargin} y1={y} x2={width} y2={y} stroke="var(--border)" strokeWidth={1} strokeDasharray="2,3" opacity={0.6} />
              <text x={0} y={y} dy={3} fontSize={9} fill="var(--sub)">{Math.round(tick)}</text>
            </g>
          );
        })}
        <path d={pathFor(seriesA)} fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathFor(seriesB)} fill="none" stroke={GOLD} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {hx != null && (
          <>
            <line x1={hx} y1={0} x2={hx} y2={height} stroke="var(--border)" strokeWidth={1} />
            <circle cx={hx} cy={toY(seriesA[hoverIdx!].value)} r={3.5} fill="var(--muted)" stroke="var(--card)" strokeWidth={1.5} />
            <circle cx={hx} cy={toY(seriesB[hoverIdx!].value)} r={3.5} fill={GOLD} stroke="var(--card)" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {hoverIdx != null && (
        <div
          style={{
            position: "absolute", top: -6, left: `${(hx! / width) * 100}%`, transform: "translate(-50%, -100%)",
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px",
            fontSize: 11, whiteSpace: "nowrap", color: "var(--text)", pointerEvents: "none", zIndex: 10,
          }}
        >
          <div style={{ color: "var(--sub)" }}>{seriesA[hoverIdx].date}</div>
          <div><span style={{ color: "var(--muted)" }}>●</span> {labelA}: {fmt(seriesA[hoverIdx].value)}</div>
          <div><span style={{ color: GOLD }}>●</span> {labelB}: {fmt(seriesB[hoverIdx].value)}</div>
        </div>
      )}
    </div>
  );
}
