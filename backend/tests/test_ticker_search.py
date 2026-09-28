"""
Diego, 2026-09-27: type-ahead in the Nuvos Radar search bar. search_local
must surface the right company from a partial ticker or name, biggest
companies first (the SEC list order is the popularity rank).
"""
from unittest.mock import patch

from app.services import ticker_search as ts

_ROWS = [
    {"ticker": "NVDA", "name": "Nvidia Corp"},
    {"ticker": "AAPL", "name": "Apple Inc."},
    {"ticker": "KO", "name": "Coca Cola Co"},
    {"ticker": "APLE", "name": "Apple Hospitality Reit, Inc."},
    {"ticker": "MELI", "name": "Mercadolibre Inc"},
    {"ticker": "BRK-B", "name": "Berkshire Hathaway Inc"},
]


def _universe():
    rows = [dict(r) for r in _ROWS]
    for i, r in enumerate(rows):
        r["_rank"] = i
        r["_name"] = ts._norm(r["name"])
        r["_tick"] = r["ticker"].replace("-", "").replace(".", "")
    return rows


def _search(q):
    with patch.object(ts, "_load_universe", _universe):
        return [r["ticker"] for r in ts.search_local(q, 5)]


def test_partial_ticker():
    assert _search("nvd") == ["NVDA"]


def test_name_prefix_biggest_first():
    assert _search("apple")[:2] == ["AAPL", "APLE"]


def test_punctuation_and_accents_are_ignored():
    assert _search("coca-cola") == ["KO"]
    assert _search("mercadolíbre") == ["MELI"]


def test_class_share_ticker_without_separator():
    assert _search("brkb") == ["BRK-B"]


def test_empty_query():
    assert _search("  ") == []
