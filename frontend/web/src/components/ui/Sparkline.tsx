"use client";

// Minimal single-series trend line for small admin/business-metric cards —
// no legend (a single series names itself via the card title), thin 2px
// stroke, and a hover crosshair+tooltip per the dataviz interaction default
// for any line chart. Not meant for anything beyond a handful of points a
// day — no zoom/pan, no multi-series.
import { useRef, useState } from "react";

export interface SparklinePoint {
  date: string;
  value: number | null;
}

export function Sparkline({
  data, color = "var(--accent)", height = 40, formatValue,
}: {
  data: SparklinePoint[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  if (values.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center" }}>
        <span className="text-xs" style={{ color: "var(--muted)" }}>Sin suficientes datos todavía</span>
      </div>
    );
  }

  const width = 200;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: i * stepX,
    y: d.value == null ? null : height - ((d.value - min) / range) * (height - 8) - 4,
    d,
  }));

  let path = "";
  let drawing = false;
  for (const p of points) {
    if (p.y == null) { drawing = false; continue; }
    path += (drawing ? " L " : "M ") + `${p.x} ${p.y}`;
    drawing = true;
  }

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let closest = 0, closestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    setHoverIdx(closest);
  };

  const hp = hoverIdx != null ? points[hoverIdx] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block", cursor: "crosshair", overflow: "visible" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(null)}
      >
        <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {hp && hp.y != null && (
          <>
            <line x1={hp.x} y1={0} x2={hp.x} y2={height} stroke="var(--border)" strokeWidth={1} />
            <circle cx={hp.x} cy={hp.y} r={3} fill={color} stroke="var(--card)" strokeWidth={1.5} />
          </>
        )}
      </svg>
      {hp && (
        <div
          style={{
            position: "absolute", top: -6, left: `${(hp.x / width) * 100}%`, transform: "translate(-50%, -100%)",
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 7px",
            fontSize: 11, whiteSpace: "nowrap", color: "var(--text)", pointerEvents: "none", zIndex: 10,
          }}
        >
          {hp.d.date} · {hp.d.value != null ? (formatValue ? formatValue(hp.d.value) : hp.d.value) : "—"}
        </div>
      )}
    </div>
  );
}
