import { createRequestGuard } from "./requestGuard";

describe("createRequestGuard", () => {
  it("treats the first requested id as current until a newer one is requested", () => {
    const guard = createRequestGuard();
    const id = guard.next();
    expect(guard.isCurrent(id)).toBe(true);
  });

  it("marks an older request id as stale once a newer one is requested — simulates a late HTTP response", () => {
    const guard = createRequestGuard();
    const staleId = guard.next();
    const freshId = guard.next();
    expect(guard.isCurrent(staleId)).toBe(false);
    expect(guard.isCurrent(freshId)).toBe(true);
  });

  it("invalidate() makes any in-flight request id stale even though no new id was requested yet — simulates a portfolio switch", () => {
    const guard = createRequestGuard();
    const inFlightId = guard.next();
    expect(guard.isCurrent(inFlightId)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(inFlightId)).toBe(false);
  });

  it("a request started after invalidate() is current again", () => {
    const guard = createRequestGuard();
    const before = guard.next();
    guard.invalidate();
    const after = guard.next();
    expect(guard.isCurrent(before)).toBe(false);
    expect(guard.isCurrent(after)).toBe(true);
  });

  it("next() never returns 0 — real request ids start at 1", () => {
    const guard = createRequestGuard();
    expect(guard.next()).not.toBe(0);
  });
});
