from app.services.valuation.outlier_detection_engine import detect_valuation_outliers


def _flag(result, name):
    return next(f for f in result.flags if f.name == name)


def _base_kwargs(**overrides):
    kwargs = dict(
        current_price=100.0, fair_value_bear=80.0, fair_value_base=100.0, fair_value_bull=130.0,
    )
    kwargs.update(overrides)
    return kwargs


class TestFairValueMultiple:
    def test_flags_when_base_over_3x_price(self):
        result = detect_valuation_outliers(**_base_kwargs(current_price=100.0, fair_value_base=350.0))
        assert _flag(result, "fair_value_over_3x_price").flagged is True

    def test_does_not_flag_when_within_range(self):
        result = detect_valuation_outliers(**_base_kwargs(current_price=100.0, fair_value_base=120.0))
        assert _flag(result, "fair_value_over_3x_price").flagged is False

    def test_flags_when_base_under_30pct_of_price(self):
        result = detect_valuation_outliers(**_base_kwargs(current_price=100.0, fair_value_base=20.0, fair_value_bear=10.0, fair_value_bull=25.0))
        assert _flag(result, "fair_value_under_30pct_price").flagged is True

    def test_does_not_flag_when_above_30pct(self):
        result = detect_valuation_outliers(**_base_kwargs(current_price=100.0, fair_value_base=50.0, fair_value_bear=40.0, fair_value_bull=60.0))
        assert _flag(result, "fair_value_under_30pct_price").flagged is False

    def test_absent_when_price_or_base_missing(self):
        result = detect_valuation_outliers(current_price=None, fair_value_bear=None, fair_value_base=None, fair_value_bull=None)
        assert all(f.name not in ("fair_value_over_3x_price", "fair_value_under_30pct_price") for f in result.flags)


class TestTerminalValueDominance:
    def test_flags_when_terminal_value_exceeds_90pct(self):
        result = detect_valuation_outliers(**_base_kwargs(pv_of_terminal_value=95.0, enterprise_value=100.0))
        assert _flag(result, "terminal_value_dominates").flagged is True

    def test_does_not_flag_below_threshold(self):
        result = detect_valuation_outliers(**_base_kwargs(pv_of_terminal_value=60.0, enterprise_value=100.0))
        assert _flag(result, "terminal_value_dominates").flagged is False

    def test_absent_when_inputs_missing_dcf_only_concept(self):
        result = detect_valuation_outliers(**_base_kwargs())
        assert not any(f.name == "terminal_value_dominates" for f in result.flags)


class TestRegimeChangeReuse:
    def test_reuses_the_flag_verbatim_when_true(self):
        result = detect_valuation_outliers(**_base_kwargs(regime_change_flag=True, regime_change_detail="custom detail"))
        flag = _flag(result, "implied_growth_regime_change")
        assert flag.flagged is True
        assert flag.detail == "custom detail"

    def test_reuses_the_flag_verbatim_when_false(self):
        result = detect_valuation_outliers(**_base_kwargs(regime_change_flag=False))
        assert _flag(result, "implied_growth_regime_change").flagged is False

    def test_absent_when_none(self):
        result = detect_valuation_outliers(**_base_kwargs())
        assert not any(f.name == "implied_growth_regime_change" for f in result.flags)


class TestRoicVsIndustry:
    def test_flags_when_roic_gap_exceeds_20pp(self):
        result = detect_valuation_outliers(**_base_kwargs(avg_roic_pct=50.0, industry_median_roic_pct=10.0))
        flag = _flag(result, "roic_inconsistent_with_industry")
        assert flag.flagged is True
        assert flag.severity == "info"
        assert "heuristic" in flag.detail

    def test_does_not_flag_when_gap_small(self):
        result = detect_valuation_outliers(**_base_kwargs(avg_roic_pct=15.0, industry_median_roic_pct=10.0))
        assert _flag(result, "roic_inconsistent_with_industry").flagged is False

    def test_absent_when_either_missing(self):
        result = detect_valuation_outliers(**_base_kwargs(avg_roic_pct=50.0, industry_median_roic_pct=None))
        assert not any(f.name == "roic_inconsistent_with_industry" for f in result.flags)


class TestMultipleVsHistorical:
    def test_flags_when_multiple_50pct_above_max_reference(self):
        result = detect_valuation_outliers(**_base_kwargs(implied_multiple=40.0, historical_median_pe=20.0, peer_median_pe=18.0))
        assert _flag(result, "multiple_above_historical_range").flagged is True

    def test_does_not_flag_when_close_to_reference(self):
        result = detect_valuation_outliers(**_base_kwargs(implied_multiple=22.0, historical_median_pe=20.0, peer_median_pe=18.0))
        assert _flag(result, "multiple_above_historical_range").flagged is False

    def test_uses_whichever_reference_is_available(self):
        result = detect_valuation_outliers(**_base_kwargs(implied_multiple=40.0, historical_median_pe=None, peer_median_pe=18.0))
        assert _flag(result, "multiple_above_historical_range").flagged is True

    def test_absent_when_no_reference_available(self):
        result = detect_valuation_outliers(**_base_kwargs(implied_multiple=40.0, historical_median_pe=None, peer_median_pe=None))
        assert not any(f.name == "multiple_above_historical_range" for f in result.flags)


class TestBearAbovePrice:
    def test_flags_when_bear_exceeds_price(self):
        result = detect_valuation_outliers(**_base_kwargs(current_price=100.0, fair_value_bear=110.0))
        assert _flag(result, "bear_above_current_price").flagged is True

    def test_does_not_flag_normally(self):
        result = detect_valuation_outliers(**_base_kwargs(current_price=100.0, fair_value_bear=80.0))
        assert _flag(result, "bear_above_current_price").flagged is False


class TestBullBelowBase:
    def test_flags_structural_inversion(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_base=100.0, fair_value_bull=90.0))
        assert _flag(result, "bull_below_base").flagged is True

    def test_does_not_flag_normally(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_base=100.0, fair_value_bull=130.0))
        assert _flag(result, "bull_below_base").flagged is False


class TestScenarioCompression:
    def test_flags_when_spread_under_10pct_of_base(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_bear=98.0, fair_value_base=100.0, fair_value_bull=102.0))
        assert _flag(result, "scenarios_too_compressed").flagged is True

    def test_does_not_flag_normal_spread(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_bear=80.0, fair_value_base=100.0, fair_value_bull=130.0))
        assert _flag(result, "scenarios_too_compressed").flagged is False


class TestScenarioWidth:
    def test_flags_when_spread_over_200pct_of_base(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_bear=10.0, fair_value_base=100.0, fair_value_bull=250.0))
        assert _flag(result, "scenarios_too_wide").flagged is True

    def test_does_not_flag_normal_spread(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_bear=80.0, fair_value_base=100.0, fair_value_bull=130.0))
        assert _flag(result, "scenarios_too_wide").flagged is False

    def test_absent_when_base_is_zero(self):
        result = detect_valuation_outliers(**_base_kwargs(fair_value_bear=10.0, fair_value_base=0.0, fair_value_bull=250.0))
        assert not any(f.name in ("scenarios_too_compressed", "scenarios_too_wide") for f in result.flags)


class TestOutlierDetectionResult:
    def test_flagged_count_and_material_flags_aggregate_correctly(self):
        result = detect_valuation_outliers(**_base_kwargs(
            current_price=100.0, fair_value_bear=110.0, fair_value_base=350.0, fair_value_bull=400.0,
        ))
        assert result.flagged_count == len(result.material_flags)
        assert result.flagged_count == sum(1 for f in result.flags if f.flagged)
        assert set(result.material_flags) == {f.name for f in result.flags if f.flagged}

    def test_no_exception_when_everything_is_none(self):
        result = detect_valuation_outliers(
            current_price=None, fair_value_bear=None, fair_value_base=None, fair_value_bull=None,
        )
        assert result.flags == []
        assert result.flagged_count == 0
        assert result.material_flags == []

    def test_never_marks_any_flag_as_critical_severity(self):
        result = detect_valuation_outliers(**_base_kwargs(
            current_price=100.0, fair_value_bear=110.0, fair_value_base=350.0, fair_value_bull=400.0,
            avg_roic_pct=50.0, industry_median_roic_pct=10.0,
            implied_multiple=40.0, historical_median_pe=20.0, peer_median_pe=18.0,
            pv_of_terminal_value=95.0, enterprise_value=100.0, regime_change_flag=True,
        ))
        assert all(f.severity in ("info", "warning") for f in result.flags)
