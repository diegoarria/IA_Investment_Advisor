import math
from unittest.mock import patch

from app.services.price_history_context_service import (
    build_daily_ttm_records,
    compute_daily_price_history_context,
    _MIN_REAL_DAYS,
    _MIN_EPISODES_PER_BUCKET,
    _FORWARD_TRADING_DAYS,
    _TRAILING_WINDOW_DAYS,
)


def _context_for(ticker, current_price):
    """Test helper mirroring the real two-step call now used by
    fundamental_analysis_service.py: build the raw records once, then
    compute the percentile/bucket context from them."""
    records = build_daily_ttm_records(ticker)
    return compute_daily_price_history_context(records, current_price)


def _synthetic_quarters(n=8, base_eps=0.5, start="2024-01-31"):
    """n quarters, one real filing per quarter, evenly spaced ~90 days
    apart, each with a slightly different real EPS so TTM checkpoints
    aren't all identical."""
    import datetime as dt

    y, m, d = (int(p) for p in start.split("-"))
    cur = dt.date(y, m, d)
    quarters = []
    for i in range(n):
        filing = cur + dt.timedelta(days=15)
        quarters.append({"date": cur.isoformat(), "filing_date": filing.isoformat(), "eps": base_eps + i * 0.02})
        cur = cur + dt.timedelta(days=91)
    return quarters


def _synthetic_daily_prices(n_days, start, price_fn):
    import datetime as dt

    y, m, d = (int(p) for p in start.split("-"))
    cur = dt.date(y, m, d)
    rows = []
    for i in range(n_days):
        rows.append({"date": cur.isoformat(), "price": price_fn(i)})
        cur = cur + dt.timedelta(days=1)
    return rows


def test_none_when_no_current_price():
    assert compute_daily_price_history_context(None, None) is None


def test_none_when_too_few_quarters():
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=_synthetic_quarters(2)):
        assert _context_for("TEST", 100.0) is None


def test_none_when_too_few_daily_rows():
    quarters = _synthetic_quarters(8)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=_synthetic_daily_prices(10, quarters[0]["filing_date"], lambda i: 50.0)):
        assert _context_for("TEST", 100.0) is None


def test_real_percentile_and_buckets_with_enough_data():
    quarters = _synthetic_quarters(8)
    # Real production code fetches daily prices starting at the FIRST real
    # TTM checkpoint (the 4th quarter's filing_date, not the 1st quarter's)
    # — mirror that here, otherwise the synthetic series is mostly before
    # any checkpoint exists and gets dropped.
    first_checkpoint_date = quarters[3]["filing_date"]
    n_days = _MIN_REAL_DAYS + _FORWARD_TRADING_DAYS + 50
    # Rising price series so today's (last) price is the highest -> today
    # should rank as "expensive" (P/E highest of the whole series, since
    # TTM EPS is roughly flat/slowly rising while price steadily climbs).
    prices = _synthetic_daily_prices(n_days, first_checkpoint_date, lambda i: 50.0 + i * 0.05)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=prices):
        result = _context_for("TEST", prices[-1]["price"])

    assert result is not None
    assert result["days_used"] >= _MIN_REAL_DAYS
    assert 0 <= result["percentile_cheaper_than"] <= 100
    assert result["today_bucket"] in ("cheap", "normal", "expensive")
    # A steadily rising price series -> today's P/E is the highest ever ->
    # cheaper-than-today % should be low (today is expensive vs. its own history).
    assert result["percentile_cheaper_than"] < 20
    assert result["today_bucket"] == "expensive"
    for bucket in result["buckets"].values():
        if bucket is not None:
            assert bucket["days_count"] >= _MIN_EPISODES_PER_BUCKET
            assert bucket["times_price_higher_1y_later"] <= bucket["days_count"]


def test_bucket_hidden_when_series_is_a_single_monotonic_trend():
    """Diego, 2026-09-01 — after switching from fixed-interval sampling to
    contiguous-run episode segmentation (grouping every real run of
    consecutive same-zone days into ONE episode, matching AlphaSpread's own
    "a long stay in a range counts once" methodology), a monotonic ramp with
    no real reversals produces at most ONE real episode per zone it passes
    through — never enough to clear _MIN_EPISODES_PER_BUCKET on its own,
    since a single trend is genuinely one real event, not independent
    evidence repeated many times."""
    quarters = _synthetic_quarters(8)
    first_checkpoint_date = quarters[3]["filing_date"]
    n_days = _MIN_REAL_DAYS + _FORWARD_TRADING_DAYS + 50
    prices = _synthetic_daily_prices(n_days, first_checkpoint_date, lambda i: 50.0 + i * 0.05)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=prices):
        result = _context_for("TEST", prices[-1]["price"])

    assert result is not None
    assert all(b is None for b in result["buckets"].values())


def test_bucket_shown_when_series_has_multiple_real_episodes():
    """A long enough, genuinely oscillating real series (not one straight
    trend) crosses tercile boundaries repeatedly, producing multiple real,
    distinct contiguous episodes per zone — episode segmentation shouldn't
    silence buckets that DO have real independent-episode evidence behind
    them."""
    quarters = _synthetic_quarters(30, start="2019-01-31")  # ~7.5 real years of quarters
    first_checkpoint_date = quarters[3]["filing_date"]
    n_days = _TRAILING_WINDOW_DAYS + _FORWARD_TRADING_DAYS + 1300  # several real oscillations

    def price_fn(i):
        # Mild uptrend + a real oscillation SHORTER than the rolling
        # _TRAILING_WINDOW_DAYS lookback, so the rolling tercile band
        # doesn't just drift along with a single slow cycle (a period
        # longer than the trailing window "chases" the trend and never
        # produces a real boundary crossing) — several real full cycles
        # happen inside every trailing window, giving genuine, repeated
        # zone crossings at different calendar times.
        return 100.0 + i * 0.03 + 25.0 * math.sin(i / 40.0)

    prices = _synthetic_daily_prices(n_days, first_checkpoint_date, price_fn)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=prices):
        result = _context_for("TEST", prices[-1]["price"])

    assert result is not None
    assert any(b is not None for b in result["buckets"].values())


def test_none_when_insufficient_quarters_for_ttm():
    # 3 quarters can never form a real trailing-4-quarter checkpoint.
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=_synthetic_quarters(3)):
        assert _context_for("TEST", 100.0) is None


def test_fair_value_chart_series_calibrates_todays_point_to_base_fair_value():
    """Diego, 2026-09-03 — "quiero el chart... para saber si cotizó cara,
    barata o como": the fair-value line's last point must land exactly on
    base_fair_value (today's real production number), and every other
    point must equal that same constant effective multiple applied to that
    day's own real TTM EPS."""
    from app.services.price_history_context_service import compute_fair_value_chart_series

    quarters = _synthetic_quarters(8)
    first_checkpoint_date = quarters[3]["filing_date"]
    n_days = _MIN_REAL_DAYS + 20
    prices = _synthetic_daily_prices(n_days, first_checkpoint_date, lambda i: 50.0 + i * 0.05)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=prices):
        records = build_daily_ttm_records("TEST")

    assert records is not None
    result = compute_fair_value_chart_series(records, base_fair_value=200.0)

    assert result is not None
    assert result["points"][-1]["fairValue"] == 200.0
    assert result["points"][0]["date"] == records[0][0]
    assert result["points"][-1]["date"] == records[-1][0]
    expected_multiple = 200.0 / records[-1][2]
    assert abs(result["effective_multiple"] - round(expected_multiple, 1)) < 0.05
    ttm_eps_by_date = {d: ttm_eps for d, _price, ttm_eps in records}
    for p in result["points"]:
        assert abs(p["fairValue"] - round(expected_multiple * ttm_eps_by_date[p["date"]], 2)) < 0.01


def test_fair_value_chart_series_none_without_base_fair_value():
    quarters = _synthetic_quarters(8)
    first_checkpoint_date = quarters[3]["filing_date"]
    prices = _synthetic_daily_prices(_MIN_REAL_DAYS + 20, first_checkpoint_date, lambda i: 50.0)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=prices):
        records = build_daily_ttm_records("TEST")

    from app.services.price_history_context_service import compute_fair_value_chart_series

    assert compute_fair_value_chart_series(records, None) is None
    assert compute_fair_value_chart_series(None, 100.0) is None


def test_fair_value_chart_series_weighted_reconstruction_uses_dual_track_breakdown():
    """Diego, 2026-09-03 (caught right after full-replacement shipped) —
    with the dual-track breakdown supplied, each historical point must be
    the REAL weighted combination (earnings-track multiple × that day's
    real TTM EPS, plus the FCF track held at today's real dollar value),
    not a single multiple smeared across raw EPS — and "today" must still
    land exactly on base_fair_value regardless of any mismatch between the
    earnings-track multiple/EPS and the flat fallback multiple."""
    from app.services.price_history_context_service import compute_fair_value_chart_series

    quarters = _synthetic_quarters(8)
    first_checkpoint_date = quarters[3]["filing_date"]
    n_days = _MIN_REAL_DAYS + 20
    prices = _synthetic_daily_prices(n_days, first_checkpoint_date, lambda i: 50.0 + i * 0.05)
    with patch("app.services.financial_data_service.get_quarterly_eps_history", return_value=quarters), \
         patch("app.services.financial_data_service.get_daily_price_history", return_value=prices):
        records = build_daily_ttm_records("TEST")

    assert records is not None
    earnings_multiple = 15.0
    fcf_track_value = 120.0
    we, wf = 0.6, 0.4
    base_fair_value = we * earnings_multiple * records[-1][2] + wf * fcf_track_value

    result = compute_fair_value_chart_series(
        records, base_fair_value,
        earnings_track_multiple=earnings_multiple, earnings_track_weight_pct=we * 100,
        fcf_track_value=fcf_track_value, fcf_track_weight_pct=wf * 100,
    )

    assert result is not None
    assert abs(result["points"][-1]["fairValue"] - base_fair_value) < 0.01
    ttm_eps_by_date = {d: ttm_eps for d, _price, ttm_eps in records}
    for p in result["points"]:
        expected = we * earnings_multiple * ttm_eps_by_date[p["date"]] + wf * fcf_track_value
        assert abs(p["fairValue"] - round(expected, 2)) < 0.02
    # The FCF-anchored reconstruction must differ from the naive flat-
    # multiple-on-EPS one whenever the FCF track carries real weight — a
    # regression back to the old bug would make these identical.
    flat_result = compute_fair_value_chart_series(records, base_fair_value)
    assert flat_result is not None
    assert result["points"][0]["fairValue"] != flat_result["points"][0]["fairValue"]
