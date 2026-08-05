"""
Tests — app.services.quality.earnings_quality_engine (Fase 2, Incremento 5).

See /Users/diegoarria/.claude/plans/stateful-painting-flurry.md.
"""
import pytest

from app.services.quality.earnings_quality_engine import (
    evaluate_sbc_dilution,
    evaluate_accounting_consistency,
    evaluate_margin_anomalies,
    evaluate_fcf_net_income_divergence,
    evaluate_revenue_fcf_growth_gap,
    compute_earnings_quality,
    ACQUISITIONS_GROWTH_NOTE,
)


class TestEvaluateSbcDilution:
    def test_low_sbc_produces_no_alerts(self):
        pct_rev, pct_fcf, alerts = evaluate_sbc_dilution(10.0, 1000.0, 500.0)
        assert pct_rev == pytest.approx(1.0)
        assert pct_fcf == pytest.approx(2.0)
        assert alerts == []

    def test_elevated_sbc_vs_revenue_is_medium(self):
        _, _, alerts = evaluate_sbc_dilution(70.0, 1000.0, 1000.0)  # 7% of revenue
        assert any(a.key == "sbc_elevated_vs_revenue" and a.severity == "medium" for a in alerts)

    def test_high_sbc_vs_revenue(self):
        _, _, alerts = evaluate_sbc_dilution(150.0, 1000.0, 1000.0)  # 15% of revenue
        assert any(a.key == "sbc_high_vs_revenue" and a.severity == "high" for a in alerts)

    def test_high_sbc_vs_fcf(self):
        _, _, alerts = evaluate_sbc_dilution(50.0, 10000.0, 70.0)  # ~71% of FCF, <1% of revenue
        assert any(a.key == "sbc_high_vs_fcf" and a.severity == "high" for a in alerts)

    def test_none_inputs_produce_no_ratios_or_alerts(self):
        pct_rev, pct_fcf, alerts = evaluate_sbc_dilution(None, 1000.0, 500.0)
        assert pct_rev is None
        assert alerts == []

    def test_negative_or_zero_fcf_skips_fcf_ratio(self):
        pct_rev, pct_fcf, alerts = evaluate_sbc_dilution(50.0, 1000.0, -100.0)
        assert pct_fcf is None


class TestEvaluateAccountingConsistency:
    def test_no_alert_when_clean(self):
        assert evaluate_accounting_consistency({"requiere_revision_manual": False}) == []
        assert evaluate_accounting_consistency(None) == []

    def test_alert_when_flagged(self):
        alerts = evaluate_accounting_consistency({"requiere_revision_manual": True, "years_flagged": ["2021", "2022"]})
        assert len(alerts) == 1
        assert alerts[0].severity == "high"
        assert "2021" in alerts[0].description


class TestEvaluateMarginAnomalies:
    def test_no_anomaly_in_stable_trend(self):
        trend = [20.0, 20.5, 19.8, 20.2, 20.1, 19.9]
        alerts = evaluate_margin_anomalies(trend, [str(2019 + i) for i in range(6)], "margen_operativo")
        assert alerts == []

    def test_detects_a_real_outlier_year(self):
        trend = [20.0, 20.5, 19.8, 55.0, 20.1, 19.9]  # year 3 is a huge outlier
        years = [str(2019 + i) for i in range(6)]
        alerts = evaluate_margin_anomalies(trend, years, "margen_operativo")
        assert len(alerts) == 1
        assert "2022" in alerts[0].key

    def test_no_anomalies_with_fewer_than_4_data_points(self):
        alerts = evaluate_margin_anomalies([10.0, 90.0, 5.0], ["2022", "2023", "2024"], "margen_neto")
        assert alerts == []

    def test_ignores_none_values(self):
        trend = [20.0, None, 19.8, 20.2, 20.1, 19.9]
        years = [str(2019 + i) for i in range(6)]
        alerts = evaluate_margin_anomalies(trend, years, "margen_bruto")
        assert alerts == []


class TestEvaluateFcfNetIncomeDivergence:
    def test_no_alert_when_ratio_is_consistent(self):
        fcf = [100.0, 110.0, 105.0, 108.0, 115.0, 108.0]
        ni = [90.0, 100.0, 95.0, 98.0, 105.0, 98.0]
        years = [str(2019 + i) for i in range(6)]
        alerts = evaluate_fcf_net_income_divergence(fcf, ni, years)
        assert alerts == []

    def test_detects_a_real_divergent_year(self):
        # 6 points needed: with only ~5 samples, a single outlier's own
        # magnitude inflates the population stdev enough that its z-score
        # can never mathematically clear a threshold of 2.0 (the
        # well-known small-sample "masking" limit, z_max ≈ sqrt(n-1)).
        fcf = [100.0, 110.0, 105.0, 900.0, 115.0, 108.0]  # year 4 FCF spikes vs NI
        ni = [90.0, 100.0, 95.0, 95.0, 105.0, 98.0]
        years = [str(2019 + i) for i in range(6)]
        alerts = evaluate_fcf_net_income_divergence(fcf, ni, years)
        assert len(alerts) == 1
        assert "2022" in alerts[0].key


class TestEvaluateRevenueFcfGrowthGap:
    def test_no_alert_when_growth_rates_are_close(self):
        assert evaluate_revenue_fcf_growth_gap(12.0, 10.0) == []

    def test_medium_alert_for_moderate_gap(self):
        alerts = evaluate_revenue_fcf_growth_gap(25.0, 10.0)  # 15pp gap
        assert len(alerts) == 1
        assert alerts[0].severity == "medium"

    def test_high_alert_for_large_gap(self):
        alerts = evaluate_revenue_fcf_growth_gap(35.0, 5.0)  # 30pp gap
        assert alerts[0].severity == "high"

    def test_no_alert_when_fcf_grows_faster_than_revenue(self):
        assert evaluate_revenue_fcf_growth_gap(10.0, 25.0) == []

    def test_none_inputs_produce_no_alert(self):
        assert evaluate_revenue_fcf_growth_gap(None, 10.0) == []


class TestComputeEarningsQuality:
    def test_clean_company_produces_no_alerts(self):
        n = 6
        result = compute_earnings_quality(
            sbc_latest=10.0, revenue_latest=1000.0, fcf_latest=500.0,
            data_validation={"requiere_revision_manual": False},
            gross_margin_trend=[55.0] * n, operating_margin_trend=[25.0] * n, net_margin_trend=[18.0] * n,
            fcf_trend=[100.0 + i * 5 for i in range(n)], net_income_trend=[90.0 + i * 5 for i in range(n)],
            years=[str(2019 + i) for i in range(n)],
            revenue_cagr_pct=10.0, fcf_cagr_pct=9.0,
        )
        assert result.alert_count == 0
        assert result.highest_severity is None
        assert result.acquisitions_note == ACQUISITIONS_GROWTH_NOTE

    def test_flags_multiple_real_issues(self):
        n = 6
        result = compute_earnings_quality(
            sbc_latest=150.0, revenue_latest=1000.0, fcf_latest=200.0,  # high SBC
            data_validation={"requiere_revision_manual": True, "years_flagged": ["2021"]},
            gross_margin_trend=[55.0] * n, operating_margin_trend=[25.0] * n, net_margin_trend=[18.0] * n,
            fcf_trend=[100.0] * n, net_income_trend=[90.0] * n,
            years=[str(2019 + i) for i in range(n)],
            revenue_cagr_pct=40.0, fcf_cagr_pct=5.0,  # big growth gap
        )
        assert result.alert_count >= 3
        assert result.highest_severity == "high"

    def test_highest_severity_none_when_no_alerts(self):
        result = compute_earnings_quality(
            sbc_latest=None, revenue_latest=None, fcf_latest=None, data_validation=None,
            gross_margin_trend=[], operating_margin_trend=[], net_margin_trend=[],
            fcf_trend=[], net_income_trend=[], years=[],
            revenue_cagr_pct=None, fcf_cagr_pct=None,
        )
        assert result.highest_severity is None
        assert result.alert_count == 0
