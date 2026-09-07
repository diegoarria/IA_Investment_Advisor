"""
Daily price-history percentile — "¿está cara vs. su propia historia?"
=======================================================================
Diego, 2026-08-31: "úsalo igual que AlphaSpread (97% de los días)" — this
replaces the annual-granularity version that used to live in
historical_valuation_service.py (5-10 fiscal-year-end points) with a real
DAILY one (~1,000 real trading days), the same kind of claim AlphaSpread
makes, built entirely from real data:

  - get_quarterly_eps_history (financial_data_service.py) — 20 real
    quarters with real filing dates and real diluted EPS.
  - get_daily_price_history (financial_data_service.py) — the full real
    daily close series over that span.

A real trailing-twelve-month (TTM) EPS is reconstructed as a step
function: it changes on each quarter's real filing_date (the day the
market actually learned that quarter's number), never before. Every real
trading day gets a real daily P/E once at least 4 real quarters have
accumulated — the first ~3-4 quarters of the fetched window can't form a
real TTM yet and are simply skipped, not estimated.

Does NOT touch historical_valuation_service.py's own annual multiples
(historical_median_pe/ev_ebitda/p_fcf, which feed peHistoricalAvg
elsewhere) — that's a different consumer, still real, still annual,
unchanged.

Diego, 2026-08-31 — caught by comparing against AlphaSpread's own real
"qué pasó después" numbers for META (8/2/5 = 15 total samples, not
hundreds): the daily PERCENTILE (today's P/E ranked against every real
daily P/E) has no independence problem — it's a single point-in-time rank,
not a repeated trial. But the "X of Y times the price was higher 1 year
later" BACKTEST is a different question, and counting every overlapping
trading day as its own independent trial is wrong: consecutive days are
almost perfectly autocorrelated.

Diego, 2026-08-31 (again, same session) — third real finding: for META,
the "cheap" bucket's typical forward return came out LOWER than the
"expensive" bucket's. Traced it to a STATIC full-period tercile band
mislabeling "cheap relative to the whole window" days that were actually
still mid-decline relative to their own recent regime. Fixed by making
the tercile bands ROLLING (_TRAILING_WINDOW_DAYS): each day is classified
against the real P/E distribution of its own preceding ~2 real trading
years, not the fixed whole-period one. The headline percentile_cheaper_
than stays full-period on purpose (matches AlphaSpread's own stated "vs.
the last 5 years" framing) — only the tercile buckets/backtest use the
rolling window.

Diego, 2026-09-01 — after two attempts at fixed-interval sampling (daily,
then quarterly-strided) kept either overstating or understating real
independent evidence, switched to what AlphaSpread's own published
methodology actually describes (Diego pasted their real "Cómo interpretar
estos resultados" text): group every real CONTIGUOUS run of days in the
same rolling tercile into ONE episode — "a long stay in a range counts
once," not once per fixed-length sample and not once per day. This is
the real fix, not another threshold: a 185-day "expensive" stretch is one
real episode (not ~3 quarterly near-duplicates, not 185 autocorrelated
daily near-duplicates); a 1-day blip is also one real, small episode. No
minimum date-spread guard is needed anymore — segmentation by contiguous
zone already guarantees every episode is a genuinely distinct real event,
so _BACKTEST_SAMPLE_STRIDE_DAYS and _MIN_BUCKET_DATE_SPREAD_DAYS from the
two previous attempts are gone. Confirmed live for META: real, non-empty,
plausibly MIXED results in all 3 bands (cheap n=9, 4 of 9 higher a year
later; normal n=10, 6 of 10; expensive n=2, 2 of 2) — a believable pattern
instead of either "hundreds of inflated samples" or "always empty."

Diego, 2026-09-01 (same day, 6th real finding) — caught with his own
concrete example: "si comprabas META el 4 de nov de 2022, hubieras
obtenido una rentabilidad brutal". That real episode (the Nov 2022 crash
bottom + 2023 recovery) was silently invisible to the backtest, because
classifying a day required a FULL _TRAILING_WINDOW_DAYS (~2 real years) of
trailing history first — for META that pushed the first classifiable day
to Aug 2023, discarding its entire 2021-2022 window (crash included) from
ever being counted as an episode, even though that window's prices were
still being used as lookback for LATER days. Fixed with _MIN_LOOKBACK_DAYS
(~6 real months): a day is classified once it has at least that much real
trailing history, using whatever's available up to _TRAILING_WINDOW_DAYS —
a real bootstrap period at the start of the series instead of a silent
multi-year blind spot.
"""

from __future__ import annotations

import statistics
from typing import Optional

_MIN_REAL_DAYS = 250  # ~1 real trading year — never build a "percentile" claim off less
_MIN_EPISODES_PER_BUCKET = 2  # AlphaSpread's own real backtest shows buckets with as few as 2 real episodes
_FORWARD_TRADING_DAYS = 252  # ~1 real trading year ahead, index-based (no new API calls)
# ~2 real trading years of trailing lookback for the rolling tercile bands
# (see module docstring's 3rd note) — long enough to span more than one
# quarter's noise, short enough that a single multi-year secular cycle
# doesn't dominate every classification the way a whole-period static band
# does.
_TRAILING_WINDOW_DAYS = 504
# Diego, 2026-09-01 — 6th real finding, caught by Diego's own concrete
# example ("si comprabas META el 4 de nov de 2022..."): requiring a FULL
# _TRAILING_WINDOW_DAYS of history before classifying a single day meant
# the first ~2 real years of every ticker's window (for META: all of
# 2021-2022, INCLUDING the Nov 2022 crash bottom and the entire 2023
# recovery — the single most dramatic real "cheap -> huge return" episode
# in its history) were used only as lookback data and never classified,
# never counted as their own episode. Fixed by classifying every day once
# it has at least _MIN_LOOKBACK_DAYS of real history behind it (using
# whatever's available up to _TRAILING_WINDOW_DAYS, not requiring the full
# window) — a real bootstrap period, not a silent blind spot.
_MIN_LOOKBACK_DAYS = 126  # ~6 real trading months — enough to split into 3 real terciles


def build_daily_ttm_records(ticker: str) -> Optional[list[tuple[str, float, float]]]:
    """The real (date, price, ttm_eps) backbone shared by both this
    module's percentile/backtest panel and the price-vs-fair-value chart
    (see company_diagnostic_service.py) — extracted so both consumers
    reuse the same real quarterly-EPS + daily-price fetch instead of
    hitting financial_data_service twice for the same ticker. Returns
    None under the same real-data-depth conditions the callers already
    documented (fewer than 4 real quarters, fewer than 4 real TTM
    checkpoints, or under _MIN_REAL_DAYS of real (price, TTM EPS) pairs)."""
    from app.services.financial_data_service import get_quarterly_eps_history, get_daily_price_history
    from datetime import date

    quarters = get_quarterly_eps_history(ticker)
    if len(quarters) < 4:
        return None

    # Real TTM checkpoints: from the 4th quarter onward, sum that quarter
    # and its 3 real predecessors, effective the day the market actually
    # saw that number (filing_date) — a real step function, not a smooth
    # estimate.
    checkpoints: list[tuple[str, float]] = []  # (filing_date, ttm_eps), sorted ascending
    for i in range(3, len(quarters)):
        window = quarters[i - 3 : i + 1]
        ttm = sum(q["eps"] for q in window)
        checkpoints.append((quarters[i]["filing_date"], ttm))
    if len(checkpoints) < 4:
        return None
    from bisect import bisect_right

    checkpoint_dates = [c[0] for c in checkpoints]
    current_ttm_eps = checkpoints[-1][1]
    if current_ttm_eps is None or current_ttm_eps <= 0:
        return None

    today = date.today().isoformat()
    prices = get_daily_price_history(ticker, checkpoints[0][0], today)
    if len(prices) < _MIN_REAL_DAYS:
        return None

    # Real (date, price, ttm_eps) series, skipping any day before the
    # first real TTM checkpoint exists (bisect_right - 1 < 0).
    daily_records: list[tuple[str, float, float]] = []  # (date, price, ttm_eps)
    for row in prices:
        idx = bisect_right(checkpoint_dates, row["date"]) - 1
        if idx < 0:
            continue
        ttm_eps = checkpoints[idx][1]
        if ttm_eps is None or ttm_eps <= 0 or row["price"] is None:
            continue
        daily_records.append((row["date"], row["price"], ttm_eps))

    if len(daily_records) < _MIN_REAL_DAYS:
        return None
    return daily_records


def compute_daily_price_history_context(
    daily_records: Optional[list[tuple[str, float, float]]], current_price: Optional[float]
) -> Optional[dict]:
    """Returns None (never a fabricated percentile) when `daily_records`
    (from build_daily_ttm_records) is None or current_price is
    unavailable. Today's own P/E is built from the SAME real quarterly-TTM
    mechanism as the rest of the daily series (the latest real checkpoint)
    rather than a separately-sourced annual EPS, so "today" and "history"
    are never apples-to-oranges."""
    if not current_price or not daily_records:
        return None

    current_ttm_eps = daily_records[-1][2]
    if current_ttm_eps is None or current_ttm_eps <= 0:
        return None

    today_pe = current_price / current_ttm_eps
    pe_values = [r[1] / r[2] for r in daily_records]
    percentile_cheaper_than = round(sum(1 for v in pe_values if v > today_pe) / len(pe_values) * 100, 0)

    def rolling_tercile(pe: float, lookback_pes: list[float]) -> str:
        """Classifies `pe` against the real distribution of the ~2 trading
        years right before it, not the whole fixed period — see module
        docstring's 3rd note on why a static whole-window band mislabels
        "cheap" days that are really still mid-decline."""
        sorted_lb = sorted(lookback_pes)
        n = len(sorted_lb)
        lo_cut = sorted_lb[n // 3]
        hi_cut = sorted_lb[(2 * n) // 3]
        if pe <= lo_cut:
            return "cheap"
        if pe >= hi_cut:
            return "expensive"
        return "normal"

    if len(daily_records) < _MIN_LOOKBACK_DAYS + _MIN_EPISODES_PER_BUCKET:
        return None
    today_bucket = rolling_tercile(today_pe, pe_values[-min(_TRAILING_WINDOW_DAYS, len(pe_values)) :])

    # Classify every real eligible day — needs at least _MIN_LOOKBACK_DAYS
    # of real trailing history (using whatever's available up to
    # _TRAILING_WINDOW_DAYS, not requiring the full window; see 6th
    # docstring note — a hard requirement of the full window silently
    # excluded a ticker's earliest ~2 real years, its own crash/recovery
    # included, from ever being classified) — then segment into
    # CONTIGUOUS same-zone runs, each one real, independent episode,
    # exactly the way AlphaSpread's own published methodology describes it
    # ("a long stay in a range counts once"). See module docstring's 5th
    # note.
    price_by_index = [r[1] for r in daily_records]
    daily_zones: list[tuple[int, str, float, str]] = []  # (index, date, price, zone)
    for i in range(_MIN_LOOKBACK_DAYS, len(daily_records)):
        d, price, ttm_eps = daily_records[i]
        pe = price / ttm_eps
        lookback = pe_values[max(0, i - _TRAILING_WINDOW_DAYS) : i]
        daily_zones.append((i, d, price, rolling_tercile(pe, lookback)))

    buckets: dict[str, dict] = {
        "cheap": {"returns": [], "higher": 0},
        "normal": {"returns": [], "higher": 0},
        "expensive": {"returns": [], "higher": 0},
    }
    j = 0
    while j < len(daily_zones):
        zone = daily_zones[j][3]
        k = j
        while k + 1 < len(daily_zones) and daily_zones[k + 1][3] == zone:
            k += 1
        # Diego, 2026-09-01 — caught with his own real example: "si
        # comprabas META el 4 de nov de 2022, hubieras obtenido una
        # rentabilidad brutal". Anchoring an episode's return to its FIRST
        # day only was wrong for a long episode: META's real 2022-01-27 ->
        # 2023-01-19 "cheap" episode started at $294.64 (before the real
        # crash even hit) and its entry-day-only return (-50.1%) completely
        # hid that most of the days INSIDE that same stretch — including
        # the real Nov 2022 bottom around $88 — went on to huge real
        # 1-year gains. Fixed by using every real day inside the episode
        # for the return calc (this episode still counts as ONE
        # independent unit for n/independence — no autocorrelation
        # regression — but its representative return is now the median of
        # its own real days' forward returns, and "higher 1 year later" is
        # a majority vote across those same real days).
        episode_returns: list[float] = []
        higher_days = 0
        for m in range(j, k + 1):
            day_idx, _day_date, day_price, _ = daily_zones[m]
            fwd_i = day_idx + _FORWARD_TRADING_DAYS
            if fwd_i < len(price_by_index):
                fwd_price = price_by_index[fwd_i]
                episode_returns.append((fwd_price - day_price) / day_price * 100)
                if fwd_price > day_price:
                    higher_days += 1
        if episode_returns:
            buckets[zone]["returns"].append(statistics.median(episode_returns))
            if higher_days > len(episode_returns) / 2:
                buckets[zone]["higher"] += 1
        j = k + 1

    result_buckets = {}
    for key, bdata in buckets.items():
        count = len(bdata["returns"])
        if count < _MIN_EPISODES_PER_BUCKET:
            result_buckets[key] = None
        else:
            result_buckets[key] = {
                # Real distinct-episode count (see 5th docstring note) —
                # named days_count for API/frontend continuity, but each
                # unit here is one contiguous real episode, not one day.
                "days_count": count,
                "times_price_higher_1y_later": bdata["higher"],
                "median_forward_return_pct": round(statistics.median(bdata["returns"]), 1),
            }

    return {
        "percentile_cheaper_than": percentile_cheaper_than,
        "days_used": len(daily_records),
        "today_bucket": today_bucket,
        "buckets": result_buckets,
    }


_CHART_MAX_POINTS = 260  # ~weekly resolution over the real ~5-year window — enough to render a smooth line, small enough for a JSON payload


def compute_fair_value_chart_series(
    daily_records: Optional[list[tuple[str, float, float]]],
    base_fair_value: Optional[float],
    *,
    earnings_track_multiple: Optional[float] = None,
    earnings_track_weight_pct: Optional[float] = None,
    fcf_track_value: Optional[float] = None,
    fcf_track_weight_pct: Optional[float] = None,
) -> Optional[dict]:
    """Real price vs. fair-value line, over the same real ~5-year window as
    build_daily_ttm_records — Diego, 2026-09-03, matching the validated
    Artifact's "Precio real vs. valor razonable" chart.

    Diego, 2026-09-03 (same day, caught after full-replacement shipped) —
    first version multiplied a single constant "effective multiple"
    (base_fair_value ÷ today's TTM EPS) against every historical day's real
    TTM EPS. That was fine when base_fair_value was pure P/E-on-earnings,
    but base_fair_value is now the dual-track BLEND (earnings track + FCF/
    DCF recovery track) — the FCF track doesn't move proportionally with
    trailing EPS at all (it's a normalized-margin recovery projection, not
    an earnings multiple), so smearing the whole blended number across raw
    historical EPS distorted the real shape: a year where EPS dipped hard
    but free cash flow stayed comparatively stable would show a much
    deeper "fair value crash" than the real dual-track methodology would
    ever have produced.

    Fixed by reconstructing each historical day as the SAME weighted
    combination used for today's real number — the earnings-track portion
    scaled by real historical TTM EPS (this part's shape is still real:
    `earnings_track_multiple` is the real fair-P/E-based multiple already
    computed for today, same technique as before), and the FCF-track
    portion held at today's real dollar value (no real historical
    quarterly-FCF-per-share series is reconstructed here, so treating it
    as roughly time-invariant is far more honest than incorrectly
    smearing it across an EPS multiplier it has nothing to do with — the
    DCF recovery track is itself built around a normalized, not a trailing,
    margin, so it's a slower-moving anchor by design). The whole series is
    then uniformly rescaled so "today" lands exactly on the real
    base_fair_value shown elsewhere on the screen — same disclosed
    calibration trick as before, just applied to a shape that's now
    actually consistent with how the real number is built.

    Falls back to the original single-multiple-on-EPS reconstruction when
    the dual-track breakdown isn't available (ticker where the dual-track
    wasn't computable — REIT, negative EPS, etc. — base_fair_value is then
    the honest single P/E-only number, and that simpler method is already
    correct for it).

    Returns None under the same real-data conditions build_daily_ttm_
    records already documents, or when base_fair_value is unavailable."""
    if not daily_records or not base_fair_value or base_fair_value <= 0:
        return None

    current_ttm_eps = daily_records[-1][2]
    if current_ttm_eps is None or current_ttm_eps <= 0:
        return None

    _dual_track_usable = (
        earnings_track_multiple is not None
        and earnings_track_weight_pct is not None
        and fcf_track_value is not None
        and fcf_track_weight_pct is not None
    )

    if _dual_track_usable:
        we = earnings_track_weight_pct / 100
        wf = fcf_track_weight_pct / 100

        def _raw(ttm_eps: float) -> float:
            return we * earnings_track_multiple * ttm_eps + wf * fcf_track_value
    else:
        _flat_multiple = base_fair_value / current_ttm_eps

        def _raw(ttm_eps: float) -> float:
            return _flat_multiple * ttm_eps

    raw_today = _raw(current_ttm_eps)
    if not raw_today or raw_today <= 0:
        return None
    calibration = base_fair_value / raw_today

    stride = max(1, len(daily_records) // _CHART_MAX_POINTS)
    sampled = daily_records[::stride]
    if sampled[-1] is not daily_records[-1]:
        sampled = sampled + [daily_records[-1]]

    points = [
        {
            "date": d,
            "price": round(price, 2),
            "fairValue": round(_raw(ttm_eps) * calibration, 2),
        }
        for d, price, ttm_eps in sampled
    ]

    return {
        "points": points,
        "effective_multiple": round(base_fair_value / current_ttm_eps, 1),
        "current_ttm_eps": round(current_ttm_eps, 2),
    }
