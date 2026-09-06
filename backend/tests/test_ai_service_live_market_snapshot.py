"""
Test — app.services.ai_service.build_live_market_snapshot.

Section 34 final-audit fix: this function used to compute per-position
market value / unrealized P&L with its OWN inline arithmetic, a second
implementation of the exact same formula
`decision_engine.compute_portfolio_truth` already provides (including a
real divergence: this function defaulted P&L% to 0 on a zero cost basis,
while PositionTruth leaves it as None). Refactored to build on
compute_portfolio_truth instead of duplicating the math — this test locks
in that the visible text format is unchanged for the caller (chat_stream's
prompt), even though the calculation path is now shared.
"""
from app.services.ai_service import build_live_market_snapshot


def test_live_market_snapshot_reports_correct_pnl_and_value():
    positions = [{"ticker": "NVDA", "shares": 10, "avg_price": 100.0}]
    quotes = {"NVDA": {"price": 150.0}}
    text = build_live_market_snapshot(positions, [], quotes)
    assert text is not None
    assert "NVDA" in text
    assert "$150.00" in text
    assert "valor ≈$1,500" in text
    assert "+$500" in text
    assert "+50.0%" in text


def test_live_market_snapshot_omits_position_without_a_quote():
    # A position with no live quote available must not appear with a fake
    # price or P&L — same "never invent" discipline as everywhere else.
    positions = [
        {"ticker": "NVDA", "shares": 10, "avg_price": 100.0},
        {"ticker": "OBSCURE", "shares": 5, "avg_price": 20.0},
    ]
    quotes = {"NVDA": {"price": 150.0}}
    text = build_live_market_snapshot(positions, [], quotes)
    assert "NVDA" in text
    assert "OBSCURE" not in text


def test_live_market_snapshot_watchlist_rendering_unchanged():
    watchlist = [{"ticker": "TSLA"}]
    quotes = {"TSLA": {"price": 300.0, "change_pct": 2.5}}
    text = build_live_market_snapshot([], watchlist, quotes)
    assert "TSLA: $300.00 (+2.50% hoy)" in text


def test_live_market_snapshot_returns_none_with_no_quotes():
    assert build_live_market_snapshot([{"ticker": "NVDA", "shares": 1, "avg_price": 1.0}], [], {}) is None
    assert build_live_market_snapshot([], [], None) is None
