import { describe, it, expect } from "vitest";
import { sortTimelineEventsDesc, type CompanyTimelineEvent } from "./companyTimeline";

describe("sortTimelineEventsDesc", () => {
  it("sorts by event_date, most recent first", () => {
    const events: CompanyTimelineEvent[] = [
      { ticker: "AAPL", event_date: "2025-01-01", event_type: "other", headline: "old" },
      { ticker: "AAPL", event_date: "2026-01-01", event_type: "other", headline: "newest" },
      { ticker: "AAPL", event_date: "2025-06-01", event_type: "other", headline: "middle" },
    ];
    expect(sortTimelineEventsDesc(events).map((e) => e.headline)).toEqual(["newest", "middle", "old"]);
  });

  it("falls back to created_at when event_date is null", () => {
    const events: CompanyTimelineEvent[] = [
      { ticker: "AAPL", event_date: null, event_type: "other", headline: "a", created_at: "2026-01-01T00:00:00Z" },
      { ticker: "AAPL", event_date: "2025-01-01", event_type: "other", headline: "b" },
    ];
    expect(sortTimelineEventsDesc(events).map((e) => e.headline)).toEqual(["a", "b"]);
  });

  it("does not mutate the original array", () => {
    const events: CompanyTimelineEvent[] = [
      { ticker: "AAPL", event_date: "2025-01-01", event_type: "other", headline: "old" },
      { ticker: "AAPL", event_date: "2026-01-01", event_type: "other", headline: "newest" },
    ];
    const original = [...events];
    sortTimelineEventsDesc(events);
    expect(events).toEqual(original);
  });

  it("handles an empty list", () => {
    expect(sortTimelineEventsDesc([])).toEqual([]);
  });
});
