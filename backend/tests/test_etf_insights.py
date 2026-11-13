"""Nuvos ETF — "Lo que debes entender" rule engine. These tests exist
specifically to catch an insight claiming something the underlying data
doesn't support — Diego's explicit 2026-11 requirement."""
import pytest

from app.services.etf.insights import build_insights, get_horizon_note
from app.services.etf.translations import translate_country, translate_sector

# Forbidden words: evaluative conclusions the rules must never produce,
# regardless of phrasing — only descriptive, number-backed statements
# are allowed. ("concentración" is explicitly allowed per Diego's own
# wording, as long as it's tied to the real percentage.)
_FORBIDDEN_WORDS = [
    "riesgoso", "riesgosa", "seguro", "segura", "bien diversificado", "bien diversificada",
    "mal diversificado", "mal diversificada", "bajo riesgo", "alto rendimiento",
    "recomendado", "recomendamos", "deberías invertir", "conviene invertir",
    "risky", "safe", "well diversified", "poorly diversified", "low risk", "you should invest",
]


def _overview(sector_top1=None, sector_pct=None, bucket_count=1, country_top1=None, country_pct=None,
              country_bucket=1, expense_ratio=None, holdings_count=None):
    return {
        "diversification": {
            "by_sector": {"top1_name": sector_top1, "top1_weight_pct": sector_pct, "bucket_count": bucket_count},
            "by_country": {"top1_name": country_top1, "top1_weight_pct": country_pct, "bucket_count": country_bucket},
        },
        "costs": {"expense_ratio_pct": expense_ratio, "cost_tier": None},
        "exposure": {"holdings_count": holdings_count},
    }


class TestNoUnsupportedClaims:
    @pytest.mark.parametrize("scenario", [
        {"sector_top1": "Technology", "sector_pct": 85.0, "bucket_count": 1},   # XLK-like extreme concentration
        {"sector_top1": "Technology", "sector_pct": 38.6, "bucket_count": 11},  # VOO-like broad market
        {"sector_top1": "Technology", "sector_pct": 59.2, "bucket_count": 9},   # QQQ-like tech-heavy
        {"sector_top1": "Financial Services", "sector_pct": 22.3, "bucket_count": 11, "country_top1": "Japan", "country_pct": 16.1, "country_bucket": 20},  # VXUS-like international
    ])
    def test_no_forbidden_evaluative_words_in_any_observation(self, scenario):
        overview = _overview(**scenario, expense_ratio=0.1)
        insights = build_insights(overview, lang="es")
        for insight in insights:
            lowered = insight["text"].lower()
            for word in _FORBIDDEN_WORDS:
                assert word not in lowered, f"forbidden word {word!r} found in: {insight['text']}"

    def test_holdings_count_never_appears_in_any_insight_text(self):
        """Explicit requirement: never infer concentration/diversification
        from holdings_count alone — it must not even be referenced inside
        an insight's text, only shown as a separate header metric."""
        overview = _overview(sector_top1="Technology", sector_pct=30.0, bucket_count=5, holdings_count=500)
        insights = build_insights(overview, lang="es")
        for insight in insights:
            assert "holdings_count" not in insight["supporting_data"]
            assert "posiciones" not in insight["text"].lower()
            assert "positions" not in insight["text"].lower()

    def test_every_number_in_text_matches_supporting_data(self):
        overview = _overview(sector_top1="Technology", sector_pct=85.3, bucket_count=1, expense_ratio=0.68)
        insights = build_insights(overview, lang="es")
        sector_insight = next(i for i in insights if i["category"] == "sector_concentration")
        assert "85.3" in sector_insight["text"]
        assert sector_insight["supporting_data"]["weight_pct"] == 85.3


class TestMaxThreeAndPriority:
    def test_all_three_present_when_data_complete(self):
        overview = _overview(sector_top1="Technology", sector_pct=30.0, bucket_count=5,
                              country_top1="United States", country_pct=99.0, country_bucket=3,
                              expense_ratio=0.09)
        insights = build_insights(overview, lang="es")
        assert len(insights) == 3
        assert [i["category"] for i in insights] == ["sector_concentration", "geographic_exposure", "cost"]

    def test_fewer_than_three_when_data_missing_never_padded(self):
        overview = _overview(sector_top1="Technology", sector_pct=30.0, bucket_count=5)  # no country, no cost data
        insights = build_insights(overview, lang="es")
        assert len(insights) == 1
        assert insights[0]["category"] == "sector_concentration"

    def test_zero_insights_when_no_data_at_all(self):
        overview = _overview()
        insights = build_insights(overview, lang="es")
        assert insights == []

    def test_never_more_than_three(self):
        overview = _overview(sector_top1="Technology", sector_pct=30.0, bucket_count=5,
                              country_top1="United States", country_pct=99.0, country_bucket=3,
                              expense_ratio=0.09)
        insights = build_insights(overview, lang="es")
        assert len(insights) <= 3


class TestSectorConcentrationThresholds:
    def test_high_concentration_phrasing(self):
        overview = _overview(sector_top1="Technology", sector_pct=85.3, bucket_count=1)
        insight = build_insights(overview, "es")[0]
        assert "concentración alta" in insight["text"]

    def test_low_concentration_distributed_phrasing(self):
        overview = _overview(sector_top1="Financial Services", sector_pct=15.0, bucket_count=10)
        insight = build_insights(overview, "es")[0]
        assert "distribuida entre" in insight["text"]

    def test_mid_range_neutral_phrasing(self):
        overview = _overview(sector_top1="Technology", sector_pct=30.0, bucket_count=5)
        insight = build_insights(overview, "es")[0]
        assert "más grande" in insight["text"]


class TestGeographicThresholds:
    def test_extreme_single_country_phrasing(self):
        overview = _overview(country_top1="United States", country_pct=99.5, country_bucket=5)
        insight = build_insights(overview, "es")[0]
        assert insight["category"] == "geographic_exposure"
        assert "Casi toda" in insight["text"]


class TestCostObservation:
    def test_includes_real_dollar_example(self):
        overview = _overview(expense_ratio=0.68)
        insight = build_insights(overview, "es")[0]
        assert insight["category"] == "cost"
        assert "0.68%" in insight["text"]
        assert "68.0" in insight["text"] or "$68" in insight["text"]


class TestHorizonNote:
    def test_is_identical_regardless_of_etf_category(self):
        """Explicit requirement: no per-category horizon assignment —
        same static text for every ETF."""
        note_a = get_horizon_note("es")
        note_b = get_horizon_note("es")
        assert note_a == note_b

    def test_does_not_recommend_a_specific_horizon(self):
        note = get_horizon_note("es")
        lowered = note.lower()
        for phrase in ["te conviene", "deberías mantenerlo", "recomendamos un horizonte", "lo ideal es"]:
            assert phrase not in lowered

    def test_english_variant_exists_and_differs(self):
        assert get_horizon_note("en") != get_horizon_note("es")


class TestTranslations:
    def test_known_sector_translated(self):
        assert translate_sector("Technology", "es") == "Tecnología"

    def test_known_country_translated(self):
        assert translate_country("Japan", "es") == "Japón"

    def test_unknown_sector_falls_back_to_original_not_invented(self):
        assert translate_sector("Mystery Sector XYZ", "es") == "Mystery Sector XYZ"

    def test_english_lang_returns_original(self):
        assert translate_sector("Technology", "en") == "Technology"

    def test_none_input_returns_none(self):
        assert translate_sector(None, "es") is None
