"""Persists the last real post-market (after-hours) snapshot per ticker so
it keeps showing after Yahoo stops serving it.

Yahoo's chart `meta` only carries `postMarketPrice`/`marketState` DURING
the live POST/POSTPOST window — once the after-hours session itself ends
(~8pm ET) those fields go back to null/absent entirely rather than holding
the last known value, so the AH % a user saw at 7pm silently vanished by
9pm even though it's still the real, relevant number for the day (Diego,
confirmed live against Yahoo directly: "no muestra ningunos porcentajes de
nada de AH" a couple hours after close, and marketState itself comes back
None at that hour — not the string "CLOSED"). Shared by market.py's
/prices and watchlist.py's _fetch_extended_price so both screens show the
same backfilled number for the same ticker.
"""

from app.core.cache import cache_get, cache_set

# Covers the ~8h overnight gap between post-market close (~8pm ET) and the
# next day's pre-market open (~4am ET) with margin, but expires well before
# the following evening's post-market session so it can never resurface as
# stale data a full day later.
_AH_TTL_SECONDS = 10 * 60 * 60


def _key(ticker: str) -> str:
    return f"last_ah:{ticker.upper()}"


def backfill_after_hours(ticker: str, result: dict) -> None:
    """Mutates `result` in place. Call after populating market_state/
    post_market_price/post_market_change_pct from a live Yahoo fetch."""
    market_state = (result.get("market_state") or "").upper()

    if result.get("post_market_price") is not None and market_state in ("POST", "POSTPOST"):
        cache_set(_key(ticker), {
            "post_market_price": result["post_market_price"],
            "post_market_change_pct": result.get("post_market_change_pct"),
        }, ttl=_AH_TTL_SECONDS)
        return

    # Yahoo isn't actively serving either extended session right now — never
    # overwrite a live pre-market read, and never backfill during a genuine
    # live REGULAR session (no pre/post fields then is normal, not "closed").
    if (
        result.get("post_market_price") is None
        and result.get("pre_market_price") is None
        and market_state != "REGULAR"
    ):
        cached = cache_get(_key(ticker))
        if cached:
            result["post_market_price"] = cached["post_market_price"]
            result["post_market_change_pct"] = cached.get("post_market_change_pct")
            result["market_state"] = "CLOSED"
