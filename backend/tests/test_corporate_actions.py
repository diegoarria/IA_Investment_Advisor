"""Stock splits applied automatically, never twice, never to lots typed in
after the split (2026-09-29)."""
from app.services.corporate_actions import apply_split_to_positions

SPLIT = {"date": "2026-09-20", "ratio": 10.0}


def test_adjusts_lots_registered_before_split():
    lots = [{"ticker": "NVDA", "shares": 2, "avgPrice": 1000, "created_at": "2026-09-01T00:00:00Z"},
            {"ticker": "AAPL", "shares": 5, "avgPrice": 100, "created_at": "2026-09-01T00:00:00Z"}]
    out, n = apply_split_to_positions(lots, "NVDA", SPLIT, None)
    assert n == 1
    assert out[0]["shares"] == 20 and out[0]["avgPrice"] == 100
    assert out[1] == lots[1]
    # cost basis unchanged
    assert out[0]["shares"] * out[0]["avgPrice"] == 2 * 1000


def test_idempotent():
    lots = [{"ticker": "NVDA", "shares": 2, "avgPrice": 1000, "created_at": "2026-09-01"}]
    once, _ = apply_split_to_positions(lots, "NVDA", SPLIT, None)
    twice, n = apply_split_to_positions(once, "NVDA", SPLIT, None)
    assert n == 0 and twice[0]["shares"] == 20


def test_lot_registered_after_split_untouched():
    lots = [{"ticker": "NVDA", "shares": 20, "avgPrice": 100, "created_at": "2026-09-25", "purchaseDate": "2026-01-01"}]
    out, n = apply_split_to_positions(lots, "NVDA", SPLIT, None)
    assert n == 0 and out[0]["shares"] == 20


def test_legacy_lot_only_if_portfolio_not_written_since():
    lot = {"ticker": "NVDA", "shares": 2, "avgPrice": 1000, "purchaseDate": "2026-01-01"}
    _, n1 = apply_split_to_positions([lot], "NVDA", SPLIT, "2026-09-10T00:00:00Z")
    _, n2 = apply_split_to_positions([lot], "NVDA", SPLIT, "2026-09-22T00:00:00Z")
    assert n1 == 1 and n2 == 0
