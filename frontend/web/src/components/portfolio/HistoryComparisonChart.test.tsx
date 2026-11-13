import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistoryComparisonChart } from "./HistoryComparisonChart";
import type { HistoryPoint } from "@/lib/historyChartDownsample";

afterEach(() => cleanup());

function series(values: number[]): HistoryPoint[] {
  return values.map((v, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value: v }));
}

describe("HistoryComparisonChart", () => {
  it("renders both legend labels, distinguishable without relying on color alone", () => {
    render(<HistoryComparisonChart seriesA={series([100, 110, 120])} seriesB={series([100, 115, 130])} labelA="Composición actual" labelB="Composición hipotética (+KO)" />);
    expect(screen.getByText("Composición actual")).toBeInTheDocument();
    expect(screen.getByText("Composición hipotética (+KO)")).toBeInTheDocument();
  });

  it("test 16: renders between 3 and 5 Y-axis reference labels, computed from the real plotted range", () => {
    render(<HistoryComparisonChart seriesA={series([100, 120, 140])} seriesB={series([100, 110, 160])} labelA="A" labelB="B" />);
    // ticks span [min, max] of ALL plotted values (100..160 here)
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("160")).toBeInTheDocument();
    const svg = screen.getByRole("img");
    const tickTexts = svg.querySelectorAll("text");
    expect(tickTexts.length).toBeGreaterThanOrEqual(3);
    expect(tickTexts.length).toBeLessThanOrEqual(5);
  });

  it("never clips the data -- the Y-axis ticks always include the true min and max", () => {
    render(<HistoryComparisonChart seriesA={series([97.3, 101, 88.2])} seriesB={series([100, 140, 133])} labelA="A" labelB="B" />);
    expect(screen.getByText("88")).toBeInTheDocument(); // true min, rounded for display only
    expect(screen.getByText("140")).toBeInTheDocument(); // true max
  });

  it("test 17: hovering (desktop) reveals the real date and both real values for that point", () => {
    render(<HistoryComparisonChart seriesA={series([100, 110, 120])} seriesB={series([100, 115, 130])} labelA="Composición actual" labelB="Composición hipotética" formatValue={(v) => v.toFixed(1)} />);
    const svg = screen.getByRole("img");
    // Moving to roughly 2/3 of the width lands on index 2 (last point)
    (svg as any).getBoundingClientRect = () => ({ left: 0, width: 600, top: 0, height: 180, right: 600, bottom: 180 } as DOMRect);
    fireEvent.mouseMove(svg, { clientX: 599 });
    expect(screen.getByText("2026-01-03")).toBeInTheDocument();
    expect(screen.getByText(/120\.0/)).toBeInTheDocument();
    expect(screen.getByText(/130\.0/)).toBeInTheDocument();
  });

  it("test 17: a tap/click (mobile, no hover) reveals the same real values -- not just desktop hover", () => {
    render(<HistoryComparisonChart seriesA={series([100, 110, 120])} seriesB={series([100, 115, 130])} labelA="Composición actual" labelB="Composición hipotética" formatValue={(v) => v.toFixed(1)} />);
    const svg = screen.getByRole("img");
    (svg as any).getBoundingClientRect = () => ({ left: 0, width: 600, top: 0, height: 180, right: 600, bottom: 180 } as DOMRect);
    fireEvent.click(svg, { clientX: 599 });
    expect(screen.getByText("2026-01-03")).toBeInTheDocument();
    expect(screen.getByText(/120\.0/)).toBeInTheDocument();
  });

  it("test 15: shows a logo next to the hypothetical curve's legend label when a ticker is given, and nothing extra when it isn't", () => {
    const { rerender } = render(<HistoryComparisonChart seriesA={series([100, 110])} seriesB={series([100, 120])} labelA="A" labelB="B (+KO)" logoTickerB="KO" />);
    expect(screen.getByAltText("KO")).toBeInTheDocument();

    rerender(<HistoryComparisonChart seriesA={series([100, 110])} seriesB={series([100, 120])} labelA="A" labelB="B" />);
    expect(screen.queryByAltText("KO")).not.toBeInTheDocument();
  });

  it("test 14: values rendered come from the exact series passed in -- never recomputed or interpolated", () => {
    const a = series([100, 93.7, 108.2]);
    const b = series([100, 95.1, 112.9]);
    render(<HistoryComparisonChart seriesA={a} seriesB={b} labelA="A" labelB="B" formatValue={(v) => v.toFixed(1)} />);
    const svg = screen.getByRole("img");
    (svg as any).getBoundingClientRect = () => ({ left: 0, width: 600, top: 0, height: 180, right: 600, bottom: 180 } as DOMRect);
    fireEvent.mouseMove(svg, { clientX: 300 }); // middle point (index 1)
    expect(screen.getByText(/93\.7/)).toBeInTheDocument();
    expect(screen.getByText(/95\.1/)).toBeInTheDocument();
  });

  it("gracefully renders nothing (no crash) when a series has fewer than 2 points", () => {
    const { container } = render(<HistoryComparisonChart seriesA={series([100])} seriesB={series([100])} labelA="A" labelB="B" />);
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});
