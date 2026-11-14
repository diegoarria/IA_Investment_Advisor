import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

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

const pushMock = vi.fn();
const backMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, back: backMock }),
  useParams: () => ({ ticker: "VOO" }),
}));

vi.mock("@/components/AppSidebar", () => ({ default: () => null }));
vi.mock("@/components/MarketTickerBar", () => ({ default: () => null }));

const getOverviewMock = vi.fn();
vi.mock("@/lib/api", () => ({
  etfApi: { getOverview: (...args: unknown[]) => getOverviewMock(...args) },
}));

import EtfDetailPage from "./page";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function baseOverview(overrides: Record<string, unknown> = {}) {
  return {
    ticker: "VOO",
    identification: {
      name: "Vanguard S&P 500 ETF", etf_company: "Vanguard", description: "Sigue el índice S&P 500.",
      has_editorial_description: true, inception_date: "2010-09-07", exchange: "NYSE Arca", isin: "US9229083632",
    },
    costs: { expense_ratio_pct: 0.03, cost_tier: "muy_bajo", aum_usd: 450_000_000_000, nav: 450.1, nav_currency: "USD" },
    exposure: {
      sector_weightings: [{ name: "Tecnología", weight_pct: 32.4 }, { name: "Salud", weight_pct: 12.1 }],
      sector_weight_sum_pct: 100, country_weightings: [{ name: "Estados Unidos", weight_pct: 99.1 }],
      country_weight_sum_pct: 100, holdings_count: 508,
    },
    diversification: {
      by_sector: { top1_name: "Tecnología", top1_weight_pct: 32.4, top3_weight_pct: 58.1, bucket_count: 11 },
      by_country: { top1_name: "Estados Unidos", top1_weight_pct: 99.1, top3_weight_pct: 99.8, bucket_count: 3 },
    },
    price: {
      current: 450.1, change_pct_today: 0.5, year_low: 400, year_high: 460,
      returns: { ytd_pct: 8.2, one_year_pct: 12.3, five_year_pct: 65.4, max_pct: 180.5, max_start_date: "2010-09-07", max_is_full_history: true },
    },
    dividends: { recent: [{ ex_date: "2026-09-20", amount: 1.8, yield_pct: 1.3, frequency: "quarterly" }], latest_yield_pct: 1.3 },
    data_quality: { source: "fmp", structural_fetched_at: 1700000000, price_fetched_at: 1700000500, missing_fields: [], is_actively_trading: true, suspicious_expense_ratio: false },
    insights: [
      { category: "sector_concentration", text: "El sector Tecnología representa el 32.4% del fondo.", supporting_data: { sector: "Tecnología", weight_pct: 32.4 } },
      { category: "geographic_exposure", text: "Casi toda la exposición está en Estados Unidos (99.1%).", supporting_data: {} },
      { category: "cost", text: "Cobra 0.03% al año.", supporting_data: {} },
    ],
    horizon_note: "Nota educativa estática sobre horizonte de inversión.",
    horizon_note_extended: "Detalle adicional sobre horizonte de inversión.",
    ...overrides,
  };
}

describe("EtfDetailPage — identidad y navegación", () => {
  it("renders a long ETF name without truncating mid-word (line-clamp, not truncate)", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview({ identification: { ...baseOverview().identification, name: "Vanguard Total International Stock Index Fund ETF Shares" } }) });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("Vanguard Total International Stock Index Fund ETF Shares")).toBeInTheDocument());
    const h1 = screen.getByText("Vanguard Total International Stock Index Fund ETF Shares");
    expect(h1.className).toContain("line-clamp-2");
    expect(h1.className).not.toContain("truncate");
  });

  it("navigates to the comparator pre-filled with this ticker", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    getOverviewMock.mockResolvedValue({ data: baseOverview() });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("etf.compare.ctaFromDetail")).toBeInTheDocument());
    await user.click(screen.getByText("etf.compare.ctaFromDetail"));
    expect(pushMock).toHaveBeenCalledWith("/etf/compare?tickers=VOO");
  });

  it("shows real structural and price timestamps, formatted — never a raw unix number", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview() });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText(/etf.detail.footer.source/)).toBeInTheDocument());
    const footer = screen.getByText(/etf.detail.footer.source/);
    expect(footer.textContent).not.toMatch(/1700000000/);
  });
});

describe("EtfDetailPage — observación principal, sin duplicaciones", () => {
  it("shows a number-free primary intro, anchored, never insights[0]'s raw backend text, and never a percentage it repeats in Composición", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview() });
    render(<EtfDetailPage />);
    // The generic, number-free intro — not insights[0].text verbatim.
    await waitFor(() => expect(screen.getByText(/su peso no está repartido de forma uniforme entre sectores/)).toBeInTheDocument());
    expect(screen.queryByText("El sector Tecnología representa el 32.4% del fondo.")).not.toBeInTheDocument();
    // insights[1]/[2]'s exact backend sentences are never rendered anywhere either.
    expect(screen.queryByText("Casi toda la exposición está en Estados Unidos (99.1%).")).not.toBeInTheDocument();
    expect(screen.queryByText("Cobra 0.03% al año.")).not.toBeInTheDocument();
    // The underlying number only ever shows up in Composición, the
    // section the primary card anchors to — never in the primary card
    // itself (asserted above via the number-free intro text).
    expect(screen.getByText(/El sector Tecnología concentra el 32\.4%/)).toBeInTheDocument();
  });

  it("shows an honest empty state when the backend returns zero insights, never fabricating one", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview({ insights: [] }) });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("etf.detail.understand.empty")).toBeInTheDocument());
  });
});

describe("EtfDetailPage — holdings y composición", () => {
  it("never claims holdings_count alone guarantees diversification, and discloses individual holdings are unavailable exactly once", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview() });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("508")).toBeInTheDocument());
    expect(screen.getAllByText(/no garantiza diversificación/).length).toBe(1);
    expect(screen.getAllByText(/no tiene acceso/).length).toBe(1);
  });

  it("replaces the old 'dominant country' metric tile with AUM — country now lives only in Geografía", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview() });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("etf.detail.costs.aum")).toBeInTheDocument());
    // "Estados Unidos" appears once (Geografía section), never as a metric tile too.
    expect(screen.getAllByText("Estados Unidos").length).toBe(1);
  });
});

describe("EtfDetailPage — casos de datos incompletos (bonos, oro, faltantes)", () => {
  it("bond-ETF style: no sector concentration data, geography present — never fabricates a sector sentence", async () => {
    getOverviewMock.mockResolvedValue({
      data: baseOverview({
        diversification: {
          by_sector: { top1_name: null, top1_weight_pct: null, top3_weight_pct: null, bucket_count: 0 },
          by_country: { top1_name: "Estados Unidos", top1_weight_pct: 85, top3_weight_pct: 92, bucket_count: 4 },
        },
        exposure: { ...baseOverview().exposure, sector_weightings: [] },
        insights: [{ category: "geographic_exposure", text: "La mayor parte está en Estados Unidos (85%).", supporting_data: {} }],
      }),
    });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText(/exposición geográfica.*tampoco está repartida de forma uniforme/)).toBeInTheDocument());
    expect(screen.queryByText("La mayor parte está en Estados Unidos (85%).")).not.toBeInTheDocument();
    expect(screen.queryByText(/concentra el/)).not.toBeInTheDocument();
  });

  it("gold-ETF style: no geography data at all — the Geografía section doesn't render, never shows an empty/fabricated one", async () => {
    getOverviewMock.mockResolvedValue({
      data: baseOverview({
        exposure: { ...baseOverview().exposure, country_weightings: [] },
        diversification: { ...baseOverview().diversification, by_country: { top1_name: null, top1_weight_pct: null, top3_weight_pct: null, bucket_count: 0 } },
      }),
    });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("etf.detail.invests.title")).toBeInTheDocument());
    expect(screen.queryByText("etf.detail.invests.byCountry")).not.toBeInTheDocument();
  });

  it("missing costs: shows the 'not available' placeholder, never a fabricated expense ratio", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview({ costs: { expense_ratio_pct: null, cost_tier: null, aum_usd: null, nav: null, nav_currency: null } }) });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("etf.detail.metrics.expenseRatio")).toBeInTheDocument());
    expect(screen.getAllByText("etf.detail.notAvailable").length).toBeGreaterThan(0);
  });

  it("missing dividends: the recent-dividends block is skipped entirely, never an empty table", async () => {
    getOverviewMock.mockResolvedValue({ data: baseOverview({ dividends: { recent: [], latest_yield_pct: null } }) });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("etf.detail.performance.title")).toBeInTheDocument());
    expect(screen.queryByText("etf.detail.performance.recentDividends")).not.toBeInTheDocument();
  });
});

describe("EtfDetailPage — errores", () => {
  it("shows the real backend 422 message for a non-ETF ticker, never a generic fallback", async () => {
    getOverviewMock.mockRejectedValue({ response: { status: 422, data: { detail: { message: "AAPL no se clasifica como un ETF." } } } });
    render(<EtfDetailPage />);
    await waitFor(() => expect(screen.getByText("AAPL no se clasifica como un ETF.")).toBeInTheDocument());
  });
});
