// Nuvos Plus — Fase 4D (2026-11): component tests for the redesigned
// three-sub-view experience (Resumen / Entender mi portafolio / Antes de
// invertir) inside "Mi distribución", plus the geographic-contract
// regression test from the earlier Fase 4C stability audit (now
// exercised through the "Entender mi portafolio" → "Geografía" path,
// since that data no longer renders on the default Resumen view).
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, optsOrDefault?: unknown) => {
      const opts = typeof optsOrDefault === "object" && optsOrDefault !== null ? (optsOrDefault as Record<string, unknown>) : undefined;
      if (opts) return key.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(opts[name] ?? ""));
      if (typeof optsOrDefault === "string") return optsOrDefault;
      return key;
    },
    i18n: { language: "es" },
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const getMock = vi.fn();
const simulateMock = vi.fn();
const searchMock = vi.fn();
// Fase 6D: default to "insufficient_history" -- none of the pre-existing
// tests below exercise Pulse, so it must stay a silent no-op (never
// blocks/affects Resumen) unless a test explicitly overrides it.
const getPulseMock = vi.fn().mockResolvedValue({ data: { available: false, reason: "insufficient_history" } });
vi.mock("@/lib/api", () => ({
  portfolioExposureApi: {
    get: (...args: unknown[]) => getMock(...args),
    simulate: (...args: unknown[]) => simulateMock(...args),
    getPulse: (...args: unknown[]) => getPulseMock(...args),
  },
  market: { searchTickers: (...args: unknown[]) => searchMock(...args) },
  billing: { getPricing: vi.fn().mockResolvedValue({ data: {} }) },
}));

import PortfolioDistribution from "./PortfolioDistribution";

// Fase 7: "Antes de invertir" is now a sibling the PARENT page owns —
// PortfolioDistribution only asks it to navigate there.
const navigateToSimulateMock = vi.fn();

afterEach(() => {
  cleanup();
  navigateToSimulateMock.mockReset();
  getMock.mockReset();
  simulateMock.mockReset();
  searchMock.mockReset();
  getPulseMock.mockReset();
  getPulseMock.mockResolvedValue({ data: { available: false, reason: "insufficient_history" } });
});

function realExposureResponse(overrides: Record<string, unknown> = {}) {
  return {
    portfolio_id: "default", portfolio_name: null, currency: "USD",
    valuation: { total_value_verified: 16389.45, total_cost_basis_all_positions: 15000, position_count: 2, verified_position_count: 2, unverifiable_position_count: 0, valuation_coverage_pct: 100 },
    positions: [
      { ticker: "VOO", name: "Vanguard S&P 500 ETF", asset_class: "etf", shares: 10, avg_price: 400, cost_basis: 4000, market_value: 5000, verifiable: true, unverifiable_reason: null, quote_currency: "USD", sector: null, country: null, weight_pct: 30.5 },
      { ticker: "ASML", name: "ASML Holding", asset_class: "equity", shares: 5, avg_price: 600, cost_basis: 3000, market_value: 3600, verifiable: true, unverifiable_reason: null, quote_currency: "EUR", sector: "Technology", country: "NL", weight_pct: 22.0 },
    ],
    composition: { equity_value: 3600, equity_pct: 22.0, etf_value: 5000, etf_pct: 30.5, unknown_asset_value_cost_basis: 0 },
    sector_exposure: { by_sector: [{ sector: "Tecnología", value: 7899.71, pct_of_verified_total: 48.2 }], coverage_pct: 100, unclassified_value: 0 },
    // The real shape the backend sends today: country rows carry
    // pct_of_asset_class_value + asset_class_total_value, NEVER
    // pct_of_verified_total (that field only exists on sector rows).
    geographic_exposure: {
      by_country: [
        { country: "Netherlands", value: 3600, pct_of_asset_class_value: 100.0, asset_class_total_value: 3600, methodology: "equity_domicile" },
        { country: "United States", value: 4950, pct_of_asset_class_value: 99.0, asset_class_total_value: 5000, methodology: "etf_underlying" },
      ],
      equity_domicile_coverage_pct: 100, etf_underlying_coverage_pct: 100, note_es: "",
    },
    concentration: { top_positions: [{ ticker: "VOO", name: null, weight_pct: 30.5 }], largest_single_position_pct: 30.5 },
    insights: [
      { category: "dominant_sector", text: "El sector Tecnología representa el 48% de tu portafolio.", supporting_data: {} },
      { category: "single_position_concentration", text: "Tu posición más grande, VOO, representa el 31%.", supporting_data: {} },
    ],
    unverifiable_positions: [],
    ...overrides,
  };
}

async function enterUnderstand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("portfolio.distribution.summary.actionUnderstand"));
}

describe("PortfolioDistribution — Vista A (Resumen)", () => {
  it("shows the value, position count, exactly one primary observation, and both action buttons", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("USD $16,389")).toBeInTheDocument());
    expect(screen.getByText("portfolio.distribution.summary.positionsCount")).toBeInTheDocument();

    // Exactly one insight card is rendered, even though the fixture has 2.
    expect(screen.getByText("El sector Tecnología representa el 48% de tu portafolio.")).toBeInTheDocument();
    expect(screen.queryByText("Tu posición más grande, VOO, representa el 31%.")).not.toBeInTheDocument();

    expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.summary.actionSimulate")).toBeInTheDocument();

    // Nothing from "Entender" is visible by default, and the simulator
    // (Fase 7: lifted to the parent page) is never rendered here at all.
    expect(screen.queryByText("Netherlands")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).not.toBeInTheDocument();
  });

  it("picks the sector observation over an earlier-ordered concentration one (priority rule, not insights[0])", async () => {
    getMock.mockResolvedValue({
      data: realExposureResponse({
        insights: [
          { category: "single_position_concentration", text: "concentración primero en el array", supporting_data: {} },
          { category: "dominant_sector", text: "sector dominante, pero segundo en el array", supporting_data: {} },
        ],
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("sector dominante, pero segundo en el array")).toBeInTheDocument());
    expect(screen.queryByText("concentración primero en el array")).not.toBeInTheDocument();
  });

  it("shows a neutral state, never a fabricated observation, when no supported category exists", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse({ insights: [] }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.noPrimaryInsight")).toBeInTheDocument());
  });

  it("shows unverifiable-position count without fabricating an unknown percentage", async () => {
    getMock.mockResolvedValue({
      data: realExposureResponse({ unverifiable_positions: [{ ticker: "XYZ", reason: "no_price" }, { ticker: "ABC", reason: "no_price" }] }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.unverifiableNote")).toBeInTheDocument());
  });

  it("handles an empty portfolio without crashing and without a fabricated insight", async () => {
    getMock.mockResolvedValue({
      data: realExposureResponse({
        valuation: { total_value_verified: null, total_cost_basis_all_positions: 0, position_count: 0, verified_position_count: 0, unverifiable_position_count: 0, valuation_coverage_pct: null },
        positions: [], insights: [], unverifiable_positions: [],
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.emptyPortfolio")).toBeInTheDocument());
    expect(screen.getByText("portfolio.distribution.summary.positionsCount")).toBeInTheDocument();
    // No insight card at all for an empty portfolio — never fabricated.
    expect(screen.queryByText("portfolio.distribution.summary.noPrimaryInsight")).not.toBeInTheDocument();
  });

  it("surfaces backend errors (403/404/401/generic) before any view switch is possible", async () => {
    // Fase 8C: this route has no commercial/admin gate left, so a 403 is
    // an unexpected backend regression, not "needs Nuvos Plus" — it now
    // falls into the same generic bucket as any other unhandled status.
    getMock.mockRejectedValue({ response: { status: 403 } });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.error.generic")).toBeInTheDocument());
    expect(screen.queryByText("portfolio.distribution.summary.actionUnderstand")).not.toBeInTheDocument();
  });
});

describe("PortfolioDistribution — navegación Resumen ↔ Entender", () => {
  it("goes to Entender and back to Resumen with the back button", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());

    await enterUnderstand(user);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByText("Vanguard S&P 500 ETF")).toBeInTheDocument(); // default dimension: posiciones

    await user.click(screen.getByText("portfolio.distribution.nav.backToSummary"));
    expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("switches between Posiciones / Sectores / Geografía, showing only one dimension at a time", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);

    expect(screen.getByText("Vanguard S&P 500 ETF")).toBeInTheDocument();
    expect(screen.queryByText("Netherlands")).not.toBeInTheDocument();

    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));
    expect(screen.getByText("Tecnología")).toBeInTheDocument();
    expect(screen.queryByText("Vanguard S&P 500 ETF")).not.toBeInTheDocument();

    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.geography"));
    const netherlandsRow = screen.getByText("Netherlands").closest("div.flex");
    expect(netherlandsRow?.textContent).toContain("100.0%");
    const usRow = screen.getByText("United States").closest("div.flex");
    expect(usRow?.textContent).toContain("99.0%");
    expect(usRow?.textContent).not.toContain("0.0%");
    expect(screen.queryByText("Tecnología")).not.toBeInTheDocument();
  });

  it("keeps coverage, sources, and unverifiable positions collapsed by default and reveals them on demand", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: realExposureResponse({ unverifiable_positions: [{ ticker: "XYZ", reason: "no_price" }] }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);

    // The mock t() falls back to its given default string ("no_price")
    // when passed a string default rather than an interpolation object —
    // matching the component's own `t(key, u.reason || "")` call shape.
    expect(screen.queryByText("XYZ — no_price")).not.toBeInTheDocument();
    await user.click(screen.getByText("portfolio.distribution.detailsToggle"));
    expect(screen.getByText("XYZ — no_price")).toBeInTheDocument();
  });

  it("Fase 8-fix: shows a 'not applicable' note for a physically-backed fund's geography, never counted as missing data", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: realExposureResponse({
        geographic_exposure: {
          by_country: [{ country: "Netherlands", value: 3600, pct_of_asset_class_value: 100.0, asset_class_total_value: 3600, methodology: "equity_domicile" }],
          equity_domicile_coverage_pct: 100, etf_underlying_coverage_pct: 0, etf_non_applicable_value: 3548.9, note_es: "",
        },
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.geography"));

    expect(screen.getByText("portfolio.distribution.geography.nonApplicableNote")).toBeInTheDocument();
  });
});

describe("PortfolioDistribution — Fase 7: 'Antes de invertir' lifted to the parent page", () => {
  // The simulator itself (BeforeAfterSimulator) no longer renders inside
  // PortfolioDistribution — it's a sibling tab the PARENT page (Fase 7)
  // owns, alongside Posiciones/Distribución. This component's only
  // responsibility at that boundary is to call the callback the parent
  // gave it; the "state survives navigating away and back" guarantee
  // from Fase 4D now belongs to the parent page's own test suite, since
  // that's where BeforeAfterSimulator is actually mounted today.
  it("clicking 'actionSimulate' calls onNavigateToSimulate, never renders a simulator of its own", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionSimulate")).toBeInTheDocument());

    await user.click(screen.getByText("portfolio.distribution.summary.actionSimulate"));
    expect(navigateToSimulateMock).toHaveBeenCalledTimes(1);
    // never a second, internal copy of the simulator's own search step
    expect(screen.queryByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).not.toBeInTheDocument();
  });
});

describe("PortfolioDistribution — cambio de portafolio", () => {
  it("resets back to Resumen and triggers a fresh fetch when portfolioId changes", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    const user = userEvent.setup();
    const { rerender } = render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    expect(screen.getByRole("tablist")).toBeInTheDocument();

    getMock.mockResolvedValue({ data: realExposureResponse({ valuation: { total_value_verified: 999, total_cost_basis_all_positions: 900, position_count: 1, verified_position_count: 1, unverifiable_position_count: 0, valuation_coverage_pct: 100 } }) });
    rerender(<PortfolioDistribution portfolioId="retirement" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("USD $999")).toBeInTheDocument());
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument(); // back to Resumen
    expect(getMock).toHaveBeenCalledWith("retirement");
  });
});

describe("PortfolioDistribution — Fase 4E: lenguaje educativo y progressive disclosure", () => {
  it("shows a conclusion-first headline + explanation for a dominant_sector observation, with the exact backend text preserved on demand", async () => {
    getMock.mockResolvedValue({
      data: realExposureResponse({
        sector_exposure: { by_sector: [{ sector: "Tecnología", value: 7899.71, pct_of_verified_total: 47.0 }], coverage_pct: 100, unclassified_value: 0 },
        insights: [
          {
            category: "dominant_sector",
            text: "El sector Tecnología representa el 47% de tu portafolio: VOO aporta 17.6 puntos porcentuales.",
            supporting_data: { sector: "Tecnología", total_pct_of_portfolio: 47, contributors: [{ ticker: "VOO" }, { ticker: "ASML" }] },
          },
        ],
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("Casi la mitad del valor analizado de tu portafolio está expuesto al sector Tecnología.")).toBeInTheDocument());
    expect(screen.getByText("Esta exposición proviene principalmente de VOO y ASML.")).toBeInTheDocument();
    expect(screen.queryByText(/VOO aporta 17.6 puntos/)).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByText("portfolio.distribution.summary.seeBreakdown"));
    expect(screen.getByText(/VOO aporta 17.6 puntos/)).toBeInTheDocument();
  });

  it("removes the double-arrow bug: the back-to-summary button text carries no arrow glyph of its own", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    const backButton = screen.getByRole("button", { name: /portfolio.distribution.nav.backToSummary/ });
    expect(backButton.textContent).not.toContain("←");
  });

  it("shows the plain-language ETF/stock split sentence only when both shares are real numbers", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    expect(screen.getByText("portfolio.distribution.positions.compositionNote")).toBeInTheDocument();
  });

  it("does not fabricate the ETF/stock split sentence when one side couldn't be computed", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: realExposureResponse({ composition: { equity_value: 3600, equity_pct: null, etf_value: 5000, etf_pct: 30.5, unknown_asset_value_cost_basis: 0 } }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    expect(screen.queryByText("portfolio.distribution.positions.compositionNote")).not.toBeInTheDocument();
  });

  it("leads Sectores with the dominant sector and keeps every other sector reachable, never shown unconditionally", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: realExposureResponse({
        sector_exposure: {
          by_sector: [
            { sector: "Tecnología", value: 7899.71, pct_of_verified_total: 48.2 },
            { sector: "Salud", value: 500, pct_of_verified_total: 3.1 },
          ],
          coverage_pct: 100, unclassified_value: 0,
        },
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("Tecnología")).toBeInTheDocument();
    expect(screen.queryByText("Salud")).not.toBeInTheDocument(); // small sector not shown until requested

    await user.click(screen.getByText("portfolio.distribution.sectors.seeAllSectors"));
    expect(screen.getByText("Salud")).toBeInTheDocument(); // still reachable, never hidden permanently
  });
});

describe("PortfolioDistribution — Fase 4E-2: vista editorial de Posiciones", () => {
  it("shows the subtitle, a concentration conclusion, and the largest-position highlight before the full list", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() }); // VOO 30.5%, ASML 22.0% -> combined 52.5%
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);

    expect(screen.getByText("portfolio.distribution.positions.subtitle")).toBeInTheDocument();
    expect(screen.getByText("Tus posiciones están relativamente concentradas.")).toBeInTheDocument();
    expect(screen.getByText("VOO y ASML representan juntos el 52.5% del valor verificado.")).toBeInTheDocument();
    expect(screen.getByText("Vanguard S&P 500 ETF es tu posición más grande.")).toBeInTheDocument();
    expect(screen.getByText("Representa 30.5% del valor verificado de tu portafolio.")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.positions.allPositionsTitle")).toBeInTheDocument();
    expect(screen.getByText("Vanguard S&P 500 ETF")).toBeInTheDocument(); // the full list is still there
  });

  it("bridges to Sectores from the bottom of Posiciones", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);

    expect(screen.getByText("portfolio.distribution.positions.bridgeToSectors")).toBeInTheDocument();
    await user.click(screen.getByText("portfolio.distribution.positions.bridgeToSectorsCta"));
    expect(screen.getByText("Tecnología")).toBeInTheDocument(); // now on Sectores
    const sectoresTab = screen.getByRole("tab", { name: "portfolio.distribution.dimensionSelector.sectors" });
    expect(sectoresTab).toHaveAttribute("aria-selected", "true");
  });

  it("does not fabricate a concentration conclusion when there are no verifiable positions", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: realExposureResponse({
        positions: [
          { ticker: "XYZ", name: null, asset_class: "equity", shares: 1, avg_price: 1, cost_basis: 1, market_value: null, verifiable: false, unverifiable_reason: "no_price", quote_currency: null, sector: null, country: null, weight_pct: null },
        ],
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);

    expect(screen.queryByText(/posiciones están/)).not.toBeInTheDocument();
    expect(screen.queryByText(/es tu posición más grande/)).not.toBeInTheDocument();
  });
});

describe("PortfolioDistribution — refinamiento de Sectores", () => {
  function sectorExposureFixture(overrides: Record<string, unknown> = {}) {
    return realExposureResponse({
      positions: [
        { ticker: "VOO", name: "Vanguard S&P 500 ETF", asset_class: "etf", shares: 10, avg_price: 400, cost_basis: 4000, market_value: 5000, verifiable: true, unverifiable_reason: null, quote_currency: "USD", sector: null, country: null, weight_pct: 25.0 },
        { ticker: "QQQ", name: "Invesco QQQ Trust", asset_class: "etf", shares: 5, avg_price: 350, cost_basis: 1750, market_value: 2500, verifiable: true, unverifiable_reason: null, quote_currency: "USD", sector: null, country: null, weight_pct: 12.5 },
        { ticker: "GOOGL", name: "Alphabet Inc.", asset_class: "equity", shares: 10, avg_price: 140, cost_basis: 1400, market_value: 2000, verifiable: true, unverifiable_reason: null, quote_currency: "USD", sector: "Comunicación", country: "US", weight_pct: 10.0 },
        { ticker: "ASML", name: "ASML Holding", asset_class: "equity", shares: 5, avg_price: 600, cost_basis: 3000, market_value: 3600, verifiable: true, unverifiable_reason: null, quote_currency: "EUR", sector: "Tecnología", country: "NL", weight_pct: 18.0 },
      ],
      sector_exposure: {
        by_sector: [
          { sector: "Tecnología", value: 7899.71, pct_of_verified_total: 47.4 },
          { sector: "Comunicación", value: 2000, pct_of_verified_total: 10.0 },
        ],
        coverage_pct: 100, unclassified_value: 0,
      },
      insights: [
        {
          category: "dominant_sector",
          text: "El sector Tecnología representa el 47% de tu portafolio: VOO aporta 17.6 puntos porcentuales; ASML aporta 17.5 puntos porcentuales; QQQ aporta 12.3 puntos porcentuales.",
          supporting_data: {
            sector: "Tecnología", total_pct_of_portfolio: 47.4,
            contributors: [
              { ticker: "VOO", name: "Vanguard S&P 500 ETF", contribution_pct_points: 17.6 },
              { ticker: "ASML", name: "ASML Holding", contribution_pct_points: 17.5 },
              { ticker: "QQQ", name: "Invesco QQQ Trust", contribution_pct_points: 12.3 },
            ],
            sector_coverage_pct: 100, unclassified_value: 0,
          },
        },
      ],
      ...overrides,
    });
  }

  it("leads with the header, the dominant-sector headline, and the per-$100 sentence (VOO/QQQ/GOOGL/ASML example)", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: sectorExposureFixture() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("portfolio.distribution.sectors.title")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.sectors.subtitle")).toBeInTheDocument();
    expect(screen.getByText("Tecnología representa el 47.4% del valor analizado de tu portafolio.")).toBeInTheDocument();
    expect(screen.getByText("De cada $100 del valor analizado, aproximadamente $47 están expuestos a empresas del sector Tecnología.")).toBeInTheDocument();
  });

  it("shows which positions contribute to the dominant sector, with their percentage-point bars and the points clarification", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: sectorExposureFixture() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("portfolio.distribution.sectors.contributorsTitle")).toBeInTheDocument();
    expect(screen.getByText("Vanguard S&P 500 ETF")).toBeInTheDocument();
    expect(screen.getByText("17.6pp")).toBeInTheDocument();
    expect(screen.getByText("ASML Holding")).toBeInTheDocument();
    expect(screen.getByText("17.5pp")).toBeInTheDocument();
    expect(screen.getByText("Invesco QQQ Trust")).toBeInTheDocument();
    expect(screen.getByText("12.3pp")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.sectors.contributorsClarification")).toBeInTheDocument();
    // mixed ETF + individual-stock contributors -> the mixed-wording explanation
    expect(screen.getByText(/tanto a través de acciones individuales como de ETFs/)).toBeInTheDocument();
  });

  it("shows an honest 'breakdown unavailable' message instead of inventing contributors when the backend didn't compute any", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: sectorExposureFixture({
        insights: [{ category: "dominant_sector", text: "El sector Salud representa el 35% de tu portafolio.", supporting_data: { sector: "Salud", total_pct_of_portfolio: 35, contributors: [] } }],
        sector_exposure: { by_sector: [{ sector: "Salud", value: 1000, pct_of_verified_total: 35.0 }], coverage_pct: 100, unclassified_value: 0 },
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("portfolio.distribution.sectors.contributorsUnavailable")).toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.sectors.contributorsTitle")).not.toBeInTheDocument();
  });

  it("shows a single contributor correctly without a fabricated multi-position explanation", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: sectorExposureFixture({
        insights: [{
          category: "dominant_sector", text: "...",
          supporting_data: { sector: "Tecnología", total_pct_of_portfolio: 32, contributors: [{ ticker: "ASML", name: "ASML Holding", contribution_pct_points: 32.0 }] },
        }],
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("ASML Holding")).toBeInTheDocument();
    expect(screen.getByText("32.0pp")).toBeInTheDocument();
    expect(screen.queryByText(/contribuyen juntas|a través de/)).not.toBeInTheDocument();
  });

  it("shows a neutral state instead of a misleading headline when the top sector's percentage can't be verified", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: sectorExposureFixture({
        sector_exposure: { by_sector: [{ sector: "Tecnología", value: 0, pct_of_verified_total: null }], coverage_pct: 40, unclassified_value: 5000 },
        insights: [],
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("portfolio.distribution.sectors.noDominantSector")).toBeInTheDocument();
    expect(screen.queryByText(/representa el/)).not.toBeInTheDocument();
  });

  it("always shows the verified-universe coverage note, never normalizing an incomplete classification to 100%", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: sectorExposureFixture({ sector_exposure: { by_sector: [{ sector: "Tecnología", value: 7899.71, pct_of_verified_total: 47.4 }], coverage_pct: 72.5, unclassified_value: 1200 } }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    expect(screen.getByText("portfolio.distribution.sectors.verifiedUniverseNote")).toBeInTheDocument();
  });

  it("keeps the dominant sector out of the 'other sectors' list to avoid repeating it without reason", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: sectorExposureFixture() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));

    await user.click(screen.getByText("portfolio.distribution.sectors.seeAllSectors"));
    // "Tecnología" already appears once as the dominant-sector headline/bar label;
    // it must not appear a second time inside the expanded "other sectors" list.
    expect(screen.getAllByText("Tecnología")).toHaveLength(1);
    expect(screen.getByText("Comunicación")).toBeInTheDocument();
  });

  it("Fase 8-fix: shows a 'not applicable' note for gold/bond-style ETF value, distinct from the unclassified note", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: sectorExposureFixture({
        sector_exposure: {
          by_sector: [{ sector: "Tecnología", value: 7899.71, pct_of_verified_total: 47.4 }],
          coverage_pct: 60, unclassified_value: 0, non_equity_style_value: 3548.9,
        },
      }),
    });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);
    await user.click(screen.getByText("portfolio.distribution.dimensionSelector.sectors"));
    await user.click(screen.getByText("portfolio.distribution.detailsToggle"));

    expect(screen.getByText("portfolio.distribution.sectors.nonEquityStyleNote")).toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.sectors.unclassifiedNote")).not.toBeInTheDocument();
  });
});

describe("PortfolioDistribution — accesibilidad básica de navegación", () => {
  it("exposes the dimension selector as a labeled tablist with selectable tabs", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.actionUnderstand")).toBeInTheDocument());
    await enterUnderstand(user);

    const tablist = screen.getByRole("tablist", { name: "portfolio.distribution.dimensionSelector.ariaLabel" });
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tablist).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");

    await user.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toHaveAttribute("aria-selected", "false");
  });

  it("every navigation action is a real, reachable button (back buttons and entry actions)", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    // Fase 4E: each action button also carries a one-line benefit hint, so
    // its accessible name is "<title> <hint>" rather than the bare title.
    await waitFor(() => expect(screen.getByRole("button", { name: /portfolio.distribution.summary.actionUnderstand/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /portfolio.distribution.summary.actionSimulate/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /portfolio.distribution.summary.actionUnderstand/ }));
    expect(screen.getByRole("button", { name: /portfolio.distribution.nav.backToSummary/ })).toBeInTheDocument();
  });
});

// ─── Fase 6D: Nuvos Pulse integrado en Resumen ─────────────────────────────

function pulseAvailable(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    snapshot_before: { id: "a", observed_at: "2026-09-02T00:00:00Z", period_key: "2026-09", snapshot_type: "month_end", verification_state: "full", valuation_coverage_pct: 100 },
    snapshot_after: { id: "b", observed_at: "2026-10-02T00:00:00Z", period_key: "2026-10", snapshot_type: "month_end", verification_state: "full", valuation_coverage_pct: 100 },
    comparability: { status: "comparable", reason: null, warnings: [] },
    changes: { positions: [], sectors: null, composition: null, geography: { equity_domicile: null, etf_underlying: null } },
    primary_change: { category: "sector", label: "Tecnología", before_pct: 42.1, after_pct: 47.4, delta_pp: 5.3 },
    causality: { level: "undetermined", note_es: "No contamos con información suficiente para identificar completamente las causas." },
    ...overrides,
  };
}

describe("PortfolioDistribution — Fase 6D: Nuvos Pulse en Resumen", () => {
  it("test 1: Pulse occupies the SAME single observation slot, replacing the static insight, when available/comparable/relevant", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.title")).toBeInTheDocument());
    // never the static insight's text alongside Pulse -- one slot, one observation
    expect(screen.queryByText("El sector Tecnología representa el 48% de tu portafolio.")).not.toBeInTheDocument();
    // never a second card either
    expect(screen.getAllByText("portfolio.distribution.summary.pulse.title").length).toBe(1);
  });

  it("test 2/3: falls back to the static primaryInsight (preserved) when Pulse has insufficient history", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: { available: false, reason: "insufficient_history" } });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText(/48% de tu portafolio/)).toBeInTheDocument());
    expect(screen.queryByText("portfolio.distribution.summary.pulse.title")).not.toBeInTheDocument();
  });

  it("test 9: a 'partial' comparability status never overrides the static observation (important uncertainty)", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable({ comparability: { status: "partial", reason: null, warnings: [{ dimension: "sectors", reason: "sector_coverage_gap" }] } }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText(/48% de tu portafolio/)).toBeInTheDocument());
    expect(screen.queryByText("portfolio.distribution.summary.pulse.title")).not.toBeInTheDocument();
  });

  it("falls back to static when Pulse is comparable but has no relevant change (primary_change: null)", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable({ primary_change: null, causality: { level: "no_change", note_es: "No se detectaron cambios relevantes entre ambas fechas." } }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText(/48% de tu portafolio/)).toBeInTheDocument());
  });

  it("test 6/13: shows the real before/after/delta numbers and the real dates on demand -- never 'this month' labels", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable() });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.title")).toBeInTheDocument());
    expect(screen.getByText("42.1%")).toBeInTheDocument();
    expect(screen.getByText("47.4%")).toBeInTheDocument();
    expect(screen.getByText("+5.3pp")).toBeInTheDocument();

    await user.click(screen.getByText("portfolio.distribution.summary.pulse.seeDates"));
    // the test i18n mock never substitutes {{vars}} into real values (see
    // this file's `useTranslation` mock) -- the key itself rendering is
    // what proves the dates branch fired, with real ISO dates (never a
    // "este mes"/"cierre mensual" label) passed as its actual params.
    expect(screen.getByText("portfolio.distribution.summary.pulse.comparedDates")).toBeInTheDocument();
  });

  it("test 1 (Fase 6E §1): a sector change CTA says 'Explorar sectores' and lands on the Sectores tab", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable({ primary_change: { category: "sector", label: "Tecnología", before_pct: 42.1, after_pct: 47.4, delta_pp: 5.3 } }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.title")).toBeInTheDocument());
    expect(screen.getByText("portfolio.distribution.summary.pulse.exploreSectors")).toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.summary.pulse.explorePositions")).not.toBeInTheDocument();
    await user.click(screen.getByText("portfolio.distribution.summary.pulse.exploreSectors"));

    await waitFor(() => expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("portfolio.distribution.dimensionSelector.sectors"));
  });

  it("test 1 (Fase 6E §1): a composition (equity/ETF) change CTA says 'Explorar posiciones' and lands on the Posiciones tab, never Sectores", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable({ primary_change: { category: "composition", label: "etf", before_pct: 60, after_pct: 70, delta_pp: 10 } }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.title")).toBeInTheDocument());
    expect(screen.getByText("portfolio.distribution.summary.pulse.explorePositions")).toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.summary.pulse.exploreSectors")).not.toBeInTheDocument();
    await user.click(screen.getByText("portfolio.distribution.summary.pulse.explorePositions"));

    await waitFor(() => expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("portfolio.distribution.dimensionSelector.positions"));
  });

  it("test 1 (Fase 6E §1): a concentration (single-position) change CTA also lands on Posiciones, never Sectores", async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable({ primary_change: { category: "concentration", label: "AAPL", before_pct: 10, after_pct: 18, delta_pp: 8 } }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.explorePositions")).toBeInTheDocument());
    await user.click(screen.getByText("portfolio.distribution.summary.pulse.explorePositions"));

    await waitFor(() => expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("portfolio.distribution.dimensionSelector.positions"));
  });

  it("test 15: changing portfolioId discards the previous Pulse result immediately, never showing the old portfolio's observation", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable() });
    const { rerender } = render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);
    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.title")).toBeInTheDocument());

    let resolveSecond: (v: unknown) => void = () => {};
    getPulseMock.mockReturnValue(new Promise((resolve) => { resolveSecond = resolve; }));
    rerender(<PortfolioDistribution portfolioId="retirement" onNavigateToSimulate={navigateToSimulateMock} />);
    // immediately invalidated -- never shows the previous portfolio's Pulse card while the new one is loading
    expect(screen.queryByText("portfolio.distribution.summary.pulse.title")).not.toBeInTheDocument();
    resolveSecond({ data: { available: false, reason: "insufficient_history" } });
  });

  it("test 17/18: a Pulse fetch failure never blocks Resumen or fabricates data -- static observation (or empty state) renders normally", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockRejectedValue(new Error("network error"));
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("USD $16,389")).toBeInTheDocument());
    expect(screen.getByText(/48% de tu portafolio/)).toBeInTheDocument();
  });

  it("test 19: never renders forbidden evaluative language regardless of the delta's sign", async () => {
    getMock.mockResolvedValue({ data: realExposureResponse() });
    getPulseMock.mockResolvedValue({ data: pulseAvailable({ primary_change: { category: "sector", label: "Tecnología", before_pct: 47.4, after_pct: 42.1, delta_pp: -5.3 } }) });
    render(<PortfolioDistribution portfolioId="default" onNavigateToSimulate={navigateToSimulateMock} />);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.summary.pulse.title")).toBeInTheDocument());
    const forbidden = [/mejor/i, /peor/i, /peligroso/i, /deberías/i, /compra/i, /vende/i, /recomend/i];
    const body = document.body.textContent || "";
    for (const pattern of forbidden) expect(body).not.toMatch(pattern);
  });
});
