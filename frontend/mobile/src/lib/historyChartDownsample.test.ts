import { pickDisplayIndices, buildDisplaySeries, type HistoryPoint } from "./historyChartDownsample";

function series(n: number, fn: (i: number) => number): HistoryPoint[] {
  return Array.from({ length: n }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value: fn(i) }));
}

describe("pickDisplayIndices", () => {
  it("keeps every index when the series is shorter than maxPoints — no downsampling needed", () => {
    const a = series(10, (i) => i);
    const b = series(10, (i) => i * 2);
    expect(pickDisplayIndices(a, b, 180)).toEqual(a.map((_, i) => i));
  });

  it("always keeps the first and last real index when downsampling a long series", () => {
    const a = series(1254, (i) => Math.sin(i / 10) * 100);
    const b = series(1254, (i) => Math.cos(i / 7) * 100);
    const idx = pickDisplayIndices(a, b, 180);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(1253);
  });

  it("returns a strictly ascending, deduplicated list of indices", () => {
    const a = series(1254, (i) => Math.sin(i / 10) * 100);
    const b = series(1254, (i) => Math.cos(i / 7) * 100);
    const idx = pickDisplayIndices(a, b, 180);
    const unique = new Set(idx);
    expect(unique.size).toBe(idx.length);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });

  it("never returns more points than real points exist, even when maxPoints is tiny", () => {
    const a = series(1254, (i) => i);
    const b = series(1254, (i) => -i);
    const idx = pickDisplayIndices(a, b, 4);
    expect(idx.length).toBeLessThanOrEqual(1254);
    idx.forEach((i) => expect(i).toBeGreaterThanOrEqual(0));
    idx.forEach((i) => expect(i).toBeLessThan(1254));
  });

  it("returns an identity mapping when the two series have mismatched lengths (never fabricates alignment)", () => {
    const a = series(5, (i) => i);
    const b = series(3, (i) => i);
    expect(pickDisplayIndices(a, b, 180)).toEqual(a.map((_, i) => i));
  });

  it("includes the real local maximum of curve A within each bucket", () => {
    const n = 400;
    const a = series(n, (i) => (i === 150 ? 9999 : 0));
    const b = series(n, () => 0);
    const idx = pickDisplayIndices(a, b, 40);
    expect(idx).toContain(150);
  });
});

describe("buildDisplaySeries", () => {
  it("returns only real points from the original series — never an interpolated or invented value", () => {
    const a = series(500, (i) => i * 1.5);
    const b = series(500, (i) => i * 0.8);
    const { a: da, b: db } = buildDisplaySeries(a, b, 60);
    da.forEach((p, i) => expect(a.find((orig) => orig.date === p.date && orig.value === p.value)).toBeTruthy());
    expect(da.length).toBe(db.length);
  });

  it("keeps both curves aligned on the exact same selected dates", () => {
    const a = series(500, (i) => i);
    const b = series(500, (i) => -i);
    const { a: da, b: db } = buildDisplaySeries(a, b, 60);
    da.forEach((p, i) => expect(p.date).toBe(db[i].date));
  });

  it("force-includes a specific real date even if the bucket sampling would have skipped it", () => {
    const n = 1000;
    const a = series(n, () => 100);
    const b = series(n, () => 100);
    const targetDate = a[777].date;
    const { a: da } = buildDisplaySeries(a, b, 60, [targetDate]);
    expect(da.some((p) => p.date === targetDate)).toBe(true);
  });

  it("silently ignores a forced date that doesn't exist in the series (never fabricates a point)", () => {
    const a = series(50, (i) => i);
    const b = series(50, (i) => i);
    const { a: da } = buildDisplaySeries(a, b, 60, ["1999-01-01"]);
    expect(da.every((p) => a.some((orig) => orig.date === p.date))).toBe(true);
  });
});
