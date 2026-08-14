from app.services.company_diagnostic_service import (
    _primary_scenarios, _pillar_scores, _score_label, _badges, _fmt_money, _fmt_pct,
)


class TestFmtHelpers:
    def test_fmt_money_billions(self):
        assert _fmt_money(3_400_000_000) == "$3.4B"

    def test_fmt_money_millions(self):
        assert _fmt_money(150_000_000) == "$150M"

    def test_fmt_money_small(self):
        assert _fmt_money(5000) == "$5,000"

    def test_fmt_money_none(self):
        assert _fmt_money(None) == "N/D"

    def test_fmt_pct(self):
        assert _fmt_pct(9.73) == "9.7%"

    def test_fmt_pct_none(self):
        assert _fmt_pct(None) == "N/D"


class TestPrimaryScenarios:
    def test_prefers_gqv_when_ok_and_scenarios_present(self):
        dcf = {
            "gqv_fair_value": {
                "status": "ok",
                "scenarios": {
                    "bear": {"fair_value_per_share": 30.0}, "base": {"fair_value_per_share": 40.0}, "bull": {"fair_value_per_share": 50.0},
                    "current_price": 29.0, "margin_of_safety_pct": 27.5,
                },
                "uncertainty_profile": {"data_confidence": {"score": 90}},
                "reality_gate": {"pass_rate": 91.7},
            },
            "scenarios": {"pessimistic": {"intrinsic_value_per_share": 10.0}, "base": {"intrinsic_value_per_share": 20.0}, "optimistic": {"intrinsic_value_per_share": 30.0}},
            "current_price": 29.0, "margin_of_safety_pct": 5.0,
        }
        result = _primary_scenarios(dcf)
        assert result["source"] == "gqv"
        assert result["base"] == 40.0
        assert result["reality_gate_pass_rate"] == 91.7

    def test_falls_back_to_legacy_dcf_when_gqv_missing(self):
        dcf = {
            "gqv_fair_value": None,
            "scenarios": {"pessimistic": {"intrinsic_value_per_share": 10.0}, "base": {"intrinsic_value_per_share": 20.0}, "optimistic": {"intrinsic_value_per_share": 30.0}},
            "current_price": 15.0, "margin_of_safety_pct": 25.0,
            "uncertainty_profile": {"data_confidence": {"score": 70}},
        }
        result = _primary_scenarios(dcf)
        assert result["source"] == "dcf"
        assert result["base"] == 20.0
        assert result["reality_gate_pass_rate"] is None

    def test_falls_back_when_gqv_status_not_ok(self):
        dcf = {
            "gqv_fair_value": {"status": "insufficient_data", "scenarios": None},
            "scenarios": {"pessimistic": {"intrinsic_value_per_share": 10.0}, "base": {"intrinsic_value_per_share": 20.0}, "optimistic": {"intrinsic_value_per_share": 30.0}},
            "current_price": 15.0, "margin_of_safety_pct": 25.0,
        }
        result = _primary_scenarios(dcf)
        assert result["source"] == "dcf"

    def test_returns_none_when_neither_has_a_real_base_value(self):
        dcf = {"gqv_fair_value": None, "scenarios": None}
        assert _primary_scenarios(dcf) is None

    def test_returns_none_for_empty_dcf(self):
        assert _primary_scenarios({}) is None


class TestPillarScores:
    def _scenarios(self, **overrides):
        base = {
            "margin_of_safety_pct": 20.0,
            "uncertainty_profile": {"data_confidence": {"score": 80}},
            "reality_gate_pass_rate": 90.0,
        }
        base.update(overrides)
        return base

    def test_computes_all_four_pillars(self):
        data = {"business_quality_score": 85, "financial_strength_score": 90}
        result = _pillar_scores(data, self._scenarios())
        assert result["quality"] == 85
        assert result["trust"] == 90
        assert result["value"] == 70  # 50 + 20
        assert result["simplicity"] == 85  # mean(80, 90)

    def test_value_clamped_at_0_and_100(self):
        data = {"business_quality_score": 50, "financial_strength_score": 50}
        high = _pillar_scores(data, self._scenarios(margin_of_safety_pct=200))
        low = _pillar_scores(data, self._scenarios(margin_of_safety_pct=-200))
        assert high["value"] == 100
        assert low["value"] == 0

    def test_simplicity_falls_back_to_single_signal(self):
        data = {"business_quality_score": 50, "financial_strength_score": 50}
        result = _pillar_scores(data, self._scenarios(reality_gate_pass_rate=None))
        assert result["simplicity"] == 80  # data_confidence only

    def test_none_when_quality_missing(self):
        data = {"business_quality_score": None, "financial_strength_score": 90}
        assert _pillar_scores(data, self._scenarios()) is None

    def test_none_when_margin_of_safety_missing(self):
        data = {"business_quality_score": 85, "financial_strength_score": 90}
        assert _pillar_scores(data, self._scenarios(margin_of_safety_pct=None)) is None

    def test_none_when_no_simplicity_signal_at_all(self):
        data = {"business_quality_score": 85, "financial_strength_score": 90}
        result = _pillar_scores(data, self._scenarios(uncertainty_profile={}, reality_gate_pass_rate=None))
        assert result is None


class TestScoreLabel:
    def test_high_score_undervalued(self):
        assert _score_label(88, 25.0) == "Calidad Máxima + Descuento"

    def test_high_score_overvalued(self):
        assert _score_label(88, -20.0) == "Calidad Máxima, Cara"

    def test_high_score_fair(self):
        assert _score_label(88, 1.0) == "Calidad Máxima, Precio Justo"

    def test_mid_tier(self):
        assert _score_label(65, 10.0) == "Buen Negocio + Descuento"

    def test_low_tier(self):
        assert _score_label(20, 10.0) == "Calidad Débil + Descuento"

    def test_no_margin_of_safety_data(self):
        assert _score_label(88, None) == "Calidad Máxima"


class TestBadges:
    def test_zero_debt_badge_fires(self):
        data = {"total_debt": 0.0, "net_cash": 3_400_000_000, "operating_margin_trend": [36.5]}
        scenarios = {"current_price": 29.0, "margin_of_safety_pct": 31.7}
        dcf = {"shares_outstanding": 100_000_000, "growth_buildup": {"avg_roic_pct": 22.0}, "industry_benchmarks": {}}
        badges = _badges(data=data, scenarios=scenarios, dcf=dcf)
        assert "Cero Deuda" in badges

    def test_high_roic_badge_fires(self):
        data = {"total_debt": 500_000_000, "net_cash": 0, "operating_margin_trend": [15.0]}
        scenarios = {"current_price": 29.0, "margin_of_safety_pct": 0.0}
        dcf = {"shares_outstanding": 100_000_000, "growth_buildup": {"avg_roic_pct": 25.0}, "industry_benchmarks": {}}
        badges = _badges(data=data, scenarios=scenarios, dcf=dcf)
        assert "ROIC Excepcional" in badges

    def test_never_more_than_3_badges(self):
        data = {"total_debt": 0.0, "net_cash": 3_400_000_000, "operating_margin_trend": [50.0]}
        scenarios = {"current_price": 10.0, "margin_of_safety_pct": 60.0}
        dcf = {
            "shares_outstanding": 100_000_000, "growth_buildup": {"avg_roic_pct": 30.0},
            "industry_benchmarks": {"median_operating_margin_pct": 10.0},
            "nuvos_fair_value": {"moat_duration": {"bucket": "15_plus"}},
        }
        badges = _badges(data=data, scenarios=scenarios, dcf=dcf)
        assert len(badges) <= 3

    def test_no_badges_when_nothing_fires(self):
        data = {"total_debt": 500_000_000, "net_cash": 0, "operating_margin_trend": [10.0]}
        scenarios = {"current_price": 100.0, "margin_of_safety_pct": 0.0}
        dcf = {"shares_outstanding": 100_000_000, "growth_buildup": {"avg_roic_pct": 5.0}, "industry_benchmarks": {}}
        badges = _badges(data=data, scenarios=scenarios, dcf=dcf)
        assert badges == []

    def test_never_raises_on_missing_market_cap_inputs(self):
        badges = _badges(data={}, scenarios={}, dcf={})
        assert badges == []
