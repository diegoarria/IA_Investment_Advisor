from unittest.mock import patch

from app.api.routes import earnings


def _ev(sym):
    return [{"ticker": sym, "event_date": "2026-10-01", "event_type": "earnings", "status": "upcoming"}]


def test_one_failing_ticker_never_drops_the_others():
    def fake(sym):
        if sym == "BAD":
            raise RuntimeError("provider down")
        return _ev(sym)
    with patch.object(earnings, "_fetch_events_for_symbol", side_effect=fake):
        out = earnings._fetch_earnings_calendar(["AAPL", "BAD", "KO"])
    by = {e["ticker"]: e for e in out}
    assert by["AAPL"]["event_date"] and by["KO"]["event_date"]        # healthy ones intact
    assert by["BAD"]["status"] == "unknown" and by["BAD"]["event_date"] is None


def test_placeholder_only_results_are_cached_briefly_real_dates_normally():
    calls = {}
    def fake_cache_set(key, value, ttl):
        calls[key] = ttl
    with patch.object(earnings, "cache_get", return_value=None), patch.object(earnings, "cache_set", side_effect=fake_cache_set), \
         patch.object(earnings, "_finnhub_earnings_date", return_value=None), \
         patch.object(earnings, "_fetch_quote_light", return_value=None), \
         patch.object(earnings, "_finnhub_dividend_events", return_value=[]):
        events = earnings._fetch_events_for_symbol("AAPL")
    assert events[0]["status"] == "unknown"
    assert calls["events:cal7:AAPL"] == 300                            # short: a transient miss heals in minutes
    calls.clear()
    with patch.object(earnings, "cache_get", return_value=None), patch.object(earnings, "cache_set", side_effect=fake_cache_set), \
         patch.object(earnings, "_finnhub_earnings_date", return_value={"event_date": "2099-01-01"}), \
         patch.object(earnings, "_fetch_quote_light", return_value=None), \
         patch.object(earnings, "_finnhub_dividend_events", return_value=[]):
        earnings._fetch_events_for_symbol("KO")
    assert calls["events:cal7:KO"] == earnings._TTL_CALENDAR
