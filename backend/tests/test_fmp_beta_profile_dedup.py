"""
2026-11-10, FMP pressure fix — root cause B: get_beta() and
get_company_profile_fmp() both hit FMP's SAME /profile endpoint for the
same ticker; get_company_profile_fmp cached its result 7 days but
discarded `beta`, and get_beta had no cache at all, so a full-diagnostic
build paid for /profile twice. Fix: one shared parse+cache helper
(_parse_and_cache_fmp_profile), one shared cache key, `beta` added to the
cached shape. These tests confirm the dedup, the explicit freshness
policy (a week-old beta is reused, never silently refetched), and that a
genuinely-missing beta still falls through to a real request rather than
being fabricated.
"""
from unittest.mock import Mock, patch

import app.services.financial_data_service as fds


def _clear_cache():
    import app.core.cache as cache_mod
    cache_mod._mem.clear()


def _fmp_profile_response(beta=1.25):
    return [{
        "companyName": "Acme Corp",
        "sector": "Industrials",
        "exchangeFullName": "NYSE",
        "sharesOutstanding": 500_000_000,
        "marketCap": 50_000_000_000,
        "beta": beta,
    }]


def test_get_beta_reuses_get_company_profile_fmps_cached_response_without_a_second_call():
    """The exact dedup this fix is for: get_company_profile_fmp runs
    first (as it does in get_fundamental_analysis's Finnhub-profile-
    missing fallback path), then get_beta must read beta straight out of
    that SAME cache entry — zero additional HTTP calls."""
    _clear_cache()
    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        mock_response = Mock()
        mock_response.json.return_value = _fmp_profile_response(beta=1.25)
        with patch("requests.get", return_value=mock_response) as mock_get:
            profile = fds.get_company_profile_fmp("ACME")
            assert profile["name"] == "Acme Corp"
            assert mock_get.call_count == 1

        # get_beta must NOT call requests.get again — same cached entry.
        with patch("requests.get") as mock_get_2:
            beta = fds.get_beta("ACME")
        mock_get_2.assert_not_called()
        assert beta == 1.25


def test_get_company_profile_fmp_reuses_get_betas_cached_response_in_the_other_call_order():
    """Order-independent: if get_beta happens to run FIRST for a given
    ticker, get_company_profile_fmp must still get a cache hit afterward
    (and the real before/after beta value must be identical — same
    underlying payload, just not re-fetched)."""
    _clear_cache()
    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        mock_response = Mock()
        mock_response.json.return_value = _fmp_profile_response(beta=0.87)
        with patch("requests.get", return_value=mock_response) as mock_get:
            beta_before = fds.get_beta("ACME")
            assert mock_get.call_count == 1

        with patch("requests.get") as mock_get_2:
            profile = fds.get_company_profile_fmp("ACME")
        mock_get_2.assert_not_called()

        # Same underlying FMP payload either way — beta must be identical,
        # not just "close enough."
        beta_after = fds.get_beta("ACME")
        assert beta_after == beta_before == 0.87
        assert profile["name"] == "Acme Corp"


def test_beta_cache_entry_from_before_this_fix_falls_through_to_a_real_request():
    """A profile cached before `beta` was added to the shape (or a real
    FMP response that genuinely had no beta) must not be silently treated
    as "beta is None forever" — get_beta falls through to one real
    request rather than fabricating or permanently giving up."""
    _clear_cache()
    import app.core.cache as cache_mod
    # Simulate a pre-fix cache entry: no "beta" key at all.
    cache_mod.cache_set(fds._fmp_profile_cache_key("OLDCO"), {
        "name": "Old Co", "finnhubIndustry": "Energy", "exchange": "NYSE",
        "shareOutstanding": 100.0, "marketCapitalization": 1000.0,
    }, ttl=7 * 24 * 3600)

    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        mock_response = Mock()
        mock_response.json.return_value = _fmp_profile_response(beta=1.5)
        with patch("requests.get", return_value=mock_response) as mock_get:
            beta = fds.get_beta("OLDCO")
        mock_get.assert_called_once()
    assert beta == 1.5


def test_get_beta_returns_none_without_fabricating_when_fmp_genuinely_has_no_beta():
    """Safe fallback preserved: no cache entry, real request succeeds but
    FMP's response has beta=None — must return None, never 0 or a made-up
    number."""
    _clear_cache()
    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        mock_response = Mock()
        mock_response.json.return_value = _fmp_profile_response(beta=None)
        with patch("requests.get", return_value=mock_response):
            beta = fds.get_beta("NOBETA")
    assert beta is None


def test_get_beta_returns_none_when_fmp_request_itself_fails():
    _clear_cache()
    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        with patch("requests.get", side_effect=Exception("timeout")):
            beta = fds.get_beta("BROKEN")
    assert beta is None


def test_get_beta_respects_the_shared_fmp_budget():
    """Still gated by fmp_call_allowed() on an actual cache miss — the
    dedup must not accidentally bypass the budget check."""
    import app.core.fmp_budget as fb

    _clear_cache()
    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        for _ in range(fb.FMP_LIMIT_PER_MINUTE):
            fb.fmp_call_allowed()
        with patch("requests.get") as mock_get:
            beta = fds.get_beta("BLOCKED")
    mock_get.assert_not_called()
    assert beta is None


def test_beta_for_the_wrong_ticker_is_never_reused():
    """Each ticker has its own cache key — a cached profile for one
    symbol must never leak its beta into a lookup for a different
    symbol."""
    _clear_cache()
    with patch("app.services.financial_data_service.FMP_KEY", "fake-key"):
        mock_response = Mock()
        mock_response.json.return_value = _fmp_profile_response(beta=2.0)
        with patch("requests.get", return_value=mock_response):
            fds.get_company_profile_fmp("TICKER_A")

        mock_response_b = Mock()
        mock_response_b.json.return_value = _fmp_profile_response(beta=0.4)
        with patch("requests.get", return_value=mock_response_b) as mock_get_b:
            beta_b = fds.get_beta("TICKER_B")
    mock_get_b.assert_called_once()  # different symbol — genuine cache miss
    assert beta_b == 0.4
