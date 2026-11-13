// Nuvos Plus — Fase 5C: visual-only reduction of the backend's real daily
// series (up to ~1,254 points for 5 years) for the chart to render
// smoothly. Pure, deterministic — NEVER touches volatility or drawdown,
// which are read verbatim from the backend's own computation; this only
// decides which of the REAL points get drawn, never invents or
// interpolates a value. Both series are reduced using the SAME selected
// indices, so the two curves drawn on screen still share the exact same
// dates the backend compared them on.

export type HistoryPoint = { date: string; value: number };

/** Indices (ascending, deduplicated) to keep for display: always the
 * first and last real point, plus — per contiguous bucket of the full
 * series — whichever real point is the local max/min of EITHER curve.
 * This preserves both curves' own peaks/troughs/extremes, not just one
 * series' shape, without ever creating a point that wasn't really
 * returned by the backend. */
export function pickDisplayIndices(a: HistoryPoint[], b: HistoryPoint[], maxPoints = 180): number[] {
  const n = a.length;
  if (n === 0 || b.length !== n) return a.map((_, i) => i);
  if (n <= maxPoints) return a.map((_, i) => i);

  const indices = new Set<number>([0, n - 1]);
  const bucketCount = Math.max(1, Math.floor(maxPoints / 4));
  const bucketSize = Math.ceil(n / bucketCount);
  for (let start = 0; start < n; start += bucketSize) {
    const end = Math.min(start + bucketSize, n);
    let maxAI = start, minAI = start, maxBI = start, minBI = start;
    for (let i = start; i < end; i++) {
      if (a[i].value > a[maxAI].value) maxAI = i;
      if (a[i].value < a[minAI].value) minAI = i;
      if (b[i].value > b[maxBI].value) maxBI = i;
      if (b[i].value < b[minBI].value) minBI = i;
    }
    indices.add(maxAI);
    indices.add(minAI);
    indices.add(maxBI);
    indices.add(minBI);
  }
  return Array.from(indices).sort((x, y) => x - y);
}

/** Force-includes specific real dates (e.g. the backend's own reported
 * max-drawdown peak/trough dates) into the reduced index set, even if the
 * bucket sampling above would have skipped them — so the chart's visible
 * extremes always match the metric cards' stated dates exactly. */
export function buildDisplaySeries(
  a: HistoryPoint[],
  b: HistoryPoint[],
  maxPoints = 180,
  forceDates: string[] = []
): { a: HistoryPoint[]; b: HistoryPoint[] } {
  const base = new Set(pickDisplayIndices(a, b, maxPoints));
  if (forceDates.length) {
    const dateToIndex = new Map(a.map((p, i) => [p.date, i]));
    for (const d of forceDates) {
      const i = dateToIndex.get(d);
      if (i !== undefined) base.add(i);
    }
  }
  const idx = Array.from(base).sort((x, y) => x - y);
  return { a: idx.map((i) => a[i]), b: idx.map((i) => b[i]) };
}
