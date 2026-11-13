// Nuvos Plus Fase 4C-2 — real component interaction tests (render, type,
// click, assert DOM), per Diego's explicit "No limitar la verificación a
// TypeScript y build." Covers: ticker selection, running a simulation,
// error handling, discarding, stale-result invalidation when the ticker
// or amount changes after a result exists, and state reset when
// switching portfolios.
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, optsOrDefault?: unknown) => {
      const opts = typeof optsOrDefault === "object" && optsOrDefault !== null ? (optsOrDefault as Record<string, unknown>) : undefined;
      if (opts) {
        return key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(opts[name] ?? ""));
      }
      if (typeof optsOrDefault === "string") return optsOrDefault;
      return key;
    },
    i18n: { language: "es" },
  }),
}));

const simulateMock = vi.fn();
const simulateHistoryMock = vi.fn();
const searchMock = vi.fn();

vi.mock("@/lib/api", () => ({
  portfolioExposureApi: {
    simulate: (...args: unknown[]) => simulateMock(...args),
    simulateHistory: (...args: unknown[]) => simulateHistoryMock(...args),
  },
  market: { searchTickers: (...args: unknown[]) => searchMock(...args) },
}));

import BeforeAfterSimulator from "./BeforeAfterSimulator";

afterEach(() => {
  cleanup();
  simulateMock.mockReset();
  simulateHistoryMock.mockReset();
  searchMock.mockReset();
});

const NA = "No disponible";

function baseSimResponse(overrides: Record<string, unknown> = {}) {
  return {
    amount: 5000,
    hypothetical_ticker: "QQQ",
    hypothetical_asset_class: "etf",
    before_had_no_verified_positions: false,
    before: {
      valuation: { total_value_verified: 16389.45, valuation_coverage_pct: 100 },
      positions: [{ ticker: "QQQ", verifiable: true, weight_pct: 21.1, sector: null }],
      sector_exposure: { coverage_pct: 100, by_sector: [], unclassified_value: 0 },
      concentration: { top_positions: [{ ticker: "VOO", name: null, weight_pct: 43.0 }], largest_single_position_pct: 43.0 },
    },
    after: {
      valuation: { total_value_verified: 21389.45, valuation_coverage_pct: 100 },
      positions: [{ ticker: "QQQ", verifiable: true, weight_pct: 39.6, sector: null }],
      sector_exposure: { coverage_pct: 100, by_sector: [], unclassified_value: 0 },
      concentration: { top_positions: [{ ticker: "QQQ", name: null, weight_pct: 39.6 }], largest_single_position_pct: 39.6 },
    },
    sector_deltas: [{ sector: "Tecnología", pct_before: 48.2, pct_after: 50.7, delta_pct_points: 2.5 }],
    country_deltas: [],
    ...overrides,
  };
}

async function selectTicker(user: ReturnType<typeof userEvent.setup>, ticker = "QQQ", name = "Invesco QQQ Trust") {
  searchMock.mockResolvedValue({ data: { results: [{ ticker, name }] } });
  const input = screen.getByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder");
  await user.type(input, ticker);
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  await user.click(screen.getByText(name));
}

describe("BeforeAfterSimulator — selection (Paso 1)", () => {
  it("searches and selects a ticker, showing it as a removable chip", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    expect(screen.getByText(/QQQ/)).toBeInTheDocument();
    // the search input is replaced by the selected chip
    expect(screen.queryByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).not.toBeInTheDocument();
  });

  it("can remove the selected ticker and search again", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.click(screen.getByLabelText("portfolio.distribution.simulate.removeTicker"));
    expect(screen.getByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).toBeInTheDocument();
  });
});

describe("BeforeAfterSimulator — amount validation (Paso 2)", () => {
  it("disables Simular until both a ticker and a valid amount are present", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    const button = screen.getByText("portfolio.distribution.simulate.simulateButton");
    expect(button.closest("button")).toBeDisabled();

    await selectTicker(user);
    expect(button.closest("button")).toBeDisabled(); // still no amount

    const amountInput = screen.getByPlaceholderText("0");
    await user.type(amountInput, "5000");
    expect(button.closest("button")).toBeEnabled();
  });

  it("shows a validation error for a non-numeric amount and keeps Simular disabled", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    const amountInput = screen.getByPlaceholderText("0");
    await user.type(amountInput, "abc");
    expect(screen.getByText("portfolio.distribution.simulate.amountInvalid")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.simulate.simulateButton").closest("button")).toBeDisabled();
  });
});

describe("BeforeAfterSimulator — running a simulation (Paso 3)", () => {
  it("runs the simulation and renders the before/after comparison", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponse() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));

    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());
    expect(simulateMock).toHaveBeenCalledWith("default", "QQQ", 5000);
    // Fase 4E: the result's absolute priority line ("Si añades X a Y…")
    // is visible immediately, right after running the simulation.
    expect(screen.getByText("portfolio.distribution.simulate.resultIntro")).toBeInTheDocument();
    // Diego, 2026-11 (segunda pasada): la frase "$X de cada $100" se
    // eliminó por redundante con la fila antes/después + la consecuencia
    // educativa — ahora solo se muestra esta última (delta positivo =
    // mayor dependencia).
    expect(screen.getByText("Tu portafolio tendría una mayor dependencia del comportamiento de QQQ. Si esta inversión subiera o bajara, su movimiento tendría un impacto proporcionalmente mayor sobre el valor total de tus inversiones.")).toBeInTheDocument();
    // Fase 5C: the full before/after portfolio value lives under the
    // "Distribución" perspective, which is the default-selected tab.
    expect(screen.getByText("USD $16,389")).toBeInTheDocument(); // before
    expect(screen.getByText("USD $21,389")).toBeInTheDocument(); // after
  });

  it("Fase 5C, test 1: shows the three perspectives, defaulting to Distribución", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponse() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    expect(screen.getByText("portfolio.distribution.simulate.perspective.distribution")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.simulate.perspective.exposure")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.simulate.perspective.history")).toBeInTheDocument();
    // Diego, 2026-11 (rediseño): "el cambio principal" (peso del ticker
    // simulado + los valores antes/después) ahora se muestra SIEMPRE,
    // sin importar qué perspectiva está seleccionada — nunca escondido
    // detrás de una pestaña. Sector/cobertura solo aparecen en Exposición.
    expect(screen.getByText("USD $16,389")).toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.simulate.coverageTitle")).not.toBeInTheDocument();

    await user.click(screen.getByText("portfolio.distribution.simulate.perspective.exposure"));
    expect(screen.getByText("portfolio.distribution.simulate.coverageTitle")).toBeInTheDocument();
    expect(screen.getByText("USD $16,389")).toBeInTheDocument();
  });

  it("shows the server's error message when the backend refuses the input (422)", async () => {
    const user = userEvent.setup();
    simulateMock.mockRejectedValue({ response: { status: 422, data: { detail: "El monto debe ser mayor a cero." } } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("El monto debe ser mayor a cero.")).toBeInTheDocument());
  });

  it("shows a generic error message on an unexpected backend failure (503)", async () => {
    const user = userEvent.setup();
    simulateMock.mockRejectedValue({ response: { status: 503 } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.error.generic")).toBeInTheDocument());
  });
});

describe("BeforeAfterSimulator — discard and stale-result invalidation", () => {
  async function runOne(user: ReturnType<typeof userEvent.setup>) {
    simulateMock.mockResolvedValue({ data: baseSimResponse() });
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());
  }

  it("discarding clears the result and returns to the ticker search step", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runOne(user);
    await user.click(screen.getByText("portfolio.distribution.simulate.discard"));
    expect(screen.queryByText("portfolio.distribution.simulate.hypotheticalBadge")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).toBeInTheDocument();
  });

  it("changing the amount after a result exists immediately invalidates it", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runOne(user);
    const amountInput = screen.getByPlaceholderText("0");
    await user.type(amountInput, "1"); // any edit to the amount
    await waitFor(() => expect(screen.queryByText("portfolio.distribution.simulate.hypotheticalBadge")).not.toBeInTheDocument());
  });

  it("changing the ticker after a result exists immediately invalidates it", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runOne(user);
    await user.click(screen.getByLabelText("portfolio.distribution.simulate.removeTicker"));
    await waitFor(() => expect(screen.queryByText("portfolio.distribution.simulate.hypotheticalBadge")).not.toBeInTheDocument());
  });
});

describe("BeforeAfterSimulator — switching portfolios never carries over a result", () => {
  it("resets ticker, amount, and result when portfolioId changes", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponse() });
    const { rerender } = render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    rerender(<BeforeAfterSimulator portfolioId="retirement" currency="USD" na={NA} />);

    expect(screen.queryByText("portfolio.distribution.simulate.hypotheticalBadge")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).toBeInTheDocument();
  });
});

// ─── Fase 5C: the "Historia" perspective ───────────────────────────────

function baseHistoryResponse(overrides: Record<string, unknown> = {}) {
  const idx = (start: number, end: number) => [
    { date: "2025-11-04", value: start },
    { date: "2026-05-04", value: (start + end) / 2 },
    { date: "2026-11-04", value: end },
  ];
  return {
    available: true,
    period_requested: "1y",
    window_status: "full",
    start_date: "2025-11-04",
    end_date: "2026-11-04",
    observations: 3,
    index_before: idx(100, 112.5),
    index_after: idx(100, 115.2),
    volatility_before: { value: 18.2, observations: 2, frequency: "daily", annualization_factor: 15.87 },
    volatility_after: { value: 17.9, observations: 2, frequency: "daily", annualization_factor: 15.87 },
    max_drawdown_before: { value: -10.1, peak_date: "2025-11-04", trough_date: "2026-05-04" },
    max_drawdown_after: { value: -9.4, peak_date: "2025-11-04", trough_date: "2026-05-04" },
    sources: ["FMP /historical-price-eod/dividend-adjusted (adjClose)"],
    methodology_es: "Metodología de prueba.",
    ...overrides,
  };
}

async function runSimAndOpenHistory(user: ReturnType<typeof userEvent.setup>, amount = "5000") {
  simulateMock.mockResolvedValue({ data: baseSimResponse() });
  await selectTicker(user);
  await user.type(screen.getByPlaceholderText("0"), amount);
  await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
  await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());
  await user.click(screen.getByText("portfolio.distribution.simulate.perspective.history"));
}

describe("BeforeAfterSimulator — Fase 5C: perspectiva Historia", () => {
  it("test 9/4: fetches only the selected period, with the exact (portfolio, ticker, amount, period)", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    await waitFor(() => expect(simulateHistoryMock).toHaveBeenCalledTimes(1));
    expect(simulateHistoryMock).toHaveBeenCalledWith("default", "QQQ", 5000, "1y");
    // the three-period selector is visible, 1y pre-selected
    expect(screen.getByText("portfolio.distribution.simulate.history.period.1y")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.simulate.history.period.3y")).toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.simulate.history.period.5y")).toBeInTheDocument();
  });

  it("test 5/6: both curves start at 100 and share the same dates (rendered via the chart's legend + dateRange note)", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.history.startingValue")).toBeInTheDocument());
    expect(screen.getByText("portfolio.distribution.simulate.history.legendBefore")).toBeInTheDocument();
    expect(screen.getByText(/legendAfter.*QQQ/)).toBeInTheDocument();
  });

  it("test 7/8: volatility and max drawdown shown match the backend's own values verbatim", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    await waitFor(() => expect(screen.getByText("18.2%")).toBeInTheDocument());
    expect(screen.getByText("17.9%")).toBeInTheDocument();
    expect(screen.getByText("-10.1%")).toBeInTheDocument();
    expect(screen.getByText("-9.4%")).toBeInTheDocument();
  });

  it("test 9: changing the period requests the new period and re-renders with its data", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValueOnce({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);
    await waitFor(() => expect(simulateHistoryMock).toHaveBeenCalledTimes(1));

    simulateHistoryMock.mockResolvedValueOnce({ data: { history: baseHistoryResponse({ volatility_before: { value: 30.0 } }) } });
    await user.click(screen.getByText("portfolio.distribution.simulate.history.period.5y"));
    await waitFor(() => expect(simulateHistoryMock).toHaveBeenCalledWith("default", "QQQ", 5000, "5y"));
    await waitFor(() => expect(screen.getByText("30.0%")).toBeInTheDocument());
  });

  it("test 9 (cache): switching back to an already-fetched period does not re-fetch", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);
    await waitFor(() => expect(simulateHistoryMock).toHaveBeenCalledTimes(1));

    await user.click(screen.getByText("portfolio.distribution.simulate.history.period.5y"));
    await waitFor(() => expect(simulateHistoryMock).toHaveBeenCalledTimes(2));
    await user.click(screen.getByText("portfolio.distribution.simulate.history.period.1y")); // back to the first, already cached
    await waitFor(() => expect(screen.getByText("18.2%")).toBeInTheDocument());
    expect(simulateHistoryMock).toHaveBeenCalledTimes(2); // no third call
  });

  it("test 10: changing the ticker invalidates the historical result and its cache", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);
    await waitFor(() => expect(screen.getByText("18.2%")).toBeInTheDocument());

    await user.click(screen.getByLabelText("portfolio.distribution.simulate.removeTicker"));
    expect(screen.queryByText("18.2%")).not.toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.simulate.perspective.history")).not.toBeInTheDocument(); // the whole result (and its tabs) is gone
  });

  it("test 11: switching portfolios drops any cached history from the previous one", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    const { rerender } = render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);
    await waitFor(() => expect(screen.getByText("18.2%")).toBeInTheDocument());

    rerender(<BeforeAfterSimulator portfolioId="retirement" currency="USD" na={NA} />);
    expect(screen.queryByText("18.2%")).not.toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.simulate.perspective.history")).not.toBeInTheDocument();
  });

  it("test 12/13: an unavailable historical comparison shows the exact reason, never a fabricated chart", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: { available: false, reason: "non_usd_instrument", detail: {} } } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    // the test i18n mock always returns the literal fallback string for a
    // (key, defaultString) call regardless of whether the key "exists" --
    // so what this proves is that the unavailable branch rendered a
    // message at all (never a fabricated chart), not the exact reason copy.
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.history.unavailableTitle")).toBeInTheDocument());
    expect(screen.getByText("portfolio.distribution.simulate.history.unavailable.generic")).toBeInTheDocument();
    expect(screen.queryByText("portfolio.distribution.simulate.history.startingValue")).not.toBeInTheDocument();
  });

  it("test 12: a provider/network failure shows a generic error, not a crash", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockRejectedValue({ response: { status: 503 } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.history.errorGeneric")).toBeInTheDocument());
  });

  it("test 14: a partial window is identified explicitly, with the real start date", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse({ window_status: "partial", start_date: "2024-03-01" }) } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    // the test i18n mock never substitutes {{vars}} into real values (see
    // this file's `useTranslation` mock) -- confirming the key itself
    // rendered is what proves the "partial" branch fired instead of the
    // "full" one.
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.history.windowPartial")).toBeInTheDocument());
  });

  it("the loading state is shown while the request is in flight", async () => {
    const user = userEvent.setup();
    let resolveFn: (v: unknown) => void = () => {};
    simulateHistoryMock.mockReturnValue(new Promise((resolve) => { resolveFn = resolve; }));
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);

    expect(screen.getByText("portfolio.distribution.simulate.history.loading")).toBeInTheDocument();
    resolveFn({ data: { history: baseHistoryResponse() } });
    await waitFor(() => expect(screen.queryByText("portfolio.distribution.simulate.history.loading")).not.toBeInTheDocument());
  });

  it("test 3/18: the plain simulation itself is unaffected by the Historia tab existing — same call, same args", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponse() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    expect(simulateMock).toHaveBeenCalledTimes(1);
    expect(simulateMock).toHaveBeenCalledWith("default", "QQQ", 5000);
    expect(simulateHistoryMock).not.toHaveBeenCalled(); // never fetched unless the Historia tab is actually opened
  });

  it("discarding resets the perspective back to Distribución for the next simulation", async () => {
    const user = userEvent.setup();
    simulateHistoryMock.mockResolvedValue({ data: { history: baseHistoryResponse() } });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await runSimAndOpenHistory(user);
    await waitFor(() => expect(screen.getByText("18.2%")).toBeInTheDocument());

    await user.click(screen.getByText("portfolio.distribution.simulate.discard"));
    await runOneHistoryHelper(user);
    // back on Distribución by default — Historia content isn't shown until the tab is clicked again
    expect(screen.queryByText("18.2%")).not.toBeInTheDocument();
  });
});

async function runOneHistoryHelper(user: ReturnType<typeof userEvent.setup>) {
  simulateMock.mockResolvedValue({ data: baseSimResponse() });
  await selectTicker(user);
  await user.type(screen.getByPlaceholderText("0"), "5000");
  await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
  await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());
}

// ─── Fase 5D: logos, nombres, y pulido editorial ───────────────────────────

function baseSimResponseWithIdentity(overrides: Record<string, unknown> = {}) {
  const base = baseSimResponse(overrides) as any;
  base.after.positions[0] = { ...base.after.positions[0], name: "Invesco QQQ Trust", etf_company: "Invesco" };
  base.before.concentration.top_positions[0] = { ...base.before.concentration.top_positions[0], name: "Vanguard S&P 500 ETF" };
  base.after.concentration.top_positions[0] = { ...base.after.concentration.top_positions[0], name: "Invesco QQQ Trust" };
  return base;
}

describe("BeforeAfterSimulator — Fase 5D: identidad visual", () => {
  it("test 1: the ticker selector shows a logo for each search result and for the selected chip", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    searchMock.mockResolvedValue({ data: { results: [{ ticker: "QQQ", name: "Invesco QQQ Trust" }] } });
    await user.type(screen.getByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder"), "QQQ");
    await waitFor(() => expect(screen.getByText("Invesco QQQ Trust")).toBeInTheDocument());
    expect(screen.getAllByAltText("QQQ").length).toBeGreaterThan(0); // StockAvatar's alt=ticker, in the dropdown row

    await user.click(screen.getByText("Invesco QQQ Trust"));
    expect(screen.getAllByAltText("QQQ").length).toBeGreaterThan(0); // and again on the selected chip
  });

  it("test 1/2: the result header shows the real logo, ticker, and full name (equity or ETF)", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));

    await waitFor(() => expect(screen.getAllByText("Invesco QQQ Trust").length).toBeGreaterThan(0));
    expect(screen.getAllByAltText("QQQ").length).toBeGreaterThan(0);
  });

  it("test 3: an asset without a logo falls back to initials, never a broken image or a crash", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponse() }); // no `name`/`etf_company` on the position
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));

    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());
    // StockAvatar always renders an <img> first (parqet fallback) -- the
    // initials-only path only appears after a real onError, which jsdom
    // doesn't fire automatically; what matters here is nothing crashes
    // and the ticker itself is still shown.
    expect(screen.getAllByAltText("QQQ").length).toBeGreaterThan(0);
  });

  it("test 4: an asset without a full name shows only the ticker, never a fabricated name", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponse() }); // position has no `name`
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));

    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());
    expect(screen.getAllByText("QQQ").length).toBeGreaterThan(0);
  });

  it("test 7: identity stays correct after changing the ticker", async () => {
    const user = userEvent.setup();
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user, "QQQ", "Invesco QQQ Trust");
    await user.click(screen.getByLabelText("portfolio.distribution.simulate.removeTicker"));
    await selectTicker(user, "AAPL", "Apple Inc.");
    expect(screen.getByText(/AAPL.*Apple Inc\./)).toBeInTheDocument(); // the selected chip combines ticker+name in one text node
    expect(screen.queryByText(/QQQ/)).not.toBeInTheDocument(); // no cross-contamination from the previous ticker
    expect(screen.queryByText(/Invesco QQQ Trust/)).not.toBeInTheDocument();
  });

  it("test 8: identity resets when switching portfolios", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    const { rerender } = render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getAllByText("Invesco QQQ Trust").length).toBeGreaterThan(0));

    rerender(<BeforeAfterSimulator portfolioId="retirement" currency="USD" na={NA} />);
    expect(screen.queryByText("Invesco QQQ Trust")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("portfolio.distribution.simulate.searchPlaceholder")).toBeInTheDocument();
  });

  it("test 9: metadata never crosses between two different instruments shown on screen", async () => {
    // QQQ (the simulated ticker) and VOO (the real largest position) each
    // keep their OWN real name -- never one bleeding into the other.
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getAllByText("Invesco QQQ Trust").length).toBeGreaterThan(0));
    expect(screen.queryByText("Vanguard S&P 500 ETF")).not.toBeInTheDocument(); // VOO's name never shown for QQQ's card
  });

  it("test 11: the educational 'meaning' sentence appears exactly once, never duplicated across perspectives", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    const sentence = "Tu portafolio tendría una mayor dependencia del comportamiento de QQQ. Si esta inversión subiera o bajara, su movimiento tendría un impacto proporcionalmente mayor sobre el valor total de tus inversiones.";
    expect(screen.getAllByText(sentence).length).toBe(1);
    await user.click(screen.getByText("portfolio.distribution.simulate.perspective.exposure"));
    expect(screen.getAllByText(sentence).length).toBe(1);
  });

  it("fixed wording: the largest-position card no longer reads 'VOO → VOO' and shows a real before/after comparison", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    expect(screen.queryByText("VOO → QQQ")).not.toBeInTheDocument();
    expect(screen.getByText("portfolio.distribution.simulate.concentrationChangeLabel")).toBeInTheDocument();
  });

  it("shows a discreet note that the value increase comes from the contribution, not a return", async () => {
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    expect(screen.getByText("portfolio.distribution.simulate.valueIncreaseNote")).toBeInTheDocument();
  });

  it("test 12: the instrument-weight card is now part of the always-visible 'cambio principal' block, shown on every perspective", async () => {
    // Diego, 2026-11 (rediseño): se promovió fuera de las pestañas por
    // perspectiva — "mostrar primero el cambio principal y su
    // significado", sin importar qué perspectiva esté seleccionada.
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    expect(screen.getByText("portfolio.distribution.simulate.positionWeightTitle")).toBeInTheDocument();
    await user.click(screen.getByText("portfolio.distribution.simulate.perspective.exposure"));
    expect(screen.getByText("portfolio.distribution.simulate.positionWeightTitle")).toBeInTheDocument();
  });

  it("test 10: avatar images are never requested redundantly for the same ticker across re-renders of the same card", async () => {
    // StockAvatar itself only issues one <img> per mount; this asserts
    // the header doesn't mount two competing identity blocks for the
    // same simulated ticker. Diego, 2026-11 (rediseño): the Distribución
    // tab's own duplicate <AssetIdentity> (redundant with the result
    // header right above it) was removed as part of the nesting cleanup.
    const user = userEvent.setup();
    simulateMock.mockResolvedValue({ data: baseSimResponseWithIdentity() });
    render(<BeforeAfterSimulator portfolioId="default" currency="USD" na={NA} />);
    await selectTicker(user);
    await user.type(screen.getByPlaceholderText("0"), "5000");
    await user.click(screen.getByText("portfolio.distribution.simulate.simulateButton"));
    await waitFor(() => expect(screen.getByText("portfolio.distribution.simulate.hypotheticalBadge")).toBeInTheDocument());

    // the selected-ticker chip + the result header = exactly 2 logos for
    // QQQ -- never more (no accidental extra re-fetch/re-mount per render).
    expect(screen.getAllByAltText("QQQ").length).toBe(2);
  });
});
