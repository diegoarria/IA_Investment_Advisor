from app.services.quality.business_economics_engine import compute_business_economics


def _base_kwargs(**overrides):
    kwargs = dict(
        roic_trend=[10.0, 12.0, 14.0, 16.0, 18.0],
        nopat_trend=[100.0, 120.0, 140.0, 160.0, 180.0],
        invested_capital_trend=[1000.0, 1050.0, 1100.0, 1150.0, 1200.0],
        fcf_trend=[90.0, 110.0, 130.0, 150.0, 170.0],
        revenue_trend=[2000.0, 2100.0, 2200.0, 2300.0, 2400.0],
        net_income_trend=[95.0, 115.0, 135.0, 155.0, 175.0],
        avg_roic_pct=15.0,
        reinvestment_rate_anchor=0.4,
        cost_of_capital_pct=8.0,
    )
    kwargs.update(overrides)
    return kwargs


class TestCroic:
    def test_basic_computation(self):
        r = compute_business_economics(**_base_kwargs())
        assert r.croic_trend_pct == [9.0, 10.5, 11.8, 13.0, 14.2]
        assert r.croic_avg_pct is not None

    def test_croic_less_than_roic_heavy_capex(self):
        # FCF well below NOPAT-implied capital productivity — CROIC < ROIC.
        r = compute_business_economics(**_base_kwargs(fcf_trend=[20.0, 25.0, 30.0, 35.0, 40.0]))
        assert r.croic_avg_pct < r.roic_avg_pct
        assert "menor" in r.croic_reason or "es mayor" in r.croic_reason

    def test_croic_greater_than_roic_favorable_working_capital(self):
        r = compute_business_economics(**_base_kwargs(fcf_trend=[200.0, 220.0, 240.0, 260.0, 280.0]))
        assert r.croic_avg_pct > r.roic_avg_pct

    def test_independent_missing_years(self):
        # fcf missing in year 0, invested_capital missing in year 1 —
        # independent gates, not tied to roic_trend's own None pattern.
        r = compute_business_economics(**_base_kwargs(
            fcf_trend=[None, 110.0, 130.0, 150.0, 170.0],
            invested_capital_trend=[1000.0, None, 1100.0, 1150.0, 1200.0],
        ))
        assert r.croic_trend_pct[0] is None
        assert r.croic_trend_pct[1] is None
        assert r.croic_trend_pct[2] is not None

    def test_all_none_fcf(self):
        r = compute_business_economics(**_base_kwargs(fcf_trend=[None, None, None, None, None]))
        assert r.croic_avg_pct is None
        assert all(v is None for v in r.croic_trend_pct)

    def test_zero_or_negative_invested_capital_excluded(self):
        r = compute_business_economics(**_base_kwargs(
            invested_capital_trend=[0.0, -50.0, 1100.0, 1150.0, 1200.0],
        ))
        assert r.croic_trend_pct[0] is None
        assert r.croic_trend_pct[1] is None


class TestCapitalIntensity:
    def test_stable(self):
        r = compute_business_economics(**_base_kwargs())
        assert r.capital_intensity_direction == "stable"

    def test_increasing(self):
        r = compute_business_economics(**_base_kwargs(
            invested_capital_trend=[500.0, 700.0, 1000.0, 1400.0, 2000.0],
            revenue_trend=[2000.0, 2000.0, 2000.0, 2000.0, 2000.0],
        ))
        assert r.capital_intensity_direction == "increasing"

    def test_decreasing(self):
        r = compute_business_economics(**_base_kwargs(
            invested_capital_trend=[2000.0, 1400.0, 1000.0, 700.0, 500.0],
            revenue_trend=[2000.0, 2000.0, 2000.0, 2000.0, 2000.0],
        ))
        assert r.capital_intensity_direction == "decreasing"

    def test_fewer_than_4_points_returns_none_direction(self):
        r = compute_business_economics(**_base_kwargs(
            invested_capital_trend=[None, None, 1100.0, 1150.0, 1200.0],
        ))
        assert r.capital_intensity_direction is None

    def test_independent_missing_years(self):
        r = compute_business_economics(**_base_kwargs(
            invested_capital_trend=[1000.0, 1050.0, 1100.0, 1150.0, 1200.0],
            revenue_trend=[2000.0, None, 2200.0, 2300.0, 2400.0],
        ))
        assert r.capital_intensity_trend_pct[1] is None
        assert r.capital_intensity_trend_pct[0] is not None

    def test_zero_revenue_excluded(self):
        r = compute_business_economics(**_base_kwargs(
            revenue_trend=[0.0, 2100.0, 2200.0, 2300.0, 2400.0],
        ))
        assert r.capital_intensity_trend_pct[0] is None


class TestValueCreation:
    def test_consistent_positive(self):
        r = compute_business_economics(**_base_kwargs())
        assert r.value_creation_consistency == "consistent_positive"
        assert r.value_creation_years_positive == r.value_creation_years_total == 5

    def test_consistent_negative(self):
        r = compute_business_economics(**_base_kwargs(
            roic_trend=[2.0, 3.0, 1.0, 2.5, 1.5], cost_of_capital_pct=8.0,
        ))
        assert r.value_creation_consistency == "consistent_negative"
        assert r.value_creation_years_positive == 0

    def test_intermittent(self):
        r = compute_business_economics(**_base_kwargs(
            roic_trend=[10.0, 3.0, 14.0, 4.0, 18.0], cost_of_capital_pct=8.0,
        ))
        assert r.value_creation_consistency == "intermittent"
        assert 0 < r.value_creation_years_positive < r.value_creation_years_total

    def test_consistent_positive_but_shrinking(self):
        # Consistency (all positive) and direction (deteriorating) must be
        # able to diverge — a spread that's always > 0 but trending down.
        r = compute_business_economics(**_base_kwargs(
            roic_trend=[20.0, 18.0, 16.0, 14.0, 12.0], cost_of_capital_pct=8.0,
        ))
        assert r.value_creation_consistency == "consistent_positive"
        assert r.value_creation_direction == "deteriorando"

    def test_cost_of_capital_none(self):
        r = compute_business_economics(**_base_kwargs(cost_of_capital_pct=None))
        assert r.value_creation_spread_avg_pct is None
        assert r.value_creation_trend_pct == [None] * 5
        assert r.value_creation_consistency is None
        assert "costo de capital" in r.value_creation_reason.lower()

    def test_reason_discloses_constant_wacc_simplification(self):
        r = compute_business_economics(**_base_kwargs())
        assert "WACC actual" in r.value_creation_reason
        assert "no está disponible" in r.value_creation_reason or "cada año histórico por igual" in r.value_creation_reason

    def test_fewer_than_2_valid_years_no_consistency(self):
        r = compute_business_economics(**_base_kwargs(roic_trend=[None, None, None, None, 18.0]))
        assert r.value_creation_consistency is None


class TestPassThroughFields:
    def test_roic_passthrough_verbatim(self):
        trend = [10.0, 12.0, 14.0, 16.0, 18.0]
        r = compute_business_economics(**_base_kwargs(roic_trend=trend, avg_roic_pct=15.0))
        assert r.roic_trend_pct == trend
        assert r.roic_avg_pct == 15.0

    def test_incremental_roic_matches_direct_call(self):
        from app.services.quality.quality_engine import compute_incremental_roic
        kwargs = _base_kwargs()
        r = compute_business_economics(**kwargs)
        expected = compute_incremental_roic(kwargs["nopat_trend"], kwargs["invested_capital_trend"])
        assert r.incremental_roic_pct == expected

    def test_fcf_conversion_matches_direct_call(self):
        from dataclasses import asdict
        from app.services.valuation.nuvos_engine.fcf_quality import compute_fcf_conversion
        kwargs = _base_kwargs()
        r = compute_business_economics(**kwargs)
        expected = asdict(compute_fcf_conversion(kwargs["fcf_trend"][-1], kwargs["net_income_trend"][-1]))
        assert r.fcf_conversion == expected

    def test_reinvestment_rate_anchor_passthrough(self):
        r = compute_business_economics(**_base_kwargs(reinvestment_rate_anchor=0.4))
        assert r.reinvestment_rate_anchor_pct == 40.0

    def test_reinvestment_rate_anchor_none(self):
        r = compute_business_economics(**_base_kwargs(reinvestment_rate_anchor=None))
        assert r.reinvestment_rate_anchor_pct is None


class TestInsufficientData:
    def test_all_none_roic_trend(self):
        r = compute_business_economics(**_base_kwargs(roic_trend=[None, None, None, None, None], avg_roic_pct=None))
        assert r.insufficient_data_reason is not None
        assert r.croic_avg_pct is None
        assert r.value_creation_consistency is None

    def test_empty_trends(self):
        r = compute_business_economics(**_base_kwargs(
            roic_trend=[], nopat_trend=[], invested_capital_trend=[], fcf_trend=[], revenue_trend=[], net_income_trend=[],
            avg_roic_pct=None,
        ))
        assert r.insufficient_data_reason is not None

    def test_no_exception_raised(self):
        # Every field individually empty/None — must not raise.
        compute_business_economics(**_base_kwargs(
            roic_trend=[None] * 5, nopat_trend=[None] * 5, invested_capital_trend=[None] * 5,
            fcf_trend=[None] * 5, revenue_trend=[None] * 5, net_income_trend=[None] * 5,
            avg_roic_pct=None, reinvestment_rate_anchor=None, cost_of_capital_pct=None,
        ))
