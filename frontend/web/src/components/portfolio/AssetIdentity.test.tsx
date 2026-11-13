import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AssetIdentity } from "./AssetIdentity";

afterEach(() => cleanup());

describe("AssetIdentity", () => {
  it("test 1: renders a stock's logo, ticker, and full name", () => {
    render(<AssetIdentity ticker="KO" name="The Coca-Cola Company" />);
    expect(screen.getByText("KO")).toBeInTheDocument();
    expect(screen.getByText("The Coca-Cola Company")).toBeInTheDocument();
    expect(screen.getByAltText("KO")).toBeInTheDocument(); // StockAvatar's <img alt={ticker}>
  });

  it("test 2: renders an ETF's fund name plus the issuer, when the issuer isn't already in the fund name", () => {
    // SPY's fund name never mentions its real issuer ("State Street
    // Investment Management") -- the exact case where showing the
    // issuer separately actually adds information.
    render(<AssetIdentity ticker="SPY" name="SPDR S&P 500 ETF Trust" etfCompany="State Street Investment Management" />);
    expect(screen.getByText("SPY")).toBeInTheDocument();
    expect(screen.getByText("SPDR S&P 500 ETF Trust · State Street Investment Management")).toBeInTheDocument();
  });

  it("omits the issuer when the fund name already names it (e.g. QQQ already says Invesco)", () => {
    render(<AssetIdentity ticker="QQQ" name="Invesco QQQ Trust" etfCompany="Invesco" />);
    expect(screen.getByText("Invesco QQQ Trust")).toBeInTheDocument();
    expect(screen.queryByText(/Invesco QQQ Trust · Invesco/)).not.toBeInTheDocument();
  });

  it("never duplicates the issuer when the fund name already mentions it", () => {
    render(<AssetIdentity ticker="VOO" name="Vanguard S&P 500 ETF" etfCompany="Vanguard" />);
    expect(screen.getByText("Vanguard S&P 500 ETF")).toBeInTheDocument();
    expect(screen.queryByText(/Vanguard S&P 500 ETF · Vanguard/)).not.toBeInTheDocument();
  });

  it("test 4: shows only the ticker when there's no full name -- never fabricates one", () => {
    render(<AssetIdentity ticker="XYZ" name={null} />);
    expect(screen.getByText("XYZ")).toBeInTheDocument();
    // no secondary name line is rendered at all
    expect(screen.queryByText(/\./)).not.toBeInTheDocument();
  });

  it("omits the issuer entirely when it's missing, instead of showing a placeholder", () => {
    render(<AssetIdentity ticker="VTI" name="Vanguard Total Stock Market ETF" etfCompany={null} />);
    expect(screen.getByText("Vanguard Total Stock Market ETF")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("test 6: a long name truncates without breaking layout (CSS truncate class present)", () => {
    render(<AssetIdentity ticker="ASML" name="ASML Holding N.V. — A Very Long Supplementary Qualifier That Should Never Wrap The Layout" />);
    const nameEl = screen.getByText(/ASML Holding N\.V\./);
    expect(nameEl.className).toContain("truncate");
  });
});
