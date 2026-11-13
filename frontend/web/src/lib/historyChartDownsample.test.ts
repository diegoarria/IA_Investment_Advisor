import { describe, expect, it } from "vitest";
import { pickDisplayIndices, buildDisplaySeries, type HistoryPoint } from "./historyChartDownsample";

function series(values: number[]): HistoryPoint[] {
  return values.map((v, i) => ({ date: `d${i}`, value: v }));
}

describe("pickDisplayIndices", () => {
  it("keeps every index when the series is already small enough", () => {
    const a = series([1, 2, 3, 4, 5]);
    const idx = pickDisplayIndices(a, a, 180);
    expect(idx).toEqual([0, 1, 2, 3, 4]);
  });

  it("always keeps the first and last real point", () => {
    const a = series(Array.from({ length: 500 }, (_, i) => i));
    const idx = pickDisplayIndices(a, a, 50);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(499);
  });

  it("preserves a sharp peak hidden inside a long flat series", () => {
    const values = Array.from({ length: 1000 }, () => 100);
    values[437] = 999; // a single real spike, easy to lose in naive even-sampling
    const a = series(values);
    const idx = pickDisplayIndices(a, a, 100);
    expect(idx).toContain(437);
  });

  it("preserves extremes of BOTH series, not just the first one", () => {
    const a = series(Array.from({ length: 1000 }, () => 100));
    const b = series(Array.from({ length: 1000 }, () => 100));
    (a[200] as HistoryPoint).value = 50; // A's own trough
    (b[600] as HistoryPoint).value = 150; // B's own peak, at a different date
    const idx = pickDisplayIndices(a, b, 100);
    expect(idx).toContain(200);
    expect(idx).toContain(600);
  });

  it("returns a strictly ascending, deduplicated list of indices", () => {
    const a = series(Array.from({ length: 800 }, (_, i) => Math.sin(i / 10) * 100));
    const idx = pickDisplayIndices(a, a, 120);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });
});

describe("buildDisplaySeries", () => {
  it("applies the SAME selected indices to both series -- dates always match", () => {
    const a = series(Array.from({ length: 600 }, (_, i) => i));
    const b = series(Array.from({ length: 600 }, (_, i) => 600 - i));
    const { a: da, b: db } = buildDisplaySeries(a, b, 80);
    expect(da.map((p) => p.date)).toEqual(db.map((p) => p.date));
  });

  it("never fabricates a point -- every returned point is a REAL point from the input", () => {
    const a = series(Array.from({ length: 600 }, (_, i) => i * 1.37));
    const b = series(Array.from({ length: 600 }, (_, i) => i * 0.91));
    const { a: da, b: db } = buildDisplaySeries(a, b, 80);
    for (const p of da) expect(a).toContainEqual(p);
    for (const p of db) expect(b).toContainEqual(p);
  });

  it("force-includes specific dates (e.g. the backend's own drawdown peak/trough) even if sampling would skip them", () => {
    const a = series(Array.from({ length: 1000 }, () => 100)); // perfectly flat -- nothing would be "sampled" as an extreme
    const { a: da } = buildDisplaySeries(a, a, 20, ["d777"]);
    expect(da.map((p) => p.date)).toContain("d777");
  });

  it("ignores a forced date that isn't actually in the series", () => {
    const a = series([1, 2, 3]);
    const { a: da } = buildDisplaySeries(a, a, 180, ["not-a-real-date"]);
    expect(da).toEqual(a); // small series -> every point kept anyway, no crash from the unknown date
  });
});
