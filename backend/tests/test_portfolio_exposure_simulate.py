"""Nuvos Plus — Fase 4C-1: "Antes de invertir" (backend).

Covers the explicit math-correctness mandate from Diego's correction pass
(2026-11): capital conservation, correct reweighting, sum-to-100%,
correct ticker merging, no double counting, percentage POINTS (never a
relative/ratio change), dilution of untouched sectors, independent
before/after coverage, a consistent single data snapshot (before/after
never re-fetch), zero mutation, and the exact corrected worked example
(V=$16,389.45, A=$5,000 into QQQ at 59% tech exposure -> ~50.7%, +2.5pp).

Most tests here are PROPERTY tests — they assert the algebraic invariant
itself (e.g. V_after == V_before + A) across many generated scenarios,
not a single hand-computed expected number, per Diego's explicit "no
solamente casos concretos con resultados escritos manualmente" — except
where the deliverable explicitly requires reproducing the one hand-
corrected numeric example."""
import random
from unittest.mock import patch

import pytest

from app.services.asset_classification import EQUITY, ETF, UNKNOWN
from app.services.portfolio_exposure import combiner
from app.services.portfolio_exposure.combiner import InvalidSimulationInputError
from tests.test_portfolio_exposure_combiner import _classify_map, _etf_overview, _pos


@pytest.fixture(autouse=True)
def _clear_cache():
    from app.core import cache as cache_module
    cache_module._mem.clear()
    yield
    cache_module._mem.clear()


# ─── Helpers ────────────────────────────────────────────────────────────

def _diego_valued():
    """Exact reproduction of the real Supabase Local portfolio that
    surfaced both the original 81.7% coverage bug and the math error in
    the worked example: VOO $7,047.80, QQQ $3,459.75, GOOGL $2,889.30,
    ASML $2,992.60 — total $16,389.45."""
    voo_sectors = [
        {"name": "Tecnología", "weight_pct": 32.0}, {"name": "Servicios financieros", "weight_pct": 13.0},
        {"name": "Salud", "weight_pct": 11.0}, {"name": "Consumo cíclico", "weight_pct": 10.0},
        {"name": "Servicios de comunicación", "weight_pct": 9.0}, {"name": "Industriales", "weight_pct": 8.0},
        {"name": "Consumo defensivo", "weight_pct": 6.0}, {"name": "Energía", "weight_pct": 3.0},
        {"name": "Servicios públicos", "weight_pct": 2.5}, {"name": "Bienes raíces", "weight_pct": 2.5},
        {"name": "Materiales básicos", "weight_pct": 2.0},
    ]
    qqq_sectors = [
        {"name": "Tecnología", "weight_pct": 59.0}, {"name": "Consumo cíclico", "weight_pct": 17.0},
        {"name": "Servicios de comunicación", "weight_pct": 15.0}, {"name": "Salud", "weight_pct": 6.0},
        {"name": "Consumo defensivo", "weight_pct": 3.0},
    ]
    positions = [_pos("VOO", 10, 400.0), _pos("QQQ", 5, 400.0), _pos("GOOGL", 10, 180.0), _pos("ASML", 2, 650.0)]
    voo_overview = _etf_overview(704.78, "USD", voo_sectors, True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
    qqq_overview = _etf_overview(691.95, "USD", qqq_sectors, True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
    with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"VOO": ETF, "QQQ": ETF, "GOOGL": EQUITY, "ASML": EQUITY})), \
         patch("app.services.etf.service.get_etf_overview", side_effect=lambda t, **k: {"VOO": voo_overview, "QQQ": qqq_overview}[t]), \
         patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", side_effect=lambda t: {"GOOGL": 288.93, "ASML": 1496.3}[t]), \
         patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", side_effect=lambda t: {
             "GOOGL": {"sector": "Communication Services", "country": "US", "currency": "USD"},
             "ASML": {"sector": "Technology", "country": "NL", "currency": "USD"},
         }[t]), \
         patch("app.services.portfolio_exposure.combiner.get_sector_group_es", side_effect=lambda t: {
             "GOOGL": "Comunicación de Servicios", "ASML": "Tecnología",
         }[t]):
        agg = combiner.aggregate_and_classify(positions)
        return [combiner.value_position(p, "USD") for p in agg]


def _qqq_hypothetical(amount=5000.0):
    qqq_sectors = [
        {"name": "Tecnología", "weight_pct": 59.0}, {"name": "Consumo cíclico", "weight_pct": 17.0},
        {"name": "Servicios de comunicación", "weight_pct": 15.0}, {"name": "Salud", "weight_pct": 6.0},
        {"name": "Consumo defensivo", "weight_pct": 3.0},
    ]
    overview = _etf_overview(691.95, "USD", qqq_sectors, True, [{"name": "Estados Unidos", "weight_pct": 99.0}], True)
    with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
         patch("app.services.etf.service.get_etf_overview", return_value=overview):
        return combiner.build_hypothetical_position("QQQ", amount, "USD")


def _random_valued_portfolio(rng: random.Random, n: int) -> list[dict]:
    """Generates a plausible random portfolio of n EQUITY/ETF positions
    entirely in-process (no network) for property testing — every
    position is `verifiable`, with internally-consistent sector weights
    summing to <=100%."""
    valued = []
    sectors_pool = ["Tecnología", "Salud", "Servicios financieros", "Energía", "Consumo cíclico", "Industriales"]
    for i in range(n):
        is_etf = rng.random() < 0.5
        ticker = f"SIM{i}"
        market_value = round(rng.uniform(100, 50000), 2)
        if is_etf:
            k = rng.randint(1, 3)
            chosen = rng.sample(sectors_pool, k)
            remaining = 100.0
            weights = []
            for j in range(k):
                w = round(remaining / (k - j) * rng.uniform(0.5, 1.0), 2) if j < k - 1 else round(remaining, 2)
                w = min(w, remaining)
                weights.append(w)
                remaining -= w
            sector_weightings = [{"name": s, "weight_pct": w} for s, w in zip(chosen, weights)]
            valued.append({
                "ticker": ticker, "name": None, "asset_class": ETF, "shares": None, "avg_price": None,
                "cost_basis": market_value, "market_value": market_value, "verifiable": True,
                "unverifiable_reason": None, "quote_currency": "USD", "fx_rate_applied": 1.0,
                "sector": None, "country": None, "price_fetched_at": 0.0,
                "_etf_overview": {
                    "price": {"current": 1.0}, "costs": {"nav_currency": "USD"},
                    "exposure": {
                        "sector_weightings": sector_weightings, "sector_weight_sum_in_expected_range": True,
                        "country_weightings": [{"name": "Estados Unidos", "weight_pct": 100.0}],
                        "country_weight_sum_in_expected_range": True,
                    },
                },
            })
        else:
            sector = rng.choice(sectors_pool)
            valued.append({
                "ticker": ticker, "name": None, "asset_class": EQUITY, "shares": None, "avg_price": None,
                "cost_basis": market_value, "market_value": market_value, "verifiable": True,
                "unverifiable_reason": None, "quote_currency": "USD", "fx_rate_applied": 1.0,
                "sector": sector, "country": "Estados Unidos", "price_fetched_at": 0.0, "_etf_overview": None,
            })
    return valued


def _random_hypothetical(rng: random.Random, amount: float) -> dict:
    is_etf = rng.random() < 0.5
    if is_etf:
        return {
            "ticker": "NEWSIM", "name": None, "asset_class": ETF, "shares": None, "avg_price": None,
            "cost_basis": amount, "market_value": amount, "verifiable": True, "unverifiable_reason": None,
            "quote_currency": "USD", "fx_rate_applied": 1.0, "sector": None, "country": None,
            "price_fetched_at": 0.0, "is_hypothetical": True,
            "_etf_overview": {
                "price": {"current": 1.0}, "costs": {"nav_currency": "USD"},
                "exposure": {
                    "sector_weightings": [{"name": "Tecnología", "weight_pct": 100.0}], "sector_weight_sum_in_expected_range": True,
                    "country_weightings": [{"name": "Estados Unidos", "weight_pct": 100.0}], "country_weight_sum_in_expected_range": True,
                },
            },
        }
    return {
        "ticker": "NEWSIM", "name": None, "asset_class": EQUITY, "shares": None, "avg_price": None,
        "cost_basis": amount, "market_value": amount, "verifiable": True, "unverifiable_reason": None,
        "quote_currency": "USD", "fx_rate_applied": 1.0, "sector": "Salud", "country": "Estados Unidos",
        "price_fetched_at": 0.0, "is_hypothetical": True, "_etf_overview": None,
    }


# ─── Invalid input ──────────────────────────────────────────────────────

class TestInvalidInputs:
    def test_unknown_ticker_refused(self):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=UNKNOWN):
            with pytest.raises(InvalidSimulationInputError) as exc:
                combiner.build_hypothetical_position("NOTREAL", 1000.0, "USD")
        assert exc.value.reason == "ticker_not_recognized"

    def test_empty_ticker_refused(self):
        with pytest.raises(InvalidSimulationInputError) as exc:
            combiner.build_hypothetical_position("", 1000.0, "USD")
        assert exc.value.reason == "ticker_required"

    @pytest.mark.parametrize("amount", [0, -1, -1000.0])
    def test_non_positive_amount_refused(self, amount):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY):
            with pytest.raises(InvalidSimulationInputError) as exc:
                combiner.build_hypothetical_position("AAPL", amount, "USD")
        assert exc.value.reason == "amount_must_be_positive"

    def test_nan_amount_refused(self):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY):
            with pytest.raises(InvalidSimulationInputError) as exc:
                combiner.build_hypothetical_position("AAPL", float("nan"), "USD")
        assert exc.value.reason == "invalid_amount"

    def test_infinite_amount_refused(self):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY):
            with pytest.raises(InvalidSimulationInputError) as exc:
                combiner.build_hypothetical_position("AAPL", float("inf"), "USD")
        assert exc.value.reason == "invalid_amount"

    def test_absurdly_large_amount_refused(self):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY):
            with pytest.raises(InvalidSimulationInputError) as exc:
                combiner.build_hypothetical_position("AAPL", 1e18, "USD")
        assert exc.value.reason == "amount_too_large"

    def test_non_numeric_amount_refused(self):
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY):
            with pytest.raises(InvalidSimulationInputError) as exc:
                combiner.build_hypothetical_position("AAPL", "lots of money", "USD")
        assert exc.value.reason == "invalid_amount"

    def test_amount_larger_than_current_portfolio_is_valid(self):
        """Diego's explicit scenario: a hypothetical contribution LARGER
        than the entire current portfolio — no special-casing, the same
        formula applies, V_after is simply dominated by the new money."""
        valued = _diego_valued()
        hyp = _qqq_hypothetical(100_000.0)  # >> the $16,389.45 portfolio
        sim = combiner.simulate_addition(valued, hyp)
        assert sim["after"]["valuation"]["total_value_verified"] == pytest.approx(116389.45, abs=0.01)
        qqq_after = next(p for p in sim["after"]["positions"] if p["ticker"] == "QQQ")
        assert qqq_after["weight_pct"] > 85  # now overwhelmingly the largest position

    def test_tiny_amount_is_valid(self):
        """A very small (but positive) amount must be accepted, not
        refused — only non-positive/absurd amounts are invalid."""
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Technology", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Tecnología"):
            hyp = combiner.build_hypothetical_position("AAPL", 0.01, "USD")
        assert hyp["market_value"] == 0.01


# ─── Merge vs. new ticker ───────────────────────────────────────────────

class TestMergeExistingTicker:
    def test_existing_etf_merged_not_duplicated(self):
        valued = _diego_valued()
        hyp = _qqq_hypothetical(5000.0)
        sim = combiner.simulate_addition(valued, hyp)
        after_qqq_rows = [p for p in sim["after"]["positions"] if p["ticker"] == "QQQ"]
        assert len(after_qqq_rows) == 1  # never duplicated
        assert sim["after"]["valuation"]["position_count"] == sim["before"]["valuation"]["position_count"]
        before_qqq = next(p for p in sim["before"]["positions"] if p["ticker"] == "QQQ")
        assert after_qqq_rows[0]["market_value"] == round(before_qqq["market_value"] + 5000.0, 2)

    def test_existing_equity_merged_not_duplicated(self):
        valued = _diego_valued()
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Communication Services", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Comunicación de Servicios"):
            hyp = combiner.build_hypothetical_position("GOOGL", 1000.0, "USD")
        sim = combiner.simulate_addition(valued, hyp)
        after_googl = [p for p in sim["after"]["positions"] if p["ticker"] == "GOOGL"]
        assert len(after_googl) == 1
        assert sim["after"]["valuation"]["position_count"] == 4

    def test_new_etf_appended(self):
        valued = _diego_valued()
        overview = _etf_overview(100.0, "USD", [{"name": "Energía", "weight_pct": 100.0}], True, [{"name": "Estados Unidos", "weight_pct": 100.0}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            hyp = combiner.build_hypothetical_position("XLE", 2000.0, "USD")
        sim = combiner.simulate_addition(valued, hyp)
        assert sim["after"]["valuation"]["position_count"] == 5
        assert any(p["ticker"] == "XLE" for p in sim["after"]["positions"])

    def test_new_equity_appended(self):
        valued = _diego_valued()
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=EQUITY), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Healthcare", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Salud"):
            hyp = combiner.build_hypothetical_position("JNJ", 1500.0, "USD")
        sim = combiner.simulate_addition(valued, hyp)
        assert sim["after"]["valuation"]["position_count"] == 5


# ─── Empty portfolio / ownership ────────────────────────────────────────

class TestEmptyPortfolio:
    def test_simulate_on_empty_real_portfolio(self):
        hyp = _qqq_hypothetical(1000.0)
        sim = combiner.simulate_addition([], hyp)
        assert sim["before"]["valuation"]["total_value_verified"] is None
        assert sim["before_had_no_verified_positions"] is True
        assert sim["after"]["valuation"]["total_value_verified"] == 1000.0
        assert sim["after"]["valuation"]["position_count"] == 1


class TestIncompleteRealPortfolioData:
    """Diego's explicit scenarios: a real position with no verifiable
    price, and a hypothetical ETF without full sector coverage — neither
    may be hidden or silently folded into the totals."""

    def test_real_position_missing_price_stays_excluded_in_both_states(self):
        valued = _diego_valued()
        unverifiable = {
            "ticker": "NOPRICE", "name": None, "asset_class": EQUITY, "shares": 10.0, "avg_price": 50.0,
            "cost_basis": 500.0, "market_value": None, "verifiable": False, "unverifiable_reason": "no_price",
            "quote_currency": None, "fx_rate_applied": None, "sector": None, "country": None,
            "price_fetched_at": 0.0, "_etf_overview": None,
        }
        valued_with_gap = valued + [unverifiable]
        hyp = _qqq_hypothetical(5000.0)
        sim = combiner.simulate_addition(valued_with_gap, hyp)

        for state in ("before", "after"):
            rows = [p for p in sim[state]["positions"] if p["ticker"] == "NOPRICE"]
            assert len(rows) == 1  # visible, never hidden
            assert rows[0]["verifiable"] is False
            assert rows[0]["weight_pct"] is None  # never a fabricated weight
        # the $500 cost basis of the unverifiable position must NEVER be
        # folded into either state's verified total
        assert sim["before"]["valuation"]["total_value_verified"] == 16389.45
        assert sim["after"]["valuation"]["total_value_verified"] == 21389.45

    def test_hypothetical_etf_without_sector_coverage_gives_partial_simulation(self):
        """Diego: 'si el ticker está identificado correctamente pero
        faltan datos sectoriales... se podrá ofrecer una simulación
        parcial, siempre que la cobertura... estén explícitas' — never
        refused, never a fabricated sector split."""
        valued = _diego_valued()
        # Confirmed real ETF, but sector coverage NOT confirmed complete —
        # the actual shape normalize.py produces for a thin/partial
        # response (an empty list with coverage=True is impossible there:
        # normalize_weightings only reports in_range=True when the items
        # it actually has sum close to 100%).
        overview = _etf_overview(100.0, "USD", [], False, [], False)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=overview):
            hyp = combiner.build_hypothetical_position("WEIRDETF", 3000.0, "USD")

        sim = combiner.simulate_addition(valued, hyp)
        # simulation proceeds — never refused for a confirmed-real ticker
        assert sim["after"]["valuation"]["total_value_verified"] == pytest.approx(19389.45, abs=0.01)
        # its $3,000 is honestly unclassified, not spread across sectors
        unclassified_increase = sim["after"]["sector_exposure"]["unclassified_value"] - sim["before"]["sector_exposure"]["unclassified_value"]
        assert unclassified_increase == pytest.approx(3000.0, abs=0.01)
        assert sim["after"]["sector_exposure"]["coverage_pct"] < sim["before"]["sector_exposure"]["coverage_pct"]


# ─── No mutation / consistent snapshot ──────────────────────────────────

class TestNoMutationAndConsistentSnapshot:
    def test_original_valued_list_never_mutated(self):
        import copy
        valued = _diego_valued()
        original = copy.deepcopy(valued)
        hyp = _qqq_hypothetical(5000.0)
        combiner.simulate_addition(valued, hyp)
        # compute_weights etc. add/modify keys — the ORIGINAL list passed
        # in must come out byte-identical.
        assert valued == original

    def test_before_and_after_never_refetch_existing_positions(self):
        """The decisive test for 'misma fotografía de datos': once
        `valued` positions are built, get_etf_overview/get_fmp_quote_price
        must NEVER be called again by simulate_addition — before/after
        both recombine the same already-fetched numbers."""
        valued = _diego_valued()
        hyp = _qqq_hypothetical(5000.0)
        with patch("app.services.etf.service.get_etf_overview") as mock_overview, \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price") as mock_price:
            combiner.simulate_addition(valued, hyp)
        mock_overview.assert_not_called()
        mock_price.assert_not_called()


# ─── The corrected worked example ───────────────────────────────────────

class TestCorrectedWorkedExample:
    """Diego's explicit correction: V=$16,389.45, A=$5,000 into QQQ
    (59% Tecnología) -> Tecnología ~50.7% of the portfolio, +2.5
    percentage points (NOT 58.4%/+10.2pp, the arithmetic error in the
    original audit)."""

    def test_reproduces_corrected_example(self):
        """Applies Diego's own corrected formula —
        %_después = (dólares_sector_antes + A×s) / V_después × 100 —
        to this fixture's real, internally-consistent numbers (VOO 32%
        tech, QQQ 59% tech, ASML 100% tech by direct classification) and
        confirms simulate_addition() produces exactly that, not the
        original audit's arithmetic error (which divided by the wrong
        total)."""
        valued = _diego_valued()
        before_total = combiner.compute_valuation_summary(valued)["total_value_verified"]
        assert before_total == 16389.45

        # Hand-computed from the fixture's own fixed inputs, per Diego's
        # corrected formula — the independent "expected" side of this test.
        voo_mv, qqq_mv, asml_mv = 7047.80, 3459.75, 2992.60
        tech_dollars_before = voo_mv * 0.32 + qqq_mv * 0.59 + asml_mv  # ASML = 100% Tecnología
        amount, s = 5000.0, 0.59
        v_after = 16389.45 + amount
        expected_tech_pct_after = round((tech_dollars_before + amount * s) / v_after * 100, 1)
        expected_tech_pct_before = round(tech_dollars_before / 16389.45 * 100, 1)
        expected_delta = round(expected_tech_pct_after - expected_tech_pct_before, 1)

        hyp = _qqq_hypothetical(amount)
        sim = combiner.simulate_addition(valued, hyp)

        assert sim["before"]["valuation"]["total_value_verified"] == 16389.45
        assert sim["after"]["valuation"]["total_value_verified"] == 21389.45

        tech_delta = next(d for d in sim["sector_deltas"] if d["sector"] == "Tecnología")
        assert tech_delta["pct_before"] == pytest.approx(expected_tech_pct_before, abs=0.1)
        assert tech_delta["pct_after"] == pytest.approx(expected_tech_pct_after, abs=0.1)
        assert tech_delta["delta_pct_points"] == pytest.approx(expected_delta, abs=0.1)
        # the engine must NEVER divide the post-addition dollar figure by
        # the PRE-addition total — the exact class of error Diego caught
        # in the original (illustrative, hand-done) audit example.
        wrong_pct = round((tech_dollars_before + amount * s) / 16389.45 * 100, 1)
        assert tech_delta["pct_after"] != pytest.approx(wrong_pct, abs=0.5)


# ─── Sector dilution of untouched sectors ───────────────────────────────

class TestDilutionOfUntouchedSectors:
    def test_sectors_not_touched_by_the_addition_strictly_decrease(self):
        valued = _diego_valued()
        hyp = _qqq_hypothetical(5000.0)
        sim = combiner.simulate_addition(valued, hyp)
        # QQQ doesn't touch "Servicios financieros" or "Industriales" at
        # all (only VOO does) — their dollar amount is unchanged but V
        # grew, so their % must strictly decrease.
        for sector in ("Servicios financieros", "Industriales", "Bienes raíces"):
            delta = next((d for d in sim["sector_deltas"] if d["sector"] == sector), None)
            if delta is None:
                continue
            assert delta["pct_after"] < delta["pct_before"]
            assert delta["delta_pct_points"] < 0

    def test_delta_is_a_subtraction_never_a_ratio(self):
        valued = _diego_valued()
        hyp = _qqq_hypothetical(5000.0)
        sim = combiner.simulate_addition(valued, hyp)
        for d in sim["sector_deltas"]:
            assert d["delta_pct_points"] == round(d["pct_after"] - d["pct_before"], 2)


# ─── Property tests over randomized portfolios ──────────────────────────

class TestPropertiesAcrossRandomPortfolios:
    """Diego's explicit requirement: verify properties across GENERATED
    scenarios, not just one hand-picked example. 40 random portfolios,
    fixed seed for reproducibility, covering equity-only, ETF-only, and
    mixed compositions (position count and composition vary per seed)."""

    @pytest.mark.parametrize("seed", range(40))
    def test_capital_conservation_and_full_reweighting(self, seed):
        rng = random.Random(seed)
        n = rng.randint(1, 15)
        valued = _random_valued_portfolio(rng, n)
        amount = round(rng.uniform(1, 100000), 2)
        hyp = _random_hypothetical(rng, amount)

        import copy
        original = copy.deepcopy(valued)
        sim = combiner.simulate_addition(valued, hyp)

        # Invariant 1: capital conservation
        v_before = sim["before"]["valuation"]["total_value_verified"] or 0.0
        v_after = sim["after"]["valuation"]["total_value_verified"]
        assert v_after == pytest.approx(v_before + amount, abs=0.02)

        # Invariant 2: every weight recomputed fresh against the new total
        for p in sim["after"]["positions"]:
            if p["verifiable"] and p["weight_pct"] is not None:
                expected = round(p["market_value"] / v_after * 100, 2)
                assert p["weight_pct"] == pytest.approx(expected, abs=0.01)

        # Invariant 3: weights sum to 100% (full coverage by construction here)
        total_weight = sum(p["weight_pct"] for p in sim["after"]["positions"] if p["weight_pct"] is not None)
        assert total_weight == pytest.approx(100.0, abs=0.5)

        # Invariant 5: no double counting — sector dollar totals + unclassified == V_after
        sector_total = sum(r["value"] for r in sim["after"]["sector_exposure"]["by_sector"]) + sim["after"]["sector_exposure"]["unclassified_value"]
        assert sector_total == pytest.approx(v_after, abs=0.5)

        # Invariant (the exact class of bug Diego caught in the original
        # worked example): every sector row's own reported percentage
        # must equal ITS OWN dollar value divided by the NEW total — never
        # the old total, never a value computed some other way. Checked
        # per-row, per-scenario, not just in the one hand-verified example.
        for row in sim["after"]["sector_exposure"]["by_sector"]:
            if row["pct_of_verified_total"] is None:
                continue
            expected_pct = round(row["value"] / v_after * 100, 1)
            assert row["pct_of_verified_total"] == pytest.approx(expected_pct, abs=0.05)
        for row in sim["before"]["sector_exposure"]["by_sector"]:
            if row["pct_of_verified_total"] is None or v_before == 0:
                continue
            expected_pct = round(row["value"] / v_before * 100, 1)
            assert row["pct_of_verified_total"] == pytest.approx(expected_pct, abs=0.05)

        # Invariant 10: zero mutation of the original input
        assert valued == original

    @pytest.mark.parametrize("seed", range(20))
    def test_sector_deltas_never_a_relative_change(self, seed):
        rng = random.Random(seed + 1000)
        n = rng.randint(2, 10)
        valued = _random_valued_portfolio(rng, n)
        amount = round(rng.uniform(10, 20000), 2)
        hyp = _random_hypothetical(rng, amount)
        sim = combiner.simulate_addition(valued, hyp)
        for d in sim["sector_deltas"]:
            assert d["delta_pct_points"] == round(d["pct_after"] - d["pct_before"], 2)


class TestDiegoLiteralIllustrativeExample:
    """Reproduces Diego's exact stated numbers literally — V=$16,389.45,
    Tecnología at exactly 48.2% before, a $5,000 addition to a position
    with 59% Tecnología exposure — independent of any specific ETF
    mock's real sector mix, so this is a direct, unambiguous check of the
    formula itself: expected 50.7%, +2.5 percentage points."""

    def test_exact_corrected_figures(self):
        v_before = 16389.45
        tech_pct_before = 48.2
        tech_dollars_before = round(v_before * tech_pct_before / 100, 2)
        other_dollars_before = round(v_before - tech_dollars_before, 2)

        existing = [{
            "ticker": "TECHPOS", "name": None, "asset_class": ETF, "shares": None, "avg_price": None,
            "cost_basis": tech_dollars_before, "market_value": tech_dollars_before, "verifiable": True,
            "unverifiable_reason": None, "quote_currency": "USD", "fx_rate_applied": 1.0,
            "sector": None, "country": None, "price_fetched_at": 0.0,
            "_etf_overview": {
                "price": {"current": 1.0}, "costs": {"nav_currency": "USD"},
                "exposure": {
                    "sector_weightings": [{"name": "Tecnología", "weight_pct": 100.0}], "sector_weight_sum_in_expected_range": True,
                    "country_weightings": [], "country_weight_sum_in_expected_range": True,
                },
            },
        }, {
            "ticker": "OTHERPOS", "name": None, "asset_class": EQUITY, "shares": None, "avg_price": None,
            "cost_basis": other_dollars_before, "market_value": other_dollars_before, "verifiable": True,
            "unverifiable_reason": None, "quote_currency": "USD", "fx_rate_applied": 1.0,
            "sector": "Servicios financieros", "country": "Estados Unidos", "price_fetched_at": 0.0, "_etf_overview": None,
        }]

        hypothetical = {
            "ticker": "QQQLIKE", "name": None, "asset_class": ETF, "shares": None, "avg_price": None,
            "cost_basis": 5000.0, "market_value": 5000.0, "verifiable": True, "unverifiable_reason": None,
            "quote_currency": "USD", "fx_rate_applied": 1.0, "sector": None, "country": None,
            "price_fetched_at": 0.0, "is_hypothetical": True,
            "_etf_overview": {
                "price": {"current": 1.0}, "costs": {"nav_currency": "USD"},
                "exposure": {
                    "sector_weightings": [{"name": "Tecnología", "weight_pct": 59.0}, {"name": "Servicios financieros", "weight_pct": 41.0}],
                    "sector_weight_sum_in_expected_range": True, "country_weightings": [], "country_weight_sum_in_expected_range": True,
                },
            },
        }

        sim = combiner.simulate_addition(existing, hypothetical)
        assert sim["before"]["valuation"]["total_value_verified"] == 16389.45
        assert sim["after"]["valuation"]["total_value_verified"] == 21389.45

        tech = next(d for d in sim["sector_deltas"] if d["sector"] == "Tecnología")
        assert tech["pct_before"] == pytest.approx(48.2, abs=0.05)
        assert tech["pct_after"] == pytest.approx(50.7, abs=0.1)
        assert tech["delta_pct_points"] == pytest.approx(2.5, abs=0.1)


class TestVooThousandAndZeroRoundingDeltas:
    """Diego's two explicit remaining Fase 4C test scenarios: the exact
    VOO + $1,000 case from his bug report, and a delta tiny enough to
    round to 0.0pp — which must still appear in the raw data (never
    hidden), just never get promoted into a prose observation."""

    def test_voo_plus_1000_matches_the_reported_denominators(self):
        """Reproduces the exact scenario from Diego's bug report: adding
        $1,000 to VOO must leave the equity_domicile row's percentage and
        its subset total EXACTLY unchanged (VOO is an ETF — it never
        touches the equity-only denominator), while the etf_underlying
        row's subset total grows by exactly $1,000."""
        positions = [_pos("GOOGL", 10, 180.0), _pos("VOO", 10, 400.0)]
        voo_overview = _etf_overview(400.0, "USD", [{"name": "Tecnología", "weight_pct": 32.0}], True, [{"name": "Estados Unidos", "weight_pct": 99.1}, {"name": "Canadá", "weight_pct": 0.3}], True)
        with patch("app.services.portfolio_exposure.combiner.classify_asset", side_effect=_classify_map({"GOOGL": EQUITY, "VOO": ETF})), \
             patch("app.services.etf.service.get_etf_overview", return_value=voo_overview), \
             patch("app.services.portfolio_exposure.combiner.get_fmp_quote_price", return_value=180.0), \
             patch("app.services.portfolio_exposure.equity_profile.get_equity_profile", return_value={"sector": "Communication Services", "country": "US", "currency": "USD"}), \
             patch("app.services.portfolio_exposure.combiner.get_sector_group_es", return_value="Comunicación de Servicios"):
            agg = combiner.aggregate_and_classify(positions)
            valued = [combiner.value_position(p, "USD") for p in agg]
        with patch("app.services.portfolio_exposure.combiner.classify_asset", return_value=ETF), \
             patch("app.services.etf.service.get_etf_overview", return_value=voo_overview):
            hypothetical = combiner.build_hypothetical_position("VOO", 1000.0, "USD")
        sim = combiner.simulate_addition(valued, hypothetical)

        equity_before = next(r for r in sim["before"]["geographic_exposure"]["by_country"] if r["methodology"] == "equity_domicile")
        equity_after = next(r for r in sim["after"]["geographic_exposure"]["by_country"] if r["methodology"] == "equity_domicile")
        assert equity_before["pct_of_asset_class_value"] == equity_after["pct_of_asset_class_value"] == 100.0
        assert equity_before["asset_class_total_value"] == equity_after["asset_class_total_value"] == 1800.0  # GOOGL only, untouched

        etf_before = next(r for r in sim["before"]["geographic_exposure"]["by_country"] if r["methodology"] == "etf_underlying" and r["country"] == "Estados Unidos")
        etf_after = next(r for r in sim["after"]["geographic_exposure"]["by_country"] if r["methodology"] == "etf_underlying" and r["country"] == "Estados Unidos")
        assert etf_before["asset_class_total_value"] == 4000.0
        assert etf_after["asset_class_total_value"] == 5000.0  # VOO's own subset grew by exactly $1,000

    def test_delta_that_rounds_to_zero_still_appears_in_raw_data_not_hidden(self):
        """A real, tiny delta (e.g. 0.04 points) rounds to 0.0 — it must
        still be a real row in sector_deltas (never dropped for being
        small), even though a UI/insight layer would correctly choose not
        to call it out as a meaningful observation."""
        valued = _diego_valued()
        hyp = _qqq_hypothetical(0.01)  # smallest valid amount — negligible effect on any untouched sector
        sim = combiner.simulate_addition(valued, hyp)
        # at least one sector should show a real but sub-rounding delta
        tiny_deltas = [d for d in sim["sector_deltas"] if d["delta_pct_points"] == 0.0]
        assert len(tiny_deltas) >= 1
        for d in tiny_deltas:
            # still a complete, real row — not a stub
            assert "pct_before" in d and "pct_after" in d and "sector" in d
