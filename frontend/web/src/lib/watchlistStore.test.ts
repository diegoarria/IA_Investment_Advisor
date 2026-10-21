// Real functional tests against the real useWatchlistStore (store.ts) —
// 2026-10-20: Patrimonio's Watchlist tab flashed "vacía" on a fresh
// session landing there before /watchlist ever ran. Root cause:
// loadFromServer() trusted a first-ever-this-session empty read outright
// (no second-confirmation guard, unlike /watchlist/page.tsx's own
// firstEmptyStreakRef), and no screen reading this store could tell
// "still loading" apart from "confirmed empty." These tests exercise the
// real store's real loadFromServer() against a mocked API, not a
// reimplementation of its logic.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./api", () => ({
  watchlist: { get: vi.fn(), add: vi.fn(), remove: vi.fn() },
}));

describe("useWatchlistStore.loadFromServer — first-ever-empty + hasLoadedFromServer", () => {
  let useWatchlistStore: typeof import("./store").useWatchlistStore;
  let useAuthStore: typeof import("./store").useAuthStore;
  let watchlistApi: { get: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const api = await import("./api");
    watchlistApi = api.watchlist as any;
    watchlistApi.get.mockReset();
    const store = await import("./store");
    useWatchlistStore = store.useWatchlistStore;
    useAuthStore = store.useAuthStore;
    useAuthStore.setState({ userId: "test-user-1", isAuthenticated: true });
    useWatchlistStore.setState({ items: [], hasLoadedFromServer: false, pendingSync: false, pendingSyncSetAt: null });
  });

  it("does NOT show as loaded after a single first-ever-session empty read", async () => {
    watchlistApi.get.mockResolvedValueOnce({ data: [] });
    await useWatchlistStore.getState().loadFromServer();
    // One empty read alone must not be trusted yet — the scheduled
    // second check hasn't fired (it's 2.5s out, under fake timers).
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(false);
    expect(useWatchlistStore.getState().items).toEqual([]);
  });

  it("confirms genuinely empty only after a SECOND consecutive empty read", async () => {
    watchlistApi.get.mockResolvedValue({ data: [] });
    await useWatchlistStore.getState().loadFromServer();
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(false);

    await vi.advanceTimersByTimeAsync(2600); // fires the scheduled retry
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(true);
    expect(useWatchlistStore.getState().items).toEqual([]);
    // >=2, not exactly 2 — the store's own persist rehydration also
    // schedules an independent loadFromServer() call on mount, which can
    // land in the same fake-timer window; the real signal here is that
    // the first-ever-empty retry actually happened and got confirmed.
    expect(watchlistApi.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a real non-empty read confirms immediately, no artificial delay", async () => {
    watchlistApi.get.mockResolvedValueOnce({
      data: [{ ticker: "AAPL", name: "Apple", added_at: "2026-10-20T00:00:00Z" }],
    });
    await useWatchlistStore.getState().loadFromServer();
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(true);
    expect(useWatchlistStore.getState().items.map((i) => i.ticker)).toEqual(["AAPL"]);
    expect(watchlistApi.get).toHaveBeenCalledTimes(1);
  });

  it("a network/auth error never marks the watchlist as loaded-and-empty — previously confirmed items stay visible", async () => {
    // First, a real successful load with real items (simulates a prior
    // confirmed state from earlier in the session).
    watchlistApi.get.mockResolvedValueOnce({
      data: [{ ticker: "MSFT", name: "Microsoft", added_at: "2026-10-20T00:00:00Z" }],
    });
    await useWatchlistStore.getState().loadFromServer();
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(true);
    expect(useWatchlistStore.getState().items.map((i) => i.ticker)).toEqual(["MSFT"]);

    // Now a transient failure (network/401/500 — all surface as a thrown
    // error from the api client) must never wipe the already-confirmed
    // item or flip hasLoadedFromServer to a false "empty" state.
    watchlistApi.get.mockRejectedValueOnce(new Error("Network Error"));
    await useWatchlistStore.getState().loadFromServer();
    expect(useWatchlistStore.getState().items.map((i) => i.ticker)).toEqual(["MSFT"]);
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(true);
  });

  it("a legitimate removal (real empty response after real items existed) still converges to empty", async () => {
    watchlistApi.get.mockResolvedValueOnce({
      data: [{ ticker: "TSLA", name: "Tesla", added_at: "2026-10-20T00:00:00Z" }],
    });
    await useWatchlistStore.getState().loadFromServer();
    expect(useWatchlistStore.getState().items.map((i) => i.ticker)).toEqual(["TSLA"]);

    // Real deletion elsewhere (another device/tab) — 3 consecutive real
    // empty reads (the existing per-ticker miss-streak, unrelated to the
    // first-ever-empty guard which only applies when items was ALREADY
    // empty) before a confirmed item is dropped.
    watchlistApi.get.mockResolvedValue({ data: [] });
    for (let i = 0; i < 3; i++) {
      await useWatchlistStore.getState().loadFromServer();
      await vi.advanceTimersByTimeAsync(3100);
    }
    expect(useWatchlistStore.getState().items).toEqual([]);
  });

  it("logout resets hasLoadedFromServer so the next account starts unconfirmed again", async () => {
    watchlistApi.get.mockResolvedValueOnce({
      data: [{ ticker: "AAPL", name: "Apple", added_at: "2026-10-20T00:00:00Z" }],
    });
    await useWatchlistStore.getState().loadFromServer();
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(true);

    await useAuthStore.getState().clearAuth();
    expect(useWatchlistStore.getState().hasLoadedFromServer).toBe(false);
  });
});
