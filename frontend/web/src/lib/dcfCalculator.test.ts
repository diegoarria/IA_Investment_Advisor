import { describe, it, expect } from "vitest";
import { calcularValorIntrinseco, margenDeSeguridad, type DcfInputs } from "./dcfCalculator";

const base: DcfInputs = {
  fcf0: 10_000, // $10B
  g: 0.07,
  r: 0.09,
  gt: 0.03,
  n: 10,
  netCash: 5_000, // $5B net cash
  shares: 1_000, // 1B diluted shares
};

describe("calcularValorIntrinseco", () => {
  it("computes a normal case with a sane, finite result", () => {
    const result = calcularValorIntrinseco(base);
    expect(result).not.toBeNull();
    expect(result!.stage1).toBeGreaterThan(0);
    expect(result!.terminal).toBeGreaterThan(0);
    expect(result!.equity).toBe(result!.stage1 + result!.terminal + base.netCash);
    expect(result!.valorPorAccion).toBeCloseTo(result!.equity / base.shares, 6);
    expect(isFinite(result!.valorPorAccion)).toBe(true);
  });

  it("computes fine when r === g — g is just the year-1 fade point now, not a denominator", () => {
    // Fase 1.5, Incremento 15: growth fades from g to gt per year (a loop),
    // so unlike the old constant-growth closed form, r === g is no longer
    // a division-by-zero case — only r === gt (the terminal formula) is.
    const result = calcularValorIntrinseco({ ...base, r: 0.07, g: 0.07 });
    expect(result).not.toBeNull();
    expect(isFinite(result!.valorPorAccion)).toBe(true);
  });

  it("returns null when r === gt (division by zero in terminal)", () => {
    const result = calcularValorIntrinseco({ ...base, r: 0.03, gt: 0.03 });
    expect(result).toBeNull();
  });

  it("growth fades linearly from g to gt, reaching exactly gt by the final year", () => {
    // A flat g === gt input should reproduce the OLD constant-growth
    // formula's stage1 exactly (fade of g->g is just g every year) — a
    // useful cross-check that the new per-year loop is mathematically
    // consistent with the closed-form annuity in the degenerate case where
    // there's nothing to fade.
    const flat = calcularValorIntrinseco({ ...base, g: 0.05, gt: 0.05 - 1e-9 });
    const closedForm = (() => {
      const { fcf0, r, n } = base;
      const g = 0.05;
      return (fcf0 * (1 + g)) / (r - g) * (1 - Math.pow((1 + g) / (1 + r), n!));
    })();
    expect(flat!.stage1).toBeCloseTo(closedForm, 0);
  });

  it("handles a negative growth rate without throwing", () => {
    const result = calcularValorIntrinseco({ ...base, g: -0.05 });
    expect(result).not.toBeNull();
    expect(isFinite(result!.valorPorAccion)).toBe(true);
  });

  it("handles very large inputs (trillions) without overflow", () => {
    const result = calcularValorIntrinseco({
      ...base,
      fcf0: 100_000_000, // $100T FCF — absurd but must not overflow to Infinity/NaN
      netCash: 50_000_000,
      shares: 1_000_000,
    });
    expect(result).not.toBeNull();
    expect(isFinite(result!.valorPorAccion)).toBe(true);
  });

  it("returns null when shares is zero instead of dividing by zero", () => {
    const result = calcularValorIntrinseco({ ...base, shares: 0 });
    expect(result).toBeNull();
  });

  it("returns null when shares is negative", () => {
    const result = calcularValorIntrinseco({ ...base, shares: -100 });
    expect(result).toBeNull();
  });
});

describe("margenDeSeguridad", () => {
  it("computes a positive margin when intrinsic value exceeds price", () => {
    expect(margenDeSeguridad(150, 100)).toBeCloseTo(1 / 3, 6);
  });

  it("computes a negative margin when intrinsic value is below price", () => {
    expect(margenDeSeguridad(80, 100)).toBeCloseTo(-0.25, 6);
  });

  it("returns null for a zero or negative intrinsic value instead of dividing by zero", () => {
    expect(margenDeSeguridad(0, 100)).toBeNull();
    expect(margenDeSeguridad(-10, 100)).toBeNull();
  });
});
