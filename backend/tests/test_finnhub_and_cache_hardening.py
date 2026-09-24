from types import SimpleNamespace
from unittest.mock import patch

from app.core import cache, finnhub


def _resp(status, payload=None):
    return SimpleNamespace(status_code=status, json=lambda: payload or {})


def test_path_is_skipped_only_after_three_consecutive_403s():
    finnhub._forbidden_paths.clear(); finnhub._forbidden_counts.clear()
    with patch.object(finnhub, "_key", return_value="k"), patch.object(finnhub.httpx, "get", return_value=_resp(403)) as get:
        for _ in range(3):
            assert finnhub._get("/stock/price-target", {"symbol": "X"}) is None
        assert get.call_count == 3
        assert finnhub._get("/stock/price-target", {"symbol": "X"}) is None
        assert get.call_count == 3            # 4th call never hit the network
    finnhub._forbidden_paths.clear(); finnhub._forbidden_counts.clear()


def test_a_success_resets_the_403_strikes_and_other_paths_are_unaffected():
    finnhub._forbidden_paths.clear(); finnhub._forbidden_counts.clear()
    seq = [_resp(403), _resp(403), _resp(200, {"c": 1}), _resp(403), _resp(403)]
    with patch.object(finnhub, "_key", return_value="k"), patch.object(finnhub.httpx, "get", side_effect=seq):
        for _ in range(5):
            finnhub._get("/quote", {"symbol": "X"})
    assert "/quote" not in finnhub._forbidden_paths
    finnhub._forbidden_paths.clear(); finnhub._forbidden_counts.clear()


def test_redis_reconnect_is_throttled_when_unreachable():
    cache._redis = None; cache._redis_retry_at = 0.0
    attempts = []
    import redis as redis_lib

    class Boom(Exception): ...
    def bad_pool(*a, **k): attempts.append(1); raise Boom("Name or service not known")

    with patch("app.core.config.settings", SimpleNamespace(redis_url="redis://nowhere:6379")), \
         patch.object(redis_lib.BlockingConnectionPool, "from_url", side_effect=bad_pool):
        for _ in range(50):
            assert cache._get_redis() is None
    assert len(attempts) == 1                  # 49 later calls reused the "unavailable" answer
    cache._redis = None; cache._redis_retry_at = 0.0
