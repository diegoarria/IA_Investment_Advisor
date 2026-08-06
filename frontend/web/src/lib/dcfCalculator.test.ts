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

  it("returns null when r === g (division by zero in stage1)", () => {
    const result = calcularValorIntrinseco({ ...base, r: 0.07, g: 0.07 });
    expect(result).toBeNull();
  });

  it("returns null when r === gt (division by zero in terminal)", () => {
    const result = calcularValorIntrinseco({ ...base, r: 0.03, gt: 0.03 });
    expect(result).toBeNull();
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
