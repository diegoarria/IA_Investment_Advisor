"""
Tests — app.services.morning_brief_service pure logic (news keyword
scoring). DB/Finnhub-touching orchestration (build_morning_brief,
_portfolio_day_change, _top_mover, ...) isn't covered here — same
convention as weekly_rituals_service/get_sunday_prep: only the pure
functions get direct tests.
"""
from app.services.morning_brief_service import _score_news_item, _IMPACT_EMOJI


class TestScoreNewsItem:
    def test_earnings_headline_scores_highest_category(self):
        score, category = _score_news_item("Apple reports Q3 earnings beat", "EPS beat estimates")
        assert category == "earnings"
        assert score > 0

    def test_guidance_headline_is_classified(self):
        score, category = _score_news_item("Company raises forecast for the year", "")
        assert category == "guidance"

    def test_ceo_change_headline_is_classified(self):
        score, category = _score_news_item("CEO steps down amid restructuring", "")
        assert category == "ceo_change"

    def test_m_and_a_headline_is_classified(self):
        score, category = _score_news_item("Company to acquire rival for $2B", "")
        assert category == "m_and_a"

    def test_regulation_headline_is_classified(self):
        score, category = _score_news_item("Firm faces SEC probe over disclosures", "")
        assert category == "regulation"

    def test_debt_capital_headline_is_classified(self):
        score, category = _score_news_item("Company announces new buyback program", "")
        assert category == "debt_capital"

    def test_irrelevant_headline_scores_zero(self):
        score, category = _score_news_item("Company opens new office in Austin", "Just a real-estate note")
        assert score == 0
        assert category is None

    def test_case_insensitive(self):
        score, category = _score_news_item("COMPANY REPORTS EARNINGS BEAT", "")
        assert category == "earnings"

    def test_earnings_outranks_debt_when_both_present(self):
        # Earnings (weight 6) must win over debt_capital (weight 4) when a
        # headline could plausibly match both category's keyword lists.
        score, category = _score_news_item("Earnings beat, plus a new buyback program announced", "")
        assert category == "earnings"


class TestImpactEmojiMapping:
    def test_covers_every_real_impact_level_macro_calendar_service_uses(self):
        # migrations/074_macro_economic_events.sql: impact_level is
        # VERY_HIGH | HIGH | MEDIUM (no LOW in the source data — LOW only
        # ever appears as this module's own defensive fallback).
        assert set(_IMPACT_EMOJI.keys()) >= {"VERY_HIGH", "HIGH", "MEDIUM", "LOW"}
