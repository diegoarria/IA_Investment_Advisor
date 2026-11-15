import { ticketsToFetch, hasMoreToLoad, visibleSlice } from "./etfCardBatching";

const TICKERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
const PAGE_SIZE = 6;

describe("ticketsToFetch", () => {
  it("requests only the first batch of PAGE_SIZE tickers, never the whole list", () => {
    const result = ticketsToFetch(TICKERS, PAGE_SIZE, {});
    expect(result).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("never re-requests a ticker already present in the cache — avoids wasting FMP budget", () => {
    const cached = { A: {}, B: {}, C: {} };
    const result = ticketsToFetch(TICKERS, PAGE_SIZE, cached);
    expect(result).toEqual(["D", "E", "F"]);
  });

  it("requests nothing once the visible batch is fully cached", () => {
    const cached = Object.fromEntries(TICKERS.slice(0, PAGE_SIZE).map((t) => [t, {}]));
    expect(ticketsToFetch(TICKERS, PAGE_SIZE, cached)).toEqual([]);
  });

  it("expands to the next batch once visibleCount grows via 'load more'", () => {
    const cached = Object.fromEntries(TICKERS.slice(0, PAGE_SIZE).map((t) => [t, {}]));
    const result = ticketsToFetch(TICKERS, PAGE_SIZE * 2, cached);
    expect(result).toEqual(["G", "H", "I"]);
  });

  it("returns an empty list for an empty search result — never fetches cards for a query with no matches", () => {
    expect(ticketsToFetch([], PAGE_SIZE, {})).toEqual([]);
  });

  it("handles a rapid ticker-list switch (e.g. new search query) correctly — only the new list's first batch is requested", () => {
    const cachedFromPreviousSearch = { X: {}, Y: {} };
    const newTickers = ["A", "B", "C"];
    const result = ticketsToFetch(newTickers, PAGE_SIZE, cachedFromPreviousSearch);
    expect(result).toEqual(["A", "B", "C"]);
  });
});

describe("hasMoreToLoad", () => {
  it("is true when more tickers exist beyond the visible batch", () => {
    expect(hasMoreToLoad(TICKERS, PAGE_SIZE)).toBe(true);
  });

  it("is false once every ticker is already visible", () => {
    expect(hasMoreToLoad(TICKERS, TICKERS.length)).toBe(false);
  });

  it("is false when there's no active ticker list at all (e.g. still debouncing a search)", () => {
    expect(hasMoreToLoad(null, PAGE_SIZE)).toBe(false);
  });

  it("is false for an empty list — no 'cargar más' on an empty category", () => {
    expect(hasMoreToLoad([], PAGE_SIZE)).toBe(false);
  });
});

describe("visibleSlice", () => {
  it("returns only the tickers within the current visible window", () => {
    expect(visibleSlice(TICKERS, PAGE_SIZE)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("returns an empty array when there's no active ticker list, never throws", () => {
    expect(visibleSlice(null, PAGE_SIZE)).toEqual([]);
  });
});
