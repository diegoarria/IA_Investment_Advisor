"""
Tests — app.services.undervalued_screener_service._diverse_bootstrap_sample.

Regression test for a real production bug: once screener.py's UNIVERSE
became the real S&P 500 list (grouped and sorted alphabetically by sector),
the emergency cold-cache bootstrap (`UNIVERSE[:_BOOTSTRAP_LIMIT]`) silently
returned only "Communication Services" tickers — that sector sorts first
alphabetically — instead of a real cross-sector sample. Users saw the same
handful of Communication Services names every time the cache went cold.
"""
from app.services.undervalued_screener_service import _diverse_bootstrap_sample


def _entry(ticker: str, sector: str) -> dict:
    return {"ticker": ticker, "name": ticker, "sector": sector, "industry": "X"}


def _fake_universe() -> list[dict]:
    # Alphabetically-sorted-by-sector, exactly like the real UNIVERSE —
    # Communication Services first, with far more entries than any other
    # sector, mirroring the real skew that triggered the bug.
    universe = [_entry(f"COMM{i}", "Communication Services") for i in range(30)]
    universe += [_entry(f"FIN{i}", "Financials") for i in range(10)]
    universe += [_entry(f"HC{i}", "Healthcare") for i in range(10)]
    universe += [_entry(f"TECH{i}", "Technology") for i in range(10)]
    return universe


class TestDiverseBootstrapSample:
    def test_prefix_slice_would_have_been_a_single_sector_bug(self):
        universe = _fake_universe()
        naive_prefix = universe[:20]
        assert {e["sector"] for e in naive_prefix} == {"Communication Services"}

    def test_samples_across_every_sector(self):
        universe = _fake_universe()
        sample = _diverse_bootstrap_sample(universe, 20)
        sectors = {e["sector"] for e in sample}
        assert sectors == {"Communication Services", "Financials", "Healthcare", "Technology"}

    def test_respects_the_limit(self):
        universe = _fake_universe()
        sample = _diverse_bootstrap_sample(universe, 20)
        assert len(sample) == 20

    def test_never_duplicates_a_ticker(self):
        universe = _fake_universe()
        sample = _diverse_bootstrap_sample(universe, 40)
        tickers = [e["ticker"] for e in sample]
        assert len(tickers) == len(set(tickers))

    def test_returns_everything_when_limit_exceeds_universe_size(self):
        universe = _fake_universe()
        sample = _diverse_bootstrap_sample(universe, 1000)
        assert len(sample) == len(universe)

    def test_roughly_balanced_across_sectors_not_dominated_by_the_biggest_one(self):
        universe = _fake_universe()
        sample = _diverse_bootstrap_sample(universe, 20)
        counts: dict[str, int] = {}
        for e in sample:
            counts[e["sector"]] = counts.get(e["sector"], 0) + 1
        # Communication Services has 30 of the 60 total tickers (a 3x skew
        # over the other sectors' 10 each) — round-robin must still give
        # every sector a comparable share of a 20-ticker sample, not let
        # the biggest sector dominate the way a prefix slice did.
        assert max(counts.values()) - min(counts.values()) <= 1
